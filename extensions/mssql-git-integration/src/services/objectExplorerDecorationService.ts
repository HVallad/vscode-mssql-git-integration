/*---------------------------------------------------------------------------------------------
 *  Object Explorer Decoration Service
 *  Manages caching of schema differences for Object Explorer decorations
 *--------------------------------------------------------------------------------------------*/

import type { IConnectionInfo } from "vscode-mssql";
import type { SchemaDifference } from "../types";
import type { SqlComparisonClient } from "./sqlComparisonClient";
import type { GitStatusService, GitLinkInfo } from "./gitStatusService";

/**
 * Cached difference data for a subscription
 */
interface DifferenceCache {
    subscriptionId: string;
    differences: SchemaDifference[];
    differenceCount: number;
    lastFetched: number;
    /** Map of qualified object name to difference for quick lookup */
    differenceMap: Map<string, SchemaDifference>;
}

/**
 * Object types that can have schema differences
 */
const SCRIPTABLE_OBJECT_TYPES = new Set([
    "Table",
    "View",
    "StoredProcedure",
    "UserDefinedFunction",
    "Trigger",
    "Schema",
]);

/**
 * Cache TTL in milliseconds (30 seconds)
 */
const CACHE_TTL_MS = 30000;

/**
 * Service for managing Object Explorer decorations based on schema differences
 */
export class ObjectExplorerDecorationService {
    /** Cache of differences by subscription ID */
    private _differenceCache: Map<string, DifferenceCache> = new Map();

    constructor(
        private readonly _gitStatusService: GitStatusService,
        private readonly _comparisonClient: SqlComparisonClient | undefined,
    ) {}

    /**
     * Check if a node type is a scriptable object that can have differences
     */
    public isScriptableObjectType(nodeType: string): boolean {
        return SCRIPTABLE_OBJECT_TYPES.has(nodeType);
    }

    /**
     * Get the database name by walking up the node tree
     */
    public getDatabaseNameFromNode(node: { nodeType: string; metadata?: { name?: string; metadataTypeName?: string }; parentNode?: unknown }): string | undefined {
        let current: typeof node | undefined = node;

        while (current) {
            if (current.nodeType === "Database" || current.metadata?.metadataTypeName === "Database") {
                return current.metadata?.name;
            }
            current = current.parentNode as typeof node | undefined;
        }

        return undefined;
    }

    /**
     * Get the git link info for a node by finding its parent database
     */
    public getGitLinkInfoForNode(
        node: { nodeType: string; metadata?: { name?: string; metadataTypeName?: string }; parentNode?: unknown; connectionProfile: IConnectionInfo },
    ): GitLinkInfo | undefined {
        const databaseName = this.getDatabaseNameFromNode(node);
        if (!databaseName) {
            return undefined;
        }

        return this._gitStatusService.getGitLinkInfo(node.connectionProfile, databaseName);
    }

    /**
     * Get the qualified object name for matching with differences
     * Format: "schema.objectName" (e.g., "dbo.MyTable" or "BMWSequence.GenerateTestConversionsInserts")
     */
    public getQualifiedObjectName(metadata: { schema?: string; name?: string }): string {
        const schema = metadata.schema || "dbo";
        const name = metadata.name || "";
        return `${schema}.${name}`;
    }

    /**
     * Get cached differences for a subscription, fetching if needed
     */
    public async getDifferencesForSubscription(subscriptionId: string): Promise<DifferenceCache | undefined> {
        if (!this._comparisonClient) {
            return undefined;
        }

        // Check cache
        const cached = this._differenceCache.get(subscriptionId);
        const now = Date.now();

        if (cached && (now - cached.lastFetched) < CACHE_TTL_MS) {
            return cached;
        }

        // Fetch fresh data
        try {
            const differences = await this._comparisonClient.getDifferences(subscriptionId);
            const subscription = await this._comparisonClient.getSubscription(subscriptionId);
            const differenceCount = subscription.differenceCount ?? subscription.lastComparison?.differenceCount ?? differences.length;

            // Build lookup map
            const differenceMap = new Map<string, SchemaDifference>();
            for (const diff of differences) {
                // The API returns objectName as "schema.name" format
                differenceMap.set(diff.objectName.toLowerCase(), diff);
            }

            const cache: DifferenceCache = {
                subscriptionId,
                differences,
                differenceCount,
                lastFetched: now,
                differenceMap,
            };

            this._differenceCache.set(subscriptionId, cache);
            return cache;
        } catch (error) {
            console.warn(`MSSQL Git: Failed to fetch differences for subscription ${subscriptionId}:`, error);
            return undefined;
        }
    }

    /**
     * Get the difference for a specific object, if any
     */
    public async getObjectDifference(
        subscriptionId: string,
        qualifiedObjectName: string,
    ): Promise<SchemaDifference | undefined> {
        const cache = await this.getDifferencesForSubscription(subscriptionId);
        if (!cache) {
            return undefined;
        }

        return cache.differenceMap.get(qualifiedObjectName.toLowerCase());
    }

    /**
     * Get the difference count for a subscription
     */
    public async getDifferenceCount(subscriptionId: string): Promise<number> {
        const cache = await this.getDifferencesForSubscription(subscriptionId);
        return cache?.differenceCount ?? 0;
    }

    /**
     * Invalidate the cache for a subscription
     */
    public invalidateCache(subscriptionId: string): void {
        this._differenceCache.delete(subscriptionId);
    }

    /**
     * Clear all cached data
     */
    public clearAllCaches(): void {
        this._differenceCache.clear();
    }
}

