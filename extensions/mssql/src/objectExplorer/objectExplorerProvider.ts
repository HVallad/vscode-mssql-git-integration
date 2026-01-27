/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as vscodeMssql from "vscode-mssql";
import ConnectionManager from "../controllers/connectionManager";
import { CreateSessionResult, ObjectExplorerService } from "./objectExplorerService";
import { TreeNodeInfo } from "./nodes/treeNodeInfo";
import { IConnectionInfo } from "vscode-mssql";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { IConnectionProfile } from "../models/interfaces";
import { ConnectionNode } from "./nodes/connectionNode";
import { serverLabel } from "../constants/constants";

export class ObjectExplorerProvider implements vscode.TreeDataProvider<any> {
    private _onDidChangeTreeData: vscode.EventEmitter<any | undefined> = new vscode.EventEmitter<
        any | undefined
    >();
    readonly onDidChangeTreeData: vscode.Event<any | undefined> = this._onDidChangeTreeData.event;

    // Events for external extension API
    private _onDidSelectNode: vscode.EventEmitter<vscodeMssql.ITreeNodeInfo> =
        new vscode.EventEmitter<vscodeMssql.ITreeNodeInfo>();
    readonly onDidSelectNode: vscode.Event<vscodeMssql.ITreeNodeInfo> = this._onDidSelectNode.event;

    private _onDidRefresh: vscode.EventEmitter<vscodeMssql.ITreeNodeInfo | undefined> =
        new vscode.EventEmitter<vscodeMssql.ITreeNodeInfo | undefined>();
    readonly onDidRefresh: vscode.Event<vscodeMssql.ITreeNodeInfo | undefined> =
        this._onDidRefresh.event;

    private _objectExplorerService: ObjectExplorerService;
    private _contextContributors: vscodeMssql.IContextContributor[] = [];
    private _selectedNode: TreeNodeInfo | undefined;

    constructor(
        private _vscodeWrapper: VscodeWrapper,
        connectionManager: ConnectionManager,
        private _isRichExperienceEnabled: boolean = true,
    ) {
        if (!_vscodeWrapper) {
            this._vscodeWrapper = new VscodeWrapper();
        }

        this._objectExplorerService = new ObjectExplorerService(
            this._vscodeWrapper,
            connectionManager,
            (node) => {
                this.refresh(node);
            },
            this._isRichExperienceEnabled,
        );
    }

    /**
     * Register a context contributor that adds properties to node context values.
     * @param contributor The contributor to register
     * @returns A disposable that unregisters the contributor when disposed
     */
    public registerContextContributor(
        contributor: vscodeMssql.IContextContributor,
    ): vscode.Disposable {
        this._contextContributors.push(contributor);
        console.log(`ObjectExplorer: Context contributor registered (total: ${this._contextContributors.length})`);

        // Refresh the tree to apply the new contributor's context
        this.refresh();

        return new vscode.Disposable(() => {
            const index = this._contextContributors.indexOf(contributor);
            if (index >= 0) {
                this._contextContributors.splice(index, 1);
                console.log(`ObjectExplorer: Context contributor unregistered (remaining: ${this._contextContributors.length})`);
                // Refresh the tree after unregistering
                this.refresh();
            }
        });
    }

    /**
     * Get the currently selected node in Object Explorer
     */
    public getSelectedNode(): TreeNodeInfo | undefined {
        return this._selectedNode;
    }

    /**
     * Set the currently selected node (called by tree view selection handler)
     */
    public setSelectedNode(node: TreeNodeInfo | undefined): void {
        this._selectedNode = node;
        if (node) {
            this._onDidSelectNode.fire(node);
        }
    }

    public getParent(element: TreeNodeInfo) {
        return element.parentNode;
    }

    public refresh(nodeInfo?: TreeNodeInfo): void {
        this._onDidChangeTreeData.fire(nodeInfo);
        this._onDidRefresh.fire(nodeInfo);
    }

    public async getTreeItem(node: TreeNodeInfo): Promise<TreeNodeInfo> {
        // Apply context contributions from registered contributors
        await this._applyContextContributions(node);
        return node;
    }

