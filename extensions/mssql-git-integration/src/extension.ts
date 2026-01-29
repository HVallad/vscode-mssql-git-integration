/*---------------------------------------------------------------------------------------------
 *  MSSQL Git Integration Extension
 *  Git integration and source control for SQL Server databases
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import type * as vscodeMssql from "vscode-mssql";
import { GitStatusService } from "./services/gitStatusService";
import { GitSyncDecorationProvider } from "./services/gitSyncDecorationProvider";
import { SyncStatusCache } from "./services/syncStatusCache";
import { registerCommands } from "./commands";

// Extension ID for the mssql extension
const MSSQL_EXTENSION_ID = "ms-mssql.mssql";

// Store the mssql extension API for use in commands
let mssqlApi: vscodeMssql.IExtension | undefined;
let gitStatusService: GitStatusService | undefined;
let gitDecorationProvider: GitSyncDecorationProvider | undefined;
let syncStatusCache: SyncStatusCache | undefined;

// Node types that should have sync status decorations
const SCRIPTABLE_NODE_TYPES = new Set([
    "Table",
    "View",
    "StoredProcedure",
    "ScalarValuedFunction",
    "TableValuedFunction",
    "InlineFunction",
    "Trigger",
]);

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

    // Initialize services
    gitStatusService = new GitStatusService(context);
    gitDecorationProvider = new GitSyncDecorationProvider();
    syncStatusCache = new SyncStatusCache();

    // Register the FileDecorationProvider for git sync status decorations
    console.log("MSSQL Git: Registering file decoration provider...");
    context.subscriptions.push(
        vscode.window.registerFileDecorationProvider(gitDecorationProvider)
    );

    // Register the context contributor with mssql's Object Explorer
    console.log("MSSQL Git: Registering context contributor...");
    const contextContributorDisposable =
        mssqlApi.objectExplorer.registerContextContributor({
            async contributeContext(
                node: vscodeMssql.ITreeNodeInfo,
            ): Promise<vscodeMssql.IContextContribution | undefined> {
                // Handle Database nodes
                if (node.nodeType === "Database") {
                    return handleDatabaseNode(node);
                }

                // Handle scriptable object nodes (Table, View, StoredProcedure, etc.)
                if (SCRIPTABLE_NODE_TYPES.has(node.nodeType)) {
                    return handleObjectNode(node);
                }

                return undefined;
            },
        });
    console.log("MSSQL Git: Context contributor registered successfully");

    context.subscriptions.push(contextContributorDisposable);

    // Register commands (pass the new services)
    registerCommands(context, mssqlApi, gitStatusService, syncStatusCache, gitDecorationProvider);

    // Subscribe to Object Explorer events for debugging
    const selectDisposable = mssqlApi.objectExplorer.onDidSelectNode(
        (node: vscodeMssql.ITreeNodeInfo) => {
            console.log(
                `MSSQL Git: Node selected - ${node.nodeType}: ${node.label}`,
            );
        },
    );
    context.subscriptions.push(selectDisposable);

    console.log("MSSQL Git Integration extension activated successfully!");
}

/**
 * Handle context contribution for Database nodes
 */
function handleDatabaseNode(
    node: vscodeMssql.ITreeNodeInfo,
): vscodeMssql.IContextContribution | undefined {
    const databaseName = node.metadata?.name || "";

    // Get git link info for this database
    const linkInfo = gitStatusService!.getGitLinkInfo(
        node.connectionProfile,
        databaseName,
    );

    const isLinked = linkInfo !== undefined;

    console.log(`MSSQL Git: Database '${databaseName}' gitLinked=${isLinked}, branch=${linkInfo?.branchName || 'N/A'}`);

    // Return context contribution with branch name as description
    return {
        contextProperties: {
            gitLinked: isLinked,
        },
        description: isLinked ? `⎇ ${linkInfo!.branchName}` : undefined,
    };
}

/**
 * Handle context contribution for scriptable object nodes (Table, View, etc.)
 */
function handleObjectNode(
    node: vscodeMssql.ITreeNodeInfo,
): vscodeMssql.IContextContribution | undefined {
    // Get database name by walking up the parent chain
    const databaseName = getDatabaseNameFromNode(node);
    if (!databaseName) {
        return undefined;
    }

    // Check if this database is git-linked
    const linkInfo = gitStatusService!.getGitLinkInfo(
        node.connectionProfile,
        databaseName,
    );

    if (!linkInfo) {
        return undefined; // Database not linked to git
    }

    // Get object info
    const schema = node.metadata?.schema || "dbo";
    const objectName = node.metadata?.name || node.label?.toString() || "";
    const serverName = node.connectionProfile?.server || "";

    // Check if we have cached sync status
    const status = syncStatusCache?.getObjectStatus(
        serverName,
        databaseName,
        schema,
        objectName,
    );

    if (status === undefined) {
        // No cached status yet - decorations will be applied after comparison
        return undefined;
    }

    // Build resource URI for decoration
    const resourceUri = GitSyncDecorationProvider.buildObjectUri(
        serverName,
        databaseName,
        node.nodeType,
        schema,
        objectName,
    );

    // Set decoration in provider
    gitDecorationProvider!.setDecoration(resourceUri, status);

    return {
        resourceUri: resourceUri.toString(),
    };
}

/**
 * Get database name by walking up the parent chain
 */
function getDatabaseNameFromNode(node: vscodeMssql.ITreeNodeInfo): string | undefined {
    let current: vscodeMssql.ITreeNodeInfo | undefined = node;

    while (current) {
        if (current.nodeType === "Database") {
            return current.metadata?.name || current.label?.toString();
        }
        current = current.parentNode;
    }

    return undefined;
}

export function deactivate(): void {
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
 * Get the git decoration provider for use in commands
 */
export function getGitDecorationProvider(): GitSyncDecorationProvider | undefined {
    return gitDecorationProvider;
}

/**
 * Get the sync status cache for use in commands
 */
export function getSyncStatusCache(): SyncStatusCache | undefined {
    return syncStatusCache;
}

