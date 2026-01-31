# SQL Comparison Service Integration Plan

## Executive Summary

This document provides a comprehensive implementation plan for integrating the SQL Comparison Service (.NET background service) with the MSSQL Git Integration VS Code extension. The integration enables real-time schema comparison between SQL Server databases and SQL project files stored in Git repositories.

---

## Table of Contents

1. [Service Installation & Deployment](#1-service-installation--deployment)
2. [Subscription Creation Workflow](#2-subscription-creation-workflow)
3. [Real-Time Notification Handling](#3-real-time-notification-handling)
4. [UI/UX Design for Displaying Differences](#4-uiux-design-for-displaying-differences)
5. [Integration with Existing Commands](#5-integration-with-existing-commands)
6. [Technical Architecture](#6-technical-architecture)
7. [Testing Strategy](#7-testing-strategy)

---

## 1. Service Installation & Deployment

### 1.1 Installation Methods

The SQL Comparison Service can be installed through multiple methods to accommodate different user preferences and enterprise requirements.

#### Method A: Bundled with Extension (Recommended for Simplicity)

The service executable is bundled within the VS Code extension package and extracted on first activation.

**Implementation:**
```
vscode-mssql-git-integration/
├── extensions/mssql-git-integration/
│   ├── bin/
│   │   ├── win-x64/
│   │   │   └── SqlComparisonService.exe
│   │   ├── linux-x64/
│   │   │   └── SqlComparisonService
│   │   └── osx-x64/
│   │       └── SqlComparisonService
│   └── src/
│       └── services/
│           └── serviceManager.ts
```

**Pros:** Zero-configuration, automatic updates with extension
**Cons:** Larger extension size (~50-100MB), platform-specific binaries required

#### Method B: Separate Installation (Recommended for Enterprise)

Users install the service independently via:
- **Windows:** MSI installer or Chocolatey (`choco install sql-comparison-service`)
- **macOS:** Homebrew (`brew install sql-comparison-service`)
- **Linux:** APT/YUM packages or Snap
- **Docker:** `docker pull sqlcomparisonservice:latest`

**Pros:** Independent versioning, lighter extension, easier IT deployment
**Cons:** Additional installation step

#### Method C: On-Demand Download

Extension downloads the appropriate service binary on first use.

```typescript
// src/services/serviceInstaller.ts
async function ensureServiceInstalled(): Promise<string> {
    const servicePath = getServicePath();
    if (!await fs.pathExists(servicePath)) {
        await downloadService(getPlatformUrl());
    }
    return servicePath;
}
```

### 1.2 Deployment Options

| Option | Use Case | Configuration |
|--------|----------|---------------|
| **Local Process** | Development, single user | Extension spawns/manages process |
| **System Service** | Multi-user workstation | Windows Service / systemd |
| **Docker Container** | Isolated environments | `docker-compose` integration |
| **Remote Server** | Team shared service | Configure remote endpoint URL |

### 1.3 Prerequisites and Dependencies

**Runtime Requirements:**
- .NET 8.0 Runtime (bundled or pre-installed)
- SQL Server connectivity (network access to target databases)
- File system access to SQL project folders

**Extension Dependencies:**
- `ms-mssql.mssql` extension (existing dependency)
- VS Code 1.75.0 or later

### 1.4 Service Detection and Verification

The extension must detect whether the service is available and healthy.

```typescript
// src/services/serviceDiscovery.ts
export class ServiceDiscovery {
    private readonly defaultPorts = [5050, 5051, 5052];
    private readonly configuredEndpoint?: string;

    async discoverService(): Promise<ServiceInfo | null> {
        // 1. Check configured endpoint first
        if (this.configuredEndpoint) {
            const health = await this.checkHealth(this.configuredEndpoint);
            if (health) return { endpoint: this.configuredEndpoint, ...health };
        }

        // 2. Scan default ports
        for (const port of this.defaultPorts) {
            const endpoint = `http://localhost:${port}`;
            const health = await this.checkHealth(endpoint);
            if (health) return { endpoint, ...health };
        }

        return null;
    }

    private async checkHealth(endpoint: string): Promise<HealthInfo | null> {
        try {
            const response = await fetch(`${endpoint}/api/health`, {
                timeout: 2000
            });
            if (response.ok) {
                return await response.json();
            }
        } catch {
            return null;
        }
        return null;
    }
}
```

### 1.5 Endpoint Configuration

**VS Code Settings:**
```json
{
    "mssqlGit.comparisonService.endpoint": "http://localhost:5050",
    "mssqlGit.comparisonService.autoStart": true,
    "mssqlGit.comparisonService.autoInstall": true
}
```

**Configuration Priority:**
1. Workspace settings (`.vscode/settings.json`)
2. User settings
3. Environment variable (`SQL_COMPARISON_SERVICE_URL`)
4. Auto-discovery on default ports

### 1.6 Service Lifecycle Management

```typescript
// src/services/serviceManager.ts
export class ServiceManager {
    private process: ChildProcess | null = null;
    private readonly discovery: ServiceDiscovery;

    async ensureRunning(): Promise<string> {
        // Check if already running
        const existing = await this.discovery.discoverService();
        if (existing) return existing.endpoint;

        // Start bundled service
        if (this.config.autoStart) {
            await this.startBundledService();
            return await this.waitForReady();
        }

        throw new Error('SQL Comparison Service not available');
    }

    private async startBundledService(): Promise<void> {
        const servicePath = await ensureServiceInstalled();
        this.process = spawn(servicePath, ['--port', '5050'], {
            detached: false,
            stdio: 'pipe'
        });

        this.process.on('exit', (code) => {
            this.handleServiceExit(code);
        });
    }

    async shutdown(): Promise<void> {
        if (this.process) {
            this.process.kill('SIGTERM');
            this.process = null;
        }
    }
}
```

---

## 2. Subscription Creation Workflow

### 2.1 Workflow Overview

A subscription links a database connection to a SQL project folder for continuous comparison. The creation workflow integrates with the existing "Link Database to Git" functionality.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Subscription Creation Flow                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. User right-clicks database in Object Explorer                       │
│     └─► "Link Database to Git Branch" command                           │
│                                                                          │
│  2. User selects/clones Git repository (existing flow)                  │
│     └─► Repository path and branch captured                             │
│                                                                          │
│  3. [NEW] User configures SQL project folder                            │
│     └─► Select subfolder containing .sql files                          │
│     └─► Configure folder structure (ByObjectType, BySchema, etc.)       │
│                                                                          │
│  4. [NEW] User configures comparison options                            │
│     └─► Object types to include (Tables, Views, SPs, etc.)              │
│     └─► Ignore options (whitespace, comments, column order)             │
│                                                                          │
│  5. [NEW] Extension calls POST /api/subscriptions                       │
│     └─► Creates subscription in SQL Comparison Service                  │
│     └─► Service validates connection and folder                         │
│                                                                          │
│  6. [NEW] Initial comparison triggered automatically                    │
│     └─► POST /api/subscriptions/{id}/compare                           │
│     └─► User sees progress notification                                 │
│                                                                          │
│  7. TreeView updated with subscription status                           │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Enhanced Link Command Implementation

Modify the existing `linkDatabaseToGitBranch` command to create a service subscription:

```typescript
// src/commands.ts - Enhanced linkDatabaseToGitBranch

async function linkDatabaseToGitBranch(
    node: vscodeMssql.ITreeNodeInfo,
    mssqlApi: vscodeMssql.IExtension,
    gitStatusService: GitStatusService,
    comparisonClient: SqlComparisonClient, // NEW
): Promise<void> {
    // ... existing repository selection code ...

    // NEW: Step - Configure SQL Project Folder
    const sqlProjectConfig = await configureSqlProjectFolder(localRepoPath);
    if (!sqlProjectConfig) return;

    // NEW: Step - Configure Comparison Options
    const comparisonOptions = await configureComparisonOptions();
    if (!comparisonOptions) return;

    // NEW: Step - Create Subscription in Service
    const subscription = await createServiceSubscription(
        node.connectionProfile,
        databaseName,
        sqlProjectConfig,
        comparisonOptions,
        comparisonClient
    );

    if (!subscription) return;

    // Persist local link info (existing)
    await gitStatusService.linkDatabaseToGit(
        node.connectionProfile,
        databaseName,
        repoUrl,
        localRepoPath,
        selectedBranch,
        subscription.id // Store subscription ID
    );

    // Refresh and notify
    mssqlApi.objectExplorer.refresh(node);
}
```

### 2.3 SQL Project Folder Configuration

```typescript
// src/workflows/sqlProjectConfig.ts

interface SqlProjectConfig {
    folderPath: string;
    structure: 'flat' | 'by-type' | 'by-schema' | 'by-schema-and-type';
    includePatterns: string[];
    excludePatterns: string[];
}

async function configureSqlProjectFolder(repoPath: string): Promise<SqlProjectConfig | undefined> {
    // Step 1: Ask if SQL files are in root or subfolder
    const folderChoice = await vscode.window.showQuickPick([
        { label: '$(folder) Repository root', value: repoPath },
        { label: '$(folder-opened) Select subfolder...', value: 'browse' }
    ], {
        title: 'SQL Project Location',
        placeHolder: 'Where are your SQL schema files located?'
    });

    if (!folderChoice) return undefined;

    let sqlFolderPath = repoPath;
    if (folderChoice.value === 'browse') {
        const selected = await vscode.window.showOpenDialog({
            defaultUri: vscode.Uri.file(repoPath),
            canSelectFolders: true,
            canSelectFiles: false,
            openLabel: 'Select SQL Folder'
        });
        if (!selected) return undefined;
        sqlFolderPath = selected[0].fsPath;
    }

    // Step 2: Detect or select folder structure
    const detectedStructure = await detectFolderStructure(sqlFolderPath);

    const structureChoice = await vscode.window.showQuickPick([
        { label: 'By Object Type', description: '/Tables, /Views, /StoredProcedures', value: 'by-type' },
        { label: 'By Schema', description: '/dbo, /sales, /hr', value: 'by-schema' },
        { label: 'By Schema and Type', description: '/dbo/Tables, /dbo/Views', value: 'by-schema-and-type' },
        { label: 'Flat', description: 'All .sql files in root', value: 'flat' }
    ], {
        title: 'Folder Structure',
        placeHolder: detectedStructure
            ? `Detected: ${detectedStructure}. Confirm or change.`
            : 'How are your SQL files organized?'
    });

    if (!structureChoice) return undefined;

    return {
        folderPath: sqlFolderPath,
        structure: structureChoice.value as SqlProjectConfig['structure'],
        includePatterns: ['**/*.sql'],
        excludePatterns: ['**/bin/**', '**/obj/**', '**/.git/**']
    };
}
```

### 2.4 Comparison Options Configuration

```typescript
// src/workflows/comparisonOptions.ts

interface ComparisonOptionsConfig {
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

async function configureComparisonOptions(): Promise<ComparisonOptionsConfig | undefined> {
    // Use multi-select for object types
    const objectTypes = await vscode.window.showQuickPick([
        { label: 'Tables', picked: true },
        { label: 'Views', picked: true },
        { label: 'Stored Procedures', picked: true },
        { label: 'Functions', picked: true },
        { label: 'Triggers', picked: true },
        { label: 'Schemas', picked: false }
    ], {
        canPickMany: true,
        title: 'Object Types to Compare',
        placeHolder: 'Select which object types to include'
    });

    if (!objectTypes || objectTypes.length === 0) return undefined;

    // Use multi-select for ignore options
    const ignoreOptions = await vscode.window.showQuickPick([
        { label: 'Ignore Whitespace Differences', picked: true },
        { label: 'Ignore Comment Differences', picked: false },
        { label: 'Ignore Column Order', picked: true }
    ], {
        canPickMany: true,
        title: 'Comparison Options',
        placeHolder: 'Select options for comparison'
    });

    return {
        objectTypes: {
            tables: objectTypes.some(o => o.label === 'Tables'),
            views: objectTypes.some(o => o.label === 'Views'),
            storedProcedures: objectTypes.some(o => o.label === 'Stored Procedures'),
            functions: objectTypes.some(o => o.label === 'Functions'),
            triggers: objectTypes.some(o => o.label === 'Triggers'),
            schemas: objectTypes.some(o => o.label === 'Schemas')
        },
        ignoreOptions: {
            whitespace: ignoreOptions?.some(o => o.label.includes('Whitespace')) ?? true,
            comments: ignoreOptions?.some(o => o.label.includes('Comment')) ?? false,
            columnOrder: ignoreOptions?.some(o => o.label.includes('Column Order')) ?? true
        }
    };
}


### 2.5 Service Subscription API Call

```typescript
// src/services/sqlComparisonClient.ts

interface CreateSubscriptionRequest {
    name: string;
    databaseConnection: {
        server: string;
        database: string;
        authenticationType: 'WindowsIntegrated' | 'SqlServer' | 'AzureAD';
        username?: string;
        password?: string;
        trustServerCertificate?: boolean;
    };
    projectFolder: {
        rootPath: string;
        structure: string;
        includePatterns: string[];
        excludePatterns: string[];
    };
    comparisonOptions: {
        includeTables: boolean;
        includeViews: boolean;
        includeStoredProcedures: boolean;
        includeFunctions: boolean;
        includeTriggers: boolean;
        ignoreWhitespace: boolean;
        ignoreComments: boolean;
        ignoreColumnOrder: boolean;
    };
}

async function createServiceSubscription(
    connectionProfile: vscodeMssql.IConnectionProfile,
    databaseName: string,
    sqlProjectConfig: SqlProjectConfig,
    comparisonOptions: ComparisonOptionsConfig,
    client: SqlComparisonClient
): Promise<Subscription | undefined> {
    const request: CreateSubscriptionRequest = {
        name: `${connectionProfile.server}/${databaseName}`,
        databaseConnection: {
            server: connectionProfile.server,
            database: databaseName,
            authenticationType: mapAuthType(connectionProfile.authenticationType),
            username: connectionProfile.user,
            // Password retrieved securely from credential store
            password: await getStoredPassword(connectionProfile),
            trustServerCertificate: connectionProfile.options?.trustServerCertificate
        },
        projectFolder: {
            rootPath: sqlProjectConfig.folderPath,
            structure: sqlProjectConfig.structure,
            includePatterns: sqlProjectConfig.includePatterns,
            excludePatterns: sqlProjectConfig.excludePatterns
        },
        comparisonOptions: {
            includeTables: comparisonOptions.objectTypes.tables,
            includeViews: comparisonOptions.objectTypes.views,
            includeStoredProcedures: comparisonOptions.objectTypes.storedProcedures,
            includeFunctions: comparisonOptions.objectTypes.functions,
            includeTriggers: comparisonOptions.objectTypes.triggers,
            ignoreWhitespace: comparisonOptions.ignoreOptions.whitespace,
            ignoreComments: comparisonOptions.ignoreOptions.comments,
            ignoreColumnOrder: comparisonOptions.ignoreOptions.columnOrder
        }
    };

    try {
        // Validate connection first
        const testResult = await client.testConnection(request.databaseConnection);
        if (!testResult.success) {
            vscode.window.showErrorMessage(
                `Database connection failed: ${testResult.error}`
            );
            return undefined;
        }

        // Validate folder
        const folderResult = await client.validateFolder(request.projectFolder.rootPath);
        if (!folderResult.isValid) {
            vscode.window.showErrorMessage(
                `SQL project folder validation failed: ${folderResult.error}`
            );
            return undefined;
        }

        // Create subscription
        const subscription = await client.createSubscription(request);

        vscode.window.showInformationMessage(
            `Subscription created. Starting initial comparison...`
        );

        // Trigger initial comparison
        await client.triggerComparison(subscription.id);

        return subscription;
    } catch (error) {
        vscode.window.showErrorMessage(
            `Failed to create subscription: ${error instanceof Error ? error.message : error}`
        );
        return undefined;
    }
}
```

### 2.6 Error Handling and Validation

| Validation Step | API Endpoint | Error Handling |
|-----------------|--------------|----------------|
| Database connectivity | `POST /api/connections/test` | Show connection error with details |
| Folder access | `POST /api/folders/validate` | Prompt to fix path or permissions |
| Duplicate subscription | `POST /api/subscriptions` (409) | Offer to update existing or cancel |
| Service unavailable | Any endpoint (connection refused) | Offer to start service or configure endpoint |

---

## 3. Real-Time Notification Handling

### 3.1 SignalR Connection Architecture

The extension maintains a persistent WebSocket connection to receive real-time updates.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    SignalR Connection Architecture                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   VS Code Extension                    SQL Comparison Service            │
│   ──────────────────                   ──────────────────────            │
│                                                                          │
│   ┌─────────────────────┐             ┌─────────────────────┐           │
│   │  SignalRClient      │◄───────────►│  /hubs/sync         │           │
│   │  (@microsoft/       │  WebSocket  │  (SignalR Hub)      │           │
│   │   signalr)          │             │                     │           │
│   └─────────┬───────────┘             └─────────────────────┘           │
│             │                                                            │
│   ┌─────────┴───────────┐                                               │
│   │  Event Handlers     │                                               │
│   │  ├─ onDifferences   │                                               │
│   │  ├─ onComparison    │                                               │
│   │  ├─ onFileChanged   │                                               │
│   │  ├─ onDbChanged     │                                               │
│   │  └─ onHealthChanged │                                               │
│   └─────────────────────┘                                               │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 SignalR Client Implementation

```typescript
// src/services/signalRClient.ts
import * as signalR from '@microsoft/signalr';

export class ComparisonServiceSignalR {
    private connection: signalR.HubConnection | null = null;
    private readonly eventEmitter = new vscode.EventEmitter<ServiceEvent>();
    public readonly onEvent = this.eventEmitter.event;

    private reconnectAttempts = 0;
    private readonly maxReconnectAttempts = 10;
    private readonly reconnectDelays = [0, 1000, 2000, 5000, 10000, 30000];

    async connect(endpoint: string): Promise<void> {
        const hubUrl = `${endpoint}/hubs/sync`;

        this.connection = new signalR.HubConnectionBuilder()
            .withUrl(hubUrl)
            .withAutomaticReconnect({
                nextRetryDelayInMilliseconds: (context) => {
                    const delay = this.reconnectDelays[
                        Math.min(context.previousRetryCount, this.reconnectDelays.length - 1)
                    ];
                    return delay;
                }
            })
            .configureLogging(signalR.LogLevel.Warning)
            .build();

        this.registerEventHandlers();
        this.registerConnectionHandlers();

        await this.connection.start();
        console.log('SignalR connected to SQL Comparison Service');
    }

    private registerEventHandlers(): void {
        if (!this.connection) return;

        // Differences detected
        this.connection.on('DifferencesDetected', (event: DifferencesDetectedEvent) => {
            this.eventEmitter.fire({
                type: 'differences-detected',
                subscriptionId: event.subscriptionId,
                differenceCount: event.differenceCount,
                summary: event.summary
            });
        });

        // Comparison progress
        this.connection.on('ComparisonStarted', (event: ComparisonStartedEvent) => {
            this.eventEmitter.fire({
                type: 'comparison-started',
                subscriptionId: event.subscriptionId,
                comparisonId: event.comparisonId
            });
        });

        this.connection.on('ComparisonProgress', (event: ComparisonProgressEvent) => {
            this.eventEmitter.fire({
                type: 'comparison-progress',
                subscriptionId: event.subscriptionId,
                phase: event.phase,
                percentComplete: event.percentComplete,
                currentOperation: event.currentOperation
            });
        });

        this.connection.on('ComparisonCompleted', (event: ComparisonCompletedEvent) => {
            this.eventEmitter.fire({
                type: 'comparison-completed',
                subscriptionId: event.subscriptionId,
                comparisonId: event.comparisonId,
                differenceCount: event.differenceCount,
                duration: event.durationMs
            });
        });

        this.connection.on('ComparisonFailed', (event: ComparisonFailedEvent) => {
            this.eventEmitter.fire({
                type: 'comparison-failed',
                subscriptionId: event.subscriptionId,
                error: event.errorMessage
            });
        });

        // Change detection
        this.connection.on('FileChanged', (event: FileChangedEvent) => {
            this.eventEmitter.fire({
                type: 'file-changed',
                subscriptionId: event.subscriptionId,
                filePath: event.filePath,
                changeType: event.changeType
            });
        });

        this.connection.on('DatabaseChanged', (event: DatabaseChangedEvent) => {
            this.eventEmitter.fire({
                type: 'database-changed',
                subscriptionId: event.subscriptionId,
                objectName: event.objectName,
                objectType: event.objectType,
                changeType: event.changeType
            });
        });

        // Subscription health
        this.connection.on('SubscriptionHealthChanged', (event: HealthChangedEvent) => {
            this.eventEmitter.fire({
                type: 'health-changed',
                subscriptionId: event.subscriptionId,
                health: event.health,
                message: event.message
            });
        });

        // Service status
        this.connection.on('ServiceShuttingDown', () => {
            this.eventEmitter.fire({ type: 'service-shutting-down' });
        });
    }
}



### 3.3 Connection State Management

```typescript
// src/services/signalRClient.ts (continued)

private registerConnectionHandlers(): void {
    if (!this.connection) return;

    this.connection.onreconnecting((error) => {
        console.log('SignalR reconnecting...', error);
        this.eventEmitter.fire({
            type: 'connection-state',
            state: 'reconnecting',
            error: error?.message
        });
        this.updateStatusBar('Reconnecting...');
    });

    this.connection.onreconnected((connectionId) => {
        console.log('SignalR reconnected:', connectionId);
        this.reconnectAttempts = 0;
        this.eventEmitter.fire({
            type: 'connection-state',
            state: 'connected'
        });
        this.updateStatusBar('Connected');
        // Re-subscribe to all subscriptions after reconnect
        this.resubscribeAll();
    });

    this.connection.onclose((error) => {
        console.log('SignalR connection closed:', error);
        this.eventEmitter.fire({
            type: 'connection-state',
            state: 'disconnected',
            error: error?.message
        });
        this.updateStatusBar('Disconnected');
        this.attemptManualReconnect();
    });
}

private async attemptManualReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        vscode.window.showErrorMessage(
            'Failed to connect to SQL Comparison Service. Check if the service is running.',
            'Retry', 'Configure'
        ).then(choice => {
            if (choice === 'Retry') {
                this.reconnectAttempts = 0;
                this.connect(this.currentEndpoint);
            } else if (choice === 'Configure') {
                vscode.commands.executeCommand('workbench.action.openSettings',
                    'mssqlGit.comparisonService');
            }
        });
        return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelays[
        Math.min(this.reconnectAttempts, this.reconnectDelays.length - 1)
    ];

    await new Promise(resolve => setTimeout(resolve, delay));

    try {
        await this.connection?.start();
    } catch {
        this.attemptManualReconnect();
    }
}
```

### 3.4 UI Updates from Notifications

```typescript
// src/services/notificationHandler.ts

export class NotificationHandler {
    private readonly statusBar: vscode.StatusBarItem;
    private readonly treeProvider: SubscriptionTreeProvider;
    private readonly diffDecorations: DifferenceDecorationProvider;

    constructor(
        signalR: ComparisonServiceSignalR,
        treeProvider: SubscriptionTreeProvider,
        diffDecorations: DifferenceDecorationProvider
    ) {
        this.statusBar = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left, 100
        );
        this.treeProvider = treeProvider;
        this.diffDecorations = diffDecorations;

        signalR.onEvent(event => this.handleEvent(event));
    }

    private handleEvent(event: ServiceEvent): void {
        switch (event.type) {
            case 'differences-detected':
                this.handleDifferencesDetected(event);
                break;
            case 'comparison-started':
                this.handleComparisonStarted(event);
                break;
            case 'comparison-progress':
                this.handleComparisonProgress(event);
                break;
            case 'comparison-completed':
                this.handleComparisonCompleted(event);
                break;
            case 'comparison-failed':
                this.handleComparisonFailed(event);
                break;
            case 'health-changed':
                this.handleHealthChanged(event);
                break;
        }
    }

    private handleDifferencesDetected(event: DifferencesEvent): void {
        // Update tree view badge
        this.treeProvider.updateDifferenceCount(
            event.subscriptionId,
            event.differenceCount
        );

        // Update status bar
        this.updateStatusBar(event.differenceCount);

        // Show notification for significant changes
        if (event.differenceCount > 0) {
            vscode.window.showInformationMessage(
                `${event.differenceCount} difference(s) detected`,
                'View Differences'
            ).then(choice => {
                if (choice === 'View Differences') {
                    vscode.commands.executeCommand(
                        'mssql-git.showDifferences',
                        event.subscriptionId
                    );
                }
            });
        }
    }

    private handleComparisonProgress(event: ProgressEvent): void {
        // Update status bar with progress
        this.statusBar.text = `$(sync~spin) ${event.phase}: ${event.percentComplete}%`;
        this.statusBar.tooltip = event.currentOperation;

        // Update tree item to show comparing state
        this.treeProvider.setSubscriptionState(
            event.subscriptionId,
            'comparing',
            event.percentComplete
        );
    }

    private handleComparisonCompleted(event: CompletedEvent): void {
        this.statusBar.text = event.differenceCount > 0
            ? `$(warning) ${event.differenceCount} differences`
            : `$(check) Synchronized`;

        this.treeProvider.setSubscriptionState(
            event.subscriptionId,
            'idle'
        );

        // Refresh differences in tree
        this.treeProvider.refreshSubscription(event.subscriptionId);
    }

    private updateStatusBar(differenceCount: number): void {
        if (differenceCount === 0) {
            this.statusBar.text = '$(database) SQL: Synchronized';
            this.statusBar.backgroundColor = undefined;
        } else {
            this.statusBar.text = `$(database) SQL: ${differenceCount} difference(s)`;
            this.statusBar.backgroundColor = new vscode.ThemeColor(
                'statusBarItem.warningBackground'
            );
        }
        this.statusBar.show();
    }
}
```

### 3.5 Event Types Summary

| SignalR Event | UI Update | User Action Available |
|---------------|-----------|----------------------|
| `DifferencesDetected` | Tree badge, Status bar | "View Differences" button |
| `ComparisonStarted` | Tree item shows spinner | None (in progress) |
| `ComparisonProgress` | Status bar % complete | None (in progress) |
| `ComparisonCompleted` | Refresh tree, update counts | View results |
| `ComparisonFailed` | Error notification | Retry option |
| `FileChanged` | Tree decoration | Auto-triggers comparison |
| `DatabaseChanged` | Tree decoration | Auto-triggers comparison |
| `SubscriptionHealthChanged` | Tree item icon/color | Configure/fix option |
| `ServiceShuttingDown` | Warning notification | None |

---

## 4. UI/UX Design for Displaying Differences

### 4.1 TreeView Structure

The extension adds a new TreeView in the Activity Bar for managing subscriptions and viewing differences.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  SQL SCHEMA SYNC                                               [⟳] [+] │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ▼ 📁 localhost\SQLEXPRESS.AdventureWorks ↔ main          ⚠️ 5        │
│    │  ├── ▼ Tables (3)                                                  │
│    │  │   ├── 🔵 dbo.Customer                              [Modified]  │
│    │  │   ├── 🟢 dbo.NewTable                              [DB Only]   │
│    │  │   └── 🔴 dbo.OldTable                              [File Only] │
│    │  ├── ▶ Views (1)                                                   │
│    │  └── ▼ Stored Procedures (1)                                       │
│    │      └── 🔵 dbo.GetCustomerOrders                     [Modified]  │
│    └── ✅ Last sync: 2 minutes ago                                      │
│                                                                          │
│  ▼ 📁 server.Production.Inventory ↔ release/v2.0          ✅           │
│    └── ✅ Synchronized (no differences)                                 │
│                                                                          │
│  ▶ 📁 server.Staging.Orders ↔ develop                      ⏸️ Paused  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘

Legend:
  🔵 Modified - Object exists in both but differs
  🟢 DB Only - Object exists in database but not in files
  🔴 File Only - Object exists in files but not in database
  ⚠️ Badge showing difference count
  ✅ Synchronized / Healthy
  ⏸️ Paused subscription
```

### 4.2 TreeView Provider Implementation

```typescript
// src/views/subscriptionTreeProvider.ts

export class SubscriptionTreeProvider implements vscode.TreeDataProvider<TreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private subscriptions: Map<string, SubscriptionState> = new Map();
    private differences: Map<string, SchemaDifference[]> = new Map();

    constructor(
        private readonly client: SqlComparisonClient,
        private readonly signalR: ComparisonServiceSignalR
    ) {
        // Listen for updates from SignalR
        signalR.onEvent(event => {
            if (event.type === 'comparison-completed' ||
                event.type === 'differences-detected') {
                this.refreshSubscription(event.subscriptionId);
            }
        });
    }

    getTreeItem(element: TreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: TreeItem): Promise<TreeItem[]> {
        if (!element) {
            // Root level: return subscriptions
            return this.getSubscriptionItems();
        }

        if (element instanceof SubscriptionItem) {
            // Subscription level: return object type groups
            return this.getObjectTypeGroups(element.subscription.id);
        }

        if (element instanceof ObjectTypeGroupItem) {
            // Object type group: return individual differences
            return this.getDifferenceItems(
                element.subscriptionId,
                element.objectType
            );
        }

        return [];
    }

    private async getSubscriptionItems(): Promise<SubscriptionItem[]> {
        const subscriptions = await this.client.getSubscriptions();
        return subscriptions.map(sub => new SubscriptionItem(sub));
    }

    private async getObjectTypeGroups(subscriptionId: string): Promise<ObjectTypeGroupItem[]> {
        const differences = await this.fetchDifferences(subscriptionId);

        // Group by object type
        const groups = new Map<string, SchemaDifference[]>();
        for (const diff of differences) {
            const type = diff.objectType;
            if (!groups.has(type)) {
                groups.set(type, []);
            }
            groups.get(type)!.push(diff);
        }

        return Array.from(groups.entries()).map(([type, diffs]) =>
            new ObjectTypeGroupItem(subscriptionId, type, diffs.length)
        );
    }

    private async getDifferenceItems(
        subscriptionId: string,
        objectType: string
    ): Promise<DifferenceItem[]> {
        const differences = this.differences.get(subscriptionId) || [];
        return differences
            .filter(d => d.objectType === objectType)
            .map(d => new DifferenceItem(subscriptionId, d));
    }
}
```


### 4.3 VS Code Diff Editor Integration

When a user clicks on a difference item, open VS Code's built-in diff editor:

```typescript
// src/views/diffViewer.ts

export class DiffViewer {
    private readonly client: SqlComparisonClient;

    async showDiff(subscriptionId: string, difference: SchemaDifference): Promise<void> {
        // Fetch full object details from service
        const objectDetails = await this.client.getObjectDetails(
            subscriptionId,
            difference.objectName
        );

        // Create virtual documents for diff
        const leftUri = vscode.Uri.parse(
            `sql-compare:/${subscriptionId}/database/${difference.schemaName}.${difference.objectName}.sql`
        );
        const rightUri = vscode.Uri.parse(
            `sql-compare:/${subscriptionId}/file/${difference.schemaName}.${difference.objectName}.sql`
        );

        // Register content providers
        this.registerContentProvider(leftUri, objectDetails.databaseDefinition || '-- Object not found in database');
        this.registerContentProvider(rightUri, objectDetails.fileDefinition || '-- Object not found in files');

        // Open diff editor
        const title = `${difference.objectName} (Database ↔ Files)`;
        await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
    }

    async showObjectScript(subscriptionId: string, objectName: string): Promise<void> {
        // Fetch script from service
        const script = await this.client.getObjectScript(subscriptionId, objectName);

        // Create a new untitled document with the script
        const doc = await vscode.workspace.openTextDocument({
            language: 'sql',
            content: script
        });
        await vscode.window.showTextDocument(doc);
    }
}

// Virtual document provider for diff content
export class SqlCompareContentProvider implements vscode.TextDocumentContentProvider {
    private contents = new Map<string, string>();

    provideTextDocumentContent(uri: vscode.Uri): string {
        return this.contents.get(uri.toString()) || '';
    }

    setContent(uri: vscode.Uri, content: string): void {
        this.contents.set(uri.toString(), content);
    }
}
```

### 4.4 Fetching Differences

```typescript
// src/services/sqlComparisonClient.ts

export class SqlComparisonClient {
    private readonly baseUrl: string;

    async getDifferences(subscriptionId: string): Promise<SchemaDifference[]> {
        // Get latest comparison ID
        const comparisons = await this.getComparisonHistory(subscriptionId, 1);
        if (comparisons.length === 0) {
            return [];
        }

        const latestComparison = comparisons[0];

        // Fetch differences for this comparison
        const response = await fetch(
            `${this.baseUrl}/api/comparisons/${latestComparison.id}/differences`
        );

        if (!response.ok) {
            throw new Error(`Failed to fetch differences: ${response.statusText}`);
        }

        return await response.json();
    }

    async getObjectDetails(
        subscriptionId: string,
        objectName: string
    ): Promise<ObjectDetails> {
        const response = await fetch(
            `${this.baseUrl}/api/subscriptions/${subscriptionId}/objects/${encodeURIComponent(objectName)}`
        );

        if (!response.ok) {
            throw new Error(`Failed to fetch object details: ${response.statusText}`);
        }

        return await response.json();
    }

    async getComparisonHistory(
        subscriptionId: string,
        limit: number = 10
    ): Promise<ComparisonResult[]> {
        const response = await fetch(
            `${this.baseUrl}/api/subscriptions/${subscriptionId}/comparisons?limit=${limit}`
        );

        if (!response.ok) {
            throw new Error(`Failed to fetch comparison history: ${response.statusText}`);
        }

        return await response.json();
    }
}
```

### 4.5 Status Bar Integration

```typescript
// src/views/statusBar.ts

export class SchemaSyncStatusBar {
    private readonly item: vscode.StatusBarItem;
    private totalDifferences = 0;
    private isComparing = false;

    constructor() {
        this.item = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
        );
        this.item.command = 'mssql-git.showSubscriptions';
        this.update();
    }

    setComparing(subscriptionName: string): void {
        this.isComparing = true;
        this.item.text = `$(sync~spin) Comparing ${subscriptionName}...`;
        this.item.tooltip = 'Schema comparison in progress';
        this.item.show();
    }

    setDifferenceCount(count: number): void {
        this.isComparing = false;
        this.totalDifferences = count;
        this.update();
    }

    private update(): void {
        if (this.isComparing) return;

        if (this.totalDifferences === 0) {
            this.item.text = '$(database) SQL Sync';
            this.item.tooltip = 'All schemas synchronized';
            this.item.backgroundColor = undefined;
        } else {
            this.item.text = `$(database) SQL Sync: ${this.totalDifferences}`;
            this.item.tooltip = `${this.totalDifferences} schema difference(s) detected`;
            this.item.backgroundColor = new vscode.ThemeColor(
                'statusBarItem.warningBackground'
            );
        }
        this.item.show();
    }

    dispose(): void {
        this.item.dispose();
    }
}
```

### 4.6 Badge and Decoration Updates

```typescript
// src/views/decorations.ts

export class DifferenceDecorationProvider implements vscode.FileDecorationProvider {
    private readonly _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri[]>();
    readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

    private decorations = new Map<string, vscode.FileDecoration>();

    updateDecoration(subscriptionId: string, differenceCount: number): void {
        const uri = vscode.Uri.parse(`sql-subscription:/${subscriptionId}`);

        if (differenceCount === 0) {
            this.decorations.delete(uri.toString());
        } else {
            this.decorations.set(uri.toString(), {
                badge: differenceCount > 99 ? '99+' : String(differenceCount),
                color: new vscode.ThemeColor('problemsWarningIcon.foreground'),
                tooltip: `${differenceCount} difference(s)`
            });
        }

        this._onDidChangeFileDecorations.fire([uri]);
    }

    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        return this.decorations.get(uri.toString());
    }
}
```

### 4.7 Object Explorer Diff Decorations

This section describes how to show git-style diff indicators (Added/Modified/Deleted) directly on individual database objects (tables, stored procedures, views, etc.) within the MSSQL Object Explorer tree.

#### 4.7.1 Current API Limitations

The current `IContextContribution` interface supports:
- `contextProperties` - for `when` clause conditions in menus
- `description` - text displayed next to the node label

It does **not** currently support:
- Icon changes or overlays
- Color decorations (like VS Code's git file decorations)
- Badge indicators

#### 4.7.2 Required MSSQL Extension API Enhancement

To enable git-style decorations, the MSSQL extension's `IContextContribution` interface must be extended:

```typescript
// Proposed enhancement to vscode-mssql.d.ts

export interface IContextContribution {
    /** Existing: Additional context properties for `when` clauses */
    contextProperties?: Record<string, string | boolean>;

    /** Existing: Description text next to the node label */
    description?: string;

    // === NEW PROPERTIES ===

    /**
     * Icon override for the node. Can be:
     * - ThemeIcon name (e.g., "diff-added", "diff-modified", "diff-removed")
     * - Object with light/dark icon paths
     * - Composite icon with base + overlay
     */
    iconOverride?: string | { light: string; dark: string } | CompositeIcon;

    /**
     * Decoration to apply to the node (similar to FileDecoration).
     * Appears as a colored badge/indicator.
     */
    decoration?: NodeDecoration;

    /**
     * CSS color to apply to the label text.
     * Use ThemeColor names for theme compatibility.
     */
    labelColor?: string;
}

export interface NodeDecoration {
    /** Short badge text (1-2 characters): "M", "A", "D", "!" */
    badge?: string;

    /** Tooltip for the decoration */
    tooltip?: string;

    /** Color for the badge/decoration (ThemeColor name) */
    color?: string;

    /** Whether to propagate decoration to parent nodes */
    propagate?: boolean;
}

export interface CompositeIcon {
    /** Base icon (the original object type icon) */
    base: string;

    /** Overlay icon to show in corner (e.g., git status) */
    overlay: string;

    /** Position of overlay: 'top-right' | 'bottom-right' | 'top-left' | 'bottom-left' */
    overlayPosition?: string;
}
```

#### 4.7.3 Object Explorer Context Contributor Implementation

```typescript
// src/services/objectExplorerDecorator.ts

import * as vscode from 'vscode';
import * as vscodeMssql from 'vscode-mssql';

export class SchemaComparisonContextContributor implements vscodeMssql.IContextContributor {
    private differenceCache = new Map<string, SchemaDifference>();
    private linkedDatabases = new Map<string, string>(); // connectionId -> subscriptionId

    constructor(
        private readonly comparisonClient: SqlComparisonClient,
        private readonly stateManager: SubscriptionStateManager
    ) {
        // Listen for difference updates
        this.stateManager.onStateChanged(event => {
            if (event.type === 'differences-updated') {
                this.updateDifferenceCache(event.subscriptionId);
            }
        });
    }

    async contributeContext(
        node: vscodeMssql.ITreeNodeInfo
    ): Promise<vscodeMssql.IContextContribution | undefined> {

        // Check if this node's database is linked to a subscription
        const subscriptionId = this.getSubscriptionForNode(node);
        if (!subscriptionId) {
            return undefined;
        }

        // Handle different node types
        switch (node.nodeType) {
            case 'Database':
                return this.contributeDatabaseContext(node, subscriptionId);

            case 'Table':
            case 'StoredProcedure':
            case 'View':
            case 'UserDefinedFunction':
            case 'Trigger':
                return this.contributeObjectContext(node, subscriptionId);

            case 'Folder':
                // Folders like "Tables", "Stored Procedures" - show aggregate status
                return this.contributeFolderContext(node, subscriptionId);

            default:
                return undefined;
        }
    }

    private async contributeObjectContext(
        node: vscodeMssql.ITreeNodeInfo,
        subscriptionId: string
    ): Promise<vscodeMssql.IContextContribution | undefined> {

        const objectName = this.getQualifiedObjectName(node);
        const difference = this.findDifference(subscriptionId, objectName, node.nodeType);

        if (!difference) {
            // Object is in sync - no decoration needed
            return undefined;
        }

        // Return decoration based on change type
        switch (difference.changeType) {
            case 'Added':
                // Object exists in database but NOT in git project files
                return {
                    contextProperties: {
                        schemaStatus: 'added',
                        hasSchemaDiff: true
                    },
                    description: 'Not in project',
                    decoration: {
                        badge: 'A',
                        tooltip: 'Added: Object exists in database but not in SQL project',
                        color: 'gitDecoration.addedResourceForeground'
                    },
                    labelColor: 'gitDecoration.addedResourceForeground'
                };

            case 'Modified':
                // Object exists in both but definitions differ
                return {
                    contextProperties: {
                        schemaStatus: 'modified',
                        hasSchemaDiff: true
                    },
                    description: 'Modified',
                    decoration: {
                        badge: 'M',
                        tooltip: 'Modified: Definition differs between database and SQL project',
                        color: 'gitDecoration.modifiedResourceForeground'
                    },
                    labelColor: 'gitDecoration.modifiedResourceForeground'
                };

            case 'Deleted':
                // Object exists in git project but NOT in database
                // Note: This is tricky - the node won't exist in OE if deleted from DB
                // This case applies when comparing project -> database direction
                return {
                    contextProperties: {
                        schemaStatus: 'deleted',
                        hasSchemaDiff: true
                    },
                    description: 'Missing from DB',
                    decoration: {
                        badge: 'D',
                        tooltip: 'Deleted: Object exists in SQL project but not in database',
                        color: 'gitDecoration.deletedResourceForeground'
                    },
                    labelColor: 'gitDecoration.deletedResourceForeground'
                };

            default:
                return undefined;
        }
    }

    private async contributeDatabaseContext(
        node: vscodeMssql.ITreeNodeInfo,
        subscriptionId: string
    ): Promise<vscodeMssql.IContextContribution | undefined> {

        const differences = this.stateManager.getDifferences(subscriptionId);
        const count = differences.length;

        if (count === 0) {
            return {
                contextProperties: {
                    gitLinked: true,
                    schemaStatus: 'synced'
                },
                description: '✓ Synced'
            };
        }

        return {
            contextProperties: {
                gitLinked: true,
                schemaStatus: 'differs',
                hasSchemaDiff: true
            },
            description: `${count} diff${count !== 1 ? 's' : ''}`,
            decoration: {
                badge: count > 99 ? '99+' : String(count),
                tooltip: `${count} schema difference(s) detected`,
                color: 'gitDecoration.modifiedResourceForeground',
                propagate: false
            }
        };
    }

    private async contributeFolderContext(
        node: vscodeMssql.ITreeNodeInfo,
        subscriptionId: string
    ): Promise<vscodeMssql.IContextContribution | undefined> {

        // Map folder names to object types
        const folderTypeMap: Record<string, string> = {
            'Tables': 'Table',
            'Views': 'View',
            'Stored Procedures': 'StoredProcedure',
            'Functions': 'UserDefinedFunction',
            'Database Triggers': 'Trigger'
        };

        const folderName = node.label?.toString() || '';
        const objectType = folderTypeMap[folderName];

        if (!objectType) {
            return undefined;
        }

        // Count differences for this object type
        const differences = this.stateManager.getDifferences(subscriptionId);
        const typeDiffs = differences.filter(d => d.objectType === objectType);

        if (typeDiffs.length === 0) {
            return undefined;
        }

        const added = typeDiffs.filter(d => d.changeType === 'Added').length;
        const modified = typeDiffs.filter(d => d.changeType === 'Modified').length;
        const deleted = typeDiffs.filter(d => d.changeType === 'Deleted').length;

        const parts: string[] = [];
        if (added > 0) parts.push(`+${added}`);
        if (modified > 0) parts.push(`~${modified}`);
        if (deleted > 0) parts.push(`-${deleted}`);

        return {
            contextProperties: {
                hasSchemaDiff: true
            },
            description: parts.join(' '),
            decoration: {
                badge: String(typeDiffs.length),
                tooltip: `${typeDiffs.length} difference(s): ${parts.join(', ')}`,
                color: 'gitDecoration.modifiedResourceForeground'
            }
        };
    }

    private getSubscriptionForNode(node: vscodeMssql.ITreeNodeInfo): string | undefined {
        // Walk up to find the database node and check if it's linked
        let current: vscodeMssql.ITreeNodeInfo | undefined = node;

        while (current) {
            if (current.nodeType === 'Database') {
                const connectionId = current.connectionProfile?.id;
                const dbName = current.metadata?.name || current.label?.toString();
                const key = `${connectionId}:${dbName}`;
                return this.linkedDatabases.get(key);
            }
            current = current.parentNode;
        }

        return undefined;
    }

    private getQualifiedObjectName(node: vscodeMssql.ITreeNodeInfo): string {
        const schema = node.metadata?.schema || 'dbo';
        const name = node.metadata?.name || node.label?.toString() || '';
        return `${schema}.${name}`;
    }

    private findDifference(
        subscriptionId: string,
        objectName: string,
        objectType: string
    ): SchemaDifference | undefined {
        const differences = this.stateManager.getDifferences(subscriptionId);
        return differences.find(d =>
            d.objectName === objectName &&
            d.objectType === objectType
        );
    }

    // Called when a database is linked to a subscription
    registerLinkedDatabase(connectionId: string, databaseName: string, subscriptionId: string): void {
        const key = `${connectionId}:${databaseName}`;
        this.linkedDatabases.set(key, subscriptionId);
    }

    // Called when a database is unlinked
    unregisterLinkedDatabase(connectionId: string, databaseName: string): void {
        const key = `${connectionId}:${databaseName}`;
        this.linkedDatabases.delete(key);
    }
}
```

#### 4.7.4 Visual Representation

When implemented, the Object Explorer will display decorations like this:

```
▼ 🔗 Testing (3 diffs)
  ▼ Tables (+1 ~1)
      📋 dbo.Users                    M    ← Modified (yellow/orange)
      📋 dbo.NewTable                 A    ← Added (green) - not in project
      📋 dbo.Orders                        ← No change (default)
  ▼ Stored Procedures (~1)
      📜 dbo.Test1                         ← No change
      📜 dbo.Test2                    M    ← Modified (yellow/orange)
      📜 dbo.Test3                         ← No change
  ▼ Views
      👁 dbo.ActiveUsers                   ← No change
```

**Color Legend:**
| Status | Badge | Color | Meaning |
|--------|-------|-------|---------|
| Added | A | Green (`gitDecoration.addedResourceForeground`) | Object in DB, not in project files |
| Modified | M | Yellow/Orange (`gitDecoration.modifiedResourceForeground`) | Definition differs |
| Deleted | D | Red (`gitDecoration.deletedResourceForeground`) | Object in project, not in DB |

#### 4.7.5 Handling "Deleted" Objects

Objects that exist in the SQL project but are missing from the database present a challenge - they won't appear in the Object Explorer tree (which reflects the database).

**Solutions:**

1. **Virtual Nodes**: Inject placeholder nodes for missing objects
   ```typescript
   // Requires MSSQL extension to support virtual node injection
   export interface IContextContribution {
       // ... existing properties

       /** Virtual child nodes to inject under folder nodes */
       virtualChildren?: VirtualNode[];
   }

   interface VirtualNode {
       label: string;
       objectType: string;
       decoration: NodeDecoration;
       tooltip: string;
   }
   ```

2. **Separate "Missing Objects" View**: Show deleted objects in the Schema Sync TreeView instead

3. **Folder-Level Indicator**: Show "-N" on folder to indicate missing objects
   ```
   ▼ Stored Procedures (~1 -2)    ← 1 modified, 2 missing from DB
   ```

#### 4.7.6 Registration in Extension Activation

```typescript
// src/extension.ts

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    // ... other initialization ...

    // Create the schema comparison context contributor
    const schemaDecorator = new SchemaComparisonContextContributor(
        comparisonClient,
        stateManager
    );

    // Register with MSSQL Object Explorer
    const decoratorDisposable = mssqlApi.objectExplorer.registerContextContributor(
        schemaDecorator
    );
    context.subscriptions.push(decoratorDisposable);

    // When a database is linked, register it for decorations
    gitStatusService.onDatabaseLinked((connectionId, dbName, subscriptionId) => {
        schemaDecorator.registerLinkedDatabase(connectionId, dbName, subscriptionId);
        mssqlApi.objectExplorer.refresh(); // Trigger refresh to apply decorations
    });

    // When differences are detected, refresh the tree
    stateManager.onStateChanged(event => {
        if (event.type === 'differences-updated') {
            mssqlApi.objectExplorer.refresh();
        }
    });
}
```

#### 4.7.7 Right-Click Context Menu for Individual Objects

When a user right-clicks on an object that has schema differences, a context menu option should appear to view the diff directly.

**New Commands:**

```json
{
    "contributes": {
        "commands": [
            {
                "command": "mssql-git.viewObjectDiff",
                "title": "View Schema Difference",
                "icon": "$(diff)",
                "category": "MSSQL Git"
            },
            {
                "command": "mssql-git.compareObjectToProject",
                "title": "Compare to SQL Project",
                "icon": "$(git-compare)",
                "category": "MSSQL Git"
            }
        ],
        "menus": {
            "view/item/context": [
                {
                    "command": "mssql-git.viewObjectDiff",
                    "when": "view == objectExplorer && viewItem =~ /hasSchemaDiff/",
                    "group": "mssqlgit@1"
                },
                {
                    "command": "mssql-git.compareObjectToProject",
                    "when": "view == objectExplorer && viewItem =~ /gitLinked/ && viewItem =~ /Table|StoredProcedure|View|UserDefinedFunction|Trigger/",
                    "group": "mssqlgit@2"
                }
            ]
        }
    }
}
```

**Menu Visibility Logic:**

| Object State | "View Schema Difference" | "Compare to SQL Project" |
|--------------|--------------------------|--------------------------|
| Has difference (A/M/D) | ✅ Visible | ✅ Visible |
| No difference, DB linked | ❌ Hidden | ✅ Visible |
| DB not linked to git | ❌ Hidden | ❌ Hidden |

**Command Implementation:**

```typescript
// src/commands/objectDiffCommands.ts

import * as vscode from 'vscode';
import * as vscodeMssql from 'vscode-mssql';

export function registerObjectDiffCommands(
    context: vscode.ExtensionContext,
    comparisonClient: SqlComparisonClient,
    stateManager: SubscriptionStateManager,
    diffViewer: DiffViewer
): void {

    // View Schema Difference - for objects with detected differences
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'mssql-git.viewObjectDiff',
            async (node: vscodeMssql.ITreeNodeInfo) => {
                await viewObjectDiff(node, stateManager, diffViewer);
            }
        )
    );

    // Compare to SQL Project - for any object in a linked database
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'mssql-git.compareObjectToProject',
            async (node: vscodeMssql.ITreeNodeInfo) => {
                await compareObjectToProject(node, comparisonClient, diffViewer);
            }
        )
    );
}

async function viewObjectDiff(
    node: vscodeMssql.ITreeNodeInfo,
    stateManager: SubscriptionStateManager,
    diffViewer: DiffViewer
): Promise<void> {
    const objectName = getQualifiedObjectName(node);
    const subscriptionId = getSubscriptionIdForNode(node, stateManager);

    if (!subscriptionId) {
        vscode.window.showWarningMessage('Database is not linked to a Git repository.');
        return;
    }

    // Find the cached difference
    const differences = stateManager.getDifferences(subscriptionId);
    const difference = differences.find(d =>
        d.objectName === objectName &&
        d.objectType === node.nodeType
    );

    if (!difference) {
        vscode.window.showInformationMessage(
            `${objectName} is in sync with the SQL project.`
        );
        return;
    }

    // Open the diff viewer
    await diffViewer.showDiff(subscriptionId, difference);
}

async function compareObjectToProject(
    node: vscodeMssql.ITreeNodeInfo,
    comparisonClient: SqlComparisonClient,
    diffViewer: DiffViewer
): Promise<void> {
    const objectName = getQualifiedObjectName(node);
    const subscriptionId = getSubscriptionIdForNode(node);

    if (!subscriptionId) {
        vscode.window.showWarningMessage('Database is not linked to a Git repository.');
        return;
    }

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Comparing ${objectName}...`,
            cancellable: false
        },
        async () => {
            try {
                // Fetch current definitions from service
                const objectDetails = await comparisonClient.getObjectDetails(
                    subscriptionId,
                    objectName
                );

                // Create diff from fetched content
                const difference: SchemaDifference = {
                    objectName,
                    schemaName: node.metadata?.schema || 'dbo',
                    objectType: node.nodeType,
                    changeType: determineChangeType(objectDetails),
                    databaseDefinition: objectDetails.databaseDefinition,
                    fileDefinition: objectDetails.fileDefinition
                };

                if (difference.databaseDefinition === difference.fileDefinition) {
                    vscode.window.showInformationMessage(
                        `${objectName} is identical in database and SQL project.`
                    );
                    return;
                }

                await diffViewer.showDiff(subscriptionId, difference);

            } catch (error) {
                vscode.window.showErrorMessage(
                    `Failed to compare ${objectName}: ${error instanceof Error ? error.message : error}`
                );
            }
        }
    );
}

function getQualifiedObjectName(node: vscodeMssql.ITreeNodeInfo): string {
    const schema = node.metadata?.schema || 'dbo';
    const name = node.metadata?.name || node.label?.toString() || '';
    return `${schema}.${name}`;
}

function determineChangeType(details: ObjectDetails): 'Added' | 'Modified' | 'Deleted' {
    if (!details.fileDefinition) return 'Added';
    if (!details.databaseDefinition) return 'Deleted';
    return 'Modified';
}
```

**User Experience Flow:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│  User right-clicks on "dbo.Test2" (marked with M for Modified)          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Context Menu:                                                           │
│  ┌────────────────────────────────┐                                     │
│  │ 📋 Select Top 1000 Rows        │                                     │
│  │ 📝 Script as CREATE            │                                     │
│  │ ─────────────────────────────  │                                     │
│  │ $(diff) View Schema Difference │  ◄── NEW: Opens diff viewer        │
│  │ $(git-compare) Compare to...   │  ◄── NEW: Force fresh comparison   │
│  │ ─────────────────────────────  │                                     │
│  │ 🔄 Refresh                     │                                     │
│  └────────────────────────────────┘                                     │
│                                                                          │
│  User clicks "View Schema Difference"                                    │
│     │                                                                    │
│     ▼                                                                    │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  dbo.Test2 (Database ↔ SQL Project)                    [x]     │    │
│  ├──────────────────────────┬──────────────────────────────────────┤    │
│  │  Database Version        │  SQL Project Version                 │    │
│  │                          │                                      │    │
│  │  CREATE PROCEDURE        │  CREATE PROCEDURE                    │    │
│  │    [dbo].[Test2]         │    [dbo].[Test2]                     │    │
│  │  AS                      │  AS                                  │    │
│  │  BEGIN                   │  BEGIN                               │    │
│  │ -  SELECT * FROM Users   │ +  SELECT Id, Name FROM Users        │    │
│  │    WHERE Active = 1      │    WHERE Active = 1                  │    │
│  │  END                     │    ORDER BY Name                     │    │
│  │                          │ +END                                 │    │
│  └──────────────────────────┴──────────────────────────────────────┘    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

#### 4.7.8 Required MSSQL Extension Changes

For full git-style decoration support, the MSSQL extension requires these modifications:

| Change | File | Description |
|--------|------|-------------|
| Extend `IContextContribution` | `vscode-mssql.d.ts` | Add `decoration`, `labelColor`, `iconOverride` properties |
| Apply decorations in provider | `objectExplorerProvider.ts` | Read decoration properties and apply to TreeItem |
| Support label colors | `objectExplorerProvider.ts` | Apply `TreeItemLabel` with highlights |
| Virtual node injection | `objectExplorerService.ts` | Support injecting nodes for deleted objects |

**TreeItem decoration application:**

```typescript
// In objectExplorerProvider.ts - _applyContextContributions()

if (contribution.decoration) {
    // Apply badge
    if (contribution.decoration.badge) {
        // VS Code TreeItem doesn't natively support badges on non-file items
        // Workaround: append to description or use custom rendering
        node.description = `${node.description || ''} ${contribution.decoration.badge}`.trim();
    }
}

if (contribution.labelColor) {
    // Use TreeItemLabel for colored text (VS Code 1.70+)
    node.label = {
        label: node.label?.toString() || '',
        highlights: [[0, node.label?.toString().length || 0]] // Full label colored
    };
    // Note: TreeItemLabel highlights use selection color, not custom colors
    // For true custom colors, a FileDecorationProvider with custom URI scheme is needed
}
```

---

## 5. Integration with Existing Commands

### 5.1 Command Mapping

The existing placeholder commands will be implemented using the SQL Comparison Service:

| Existing Command | Service Integration |
|------------------|---------------------|
| `mssql-git.linkDatabaseToGitBranch` | Enhanced to create subscription (Section 2) |
| `mssql-git.unlinkDatabaseFromGitBranch` | Enhanced to delete subscription |
| `mssql-git.compareDatabaseToRepo` | Triggers `POST /api/subscriptions/{id}/compare` |
| `mssql-git.refreshLocalCache` | Triggers service refresh + UI update |

### 5.2 Enhanced Command Implementations

```typescript
// src/commands.ts - Enhanced implementations

async function compareDatabaseToRepo(
    node: vscodeMssql.ITreeNodeInfo,
    gitStatusService: GitStatusService,
    comparisonClient: SqlComparisonClient
): Promise<void> {
    const databaseName = node.metadata?.name || node.label?.toString() || "";

    // Get subscription ID from local storage
    const linkInfo = gitStatusService.getGitLinkInfo(node.connectionProfile, databaseName);
    if (!linkInfo?.subscriptionId) {
        vscode.window.showWarningMessage(
            `Database "${databaseName}" is not linked to a Git repository with schema comparison enabled.`
        );
        return;
    }

    // Trigger comparison with progress
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Comparing ${databaseName} schema...`,
            cancellable: false
        },
        async (progress) => {
            try {
                // Trigger comparison via API
                const comparison = await comparisonClient.triggerComparison(
                    linkInfo.subscriptionId
                );

                // Wait for completion (SignalR will provide real-time updates)
                // For now, poll for completion
                let result = await comparisonClient.waitForComparison(
                    comparison.id,
                    (phase, percent) => {
                        progress.report({
                            message: `${phase} (${percent}%)`,
                            increment: percent
                        });
                    }
                );

                // Show results
                if (result.differenceCount === 0) {
                    vscode.window.showInformationMessage(
                        `Schema is synchronized. No differences found.`
                    );
                } else {
                    const action = await vscode.window.showInformationMessage(
                        `Found ${result.differenceCount} difference(s).`,
                        'View Differences'
                    );
                    if (action === 'View Differences') {
                        vscode.commands.executeCommand(
                            'mssql-git.showDifferences',
                            linkInfo.subscriptionId
                        );
                    }
                }
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Comparison failed: ${error instanceof Error ? error.message : error}`
                );
            }
        }
    );
}

