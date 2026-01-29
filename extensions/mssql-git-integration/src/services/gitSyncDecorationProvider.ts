/*---------------------------------------------------------------------------------------------
 *  Git Sync Decoration Provider
 *  Provides visual decorations for database objects based on their git sync status
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ObjectSyncStatus } from "./schemaComparisonService";

/**
 * Decoration info for a single object
 */
export interface ObjectDecorationInfo {
    status: ObjectSyncStatus;
    badge: string;
    color: vscode.ThemeColor;
    tooltip: string;
}

/**
 * FileDecorationProvider that shows git sync status on database objects in Object Explorer
 */
export class GitSyncDecorationProvider implements vscode.FileDecorationProvider {
    private _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
    readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

    // Cache of decorations by URI string
    private _decorations = new Map<string, ObjectDecorationInfo>();

    /**
     * Get the decoration for a resource URI
     */
    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        // Only handle our custom scheme
        if (uri.scheme !== "mssql-git-object") {
            return undefined;
        }

        const decorationInfo = this._decorations.get(uri.toString());
        if (!decorationInfo) {
            return undefined;
        }

        return {
            badge: decorationInfo.badge,
            color: decorationInfo.color,
            tooltip: decorationInfo.tooltip,
            propagate: false, // Don't propagate to parent folders
        };
    }

    /**
     * Set decoration for a specific object
     */
    public setDecoration(uri: vscode.Uri, status: ObjectSyncStatus): void {
        const decorationInfo = this.getDecorationForStatus(status);
        if (decorationInfo) {
            this._decorations.set(uri.toString(), decorationInfo);
            this._onDidChangeFileDecorations.fire(uri);
        } else {
            this.clearDecoration(uri);
        }
    }

    /**
     * Clear decoration for a specific object
     */
    public clearDecoration(uri: vscode.Uri): void {
        if (this._decorations.has(uri.toString())) {
            this._decorations.delete(uri.toString());
            this._onDidChangeFileDecorations.fire(uri);
        }
    }

    /**
     * Clear all decorations for a database
     */
    public clearDecorationsForDatabase(serverName: string, databaseName: string): void {
        const prefix = `mssql-git-object://${serverName}/${databaseName}/`;
        const urisToRemove: vscode.Uri[] = [];

        for (const uriString of this._decorations.keys()) {
            if (uriString.startsWith(prefix)) {
                urisToRemove.push(vscode.Uri.parse(uriString));
                this._decorations.delete(uriString);
            }
        }

        if (urisToRemove.length > 0) {
            this._onDidChangeFileDecorations.fire(urisToRemove);
        }
    }

    /**
     * Clear all decorations
     */
    public clearAllDecorations(): void {
        this._decorations.clear();
        this._onDidChangeFileDecorations.fire(undefined);
    }

    /**
     * Refresh all decorations (fires change event)
     */
    public refresh(): void {
        this._onDidChangeFileDecorations.fire(undefined);
    }

    /**
     * Get decoration info for a sync status
     */
    private getDecorationForStatus(status: ObjectSyncStatus): ObjectDecorationInfo | undefined {
        switch (status) {
            case ObjectSyncStatus.AddedInDatabase:
                return {
                    status,
                    badge: "+",
                    color: new vscode.ThemeColor("gitDecoration.untrackedResourceForeground"),
                    tooltip: "New in database (not in git repository)",
                };
            case ObjectSyncStatus.Modified:
                return {
                    status,
                    badge: "M",
                    color: new vscode.ThemeColor("gitDecoration.modifiedResourceForeground"),
                    tooltip: "Modified (database differs from git repository)",
                };
            case ObjectSyncStatus.AddedInProject:
                return {
                    status,
                    badge: "-",
                    color: new vscode.ThemeColor("gitDecoration.deletedResourceForeground"),
                    tooltip: "Missing from database (exists in git repository)",
                };
            case ObjectSyncStatus.InSync:
            case ObjectSyncStatus.Unknown:
            default:
                return undefined; // No decoration for in-sync or unknown
        }
    }

    /**
     * Build a resource URI for a database object
     */
    public static buildObjectUri(
        serverName: string,
        databaseName: string,
        objectType: string,
        schema: string,
        objectName: string,
    ): vscode.Uri {
        // Encode components to handle special characters
        const encodedServer = encodeURIComponent(serverName);
        const encodedDb = encodeURIComponent(databaseName);
        const encodedType = encodeURIComponent(objectType);
        const encodedSchema = encodeURIComponent(schema);
        const encodedName = encodeURIComponent(objectName);

        return vscode.Uri.parse(
            `mssql-git-object://${encodedServer}/${encodedDb}/${encodedType}/${encodedSchema}/${encodedName}`,
        );
    }
}

