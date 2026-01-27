/*---------------------------------------------------------------------------------------------
 *  Command Registration
 *  Registers all git integration commands
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import type * as vscodeMssql from "vscode-mssql";
import { GitStatusService } from "./services/gitStatusService";

/**
 * Register all extension commands
 */
export function registerCommands(
    context: vscode.ExtensionContext,
    mssqlApi: vscodeMssql.IExtension,
    gitStatusService: GitStatusService,
): void {
    // Link database to git branch
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "mssql-git.linkDatabaseToGitBranch",
            async (node: vscodeMssql.ITreeNodeInfo) => {
                await linkDatabaseToGitBranch(node, mssqlApi, gitStatusService);
            },
        ),
    );

    // Unlink database from git branch
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "mssql-git.unlinkDatabaseFromGitBranch",
            async (node: vscodeMssql.ITreeNodeInfo) => {
                await unlinkDatabaseFromGitBranch(
                    node,
                    mssqlApi,
                    gitStatusService,
                );
            },
        ),
    );

    // Pull database changes
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "mssql-git.pullDatabaseChanges",
            async (node: vscodeMssql.ITreeNodeInfo) => {
                await pullDatabaseChanges(node);
            },
        ),
    );

    // Push database changes
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "mssql-git.pushDatabaseChanges",
            async (node: vscodeMssql.ITreeNodeInfo) => {
                await pushDatabaseChanges(node);
            },
        ),
    );

    // Refresh local cache
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "mssql-git.refreshLocalCache",
            async (node: vscodeMssql.ITreeNodeInfo) => {
                await refreshLocalCache(node);
            },
        ),
    );

    // Clear local cache
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "mssql-git.clearLocalCache",
            async (node: vscodeMssql.ITreeNodeInfo) => {
                await clearLocalCache(node);
            },
        ),
    );

    // Compare with cache
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "mssql-git.compareWithCache",
            async (node: vscodeMssql.ITreeNodeInfo) => {
                await compareWithCache(node);
            },
        ),
    );

    // Show migration script
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "mssql-git.showMigrationScript",
            async (node: vscodeMssql.ITreeNodeInfo) => {
                await showMigrationScript(node);
            },
        ),
    );
}

async function linkDatabaseToGitBranch(
    node: vscodeMssql.ITreeNodeInfo,
    mssqlApi: vscodeMssql.IExtension,
    gitStatusService: GitStatusService,
): Promise<void> {
    const databaseName = node.metadata?.name || node.label?.toString() || "";

    // Ask user for git repository path
    const gitRepoUri = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: "Select Git Repository",
        title: "Select the Git repository folder",
    });

    if (!gitRepoUri || gitRepoUri.length === 0) {
        return;
    }

    const gitRepoPath = gitRepoUri[0].fsPath;

    // Ask for branch name
    const branchName = await vscode.window.showInputBox({
        prompt: "Enter the git branch name to link with",
        value: "main",
        validateInput: (value) => {
            if (!value || value.trim().length === 0) {
                return "Branch name is required";
            }
            return undefined;
        },
    });

    if (!branchName) {
        return;
    }

    await gitStatusService.linkDatabaseToGit(
        node.connectionProfile,
        databaseName,
        gitRepoPath,
        branchName,
    );

    // Refresh the Object Explorer to update the context value
    mssqlApi.objectExplorer.refresh(node);

    vscode.window.showInformationMessage(
        `Database "${databaseName}" linked to git branch "${branchName}"`,
    );
}

async function unlinkDatabaseFromGitBranch(
    node: vscodeMssql.ITreeNodeInfo,
    mssqlApi: vscodeMssql.IExtension,
    gitStatusService: GitStatusService,
): Promise<void> {
    const databaseName = node.metadata?.name || node.label?.toString() || "";

    const confirm = await vscode.window.showWarningMessage(
        `Are you sure you want to unlink "${databaseName}" from git?`,
        { modal: true },
        "Unlink",
    );

    if (confirm !== "Unlink") {
        return;
    }

    await gitStatusService.unlinkDatabaseFromGit(
        node.connectionProfile,
        databaseName,
    );

    // Refresh the Object Explorer to update the context value
    mssqlApi.objectExplorer.refresh(node);

    vscode.window.showInformationMessage(
        `Database "${databaseName}" unlinked from git`,
    );
}

async function pullDatabaseChanges(
    node: vscodeMssql.ITreeNodeInfo,
): Promise<void> {
    const databaseName = node.metadata?.name || node.label?.toString() || "";
    // TODO: Implement pull database changes from git
    vscode.window.showInformationMessage(
        `Pull database changes for "${databaseName}" - Not yet implemented`,
    );
}

async function pushDatabaseChanges(
    node: vscodeMssql.ITreeNodeInfo,
): Promise<void> {
    const databaseName = node.metadata?.name || node.label?.toString() || "";
    // TODO: Implement push database changes to git
    vscode.window.showInformationMessage(
        `Push database changes for "${databaseName}" - Not yet implemented`,
    );
}

async function refreshLocalCache(
    node: vscodeMssql.ITreeNodeInfo,
): Promise<void> {
    const databaseName = node.metadata?.name || node.label?.toString() || "";
    // TODO: Implement refresh local cache
    vscode.window.showInformationMessage(
        `Refresh local cache for "${databaseName}" - Not yet implemented`,
    );
}

async function clearLocalCache(
    node: vscodeMssql.ITreeNodeInfo,
): Promise<void> {
    const databaseName = node.metadata?.name || node.label?.toString() || "";
    // TODO: Implement clear local cache
    vscode.window.showInformationMessage(
        `Clear local cache for "${databaseName}" - Not yet implemented`,
    );
}

async function compareWithCache(
    node: vscodeMssql.ITreeNodeInfo,
): Promise<void> {
    const databaseName = node.metadata?.name || node.label?.toString() || "";
    // TODO: Implement compare with cache
    vscode.window.showInformationMessage(
        `Compare with cache for "${databaseName}" - Not yet implemented`,
    );
}

async function showMigrationScript(
    node: vscodeMssql.ITreeNodeInfo,
): Promise<void> {
    const databaseName = node.metadata?.name || node.label?.toString() || "";
    // TODO: Implement show migration script
    vscode.window.showInformationMessage(
        `Show migration script for "${databaseName}" - Not yet implemented`,
    );
}

