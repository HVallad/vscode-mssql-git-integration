/*---------------------------------------------------------------------------------------------
 *  Sync Metadata Service
 *  Manages the sync-metadata.json file that stores database object timestamps
 *--------------------------------------------------------------------------------------------*/

import * as fs from "fs/promises";
import * as path from "path";

// Constants for the metadata file
const METADATA_FOLDER = ".mssql-git";
const METADATA_FILE = "sync-metadata.json";
const METADATA_VERSION = "1.0";

/**
 * Metadata for a single database object
 */
export interface ObjectSyncMetadata {
    /** Object type (Table, View, StoredProcedure, etc.) */
    type: string;
    /** Database modify_date from sys.objects */
    dbModifyDate: string;
    /** Database create_date from sys.objects */
    dbCreateDate: string;
    /** Relative path to the .sql file in the project */
    relativePath: string;
    /** When this object was last synced */
    lastSyncedAt: string;
    /** SHA-256 hash of the object's content (from HASHBYTES or scripted content) */
    contentHash?: string;
}

/**
 * The complete sync metadata file structure
 */
export interface SyncMetadata {
    /** Schema version for future migrations */
    version: string;
    /** When the entire metadata file was last updated */
    lastSyncedAt: string;
    /** Database connection information */
    database: {
        server: string;
        name: string;
    };
    /** Map of object keys (schema.name) to their metadata */
    objects: Record<string, ObjectSyncMetadata>;
}

/**
 * Service for managing sync-metadata.json file
 */
export class SyncMetadataService {
    /**
     * Get the path to the metadata folder
     */
    public getMetadataFolderPath(projectPath: string): string {
        return path.join(projectPath, METADATA_FOLDER);
    }

    /**
     * Get the path to the metadata file
     */
    public getMetadataFilePath(projectPath: string): string {
        return path.join(this.getMetadataFolderPath(projectPath), METADATA_FILE);
    }

    /**
     * Check if a metadata file exists for the project
     */
    public async metadataExists(projectPath: string): Promise<boolean> {
        try {
            await fs.access(this.getMetadataFilePath(projectPath));
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Load metadata from the project folder
     */
    public async loadMetadata(projectPath: string): Promise<SyncMetadata | undefined> {
        try {
            const filePath = this.getMetadataFilePath(projectPath);
            const content = await fs.readFile(filePath, "utf-8");
            const metadata = JSON.parse(content) as SyncMetadata;

            // Validate version
            if (metadata.version !== METADATA_VERSION) {
                console.warn(
                    `Metadata version mismatch: expected ${METADATA_VERSION}, got ${metadata.version}`,
                );
            }

            return metadata;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                return undefined; // File doesn't exist
            }
            console.error("Failed to load sync metadata:", error);
            throw error;
        }
    }

    /**
     * Save metadata to the project folder
     */
    public async saveMetadata(projectPath: string, metadata: SyncMetadata): Promise<void> {
        const folderPath = this.getMetadataFolderPath(projectPath);
        const filePath = this.getMetadataFilePath(projectPath);

        // Ensure the .mssql-git folder exists
        try {
            await fs.mkdir(folderPath, { recursive: true });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
                throw error;
            }
        }

        // Write the metadata file with pretty formatting
        const content = JSON.stringify(metadata, null, 2);
        await fs.writeFile(filePath, content, "utf-8");
    }

    /**
     * Initialize a new metadata file for a project
     */
    public async initializeMetadata(
        projectPath: string,
        server: string,
        database: string,
    ): Promise<SyncMetadata> {
        const now = new Date().toISOString();

        const metadata: SyncMetadata = {
            version: METADATA_VERSION,
            lastSyncedAt: now,
            database: {
                server,
                name: database,
            },
            objects: {},
        };

        await this.saveMetadata(projectPath, metadata);
        return metadata;
    }

    /**
     * Update a single object's metadata
     */
    public async updateObjectMetadata(
        projectPath: string,
        objectKey: string,
        objectType: string,
        dbModifyDate: string,
        dbCreateDate: string,
        relativePath: string,
        contentHash?: string,
    ): Promise<void> {
        let metadata = await this.loadMetadata(projectPath);

        if (!metadata) {
            throw new Error("Metadata file not found. Initialize metadata first.");
        }

        const now = new Date().toISOString();

        const objectMetadata: ObjectSyncMetadata = {
            type: objectType,
            dbModifyDate,
            dbCreateDate,
            relativePath,
            lastSyncedAt: now,
        };

        if (contentHash) {
            objectMetadata.contentHash = contentHash;
        }

        metadata.objects[objectKey] = objectMetadata;

        metadata.lastSyncedAt = now;
        await this.saveMetadata(projectPath, metadata);
    }

    /**
     * Update multiple objects' metadata at once (more efficient for batch operations)
     */
    public async updateMultipleObjectMetadata(
        projectPath: string,
        objects: Array<{
            key: string;
            type: string;
            dbModifyDate: string;
            dbCreateDate: string;
            relativePath: string;
            contentHash?: string;
        }>,
    ): Promise<void> {
        let metadata = await this.loadMetadata(projectPath);

        if (!metadata) {
            throw new Error("Metadata file not found. Initialize metadata first.");
        }

        const now = new Date().toISOString();

        for (const obj of objects) {
            const objectMetadata: ObjectSyncMetadata = {
                type: obj.type,
                dbModifyDate: obj.dbModifyDate,
                dbCreateDate: obj.dbCreateDate,
                relativePath: obj.relativePath,
                lastSyncedAt: now,
            };

            if (obj.contentHash) {
                objectMetadata.contentHash = obj.contentHash;
            }

            metadata.objects[obj.key] = objectMetadata;
        }

        metadata.lastSyncedAt = now;
        await this.saveMetadata(projectPath, metadata);
    }

    /**
     * Remove an object from metadata
     */
    public async removeObjectMetadata(
        projectPath: string,
        objectKey: string,
    ): Promise<boolean> {
        let metadata = await this.loadMetadata(projectPath);

        if (!metadata) {
            return false;
        }

        if (objectKey in metadata.objects) {
            delete metadata.objects[objectKey];
            metadata.lastSyncedAt = new Date().toISOString();
            await this.saveMetadata(projectPath, metadata);
            return true;
        }

        return false;
    }

    /**
     * Get the object key for a schema and name
     */
    public static getObjectKey(schema: string, name: string): string {
        return `${schema}.${name}`;
    }

    /**
     * Parse an object key into schema and name
     */
    public static parseObjectKey(key: string): { schema: string; name: string } {
        const dotIndex = key.indexOf(".");
        if (dotIndex === -1) {
            return { schema: "dbo", name: key };
        }
        return {
            schema: key.substring(0, dotIndex),
            name: key.substring(dotIndex + 1),
        };
    }
}

