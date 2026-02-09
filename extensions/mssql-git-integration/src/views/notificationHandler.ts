/*---------------------------------------------------------------------------------------------
 *  Notification Handler
 *  Handles SignalR events and updates UI components accordingly
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ComparisonServiceSignalR } from '../services/signalRClient';
import { SubscriptionTreeProvider } from './subscriptionTreeProvider';
import { SchemaSyncStatusBar } from './statusBar';

/**
 * Handles notifications from the SQL Comparison Service and updates UI components
 */
export class NotificationHandler implements vscode.Disposable {
    private readonly disposables: vscode.Disposable[] = [];
    private suppressNotifications = false;

    constructor(
        private readonly signalR: ComparisonServiceSignalR,
        private readonly treeProvider: SubscriptionTreeProvider,
        private readonly statusBar: SchemaSyncStatusBar,
    ) {
        this.registerEventHandlers();
    }

    /**
     * Register handlers for all SignalR events
     */
    private registerEventHandlers(): void {
        // Handle differences detected
        this.disposables.push(
            this.signalR.onDifferencesDetected(event => {
                this.handleDifferencesDetected(event.subscriptionId, event.differenceCount);
            })
        );

        // Handle comparison started
        this.disposables.push(
            this.signalR.onComparisonStarted(event => {
                this.handleComparisonStarted(event.subscriptionId);
            })
        );

        // Handle comparison progress
        this.disposables.push(
            this.signalR.onComparisonProgress(event => {
                this.handleComparisonProgress(
                    event.subscriptionId,
                    event.phase,
                    event.percentComplete
                );
            })
        );

        // Handle comparison completed
        this.disposables.push(
            this.signalR.onComparisonCompleted(event => {
                this.handleComparisonCompleted(
                    event.subscriptionId,
                    event.differenceCount,
                    event.duration
                );
            })
        );

        // Handle comparison failed
        this.disposables.push(
            this.signalR.onComparisonFailed(event => {
                this.handleComparisonFailed(event.subscriptionId, event.error);
            })
        );

        // Handle connection state changes
        this.disposables.push(
            this.signalR.onConnectionStateChanged(event => {
                this.handleConnectionStateChanged(event.state);
            })
        );

        // Handle subscription health changes
        this.disposables.push(
            this.signalR.onSubscriptionHealthChanged(event => {
                this.handleSubscriptionHealthChanged(
                    event.subscriptionId,
                    event.health,
                    event.message
                );
            })
        );
    }

    private handleDifferencesDetected(subscriptionId: string, differenceCount: number): void {
        // Update status bar
        this.statusBar.setDifferenceCount(differenceCount);

        // Refresh the tree
        void this.treeProvider.refreshSubscription(subscriptionId);

        // Show notification for significant changes
        if (differenceCount > 0 && !this.suppressNotifications) {
            this.showDifferencesNotification(subscriptionId, differenceCount);
        }
    }

    private handleComparisonStarted(subscriptionId: string): void {
        this.statusBar.setComparing('schema');
        void this.treeProvider.refreshSubscription(subscriptionId);
    }

    private handleComparisonProgress(
        subscriptionId: string,
        phase: string,
        percentComplete: number
    ): void {
        this.statusBar.showMessage(
            `$(sync~spin) ${phase}: ${percentComplete}%`,
            1000
        );
    }

    private handleComparisonCompleted(
        subscriptionId: string,
        differenceCount: number,
        durationMs: number
    ): void {
        this.statusBar.setDifferenceCount(differenceCount);
        void this.treeProvider.refreshSubscription(subscriptionId);

        // Log completion
        const durationSec = (durationMs / 1000).toFixed(1);
        console.log(
            `MSSQL Git: Comparison completed for ${subscriptionId} in ${durationSec}s. ` +
            `Found ${differenceCount} difference(s).`
        );
    }

    private handleComparisonFailed(subscriptionId: string, error: string): void {
        this.statusBar.showMessage('$(error) Comparison failed', 5000);
        void this.treeProvider.refreshSubscription(subscriptionId);

        void vscode.window.showErrorMessage(
            `Schema comparison failed: ${error}`,
            'Retry'
        ).then(choice => {
            if (choice === 'Retry') {
                void vscode.commands.executeCommand(
                    'mssql-git.triggerComparison',
                    subscriptionId
                );
            }
        });
    }

    private handleConnectionStateChanged(
        state: 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
    ): void {
        this.statusBar.setConnectionStatus(state === 'connected');

        if (state === 'disconnected') {
            void vscode.window.showWarningMessage(
                'Disconnected from SQL Comparison Service.',
                'Reconnect'
            ).then(choice => {
                if (choice === 'Reconnect') {
                    void this.signalR.start();
                }
            });
        } else if (state === 'connected') {
            // Refresh tree when reconnected
            this.treeProvider.refresh();
        }
    }

    private handleSubscriptionHealthChanged(
        subscriptionId: string,
        status: string,
        message?: string
    ): void {
        void this.treeProvider.refreshSubscription(subscriptionId);

        if (status === 'error' && message) {
            void vscode.window.showWarningMessage(
                `Subscription health issue: ${message}`,
                'View Details'
            ).then(choice => {
                if (choice === 'View Details') {
                    void vscode.commands.executeCommand(
                        'mssql-git.showSubscriptions'
                    );
                }
            });
        }
    }

    private showDifferencesNotification(
        subscriptionId: string,
        differenceCount: number
    ): void {
        void vscode.window.showInformationMessage(
            `${differenceCount} schema difference(s) detected`,
            'View Differences'
        ).then(choice => {
            if (choice === 'View Differences') {
                void vscode.commands.executeCommand(
                    'mssql-git.showDifferences',
                    subscriptionId
                );
            }
        });
    }

    /**
     * Temporarily suppress notifications (useful during batch operations)
     */
    public setSuppressNotifications(suppress: boolean): void {
        this.suppressNotifications = suppress;
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
    }
}

