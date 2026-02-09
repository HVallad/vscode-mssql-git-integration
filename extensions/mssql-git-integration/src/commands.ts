/*---------------------------------------------------------------------------------------------
 *  Command Registration
 *  Registers all git integration commands
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import type * as vscodeMssql from "vscode-mssql";
import { GitStatusService } from "./services/gitStatusService";
import { SqlComparisonClient, ServiceUnavailableError } from "./services/sqlComparisonClient";
import { CreateSubscriptionRequest, DatabaseConnectionInfo, SchemaDifference } from "./types";
import {
    showFolderConfigurationWizard,
} from "./ui/configurationWizard";
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
    comparisonClient?: SqlComparisonClient,
): void {
    // Link database to git branch
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "mssql-git.linkDatabaseToGitBranch",
            async (node: vscodeMssql.ITreeNodeInfo) => {
                await linkDatabaseToGitBranch(node, mssqlApi, gitStatusService, comparisonClient);
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
                    comparisonClient,
                );
            },
        ),
    );

    // Compare database to repo
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "mssql-git.compareDatabaseToRepo",
            async (node: vscodeMssql.ITreeNodeInfo) => {
                await compareDatabaseToRepo(node, gitStatusService, comparisonClient);
            },
        ),
    );

    // Refresh local cache
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "mssql-git.refreshLocalCache",
            async (node: vscodeMssql.ITreeNodeInfo) => {
                await refreshLocalCache(node, gitStatusService, comparisonClient);
            },
        ),
    );

    // View schema difference - shows diff between database and file
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "mssql-git.viewDiff",
            async (difference: SchemaDifference) => {
                await viewDifference(difference, comparisonClient);
            },
        ),
    );
}

async function linkDatabaseToGitBranch(
    node: vscodeMssql.ITreeNodeInfo,
    mssqlApi: vscodeMssql.IExtension,
    gitStatusService: GitStatusService,
    comparisonClient?: SqlComparisonClient,
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

    // Step 1: Ask user to choose between existing local repository or clone from remote
    const repositoryChoice = await vscode.window.showQuickPick(
        [
            {
                label: "$(folder) Use existing local repository",
                description: "Browse for an existing Git repository folder",
                value: "local",
            },
            {
                label: "$(cloud-download) Clone from remote repository",
                description: "Clone a repository from a URL",
                value: "clone",
            },
        ],
        {
            placeHolder: "Choose how to link to a Git repository",
            ignoreFocusOut: true,
            title: "Link Database to Git Repository",
        },
    );

    if (!repositoryChoice) {
        return; // User cancelled
    }

    if (repositoryChoice.value === "local") {
        // Use existing local repository
        await linkToExistingLocalRepository(node, mssqlApi, gitStatusService, databaseName, comparisonClient);
    } else {
        // Clone from remote repository
        await cloneAndLinkRepository(node, mssqlApi, gitStatusService, databaseName, comparisonClient);
    }
}

/**
 * Link database to an existing local Git repository
 */
async function linkToExistingLocalRepository(
    node: vscodeMssql.ITreeNodeInfo,
    mssqlApi: vscodeMssql.IExtension,
    gitStatusService: GitStatusService,
    databaseName: string,
    comparisonClient?: SqlComparisonClient,
): Promise<void> {
    // Step 1: Browse for existing Git repository folder
    const defaultPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir();

    const folderUri = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: "Select Repository",
        title: "Select existing Git repository folder",
        defaultUri: vscode.Uri.file(defaultPath),
    });

    if (!folderUri || folderUri.length === 0) {
        return; // User cancelled
    }

    const localRepoPath = folderUri[0].fsPath;

    // Step 2: Validate it's a Git repository and get current branch
    let currentBranch: string | undefined;
    let remoteUrl: string | undefined;

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Validating Git repository...",
            cancellable: false,
        },
        async () => {
            try {
                const git: SimpleGit = simpleGit(localRepoPath);

                // Check if it's a valid git repository
                const isRepo = await git.checkIsRepo();
                if (!isRepo) {
                    void vscode.window.showErrorMessage(
                        `The selected folder is not a Git repository: ${localRepoPath}`,
                    );
                    return;
                }

                // Get current branch
                const branchSummary = await git.branch();
                currentBranch = branchSummary.current;

                // Try to get remote origin URL
                try {
                    const remotes = await git.getRemotes(true);
                    const origin = remotes.find((r) => r.name === "origin");
                    remoteUrl = origin?.refs?.fetch || origin?.refs?.push;
                } catch {
                    // Remote URL is optional - local-only repos are fine
                    remoteUrl = undefined;
                }
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                void vscode.window.showErrorMessage(`Failed to read Git repository: ${errorMessage}`);
                currentBranch = undefined;
            }
        },
    );

    if (!currentBranch) {
        return; // Repository validation failed
    }

    // Step 3: Create subscription if comparison service is available
    let subscriptionId: string | undefined;
    if (comparisonClient) {
        subscriptionId = await createSubscriptionIfAvailable(
            node,
            databaseName,
            localRepoPath,
            comparisonClient,
        );
    }

    // Step 4: Persist the association (with subscription ID if created)
    await gitStatusService.linkDatabaseToGit(
        node.connectionProfile,
        databaseName,
        remoteUrl || `local:${localRepoPath}`,
        localRepoPath,
        currentBranch,
        subscriptionId,
    );

    // Step 5: Refresh Object Explorer to update context
    mssqlApi.objectExplorer.refresh(node);

    const repoDescription = remoteUrl ? `${currentBranch} branch of ${remoteUrl}` : `${currentBranch} branch (local)`;
    const serviceMessage = subscriptionId ? " Schema sync enabled." : "";
    void vscode.window.showInformationMessage(
        `Database "${databaseName}" linked to ${repoDescription}.${serviceMessage}`,
    );
}