async function refreshLocalCache(
    node: vscodeMssql.ITreeNodeInfo,
    gitStatusService: GitStatusService,
    comparisonClient: SqlComparisonClient,
    treeProvider: SubscriptionTreeProvider
): Promise<void> {
    const databaseName = node.metadata?.name || node.label?.toString() || "";

    const linkInfo = gitStatusService.getGitLinkInfo(node.connectionProfile, databaseName);
    if (!linkInfo?.subscriptionId) {
        vscode.window.showWarningMessage(
            `Database "${databaseName}" is not linked to a Git repository.`
        );
        return;
    }

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Refreshing cache for ${databaseName}...`,
            cancellable: false
        },
        async () => {
            try {
                // Invalidate caches
                await comparisonClient.invalidateCache(linkInfo.subscriptionId);

                // Refresh tree view
                treeProvider.refreshSubscription(linkInfo.subscriptionId);

                vscode.window.showInformationMessage('Cache refreshed successfully.');
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Refresh failed: ${error instanceof Error ? error.message : error}`
                );
            }
        }
    );
}

```

### 5.3 New Commands to Register

Add the following new commands to `package.json`:

```json
{
    "contributes": {
        "commands": [
            {
                "command": "mssql-git.showSubscriptions",
                "title": "Show Schema Sync Subscriptions",
                "category": "MSSQL Git"
            },
            {
                "command": "mssql-git.showDifferences",
                "title": "Show Schema Differences",
                "category": "MSSQL Git"
            },
            {
                "command": "mssql-git.pauseSubscription",
                "title": "Pause Schema Monitoring",
                "category": "MSSQL Git"
            },
            {
                "command": "mssql-git.resumeSubscription",
                "title": "Resume Schema Monitoring",
                "category": "MSSQL Git"
            },
            {
                "command": "mssql-git.configureComparisonOptions",
                "title": "Configure Comparison Options",
                "category": "MSSQL Git"
            },
            {
                "command": "mssql-git.exportDifferences",
                "title": "Export Differences Report",
                "category": "MSSQL Git"
            }
        ],
        "views": {
            "explorer": [
                {
                    "id": "mssql-git.schemaSync",
                    "name": "SQL Schema Sync",
                    "when": "mssqlGit.hasSubscriptions"
                }
            ]
        }
    }
}
```

### 5.4 Enhanced Unlink Command

```typescript
// src/commands.ts - Enhanced unlinkDatabaseFromGitBranch

