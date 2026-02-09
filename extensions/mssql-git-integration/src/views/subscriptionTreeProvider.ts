/*---------------------------------------------------------------------------------------------
 *  Subscription Tree Provider
 *  TreeView provider for displaying subscriptions and schema differences
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { SqlComparisonClient } from '../services/sqlComparisonClient';
import { ComparisonServiceSignalR } from '../services/signalRClient';
import { Subscription, SchemaDifference } from '../types';

/**
 * Base class for tree items
 */
export class TreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    ) {
        super(label, collapsibleState);
    }
}

/**
 * Tree item representing a subscription
 */
export class SubscriptionItem extends TreeItem {
    constructor(
        public readonly subscription: Subscription,
        public readonly differenceCount: number,
    ) {
        super(subscription.name, vscode.TreeItemCollapsibleState.Collapsed);

        this.description = differenceCount > 0
            ? `${differenceCount} difference(s)`
            : 'Synchronized';

        // Support both flat and nested date formats from API
        const lastComparedAt = subscription.lastComparedAt ?? subscription.lastComparison?.comparedAt;

        this.tooltip = `${subscription.database.server}/${subscription.database.database}\n` +
            `Status: ${subscription.state}\n` +
            `Path: ${subscription.project.path}\n` +
            (lastComparedAt
                ? `Last comparison: ${new Date(lastComparedAt).toLocaleString()}`
                : 'No comparison yet');

        // Set icon based on state
        if (subscription.state === 'paused') {
            this.iconPath = new vscode.ThemeIcon('debug-pause');
        } else if (subscription.state === 'error') {
            this.iconPath = new vscode.ThemeIcon('error');
        } else if (differenceCount > 0) {
            this.iconPath = new vscode.ThemeIcon('warning');
        } else {
            this.iconPath = new vscode.ThemeIcon('check');
        }

        this.contextValue = `subscription-${subscription.state}`;
    }
}

/**
 * Tree item representing an object type category (Tables, Views, etc.)
 */
export class ObjectTypeItem extends TreeItem {
    constructor(
        public readonly subscriptionId: string,
        public readonly objectType: string,
        public readonly differences: SchemaDifference[],
    ) {
        super(`${objectType} (${differences.length})`, vscode.TreeItemCollapsibleState.Collapsed);
        this.iconPath = new vscode.ThemeIcon('symbol-folder');
        this.contextValue = 'objectType';
    }
}

/**
 * Tree item representing a schema difference
 */
export class DifferenceItem extends TreeItem {
    constructor(
        public readonly difference: SchemaDifference,
    ) {
        // Use objectName directly - API returns full name like "schema.objectName"
        const label = difference.objectName;
        super(label, vscode.TreeItemCollapsibleState.None);

        // Map API action to display text
        const actionText = difference.action === 'add' ? 'Added'
            : difference.action === 'delete' ? 'Deleted'
            : 'Modified';
        this.description = actionText;

        // Set tooltip with more details
        this.tooltip = `${difference.objectType}: ${label}\n` +
            `Change: ${actionText}\n` +
            `Direction: ${difference.direction}\n` +
            (difference.filePath ? `File: ${difference.filePath}` : '');

        // Set icon based on action
        switch (difference.action) {
            case 'add':
                this.iconPath = new vscode.ThemeIcon('diff-added',
                    new vscode.ThemeColor('gitDecoration.addedResourceForeground'));
                break;
            case 'change':
                this.iconPath = new vscode.ThemeIcon('diff-modified',
                    new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'));
                break;
            case 'delete':
                this.iconPath = new vscode.ThemeIcon('diff-removed',
                    new vscode.ThemeColor('gitDecoration.deletedResourceForeground'));
                break;
        }

        this.contextValue = 'difference';

        // Set command to show diff
        this.command = {
            command: 'mssql-git.viewDiff',
            title: 'View Difference',
            arguments: [difference],
        };
    }
}

/**
 * Info item for displaying status messages
 */
export class InfoItem extends TreeItem {
    constructor(
        message: string,
        icon?: string,
    ) {
        super(message, vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon(icon || 'info');
        this.contextValue = 'info';
    }
}

/**
 * Subscription state with differences
 */
interface SubscriptionState {
    subscription: Subscription;
    differences: SchemaDifference[];
    loading: boolean;
}

/**
 * Tree data provider for subscriptions and schema differences
 */
export class SubscriptionTreeProvider implements vscode.TreeDataProvider<TreeItem> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined | null>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private subscriptions: Map<string, SubscriptionState> = new Map();
    private isServiceAvailable: boolean = false;
    private isLoading: boolean = false;

