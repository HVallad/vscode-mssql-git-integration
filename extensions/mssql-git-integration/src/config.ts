/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

/**
 * Configuration section name for the mssql-git-integration extension
 */
export const EXTENSION_CONFIG_SECTION = "mssqlGitIntegration";

/**
 * Schema compare configuration options
 */
export interface SchemaCompareConfig {
    /**
     * Whether to exclude permission statements (GRANT, DENY, REVOKE) from comparison
     * Default: true
     */
    excludePermissions: boolean;

    /**
     * Whether to ignore whitespace differences during comparison
     * Default: false
     */
    excludeWhitespace: boolean;
}

/**
 * Get the schema compare configuration options from VS Code settings
 * @returns SchemaCompareConfig with the current settings
 */
export function getSchemaCompareConfig(): SchemaCompareConfig {
    const config = vscode.workspace.getConfiguration(EXTENSION_CONFIG_SECTION);

    return {
        excludePermissions: config.get<boolean>("schemaCompare.excludePermissions", true),
        excludeWhitespace: config.get<boolean>("schemaCompare.excludeWhitespace", false),
    };
}

/**
 * Get a specific configuration value
 * @param key The configuration key (relative to mssqlGitIntegration section)
 * @param defaultValue The default value if the setting is not configured
 * @returns The configuration value
 */
export function getConfig<T>(key: string, defaultValue: T): T {
    const config = vscode.workspace.getConfiguration(EXTENSION_CONFIG_SECTION);
    return config.get<T>(key, defaultValue);
}