async function unlinkDatabaseFromGitBranch(
    node: vscodeMssql.ITreeNodeInfo,
    mssqlApi: vscodeMssql.IExtension,
    gitStatusService: GitStatusService,
    comparisonClient: SqlComparisonClient
): Promise<void> {
    const databaseName = node.metadata?.name || node.label?.toString() || "";

    const linkInfo = gitStatusService.getGitLinkInfo(node.connectionProfile, databaseName);

    const confirm = await vscode.window.showWarningMessage(
        `Are you sure you want to unlink "${databaseName}" from git? This will also remove schema comparison subscription.`,
        { modal: true },
        "Unlink"
    );

    if (confirm !== "Unlink") {
        return;
    }

    // Delete subscription from service (if exists)
    if (linkInfo?.subscriptionId) {
        try {
            await comparisonClient.deleteSubscription(linkInfo.subscriptionId);
        } catch (error) {
            console.error('Failed to delete subscription:', error);
            // Continue with local unlink even if service deletion fails
        }
    }

    // Remove local link
    await gitStatusService.unlinkDatabaseFromGit(
        node.connectionProfile,
        databaseName
    );

    mssqlApi.objectExplorer.refresh(node);

    vscode.window.showInformationMessage(
        `Database "${databaseName}" unlinked from git`
    );
}
```

---

## 6. Technical Architecture

### 6.1 Component Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          VS Code Extension                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         Presentation Layer                           │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │    │
│  │  │ TreeView     │  │ StatusBar    │  │ DiffViewer   │              │    │
│  │  │ Provider     │  │ Provider     │  │              │              │    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘              │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    │                                         │
│  ┌─────────────────────────────────┴───────────────────────────────────┐    │
│  │                         Service Layer                                │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │    │
│  │  │ GitStatus    │  │ SqlComparison│  │ Notification │              │    │
│  │  │ Service      │  │ Client       │  │ Handler      │              │    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘              │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    │                                         │
│  ┌─────────────────────────────────┴───────────────────────────────────┐    │
│  │                      Communication Layer                             │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │    │
│  │  │ HTTP Client  │  │ SignalR      │  │ Service      │              │    │
│  │  │ (REST API)   │  │ Client       │  │ Manager      │              │    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘              │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    │                                         │
└────────────────────────────────────┼────────────────────────────────────────┘
                                     │
                           HTTP + WebSocket
                                     │
┌────────────────────────────────────┴────────────────────────────────────────┐
│                        SQL Comparison Service                                │
│                        (http://localhost:5050)                               │
├─────────────────────────────────────────────────────────────────────────────┤
│  REST API: /api/*          │  WebSocket Hub: /hubs/sync                     │
│  - Subscriptions           │  - Real-time notifications                     │
│  - Comparisons             │  - Progress updates                            │
│  - Object details          │  - Change detection events                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 HTTP Client Implementation

```typescript
// src/services/sqlComparisonClient.ts

