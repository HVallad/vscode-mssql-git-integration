/*---------------------------------------------------------------------------------------------
 *  Command Registration
 *  Registers all git integration commands
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";
import * as glob from "fast-glob";
import type * as vscodeMssql from "vscode-mssql";
import { ScriptOperation } from "vscode-mssql";
import { GitStatusService, GitLinkInfo } from "./services/gitStatusService";
import { SchemaComparisonService, ObjectSyncStatus, DatabaseSyncSummary } from "./services/schemaComparisonService";
import { SyncMetadataService } from "./services/syncMetadataService";
import { SyncStatusCache } from "./services/syncStatusCache";
import { GitSyncDecorationProvider } from "./services/gitSyncDecorationProvider";
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

// Shared service instances
let schemaComparisonService: SchemaComparisonService;
let syncStatusCacheInstance: SyncStatusCache | undefined;
let gitDecorationProviderInstance: GitSyncDecorationProvider | undefined;

/**
 * Register all extension commands
 */
export function registerCommands(
    context: vscode.ExtensionContext,
    mssqlApi: vscodeMssql.IExtension,
    gitStatusService: GitStatusService,
    syncStatusCache?: SyncStatusCache,
    gitDecorationProvider?: GitSyncDecorationProvider,
): void {
    // Initialize shared services
    schemaComparisonService = new SchemaComparisonService();
    syncStatusCacheInstance = syncStatusCache;
    gitDecorationProviderInstance = gitDecorationProvider;

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

    // Compare database to repo (fast timestamp-based)
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "mssql-git.compareDatabaseToRepo",
            async (node: vscodeMssql.ITreeNodeInfo) => {
                await compareDatabaseToRepo(node, mssqlApi, gitStatusService);
            },
        ),
    );

    // Deep compare database to repo (thorough hash-based)
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "mssql-git.deepCompareDatabaseToRepo",
            async (node: vscodeMssql.ITreeNodeInfo) => {
                await deepCompareDatabaseToRepo(node, mssqlApi, gitStatusService);
            },
        ),
    );

    // Reinitialize sync metadata
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "mssql-git.reinitializeSyncMetadata",
            async (node: vscodeMssql.ITreeNodeInfo) => {
                await reinitializeSyncMetadata(node, mssqlApi, gitStatusService);
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

    // Compare database and launch Schema Compare directly
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "mssql-git.compareDatabaseAndLaunchSchemaCompare",
            async (node: vscodeMssql.ITreeNodeInfo) => {
                await compareDatabaseAndLaunchSchemaCompare(node, mssqlApi, gitStatusService);
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
        await linkToExistingLocalRepository(node, mssqlApi, gitStatusService, databaseName);
    } else {
        // Clone from remote repository
        await cloneAndLinkRepository(node, mssqlApi, gitStatusService, databaseName);
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

    // Step 3: Persist the association
    await gitStatusService.linkDatabaseToGit(
        node.connectionProfile,
        databaseName,
        remoteUrl || `local:${localRepoPath}`,
        localRepoPath,
        currentBranch,
    );

    // Step 4: Refresh Object Explorer to update context
    mssqlApi.objectExplorer.refresh(node);

    const repoDescription = remoteUrl ? `${currentBranch} branch of ${remoteUrl}` : `${currentBranch} branch (local)`;
    void vscode.window.showInformationMessage(
        `Database "${databaseName}" linked to ${repoDescription}`,
    );

    // Step 5: Offer to initialize metadata
    const initMetadata = await vscode.window.showInformationMessage(
        "Would you like to initialize sync metadata now? This captures the current database state for comparison.",
        "Initialize",
        "Skip",
    );

    if (initMetadata === "Initialize") {
        await initializeMetadataForDatabase(node, mssqlApi, {
            serverId: node.connectionProfile.server || "",
            databaseName,
            localGitPath: localRepoPath,
        });
    }
}

/**
 * Clone a remote repository and link database to it
 */
async function cloneAndLinkRepository(
    node: vscodeMssql.ITreeNodeInfo,
    mssqlApi: vscodeMssql.IExtension,
    gitStatusService: GitStatusService,
    databaseName: string,
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

    // Step 7: Offer to initialize metadata
    const initMetadata = await vscode.window.showInformationMessage(
        "Would you like to initialize sync metadata now? This captures the current database state for comparison.",
        "Initialize",
        "Skip",
    );

    if (initMetadata === "Initialize") {
        await initializeMetadataForDatabase(node, mssqlApi, {
            serverId: node.connectionProfile.server || "",
            databaseName,
            localGitPath: clonedPath,
        });
    }
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
    mssqlApi: vscodeMssql.IExtension,
    gitStatusService: GitStatusService,
): Promise<void> {
    const databaseName = node.metadata?.name || node.label?.toString() || "";

    // Get git link info
    const linkInfo = gitStatusService.getGitLinkInfo(node.connectionProfile, databaseName);
    if (!linkInfo) {
        vscode.window.showErrorMessage(
            `Database "${databaseName}" is not linked to a git repository. Link it first.`,
        );
        return;
    }

    // Check if metadata file exists
    const syncMetadataService = schemaComparisonService.getSyncMetadataService();
    const metadataExists = await syncMetadataService.metadataExists(linkInfo.localGitPath);

    if (!metadataExists) {
        const initChoice = await vscode.window.showWarningMessage(
            `No sync metadata found for "${databaseName}". Would you like to initialize it now?`,
            "Initialize",
            "Cancel",
        );

        if (initChoice !== "Initialize") {
            return;
        }

        // Initialize metadata
        await initializeMetadataForDatabase(node, mssqlApi, linkInfo);
    }

    // Perform comparison
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Comparing "${databaseName}" to repository...`,
            cancellable: false,
        },
        async (progress) => {
            try {
                progress.report({ message: "Connecting to database..." });

                // Get a connection to the database using mssqlApi.connect with connection info
                // Clone the connection info and ensure database is set
                const connectionInfo = { ...node.connectionProfile, database: databaseName };
                const connectionUri = await mssqlApi.connect(connectionInfo, false);

                if (!connectionUri) {
                    void vscode.window.showErrorMessage("Failed to connect to database");
                    return;
                }

                progress.report({ message: "Querying database objects..." });

                // Perform comparison
                const summary = await schemaComparisonService.compareWithMetadata(
                    mssqlApi,
                    connectionUri,
                    linkInfo.localGitPath,
                );

                // Disconnect
                mssqlApi.connectionSharing.disconnect(connectionUri);

                // Update sync status cache and decorations
                const serverName = node.connectionProfile?.server || "";
                updateSyncStatusCacheAndDecorations(serverName, databaseName, summary, mssqlApi);

                // Display results
                await displayComparisonResults(node, databaseName, linkInfo.branchName, summary, linkInfo, mssqlApi);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                void vscode.window.showErrorMessage(`Comparison failed: ${errorMessage}`);
            }
        },
    );
}

/**
 * Compare database to repository and directly launch Schema Compare
 * This is a one-click workflow that skips the QuickPick results dialog
 */
async function compareDatabaseAndLaunchSchemaCompare(
    node: vscodeMssql.ITreeNodeInfo,
    mssqlApi: vscodeMssql.IExtension,
    gitStatusService: GitStatusService,
): Promise<void> {
    const databaseName = node.metadata?.name || node.label?.toString() || "";

    // Get git link info
    const linkInfo = gitStatusService.getGitLinkInfo(node.connectionProfile, databaseName);
    if (!linkInfo) {
        vscode.window.showErrorMessage(
            `Database "${databaseName}" is not linked to a git repository. Link it first.`,
        );
        return;
    }

    // Check if metadata file exists
    const syncMetadataService = schemaComparisonService.getSyncMetadataService();
    const metadataExists = await syncMetadataService.metadataExists(linkInfo.localGitPath);

    if (!metadataExists) {
        const initChoice = await vscode.window.showWarningMessage(
            `No sync metadata found for "${databaseName}". Would you like to initialize it now?`,
            "Initialize",
            "Cancel",
        );

        if (initChoice !== "Initialize") {
            return;
        }

        // Initialize metadata
        await initializeMetadataForDatabase(node, mssqlApi, linkInfo);
    }

    // Perform comparison and launch Schema Compare
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Comparing "${databaseName}" and launching Schema Compare...`,
            cancellable: false,
        },
        async (progress) => {
            try {
                progress.report({ message: "Connecting to database..." });

                // Get a connection to the database using mssqlApi.connect with connection info
                const connectionInfo = { ...node.connectionProfile, database: databaseName };
                const connectionUri = await mssqlApi.connect(connectionInfo, false);

                if (!connectionUri) {
                    void vscode.window.showErrorMessage("Failed to connect to database");
                    return;
                }

                progress.report({ message: "Querying database objects..." });

                // Perform comparison
                const summary = await schemaComparisonService.compareWithMetadata(
                    mssqlApi,
                    connectionUri,
                    linkInfo.localGitPath,
                );

                // Disconnect
                mssqlApi.connectionSharing.disconnect(connectionUri);

                // Update sync status cache and decorations
                const serverName = node.connectionProfile?.server || "";
                updateSyncStatusCacheAndDecorations(serverName, databaseName, summary, mssqlApi);

                // Check if there are any changed objects
                const hasChangedObjects = summary.objects.some(obj =>
                    obj.status !== ObjectSyncStatus.InSync && obj.status !== ObjectSyncStatus.Unknown
                );

                if (!hasChangedObjects) {
                    void vscode.window.showInformationMessage(
                        `All objects are in sync between "${databaseName}" and the repository. No Schema Compare needed.`,
                    );
                    return;
                }

                // Launch Schema Compare directly (skip the QuickPick dialog)
                progress.report({ message: "Launching Schema Compare..." });
                await launchFilteredSchemaCompare(node, linkInfo, summary, mssqlApi);

            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                void vscode.window.showErrorMessage(`Comparison failed: ${errorMessage}`);
            }
        },
    );
}

