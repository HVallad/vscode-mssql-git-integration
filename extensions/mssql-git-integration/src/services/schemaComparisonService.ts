/*---------------------------------------------------------------------------------------------
 *  Schema Comparison Service
 *  Compares database objects with sync metadata for fast status detection
 *--------------------------------------------------------------------------------------------*/

import type * as vscodeMssql from "vscode-mssql";
import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import { SyncMetadataService, SyncMetadata } from "./syncMetadataService";

// SQL query to get all database objects with their modify dates
// This is a fast metadata-only query that returns timestamps
const GET_DATABASE_OBJECTS_QUERY = `
SELECT
    s.name AS [schema],
    o.name,
    o.type_desc AS objectType,
    o.type AS objectTypeCode,
    o.modify_date AS modifyDate,
    o.create_date AS createDate,
    o.modify_date AS effectiveModifyDate
FROM sys.objects o
INNER JOIN sys.schemas s ON o.schema_id = s.schema_id
WHERE o.type IN (
    'U',  -- User Table
    'V',  -- View
    'P',  -- Stored Procedure
    'FN', -- Scalar Function
    'IF', -- Inline Table-Valued Function
    'TF'  -- Table-Valued Function
)
AND o.is_ms_shipped = 0
ORDER BY s.name, o.name
`;

// SQL query to get all database objects with content hashes using HASHBYTES
// For SQL modules (procedures, views, functions), we hash the definition from sys.sql_modules
// For tables, we create a hash based on column count and object modify_date
const GET_DATABASE_OBJECTS_WITH_HASHES_QUERY = `
SELECT
    s.name AS [schema],
    o.name,
    o.type_desc AS objectType,
    o.type AS objectTypeCode,
    o.modify_date AS modifyDate,
    o.create_date AS createDate,
    o.modify_date AS effectiveModifyDate,
    CASE
        WHEN o.type IN ('P', 'V', 'FN', 'IF', 'TF', 'TR') AND m.definition IS NOT NULL THEN
            CONVERT(VARCHAR(64), HASHBYTES('SHA2_256', m.definition), 2)
        WHEN o.type = 'U' THEN
            -- For tables, create a hash based on column count and modify_date
            -- This captures structure changes (add/remove columns triggers modify_date update)
            CONVERT(VARCHAR(64), HASHBYTES('SHA2_256',
                CAST(o.object_id AS VARCHAR(20)) + '_' +
                CAST((SELECT COUNT(*) FROM sys.columns c WHERE c.object_id = o.object_id) AS VARCHAR(10)) + '_' +
                CONVERT(VARCHAR(30), o.modify_date, 126)
            ), 2)
        ELSE NULL
    END AS contentHash
FROM sys.objects o
INNER JOIN sys.schemas s ON o.schema_id = s.schema_id
LEFT JOIN sys.sql_modules m ON o.object_id = m.object_id
WHERE o.type IN (
    'U',  -- User Table
    'V',  -- View
    'P',  -- Stored Procedure
    'FN', -- Scalar Function
    'IF', -- Inline Table-Valued Function
    'TF'  -- Table-Valued Function
)
AND o.is_ms_shipped = 0
ORDER BY s.name, o.name
`;

/**
 * Status of a database object compared to the sync metadata
 */
export enum ObjectSyncStatus {
    /** Object is in sync - DB modify date matches metadata */
    InSync = "inSync",
    /** Object exists in both but DB was modified after last sync */
    Modified = "modified",
    /** Object exists in database but not in sync metadata */
    AddedInDatabase = "addedInDb",
    /** Object exists in sync metadata but not in database */
    AddedInProject = "addedInProject",
    /** Status cannot be determined */
    Unknown = "unknown",
}

/**
 * Information about a single object's sync status
 */