export class SqlComparisonClient {
    private baseUrl: string;
    private readonly timeout = 30000; // 30 seconds

    constructor(endpoint: string) {
        this.baseUrl = endpoint;
    }

    // Subscription Management
    async createSubscription(request: CreateSubscriptionRequest): Promise<Subscription> {
        return this.post('/api/subscriptions', request);
    }

    async getSubscriptions(): Promise<Subscription[]> {
        return this.get('/api/subscriptions');
    }

    async getSubscription(id: string): Promise<Subscription> {
        return this.get(`/api/subscriptions/${id}`);
    }

    async deleteSubscription(id: string): Promise<void> {
        return this.delete(`/api/subscriptions/${id}`);
    }

    async pauseSubscription(id: string): Promise<void> {
        return this.post(`/api/subscriptions/${id}/pause`, {});
    }

    async resumeSubscription(id: string): Promise<void> {
        return this.post(`/api/subscriptions/${id}/resume`, {});
    }

    // Comparison Operations
    async triggerComparison(subscriptionId: string): Promise<ComparisonInfo> {
        return this.post(`/api/subscriptions/${subscriptionId}/compare`, {});
    }

    async getComparisonResult(comparisonId: string): Promise<ComparisonResult> {
        return this.get(`/api/comparisons/${comparisonId}`);
    }