/**
 * Deep compare database to repository (thorough hash-based comparison)
 * This uses content hashes to detect actual differences and updates metadata
 */
async function deepCompareDatabaseToRepo(
    node: vscodeMssql.ITreeNodeInfo,
    mssqlApi: vscodeMssql.IExtension,
    gitStatusService: GitStatusService,
): Promise<void> {
    const databaseName = node.metadata?.name || node.label?.toString() || "";

    // Get git link info
    const linkInfo = gitStatusService.getGitLinkInfo(node.connectionProfile, databaseName);
    if (!linkInfo) {
        vscode.window.showErrorMessage(
            `Database "${databaseName}" is not linked to a git repository. Link it first.`,
        );
        return;
    }

    // Check if metadata file exists
    const syncMetadataService = schemaComparisonService.getSyncMetadataService();
    const metadataExists = await syncMetadataService.metadataExists(linkInfo.localGitPath);

    if (!metadataExists) {
        const initChoice = await vscode.window.showWarningMessage(
            `No sync metadata found for "${databaseName}". Would you like to initialize it now?`,
            "Initialize",
            "Cancel",
        );

        if (initChoice !== "Initialize") {
            return;
        }

        // Initialize metadata (already uses hashes)
        await initializeMetadataForDatabase(node, mssqlApi, linkInfo);
        return; // After initialization, metadata is up to date
    }

    // Perform deep comparison
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Deep comparing "${databaseName}" to repository...`,
            cancellable: false,
        },
        async (progress) => {
            try {
                progress.report({ message: "Connecting to database..." });

                // Get a connection to the database
                const connectionInfo = { ...node.connectionProfile, database: databaseName };
                const connectionUri = await mssqlApi.connect(connectionInfo, false);

                if (!connectionUri) {
                    void vscode.window.showErrorMessage("Failed to connect to database");
                    return;
                }

                progress.report({ message: "Computing content hashes (this may take a moment)..." });

                // Perform deep comparison with hashes
                const summary = await schemaComparisonService.deepCompareWithMetadata(
                    mssqlApi,
                    connectionUri,
                    linkInfo.localGitPath,
                );

                progress.report({ message: "Updating metadata..." });

                // Get fresh objects with hashes to update metadata
                const dbObjects = await schemaComparisonService.getObjectsForMetadataUpdate(
                    mssqlApi,
                    connectionUri,
                );

                // Update metadata with new hashes and timestamps
                const metadata = await syncMetadataService.loadMetadata(linkInfo.localGitPath);
                if (metadata) {
                    const now = new Date().toISOString();
                    for (const obj of dbObjects) {
                        const key = SyncMetadataService.getObjectKey(obj.schema, obj.name);
                        metadata.objects[key] = {
                            type: obj.objectType,
                            dbModifyDate: obj.effectiveModifyDate,
                            dbCreateDate: obj.createDate,
                            relativePath: getRelativePathForObject(obj.objectType, obj.schema, obj.name),
                            lastSyncedAt: now,
                            contentHash: obj.contentHash,
                        };
                    }
                    metadata.lastSyncedAt = now;
                    await syncMetadataService.saveMetadata(linkInfo.localGitPath, metadata);
                }

                // Disconnect
                mssqlApi.connectionSharing.disconnect(connectionUri);

                // Update sync status cache and decorations
                const serverName = node.connectionProfile?.server || "";
                updateSyncStatusCacheAndDecorations(serverName, databaseName, summary, mssqlApi);

                // Display results with deep comparison indicator
                await displayComparisonResults(node, databaseName, linkInfo.branchName, summary, linkInfo, mssqlApi);

                void vscode.window.showInformationMessage(
                    `Deep comparison complete. Metadata updated with ${dbObjects.length} object hashes.`,
                );
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                void vscode.window.showErrorMessage(`Deep comparison failed: ${errorMessage}`);
            }
        },
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

/**
 * Reinitialize sync metadata for a database
 * This forces a fresh capture of the current database state
 */
async function reinitializeSyncMetadata(
    node: vscodeMssql.ITreeNodeInfo,
    mssqlApi: vscodeMssql.IExtension,
    gitStatusService: GitStatusService,
): Promise<void> {
    const databaseName = node.metadata?.name || node.label?.toString() || "";

    // Get git link info
    const linkInfo = gitStatusService.getGitLinkInfo(node.connectionProfile, databaseName);
    if (!linkInfo) {
        vscode.window.showErrorMessage(
            `Database "${databaseName}" is not linked to a git repository. Link it first.`,
        );
        return;
    }

    // Check if metadata already exists
    const syncMetadataService = schemaComparisonService.getSyncMetadataService();
    const metadataExists = await syncMetadataService.metadataExists(linkInfo.localGitPath);

    if (metadataExists) {
        const confirm = await vscode.window.showWarningMessage(
            `Sync metadata already exists for "${databaseName}". This will overwrite the existing metadata with the current database state. Continue?`,
            { modal: true },
            "Reinitialize",
            "Cancel",
        );

        if (confirm !== "Reinitialize") {
            return;
        }
    }

    // Initialize (or reinitialize) metadata
    const success = await initializeMetadataForDatabase(node, mssqlApi, {
        serverId: node.connectionProfile.server || "",
        databaseName,
        localGitPath: linkInfo.localGitPath,
    });

    if (success) {
        void vscode.window.showInformationMessage(
            `Sync metadata ${metadataExists ? "reinitialized" : "initialized"} for "${databaseName}". The current database state is now the baseline for comparisons.`,
        );
    }
}

/**
 * Initialize sync metadata for a database
 */
async function initializeMetadataForDatabase(
    node: vscodeMssql.ITreeNodeInfo,
    mssqlApi: vscodeMssql.IExtension,
    linkInfo: { serverId: string; databaseName: string; localGitPath: string },
): Promise<boolean> {
    return await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Initializing sync metadata for "${linkInfo.databaseName}"...`,
            cancellable: false,
        },
        async (progress) => {
            try {
                progress.report({ message: "Connecting to database..." });

                // Get a connection to the database using mssqlApi.connect with connection info
                // Clone the connection info and ensure database is set
                const connectionInfo = { ...node.connectionProfile, database: linkInfo.databaseName };
                const connectionUri = await mssqlApi.connect(connectionInfo, false);

                progress.report({ message: "Querying database objects with hashes..." });

                // Get database objects with timestamps AND content hashes
                // This ensures we have a complete baseline for both fast and deep comparisons
                const dbObjects = await schemaComparisonService.getDatabaseObjectsWithHashes(
                    mssqlApi,
                    connectionUri,
                );

                progress.report({ message: "Creating metadata file..." });

                // Initialize metadata
                const syncMetadataService = schemaComparisonService.getSyncMetadataService();
                const metadata = await syncMetadataService.initializeMetadata(
                    linkInfo.localGitPath,
                    linkInfo.serverId,
                    linkInfo.databaseName,
                );

                // Add all objects to metadata including content hashes
                const now = new Date().toISOString();
                for (const obj of dbObjects) {
                    const key = SyncMetadataService.getObjectKey(obj.schema, obj.name);
                    metadata.objects[key] = {
                        type: obj.objectType,
                        dbModifyDate: obj.effectiveModifyDate,
                        dbCreateDate: obj.createDate,
                        relativePath: getRelativePathForObject(obj.objectType, obj.schema, obj.name),
                        lastSyncedAt: now,
                        contentHash: obj.contentHash, // Store content hash from HASHBYTES
                    };
                }

                // Save updated metadata
                await syncMetadataService.saveMetadata(linkInfo.localGitPath, metadata);

                // Disconnect
                mssqlApi.connectionSharing.disconnect(connectionUri);

                void vscode.window.showInformationMessage(
                    `Sync metadata initialized with ${dbObjects.length} objects (including content hashes)`,
                );

                return true;
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                void vscode.window.showErrorMessage(`Failed to initialize metadata: ${errorMessage}`);
                return false;
            }
        },
    );
}

