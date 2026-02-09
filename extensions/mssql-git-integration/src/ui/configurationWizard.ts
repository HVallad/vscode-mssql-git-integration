/*---------------------------------------------------------------------------------------------
 *  Configuration Wizard
 *  UI for configuring SQL project folder and comparison options
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { SqlProjectConfig, ComparisonOptionsConfig } from '../types';

/**
 * Result from the folder selection wizard
 */
export interface FolderConfigResult {
    cancelled: boolean;
    config?: SqlProjectConfig;
}

/**
 * Result from the comparison options wizard
 */
export interface ComparisonOptionsResult {
    cancelled: boolean;
    options?: ComparisonOptionsConfig;
}

/**
 * Show folder selection wizard for SQL project configuration
 */
export async function showFolderConfigurationWizard(
    localRepoPath: string,
    defaultStructure?: SqlProjectConfig['structure']
): Promise<FolderConfigResult> {
    // Step 1: Select or confirm folder path
    const folderChoice = await vscode.window.showQuickPick(
        [
            {
                label: `$(folder) Use repository root`,
                description: localRepoPath,
                value: localRepoPath,
            },
            {
                label: `$(folder-opened) Select subfolder...`,
                description: 'Browse for a specific folder',
                value: 'browse',
            },
        ],
        {
            placeHolder: 'Select the SQL project folder',
            ignoreFocusOut: true,
            title: 'SQL Project Folder',
        }
    );

    if (!folderChoice) {
        return { cancelled: true };
    }

    let selectedFolder = folderChoice.value;

    if (selectedFolder === 'browse') {
        const folderUri = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            defaultUri: vscode.Uri.file(localRepoPath),
            openLabel: 'Select Folder',
            title: 'Select SQL Project Folder',
        });

        if (!folderUri || folderUri.length === 0) {
            return { cancelled: true };
        }

        selectedFolder = folderUri[0].fsPath;
    }

    // Step 2: Select folder structure
    const config = vscode.workspace.getConfiguration('mssqlGit.projectFolder');
    const defaultStruct = defaultStructure || config.get<string>('defaultStructure') || 'by-schema-and-type';

    const structureItems: vscode.QuickPickItem[] = [
        {
            label: 'Flat',
            description: 'All SQL files in root folder',
            picked: defaultStruct === 'flat',
        },
        {
            label: 'By Type',
            description: 'Organized by object type (Tables, Views, etc.)',
            picked: defaultStruct === 'by-type',
        },
        {
            label: 'By Schema',
            description: 'Organized by schema (dbo, etc.)',
            picked: defaultStruct === 'by-schema',
        },
        {
            label: 'By Schema and Type',
            description: 'Organized by schema, then by object type',
            picked: defaultStruct === 'by-schema-and-type',
        },
    ];

    const structureChoice = await vscode.window.showQuickPick(structureItems, {
        placeHolder: 'Select folder structure for SQL files',
        ignoreFocusOut: true,
        title: 'Folder Structure',
    });

    if (!structureChoice) {
        return { cancelled: true };
    }

    // Map label to structure value
    const structureMap: Record<string, SqlProjectConfig['structure']> = {
        'Flat': 'flat',
        'By Type': 'by-type',
        'By Schema': 'by-schema',
        'By Schema and Type': 'by-schema-and-type',
    };

    return {
        cancelled: false,
        config: {
            folderPath: selectedFolder,
            structure: structureMap[structureChoice.label] || 'by-schema-and-type',
            includePatterns: ['**/*.sql'],
            excludePatterns: ['**/bin/**', '**/obj/**', '**/node_modules/**'],
        },
    };
}

/**
 * Show comparison options configuration wizard
 */
