/*---------------------------------------------------------------------------------------------
 *  Command Registration
 *  Registers all git integration commands
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import type * as vscodeMssql from "vscode-mssql";
import { GitStatusService } from "./services/gitStatusService";
import simpleGit, { SimpleGit } from "simple-git";

// Git URL patterns for validation
const GIT_HTTPS_REGEX = /^https?:\/\/[^\s/$.?#].[^\s]*\.git$/i;
const GIT_SSH_REGEX = /^git@[^\s:]+:[^\s]+\.git$/i;
const GIT_CLONE_PREFIX_REGEX = /^git\s+clone\s+/i;

/**
 * Validate and normalize a git repository URL
 * Strips "git clone " prefix if present and validates the URL format
 */
function validateAndNormalizeGitUrl(input: string): { isValid: boolean; url?: string; error?: string } {
    if (!input || input.trim().length === 0) {
        return { isValid: false, error: "Git repository URL is required" };
    }

    // Strip "git clone " prefix if present
    let url = input.trim();
    if (GIT_CLONE_PREFIX_REGEX.test(url)) {
        url = url.replace(GIT_CLONE_PREFIX_REGEX, "").trim();
    }

    // Validate HTTPS format
    if (GIT_HTTPS_REGEX.test(url)) {
        return { isValid: true, url };
    }

    // Validate SSH format
    if (GIT_SSH_REGEX.test(url)) {
        return { isValid: true, url };
    }

    // Allow URLs without .git suffix (common for GitHub/GitLab)
    const urlWithoutGit = url;
    if (urlWithoutGit.startsWith("https://") || urlWithoutGit.startsWith("http://")) {
        // Accept HTTPS URLs without .git suffix
        return { isValid: true, url: urlWithoutGit };
    }

    if (urlWithoutGit.includes("@") && urlWithoutGit.includes(":")) {
        // Accept SSH URLs without .git suffix
        return { isValid: true, url: urlWithoutGit };
    }

    return {
        isValid: false,
        error: "Invalid Git URL format. Use HTTPS (https://...) or SSH (git@...)",
    };
}

/**
 * Fetch remote branches from a git repository URL
 */
async function fetchRemoteBranches(repoUrl: string): Promise<{ success: boolean; branches?: string[]; error?: string }> {
    try {
        const git: SimpleGit = simpleGit();
        const result = await git.listRemote(["--heads", repoUrl]);

        if (!result) {
            return { success: false, error: "No branches found" };
        }

        // Parse the output - format is: <hash>\trefs/heads/<branch>
        const branches = result
            .split("\n")
            .filter((line) => line.trim().length > 0)
            .map((line) => {
                const match = line.match(/refs\/heads\/(.+)$/);
                return match ? match[1] : null;
            })
            .filter((branch): branch is string => branch !== null);

        if (branches.length === 0) {
            return { success: false, error: "No branches found in repository" };
        }

        return { success: true, branches };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, error: errorMessage };
    }
}

/**
 * Clone a git repository to a local directory
 */
async function cloneRepository(
    repoUrl: string,
    branch: string,
    targetDir: string,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
): Promise<{ success: boolean; localPath?: string; error?: string }> {
    try {
        // Extract repo name from URL for the folder name
        const repoName = extractRepoName(repoUrl);
        const localPath = path.join(targetDir, repoName);

        progress.report({ message: `Cloning ${repoName}...` });

        const git: SimpleGit = simpleGit();
        await git.clone(repoUrl, localPath, ["--branch", branch, "--single-branch"]);

        progress.report({ message: "Clone complete" });

        return { success: true, localPath };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { success: false, error: errorMessage };
    }
}

/**
 * Extract repository name from URL
 */
