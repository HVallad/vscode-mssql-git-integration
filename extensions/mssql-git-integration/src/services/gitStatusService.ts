/*---------------------------------------------------------------------------------------------
 *  Git Status Service
 *  Manages the git link status for databases
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import type { IConnectionInfo } from "vscode-mssql";

// Storage key for git-linked databases
const GIT_LINKED_DATABASES_KEY = "mssql-git.linkedDatabases";

/**
 * Information about a database's git link status
 */
export interface GitLinkInfo {
    /** Server identifier (server name/host) */
    serverId: string;
    /** Database name */
    databaseName: string;
    /** Remote Git repository URL */
    gitRepoUrl: string;
    /** Local directory where the repository is cloned */
    localGitPath: string;
    /** Git branch name */
    branchName: string;
    /** Path to local database schema cache directory (for future comparison feature) */
    localCachePath?: string;
    /** SQL Comparison Service subscription ID (if schema sync is enabled) */
    subscriptionId?: string;
    /** Timestamp when the link was created */
    linkedAt: string;
}

/**
 * Service for managing git link status of databases
 */
export class GitStatusService {
    private _linkedDatabases: Map<string, GitLinkInfo> = new Map();

    constructor(private readonly _context: vscode.ExtensionContext) {
        this._loadLinkedDatabases();
    }

    /**
     * Generate a unique key for a database
     */
    private _getDatabaseKey(
        connectionProfile: IConnectionInfo,
        databaseName: string,
    ): string {
        const server = connectionProfile.server || "";
        return `${server}/${databaseName}`.toLowerCase();
    }

    /**
     * Load linked databases from extension storage
     */
    private _loadLinkedDatabases(): void {
        const stored = this._context.globalState.get<GitLinkInfo[]>(
            GIT_LINKED_DATABASES_KEY,
            [],
        );

        this._linkedDatabases.clear();
        for (const info of stored) {
            const key = `${info.serverId}/${info.databaseName}`.toLowerCase();
            this._linkedDatabases.set(key, info);
        }
    }

    /**
     * Save linked databases to extension storage
     */
    private async _saveLinkedDatabases(): Promise<void> {
        const data = Array.from(this._linkedDatabases.values());
        await this._context.globalState.update(GIT_LINKED_DATABASES_KEY, data);
    }

    /**
     * Check if a database is linked to git
     */
    public async isDatabaseLinkedToGit(
        connectionProfile: IConnectionInfo,
        databaseName: string,
    ): Promise<boolean> {
        const key = this._getDatabaseKey(connectionProfile, databaseName);
        return this._linkedDatabases.has(key);
    }

    /**
     * Get the git link info for a database
     */
    public getGitLinkInfo(
        connectionProfile: IConnectionInfo,
        databaseName: string,
    ): GitLinkInfo | undefined {
        const key = this._getDatabaseKey(connectionProfile, databaseName);
        return this._linkedDatabases.get(key);
    }

    /**
     * Link a database to a git repository
     */
    public async linkDatabaseToGit(
        connectionProfile: IConnectionInfo,
        databaseName: string,
        gitRepoUrl: string,
        localGitPath: string,
        branchName: string,
        subscriptionId?: string,
        localCachePath?: string,
    ): Promise<void> {
        const key = this._getDatabaseKey(connectionProfile, databaseName);
        const info: GitLinkInfo = {
            serverId: connectionProfile.server || "",
            databaseName,
            gitRepoUrl,
            localGitPath,
            branchName,
            subscriptionId,
            localCachePath,
            linkedAt: new Date().toISOString(),
        };

        this._linkedDatabases.set(key, info);
        await this._saveLinkedDatabases();
    }

    /**
     * Unlink a database from git
     */
    public async unlinkDatabaseFromGit(
        connectionProfile: IConnectionInfo,
        databaseName: string,
    ): Promise<boolean> {
        const key = this._getDatabaseKey(connectionProfile, databaseName);
        const wasLinked = this._linkedDatabases.delete(key);

        if (wasLinked) {
            await this._saveLinkedDatabases();
        }

        return wasLinked;
    }

    /**
     * Get all linked databases
     */
    public getAllLinkedDatabases(): GitLinkInfo[] {
        return Array.from(this._linkedDatabases.values());
    }
}

