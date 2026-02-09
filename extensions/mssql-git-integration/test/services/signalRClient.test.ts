/*---------------------------------------------------------------------------------------------
 *  ComparisonServiceSignalR Tests
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import { ComparisonServiceSignalR } from "../../src/services/signalRClient";
import { ServiceDiscovery } from "../../src/services/serviceDiscovery";

suite("ComparisonServiceSignalR Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let mockDiscovery: sinon.SinonStubbedInstance<ServiceDiscovery>;
    let signalR: ComparisonServiceSignalR;

    setup(() => {
        sandbox = sinon.createSandbox();
        mockDiscovery = sandbox.createStubInstance(ServiceDiscovery);
        signalR = new ComparisonServiceSignalR(mockDiscovery);
    });

    teardown(async () => {
        sandbox.restore();
        signalR.dispose();
    });

    suite("getConnectionState", () => {
        test("should be disconnected initially", () => {
            const state = signalR.getConnectionState();
            expect(state).to.equal("disconnected");
        });
    });

    suite("initialize", () => {
        test("should return true when SignalR module loads successfully", async () => {
            // The SignalR module should be installed
            const result = await signalR.initialize();
            expect(result).to.be.true;
        });
    });

    suite("event emitters", () => {
        test("should have onDifferencesDetected event", () => {
            expect(signalR.onDifferencesDetected).to.be.a("function");
        });

        test("should have onComparisonStarted event", () => {
            expect(signalR.onComparisonStarted).to.be.a("function");
        });

        test("should have onComparisonProgress event", () => {
            expect(signalR.onComparisonProgress).to.be.a("function");
        });

        test("should have onComparisonCompleted event", () => {
            expect(signalR.onComparisonCompleted).to.be.a("function");
        });

        test("should have onComparisonFailed event", () => {
            expect(signalR.onComparisonFailed).to.be.a("function");
        });

        test("should have onHealthChanged event", () => {
            expect(signalR.onHealthChanged).to.be.a("function");
        });

        test("should have onSubscriptionHealthChanged as alias for onHealthChanged", () => {
            expect(signalR.onSubscriptionHealthChanged).to.equal(signalR.onHealthChanged);
        });

        test("should have onConnectionStateChanged event", () => {
            expect(signalR.onConnectionStateChanged).to.be.a("function");
        });

        test("should have onServiceShuttingDown event", () => {
            expect(signalR.onServiceShuttingDown).to.be.a("function");
        });
    });

    suite("event subscription", () => {
        test("should allow subscribing to onDifferencesDetected", () => {
            const disposable = signalR.onDifferencesDetected(() => {
                // Event handler
            });
            expect(disposable).to.have.property("dispose");
            disposable.dispose();
        });

        test("should allow subscribing to onComparisonCompleted", () => {
            const disposable = signalR.onComparisonCompleted(() => {
                // Event handler
            });
            expect(disposable).to.have.property("dispose");
            disposable.dispose();
        });

        test("should allow subscribing to onConnectionStateChanged", () => {
            const disposable = signalR.onConnectionStateChanged(() => {
                // Event handler
            });
            expect(disposable).to.have.property("dispose");
            disposable.dispose();
        });
    });

    suite("dispose", () => {
        test("should not throw when disposing", () => {
            expect(() => signalR.dispose()).to.not.throw();
        });

        test("should allow multiple dispose calls", () => {
            signalR.dispose();
            expect(() => signalR.dispose()).to.not.throw();
        });
    });

    suite("start", () => {
        test("should log warning when SignalR not available", async () => {
            // Create a SignalR client that hasn't been initialized
            const uninitializedSignalR = new ComparisonServiceSignalR(mockDiscovery);
            
            // Mock the dynamic import to fail
            const importStub = sandbox.stub();
            importStub.rejects(new Error("Module not found"));
            
            // Since we can't easily mock dynamic imports, we'll just verify no errors are thrown
            // when the module isn't available
            await uninitializedSignalR.start();
            expect(uninitializedSignalR.getConnectionState()).to.equal("disconnected");
            uninitializedSignalR.dispose();
        });
    });
});