/**
 * Get the relative path for an object in a SQL Database Project
 */
function getRelativePathForObject(objectType: string, schema: string, name: string): string {
    // Map SQL Server type descriptions to folder names
    const folderMap: Record<string, string> = {
        USER_TABLE: "Tables",
        VIEW: "Views",
        SQL_STORED_PROCEDURE: "Stored Procedures",
        SQL_SCALAR_FUNCTION: "Functions",
        SQL_INLINE_TABLE_VALUED_FUNCTION: "Functions",
        SQL_TABLE_VALUED_FUNCTION: "Functions",
    };

    const folder = folderMap[objectType] || "Other";
    return path.join(folder, `${schema}.${name}.sql`);
}

/**
 * Find .sqlproj files in the linked git repository folder
 * @param gitRepoPath Path to the git repository folder
 * @returns Array of .sqlproj file paths found
 */
async function findSqlProjectFiles(gitRepoPath: string): Promise<string[]> {
    try {
        // Use forward slashes for glob to work correctly
        const escapedPath = glob.escapePath(gitRepoPath.replace(/\\/g, '/'));
        const sqlprojFilter = path.posix.join(escapedPath, '**', '*.sqlproj');
        const results = await glob.glob(sqlprojFilter);
        return results;
    } catch (error) {
        console.error('MSSQL Git: Error finding .sqlproj files:', error);
        return [];
    }
}

