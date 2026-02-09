/*---------------------------------------------------------------------------------------------
 *  SqlComparisonClient Tests
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import { SqlComparisonClient, ServiceUnavailableError } from "../../src/services/sqlComparisonClient";
import { ServiceDiscovery } from "../../src/services/serviceDiscovery";
import { createMockServiceInfo, createMockSubscription, createMockDifference, createMockHealthInfo } from "../utils";

suite("SqlComparisonClient Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let mockDiscovery: sinon.SinonStubbedInstance<ServiceDiscovery>;
    let client: SqlComparisonClient;

    setup(() => {
        sandbox = sinon.createSandbox();
        mockDiscovery = sandbox.createStubInstance(ServiceDiscovery);
        client = new SqlComparisonClient(mockDiscovery);
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("ensureConnected", () => {
        test("should throw ServiceUnavailableError when no service found", async () => {
            mockDiscovery.discoverService.resolves(null);

            try {
                await client.ensureConnected();
                expect.fail("Should have thrown ServiceUnavailableError");
            } catch (error) {
                expect(error).to.be.instanceOf(ServiceUnavailableError);
            }
        });

        test("should return endpoint when service is discovered", async () => {
            mockDiscovery.discoverService.resolves(createMockServiceInfo({ endpoint: "http://localhost:5050" }));

            const endpoint = await client.ensureConnected();
            expect(endpoint).to.equal("http://localhost:5050");
        });

        test("should use cached endpoint if still healthy", async () => {
            mockDiscovery.discoverService.resolves(createMockServiceInfo({ endpoint: "http://localhost:5050" }));
            mockDiscovery.checkHealth.resolves(createMockHealthInfo());

            // First call discovers the service
            await client.ensureConnected();
            
            // Second call should use cached endpoint
            const endpoint = await client.ensureConnected();
            expect(endpoint).to.equal("http://localhost:5050");
            expect(mockDiscovery.checkHealth.calledOnce).to.be.true;
        });

        test("should rediscover if cached endpoint becomes unhealthy", async () => {
            mockDiscovery.discoverService.resolves(createMockServiceInfo({ endpoint: "http://localhost:5050" }));
            mockDiscovery.checkHealth.onFirstCall().resolves(null);
            mockDiscovery.checkHealth.onSecondCall().resolves(createMockHealthInfo());

            // First call discovers
            await client.ensureConnected();
            
            // Mock discovery to return new endpoint
            mockDiscovery.discoverService.resolves(createMockServiceInfo({ endpoint: "http://localhost:5051" }));
            
            // Second call should rediscover since health check failed
            await client.ensureConnected();
            expect(mockDiscovery.discoverService.calledTwice).to.be.true;
        });
    });

    suite("isServiceAvailable", () => {
        test("should return true when service is available", async () => {
            mockDiscovery.discoverService.resolves(createMockServiceInfo());

            const result = await client.isServiceAvailable();
            expect(result).to.be.true;
        });

        test("should return false when service is not available", async () => {
            mockDiscovery.discoverService.resolves(null);

            const result = await client.isServiceAvailable();
            expect(result).to.be.false;
        });
    });

    suite("getEndpoint", () => {
        test("should return null before connection", () => {
            const endpoint = client.getEndpoint();
            expect(endpoint).to.be.null;
        });

        test("should return endpoint after connection", async () => {
            mockDiscovery.discoverService.resolves(createMockServiceInfo({ endpoint: "http://localhost:5050" }));
            await client.ensureConnected();

            const endpoint = client.getEndpoint();
            expect(endpoint).to.equal("http://localhost:5050");
        });
    });

    suite("getSubscriptions", () => {
        test("should fetch subscriptions from API", async () => {
            mockDiscovery.discoverService.resolves(createMockServiceInfo());
            const mockSubscriptions = [createMockSubscription({ id: "sub-1" }), createMockSubscription({ id: "sub-2" })];

            sandbox.stub(globalThis, "fetch").resolves({
                ok: true,
                json: async () => mockSubscriptions,
            } as Response);

            const subscriptions = await client.getSubscriptions();
            expect(subscriptions).to.have.lengthOf(2);
            expect(subscriptions[0].id).to.equal("sub-1");
        });

        test("should throw error when API returns error", async () => {
            mockDiscovery.discoverService.resolves(createMockServiceInfo());

            sandbox.stub(globalThis, "fetch").resolves({
                ok: false,
                statusText: "Internal Server Error",
            } as Response);

            try {
                await client.getSubscriptions();
                expect.fail("Should have thrown an error");
            } catch (error) {
                expect((error as Error).message).to.include("Failed to get subscriptions");
            }
        });
    });

    suite("getDifferences", () => {
        test("should return empty array when no differences", async () => {
            mockDiscovery.discoverService.resolves(createMockServiceInfo());

            // Subscription without lastComparison
            const subscriptionWithoutComparison = createMockSubscription({ lastComparison: undefined });
            sandbox.stub(globalThis, "fetch").resolves({
                ok: true,
                json: async () => subscriptionWithoutComparison,
            } as Response);

            const differences = await client.getDifferences("sub-1");
            expect(differences).to.deep.equal([]);
        });

        test("should return differences when they exist", async () => {
            mockDiscovery.discoverService.resolves(createMockServiceInfo());
            const mockDiffs = [createMockDifference({ objectName: "dbo.Users" })];

            // Mock fetch to return subscription first, then differences
            const fetchStub = sandbox.stub(globalThis, "fetch");
            // First call: getSubscription
            fetchStub.onCall(0).resolves({
                ok: true,
                json: async () => createMockSubscription({
                    lastComparison: { id: "comp-123", comparedAt: new Date().toISOString(), differenceCount: 1 }
                }),
            } as Response);
            // Second call: getComparisonDifferences
            fetchStub.onCall(1).resolves({
                ok: true,
                json: async () => mockDiffs,
            } as Response);

            const differences = await client.getDifferences("sub-1");
            expect(differences).to.have.lengthOf(1);
            expect(differences[0].objectName).to.equal("dbo.Users");
        });
    });
});

