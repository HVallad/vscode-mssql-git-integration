/*---------------------------------------------------------------------------------------------
 *  SQL Comparison Client
 *  REST API client for the SQL Comparison Service
 *--------------------------------------------------------------------------------------------*/

import {
    CreateSubscriptionRequest,
    Subscription,
    SchemaDifference,
    ObjectDetails,
    ComparisonResult,
    ConnectionTestResult,
    FolderValidationResult,
    DatabaseConnectionInfo,
} from '../types';
import { ServiceDiscovery } from './serviceDiscovery';

/**
 * Error thrown when the service is not available
 */
export class ServiceUnavailableError extends Error {
    constructor(message = 'SQL Comparison Service is not available') {
        super(message);
        this.name = 'ServiceUnavailableError';
    }
}

/**
 * REST API client for the SQL Comparison Service
 */
export class SqlComparisonClient {
    private endpoint: string | null = null;
    private readonly discovery: ServiceDiscovery;

    constructor(discovery?: ServiceDiscovery) {
        this.discovery = discovery || new ServiceDiscovery();
    }

    /**
     * Ensure the service is available and get the endpoint
     */
    public async ensureConnected(): Promise<string> {
        if (this.endpoint) {
            // Verify the cached endpoint is still valid
            const health = await this.discovery.checkHealth(this.endpoint);
            if (health) {
                return this.endpoint;
            }
            this.endpoint = null;
        }

        const serviceInfo = await this.discovery.discoverService();
        if (!serviceInfo) {
            throw new ServiceUnavailableError();
        }

        this.endpoint = serviceInfo.endpoint;
        return this.endpoint;
    }

    /**
     * Check if the service is available
     */
    public async isServiceAvailable(): Promise<boolean> {
        try {
            await this.ensureConnected();
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get the current service endpoint
     */
    public getEndpoint(): string | null {
        return this.endpoint;
    }

    /**
     * Test a database connection
     */
    public async testConnection(connection: DatabaseConnectionInfo): Promise<ConnectionTestResult> {
        const endpoint = await this.ensureConnected();
        const response = await fetch(`${endpoint}/api/connections/test`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(connection),
        });

        if (!response.ok) {
            const error = await this.parseError(response);
            return { success: false, error };
        }

        return await response.json();
    }

    /**
     * Validate a SQL project folder
     */
    public async validateFolder(folderPath: string): Promise<FolderValidationResult> {
        const endpoint = await this.ensureConnected();
        const response = await fetch(`${endpoint}/api/folders/validate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: folderPath }),
        });

        if (!response.ok) {
            const error = await this.parseError(response);
            return { isValid: false, error };
        }

        return await response.json();
    }

    /**
     * Create a new subscription
     */
    public async createSubscription(request: CreateSubscriptionRequest): Promise<Subscription> {
        const endpoint = await this.ensureConnected();
        const response = await fetch(`${endpoint}/api/subscriptions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
        });

        if (!response.ok) {
            const error = await this.parseError(response);
            throw new Error(`Failed to create subscription: ${error}`);
        }

        return await response.json();
    }

    /**
     * Get all subscriptions
     */
    public async getSubscriptions(): Promise<Subscription[]> {
        const endpoint = await this.ensureConnected();
        const response = await fetch(`${endpoint}/api/subscriptions`);

        if (!response.ok) {
            throw new Error(`Failed to get subscriptions: ${response.statusText}`);
        }

        const data = await response.json();
        // Handle both { subscriptions: [...] } and [...] response formats
        return Array.isArray(data) ? data : (data.subscriptions || []);
    }

    /**
     * Get a specific subscription by ID
     */
    public async getSubscription(subscriptionId: string): Promise<Subscription> {
        const endpoint = await this.ensureConnected();
        const response = await fetch(`${endpoint}/api/subscriptions/${subscriptionId}`);

        if (!response.ok) {
            throw new Error(`Failed to get subscription: ${response.statusText}`);
        }

        return await response.json();
    }

    /**
     * Delete a subscription
     */
    public async deleteSubscription(subscriptionId: string): Promise<void> {
        const endpoint = await this.ensureConnected();
        const response = await fetch(`${endpoint}/api/subscriptions/${subscriptionId}`, {
            method: 'DELETE',
        });

        if (!response.ok) {
            const error = await this.parseError(response);
            throw new Error(`Failed to delete subscription: ${error}`);
        }
    }