/**
 * Build a list of SQL script file paths for changed objects
 * Only includes paths for files that actually exist in the project
 * @param changedObjects Array of changed objects from the comparison
 * @param allProjectFiles Array of all SQL files in the project (from findSqlScriptFiles)
 * @returns Array of full file paths to the changed object scripts that exist
 */
function buildFilteredScriptPaths(
    changedObjects: import("./services/schemaComparisonService").ObjectSyncInfo[],
    allProjectFiles: string[],
): string[] {
    const scriptPaths: string[] = [];

    // Normalize all project files for matching (lowercase for case-insensitive comparison)
    const normalizedFiles = new Map<string, string>();
    for (const file of allProjectFiles) {
        // Extract just the filename for matching
        const fileName = path.basename(file).toLowerCase();
        normalizedFiles.set(fileName, file);
    }

    for (const obj of changedObjects) {
        // Objects that are "AddedInDatabase" won't have files in the project - skip them
        if (obj.status === ObjectSyncStatus.AddedInDatabase) {
            console.log(`[mssql-git] Skipping ${obj.schema}.${obj.name} - added in database only`);
            continue;
        }

        // Try to find the actual file in the project
        const expectedFileName = `${obj.schema}.${obj.name}.sql`.toLowerCase();

        // Look for exact match in our normalized files map
        const actualFile = normalizedFiles.get(expectedFileName);
        if (actualFile) {
            console.log(`[mssql-git] Found file for ${obj.schema}.${obj.name}: ${actualFile}`);
            scriptPaths.push(actualFile);
        } else {
            // Try alternative: search for file containing just the object name
            const altFileName = `${obj.name}.sql`.toLowerCase();
            const altFile = normalizedFiles.get(altFileName);
            if (altFile) {
                console.log(`[mssql-git] Found alt file for ${obj.schema}.${obj.name}: ${altFile}`);
                scriptPaths.push(altFile);
            } else {
                // If file still not found, the object might be new in DB or file structure is different
                // Don't add a non-existent path - Schema Compare will fail
                console.log(`[mssql-git] No file found for ${obj.schema}.${obj.name} (expected: ${expectedFileName})`);
            }
        }
    }

    return scriptPaths;
}

