/*---------------------------------------------------------------------------------------------
 *  SignalR Client
 *  Real-time notification client for SQL Comparison Service
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import {
    DifferencesDetectedEvent,
    ComparisonStartedEvent,
    ComparisonProgressEvent,
    ComparisonCompletedEvent,
    ComparisonFailedEvent,
    FileChangedEvent,
    DatabaseChangedEvent,
    HealthChangedEvent,
    ConnectionStateEvent,
    ServiceShuttingDownEvent,
} from '../types';
import { ServiceDiscovery } from './serviceDiscovery';

/**
 * Connection states for SignalR
 */
export type SignalRConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/**
 * Reconnection delays in milliseconds (exponential backoff)
 */
const RECONNECT_DELAYS = [0, 1000, 2000, 5000, 10000, 30000];

/**
 * SignalR client for real-time notifications from SQL Comparison Service
 */
export class ComparisonServiceSignalR implements vscode.Disposable {
    private connection: any = null;
    private connectionState: SignalRConnectionState = 'disconnected';
    private reconnectAttempt: number = 0;
    private reconnectTimeout: NodeJS.Timeout | null = null;
    private readonly discovery: ServiceDiscovery;
    private hubModule: any = null;
    private disposed: boolean = false;

    // Event emitters for various notification types
    private readonly _onDifferencesDetected = new vscode.EventEmitter<DifferencesDetectedEvent>();
    private readonly _onComparisonStarted = new vscode.EventEmitter<ComparisonStartedEvent>();
    private readonly _onComparisonProgress = new vscode.EventEmitter<ComparisonProgressEvent>();
    private readonly _onComparisonCompleted = new vscode.EventEmitter<ComparisonCompletedEvent>();
    private readonly _onComparisonFailed = new vscode.EventEmitter<ComparisonFailedEvent>();
    private readonly _onFileChanged = new vscode.EventEmitter<FileChangedEvent>();
    private readonly _onDatabaseChanged = new vscode.EventEmitter<DatabaseChangedEvent>();
    private readonly _onHealthChanged = new vscode.EventEmitter<HealthChangedEvent>();
    private readonly _onConnectionStateChanged = new vscode.EventEmitter<ConnectionStateEvent>();
    private readonly _onServiceShuttingDown = new vscode.EventEmitter<ServiceShuttingDownEvent>();

    // Public events
    public readonly onDifferencesDetected = this._onDifferencesDetected.event;
    public readonly onComparisonStarted = this._onComparisonStarted.event;
    public readonly onComparisonProgress = this._onComparisonProgress.event;
    public readonly onComparisonCompleted = this._onComparisonCompleted.event;
    public readonly onComparisonFailed = this._onComparisonFailed.event;
    public readonly onFileChanged = this._onFileChanged.event;
    public readonly onDatabaseChanged = this._onDatabaseChanged.event;
    public readonly onHealthChanged = this._onHealthChanged.event;
    public readonly onSubscriptionHealthChanged = this._onHealthChanged.event; // Alias for subscription health
    public readonly onConnectionStateChanged = this._onConnectionStateChanged.event;
    public readonly onServiceShuttingDown = this._onServiceShuttingDown.event;

    constructor(discovery?: ServiceDiscovery) {
        this.discovery = discovery || new ServiceDiscovery();
    }

    /**
     * Initialize the SignalR client
     */
    public async initialize(): Promise<boolean> {
        try {
            // Dynamically import SignalR to avoid startup errors if not installed
            this.hubModule = await import('@microsoft/signalr');
            return true;
        } catch {
            console.log('SignalR package not available, real-time notifications disabled');
            return false;
        }
    }

    /**
     * Get the current connection state
     */
    public getConnectionState(): SignalRConnectionState {
        return this.connectionState;
    }

    /**
     * Start the SignalR connection
     */
    public async start(): Promise<void> {
        if (!this.hubModule) {
            const initialized = await this.initialize();
            if (!initialized) {
                console.warn('SignalR not available, cannot start connection');
                return;
            }
        }

        if (this.connectionState === 'connected' || this.connectionState === 'connecting') {
            return;
        }

        await this.connect();
    }

    /**
     * Stop the SignalR connection
     */
    public async stop(): Promise<void> {
        this.clearReconnectTimeout();
        if (this.connection) {
            try {
                await this.connection.stop();
            } catch (error) {
                console.error('Error stopping SignalR connection:', error);
            }
            this.connection = null;
        }
        this.updateConnectionState('disconnected');
    }

    /**
     * Dispose of resources
     */
    public dispose(): void {
        this.disposed = true;
        this.stop();
        this._onDifferencesDetected.dispose();
        this._onComparisonStarted.dispose();
        this._onComparisonProgress.dispose();
        this._onComparisonCompleted.dispose();
        this._onComparisonFailed.dispose();
        this._onFileChanged.dispose();
        this._onDatabaseChanged.dispose();
        this._onHealthChanged.dispose();
        this._onConnectionStateChanged.dispose();
        this._onServiceShuttingDown.dispose();
    }

    /**
     * Connect to the SignalR hub
     */
    private async connect(): Promise<void> {
        this.updateConnectionState('connecting');

        const serviceInfo = await this.discovery.discoverService();
        if (!serviceInfo) {
            console.warn('SQL Comparison Service not available');
            this.updateConnectionState('disconnected');
            this.scheduleReconnect();
            return;
        }

        const hubUrl = `${serviceInfo.endpoint}/hubs/sync`;
        await this.createConnection(hubUrl);
    }

