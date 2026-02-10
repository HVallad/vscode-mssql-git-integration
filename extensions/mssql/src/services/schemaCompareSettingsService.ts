/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as mssql from "vscode-mssql";

/**
 * Service for managing cached schema compare settings.
 * Settings are stored in VS Code's configuration (settings.json) and persist across sessions.
 * Users can view and edit these settings directly in their settings.
 */
export class SchemaCompareSettingsService {
    private readonly CONFIG_SECTION = "mssql.schemaCompare";

    /**
     * Check if settings caching is enabled in configuration
     */
    public isCachingEnabled(): boolean {
        const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
        return config.get<boolean>("cacheSettings", true);
    }

    /**
     * Get cached boolean options from VS Code configuration
     */
    private getBooleanOptions(): { [key: string]: boolean } {
        const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
        return config.get<{ [key: string]: boolean }>("options", {});
    }

    /**
     * Get cached excluded object types from VS Code configuration
     */
    private getExcludedObjectTypes(): string[] {
        const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
        return config.get<string[]>("excludedObjectTypes", []);
    }

    /**
     * Check if there are cached settings available
     */
    public hasCachedSettings(): boolean {
        if (!this.isCachingEnabled()) {
            return false;
        }
        const booleanOptions = this.getBooleanOptions();
        const excludedObjectTypes = this.getExcludedObjectTypes();
        return Object.keys(booleanOptions).length > 0 || excludedObjectTypes.length > 0;
    }

    /**
     * Save schema compare settings to VS Code configuration
     * @param booleanOptions Dictionary of boolean option values
     * @param excludedObjectTypes List of excluded object type names
     */
    public async saveSettings(
        booleanOptions: { [key: string]: boolean },
        excludedObjectTypes: string[],
    ): Promise<void> {
        if (!this.isCachingEnabled()) {
            return;
        }

        const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);

        // Save to global (user) settings so they persist across workspaces
        await config.update("options", booleanOptions, vscode.ConfigurationTarget.Global);
        await config.update(
            "excludedObjectTypes",
            excludedObjectTypes,
            vscode.ConfigurationTarget.Global,
        );

        console.log("MSSQL: Schema compare settings saved to VS Code configuration");
    }

    /**
     * Clear cached schema compare settings
     */
    public async clearSettings(): Promise<void> {
        const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
        await config.update("options", undefined, vscode.ConfigurationTarget.Global);
        await config.update("excludedObjectTypes", undefined, vscode.ConfigurationTarget.Global);
        console.log("MSSQL: Cached schema compare settings cleared");
    }

    /**
     * Save settings from a DeploymentOptions object
     * @param deploymentOptions The deployment options from schema compare
     */
    public async saveFromDeploymentOptions(
        deploymentOptions: mssql.DeploymentOptions,
    ): Promise<void> {
        if (!this.isCachingEnabled()) {
            return;
        }

        // Extract boolean option values
        const booleanOptions: { [key: string]: boolean } = {};
        if (deploymentOptions.booleanOptionsDictionary) {
            for (const key of Object.keys(deploymentOptions.booleanOptionsDictionary)) {
                booleanOptions[key] = deploymentOptions.booleanOptionsDictionary[key].value;
            }
        }

        // Extract excluded object types
        const excludedObjectTypes: string[] = deploymentOptions.excludeObjectTypes?.value || [];

        await this.saveSettings(booleanOptions, excludedObjectTypes);
    }

    /**
     * Apply cached settings to a DeploymentOptions object
     * @param deploymentOptions The deployment options to modify
     */
    public applyCachedSettings(deploymentOptions: mssql.DeploymentOptions): void {
        if (!this.isCachingEnabled() || !this.hasCachedSettings()) {
            return;
        }

        const booleanOptions = this.getBooleanOptions();
        const excludedObjectTypes = this.getExcludedObjectTypes();

        // Apply cached boolean options
        for (const key of Object.keys(booleanOptions)) {
            if (deploymentOptions.booleanOptionsDictionary[key]) {
                deploymentOptions.booleanOptionsDictionary[key].value = booleanOptions[key];
            }
        }

        // Apply cached excluded object types
        if (excludedObjectTypes.length > 0) {
            deploymentOptions.excludeObjectTypes.value = [...excludedObjectTypes];
        }

        console.log("MSSQL: Applied cached schema compare settings");
    }
}