export interface ObjectSyncInfo {
    /** Object schema (e.g., "dbo") */
    schema: string;
    /** Object name */
    name: string;
    /** Object type (e.g., "USER_TABLE", "SQL_STORED_PROCEDURE") */
    objectType: string;
    /** Sync status */
    status: ObjectSyncStatus;
    /** Friendly object type name */
    friendlyType: string;
    /** Current database modify date */
    dbModifyDate?: Date;
    /** Last synced modify date from metadata */
    lastSyncedModifyDate?: Date;
    /** Current content hash from database */
    dbContentHash?: string;
    /** Last synced content hash from metadata */
    lastSyncedContentHash?: string;
}

/**
 * Summary of database sync status
 */
export interface DatabaseSyncSummary {
    /** Total number of objects analyzed */
    totalObjects: number;
    /** Count of objects in sync */
    inSync: number;
    /** Count of modified objects */
    modified: number;
    /** Count of objects added in database */
    addedInDatabase: number;
    /** Count of objects added in project/repo */
    addedInProject: number;
    /** Individual object statuses */
    objects: ObjectSyncInfo[];
    /** Whether this was a deep (hash-based) comparison */
    isDeepComparison?: boolean;
}

/**
 * Raw database object returned from the SQL query
 */
export interface DatabaseObjectRow {
    schema: string;
    name: string;
    objectType: string;
    objectTypeCode: string;
    modifyDate: string;
    createDate: string;
    effectiveModifyDate: string;
    contentHash?: string;
}

/**
 * Service for comparing database schema with sync metadata
 */
export class SchemaComparisonService {
    private syncMetadataService: SyncMetadataService;

    constructor() {
        this.syncMetadataService = new SyncMetadataService();
    }

    /**
     * Get the SyncMetadataService instance
     */
    public getSyncMetadataService(): SyncMetadataService {
        return this.syncMetadataService;
    }

    /**
     * Get all database objects with their timestamps
     * This is a fast metadata-only query
     */
    public async getDatabaseObjectsWithTimestamps(
        mssqlApi: vscodeMssql.IExtension,
        connectionUri: string,
    ): Promise<DatabaseObjectRow[]> {
        const result = await mssqlApi.connectionSharing.executeSimpleQuery(
            connectionUri,
            GET_DATABASE_OBJECTS_QUERY,
        );

        if (!result || !result.rows) {
            return [];
        }

        // Map column indices to names for easier access
        const columnMap = new Map<string, number>();
        result.columnInfo.forEach((col, idx) => {
            columnMap.set(col.columnName.toLowerCase(), idx);
        });

        // Parse rows into typed objects
        return result.rows.map((row) => ({
            schema: this.getCellValue(row, columnMap, "schema"),
            name: this.getCellValue(row, columnMap, "name"),
            objectType: this.getCellValue(row, columnMap, "objecttype"),
            objectTypeCode: this.getCellValue(row, columnMap, "objecttypecode"),
            modifyDate: this.getCellValue(row, columnMap, "modifydate"),
            createDate: this.getCellValue(row, columnMap, "createdate"),
            effectiveModifyDate: this.getCellValue(row, columnMap, "effectivemodifydate"),
        }));
    }

    /**
     * Get all database objects with their content hashes using HASHBYTES
     * This is a thorough query that includes content hashes for deep comparison
     */
    public async getDatabaseObjectsWithHashes(
        mssqlApi: vscodeMssql.IExtension,
        connectionUri: string,
    ): Promise<DatabaseObjectRow[]> {
        const result = await mssqlApi.connectionSharing.executeSimpleQuery(
            connectionUri,
            GET_DATABASE_OBJECTS_WITH_HASHES_QUERY,
        );

        if (!result || !result.rows) {
            return [];
        }

        // Map column indices to names for easier access
        const columnMap = new Map<string, number>();
        result.columnInfo.forEach((col, idx) => {
            columnMap.set(col.columnName.toLowerCase(), idx);
        });

        // Parse rows into typed objects including contentHash
        return result.rows.map((row) => ({
            schema: this.getCellValue(row, columnMap, "schema"),
            name: this.getCellValue(row, columnMap, "name"),
            objectType: this.getCellValue(row, columnMap, "objecttype"),
            objectTypeCode: this.getCellValue(row, columnMap, "objecttypecode"),
            modifyDate: this.getCellValue(row, columnMap, "modifydate"),
            createDate: this.getCellValue(row, columnMap, "createdate"),
            effectiveModifyDate: this.getCellValue(row, columnMap, "effectivemodifydate"),
            contentHash: this.getCellValue(row, columnMap, "contenthash") || undefined,
        }));
    }

