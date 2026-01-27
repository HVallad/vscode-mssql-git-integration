/*---------------------------------------------------------------------------------------------
 *  MSSQL Git Integration Extension
 *  Git integration and source control for SQL Server databases
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import type * as vscodeMssql from "vscode-mssql";
import { GitStatusService } from "./services/gitStatusService";
import { registerCommands } from "./commands";

// Extension ID for the mssql extension
const MSSQL_EXTENSION_ID = "ms-mssql.mssql";

// Store the mssql extension API for use in commands
let mssqlApi: vscodeMssql.IExtension | undefined;
let gitStatusService: GitStatusService | undefined;

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

    // Register commands
    registerCommands(context, mssqlApi, gitStatusService);

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