/**
 * Map object type to the folder name used in SQL projects
 */
function getObjectFolderName(objectType: string): string {
    const folderMap: Record<string, string> = {
        "U": "Tables",
        "V": "Views",
        "P": "Stored Procedures",
        "FN": "Functions",
        "IF": "Functions",
        "TF": "Functions",
        "USER_TABLE": "Tables",
        "VIEW": "Views",
        "SQL_STORED_PROCEDURE": "Stored Procedures",
        "SQL_SCALAR_FUNCTION": "Functions",
        "SQL_INLINE_TABLE_VALUED_FUNCTION": "Functions",
        "SQL_TABLE_VALUED_FUNCTION": "Functions",
    };
    return folderMap[objectType] || "Other";
}

/**
 * Map object type to the scripting type name expected by the scripting service
 */
function getScriptingTypeName(objectType: string): string {
    const typeMap: Record<string, string> = {
        "U": "Table",
        "V": "View",
        "P": "StoredProcedure",
        "FN": "UserDefinedFunction",
        "IF": "UserDefinedFunction",
        "TF": "UserDefinedFunction",
        "USER_TABLE": "Table",
        "VIEW": "View",
        "SQL_STORED_PROCEDURE": "StoredProcedure",
        "SQL_SCALAR_FUNCTION": "UserDefinedFunction",
        "SQL_INLINE_TABLE_VALUED_FUNCTION": "UserDefinedFunction",
        "SQL_TABLE_VALUED_FUNCTION": "UserDefinedFunction",
    };
    return typeMap[objectType] || "Table";
}

/**
 * Create a temporary SQL project with scripted objects from the database
 * @param connectionUri The connection URI for the database
 * @param mssqlApi The mssql extension API
 * @param changedObjects Array of changed objects to script
 * @param databaseName Database name for the project
 * @returns Path to the temporary .sqlproj file, or undefined if failed
 */