    /**
     * Helper to get cell value from a row
     */
    private getCellValue(
        row: vscodeMssql.DbCellValue[],
        columnMap: Map<string, number>,
        columnName: string,
    ): string {
        const index = columnMap.get(columnName);
        if (index === undefined) return "";
        const cell = row[index];
        return cell?.displayValue ?? "";
    }

    /**
     * Compare database objects with sync metadata (fast timestamp-based comparison)
     */
    public async compareWithMetadata(
        mssqlApi: vscodeMssql.IExtension,
        connectionUri: string,
        projectPath: string,
    ): Promise<DatabaseSyncSummary> {
        // Get current database objects
        const dbObjects = await this.getDatabaseObjectsWithTimestamps(mssqlApi, connectionUri);

        // Load metadata
        const metadata = await this.syncMetadataService.loadMetadata(projectPath);

        // If no metadata exists, all objects are "new in database"
        if (!metadata) {
            return this.createSummaryAllNew(dbObjects);
        }

        const summary = this.performComparison(dbObjects, metadata, false);
        summary.isDeepComparison = false;
        return summary;
    }

    /**
     * Deep compare database objects with sync metadata (thorough hash-based comparison)
     * This compares content hashes from HASHBYTES and also updates the metadata file
     */
    public async deepCompareWithMetadata(
        mssqlApi: vscodeMssql.IExtension,
        connectionUri: string,
        projectPath: string,
    ): Promise<DatabaseSyncSummary> {
        // Get current database objects WITH hashes
        const dbObjects = await this.getDatabaseObjectsWithHashes(mssqlApi, connectionUri);

        // Load metadata
        const metadata = await this.syncMetadataService.loadMetadata(projectPath);

        // If no metadata exists, all objects are "new in database"
        if (!metadata) {
            const summary = this.createSummaryAllNew(dbObjects);
            summary.isDeepComparison = true;
            return summary;
        }

        const summary = this.performComparison(dbObjects, metadata, true);
        summary.isDeepComparison = true;
        return summary;
    }

    /**
     * Get database objects with hashes for updating metadata after comparison
     * Returns the raw data needed to update the metadata file
     */
    public async getObjectsForMetadataUpdate(
        mssqlApi: vscodeMssql.IExtension,
        connectionUri: string,
    ): Promise<DatabaseObjectRow[]> {
        return this.getDatabaseObjectsWithHashes(mssqlApi, connectionUri);
    }

    /**
     * Create a summary when no metadata exists (all objects are new)
     */
    private createSummaryAllNew(dbObjects: DatabaseObjectRow[]): DatabaseSyncSummary {
        const objects: ObjectSyncInfo[] = dbObjects.map((obj) => ({
            schema: obj.schema,
            name: obj.name,
            objectType: obj.objectType,
            friendlyType: this.getFriendlyTypeName(obj.objectType),
            status: ObjectSyncStatus.AddedInDatabase,
            dbModifyDate: new Date(obj.effectiveModifyDate),
            dbContentHash: obj.contentHash,
        }));

        return {
            totalObjects: objects.length,
            inSync: 0,
            modified: 0,
            addedInDatabase: objects.length,
            addedInProject: 0,
            objects,
        };
    }

