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
import { ObjectExplorerDecorationService } from "./services/objectExplorerDecorationService";
import { SchemaCompareSettingsService } from "./services/schemaCompareSettingsService";
import { registerCommands } from "./commands";
import {
    SubscriptionTreeProvider,
    SqlCompareContentProvider,
    DiffViewer,
    SchemaSyncStatusBar,
    NotificationHandler,
    SchemaDecorationProvider,
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
let decorationService: ObjectExplorerDecorationService | undefined;
let schemaDecorationProvider: SchemaDecorationProvider | undefined;
let schemaCompareSettingsService: SchemaCompareSettingsService | undefined;

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
    schemaCompareSettingsService = new SchemaCompareSettingsService(context);

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

    // Initialize decoration service for Object Explorer
    decorationService = new ObjectExplorerDecorationService(gitStatusService, comparisonClient);

    // Initialize and register the schema decoration provider for Git-style colors
    schemaDecorationProvider = new SchemaDecorationProvider();
    context.subscriptions.push(
        vscode.window.registerFileDecorationProvider(schemaDecorationProvider)
    );

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

                // Handle Database nodes
                if (node.nodeType === "Database") {
                    const databaseName = node.metadata?.name || "";

                    // Get git link info for this database
                    const linkInfo = gitStatusService!.getGitLinkInfo(
                        node.connectionProfile,
                        databaseName,
                    );

                    const isLinked = linkInfo !== undefined;

                    console.log(`MSSQL Git: Database '${databaseName}' gitLinked=${isLinked}, branch=${linkInfo?.branchName || 'N/A'}, subscriptionId=${linkInfo?.subscriptionId || 'N/A'}`);

                    // If not linked, return early
                    if (!isLinked) {
                        return {
                            contextProperties: {
                                gitLinked: false,
                            },
                            description: undefined,
                        };
                    }

                    // Build description parts
                    const descriptionParts: string[] = [];
                    descriptionParts.push(`⎇ ${linkInfo!.branchName}`);

                    // If we have a subscription ID and comparison client, fetch the difference count
                    let differenceCount = 0;
                    let hasDifferences = false;

                    if (linkInfo!.subscriptionId && decorationService) {
                        try {
                            differenceCount = await decorationService.getDifferenceCount(linkInfo!.subscriptionId);
                            hasDifferences = differenceCount > 0;

                            if (hasDifferences) {
                                // Add difference count to description with warning indicator
                                descriptionParts.push(`⚠ ${differenceCount} diff${differenceCount !== 1 ? 's' : ''}`);
                            } else {
                                // Show synced status
                                descriptionParts.push('✓ synced');
                            }
                        } catch (error) {
                            console.warn(`MSSQL Git: Failed to fetch subscription for ${databaseName}:`, error);
                            // Continue without difference info
                        }
                    }

                    // Return context contribution with branch name and difference count
                    return {
                        contextProperties: {
                            gitLinked: true,
                            hasSchemaDiff: hasDifferences,
                            schemaDiffCount: String(differenceCount), // Convert to string for context property type
                        },
                        description: descriptionParts.join(' | '),
                    };
                }

                // Handle scriptable object nodes (Table, View, StoredProcedure, etc.)
                if (decorationService?.isScriptableObjectType(node.nodeType)) {
                    const linkInfo = decorationService.getGitLinkInfoForNode(node);

                    // If parent database is not linked, skip
                    if (!linkInfo?.subscriptionId) {
                        return undefined;
                    }

                    // Get the qualified object name
                    const qualifiedName = decorationService.getQualifiedObjectName(node.metadata || {});

                    // Create a resource URI for file decorations
                    const server = node.connectionProfile?.server || 'unknown';
                    const database = decorationService.getDatabaseNameFromNode(node) || 'unknown';
                    const objectType = node.nodeType;
                    const schema = node.metadata?.schema || 'dbo';
                    const objectName = node.metadata?.name || '';
                    const resourceUri = SchemaDecorationProvider.createUri(server, database, objectType, schema, objectName);

                    console.log(`MSSQL Git: Checking object '${qualifiedName}' (type=${node.nodeType}) for differences`);

                    try {
                        const difference = await decorationService.getObjectDifference(
                            linkInfo.subscriptionId,
                            qualifiedName,
                        );

                        if (difference) {
                            // Map action to display text
                            const actionText = difference.action === 'add' ? 'Added'
                                : difference.action === 'delete' ? 'Deleted'
                                : 'Modified';

                            console.log(`MSSQL Git: Object '${qualifiedName}' has difference: ${actionText}`);

                            // Set decoration in the provider for Git-style colors
                            if (schemaDecorationProvider) {
                                schemaDecorationProvider.setDecoration(resourceUri, difference.action);
                            }

                            return {
                                contextProperties: {
                                    gitLinked: true,
                                    hasSchemaDiff: true,
                                    diffAction: difference.action,
                                },
                                description: `${actionText}`,
                                resourceUri: resourceUri,
                            };
                        } else {
                            // Clear any existing decoration for this object
                            if (schemaDecorationProvider) {
                                schemaDecorationProvider.clearDecoration(resourceUri);
                            }
                        }
                    } catch (error) {
                        console.warn(`MSSQL Git: Failed to check object difference for ${qualifiedName}:`, error);
                    }

                    // Object is in a linked database but has no differences
                    return {
                        contextProperties: {
                            gitLinked: true,
                            hasSchemaDiff: false,
                        },
                        description: undefined, // No decoration for synced objects
                        resourceUri: resourceUri, // Still provide URI so decoration can be cleared
                    };
                }

                // For other node types, return undefined (no contribution)
                return undefined;
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

    // Register command to clear cached schema compare settings
    context.subscriptions.push(
        vscode.commands.registerCommand("mssql-git.clearCachedSchemaCompareSettings", async () => {
            if (schemaCompareSettingsService) {
                await schemaCompareSettingsService.clearSettings();
                void vscode.window.showInformationMessage(
                    "Cached schema compare settings have been cleared. New comparisons will use default settings."
                );
            }
        })
    );

    // Register listener for schema compare options confirmed event
    // This allows us to cache settings when the user confirms options in schema compare
    // Using mssql-git namespace since we're in the mssql-git-integration extension
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "mssql-git.schemaCompare.optionsConfirmed",
            async (deploymentOptions: vscodeMssql.DeploymentOptions) => {
                console.log("MSSQL Git: optionsConfirmed command received");
                console.log("MSSQL Git: schemaCompareSettingsService exists:", !!schemaCompareSettingsService);
                console.log("MSSQL Git: deploymentOptions exists:", !!deploymentOptions);
                if (schemaCompareSettingsService && deploymentOptions) {
                    try {
                        await schemaCompareSettingsService.saveFromDeploymentOptions(deploymentOptions);
                        console.log("MSSQL Git: Schema compare settings cached from confirmed options");
                    } catch (error) {
                        console.error("MSSQL Git: Failed to cache schema compare settings:", error);
                    }
                } else {
                    console.log("MSSQL Git: Cannot cache - missing service or options");
                }
            }
        )
    );
    console.log("MSSQL Git: Registered mssql-git.schemaCompare.optionsConfirmed command");

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

/**
 * Get the decoration service for cache management
 */
export function getDecorationService(): ObjectExplorerDecorationService | undefined {
    return decorationService;
}

/**
 * Get the schema decoration provider for file decorations
 */
export function getSchemaDecorationProvider(): SchemaDecorationProvider | undefined {
    return schemaDecorationProvider;
}

/**
 * Get the schema compare settings service for caching settings
 */
export function getSchemaCompareSettingsService(): SchemaCompareSettingsService | undefined {
    return schemaCompareSettingsService;
}