    /**
     * Create and configure the SignalR connection
     */
    private async createConnection(hubUrl: string): Promise<void> {
        try {
            this.connection = new this.hubModule.HubConnectionBuilder()
                .withUrl(hubUrl)
                .withAutomaticReconnect(RECONNECT_DELAYS)
                .configureLogging(this.hubModule.LogLevel.Warning)
                .build();

            this.registerEventHandlers();
            this.registerConnectionHandlers();

            await this.connection.start();
            this.reconnectAttempt = 0;
            this.updateConnectionState('connected');
        } catch (error) {
            console.error('Failed to connect to SignalR hub:', error);
            this.updateConnectionState('disconnected');
            this.scheduleReconnect();
        }
    }

    /**
     * Register handlers for SignalR events from the service
     */
    private registerEventHandlers(): void {
        if (!this.connection) return;

        this.connection.on('DifferencesDetected', (data: any) => {
            this._onDifferencesDetected.fire({
                type: 'differences-detected',
                subscriptionId: data.subscriptionId,
                differenceCount: data.differenceCount,
                summary: data.summary,
            });
        });

        this.connection.on('ComparisonStarted', (data: any) => {
            this._onComparisonStarted.fire({
                type: 'comparison-started',
                subscriptionId: data.subscriptionId,
                comparisonId: data.comparisonId,
            });
        });

        this.connection.on('ComparisonProgress', (data: any) => {
            this._onComparisonProgress.fire({
                type: 'comparison-progress',
                subscriptionId: data.subscriptionId,
                phase: data.phase,
                percentComplete: data.percentComplete,
                currentOperation: data.currentOperation,
            });
        });

        this.connection.on('ComparisonCompleted', (data: any) => {
            this._onComparisonCompleted.fire({
                type: 'comparison-completed',
                subscriptionId: data.subscriptionId,
                comparisonId: data.comparisonId,
                differenceCount: data.differenceCount,
                duration: data.duration,
            });
        });

        this.connection.on('ComparisonFailed', (data: any) => {
            this._onComparisonFailed.fire({
                type: 'comparison-failed',
                subscriptionId: data.subscriptionId,
                error: data.error,
            });
        });

        this.connection.on('FileChanged', (data: any) => {
            this._onFileChanged.fire({
                type: 'file-changed',
                subscriptionId: data.subscriptionId,
                filePath: data.filePath,
                changeType: data.changeType,
            });
        });

        this.connection.on('DatabaseChanged', (data: any) => {
            this._onDatabaseChanged.fire({
                type: 'database-changed',
                subscriptionId: data.subscriptionId,
                objectName: data.objectName,
                objectType: data.objectType,
                changeType: data.changeType,
            });
        });

        this.connection.on('HealthChanged', (data: any) => {
            this._onHealthChanged.fire({
                type: 'health-changed',
                subscriptionId: data.subscriptionId,
                health: data.health,
                message: data.message,
            });
        });

        this.connection.on('ServiceShuttingDown', () => {
            this._onServiceShuttingDown.fire({ type: 'service-shutting-down' });
        });
    }

    /**
     * Register connection state handlers
     */
    private registerConnectionHandlers(): void {
        if (!this.connection) return;

        this.connection.onreconnecting((error: any) => {
            console.log('SignalR reconnecting:', error?.message);
            this.updateConnectionState('reconnecting');
        });

        this.connection.onreconnected((connectionId: string) => {
            console.log('SignalR reconnected:', connectionId);
            this.reconnectAttempt = 0;
            this.updateConnectionState('connected');
        });

        this.connection.onclose((error: any) => {
            console.log('SignalR connection closed:', error?.message);
            this.updateConnectionState('disconnected');
            if (!this.disposed) {
                this.scheduleReconnect();
            }
        });
    }

    /**
     * Update connection state and emit event
     */
    private updateConnectionState(state: SignalRConnectionState): void {
        this.connectionState = state;
        this._onConnectionStateChanged.fire({
            type: 'connection-state',
            state,
        });
    }

    /**
     * Schedule a reconnection attempt
     */
    private scheduleReconnect(): void {
        if (this.disposed || this.reconnectTimeout) return;

        const delay = RECONNECT_DELAYS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1)];
        this.reconnectAttempt++;

        this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null;
            if (!this.disposed) {
                this.connect();
            }
        }, delay);
    }

    /**
     * Clear any pending reconnect timeout
     */
    private clearReconnectTimeout(): void {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
    }

    /**
     * Subscribe to a specific subscription's events
     */
    public async subscribeToSubscription(subscriptionId: string): Promise<void> {
        if (this.connection && this.connectionState === 'connected') {
            try {
                await this.connection.invoke('SubscribeToSubscription', subscriptionId);
            } catch (error) {
                console.error('Failed to subscribe to subscription:', error);
            }
        }
    }

    /**
     * Unsubscribe from a specific subscription's events
     */
    public async unsubscribeFromSubscription(subscriptionId: string): Promise<void> {
        if (this.connection && this.connectionState === 'connected') {
            try {
                await this.connection.invoke('UnsubscribeFromSubscription', subscriptionId);
            } catch (error) {
                console.error('Failed to unsubscribe from subscription:', error);
            }
        }
    }
}