    /**
     * Trigger a comparison for a subscription
     */
    public async triggerComparison(subscriptionId: string): Promise<ComparisonResult> {
        const endpoint = await this.ensureConnected();
        const response = await fetch(`${endpoint}/api/subscriptions/${subscriptionId}/compare`, {
            method: 'POST',
        });

        if (!response.ok) {
            const error = await this.parseError(response);
            throw new Error(`Failed to trigger comparison: ${error}`);
        }

        return await response.json();
    }

    /**
     * Get differences for a subscription's latest comparison
     */
    public async getDifferences(subscriptionId: string): Promise<SchemaDifference[]> {
        // First get the subscription to find the latest comparison ID
        const subscription = await this.getSubscription(subscriptionId);

        if (!subscription.lastComparison?.id) {
            // No comparison has been run yet
            return [];
        }

        // Fetch differences from the comparison endpoint
        return this.getComparisonDifferences(subscription.lastComparison.id);
    }

    /**
     * Get differences for a specific comparison
     */
    public async getComparisonDifferences(comparisonId: string): Promise<SchemaDifference[]> {
        const endpoint = await this.ensureConnected();
        const response = await fetch(`${endpoint}/api/comparisons/${comparisonId}/differences`);

        if (!response.ok) {
            throw new Error(`Failed to get differences: ${response.statusText}`);
        }

        const data = await response.json();
        // Handle both { comparisonId, differences: [...], totalCount } and [...] response formats
        const differences: SchemaDifference[] = Array.isArray(data) ? data : (data.differences || []);

        // Ensure each difference has the comparisonId for later use
        // The API returns comparisonId at the root level, not in each difference item
        const responseComparisonId = data.comparisonId || comparisonId;
        return differences.map(diff => ({
            ...diff,
            comparisonId: diff.comparisonId || responseComparisonId,
        }));
    }

    /**
     * Get full details for a specific difference including database/file scripts
     * Endpoint: GET /api/comparisons/{comparisonId}/differences/{diffId}
     */
    public async getDifferenceDetails(comparisonId: string, diffId: string): Promise<SchemaDifference> {
        const endpoint = await this.ensureConnected();
        const response = await fetch(
            `${endpoint}/api/comparisons/${comparisonId}/differences/${diffId}`
        );

        if (!response.ok) {
            throw new Error(`Failed to get difference details: ${response.statusText}`);
        }

        return response.json();
    }

    /**
     * Get object details for diff viewing
     */
    public async getObjectDetails(subscriptionId: string, objectName: string): Promise<ObjectDetails> {
        const endpoint = await this.ensureConnected();
        const encodedName = encodeURIComponent(objectName);
        const response = await fetch(
            `${endpoint}/api/subscriptions/${subscriptionId}/objects/${encodedName}`
        );

        if (!response.ok) {
            throw new Error(`Failed to get object details: ${response.statusText}`);
        }

        return await response.json();
    }

    /**
     * Get comparison history for a subscription
     */
    public async getComparisonHistory(subscriptionId: string): Promise<ComparisonResult[]> {
        const endpoint = await this.ensureConnected();
        const response = await fetch(`${endpoint}/api/subscriptions/${subscriptionId}/history`);

        if (!response.ok) {
            throw new Error(`Failed to get comparison history: ${response.statusText}`);
        }

        return await response.json();
    }

    /**
     * Pause a subscription
     */
    public async pauseSubscription(subscriptionId: string): Promise<void> {
        const endpoint = await this.ensureConnected();
        const response = await fetch(`${endpoint}/api/subscriptions/${subscriptionId}/pause`, {
            method: 'POST',
        });

        if (!response.ok) {
            const error = await this.parseError(response);
            throw new Error(`Failed to pause subscription: ${error}`);
        }
    }

    /**
     * Resume a subscription
     */
    public async resumeSubscription(subscriptionId: string): Promise<void> {
        const endpoint = await this.ensureConnected();
        const response = await fetch(`${endpoint}/api/subscriptions/${subscriptionId}/resume`, {
            method: 'POST',
        });

        if (!response.ok) {
            const error = await this.parseError(response);
            throw new Error(`Failed to resume subscription: ${error}`);
        }
    }

    /**
     * Invalidate cache for a subscription
     */
    public async invalidateCache(subscriptionId: string): Promise<void> {
        const endpoint = await this.ensureConnected();
        const response = await fetch(`${endpoint}/api/subscriptions/${subscriptionId}/cache`, {
            method: 'DELETE',
        });

        if (!response.ok) {
            const error = await this.parseError(response);
            throw new Error(`Failed to invalidate cache: ${error}`);
        }
    }

    /**
     * Parse error response from the API
     */
    private async parseError(response: Response): Promise<string> {
        try {
            const data = await response.json();
            return data.error || data.message || response.statusText;
        } catch {
            return response.statusText;
        }
    }
}

