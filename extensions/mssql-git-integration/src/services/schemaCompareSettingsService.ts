/*---------------------------------------------------------------------------------------------
 *  Schema Compare Settings Service
 *  Manages caching of schema compare settings using VS Code's configuration
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as vscodeMssql from "vscode-mssql";

/**
 * Service for managing cached schema compare settings.
 * Settings are stored in VS Code's configuration (settings.json) and persist across sessions.
 * Users can view and edit these settings directly in their settings.
 */
export class SchemaCompareSettingsService {
    private readonly CONFIG_SECTION = "mssqlGit.schemaCompare";

    // Note: _context is kept for API compatibility but no longer used
    // since settings are now stored in VS Code configuration instead of globalState
    constructor(_context: vscode.ExtensionContext) {}

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
        excludedObjectTypes: string[]
    ): Promise<void> {
        if (!this.isCachingEnabled()) {
            return;
        }

        const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);

        // Save to global (user) settings so they persist across workspaces
        await config.update("options", booleanOptions, vscode.ConfigurationTarget.Global);
        await config.update("excludedObjectTypes", excludedObjectTypes, vscode.ConfigurationTarget.Global);

        console.log("MSSQL Git: Schema compare settings saved to VS Code configuration");
    }

    /**
     * Clear cached schema compare settings
     */
    public async clearSettings(): Promise<void> {
        const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
        await config.update("options", undefined, vscode.ConfigurationTarget.Global);
        await config.update("excludedObjectTypes", undefined, vscode.ConfigurationTarget.Global);
        console.log("MSSQL Git: Cached schema compare settings cleared");
    }

    /**
     * Save settings from a DeploymentOptions object (from mssql extension)
     * @param deploymentOptions The deployment options from schema compare
     */
    public async saveFromDeploymentOptions(
        deploymentOptions: vscodeMssql.DeploymentOptions
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
     * Build a partial DeploymentOptions object from cached settings
     * This can be passed to the mssql.schemaCompare command
     * @returns A partial DeploymentOptions object, or undefined if no cached settings
     */
    public buildDeploymentOptionsFromCache(): vscodeMssql.DeploymentOptions | undefined {
        if (!this.isCachingEnabled()) {
            return undefined;
        }

        const booleanOptions = this.getBooleanOptions();
        const excludedObjectTypes = this.getExcludedObjectTypes();

        // If no settings are cached, return undefined
        if (Object.keys(booleanOptions).length === 0 && excludedObjectTypes.length === 0) {
            return undefined;
        }

        // Build a partial DeploymentOptions object with cached values
        const booleanOptionsDictionary: { [key: string]: vscodeMssql.DacDeployOptionPropertyBoolean } = {};
        for (const key of Object.keys(booleanOptions)) {
            booleanOptionsDictionary[key] = {
                value: booleanOptions[key],
                description: "",
                displayName: "",
            };
        }

        return {
            excludeObjectTypes: {
                value: excludedObjectTypes,
                description: "",
                displayName: "",
            },
            booleanOptionsDictionary,
            objectTypesDictionary: {},
        };
    }
}

