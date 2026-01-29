/*---------------------------------------------------------------------------------------------
 *  Sync Status Cache
 *  Caches the sync status of database objects for quick lookup by the context contributor
 *--------------------------------------------------------------------------------------------*/

import { ObjectSyncStatus, ObjectSyncInfo } from "./schemaComparisonService";

/**
 * Key for identifying a database in the cache
 */
export interface DatabaseKey {
    serverName: string;
    databaseName: string;
}

/**
 * Cached sync information for a database
 */
export interface CachedDatabaseSync {
    /** When this cache was last updated */
    lastUpdated: Date;
    /** Whether this was a deep comparison */
    isDeepComparison: boolean;
    /** Map of object key (schema.name) to sync info */
    objects: Map<string, ObjectSyncInfo>;
}

/**
 * Service for caching sync status results for quick lookup
 */
export class SyncStatusCache {
    // Map of database key to cached sync info
    private _cache = new Map<string, CachedDatabaseSync>();

    /**
     * Get the cache key for a database
     */
    public static getDatabaseKey(serverName: string, databaseName: string): string {
        return `${serverName}::${databaseName}`;
    }

    /**
     * Get the object key for looking up in the cache
     */
    public static getObjectKey(schema: string, name: string): string {
        return `${schema}.${name}`;
    }

    /**
     * Update the cache with comparison results
     */
    public updateCache(
        serverName: string,
        databaseName: string,
        objects: ObjectSyncInfo[],
        isDeepComparison: boolean,
    ): void {
        const dbKey = SyncStatusCache.getDatabaseKey(serverName, databaseName);
        const objectMap = new Map<string, ObjectSyncInfo>();

        for (const obj of objects) {
            const objKey = SyncStatusCache.getObjectKey(obj.schema, obj.name);
            objectMap.set(objKey, obj);
        }

        this._cache.set(dbKey, {
            lastUpdated: new Date(),
            isDeepComparison,
            objects: objectMap,
        });
    }

    /**
     * Get sync status for a specific object
     */
    public getObjectStatus(
        serverName: string,
        databaseName: string,
        schema: string,
        objectName: string,
    ): ObjectSyncStatus | undefined {
        const dbKey = SyncStatusCache.getDatabaseKey(serverName, databaseName);
        const cached = this._cache.get(dbKey);

        if (!cached) {
            return undefined;
        }

        const objKey = SyncStatusCache.getObjectKey(schema, objectName);
        const objInfo = cached.objects.get(objKey);

        return objInfo?.status;
    }

    /**
     * Get full sync info for a specific object
     */
    public getObjectInfo(
        serverName: string,
        databaseName: string,
        schema: string,
        objectName: string,
    ): ObjectSyncInfo | undefined {
        const dbKey = SyncStatusCache.getDatabaseKey(serverName, databaseName);
        const cached = this._cache.get(dbKey);

        if (!cached) {
            return undefined;
        }

        const objKey = SyncStatusCache.getObjectKey(schema, objectName);
        return cached.objects.get(objKey);
    }

    /**
     * Check if we have cached data for a database
     */
    public hasCachedData(serverName: string, databaseName: string): boolean {
        const dbKey = SyncStatusCache.getDatabaseKey(serverName, databaseName);
        return this._cache.has(dbKey);
    }

    /**
     * Clear cache for a specific database
     */
    public clearDatabase(serverName: string, databaseName: string): void {
        const dbKey = SyncStatusCache.getDatabaseKey(serverName, databaseName);
        this._cache.delete(dbKey);
    }

    /**
     * Clear all cached data
     */
    public clearAll(): void {
        this._cache.clear();
    }

    /**
     * Get all cached databases
     */
    public getCachedDatabases(): string[] {
        return Array.from(this._cache.keys());
    }
}

