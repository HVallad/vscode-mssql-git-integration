/*---------------------------------------------------------------------------------------------
 *  Diff Viewer
 *  Opens VS Code's built-in diff editor for schema comparisons
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { SqlComparisonClient } from '../services/sqlComparisonClient';
import { SchemaDifference } from '../types';
import { sqlCompareContentCache } from '../commands';

/**
 * Content provider for virtual SQL documents used in diff views
 */
export class SqlCompareContentProvider implements vscode.TextDocumentContentProvider {
    private static instance: SqlCompareContentProvider | undefined;
    private readonly contents = new Map<string, string>();
    private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChange.event;

    /**
     * Get or create the singleton instance
     */
    public static getInstance(context: vscode.ExtensionContext): SqlCompareContentProvider {
        if (!SqlCompareContentProvider.instance) {
            SqlCompareContentProvider.instance = new SqlCompareContentProvider();
            // Register the content provider
            const disposable = vscode.workspace.registerTextDocumentContentProvider(
                'sql-compare',
                SqlCompareContentProvider.instance
            );
            context.subscriptions.push(disposable);
        }
        return SqlCompareContentProvider.instance;
    }

    provideTextDocumentContent(uri: vscode.Uri): string {
        // Check instance cache first, then shared cache from commands.ts
        const uriStr = uri.toString();
        return this.contents.get(uriStr) || sqlCompareContentCache.get(uriStr) || '';
    }

    /**
     * Set content for a virtual document
     */
    public setContent(uri: vscode.Uri, content: string): void {
        this.contents.set(uri.toString(), content);
        this._onDidChange.fire(uri);
    }

    /**
     * Clear cached content
     */
    public clearContent(uri: vscode.Uri): void {
        this.contents.delete(uri.toString());
    }

    /**
     * Clear all cached content
     */
    public clearAll(): void {
        this.contents.clear();
    }
}

/**
 * Helper class for opening diff views
 */
export class DiffViewer {
    constructor(
        private readonly client: SqlComparisonClient,
        private readonly contentProvider: SqlCompareContentProvider,
    ) {}

    /**
     * Show a diff view for a schema difference
     */
    async showDiff(subscriptionId: string, difference: SchemaDifference): Promise<void> {
        const objectName = difference.schemaName 
            ? `${difference.schemaName}.${difference.objectName}` 
            : difference.objectName;

        // Fetch full object details from service if not already available
        let databaseDefinition = difference.databaseDefinition;
        let fileDefinition = difference.fileDefinition;

        if (!databaseDefinition && !fileDefinition) {
            try {
                const objectDetails = await this.client.getObjectDetails(
                    subscriptionId,
                    difference.objectName
                );
                databaseDefinition = objectDetails.databaseDefinition;
                fileDefinition = objectDetails.fileDefinition;
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                void vscode.window.showErrorMessage(`Failed to fetch object details: ${errorMsg}`);
                return;
            }
        }

        // Create virtual document URIs
        const leftUri = vscode.Uri.parse(
            `sql-compare:/${subscriptionId}/database/${objectName}.sql`
        );
        const rightUri = vscode.Uri.parse(
            `sql-compare:/${subscriptionId}/file/${objectName}.sql`
        );

        // Set content for virtual documents
        const leftContent = databaseDefinition || '-- Object not found in database';
        const rightContent = fileDefinition || '-- Object not found in files';

        this.contentProvider.setContent(leftUri, leftContent);
        this.contentProvider.setContent(rightUri, rightContent);

        // Open diff editor
        const title = `${objectName} (Database ↔ Files)`;
        await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
    }

    /**
     * Show a single object's script in a new document
     */
    async showObjectScript(
        subscriptionId: string, 
        objectName: string, 
        source: 'database' | 'file'
    ): Promise<void> {
        try {
            const objectDetails = await this.client.getObjectDetails(subscriptionId, objectName);
            
            const content = source === 'database' 
                ? objectDetails.databaseDefinition 
                : objectDetails.fileDefinition;

            if (!content) {
                void vscode.window.showWarningMessage(
                    `Object "${objectName}" not found in ${source}.`
                );
                return;
            }

            // Create a new untitled document with the script
            const doc = await vscode.workspace.openTextDocument({
                language: 'sql',
                content: content,
            });
            await vscode.window.showTextDocument(doc);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(`Failed to fetch object script: ${errorMsg}`);
        }
    }
}