export async function showComparisonOptionsWizard(): Promise<ComparisonOptionsResult> {
    const config = vscode.workspace.getConfiguration('mssqlGit.comparison');

    // Use multi-select quick pick for object types
    const objectTypeItems: vscode.QuickPickItem[] = [
        { label: 'Tables', picked: config.get<boolean>('includeTables', true) },
        { label: 'Views', picked: config.get<boolean>('includeViews', true) },
        { label: 'Stored Procedures', picked: config.get<boolean>('includeStoredProcedures', true) },
        { label: 'Functions', picked: config.get<boolean>('includeFunctions', true) },
        { label: 'Triggers', picked: config.get<boolean>('includeTriggers', true) },
    ];

    const selectedTypes = await vscode.window.showQuickPick(objectTypeItems, {
        canPickMany: true,
        placeHolder: 'Select object types to include in comparison',
        ignoreFocusOut: true,
        title: 'Object Types',
    });

    if (!selectedTypes) {
        return { cancelled: true };
    }

    // Multi-select for ignore options
    const ignoreOptionItems: vscode.QuickPickItem[] = [
        {
            label: 'Ignore Whitespace',
            description: 'Ignore whitespace differences',
            picked: config.get<boolean>('ignoreWhitespace', true),
        },
        {
            label: 'Ignore Comments',
            description: 'Ignore SQL comments',
            picked: config.get<boolean>('ignoreComments', false),
        },
        {
            label: 'Ignore Column Order',
            description: 'Ignore column order in tables',
            picked: config.get<boolean>('ignoreColumnOrder', false),
        },
    ];

    const selectedIgnoreOptions = await vscode.window.showQuickPick(ignoreOptionItems, {
        canPickMany: true,
        placeHolder: 'Select options for comparison (all selected items will be ignored)',
        ignoreFocusOut: true,
        title: 'Ignore Options',
    });

    if (!selectedIgnoreOptions) {
        return { cancelled: true };
    }

    const selectedLabels = selectedTypes.map(item => item.label);
    const selectedIgnoreLabels = selectedIgnoreOptions.map(item => item.label);

    return {
        cancelled: false,
        options: {
            objectTypes: {
                tables: selectedLabels.includes('Tables'),
                views: selectedLabels.includes('Views'),
                storedProcedures: selectedLabels.includes('Stored Procedures'),
                functions: selectedLabels.includes('Functions'),
                triggers: selectedLabels.includes('Triggers'),
                schemas: true, // Always include schemas
            },
            ignoreOptions: {
                whitespace: selectedIgnoreLabels.includes('Ignore Whitespace'),
                comments: selectedIgnoreLabels.includes('Ignore Comments'),
                columnOrder: selectedIgnoreLabels.includes('Ignore Column Order'),
            },
        },
    };
}

/**
 * Get default comparison options from VS Code settings
 */
export function getDefaultComparisonOptions(): ComparisonOptionsConfig {
    const config = vscode.workspace.getConfiguration('mssqlGit.comparison');
    return {
        objectTypes: {
            tables: config.get<boolean>('includeTables', true),
            views: config.get<boolean>('includeViews', true),
            storedProcedures: config.get<boolean>('includeStoredProcedures', true),
            functions: config.get<boolean>('includeFunctions', true),
            triggers: config.get<boolean>('includeTriggers', true),
            schemas: true,
        },
        ignoreOptions: {
            whitespace: config.get<boolean>('ignoreWhitespace', true),
            comments: config.get<boolean>('ignoreComments', false),
            columnOrder: config.get<boolean>('ignoreColumnOrder', false),
        },
    };
}

/**
 * Convert ComparisonOptionsConfig to CreateSubscriptionRequest format
 */
export function convertToSubscriptionOptions(options: ComparisonOptionsConfig): {
    includeTables: boolean;
    includeViews: boolean;
    includeStoredProcedures: boolean;
    includeFunctions: boolean;
    includeTriggers: boolean;
    ignoreWhitespace: boolean;
    ignoreComments: boolean;
    ignoreColumnOrder: boolean;
} {
    return {
        includeTables: options.objectTypes.tables,
        includeViews: options.objectTypes.views,
        includeStoredProcedures: options.objectTypes.storedProcedures,
        includeFunctions: options.objectTypes.functions,
        includeTriggers: options.objectTypes.triggers,
        ignoreWhitespace: options.ignoreOptions.whitespace,
        ignoreComments: options.ignoreOptions.comments,
        ignoreColumnOrder: options.ignoreOptions.columnOrder,
    };
}

