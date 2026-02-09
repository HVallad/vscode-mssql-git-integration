/*---------------------------------------------------------------------------------------------
 *  SQL Comparison Service Types
 *  Type definitions for SQL Comparison Service API and events
 *--------------------------------------------------------------------------------------------*/

/**
 * Health information returned from the service health endpoint
 */
export interface HealthInfo {
    status: 'healthy' | 'degraded' | 'unhealthy';
    version: string;
    uptime: number;
    activeSubscriptions: number;
}

/**
 * Service discovery result
 */
export interface ServiceInfo {
    endpoint: string;
    status: HealthInfo['status'];
    version: string;
    uptime: number;
    activeSubscriptions: number;
}

/**
 * SQL project folder configuration
 */
export interface SqlProjectConfig {
    folderPath: string;
    structure: 'flat' | 'by-type' | 'by-schema' | 'by-schema-and-type';
    includePatterns: string[];
    excludePatterns: string[];
}

/**
 * Comparison options configuration
 */
export interface ComparisonOptionsConfig {
    objectTypes: {
        tables: boolean;
        views: boolean;
        storedProcedures: boolean;
        functions: boolean;
        triggers: boolean;
        schemas: boolean;
    };
    ignoreOptions: {
        whitespace: boolean;
        comments: boolean;
        columnOrder: boolean;
    };
}

/**
 * Database connection details for subscription creation
 * Note: Field names match the SQL Comparison Service API
 */
export interface DatabaseConnectionInfo {
    server: string;
    database: string;
    authType: 'sql' | 'windows' | 'azure';
    username?: string;
    password?: string;
    trustServerCertificate?: boolean;
    connectionTimeoutSeconds?: number;
}

/**
 * Request to create a new subscription
 * Note: Field names match the SQL Comparison Service API
 */
export interface CreateSubscriptionRequest {
    name: string;
    database: DatabaseConnectionInfo;
    project: {
        path: string;
        structure: string;
        includePatterns: string[];
        excludePatterns: string[];
    };
    options: {
        autoCompare: boolean;
        compareOnFileChange: boolean;
        compareOnDatabaseChange: boolean;
    };
}

/**
 * Subscription details returned from the service
 * Note: Field names match the SQL Comparison Service API
 */
export interface Subscription {
    id: string;
    name: string;
    state: 'active' | 'paused' | 'error';
    database: {
        server: string;
        database: string;
        authType?: string;
        displayName?: string;
    };
    project: {
        path: string;
        includePatterns?: string[];
        excludePatterns?: string[];
        structure?: string;
        sqlFileCount?: number;
    };
    options?: {
        autoCompare?: boolean;
        compareOnFileChange?: boolean;
        compareOnDatabaseChange?: boolean;
    };
    // List endpoint format - flat fields at root level
    lastComparedAt?: string;
    differenceCount?: number;
    // Individual subscription endpoint format - nested object
    lastComparison?: {
        id: string;
        comparedAt: string;
        duration?: string;
        differenceCount: number;
    };
    health?: {
        database: string | { status: string; lastChecked?: string | null };
        fileSystem: string | { status: string; lastChecked?: string | null };
    };
    createdAt?: string;
    updatedAt?: string;
}

/**
 * Schema difference detected between database and project
 *
 * Fields from list endpoint (/api/comparisons/{comparisonId}/differences):
 * - id, objectType, objectName, action, direction, description, severity, filePath
 *
 * Additional fields from detail endpoint (/api/comparisons/{comparisonId}/differences/{diffId}):
 * - comparisonId, subscriptionId, databaseScript, fileScript, unifiedDiff, sideBySideDiff, propertyChanges
 */
export interface SchemaDifference {
    // Required fields from list endpoint
    id: string;
    objectName: string;
    objectType: string;
    action: 'add' | 'change' | 'delete';
    direction: 'database-only' | 'file-only' | 'different';
    description?: string;
    severity?: 'info' | 'warning' | 'error';
    filePath?: string | null;
    suggestedFilePath?: string | null;
    changeDetails?: string | null;

    // Additional fields from detail endpoint
    comparisonId?: string;
    subscriptionId?: string;
    databaseScript?: string;
    fileScript?: string;
    unifiedDiff?: string | null;
    sideBySideDiff?: string | null;
    propertyChanges?: Array<{ property: string; oldValue: string; newValue: string }>;

    // Legacy fields for backwards compatibility with existing code
    schemaName?: string;
    changeType?: 'Added' | 'Modified' | 'Deleted';
    databaseDefinition?: string;
    fileDefinition?: string;
}

/**
 * Object details for diff viewing
 */
export interface ObjectDetails {
    objectName: string;
    schemaName: string;
    objectType: string;
    databaseDefinition?: string;
    fileDefinition?: string;
    filePath?: string;
}

/**
 * Comparison result from the service
 */
export interface ComparisonResult {
    id: string;
    subscriptionId: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    differenceCount: number;
    durationMs?: number;
    startedAt: string;
    completedAt?: string;
    errorMessage?: string;
}

/**
 * Connection test result
 */
export interface ConnectionTestResult {
    success: boolean;
    error?: string;
    serverVersion?: string;
}

/**
 * Folder validation result
 */
export interface FolderValidationResult {
    isValid: boolean;
    error?: string;
    sqlFileCount?: number;
    detectedStructure?: SqlProjectConfig['structure'];
}

