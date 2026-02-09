/*---------------------------------------------------------------------------------------------
 *  Service Event Types
 *  Type definitions for SignalR events from SQL Comparison Service
 *--------------------------------------------------------------------------------------------*/

/**
 * Base interface for all service events
 */
export interface BaseServiceEvent {
    type: string;
}

/**
 * Differences detected event
 */
export interface DifferencesDetectedEvent extends BaseServiceEvent {
    type: 'differences-detected';
    subscriptionId: string;
    differenceCount: number;
    summary: {
        added: number;
        modified: number;
        deleted: number;
    };
}

/**
 * Comparison started event
 */
export interface ComparisonStartedEvent extends BaseServiceEvent {
    type: 'comparison-started';
    subscriptionId: string;
    comparisonId: string;
}

/**
 * Comparison progress event
 */
export interface ComparisonProgressEvent extends BaseServiceEvent {
    type: 'comparison-progress';
    subscriptionId: string;
    phase: string;
    percentComplete: number;
    currentOperation: string;
}

/**
 * Comparison completed event
 */
export interface ComparisonCompletedEvent extends BaseServiceEvent {
    type: 'comparison-completed';
    subscriptionId: string;
    comparisonId: string;
    differenceCount: number;
    duration: number;
}

/**
 * Comparison failed event
 */
export interface ComparisonFailedEvent extends BaseServiceEvent {
    type: 'comparison-failed';
    subscriptionId: string;
    error: string;
}

/**
 * File changed event
 */
export interface FileChangedEvent extends BaseServiceEvent {
    type: 'file-changed';
    subscriptionId: string;
    filePath: string;
    changeType: 'created' | 'modified' | 'deleted';
}

/**
 * Database changed event
 */
export interface DatabaseChangedEvent extends BaseServiceEvent {
    type: 'database-changed';
    subscriptionId: string;
    objectName: string;
    objectType: string;
    changeType: 'created' | 'modified' | 'deleted';
}

/**
 * Subscription health changed event
 */
export interface HealthChangedEvent extends BaseServiceEvent {
    type: 'health-changed';
    subscriptionId: string;
    health: 'healthy' | 'degraded' | 'unhealthy';
    message?: string;
}

/**
 * Connection state changed event
 */
export interface ConnectionStateEvent extends BaseServiceEvent {
    type: 'connection-state';
    state: 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
    error?: string;
}

/**
 * Service shutting down event
 */
export interface ServiceShuttingDownEvent extends BaseServiceEvent {
    type: 'service-shutting-down';
}

/**
 * Union type for all service events
 */
export type ServiceEvent =
    | DifferencesDetectedEvent
    | ComparisonStartedEvent
    | ComparisonProgressEvent
    | ComparisonCompletedEvent
    | ComparisonFailedEvent
    | FileChangedEvent
    | DatabaseChangedEvent
    | HealthChangedEvent
    | ConnectionStateEvent
    | ServiceShuttingDownEvent;

