/*---------------------------------------------------------------------------------------------
 *  Test Utilities
 *  Shared helpers and mock factories for unit tests
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import * as vscode from "vscode";
import {
    Subscription,
    SchemaDifference,
    HealthInfo,
    ServiceInfo,
    ComparisonResult,
    ObjectDetails,
} from "../src/types";

/**
 * Create a mock subscription for testing
 * Uses the flat format returned by the list endpoint
 */
export function createMockSubscription(overrides: Partial<Subscription> = {}): Subscription {
    return {
        id: "sub-123",
        name: "Test Subscription",
        state: "active",
        database: {
            server: "localhost",
            database: "TestDB",
            authType: "sql",
            displayName: "localhost.TestDB",
        },
        project: {
            path: "/path/to/project",
            includePatterns: ["**/*.sql"],
            excludePatterns: ["**/bin/**", "**/obj/**"],
            structure: "by-schema-and-type",
            sqlFileCount: 100,
        },
        options: {
            autoCompare: true,
            compareOnFileChange: true,
            compareOnDatabaseChange: true,
        },
        // Flat format from list endpoint
        lastComparedAt: new Date().toISOString(),
        differenceCount: 0,
        // Nested format from individual subscription endpoint (optional)
        lastComparison: {
            id: "comp-123",
            comparedAt: new Date().toISOString(),
            differenceCount: 0,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...overrides,
    };
}

/**
 * Create a mock schema difference for testing
 */
export function createMockDifference(overrides: Partial<SchemaDifference> = {}): SchemaDifference {
    return {
        id: "diff-123",
        objectName: "dbo.TestTable",
        objectType: "table",
        action: "change",
        direction: "different",
        comparisonId: "comp-123",
        // Legacy fields for backwards compatibility
        schemaName: "dbo",
        changeType: "Modified",
        ...overrides,
    };
}

/**
 * Create mock health info for testing
 */
export function createMockHealthInfo(overrides: Partial<HealthInfo> = {}): HealthInfo {
    return {
        status: "healthy",
        version: "1.0.0",
        uptime: 3600,
        activeSubscriptions: 2,
        ...overrides,
    };
}

/**
 * Create mock service info for testing
 */
export function createMockServiceInfo(overrides: Partial<ServiceInfo> = {}): ServiceInfo {
    return {
        endpoint: "http://localhost:5050",
        status: "healthy",
        version: "1.0.0",
        uptime: 3600,
        activeSubscriptions: 2,
        ...overrides,
    };
}

/**
 * Create mock comparison result for testing
 */
export function createMockComparisonResult(overrides: Partial<ComparisonResult> = {}): ComparisonResult {
    return {
        id: "result-123",
        subscriptionId: "sub-123",
        status: "completed",
        differenceCount: 0,
        durationMs: 1500,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        ...overrides,
    };
}

/**
 * Create mock object details for testing
 */
export function createMockObjectDetails(overrides: Partial<ObjectDetails> = {}): ObjectDetails {
    return {
        objectName: "TestTable",
        schemaName: "dbo",
        objectType: "Table",
        databaseDefinition: "CREATE TABLE dbo.TestTable (Id INT PRIMARY KEY);",
        fileDefinition: "CREATE TABLE dbo.TestTable (Id INT PRIMARY KEY, Name NVARCHAR(100));",
        ...overrides,
    };
}

/**
 * Stub VS Code extension context for testing
 */
export function stubExtensionContext(sandbox: sinon.SinonSandbox): vscode.ExtensionContext {
    const globalState = {
        get: sandbox.stub().returns(undefined),
        update: sandbox.stub().resolves(),
        keys: sandbox.stub().returns([]),
        setKeysForSync: sandbox.stub(),
    };

    const workspaceState = {
        get: sandbox.stub().returns(undefined),
        update: sandbox.stub().resolves(),
        keys: sandbox.stub().returns([]),
    };

    return {
        globalState,
        workspaceState,
        extensionUri: vscode.Uri.parse("file:///testExtensionPath"),
        extensionPath: "/testExtensionPath",
        subscriptions: [],
        logUri: vscode.Uri.parse("file:///testLogPath"),
        storageUri: vscode.Uri.parse("file:///testStoragePath"),
        globalStorageUri: vscode.Uri.parse("file:///testGlobalStoragePath"),
        extensionMode: vscode.ExtensionMode.Test,
        secrets: {
            get: sandbox.stub().resolves(undefined),
            store: sandbox.stub().resolves(),
            delete: sandbox.stub().resolves(),
            onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event,
        },
        asAbsolutePath: sandbox.stub().callsFake((p: string) => `/testExtensionPath/${p}`),
        languageModelAccessInformation: {
            onDidChange: new vscode.EventEmitter<void>().event,
            canSendRequest: sandbox.stub().returns(true),
        },
    } as unknown as vscode.ExtensionContext;
}

/**
 * Stub VS Code workspace configuration
 */
export function stubWorkspaceConfig(sandbox: sinon.SinonSandbox, values: Record<string, unknown> = {}): void {
    sandbox.stub(vscode.workspace, "getConfiguration").returns({
        get: sandbox.stub().callsFake((key: string) => values[key]),
        has: sandbox.stub().callsFake((key: string) => key in values),
        update: sandbox.stub().resolves(),
        inspect: sandbox.stub().returns(undefined),
    } as unknown as vscode.WorkspaceConfiguration);
}

