/*---------------------------------------------------------------------------------------------
 *  Service Discovery
 *  Discovers and verifies SQL Comparison Service instances
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { HealthInfo, ServiceInfo } from '../types';

/**
 * Configuration keys for the comparison service
 */
const CONFIG_SECTION = 'mssqlGit.comparisonService';
const CONFIG_ENDPOINT = 'endpoint';
const ENV_SERVICE_URL = 'SQL_COMPARISON_SERVICE_URL';

/**
 * Default ports to scan for the SQL Comparison Service
 */
const DEFAULT_PORTS = [5050, 5051, 5052];

/**
 * Timeout for health check requests (ms)
 */
const HEALTH_CHECK_TIMEOUT = 2000;

/**
 * Service for discovering and verifying SQL Comparison Service instances
 */
export class ServiceDiscovery {
    private cachedEndpoint: string | null = null;
    private cacheExpiry: number = 0;
    private readonly cacheDuration = 60000; // 1 minute cache

    /**
     * Get the configured endpoint from VS Code settings or environment variable
     */
    public getConfiguredEndpoint(): string | undefined {
        // Check workspace settings first
        const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
        const configuredEndpoint = config.get<string>(CONFIG_ENDPOINT);
        if (configuredEndpoint) {
            return this.normalizeEndpoint(configuredEndpoint);
        }

        // Check environment variable
        const envEndpoint = process.env[ENV_SERVICE_URL];
        if (envEndpoint) {
            return this.normalizeEndpoint(envEndpoint);
        }

        return undefined;
    }

    /**
     * Discover an available SQL Comparison Service instance
     * @returns ServiceInfo if a service is found, null otherwise
     */
    public async discoverService(): Promise<ServiceInfo | null> {
        // Check cache first
        if (this.cachedEndpoint && Date.now() < this.cacheExpiry) {
            const health = await this.checkHealth(this.cachedEndpoint);
            if (health) {
                return { endpoint: this.cachedEndpoint, ...health };
            }
            // Cache invalid, clear it
            this.cachedEndpoint = null;
        }

        // Check configured endpoint first
        const configuredEndpoint = this.getConfiguredEndpoint();
        if (configuredEndpoint) {
            const health = await this.checkHealth(configuredEndpoint);
            if (health) {
                this.cacheEndpoint(configuredEndpoint);
                return { endpoint: configuredEndpoint, ...health };
            }
        }

        // Scan default ports
        for (const port of DEFAULT_PORTS) {
            const endpoint = `http://localhost:${port}`;
            const health = await this.checkHealth(endpoint);
            if (health) {
                this.cacheEndpoint(endpoint);
                return { endpoint, ...health };
            }
        }

        return null;
    }

    /**
     * Check if the service is available at the given endpoint
     * @param endpoint The endpoint to check
     * @returns HealthInfo if the service is available, null otherwise
     */
    public async checkHealth(endpoint: string): Promise<HealthInfo | null> {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT);

            const response = await fetch(`${endpoint}/api/health`, {
                method: 'GET',
                signal: controller.signal,
                headers: {
                    'Accept': 'application/json',
                },
            });

            clearTimeout(timeoutId);

            if (response.ok) {
                const data = await response.json();
                return {
                    status: data.status || 'healthy',
                    version: data.version || 'unknown',
                    uptime: data.uptime || 0,
                    activeSubscriptions: data.activeSubscriptions || 0,
                };
            }
        } catch (error) {
            // Service not available at this endpoint
            console.log(`Service not available at ${endpoint}: ${error}`);
        }
        return null;
    }

    /**
     * Clear the cached endpoint
     */
    public clearCache(): void {
        this.cachedEndpoint = null;
        this.cacheExpiry = 0;
    }

    /**
     * Normalize endpoint URL (remove trailing slash)
     */
    private normalizeEndpoint(endpoint: string): string {
        return endpoint.replace(/\/+$/, '');
    }

    /**
     * Cache the discovered endpoint
     */
    private cacheEndpoint(endpoint: string): void {
        this.cachedEndpoint = endpoint;
        this.cacheExpiry = Date.now() + this.cacheDuration;
    }

    /**
     * Get default ports for scanning
     */
    public getDefaultPorts(): number[] {
        return [...DEFAULT_PORTS];
    }
}

