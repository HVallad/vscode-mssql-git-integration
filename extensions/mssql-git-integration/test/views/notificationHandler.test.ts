/*---------------------------------------------------------------------------------------------
 *  NotificationHandler Tests
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { NotificationHandler } from "../../src/views/notificationHandler";
import { ComparisonServiceSignalR } from "../../src/services/signalRClient";
import { SubscriptionTreeProvider } from "../../src/views/subscriptionTreeProvider";
import { SchemaSyncStatusBar } from "../../src/views/statusBar";
import {
    DifferencesDetectedEvent,
    ComparisonStartedEvent,
    ComparisonCompletedEvent,
    ComparisonFailedEvent,
    HealthChangedEvent,
    ConnectionStateEvent,
    ComparisonProgressEvent,
} from "../../src/types/serviceEvents";

suite("NotificationHandler Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let mockSignalR: Partial<ComparisonServiceSignalR>;
    let mockTreeProvider: sinon.SinonStubbedInstance<SubscriptionTreeProvider>;
    let mockStatusBar: sinon.SinonStubbedInstance<SchemaSyncStatusBar>;
    let handler: NotificationHandler;

    // Event emitters for testing
    let differencesDetectedEmitter: vscode.EventEmitter<DifferencesDetectedEvent>;
    let comparisonStartedEmitter: vscode.EventEmitter<ComparisonStartedEvent>;
    let comparisonCompletedEmitter: vscode.EventEmitter<ComparisonCompletedEvent>;
    let comparisonFailedEmitter: vscode.EventEmitter<ComparisonFailedEvent>;
    let comparisonProgressEmitter: vscode.EventEmitter<ComparisonProgressEvent>;
    let healthChangedEmitter: vscode.EventEmitter<HealthChangedEvent>;
    let connectionStateChangedEmitter: vscode.EventEmitter<ConnectionStateEvent>;

    setup(() => {
        sandbox = sinon.createSandbox();

        // Create event emitters
        differencesDetectedEmitter = new vscode.EventEmitter();
        comparisonStartedEmitter = new vscode.EventEmitter();
        comparisonCompletedEmitter = new vscode.EventEmitter();
        comparisonFailedEmitter = new vscode.EventEmitter();
        comparisonProgressEmitter = new vscode.EventEmitter();
        healthChangedEmitter = new vscode.EventEmitter();
        connectionStateChangedEmitter = new vscode.EventEmitter();

        // Create mocks - use partial mock for SignalR since it has readonly event properties
        mockSignalR = {
            onDifferencesDetected: differencesDetectedEmitter.event,
            onComparisonStarted: comparisonStartedEmitter.event,
            onComparisonCompleted: comparisonCompletedEmitter.event,
            onComparisonFailed: comparisonFailedEmitter.event,
            onComparisonProgress: comparisonProgressEmitter.event,
            onSubscriptionHealthChanged: healthChangedEmitter.event,
            onConnectionStateChanged: connectionStateChangedEmitter.event,
        };
        mockTreeProvider = sandbox.createStubInstance(SubscriptionTreeProvider);
        mockStatusBar = sandbox.createStubInstance(SchemaSyncStatusBar);

        // Stub VS Code window methods
        sandbox.stub(vscode.window, "showInformationMessage").resolves(undefined);
        sandbox.stub(vscode.window, "showWarningMessage").resolves(undefined);
        sandbox.stub(vscode.window, "showErrorMessage").resolves(undefined);

        handler = new NotificationHandler(mockSignalR as ComparisonServiceSignalR, mockTreeProvider, mockStatusBar);
    });

    teardown(() => {
        sandbox.restore();
        handler.dispose();
        differencesDetectedEmitter.dispose();
        comparisonStartedEmitter.dispose();
        comparisonCompletedEmitter.dispose();
        comparisonFailedEmitter.dispose();
        comparisonProgressEmitter.dispose();
        healthChangedEmitter.dispose();
        connectionStateChangedEmitter.dispose();
    });

    suite("event handling", () => {
        test("should update status bar when differences detected", () => {
            differencesDetectedEmitter.fire({
                type: "differences-detected",
                subscriptionId: "sub-123",
                differenceCount: 3,
                summary: { added: 1, modified: 1, deleted: 1 },
            });

            expect(mockStatusBar.setDifferenceCount.calledWith(3)).to.be.true;
        });

        test("should refresh subscription when differences detected", () => {
            differencesDetectedEmitter.fire({
                type: "differences-detected",
                subscriptionId: "sub-123",
                differenceCount: 3,
                summary: { added: 1, modified: 1, deleted: 1 },
            });

            expect(mockTreeProvider.refreshSubscription.calledWith("sub-123")).to.be.true;
        });

        test("should update status bar when comparison starts", () => {
            comparisonStartedEmitter.fire({
                type: "comparison-started",
                subscriptionId: "sub-123",
                comparisonId: "comp-456",
            });

            expect(mockStatusBar.setComparing.calledWith("schema")).to.be.true;
        });

        test("should update status bar when comparison completes", () => {
            comparisonCompletedEmitter.fire({
                type: "comparison-completed",
                subscriptionId: "sub-123",
                comparisonId: "comp-456",
                differenceCount: 5,
                duration: 1500,
            });

            expect(mockStatusBar.setDifferenceCount.calledWith(5)).to.be.true;
        });

        test("should refresh subscription when comparison completes", () => {
            comparisonCompletedEmitter.fire({
                type: "comparison-completed",
                subscriptionId: "sub-123",
                comparisonId: "comp-456",
                differenceCount: 5,
                duration: 1500,
            });

            expect(mockTreeProvider.refreshSubscription.calledWith("sub-123")).to.be.true;
        });

        test("should show error message when comparison fails", () => {
            comparisonFailedEmitter.fire({
                type: "comparison-failed",
                subscriptionId: "sub-123",
                error: "Connection failed",
            });

            expect((vscode.window.showErrorMessage as sinon.SinonStub).called).to.be.true;
        });

        test("should refresh subscription when health changes", () => {
            healthChangedEmitter.fire({
                type: "health-changed",
                subscriptionId: "sub-123",
                health: "degraded",
            });

            expect(mockTreeProvider.refreshSubscription.calledWith("sub-123")).to.be.true;
        });
    });

    suite("dispose", () => {
        test("should not throw when disposing", () => {
            expect(() => handler.dispose()).to.not.throw();
        });

        test("should allow multiple dispose calls", () => {
            handler.dispose();
            expect(() => handler.dispose()).to.not.throw();
        });
    });
});

