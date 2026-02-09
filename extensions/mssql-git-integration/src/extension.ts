/*---------------------------------------------------------------------------------------------
 *  MSSQL Git Integration Extension
 *  Git integration and source control for SQL Server databases
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import type * as vscodeMssql from "vscode-mssql";
import { GitStatusService } from "./services/gitStatusService";
import { ServiceDiscovery } from "./services/serviceDiscovery";
import { SqlComparisonClient } from "./services/sqlComparisonClient";
import { ComparisonServiceSignalR } from "./services/signalRClient";
import { registerCommands } from "./commands";
import {
    SubscriptionTreeProvider,
    SqlCompareContentProvider,
    DiffViewer,
    SchemaSyncStatusBar,
    NotificationHandler,
} from "./views";
import type { SchemaDifference } from "./types";

// Extension ID for the mssql extension
const MSSQL_EXTENSION_ID = "ms-mssql.mssql";

// Store the mssql extension API for use in commands
let mssqlApi: vscodeMssql.IExtension | undefined;
let gitStatusService: GitStatusService | undefined;
let comparisonClient: SqlComparisonClient | undefined;
let signalRClient: ComparisonServiceSignalR | undefined;
let statusBar: SchemaSyncStatusBar | undefined;

export async function activate(
    context: vscode.ExtensionContext,
): Promise<void> {
    console.log("MSSQL Git Integration extension is activating...");

    // Get the mssql extension
    const mssqlExtension =
        vscode.extensions.getExtension<vscodeMssql.IExtension>(
            MSSQL_EXTENSION_ID,
        );

    if (!mssqlExtension) {
        vscode.window.showErrorMessage(
            "MSSQL extension is required but not found. Please install ms-mssql.mssql.",
        );
        return;
    }

    // Activate the mssql extension if it isn't already
    if (!mssqlExtension.isActive) {
        await mssqlExtension.activate();
    }

    mssqlApi = mssqlExtension.exports;

    // Initialize core services
    gitStatusService = new GitStatusService(context);

    // Initialize SQL Comparison Service integration (Method B: Separate Installation)
    // The service must be installed and running independently
    const serviceDiscovery = new ServiceDiscovery();

    try {
        const config = vscode.workspace.getConfiguration("mssqlGit.comparisonService");
        const autoConnect = config.get<boolean>("autoConnect", true);

        if (autoConnect) {
            console.log("MSSQL Git: Attempting to discover SQL Comparison Service...");
            const serviceInfo = await serviceDiscovery.discoverService();

            if (serviceInfo) {
                console.log(`MSSQL Git: Found SQL Comparison Service at ${serviceInfo.endpoint}`);

                // Initialize REST API client
                comparisonClient = new SqlComparisonClient(serviceDiscovery);

                // Initialize SignalR for real-time notifications
                const enableNotifications = config.get<boolean>("enableNotifications", true);
                if (enableNotifications) {
                    signalRClient = new ComparisonServiceSignalR(serviceDiscovery);
                    try {
                        await signalRClient.start();
                        console.log("MSSQL Git: SignalR connection established");
                    } catch (signalRError) {
                        console.warn("MSSQL Git: Failed to establish SignalR connection:", signalRError);
                        // Continue without real-time updates
                    }
                }
            } else {
                console.log("MSSQL Git: SQL Comparison Service not found. Extension will operate in basic mode.");
            }
        }
    } catch (error) {
        console.warn("MSSQL Git: Error during service discovery:", error);
        // Extension continues to work without comparison features
    }

    // Initialize UI components
    statusBar = new SchemaSyncStatusBar();
    statusBar.setConnectionStatus(comparisonClient !== undefined);
    context.subscriptions.push(statusBar);

    // Initialize content provider for diff views
    const contentProvider = SqlCompareContentProvider.getInstance(context);

    // Initialize diff viewer
    const diffViewer = comparisonClient
        ? new DiffViewer(comparisonClient, contentProvider)
        : undefined;

    // Initialize tree view provider for subscriptions
    const treeProvider = new SubscriptionTreeProvider(comparisonClient, signalRClient);

    // Register tree view
    const treeView = vscode.window.createTreeView("mssql-git.schemaSync", {
        treeDataProvider: treeProvider,
        showCollapseAll: true,
    });
    context.subscriptions.push(treeView);

    // Initialize notification handler for SignalR events
    let notificationHandler: NotificationHandler | undefined;
    if (signalRClient) {
        notificationHandler = new NotificationHandler(signalRClient, treeProvider, statusBar);
        context.subscriptions.push(notificationHandler);
    }

    // Register the context contributor with mssql's Object Explorer
    console.log("MSSQL Git: Registering context contributor...");
    const contextContributorDisposable =
        mssqlApi.objectExplorer.registerContextContributor({
            async contributeContext(
                node: vscodeMssql.ITreeNodeInfo,
            ): Promise<vscodeMssql.IContextContribution | undefined> {
                console.log(`MSSQL Git: contributeContext called for nodeType='${node.nodeType}', label='${node.label}'`);

                // Only contribute context for Database nodes
                if (node.nodeType !== "Database") {
                    console.log(`MSSQL Git: Skipping non-Database node (nodeType=${node.nodeType})`);
                    return undefined;
                }

                const databaseName = node.metadata?.name || "";

                // Get git link info for this database
                const linkInfo = gitStatusService!.getGitLinkInfo(
                    node.connectionProfile,
                    databaseName,
                );

                const isLinked = linkInfo !== undefined;

                console.log(`MSSQL Git: Database '${databaseName}' gitLinked=${isLinked}, branch=${linkInfo?.branchName || 'N/A'}`);

                // Return context contribution with branch name as description
                // Using git branch icon (⎇) to indicate git-linked database
                return {
                    contextProperties: {
                        gitLinked: isLinked,
                    },
                    description: isLinked ? `⎇ ${linkInfo!.branchName}` : undefined,
                };
            },
        });
    console.log("MSSQL Git: Context contributor registered successfully");

    context.subscriptions.push(contextContributorDisposable);

    // Register commands with comparison client for enhanced features
    registerCommands(context, mssqlApi, gitStatusService, comparisonClient);

    // Register additional commands for the tree view
    context.subscriptions.push(
        vscode.commands.registerCommand("mssql-git.refreshSubscriptions", () => {
            treeProvider.refresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("mssql-git.showSubscriptions", async () => {
            // Focus on the tree view - since we can't reveal undefined,
            // we just ensure the view is visible
            await vscode.commands.executeCommand("mssql-git.schemaSync.focus");
        })
    );

    if (diffViewer) {
        context.subscriptions.push(
            vscode.commands.registerCommand("mssql-git.viewDiff", async (subscriptionId: string, difference: SchemaDifference) => {
                if (difference && typeof difference === "object") {
                    await diffViewer.showDiff(subscriptionId, difference);
                }
            })
        );
    }

    // Subscribe to Object Explorer events for debugging
    const selectDisposable = mssqlApi.objectExplorer.onDidSelectNode(
        (node: vscodeMssql.ITreeNodeInfo) => {
            console.log(
                `MSSQL Git: Node selected - ${node.nodeType}: ${node.label}`,
            );
        },
    );
    context.subscriptions.push(selectDisposable);

    // Cleanup on deactivation
    context.subscriptions.push({
        dispose: () => {
            signalRClient?.dispose();
            statusBar?.dispose();
        },
    });

    console.log("MSSQL Git Integration extension activated successfully!");
}

export async function deactivate(): Promise<void> {
    console.log("MSSQL Git Integration extension deactivating...");

    // Disconnect SignalR
    if (signalRClient) {
        signalRClient.dispose();
        signalRClient = undefined;
    }

    // Cleanup status bar
    if (statusBar) {
        statusBar.dispose();
        statusBar = undefined;
    }

    console.log("MSSQL Git Integration extension deactivated.");
}

/**
 * Get the mssql extension API for use in commands
 */
export function getMssqlApi(): vscodeMssql.IExtension | undefined {
    return mssqlApi;
}

/**
 * Get the git status service for use in commands
 */
export function getGitStatusService(): GitStatusService | undefined {
    return gitStatusService;
}