    /**
     * Perform the actual comparison between DB objects and metadata
     * @param useHashes If true, compare content hashes instead of just timestamps
     */
    private performComparison(
        dbObjects: DatabaseObjectRow[],
        metadata: SyncMetadata,
        useHashes: boolean = false,
    ): DatabaseSyncSummary {
        const objects: ObjectSyncInfo[] = [];
        const processedKeys = new Set<string>();

        // Check each DB object against metadata
        for (const dbObj of dbObjects) {
            const key = SyncMetadataService.getObjectKey(dbObj.schema, dbObj.name);
            processedKeys.add(key);

            const savedMeta = metadata.objects[key];
            const dbModifyDate = new Date(dbObj.effectiveModifyDate);

            if (!savedMeta) {
                // Object exists in DB but not in metadata
                objects.push({
                    schema: dbObj.schema,
                    name: dbObj.name,
                    objectType: dbObj.objectType,
                    friendlyType: this.getFriendlyTypeName(dbObj.objectType),
                    status: ObjectSyncStatus.AddedInDatabase,
                    dbModifyDate,
                    dbContentHash: dbObj.contentHash,
                });
            } else {
                // Object exists in both - compare based on mode
                const lastSyncedModifyDate = new Date(savedMeta.dbModifyDate);
                let isModified: boolean;

                if (useHashes && dbObj.contentHash && savedMeta.contentHash) {
                    // Hash-based comparison (deep mode)
                    isModified = dbObj.contentHash !== savedMeta.contentHash;
                } else {
                    // Timestamp-based comparison (fast mode)
                    // With some tolerance for milliseconds
                    isModified = dbModifyDate.getTime() > lastSyncedModifyDate.getTime() + 1000;
                }

                objects.push({
                    schema: dbObj.schema,
                    name: dbObj.name,
                    objectType: dbObj.objectType,
                    friendlyType: this.getFriendlyTypeName(dbObj.objectType),
                    status: isModified ? ObjectSyncStatus.Modified : ObjectSyncStatus.InSync,
                    dbModifyDate,
                    lastSyncedModifyDate,
                    dbContentHash: dbObj.contentHash,
                    lastSyncedContentHash: savedMeta.contentHash,
                });
            }
        }

        // Check for objects in metadata but not in DB (deleted from DB or added in project)
        for (const [key, savedMeta] of Object.entries(metadata.objects)) {
            if (!processedKeys.has(key)) {
                const { schema, name } = SyncMetadataService.parseObjectKey(key);
                objects.push({
                    schema,
                    name,
                    objectType: savedMeta.type,
                    friendlyType: this.getFriendlyTypeName(savedMeta.type),
                    status: ObjectSyncStatus.AddedInProject,
                    lastSyncedModifyDate: new Date(savedMeta.dbModifyDate),
                    lastSyncedContentHash: savedMeta.contentHash,
                });
            }
        }

        // Calculate summary counts
        const summary: DatabaseSyncSummary = {
            totalObjects: objects.length,
            inSync: objects.filter((o) => o.status === ObjectSyncStatus.InSync).length,
            modified: objects.filter((o) => o.status === ObjectSyncStatus.Modified).length,
            addedInDatabase: objects.filter((o) => o.status === ObjectSyncStatus.AddedInDatabase).length,
            addedInProject: objects.filter((o) => o.status === ObjectSyncStatus.AddedInProject).length,
            objects,
        };

        return summary;
    }

    /**
     * Get a friendly type name from the SQL Server type description
     */
    private getFriendlyTypeName(objectType: string): string {
        const typeMap: Record<string, string> = {
            USER_TABLE: "Table",
            VIEW: "View",
            SQL_STORED_PROCEDURE: "Stored Procedure",
            SQL_SCALAR_FUNCTION: "Scalar Function",
            SQL_INLINE_TABLE_VALUED_FUNCTION: "Inline Function",
            SQL_TABLE_VALUED_FUNCTION: "Table Function",
            // Also handle the saved types from metadata
            Table: "Table",
            View: "View",
            StoredProcedure: "Stored Procedure",
            ScalarFunction: "Scalar Function",
            InlineFunction: "Inline Function",
            TableFunction: "Table Function",
        };

        return typeMap[objectType] || objectType;
    }