    constructor(
        private readonly client: SqlComparisonClient | undefined,
        signalR: ComparisonServiceSignalR | undefined,
    ) {
        // Listen for updates from SignalR
        if (signalR) {
            signalR.onComparisonCompleted(event => {
                this.refreshSubscription(event.subscriptionId);
            });

            signalR.onDifferencesDetected(event => {
                this.refreshSubscription(event.subscriptionId);
            });
        }
    }

    getTreeItem(element: TreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: TreeItem): Promise<TreeItem[]> {
        if (!this.client) {
            return [new InfoItem('SQL Comparison Service not configured', 'warning')];
        }

        if (!element) {
            // Root level: return subscriptions
            return this.getSubscriptionItems();
        }

        if (element instanceof SubscriptionItem) {
            // Subscription level: return object type categories
            return this.getObjectTypeItems(element.subscription.id);
        }

        if (element instanceof ObjectTypeItem) {
            // Object type level: return differences
            return element.differences.map(diff => new DifferenceItem(diff));
        }

        return [];
    }

    /**
     * Get subscription items for the root level
     */
    private async getSubscriptionItems(): Promise<TreeItem[]> {
        if (this.isLoading) {
            return [new InfoItem('Loading subscriptions...', 'loading~spin')];
        }

        try {
            this.isLoading = true;

            // Fetch subscriptions from the service
            const subscriptions = await this.client!.getSubscriptions();
            this.isServiceAvailable = true;

            if (subscriptions.length === 0) {
                return [new InfoItem('No subscriptions found. Link a database to git to create one.', 'info')];
            }

            // Update subscription states
            // Use differenceCount from API response (supports both flat and nested formats)
            // Actual differences are fetched lazily when expanding the node
            const items: SubscriptionItem[] = [];
            for (const sub of subscriptions) {
                // Support both flat (list endpoint) and nested (individual endpoint) formats
                const differenceCount = sub.differenceCount ?? sub.lastComparison?.differenceCount ?? 0;

                this.subscriptions.set(sub.id, {
                    subscription: sub,
                    differences: [], // Populated lazily when expanded
                    loading: false,
                });

                items.push(new SubscriptionItem(sub, differenceCount));
            }

            return items;
        } catch {
            this.isServiceAvailable = false;
            return [new InfoItem('SQL Comparison Service unavailable', 'warning')];
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * Get object type category items for a subscription
     */
    private async getObjectTypeItems(subscriptionId: string): Promise<TreeItem[]> {
        const state = this.subscriptions.get(subscriptionId);
        if (!state) {
            return [];
        }

        // Lazily fetch differences if not loaded yet
        // Support both flat (list endpoint) and nested (individual endpoint) formats
        const hasDifferences = (state.subscription.differenceCount ?? state.subscription.lastComparison?.differenceCount ?? 0) > 0;
        if (state.differences.length === 0 && hasDifferences) {
            try {
                state.differences = await this.client!.getDifferences(subscriptionId);
            } catch (error) {
                console.warn(`Failed to fetch differences for ${subscriptionId}:`, error);
                return [new InfoItem('Failed to load differences', 'error')];
            }
        }

        if (state.differences.length === 0) {
            return [new InfoItem('No differences - synchronized', 'check')];
        }

        // Group differences by object type
        const byType = new Map<string, SchemaDifference[]>();
        for (const diff of state.differences) {
            const type = diff.objectType;
            if (!byType.has(type)) {
                byType.set(type, []);
            }
            byType.get(type)!.push(diff);
        }

        // Create items sorted by type name
        const items: ObjectTypeItem[] = [];
        const sortedTypes = Array.from(byType.keys()).sort();
        for (const type of sortedTypes) {
            items.push(new ObjectTypeItem(subscriptionId, type, byType.get(type)!));
        }

        return items;
    }

    /**
     * Refresh the entire tree
     */
    public refresh(): void {
        this.subscriptions.clear();
        this._onDidChangeTreeData.fire(undefined);
    }

    /**
     * Refresh a specific subscription
     */
    public async refreshSubscription(subscriptionId: string): Promise<void> {
        if (!this.client) return;

        try {
            const subscription = await this.client.getSubscription(subscriptionId);
            const differences = await this.client.getDifferences(subscriptionId);

            this.subscriptions.set(subscriptionId, {
                subscription,
                differences,
                loading: false,
            });

            this._onDidChangeTreeData.fire(undefined);
        } catch (error) {
            console.warn(`Failed to refresh subscription ${subscriptionId}:`, error);
        }
    }

    /**
     * Check if the service is available
     */
    public isAvailable(): boolean {
        return this.isServiceAvailable;
    }
}

