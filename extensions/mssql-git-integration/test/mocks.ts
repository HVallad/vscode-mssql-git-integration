/*---------------------------------------------------------------------------------------------
 *  Mock Implementations
 *  Mock classes for SQL Comparison Service components
 *--------------------------------------------------------------------------------------------*/

import {
    Subscription,
    SchemaDifference,
    HealthInfo,
    ServiceInfo,
} from "../src/types";
import { createMockSubscription, createMockHealthInfo, createMockServiceInfo } from "./utils";

/**
 * Mock implementation of ServiceDiscovery
 */
export class MockServiceDiscovery {
    private mockServiceInfo: ServiceInfo | null = null;
    private mockHealthInfo: HealthInfo | null = null;
    private configuredEndpoint: string | undefined;
    private readonly defaultPorts = [5050, 5051, 5052];

    constructor() {
        // Default to a healthy service
        this.mockServiceInfo = createMockServiceInfo();
        this.mockHealthInfo = createMockHealthInfo();
    }

    /**
     * Set the mock service to be available or unavailable
     */
    public setServiceAvailable(available: boolean): void {
        if (available) {
            this.mockServiceInfo = createMockServiceInfo();
            this.mockHealthInfo = createMockHealthInfo();
        } else {
            this.mockServiceInfo = null;
            this.mockHealthInfo = null;
        }
    }

    /**
     * Set custom service info
     */
    public setServiceInfo(info: ServiceInfo | null): void {
        this.mockServiceInfo = info;
        if (info) {
            this.mockHealthInfo = {
                status: info.status,
                version: info.version,
                uptime: info.uptime,
                activeSubscriptions: info.activeSubscriptions,
            };
        }
    }

    /**
     * Set configured endpoint
     */
    public setConfiguredEndpoint(endpoint: string | undefined): void {
        this.configuredEndpoint = endpoint;
    }

    public async discoverService(): Promise<ServiceInfo | null> {
        return this.mockServiceInfo;
    }

    public async checkHealth(endpoint: string): Promise<HealthInfo | null> {
        if (this.mockServiceInfo && this.mockServiceInfo.endpoint === endpoint) {
            return this.mockHealthInfo;
        }
        return this.mockHealthInfo;
    }

    public getConfiguredEndpoint(): string | undefined {
        return this.configuredEndpoint;
    }

    public clearCache(): void {
        // No-op for mock
    }

    public getDefaultPorts(): number[] {
        return [...this.defaultPorts];
    }
}

/**
 * Mock implementation of SqlComparisonClient
 */
export class MockSqlComparisonClient {
    private mockSubscriptions: Map<string, Subscription> = new Map();
    private mockDifferences: Map<string, SchemaDifference[]> = new Map();
    private isAvailable: boolean = true;
    private mockEndpoint: string = "http://localhost:5050";

    /**
     * Add a mock subscription
     */
    public addMockSubscription(subscription: Subscription): void {
        this.mockSubscriptions.set(subscription.id, subscription);
    }

    /**
     * Add mock differences for a subscription
     */
    public addMockDifferences(subscriptionId: string, differences: SchemaDifference[]): void {
        this.mockDifferences.set(subscriptionId, differences);
    }

    /**
     * Set service availability
     */
    public setServiceAvailable(available: boolean): void {
        this.isAvailable = available;
    }

    /**
     * Reset all mock data
     */
    public reset(): void {
        this.mockSubscriptions.clear();
        this.mockDifferences.clear();
        this.isAvailable = true;
    }

    public async ensureConnected(): Promise<string> {
        if (!this.isAvailable) {
            throw new Error("SQL Comparison Service is not available");
        }
        return this.mockEndpoint;
    }

    public async isServiceAvailable(): Promise<boolean> {
        return this.isAvailable;
    }

    public getEndpoint(): string | null {
        return this.isAvailable ? this.mockEndpoint : null;
    }

    public async getSubscriptions(): Promise<Subscription[]> {
        if (!this.isAvailable) {
            throw new Error("Service unavailable");
        }
        return Array.from(this.mockSubscriptions.values());
    }

    public async getSubscription(subscriptionId: string): Promise<Subscription> {
        const sub = this.mockSubscriptions.get(subscriptionId);
        if (!sub) {
            throw new Error("Subscription not found");
        }
        return sub;
    }

    public async getDifferences(subscriptionId: string): Promise<SchemaDifference[]> {
        return this.mockDifferences.get(subscriptionId) || [];
    }

    public async createSubscription(request: { name: string }): Promise<Subscription> {
        const sub = createMockSubscription({ id: `sub-${Date.now()}`, name: request.name });
        this.mockSubscriptions.set(sub.id, sub);
        return sub;
    }

    public async deleteSubscription(subscriptionId: string): Promise<void> {
        this.mockSubscriptions.delete(subscriptionId);
        this.mockDifferences.delete(subscriptionId);
    }
}

