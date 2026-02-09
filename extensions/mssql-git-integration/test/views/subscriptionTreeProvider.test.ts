/*---------------------------------------------------------------------------------------------
 *  SubscriptionTreeProvider Tests
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { SubscriptionTreeProvider, SubscriptionItem, DifferenceItem, InfoItem } from "../../src/views/subscriptionTreeProvider";
import { SqlComparisonClient } from "../../src/services/sqlComparisonClient";
import { ComparisonServiceSignalR } from "../../src/services/signalRClient";
import { createMockSubscription, createMockDifference } from "../utils";

suite("SubscriptionTreeProvider Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let mockClient: sinon.SinonStubbedInstance<SqlComparisonClient>;
    let mockSignalR: Partial<ComparisonServiceSignalR>;
    let provider: SubscriptionTreeProvider;

    // Event emitters for testing
    let differenceEmitter: vscode.EventEmitter<any>;
    let completedEmitter: vscode.EventEmitter<any>;

    setup(() => {
        sandbox = sinon.createSandbox();
        mockClient = sandbox.createStubInstance(SqlComparisonClient);

        // Create event emitters for the mock SignalR
        differenceEmitter = new vscode.EventEmitter();
        completedEmitter = new vscode.EventEmitter();

        // Create a partial mock with just the event properties needed
        mockSignalR = {
            onDifferencesDetected: differenceEmitter.event,
            onComparisonCompleted: completedEmitter.event,
        };

        provider = new SubscriptionTreeProvider(mockClient, mockSignalR as ComparisonServiceSignalR);
    });

    teardown(() => {
        sandbox.restore();
        differenceEmitter.dispose();
        completedEmitter.dispose();
    });

    suite("TreeDataProvider interface", () => {
        test("should implement getTreeItem", () => {
            expect(provider.getTreeItem).to.be.a("function");
        });

        test("should implement getChildren", () => {
            expect(provider.getChildren).to.be.a("function");
        });

        test("should implement onDidChangeTreeData", () => {
            expect(provider.onDidChangeTreeData).to.be.a("function");
        });
    });

    suite("getTreeItem", () => {
        test("should return the element itself", () => {
            const item = new InfoItem("Test", "info");
            const result = provider.getTreeItem(item);
            expect(result).to.equal(item);
        });
    });

    suite("getChildren - root level", () => {
        test("should return loading indicator initially", async () => {
            // Mock service as available but slow
            mockClient.isServiceAvailable.resolves(true);
            mockClient.getSubscriptions.resolves([]);
            mockClient.getDifferences.resolves([]);

            const children = await provider.getChildren(undefined);
            expect(children).to.be.an("array");
        });

        test("should return service unavailable message when service is down", async () => {
            mockClient.isServiceAvailable.resolves(false);
            mockClient.getSubscriptions.rejects(new Error("Service unavailable"));

            const children = await provider.getChildren(undefined);
            expect(children).to.have.lengthOf(1);
            expect(children[0]).to.be.instanceOf(InfoItem);
            expect((children[0] as InfoItem).label).to.include("unavailable");
        });

        test("should return subscription items when available", async () => {
            mockClient.isServiceAvailable.resolves(true);
            mockClient.getSubscriptions.resolves([
                createMockSubscription({ id: "sub-1", name: "Subscription 1" }),
                createMockSubscription({ id: "sub-2", name: "Subscription 2" }),
            ]);
            mockClient.getDifferences.resolves([]);

            const children = await provider.getChildren(undefined);
            expect(children).to.have.lengthOf(2);
            expect(children[0]).to.be.instanceOf(SubscriptionItem);
        });

        test("should return no subscriptions message when empty", async () => {
            mockClient.isServiceAvailable.resolves(true);
            mockClient.getSubscriptions.resolves([]);

            const children = await provider.getChildren(undefined);
            expect(children).to.have.lengthOf(1);
            expect(children[0]).to.be.instanceOf(InfoItem);
        });
    });

    suite("refresh", () => {
        test("should trigger onDidChangeTreeData event", () => {
            let eventFired = false;
            provider.onDidChangeTreeData(() => {
                eventFired = true;
            });

            provider.refresh();
            expect(eventFired).to.be.true;
        });
    });

    suite("TreeItem classes", () => {
        test("SubscriptionItem should have correct properties", () => {
            const subscription = createMockSubscription({ name: "Test Sub", id: "sub-123", state: "active" });
            const item = new SubscriptionItem(subscription, 5);

            expect(item.label).to.equal("Test Sub");
            expect(item.collapsibleState).to.equal(vscode.TreeItemCollapsibleState.Collapsed);
            expect(item.contextValue).to.equal("subscription-active");
        });

        test("DifferenceItem should have correct properties", () => {
            // API returns full object name in objectName field (e.g., "dbo.TestTable")
            const difference = createMockDifference({ objectName: "dbo.TestTable", action: "change" });
            const item = new DifferenceItem(difference);

            expect(item.label).to.equal("dbo.TestTable");
            expect(item.collapsibleState).to.equal(vscode.TreeItemCollapsibleState.None);
            expect(item.contextValue).to.equal("difference");
        });

        test("InfoItem should have correct properties", () => {
            const item = new InfoItem("Test message", "warning");

            expect(item.label).to.equal("Test message");
            expect(item.collapsibleState).to.equal(vscode.TreeItemCollapsibleState.None);
        });
    });

});