/**
 * Clone a remote repository and link database to it
 */
async function cloneAndLinkRepository(
    node: vscodeMssql.ITreeNodeInfo,
    mssqlApi: vscodeMssql.IExtension,
    gitStatusService: GitStatusService,
    databaseName: string,
    comparisonClient?: SqlComparisonClient,
): Promise<void> {
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

    // Step 5: Create subscription if comparison service is available
    let subscriptionId: string | undefined;
    if (comparisonClient) {
        subscriptionId = await createSubscriptionIfAvailable(
            node,
            databaseName,
            clonedPath,
            comparisonClient,
        );
    }

    // Step 6: Persist the association (with subscription ID if created)
    await gitStatusService.linkDatabaseToGit(
        node.connectionProfile,
        databaseName,
        repoUrl,
        clonedPath,
        selectedBranch,
        subscriptionId,
    );

    // Step 7: Refresh Object Explorer to update context
    mssqlApi.objectExplorer.refresh(node);

    const serviceMessage = subscriptionId ? " Schema sync enabled." : "";
    void vscode.window.showInformationMessage(
        `Database "${databaseName}" linked to ${selectedBranch} branch of ${repoUrl}.${serviceMessage}`,
    );
}

async function unlinkDatabaseFromGitBranch(
    node: vscodeMssql.ITreeNodeInfo,
    mssqlApi: vscodeMssql.IExtension,
    gitStatusService: GitStatusService,
    comparisonClient?: SqlComparisonClient,
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

    // Get subscription ID before unlinking to delete it from comparison service
    const linkInfo = gitStatusService.getGitLinkInfo(node.connectionProfile, databaseName);
    const subscriptionId = linkInfo?.subscriptionId;

    // Delete subscription from comparison service if it exists
    if (subscriptionId && comparisonClient) {
        try {
            await comparisonClient.deleteSubscription(subscriptionId);
            console.log(`MSSQL Git: Deleted subscription ${subscriptionId} for database "${databaseName}"`);
        } catch (error) {
            // Log but don't fail - subscription might not exist or service might be unavailable
            console.warn(`MSSQL Git: Failed to delete subscription ${subscriptionId}: ${error}`);
        }
    }

    await gitStatusService.unlinkDatabaseFromGit(
        node.connectionProfile,
        databaseName,
    );

    console.log(`MSSQL Git: Unlinked database "${databaseName}". Refreshing Object Explorer...`);
    console.log(`MSSQL Git: Node id: ${(node as any).id}, nodeType: ${node.nodeType}`);

    // Clear the description directly on the node object before refreshing
    // This is necessary because VS Code may not re-call getTreeItem for nested nodes
    (node as any).description = undefined;

    // Refresh the specific database node to update the UI
    mssqlApi.objectExplorer.refresh(node);

    console.log(`MSSQL Git: Object Explorer refresh called for specific node`);

    vscode.window.showInformationMessage(
        `Database "${databaseName}" unlinked from git`,
    );
}

