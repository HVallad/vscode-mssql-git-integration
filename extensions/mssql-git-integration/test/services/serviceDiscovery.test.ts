/*---------------------------------------------------------------------------------------------
 *  ServiceDiscovery Tests
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import { ServiceDiscovery } from "../../src/services/serviceDiscovery";
import { stubWorkspaceConfig } from "../utils";

suite("ServiceDiscovery Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let discovery: ServiceDiscovery;

    setup(() => {
        sandbox = sinon.createSandbox();
        discovery = new ServiceDiscovery();
    });

    teardown(() => {
        sandbox.restore();
        discovery.clearCache();
    });

    suite("getDefaultPorts", () => {
        test("should return default ports 5050, 5051, 5052", () => {
            const ports = discovery.getDefaultPorts();
            expect(ports).to.deep.equal([5050, 5051, 5052]);
        });

        test("should return a copy, not the original array", () => {
            const ports1 = discovery.getDefaultPorts();
            const ports2 = discovery.getDefaultPorts();
            expect(ports1).to.not.equal(ports2);
            expect(ports1).to.deep.equal(ports2);
        });
    });

    suite("getConfiguredEndpoint", () => {
        test("should return undefined when no endpoint is configured", () => {
            stubWorkspaceConfig(sandbox, {});
            const endpoint = discovery.getConfiguredEndpoint();
            expect(endpoint).to.be.undefined;
        });

        test("should return configured endpoint from settings", () => {
            stubWorkspaceConfig(sandbox, { endpoint: "http://localhost:9999" });
            const endpoint = discovery.getConfiguredEndpoint();
            expect(endpoint).to.equal("http://localhost:9999");
        });

        test("should normalize endpoint by removing trailing slash", () => {
            stubWorkspaceConfig(sandbox, { endpoint: "http://localhost:5050/" });
            const endpoint = discovery.getConfiguredEndpoint();
            expect(endpoint).to.equal("http://localhost:5050");
        });

        test("should check environment variable when settings not configured", () => {
            stubWorkspaceConfig(sandbox, {});
            const originalEnv = process.env.SQL_COMPARISON_SERVICE_URL;
            process.env.SQL_COMPARISON_SERVICE_URL = "http://envhost:5050";
            
            try {
                const endpoint = discovery.getConfiguredEndpoint();
                expect(endpoint).to.equal("http://envhost:5050");
            } finally {
                if (originalEnv) {
                    process.env.SQL_COMPARISON_SERVICE_URL = originalEnv;
                } else {
                    delete process.env.SQL_COMPARISON_SERVICE_URL;
                }
            }
        });
    });

    suite("checkHealth", () => {
        test("should return null when fetch fails", async () => {
            sandbox.stub(globalThis, "fetch").rejects(new Error("Network error"));
            
            const health = await discovery.checkHealth("http://localhost:5050");
            expect(health).to.be.null;
        });

        test("should return null when response is not OK", async () => {
            sandbox.stub(globalThis, "fetch").resolves({
                ok: false,
                status: 500,
                statusText: "Internal Server Error",
            } as Response);

            const health = await discovery.checkHealth("http://localhost:5050");
            expect(health).to.be.null;
        });

        test("should return health info when service is healthy", async () => {
            const mockHealthData = {
                status: "healthy",
                version: "1.0.0",
                uptime: 3600,
                activeSubscriptions: 5,
            };

            sandbox.stub(globalThis, "fetch").resolves({
                ok: true,
                json: async () => mockHealthData,
            } as Response);

            const health = await discovery.checkHealth("http://localhost:5050");
            expect(health).to.deep.equal(mockHealthData);
        });

        test("should use default values for missing health fields", async () => {
            sandbox.stub(globalThis, "fetch").resolves({
                ok: true,
                json: async () => ({}),
            } as Response);

            const health = await discovery.checkHealth("http://localhost:5050");
            expect(health).to.deep.equal({
                status: "healthy",
                version: "unknown",
                uptime: 0,
                activeSubscriptions: 0,
            });
        });
    });

    suite("clearCache", () => {
        test("should clear cached endpoint", async () => {
            // First set up a successful discovery
            const mockHealthData = { status: "healthy", version: "1.0.0", uptime: 0, activeSubscriptions: 0 };
            sandbox.stub(globalThis, "fetch").resolves({
                ok: true,
                json: async () => mockHealthData,
            } as Response);
            stubWorkspaceConfig(sandbox, {});

            await discovery.discoverService();
            
            // Clear the cache
            discovery.clearCache();
            
            // Now if fetch fails, we should get null (cache cleared)
            sandbox.restore();
            sandbox = sinon.createSandbox();
            sandbox.stub(globalThis, "fetch").rejects(new Error("Network error"));
            stubWorkspaceConfig(sandbox, {});

            const result = await discovery.discoverService();
            expect(result).to.be.null;
        });
    });
});

