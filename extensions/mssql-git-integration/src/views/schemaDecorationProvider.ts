/*---------------------------------------------------------------------------------------------
 *  Schema Decoration Provider
 *  Provides Git-style color decorations for Object Explorer nodes with schema differences
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * URI scheme for schema difference decorations
 */
export const SCHEMA_DIFF_URI_SCHEME = 'mssql-schema-diff';

/**
 * Decoration action types matching SchemaDifference.action
 */
export type DecorationAction = 'add' | 'change' | 'delete';

/**
 * Provides file decorations for Object Explorer nodes with schema differences.
 * Uses Git-style colors: green for added, yellow for modified, red for deleted.
 */
export class SchemaDecorationProvider implements vscode.FileDecorationProvider {
    private readonly _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
    readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

    /** Map of URI string to decoration action */
    private readonly _decorations = new Map<string, DecorationAction>();

    /**
     * Set a decoration for a URI
     */
    public setDecoration(uri: vscode.Uri, action: DecorationAction): void {
        this._decorations.set(uri.toString(), action);
        this._onDidChangeFileDecorations.fire(uri);
    }

    /**
     * Clear a decoration for a URI
     */
    public clearDecoration(uri: vscode.Uri): void {
        if (this._decorations.delete(uri.toString())) {
            this._onDidChangeFileDecorations.fire(uri);
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
     * Fire decoration change event for specific URIs
     */
    public fireDecorationChange(uris?: vscode.Uri[]): void {
        this._onDidChangeFileDecorations.fire(uris);
    }

    /**
     * Provide file decoration for a URI
     */
    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        // Only handle our scheme
        if (uri.scheme !== SCHEMA_DIFF_URI_SCHEME) {
            return undefined;
        }

        const action = this._decorations.get(uri.toString());
        if (!action) {
            return undefined;
        }

        return this.getDecorationForAction(action);
    }

    /**
     * Get the decoration for a specific action type
     */
    private getDecorationForAction(action: DecorationAction): vscode.FileDecoration {
        switch (action) {
            case 'add':
                return {
                    badge: 'A',
                    color: new vscode.ThemeColor('gitDecoration.addedResourceForeground'),
                    tooltip: 'Added - exists in database but not in project',
                };
            case 'delete':
                return {
                    badge: 'D',
                    color: new vscode.ThemeColor('gitDecoration.deletedResourceForeground'),
                    tooltip: 'Deleted - exists in project but not in database',
                };
            case 'change':
            default:
                return {
                    badge: 'M',
                    color: new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'),
                    tooltip: 'Modified - differs between database and project',
                };
        }
    }

    /**
     * Create a URI for a schema object
     */
    public static createUri(
        server: string,
        database: string,
        objectType: string,
        schema: string,
        objectName: string,
    ): vscode.Uri {
        // Encode components to handle special characters
        const path = `/${encodeURIComponent(server)}/${encodeURIComponent(database)}/${encodeURIComponent(objectType)}/${encodeURIComponent(schema)}/${encodeURIComponent(objectName)}`;
        return vscode.Uri.parse(`${SCHEMA_DIFF_URI_SCHEME}:${path}`);
    }

    dispose(): void {
        this._onDidChangeFileDecorations.dispose();
        this._decorations.clear();
    }
}