async function compareDatabaseToRepo(
    node: vscodeMssql.ITreeNodeInfo,
    gitStatusService: GitStatusService,
    _comparisonClient?: SqlComparisonClient,
): Promise<void> {
    const databaseName = node.metadata?.name || node.label?.toString() || "";

    // Get link info to find the local git path
    const linkInfo = gitStatusService.getGitLinkInfo(node.connectionProfile, databaseName);
    if (!linkInfo) {
        void vscode.window.showWarningMessage(
            `Database "${databaseName}" is not linked to a git repository.`,
        );
        return;
    }

    // Find the SQL project file in the local git path
    const localGitPath = linkInfo.localGitPath;
    if (!localGitPath) {
        void vscode.window.showWarningMessage(
            `No local git path configured for "${databaseName}".`,
        );
        return;
    }

    // Search for .sqlproj files in the local git path
    let sqlProjPath: string | undefined;
    try {
        const sqlProjFiles = await vscode.workspace.findFiles(
            new vscode.RelativePattern(localGitPath, "**/*.sqlproj"),
            "**/node_modules/**",
            10, // Limit to 10 results
        );

        if (sqlProjFiles.length === 0) {
            void vscode.window.showWarningMessage(
                `No SQL project (.sqlproj) found in "${localGitPath}". Please ensure the repository contains a SQL project.`,
            );
            return;
        } else if (sqlProjFiles.length === 1) {
            sqlProjPath = sqlProjFiles[0].fsPath;
        } else {
            // Multiple projects found - let user choose
            const items = sqlProjFiles.map((uri) => ({
                label: path.basename(uri.fsPath),
                description: uri.fsPath,
                uri: uri,
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: "Select the SQL project to compare against",
                title: "Multiple SQL Projects Found",
            });

            if (!selected) {
                return; // User cancelled
            }
            sqlProjPath = selected.uri.fsPath;
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Failed to find SQL project: ${errorMessage}`);
        return;
    }

    // Open the mssql Schema Compare with the database as source and SQL project as target
    // The mssql.schemaCompare command accepts:
    // - sourceNode: TreeNodeInfo (database node) or SchemaCompareEndpointInfo or string (path)
    // - targetNode: TreeNodeInfo or SchemaCompareEndpointInfo or string (path to .sqlproj or .dacpac)
    // - runComparison: boolean - whether to auto-run the comparison
    try {
        await vscode.commands.executeCommand(
            "mssql.schemaCompare",
            node,           // Source: database node
            sqlProjPath,    // Target: path to SQL project
            true,           // Auto-run comparison
        );
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Failed to open Schema Compare: ${errorMessage}`);
    }
}

async function refreshLocalCache(
    node: vscodeMssql.ITreeNodeInfo,
    gitStatusService: GitStatusService,
    comparisonClient?: SqlComparisonClient,
): Promise<void> {
    const databaseName = node.metadata?.name || node.label?.toString() || "";

    // Get link info to find subscription ID
    const linkInfo = gitStatusService.getGitLinkInfo(node.connectionProfile, databaseName);
    if (!linkInfo) {
        void vscode.window.showWarningMessage(
            `Database "${databaseName}" is not linked to a git repository.`,
        );
        return;
    }

    const subscriptionId = linkInfo.subscriptionId;
    if (!subscriptionId || !comparisonClient) {
        void vscode.window.showWarningMessage(
            `Schema sync is not enabled for "${databaseName}". SQL Comparison Service may not be available.`,
        );
        return;
    }

    // Invalidate cache via the service
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Refreshing cache for "${databaseName}"...`,
            cancellable: false,
        },
        async () => {
            try {
                await comparisonClient.invalidateCache(subscriptionId);
                void vscode.window.showInformationMessage(
                    `Cache refreshed for "${databaseName}".`,
                );
            } catch (error) {
                if (error instanceof ServiceUnavailableError) {
                    void vscode.window.showWarningMessage(
                        "SQL Comparison Service is not available. Please ensure the service is running.",
                    );
                } else {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    void vscode.window.showErrorMessage(`Failed to refresh cache: ${errorMessage}`);
                }
            }
        },
    );
}

/**
 * Helper function to create a subscription if the comparison service is available
 * Returns the subscription ID if successful, undefined otherwise
 */
async function createSubscriptionIfAvailable(
    node: vscodeMssql.ITreeNodeInfo,
    databaseName: string,
    localRepoPath: string,
    comparisonClient: SqlComparisonClient,
): Promise<string | undefined> {
    try {
        // Check if service is available
        await comparisonClient.ensureConnected();

        // Show folder configuration wizard
        const folderConfig = await showFolderConfigurationWizard(localRepoPath);
        if (folderConfig.cancelled || !folderConfig.config) {
            // User cancelled - continue without subscription
            return undefined;
        }

        // Build database connection info from the node's connection profile
        const connectionProfile = node.connectionProfile;

        // Map authentication type to service format (sql, windows, azure)
        let authType: 'sql' | 'windows' | 'azure' = 'sql';
        if (connectionProfile.authenticationType === 'Integrated') {
            authType = 'windows';
        } else if (connectionProfile.authenticationType === 'AzureMFA' ||
                   connectionProfile.authenticationType === 'AzureMFAAndUser') {
            authType = 'azure';
        }

        // For SQL authentication, prompt for password since it's not available from connection profile
        let password: string | undefined;
        if (authType === 'sql') {
            password = await vscode.window.showInputBox({
                prompt: `Enter password for SQL user "${connectionProfile.user}" on ${connectionProfile.server}`,
                password: true,
                ignoreFocusOut: true,
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return "Password is required for SQL authentication";
                    }
                    return undefined;
                },
            });

            if (!password) {
                // User cancelled - continue without subscription
                return undefined;
            }
        }

        const databaseConnection: DatabaseConnectionInfo = {
            server: connectionProfile.server || "",
            database: databaseName,
            authType: authType,
            username: connectionProfile.user,
            password: password,
            trustServerCertificate: true,
            connectionTimeoutSeconds: 30,
        };

        // Build subscription request using folder config
        // Note: Field names match the SQL Comparison Service API
        const folderCfg = folderConfig.config!;
        const subscriptionRequest: CreateSubscriptionRequest = {
            name: `${databaseName} - ${path.basename(localRepoPath)}`,
            database: databaseConnection,
            project: {
                path: folderCfg.folderPath,
                structure: folderCfg.structure,
                includePatterns: folderCfg.includePatterns,
                excludePatterns: folderCfg.excludePatterns,
            },
            options: {
                autoCompare: true,
                compareOnFileChange: true,
                compareOnDatabaseChange: true,
            },
        };

        // Create subscription
        const subscription = await comparisonClient.createSubscription(subscriptionRequest);
        console.log(`MSSQL Git: Created subscription ${subscription.id} for database "${databaseName}"`);

        return subscription.id;
    } catch (error) {
        if (error instanceof ServiceUnavailableError) {
            // Service not available - this is expected when service is not installed
            console.log("MSSQL Git: SQL Comparison Service not available, skipping subscription creation");
        } else {
            // Log other errors but don't fail the link operation
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.warn(`MSSQL Git: Failed to create subscription: ${errorMessage}`);
            void vscode.window.showWarningMessage(
                `Could not enable schema sync: ${errorMessage}. The database will be linked without real-time comparison.`,
            );
        }
        return undefined;
    }
}

/**
 * View the difference between database and file for a specific schema object
 * Opens VS Code's diff editor to show the database script vs file script
 */
async function viewDifference(
    difference: SchemaDifference,
    comparisonClient?: SqlComparisonClient,
): Promise<void> {
    if (!comparisonClient) {
        void vscode.window.showErrorMessage("SQL Comparison Service is not available.");
        return;
    }

    // We need both comparisonId and difference id to fetch the full details
    // The difference object from the tree view should have both
    if (!difference.id) {
        void vscode.window.showErrorMessage("Difference ID is not available.");
        return;
    }

    // If we don't have comparisonId, try to get it from the difference or show error
    if (!difference.comparisonId) {
        void vscode.window.showErrorMessage(
            "Comparison ID is not available. Please refresh the Schema Sync view."
        );
        return;
    }

    try {
        // Show progress while fetching difference details
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Loading difference: ${difference.objectName}...`,
                cancellable: false,
            },
            async () => {
                // Fetch full difference details including scripts
                const details = await comparisonClient.getDifferenceDetails(
                    difference.comparisonId!,
                    difference.id
                );

                // Create virtual documents for the diff view using the existing sql-compare scheme
                const databaseScript = details.databaseScript || "-- No database script available";
                const fileScript = details.fileScript || "-- No file script available";

                // Create URIs for the virtual documents
                // Use unique path to avoid cache issues
                const timestamp = Date.now();
                const databaseUri = vscode.Uri.parse(
                    `sql-compare:/${details.comparisonId}/database/${encodeURIComponent(details.objectName)}.sql?t=${timestamp}`
                );
                const fileUri = vscode.Uri.parse(
                    `sql-compare:/${details.comparisonId}/file/${encodeURIComponent(details.objectName)}.sql?t=${timestamp}`
                );

                // Store the content in the shared cache
                sqlCompareContentCache.set(databaseUri.toString(), databaseScript);
                sqlCompareContentCache.set(fileUri.toString(), fileScript);

                // Open the diff editor
                const title = `${details.objectName} (Database ↔ File)`;
                await vscode.commands.executeCommand(
                    "vscode.diff",
                    databaseUri,
                    fileUri,
                    title
                );
            }
        );
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Failed to load difference: ${errorMessage}`);
    }
}

/**
 * Shared cache for sql-compare content provider
 * This is used by both commands.ts and diffViewer.ts
 */
export const sqlCompareContentCache = new Map<string, string>();