    /**
     * Apply context contributions from all registered contributors
     */
    private async _applyContextContributions(node: TreeNodeInfo): Promise<void> {
        console.log(`ObjectExplorer: getTreeItem called for nodeType='${node.nodeType}', contributors=${this._contextContributors.length}`);

        if (this._contextContributors.length === 0) {
            return;
        }

        try {
            // Get contributions from all contributors in parallel
            const contributions = await Promise.all(
                this._contextContributors.map((contributor) =>
                    contributor.contributeContext(node).catch((err) => {
                        console.error("Error from context contributor:", err);
                        return undefined;
                    }),
                ),
            );

            console.log(`ObjectExplorer: Got ${contributions.length} contributions for ${node.nodeType}`);

            // Merge all contributions into the node's context
            const context = node.context || {
                type: node.nodeType,
                subType: "",
                filterable: false,
                hasFilters: false,
            };

            // Collect descriptions from contributors
            const descriptions: string[] = [];

            for (const contribution of contributions) {
                if (contribution) {
                    console.log(`ObjectExplorer: Merging contribution:`, contribution);

                    // Merge context properties
                    if (contribution.contextProperties) {
                        Object.assign(context, contribution.contextProperties);
                    }

                    // Collect description if provided
                    if (contribution.description) {
                        descriptions.push(contribution.description);
                    }
                }
            }

            node.context = context;

            // Set description on the node (join multiple descriptions with separator)
            if (descriptions.length > 0) {
                node.description = descriptions.join(" | ");
            }

            console.log(`ObjectExplorer: Final contextValue for ${node.nodeType}: '${node.contextValue}'`);
        } catch (err) {
            console.error("Error applying context contributions:", err);
        }
    }

    public async getChildren(element?: TreeNodeInfo): Promise<vscode.TreeItem[]> {
        const children = await this._objectExplorerService.getChildren(element);
        if (children) {
            return children;
        }
    }

    /**
     * Refresh all connected connection nodes in the object explorer.
     */
    public refreshConnectedNodes(): void {
        const connections = this._objectExplorerService.connections;
        if (connections?.length === 0) {
            return;
        }

        connections
            .map(({ id }) => this._objectExplorerService.getConnectionNodeById(id))
            .filter((node) => node.sessionId && node.nodeType === serverLabel) // Only refresh connected server nodes
            .forEach((node) => void this.refreshNode(node));
    }

    public async setNodeLoading(node: TreeNodeInfo): Promise<void> {
        await this._objectExplorerService.setLoadingUiForNode(node);
    }

    public async createSession(
        connectionCredentials?: IConnectionInfo,
    ): Promise<CreateSessionResult> {
        return this._objectExplorerService.createSession(connectionCredentials);
    }

    public async expandNode(
        node: TreeNodeInfo,
        sessionId: string,
    ): Promise<vscode.TreeItem[] | undefined> {
        return this._objectExplorerService.expandNode(node, sessionId);
    }

    public async removeNode(
        node: ConnectionNode,
        showUserConfirmationPrompt?: boolean,
    ): Promise<void> {
        if (showUserConfirmationPrompt !== undefined) {
            await this._objectExplorerService.removeNode(node, showUserConfirmationPrompt);
        } else {
            await this._objectExplorerService.removeNode(node);
        }
    }

    public async disconnectNode(node: ConnectionNode): Promise<void> {
        await this._objectExplorerService.disconnectNode(node);
        this.refresh(node);
    }

    public async refreshNode(node: TreeNodeInfo): Promise<void> {
        node.shouldRefresh = true;
        this._onDidChangeTreeData.fire(node);
    }

    public async removeConnectionNodes(connections: IConnectionInfo[]): Promise<void> {
        if (connections.length === 0) {
            return;
        }

        await this._objectExplorerService.removeConnectionNodes(connections);
        this.refresh(undefined);
    }

    public addDisconnectedNode(connectionCredentials: IConnectionProfile): void {
        this._objectExplorerService.addDisconnectedNode(connectionCredentials);
    }

    public deleteChildrenCache(node: TreeNodeInfo): void {
        this._objectExplorerService.cleanNodeChildren(node);
    }

    public get connections(): IConnectionProfile[] {
        return this._objectExplorerService.connections;
    }

    public get objectExplorerService(): ObjectExplorerService {
        return this._objectExplorerService;
    }

    /* Only for testing purposes */
    public set objectExplorerService(value: ObjectExplorerService) {
        this._objectExplorerService = value;
    }
}