function extractRepoName(url: string): string {
    // Handle SSH format: git@github.com:user/repo.git
    const sshMatch = url.match(/:([^/]+\/)?([^/]+?)(?:\.git)?$/);
    if (sshMatch) {
        return sshMatch[2] || "repository";
    }

    // Handle HTTPS format: https://github.com/user/repo.git
    const httpsMatch = url.match(/\/([^/]+?)(?:\.git)?$/);
    if (httpsMatch) {
        return httpsMatch[1] || "repository";
    }

    return "repository";
}

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

    // Check if already linked
    const existingLink = gitStatusService.getGitLinkInfo(node.connectionProfile, databaseName);
    if (existingLink) {
        const answer = await vscode.window.showWarningMessage(
            `Database "${databaseName}" is already linked to ${existingLink.gitRepoUrl} (${existingLink.branchName}). Do you want to re-link it?`,
            "Re-link",
            "Cancel",
        );
        if (answer !== "Re-link") {
            return;
        }
    }

    // Step 1: Prompt for Git repository URL
    const repoUrlInput = await vscode.window.showInputBox({
        prompt: "Enter Git repository URL (HTTPS or SSH)",
        placeHolder: "https://github.com/user/repo.git or git@github.com:user/repo.git",
        ignoreFocusOut: true,
        validateInput: (value: string) => {
            const validation = validateAndNormalizeGitUrl(value);
            return validation.isValid ? null : validation.error;
        },
    });

    if (!repoUrlInput) {
        return; // User cancelled
    }

    // Normalize the URL (strip "git clone " prefix if present)
    const urlValidation = validateAndNormalizeGitUrl(repoUrlInput);
    if (!urlValidation.isValid || !urlValidation.url) {
        void vscode.window.showErrorMessage(urlValidation.error || "Invalid Git URL");
        return;
    }
    const repoUrl = urlValidation.url;

    // Step 2: Fetch and select branch
    let selectedBranch: string | undefined;

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Fetching branches from repository...",
            cancellable: false,
        },
        async () => {
            const branchResult = await fetchRemoteBranches(repoUrl);

            if (branchResult.success && branchResult.branches && branchResult.branches.length > 0) {
                // Create quick pick items with main/master at the top
                const branchItems: vscode.QuickPickItem[] = branchResult.branches.map((branch) => ({
                    label: branch,
                    description: branch === "main" || branch === "master" ? "(default)" : undefined,
                }));

                // Sort to put main/master at the top
                branchItems.sort((a, b) => {
                    if (a.label === "main") return -1;
                    if (b.label === "main") return 1;
                    if (a.label === "master") return -1;
                    if (b.label === "master") return 1;
                    return a.label.localeCompare(b.label);
                });

                const picked = await vscode.window.showQuickPick(branchItems, {
                    placeHolder: "Select a branch",
                    ignoreFocusOut: true,
                    title: "Select Git Branch",
                });

                selectedBranch = picked?.label;
            } else {
                // Branch fetching failed - allow manual entry
                void vscode.window.showWarningMessage(
                    `Could not fetch branches: ${branchResult.error}. Please enter branch name manually.`,
                );

                selectedBranch = await vscode.window.showInputBox({
                    prompt: "Enter the git branch name",
                    value: "main",
                    ignoreFocusOut: true,
                    validateInput: (value) => {
                        if (!value || value.trim().length === 0) {
                            return "Branch name is required";
                        }
                        return undefined;
                    },
                });
            }
        },
    );

    if (!selectedBranch) {
        return; // User cancelled
    }

    // Step 3: Select local directory for cloning
    const defaultPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir();

    const folderUri = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: "Select Clone Location",
        title: "Select directory to clone the repository",
        defaultUri: vscode.Uri.file(defaultPath),
    });

    if (!folderUri || folderUri.length === 0) {
        return; // User cancelled
    }

    const targetDir = folderUri[0].fsPath;

    // Step 4: Clone the repository
    let clonedPath: string | undefined;

    const cloneSuccess = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Cloning repository (branch: ${selectedBranch})...`,
            cancellable: false,
        },
        async (progress) => {
            const cloneResult = await cloneRepository(repoUrl, selectedBranch!, targetDir, progress);

            if (!cloneResult.success) {
                void vscode.window.showErrorMessage(`Failed to clone repository: ${cloneResult.error}`);
                return false;
            }

            clonedPath = cloneResult.localPath;
            return true;
        },
    );

    if (!cloneSuccess || !clonedPath) {
        return;
    }

    // Step 5: Persist the association
    await gitStatusService.linkDatabaseToGit(
        node.connectionProfile,
        databaseName,
        repoUrl,
        clonedPath,
        selectedBranch,
    );

    // Step 6: Refresh Object Explorer to update context
    mssqlApi.objectExplorer.refresh(node);

    void vscode.window.showInformationMessage(
        `Database "${databaseName}" linked to ${selectedBranch} branch of ${repoUrl}`,
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