    /**
     * Get a short type code for display
     */
    public getTypeCode(objectType: string): string {
        const typeMap: Record<string, string> = {
            USER_TABLE: "TBL",
            VIEW: "VW",
            SQL_STORED_PROCEDURE: "SP",
            SQL_SCALAR_FUNCTION: "FN",
            SQL_INLINE_TABLE_VALUED_FUNCTION: "IFN",
            SQL_TABLE_VALUED_FUNCTION: "TFN",
            Table: "TBL",
            View: "VW",
            StoredProcedure: "SP",
            ScalarFunction: "FN",
            InlineFunction: "IFN",
            TableFunction: "TFN",
        };

        return typeMap[objectType] || "OBJ";
    }

    /**
     * Calculate SHA-256 hash of a file's content
     * @param filePath Full path to the file
     * @returns Hex-encoded hash string (uppercase to match SQL Server HASHBYTES output)
     */
    public async calculateFileHash(filePath: string): Promise<string | undefined> {
        try {
            const content = await fs.readFile(filePath, "utf-8");
            // Normalize content: remove BOM, normalize line endings
            const normalizedContent = content
                .replace(/^\uFEFF/, "") // Remove BOM
                .replace(/\r\n/g, "\n") // Normalize CRLF to LF
                .trim();

            const hash = crypto.createHash("sha256");
            hash.update(normalizedContent);
            return hash.digest("hex").toUpperCase();
        } catch (error) {
            // File doesn't exist or can't be read
            return undefined;
        }
    }

    /**
     * Calculate hashes for all .sql files in a project folder
     * @param projectPath Root path of the SQL project
     * @returns Map of relative paths to their SHA-256 hashes
     */
    public async calculateProjectFileHashes(
        projectPath: string,
    ): Promise<Map<string, string>> {
        const fileHashes = new Map<string, string>();

        // SQL Project folder structure
        const folders = ["Tables", "Views", "Stored Procedures", "Functions"];

        for (const folder of folders) {
            const folderPath = path.join(projectPath, folder);
            try {
                const files = await fs.readdir(folderPath);
                for (const file of files) {
                    if (file.endsWith(".sql")) {
                        const filePath = path.join(folderPath, file);
                        const relativePath = path.join(folder, file);
                        const hash = await this.calculateFileHash(filePath);
                        if (hash) {
                            fileHashes.set(relativePath, hash);
                        }
                    }
                }
            } catch {
                // Folder doesn't exist, continue
            }
        }

        return fileHashes;
    }

    /**
     * Get the expected file path for a database object in the project
     * @param projectPath Root path of the SQL project
     * @param schema Object schema
     * @param name Object name
     * @param objectType SQL Server object type code
     * @returns Full file path
     */
    public getObjectFilePath(
        projectPath: string,
        schema: string,
        name: string,
        objectType: string,
    ): string {
        const folder = this.getObjectFolder(objectType);
        const fileName = `${schema}.${name}.sql`;
        return path.join(projectPath, folder, fileName);
    }

    /**
     * Get the folder name for an object type
     */
    private getObjectFolder(objectType: string): string {
        const folderMap: Record<string, string> = {
            "U": "Tables",
            "V": "Views",
            "P": "Stored Procedures",
            "FN": "Functions",
            "IF": "Functions",
            "TF": "Functions",
            "USER_TABLE": "Tables",
            "VIEW": "Views",
            "SQL_STORED_PROCEDURE": "Stored Procedures",
            "SQL_SCALAR_FUNCTION": "Functions",
            "SQL_INLINE_TABLE_VALUED_FUNCTION": "Functions",
            "SQL_TABLE_VALUED_FUNCTION": "Functions",
        };
        return folderMap[objectType] || "Other";
    }
}

