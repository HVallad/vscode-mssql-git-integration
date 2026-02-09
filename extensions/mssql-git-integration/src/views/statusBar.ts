/*---------------------------------------------------------------------------------------------
 *  Status Bar
 *  Shows SQL Sync status in VS Code status bar
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Status bar item for showing SQL Sync status
 */
export class SchemaSyncStatusBar implements vscode.Disposable {
    private readonly item: vscode.StatusBarItem;
    private totalDifferences = 0;
    private isComparing = false;
    private isConnected = false;

    constructor() {
        this.item = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
        );
        this.item.command = 'mssql-git.showSubscriptions';
        this.update();
    }

    /**
     * Set the status bar to show "comparing" state
     */
    setComparing(subscriptionName: string): void {
        this.isComparing = true;
        this.item.text = `$(sync~spin) Comparing ${subscriptionName}...`;
        this.item.tooltip = 'Schema comparison in progress';
        this.item.backgroundColor = undefined;
        this.item.show();
    }

    /**
     * Update the difference count
     */
    setDifferenceCount(count: number): void {
        this.isComparing = false;
        this.totalDifferences = count;
        this.update();
    }

    /**
     * Set connection status
     */
    setConnectionStatus(connected: boolean): void {
        this.isConnected = connected;
        this.update();
    }

    /**
     * Show a temporary message
     */
    showMessage(message: string, durationMs: number = 3000): void {
        const previousText = this.item.text;
        const previousTooltip = this.item.tooltip;
        
        this.item.text = message;
        this.item.show();
        
        setTimeout(() => {
            this.item.text = previousText;
            this.item.tooltip = previousTooltip;
        }, durationMs);
    }

    /**
     * Update the status bar based on current state
     */
    private update(): void {
        if (this.isComparing) {
            return;
        }

        if (!this.isConnected) {
            this.item.text = '$(database) SQL Sync: Offline';
            this.item.tooltip = 'SQL Comparison Service not connected. Click to configure.';
            this.item.backgroundColor = undefined;
            this.item.show();
            return;
        }

        if (this.totalDifferences === 0) {
            this.item.text = '$(database) SQL Sync';
            this.item.tooltip = 'All schemas synchronized';
            this.item.backgroundColor = undefined;
        } else {
            this.item.text = `$(database) SQL Sync: ${this.totalDifferences}`;
            this.item.tooltip = `${this.totalDifferences} schema difference(s) detected`;
            this.item.backgroundColor = new vscode.ThemeColor(
                'statusBarItem.warningBackground'
            );
        }
        this.item.show();
    }

    /**
     * Show the status bar item
     */
    show(): void {
        this.item.show();
    }

    /**
     * Hide the status bar item
     */
    hide(): void {
        this.item.hide();
    }

    dispose(): void {
        this.item.dispose();
    }
}