async function createTempProjectWithScriptedObjects(
    connectionUri: string,
    mssqlApi: vscodeMssql.IExtension,
    changedObjects: import("./services/schemaComparisonService").ObjectSyncInfo[],
    databaseName: string,
): Promise<{ projectPath: string; cleanup: () => Promise<void> } | undefined> {
    // Create a temporary directory for the scripted project
    const tempDir = path.join(os.tmpdir(), `mssql-git-temp-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    const scriptedFiles: string[] = [];
    const connectionSharing = mssqlApi.connectionSharing;

    try {
        // Script each changed object from the database
        for (const obj of changedObjects) {
            // Only script objects that exist in the database (not added in project only)
            if (obj.status === ObjectSyncStatus.AddedInProject) {
                continue;
            }

            const scriptingObject: vscodeMssql.IScriptingObject = {
                type: getScriptingTypeName(obj.objectType),
                schema: obj.schema,
                name: obj.name,
            };

            try {
                const script = await connectionSharing.scriptObject(
                    connectionUri,
                    ScriptOperation.Create,
                    scriptingObject,
                );

                if (script) {
                    // Create folder structure
                    const folder = getObjectFolderName(obj.objectType);
                    const folderPath = path.join(tempDir, folder);
                    await fs.mkdir(folderPath, { recursive: true });

                    // Write the script file
                    const fileName = `${obj.schema}.${obj.name}.sql`;
                    const filePath = path.join(folderPath, fileName);
                    await fs.writeFile(filePath, script, "utf-8");

                    // Track relative path for .sqlproj
                    scriptedFiles.push(path.join(folder, fileName));
                }
            } catch (scriptError) {
                console.warn(`[mssql-git] Failed to script ${obj.schema}.${obj.name}:`, scriptError);
                // Continue with other objects
            }
        }

        if (scriptedFiles.length === 0) {
            // No objects could be scripted
            await fs.rm(tempDir, { recursive: true, force: true });
            return undefined;
        }

        // Generate a minimal .sqlproj file
        const projectGuid = generateGuid();
        const buildIncludes = scriptedFiles
            .map(f => `    <Build Include="${f.replace(/\\/g, "/")}" />`)
            .join("\n");

        const sqlprojContent = `<?xml version="1.0" encoding="utf-8"?>
<Project DefaultTargets="Build">
  <Sdk Name="Microsoft.Build.Sql" Version="2.0.0" />
  <PropertyGroup>
    <Name>TempScriptedProject_${databaseName}</Name>
    <ProjectGuid>{${projectGuid}}</ProjectGuid>
    <DSP>Microsoft.Data.Tools.Schema.Sql.Sql150DatabaseSchemaProvider</DSP>
    <ModelCollation>1033, CI</ModelCollation>
  </PropertyGroup>
  <Target Name="BeforeBuild">
    <Delete Files="$(BaseIntermediateOutputPath)\\project.assets.json" />
  </Target>
  <ItemGroup>
${buildIncludes}
  </ItemGroup>
</Project>`;

        const projectFilePath = path.join(tempDir, "TempScriptedProject.sqlproj");
        await fs.writeFile(projectFilePath, sqlprojContent, "utf-8");

        console.log(`[mssql-git] Created temp project at ${projectFilePath} with ${scriptedFiles.length} scripted files`);

        // Return project path and cleanup function
        return {
            projectPath: projectFilePath,
            cleanup: async () => {
                try {
                    await fs.rm(tempDir, { recursive: true, force: true });
                    console.log(`[mssql-git] Cleaned up temp project at ${tempDir}`);
                } catch (cleanupError) {
                    console.warn(`[mssql-git] Failed to cleanup temp project:`, cleanupError);
                }
            },
        };
    } catch (error) {
        // Clean up on error
        await fs.rm(tempDir, { recursive: true, force: true });
        throw error;
    }
}

/**
 * Generate a random GUID
 */
function generateGuid(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * Launch Schema Compare with Project → Project comparison for faster performance.
 * This scripts only the changed objects from the database (avoiding full DB extraction)
 * and compares them against the target project.
 * @param node The database node
 * @param linkInfo Git link information
 * @param summary Database sync summary with changed objects
 * @param mssqlApi The mssql extension API
 */
async function launchFilteredSchemaCompare(
    node: vscodeMssql.ITreeNodeInfo,
    linkInfo: GitLinkInfo,
    summary: DatabaseSyncSummary,
    mssqlApi: vscodeMssql.IExtension,
): Promise<void> {
    const databaseName = node.metadata?.name || node.label?.toString() || "";

    // Find .sqlproj files in the git repo
    const sqlprojFiles = await findSqlProjectFiles(linkInfo.localGitPath);

    if (sqlprojFiles.length === 0) {
        void vscode.window.showErrorMessage(
            'No .sqlproj file found in the linked git repository. Schema Compare requires a SQL Database Project.',
        );
        return;
    }

    // If multiple .sqlproj files, let user choose
    let selectedProject: string;
    if (sqlprojFiles.length === 1) {
        selectedProject = sqlprojFiles[0];
    } else {
        const items: vscode.QuickPickItem[] = sqlprojFiles.map(f => ({
            label: path.basename(f),
            description: path.dirname(f),
            detail: f,
        }));

        const selected = await vscode.window.showQuickPick(items, {
            title: 'Select SQL Database Project',
            placeHolder: 'Multiple projects found. Select one to compare:',
        });

        if (!selected) {
            return; // User cancelled
        }
        selectedProject = selected.detail!;
    }

    // Get changed objects (modified, added in DB, or added in project)
    const changedObjects = summary.objects.filter(obj =>
        obj.status !== ObjectSyncStatus.InSync && obj.status !== ObjectSyncStatus.Unknown
    );

    if (changedObjects.length === 0) {
        void vscode.window.showInformationMessage(
            'All objects are in sync. No Schema Compare needed.',
        );
        return;
    }

    console.log(`[mssql-git] Schema Compare: ${changedObjects.length} changed objects to compare`);

    // Show progress while scripting and launching
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Preparing Schema Compare...',
            cancellable: false,
        },
        async (progress) => {
            let tempProject: { projectPath: string; cleanup: () => Promise<void> } | undefined;

            try {
                // Connect to database for scripting
                progress.report({ message: "Connecting to database..." });
                const connectionInfo = { ...node.connectionProfile, database: databaseName };
                const connectionUri = await mssqlApi.connect(connectionInfo, false);

                if (!connectionUri) {
                    void vscode.window.showErrorMessage("Failed to connect to database");
                    return;
                }

                try {
                    // Create temp project with scripted objects
                    progress.report({ message: `Scripting ${changedObjects.length} object(s)...` });
                    tempProject = await createTempProjectWithScriptedObjects(
                        connectionUri,
                        mssqlApi,
                        changedObjects,
                        databaseName,
                    );
                } finally {
                    // Always disconnect after scripting
                    mssqlApi.connectionSharing.disconnect(connectionUri);
                }

                if (!tempProject) {
                    void vscode.window.showWarningMessage(
                        'Could not script any objects from the database. Falling back to standard Schema Compare.',
                    );
                    // Fall back to standard Schema Compare with database
                    await vscode.commands.executeCommand(
                        'mssql.schemaCompare',
                        node,
                        selectedProject,
                        true,
                    );
                    return;
                }

                // Build source endpoint (temp scripted project)
                const projectFolderPath = path.dirname(tempProject.projectPath);
                const tempScriptPaths = await findSqlScriptFiles(projectFolderPath);

                const sourceEndpointInfo = {
                    endpointType: 2, // SchemaCompareEndpointType.Project
                    projectFilePath: tempProject.projectPath,
                    targetScripts: tempScriptPaths,
                    extractTarget: 5, // ExtractTarget.schemaObjectType
                    dataSchemaProvider: "Microsoft.Data.Tools.Schema.Sql.Sql150DatabaseSchemaProvider",
                    serverDisplayName: "",
                    serverName: "",
                    databaseName: "",
                    ownerUri: "",
                    packageFilePath: "",
                    connectionDetails: undefined,
                };

                // Build target endpoint (real project with filtered scripts)
                const targetFolderPath = path.dirname(selectedProject);
                const allTargetScripts = await findSqlScriptFiles(targetFolderPath);
                const filteredScriptPaths = buildFilteredScriptPaths(changedObjects, allTargetScripts);

                const targetEndpointInfo = {
                    endpointType: 2, // SchemaCompareEndpointType.Project
                    projectFilePath: selectedProject,
                    targetScripts: filteredScriptPaths,
                    extractTarget: 5, // ExtractTarget.schemaObjectType
                    dataSchemaProvider: "", // Will be resolved by Schema Compare
                    serverDisplayName: "",
                    serverName: "",
                    databaseName: "",
                    ownerUri: "",
                    packageFilePath: "",
                    connectionDetails: undefined,
                };

                console.log(`[mssql-git] Source (temp): ${tempProject.projectPath} with ${tempScriptPaths.length} scripts`);
                console.log(`[mssql-git] Target (real): ${selectedProject} with ${filteredScriptPaths.length} scripts`);

                // Launch Schema Compare with Project → Project
                progress.report({ message: "Launching Schema Compare..." });
                await vscode.commands.executeCommand(
                    'mssql.schemaCompare',
                    sourceEndpointInfo, // Source: temp scripted project
                    targetEndpointInfo, // Target: real project with filtered scripts
                    true, // Auto-run comparison
                );

                // Show info about what changed
                void vscode.window.showInformationMessage(
                    `Fast Schema Compare launched with ${changedObjects.length} object(s): ` +
                    `${summary.modified} modified, ${summary.addedInDatabase} new in DB, ${summary.addedInProject} missing from DB.`,
                );

                // Clean up temp project after a delay to allow Schema Compare to load
                setTimeout(() => {
                    tempProject?.cleanup();
                }, 30000); // 30 second delay

            } catch (error) {
                // Clean up temp project on error
                await tempProject?.cleanup();
                const errorMessage = error instanceof Error ? error.message : String(error);
                void vscode.window.showErrorMessage(`Failed to launch Schema Compare: ${errorMessage}`);
            }
        },
    );
}

/**
 * Find all .sql files in a project folder
 */
async function findSqlScriptFiles(projectFolderPath: string): Promise<string[]> {
    try {
        const escapedPath = glob.escapePath(projectFolderPath.replace(/\\/g, '/'));
        const sqlFilter = path.posix.join(escapedPath, '**', '*.sql');
        const results = await glob.glob(sqlFilter);
        return results;
    } catch (error) {
        console.error('[mssql-git] Error finding .sql files:', error);
        return [];
    }
}

/**
 * Update the sync status cache and trigger decoration refresh
 */
function updateSyncStatusCacheAndDecorations(
    serverName: string,
    databaseName: string,
    summary: DatabaseSyncSummary,
    mssqlApi: vscodeMssql.IExtension,
): void {
    if (!syncStatusCacheInstance || !gitDecorationProviderInstance) {
        return;
    }

    // Update cache with comparison results
    syncStatusCacheInstance.updateCache(
        serverName,
        databaseName,
        summary.objects,
        summary.isDeepComparison || false,
    );

    // Update decorations for all objects
    for (const obj of summary.objects) {
        const resourceUri = GitSyncDecorationProvider.buildObjectUri(
            serverName,
            databaseName,
            obj.objectType,
            obj.schema,
            obj.name,
        );
        gitDecorationProviderInstance.setDecoration(resourceUri, obj.status);
    }

    // Trigger Object Explorer refresh to pick up the new resourceUri values
    mssqlApi.objectExplorer.refresh();
}

/**
 * Display comparison results in a QuickPick
 */
async function displayComparisonResults(
    node: vscodeMssql.ITreeNodeInfo,
    databaseName: string,
    branchName: string,
    summary: DatabaseSyncSummary,
    linkInfo: GitLinkInfo,
    mssqlApi: vscodeMssql.IExtension,
): Promise<void> {
    // Create summary message
    const summaryParts: string[] = [];
    if (summary.inSync > 0) {
        summaryParts.push(`✓ ${summary.inSync} in sync`);
    }
    if (summary.modified > 0) {
        summaryParts.push(`~ ${summary.modified} modified`);
    }
    if (summary.addedInDatabase > 0) {
        summaryParts.push(`+ ${summary.addedInDatabase} new in DB`);
    }
    if (summary.addedInProject > 0) {
        summaryParts.push(`- ${summary.addedInProject} missing from DB`);
    }

    const summaryText = summaryParts.length > 0 ? summaryParts.join(" | ") : "No objects found";

    // Create quick pick items
    const items: vscode.QuickPickItem[] = [];

    // Add summary header
    items.push({
        label: `$(database) ${databaseName} ↔ $(git-branch) ${branchName}`,
        description: summaryText,
        kind: vscode.QuickPickItemKind.Separator,
    });

    // Group objects by status
    const modified = summary.objects.filter((o) => o.status === ObjectSyncStatus.Modified);
    const addedInDb = summary.objects.filter((o) => o.status === ObjectSyncStatus.AddedInDatabase);
    const addedInProject = summary.objects.filter((o) => o.status === ObjectSyncStatus.AddedInProject);

    if (modified.length > 0) {
        items.push({ label: "Modified in Database", kind: vscode.QuickPickItemKind.Separator });
        for (const obj of modified.slice(0, 20)) {
            items.push({
                label: `$(diff-modified) ${obj.schema}.${obj.name}`,
                description: obj.friendlyType,
                detail: `Last synced: ${obj.lastSyncedModifyDate?.toLocaleString() || "Unknown"}`,
            });
        }
        if (modified.length > 20) {
            items.push({ label: `... and ${modified.length - 20} more`, description: "" });
        }
    }

    if (addedInDb.length > 0) {
        items.push({ label: "New in Database", kind: vscode.QuickPickItemKind.Separator });
        for (const obj of addedInDb.slice(0, 20)) {
            items.push({
                label: `$(diff-added) ${obj.schema}.${obj.name}`,
                description: obj.friendlyType,
                detail: `Created: ${obj.dbModifyDate?.toLocaleString() || "Unknown"}`,
            });
        }
        if (addedInDb.length > 20) {
            items.push({ label: `... and ${addedInDb.length - 20} more`, description: "" });
        }
    }

    if (addedInProject.length > 0) {
        items.push({ label: "Missing from Database", kind: vscode.QuickPickItemKind.Separator });
        for (const obj of addedInProject.slice(0, 20)) {
            items.push({
                label: `$(diff-removed) ${obj.schema}.${obj.name}`,
                description: obj.friendlyType,
            });
        }
        if (addedInProject.length > 20) {
            items.push({ label: `... and ${addedInProject.length - 20} more`, description: "" });
        }
    }

    if (items.length === 1) {
        // Only the header separator, add an "all in sync" message
        items.push({
            label: "$(check) All objects are in sync!",
            description: `${summary.inSync} objects`,
        });
    }

    // Add actions separator and action items
    items.push({ label: "Actions", kind: vscode.QuickPickItemKind.Separator });

    // Check if there are changed objects for Schema Compare
    const hasChangedObjects = summary.objects.some(obj =>
        obj.status !== ObjectSyncStatus.InSync && obj.status !== ObjectSyncStatus.Unknown
    );

    if (hasChangedObjects) {
        items.push({
            label: "$(git-compare) Open in Schema Compare",
            description: "Launch full Schema Compare with detected changes",
            detail: `Compare ${summary.modified + summary.addedInDatabase + summary.addedInProject} changed object(s) in detail`,
        });
    }

    items.push({
        label: "$(refresh) Reinitialize Sync Metadata",
        description: "Reset baseline to current database state",
        detail: "Use this if the metadata doesn't match your repository or you want to start fresh",
    });

    // Show quick pick and handle selection
    const selected = await vscode.window.showQuickPick(items, {
        title: `Schema Comparison: ${databaseName}`,
        placeHolder: "Select an object to view details, or choose an action",
    });

    // Handle actions
    if (selected?.label === "$(git-compare) Open in Schema Compare") {
        await launchFilteredSchemaCompare(node, linkInfo, summary, mssqlApi);
    } else if (selected?.label === "$(refresh) Reinitialize Sync Metadata") {
        void vscode.commands.executeCommand("mssql-git.reinitializeSyncMetadata");
    }
}