    // Validation
    async testConnection(connection: DatabaseConnectionInfo): Promise<TestResult> {
        return this.post('/api/connections/test', connection);
    }

    async validateFolder(folderPath: string): Promise<ValidationResult> {
        return this.post('/api/folders/validate', { path: folderPath });
    }

    // Health Check
    async checkHealth(): Promise<HealthInfo> {
        return this.get('/api/health');
    }

    // HTTP Helpers
    private async get<T>(path: string): Promise<T> {
        const response = await fetch(`${this.baseUrl}${path}`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(this.timeout)
        });

        if (!response.ok) {
            throw new ApiError(response.status, await response.text());
        }

        return response.json();
    }

    private async post<T>(path: string, body: unknown): Promise<T> {
        const response = await fetch(`${this.baseUrl}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(this.timeout)
        });

        if (!response.ok) {
            throw new ApiError(response.status, await response.text());
        }

        const text = await response.text();
        return text ? JSON.parse(text) : undefined;
    }

    private async delete(path: string): Promise<void> {
        const response = await fetch(`${this.baseUrl}${path}`, {
            method: 'DELETE',
            signal: AbortSignal.timeout(this.timeout)
        });

        if (!response.ok) {
            throw new ApiError(response.status, await response.text());
        }
    }
}

class ApiError extends Error {
    constructor(public statusCode: number, message: string) {
        super(message);
        this.name = 'ApiError';
    }
}
```


### 6.3 State Management

```typescript
// src/services/stateManager.ts

export class SubscriptionStateManager {
    private subscriptions = new Map<string, SubscriptionState>();
    private differences = new Map<string, SchemaDifference[]>();
    private comparisons = new Map<string, ComparisonResult>();

    private readonly _onStateChanged = new vscode.EventEmitter<StateChangedEvent>();
    readonly onStateChanged = this._onStateChanged.event;

    constructor(
        private readonly client: SqlComparisonClient,
        private readonly signalR: ComparisonServiceSignalR
    ) {
        this.setupSignalRListeners();
    }

    private setupSignalRListeners(): void {
        this.signalR.onEvent(async event => {
            switch (event.type) {
                case 'comparison-completed':
                    await this.refreshSubscription(event.subscriptionId);
                    break;
                case 'differences-detected':
                    await this.refreshDifferences(event.subscriptionId);
                    break;
                case 'health-changed':
                    this.updateHealth(event.subscriptionId, event.health);
                    break;
            }
        });
    }

    async initialize(): Promise<void> {
        const subscriptions = await this.client.getSubscriptions();
        for (const sub of subscriptions) {
            this.subscriptions.set(sub.id, {
                subscription: sub,
                health: 'healthy',
                lastUpdated: new Date()
            });
        }
    }

    async refreshSubscription(subscriptionId: string): Promise<void> {
        const subscription = await this.client.getSubscription(subscriptionId);
        const differences = await this.client.getDifferences(subscriptionId);

        this.subscriptions.set(subscriptionId, {
            subscription,
            health: 'healthy',
            lastUpdated: new Date()
        });
        this.differences.set(subscriptionId, differences);

        this._onStateChanged.fire({
            type: 'subscription-updated',
            subscriptionId,
            differenceCount: differences.length
        });
    }

    getSubscription(id: string): SubscriptionState | undefined {
        return this.subscriptions.get(id);
    }

    getAllSubscriptions(): SubscriptionState[] {
        return Array.from(this.subscriptions.values());
    }

    getDifferences(subscriptionId: string): SchemaDifference[] {
        return this.differences.get(subscriptionId) || [];
    }

    getTotalDifferenceCount(): number {
        let total = 0;
        for (const diffs of this.differences.values()) {
            total += diffs.length;
        }
        return total;
    }
}
```

### 6.4 Caching Strategy

```typescript
// src/services/cacheManager.ts

export class CacheManager {
    private readonly cache = new Map<string, CacheEntry>();
    private readonly maxAge = 5 * 60 * 1000; // 5 minutes

    get<T>(key: string): T | undefined {
        const entry = this.cache.get(key);
        if (!entry) return undefined;

        if (Date.now() - entry.timestamp > this.maxAge) {
            this.cache.delete(key);
            return undefined;
        }

        return entry.data as T;
    }

    set<T>(key: string, data: T): void {
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
    }

    invalidate(keyPattern?: string): void {
        if (!keyPattern) {
            this.cache.clear();
            return;
        }

        for (const key of this.cache.keys()) {
            if (key.includes(keyPattern)) {
                this.cache.delete(key);
            }
        }
    }

    // Cache keys
    static subscriptionsKey = 'subscriptions';
    static differencesKey = (id: string) => `differences:${id}`;
    static objectDetailsKey = (id: string, name: string) => `object:${id}:${name}`;
}
```

### 6.5 Error Handling and Retry Logic

```typescript
// src/services/errorHandler.ts

export class ErrorHandler {
    private readonly retryDelays = [1000, 2000, 5000, 10000];

    async withRetry<T>(
        operation: () => Promise<T>,
        options: RetryOptions = {}
    ): Promise<T> {
        const maxRetries = options.maxRetries ?? 3;
        const retryOn = options.retryOn ?? this.isRetryable;

        let lastError: Error | undefined;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error as Error;

                if (attempt === maxRetries || !retryOn(error as Error)) {
                    break;
                }

                const delay = this.retryDelays[
                    Math.min(attempt, this.retryDelays.length - 1)
                ];
                await this.sleep(delay);
            }
        }

        throw lastError;
    }

    private isRetryable(error: Error): boolean {
        if (error instanceof ApiError) {
            // Retry on server errors (5xx) and some client errors
            return error.statusCode >= 500 ||
                   error.statusCode === 408 || // Request Timeout
                   error.statusCode === 429;   // Too Many Requests
        }

        // Retry on network errors
        return error.message.includes('network') ||
               error.message.includes('ECONNREFUSED') ||
               error.message.includes('timeout');
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    handleError(error: Error, context: string): void {
        console.error(`Error in ${context}:`, error);

        if (error instanceof ApiError) {
            switch (error.statusCode) {
                case 401:
                    vscode.window.showErrorMessage(
                        'Authentication failed. Please check your credentials.'
                    );
                    break;
                case 403:
                    vscode.window.showErrorMessage(
                        'Access denied. You may not have permission for this operation.'
                    );
                    break;
                case 404:
                    vscode.window.showErrorMessage(
                        'Resource not found. It may have been deleted.'
                    );
                    break;
                case 503:
                    vscode.window.showErrorMessage(
                        'SQL Comparison Service is unavailable. Please try again later.'
                    );
                    break;
                default:
                    vscode.window.showErrorMessage(
                        `Operation failed: ${error.message}`
                    );
            }
        } else {
            vscode.window.showErrorMessage(
                `An unexpected error occurred: ${error.message}`
            );
        }
    }
}
```

### 6.6 Extension Activation Flow

```typescript
// src/extension.ts - Enhanced activation

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    console.log("MSSQL Git Integration extension activating...");

    // Initialize services
    const serviceManager = new ServiceManager(context);
    const serviceDiscovery = new ServiceDiscovery();

    let comparisonClient: SqlComparisonClient | undefined;
    let signalRClient: ComparisonServiceSignalR | undefined;

    // Attempt to connect to comparison service
    try {
        const serviceInfo = await serviceDiscovery.discoverService();

        if (serviceInfo) {
            comparisonClient = new SqlComparisonClient(serviceInfo.endpoint);
            signalRClient = new ComparisonServiceSignalR();
            await signalRClient.connect(serviceInfo.endpoint);

            console.log(`Connected to SQL Comparison Service at ${serviceInfo.endpoint}`);
        } else if (context.globalState.get('autoStartService', true)) {
            // Auto-start bundled service
            const endpoint = await serviceManager.ensureRunning();
            comparisonClient = new SqlComparisonClient(endpoint);
            signalRClient = new ComparisonServiceSignalR();
            await signalRClient.connect(endpoint);
        }
    } catch (error) {
        console.warn('SQL Comparison Service not available:', error);
        // Extension continues to work, but without comparison features
    }

    // Initialize state manager
    const stateManager = comparisonClient && signalRClient
        ? new SubscriptionStateManager(comparisonClient, signalRClient)
        : undefined;

    if (stateManager) {
        await stateManager.initialize();
    }

    // Initialize UI components
    const treeProvider = new SubscriptionTreeProvider(comparisonClient, signalRClient);
    const statusBar = new SchemaSyncStatusBar();
    const notificationHandler = comparisonClient && signalRClient
        ? new NotificationHandler(signalRClient, treeProvider, statusBar)
        : undefined;

    // Register tree view
    const treeView = vscode.window.createTreeView('mssql-git.schemaSync', {
        treeDataProvider: treeProvider,
        showCollapseAll: true
    });
    context.subscriptions.push(treeView);

    // Register commands with enhanced implementations
    registerCommands(context, mssqlApi, gitStatusService, comparisonClient, treeProvider);

    // Cleanup on deactivation
    context.subscriptions.push({
        dispose: () => {
            serviceManager.shutdown();
            signalRClient?.disconnect();
            statusBar.dispose();
        }
    });

    console.log("MSSQL Git Integration extension activated!");
}
```


---

## 7. Testing Strategy

### 7.1 Overview

The testing strategy covers three levels of testing to ensure robust integration:

| Level | Scope | Tools | Coverage Target |
|-------|-------|-------|-----------------|
| Unit Tests | Individual components | Jest, Mocha | 80%+ |
| Integration Tests | Component interactions | Jest + Mock Service | 70%+ |
| End-to-End Tests | Full user workflows | VS Code Test Runner | Critical paths |

### 7.2 Unit Testing

#### 7.2.1 Mock Service Implementation

```typescript
// test/mocks/mockSqlComparisonService.ts

export class MockSqlComparisonService {
    private subscriptions = new Map<string, Subscription>();
    private differences = new Map<string, SchemaDifference[]>();
    private shouldFail = false;
    private failureError: Error | undefined;

    // Test configuration
    setShouldFail(fail: boolean, error?: Error): void {
        this.shouldFail = fail;
        this.failureError = error;
    }

    addMockSubscription(subscription: Subscription): void {
        this.subscriptions.set(subscription.id, subscription);
    }

    addMockDifferences(subscriptionId: string, differences: SchemaDifference[]): void {
        this.differences.set(subscriptionId, differences);
    }

    // Mock implementations
    async createSubscription(request: CreateSubscriptionRequest): Promise<Subscription> {
        this.throwIfConfigured();
        const subscription: Subscription = {
            id: `sub-${Date.now()}`,
            name: request.name,
            databaseConnection: request.databaseConnection,
            sqlProjectPath: request.sqlProjectPath,
            state: 'Active',
            createdAt: new Date().toISOString()
        };
        this.subscriptions.set(subscription.id, subscription);
        return subscription;
    }

    async getSubscriptions(): Promise<Subscription[]> {
        this.throwIfConfigured();
        return Array.from(this.subscriptions.values());
    }

    async getSubscription(id: string): Promise<Subscription> {
        this.throwIfConfigured();
        const sub = this.subscriptions.get(id);
        if (!sub) throw new Error(`Subscription ${id} not found`);
        return sub;
    }

    async deleteSubscription(id: string): Promise<void> {
        this.throwIfConfigured();
        this.subscriptions.delete(id);
        this.differences.delete(id);
    }

    async getDifferences(subscriptionId: string): Promise<SchemaDifference[]> {
        this.throwIfConfigured();
        return this.differences.get(subscriptionId) || [];
    }

    async triggerComparison(subscriptionId: string): Promise<ComparisonInfo> {
        this.throwIfConfigured();
        return {
            id: `cmp-${Date.now()}`,
            subscriptionId,
            status: 'InProgress',
            startedAt: new Date().toISOString()
        };
    }

    async checkHealth(): Promise<HealthInfo> {
        this.throwIfConfigured();
        return {
            status: 'Healthy',
            version: '1.0.0',
            uptime: '00:30:00'
        };
    }

    private throwIfConfigured(): void {
        if (this.shouldFail) {
            throw this.failureError || new Error('Mock service error');
        }
    }

    reset(): void {
        this.subscriptions.clear();
        this.differences.clear();
        this.shouldFail = false;
        this.failureError = undefined;
    }
}
```

#### 7.2.2 Component Unit Tests

```typescript
// test/services/sqlComparisonClient.test.ts

import { SqlComparisonClient } from '../../src/services/sqlComparisonClient';
import { MockSqlComparisonService } from '../mocks/mockSqlComparisonService';

describe('SqlComparisonClient', () => {
    let client: SqlComparisonClient;
    let mockService: MockSqlComparisonService;

    beforeEach(() => {
        mockService = new MockSqlComparisonService();
        // In real tests, use nock or msw to mock HTTP
        client = new SqlComparisonClient('http://localhost:5050');
    });

    afterEach(() => {
        mockService.reset();
    });

    describe('createSubscription', () => {
        it('should create subscription with valid request', async () => {
            const request = {
                name: 'Test Subscription',
                databaseConnection: {
                    serverName: 'localhost',
                    databaseName: 'TestDB',
                    authenticationType: 'SqlLogin' as const,
                    userName: 'sa',
                    password: 'password'
                },
                sqlProjectPath: '/path/to/project'
            };

            const result = await client.createSubscription(request);

            expect(result.id).toBeDefined();
            expect(result.name).toBe('Test Subscription');
            expect(result.state).toBe('Active');
        });

        it('should throw on network error', async () => {
            // Configure mock to fail
            mockService.setShouldFail(true, new Error('ECONNREFUSED'));

            await expect(client.createSubscription({
                name: 'Test',
                databaseConnection: {} as any,
                sqlProjectPath: '/path'
            })).rejects.toThrow();
        });
    });

    describe('getDifferences', () => {
        it('should return empty array for synced subscription', async () => {
            mockService.addMockSubscription({
                id: 'sub-1',
                name: 'Test',
                state: 'Active'
            } as Subscription);

            const differences = await client.getDifferences('sub-1');

            expect(differences).toEqual([]);
        });

        it('should return differences when they exist', async () => {
            mockService.addMockSubscription({
                id: 'sub-1',
                name: 'Test',
                state: 'Active'
            } as Subscription);
            mockService.addMockDifferences('sub-1', [
                {
                    objectName: 'dbo.Users',
                    objectType: 'Table',
                    changeType: 'Modified',
                    schemaName: 'dbo'
                }
            ]);

            const differences = await client.getDifferences('sub-1');

            expect(differences).toHaveLength(1);
            expect(differences[0].objectName).toBe('dbo.Users');
        });
    });
});
```


#### 7.2.3 SignalR Client Tests

```typescript
// test/services/signalRClient.test.ts

import { ComparisonServiceSignalR } from '../../src/services/signalRClient';

describe('ComparisonServiceSignalR', () => {
    let signalR: ComparisonServiceSignalR;

    beforeEach(() => {
        signalR = new ComparisonServiceSignalR();
    });

    afterEach(async () => {
        await signalR.disconnect();
    });

    describe('connection management', () => {
        it('should report disconnected initially', () => {
            expect(signalR.isConnected()).toBe(false);
        });

        it('should handle connection failure gracefully', async () => {
            await expect(signalR.connect('http://invalid-host:9999'))
                .rejects.toThrow();
            expect(signalR.isConnected()).toBe(false);
        });
    });

    describe('event handling', () => {
        it('should register and unregister event handlers', () => {
            const handler = jest.fn();

            signalR.onEvent(handler);
            // Simulate event emission (in real implementation)

            expect(handler).not.toHaveBeenCalled(); // No connection, no events
        });
    });
});
```

#### 7.2.4 TreeView Provider Tests

```typescript
// test/views/subscriptionTreeProvider.test.ts

import { SubscriptionTreeProvider, SubscriptionItem, DifferenceItem } from '../../src/views/subscriptionTreeProvider';
import { MockSqlComparisonService } from '../mocks/mockSqlComparisonService';

describe('SubscriptionTreeProvider', () => {
    let provider: SubscriptionTreeProvider;
    let mockService: MockSqlComparisonService;

    beforeEach(() => {
        mockService = new MockSqlComparisonService();
        provider = new SubscriptionTreeProvider(mockService as any, undefined);
    });

    describe('getTreeItem', () => {
        it('should return correct tree item for subscription', () => {
            const subscription: Subscription = {
                id: 'sub-1',
                name: 'MyDatabase',
                state: 'Active',
                databaseConnection: {
                    serverName: 'localhost',
                    databaseName: 'MyDB'
                }
            } as Subscription;

            const item = new SubscriptionItem(subscription, 5);
            const treeItem = provider.getTreeItem(item);

            expect(treeItem.label).toBe('MyDatabase');
            expect(treeItem.description).toBe('5 differences');
            expect(treeItem.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Collapsed);
        });

        it('should show synced status for zero differences', () => {
            const subscription: Subscription = {
                id: 'sub-1',
                name: 'SyncedDB',
                state: 'Active'
            } as Subscription;

            const item = new SubscriptionItem(subscription, 0);
            const treeItem = provider.getTreeItem(item);

            expect(treeItem.description).toBe('Synced');
        });
    });

    describe('getChildren', () => {
        it('should return subscriptions at root level', async () => {
            mockService.addMockSubscription({
                id: 'sub-1',
                name: 'Database1',
                state: 'Active'
            } as Subscription);
            mockService.addMockSubscription({
                id: 'sub-2',
                name: 'Database2',
                state: 'Active'
            } as Subscription);

            const children = await provider.getChildren();

            expect(children).toHaveLength(2);
            expect(children[0]).toBeInstanceOf(SubscriptionItem);
        });

        it('should return differences under subscription', async () => {
            mockService.addMockSubscription({
                id: 'sub-1',
                name: 'Database1',
                state: 'Active'
            } as Subscription);
            mockService.addMockDifferences('sub-1', [
                { objectName: 'dbo.Users', objectType: 'Table', changeType: 'Added' },
                { objectName: 'dbo.Orders', objectType: 'Table', changeType: 'Modified' }
            ] as SchemaDifference[]);

            const subscription = new SubscriptionItem(
                { id: 'sub-1', name: 'Database1' } as Subscription,
                2
            );
            const children = await provider.getChildren(subscription);

            expect(children).toHaveLength(2);
            expect(children[0]).toBeInstanceOf(DifferenceItem);
        });
    });
});
```

### 7.3 Integration Testing

#### 7.3.1 Mock HTTP Server for Integration Tests

```typescript
// test/integration/mockServer.ts

import { setupServer } from 'msw/node';
import { rest } from 'msw';

export function createMockServer() {
    const subscriptions: Subscription[] = [];
    const differences: Map<string, SchemaDifference[]> = new Map();

    const handlers = [
        // Health check
        rest.get('http://localhost:5050/api/health', (req, res, ctx) => {
            return res(ctx.json({ status: 'Healthy', version: '1.0.0' }));
        }),

        // List subscriptions
        rest.get('http://localhost:5050/api/subscriptions', (req, res, ctx) => {
            return res(ctx.json(subscriptions));
        }),

        // Create subscription
        rest.post('http://localhost:5050/api/subscriptions', async (req, res, ctx) => {
            const body = await req.json();
            const newSub: Subscription = {
                id: `sub-${Date.now()}`,
                ...body,
                state: 'Active',
                createdAt: new Date().toISOString()
            };
            subscriptions.push(newSub);
            return res(ctx.status(201), ctx.json(newSub));
        }),

        // Get subscription
        rest.get('http://localhost:5050/api/subscriptions/:id', (req, res, ctx) => {
            const sub = subscriptions.find(s => s.id === req.params.id);
            if (!sub) return res(ctx.status(404));
            return res(ctx.json(sub));
        }),

        // Delete subscription
        rest.delete('http://localhost:5050/api/subscriptions/:id', (req, res, ctx) => {
            const index = subscriptions.findIndex(s => s.id === req.params.id);
            if (index === -1) return res(ctx.status(404));
            subscriptions.splice(index, 1);
            differences.delete(req.params.id as string);
            return res(ctx.status(204));
        }),

        // Trigger comparison
        rest.post('http://localhost:5050/api/subscriptions/:id/compare', (req, res, ctx) => {
            const sub = subscriptions.find(s => s.id === req.params.id);
            if (!sub) return res(ctx.status(404));
            return res(ctx.json({
                id: `cmp-${Date.now()}`,
                subscriptionId: req.params.id,
                status: 'Completed',
                differenceCount: differences.get(req.params.id as string)?.length || 0
            }));
        })
    ];

    const server = setupServer(...handlers);

    return {
        server,
        addSubscription: (sub: Subscription) => subscriptions.push(sub),
        addDifferences: (subId: string, diffs: SchemaDifference[]) => differences.set(subId, diffs),
        reset: () => {
            subscriptions.length = 0;
            differences.clear();
        }
    };
}
```


#### 7.3.2 Full Workflow Integration Tests

```typescript
// test/integration/subscription.integration.test.ts

import { createMockServer } from './mockServer';
import { SqlComparisonClient } from '../../src/services/sqlComparisonClient';

describe('Subscription Workflow Integration', () => {
    const { server, addDifferences, reset } = createMockServer();
    let client: SqlComparisonClient;

    beforeAll(() => server.listen());
    afterEach(() => reset());
    afterAll(() => server.close());

    beforeEach(() => {
        client = new SqlComparisonClient('http://localhost:5050');
    });

    it('should complete full subscription lifecycle', async () => {
        // 1. Create subscription
        const subscription = await client.createSubscription({
            name: 'Integration Test DB',
            databaseConnection: {
                serverName: 'localhost',
                databaseName: 'IntegrationTestDB',
                authenticationType: 'SqlLogin',
                userName: 'sa',
                password: 'password'
            },
            sqlProjectPath: '/test/project'
        });
        expect(subscription.id).toBeDefined();
        expect(subscription.state).toBe('Active');

        // 2. Verify subscription appears in list
        const subscriptions = await client.getSubscriptions();
        expect(subscriptions).toHaveLength(1);
        expect(subscriptions[0].name).toBe('Integration Test DB');

        // 3. Trigger comparison
        const comparison = await client.triggerComparison(subscription.id);
        expect(comparison.status).toBe('Completed');
        expect(comparison.differenceCount).toBe(0);

        // 4. Delete subscription
        await client.deleteSubscription(subscription.id);

        // 5. Verify deletion
        const remaining = await client.getSubscriptions();
        expect(remaining).toHaveLength(0);
    });

    it('should handle differences detection', async () => {
        // Create subscription
        const subscription = await client.createSubscription({
            name: 'DB with Changes',
            databaseConnection: {
                serverName: 'localhost',
                databaseName: 'ChangedDB'
            } as any,
            sqlProjectPath: '/test/project'
        });

        // Simulate service detecting differences
        addDifferences(subscription.id, [
            { objectName: 'dbo.Users', objectType: 'Table', changeType: 'Added' },
            { objectName: 'dbo.GetUser', objectType: 'StoredProcedure', changeType: 'Modified' }
        ] as any);

        // Trigger comparison
        const comparison = await client.triggerComparison(subscription.id);

        expect(comparison.differenceCount).toBe(2);
    });
});
```

### 7.4 End-to-End Testing

#### 7.4.1 VS Code Extension Test Configuration

```typescript
// test/e2e/runTest.ts

import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
    const extensionDevelopmentPath = path.resolve(__dirname, '../../');
    const extensionTestsPath = path.resolve(__dirname, './suite/index');

    await runTests({
        extensionDevelopmentPath,
        extensionTestsPath,
        launchArgs: [
            '--disable-extensions',
            path.resolve(__dirname, '../../test/fixtures/test-workspace')
        ]
    });
}

main().catch(err => {
    console.error('Failed to run tests', err);
    process.exit(1);
});
```

#### 7.4.2 E2E Test Scenarios

```typescript
// test/e2e/suite/linkDatabase.e2e.test.ts

import * as vscode from 'vscode';
import * as assert from 'assert';

suite('Link Database to Git E2E', () => {
    suiteSetup(async () => {
        // Wait for extension to activate
        const ext = vscode.extensions.getExtension('your-publisher.mssql-git-integration');
        await ext?.activate();
    });

    test('should show link command in command palette', async () => {
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes('mssql-git.linkDatabaseToGitBranch'));
    });

    test('should show schema sync tree view when subscriptions exist', async () => {
        // Create a subscription via API (test fixture)
        // ...

        // Verify tree view is visible
        const treeView = vscode.window.createTreeView('mssql-git.schemaSync', {
            treeDataProvider: {
                getTreeItem: () => new vscode.TreeItem('Test'),
                getChildren: () => []
            }
        });

        assert.ok(treeView);
        treeView.dispose();
    });
});
```

### 7.5 User Acceptance Test Scenarios

The following scenarios should be tested manually or via automated E2E tests:

#### Scenario 1: First-Time Setup
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Install extension | Extension appears in extensions list |
| 2 | Open database in Object Explorer | Database node visible |
| 3 | Right-click database → Link to Git | Multi-step wizard appears |
| 4 | Select/clone Git repository | Repository cloned or selected |
| 5 | Choose SQL project folder | Folder validated |
| 6 | Configure comparison options | Options saved |
| 7 | Complete wizard | Success notification, git icon on database |

#### Scenario 2: Schema Difference Detection
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Link database with differences | Subscription created |
| 2 | Wait for initial comparison | Status bar shows difference count |
| 3 | Open Schema Sync view | Subscription visible in tree |
| 4 | Expand subscription | Differences grouped by type |
| 5 | Click on difference | Diff viewer opens |
| 6 | Compare left/right panels | Database vs. file content shown |

#### Scenario 3: Real-Time Updates
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Link database to git | Subscription active |
| 2 | Modify table in SSMS | Wait up to poll interval |
| 3 | Observe extension | Notification appears |
| 4 | Check tree view | New difference shown |
| 5 | Check status bar | Count incremented |

#### Scenario 4: Service Unavailable
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Stop SQL Comparison Service | Service offline |
| 2 | Open VS Code | Extension activates without error |
| 3 | Attempt to link database | Error message with setup instructions |
| 4 | Start service | Service runs |
| 5 | Retry link command | Wizard proceeds normally |

#### Scenario 5: Unlink and Cleanup
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Right-click linked database | "Unlink from Git" option visible |
| 2 | Click unlink | Confirmation dialog |
| 3 | Confirm unlink | Git icon removed from database |
| 4 | Check Schema Sync view | Subscription removed |
| 5 | Check service | Subscription deleted from service |

### 7.6 Test Data and Fixtures

#### 7.6.1 Sample Database Schema

```sql
-- test/fixtures/TestDatabase.sql

CREATE SCHEMA [dbo];
GO

CREATE TABLE [dbo].[Users] (
    [Id] INT IDENTITY(1,1) PRIMARY KEY,
    [Username] NVARCHAR(100) NOT NULL,
    [Email] NVARCHAR(255) NOT NULL,
    [CreatedAt] DATETIME2 DEFAULT GETUTCDATE()
);
GO

CREATE TABLE [dbo].[Orders] (
    [Id] INT IDENTITY(1,1) PRIMARY KEY,
    [UserId] INT NOT NULL REFERENCES [dbo].[Users]([Id]),
    [OrderDate] DATETIME2 NOT NULL,
    [TotalAmount] DECIMAL(18,2) NOT NULL
);
GO

CREATE PROCEDURE [dbo].[GetUserOrders]
    @UserId INT
AS
BEGIN
    SELECT o.* FROM [dbo].[Orders] o
    WHERE o.[UserId] = @UserId
    ORDER BY o.[OrderDate] DESC;
END
GO
```

#### 7.6.2 Sample SQL Project Structure

```
test/fixtures/test-sql-project/
├── TestDatabase.sqlproj
├── dbo/
│   ├── Tables/
│   │   ├── Users.sql
│   │   └── Orders.sql
│   └── StoredProcedures/
│       └── GetUserOrders.sql
└── Properties/
    └── Database.sqlproj.build
```

#### 7.6.3 Test Configuration

```json
// test/fixtures/testConfig.json
{
    "serviceEndpoint": "http://localhost:5050",
    "testDatabase": {
        "serverName": "localhost",
        "databaseName": "TestDB_Integration",
        "authenticationType": "SqlLogin",
        "userName": "testuser",
        "password": "${TEST_DB_PASSWORD}"
    },
    "testRepository": {
        "url": "https://github.com/test/sql-schema-repo.git",
        "branch": "main"
    },
    "timeouts": {
        "comparison": 30000,
        "polling": 5000
    }
}
```

### 7.7 Continuous Integration

```yaml
# .github/workflows/test.yml

name: Test Extension

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm ci
        working-directory: vscode-mssql-git-integration/extensions/mssql-git-integration

      - name: Run unit tests
        run: npm test
        working-directory: vscode-mssql-git-integration/extensions/mssql-git-integration

      - name: Run integration tests
        run: npm run test:integration
        working-directory: vscode-mssql-git-integration/extensions/mssql-git-integration

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          file: coverage/lcov.info

  e2e:
    runs-on: ubuntu-latest
    needs: test

    services:
      sql-comparison-service:
        image: ghcr.io/your-org/sql-comparison-service:latest
        ports:
          - 5050:5050

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm ci
        working-directory: vscode-mssql-git-integration/extensions/mssql-git-integration

      - name: Run E2E tests
        run: xvfb-run -a npm run test:e2e
        working-directory: vscode-mssql-git-integration/extensions/mssql-git-integration
```

---

## Appendix

### A. API Type Definitions

```typescript
// src/types/api.ts

export interface Subscription {
    id: string;
    name: string;
    databaseConnection: DatabaseConnectionInfo;
    sqlProjectPath: string;
    state: 'Active' | 'Paused' | 'Error';
    comparisonOptions?: ComparisonOptions;
    createdAt: string;
    lastComparedAt?: string;
}

export interface DatabaseConnectionInfo {
    serverName: string;
    databaseName: string;
    authenticationType: 'SqlLogin' | 'Integrated' | 'AzureAD';
    userName?: string;
    password?: string;
}

export interface ComparisonOptions {
    ignoreWhitespace: boolean;
    ignoreComments: boolean;
    includeObjectTypes: string[];
    excludeSchemas: string[];
}

export interface SchemaDifference {
    objectName: string;
    schemaName: string;
    objectType: string;
    changeType: 'Added' | 'Modified' | 'Deleted';
    databaseDefinition?: string;
    fileDefinition?: string;
}

export interface ComparisonResult {
    id: string;
    subscriptionId: string;
    status: 'InProgress' | 'Completed' | 'Failed';
    differenceCount: number;
    startedAt: string;
    completedAt?: string;
    errorMessage?: string;
}

export interface HealthInfo {
    status: 'Healthy' | 'Degraded' | 'Unhealthy';
    version: string;
    uptime: string;
    activeSubscriptions?: number;
}
```

### B. Configuration Schema

```json
{
    "$schema": "http://json-schema.org/draft-07/schema#",
    "title": "MSSQL Git Integration Settings",
    "type": "object",
    "properties": {
        "mssql-git.serviceEndpoint": {
            "type": "string",
            "default": "http://localhost:5050",
            "description": "URL of the SQL Comparison Service"
        },
        "mssql-git.autoStartService": {
            "type": "boolean",
            "default": true,
            "description": "Automatically start the bundled service if not running"
        },
        "mssql-git.signalRReconnectIntervals": {
            "type": "array",
            "items": { "type": "number" },
            "default": [0, 2000, 5000, 10000, 30000],
            "description": "Intervals for SignalR reconnection attempts (ms)"
        },
        "mssql-git.defaultComparisonOptions": {
            "type": "object",
            "properties": {
                "ignoreWhitespace": { "type": "boolean", "default": true },
                "ignoreComments": { "type": "boolean", "default": false }
            }
        }
    }
}
```

---

*Document Version: 1.0*
*Last Updated: February 2026*
*Author: Generated Implementation Plan*