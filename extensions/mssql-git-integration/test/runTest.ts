/*---------------------------------------------------------------------------------------------
 *  MSSQL Git Integration - Unit Test Runner
 *--------------------------------------------------------------------------------------------*/

import Mocha from "mocha";
import * as glob from "glob";
import * as path from "path";

export async function run(): Promise<void> {
    const testsRoot = path.resolve(__dirname, ".");

    console.log("🚀 Starting Unit Test Suite");
    console.log("=".repeat(60));

    const mocha = new Mocha({
        ui: "tdd",
        timeout: 10_000,
        color: true,
    });

    // Support filtering tests via environment variable
    const rawPattern = process.env.TEST_PATTERN || process.env.MOCHA_GREP;
    if (rawPattern) {
        let rx: RegExp;
        try {
            rx = new RegExp(rawPattern);
        } catch {
            const esc = rawPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            rx = new RegExp(esc);
        }
        mocha.grep(rx);
        console.log(`🔎 Filtering tests with pattern: ${rx}`);
    }

    // Find all test files
    const files = glob.sync("**/*.test.js", { cwd: testsRoot });
    files.forEach((f) => mocha.addFile(path.resolve(testsRoot, f)));

    console.log(`📁 Found ${files.length} test file(s):`);
    files.forEach((f, i) => {
        console.log(`   ${i + 1}. ${f}`);
    });
    console.log();

    console.log("🧪 Running Tests");
    console.log("-".repeat(60));

    return new Promise((resolve, reject) => {
        const runner = mocha.run((failures: number) => {
            console.log("-".repeat(60));
            if (failures > 0) {
                console.log(`\n💥 ${failures} test(s) failed!`);
                reject(new Error(`${failures} tests failed.`));
            } else {
                console.log("\n🎉 All tests passed!");
                resolve();
            }
        });

        runner.on("pass", (test: Mocha.Test) => {
            console.log(`   ✅ ${test.fullTitle()} (${test.duration}ms)`);
        });

        runner.on("fail", (test: Mocha.Test, err: Error) => {
            console.log(`   ❌ ${test.fullTitle()}`);
            console.log(`      Error: ${err.message}`);
        });

        runner.on("pending", (test: Mocha.Test) => {
            console.log(`   ⏭️  ${test.fullTitle()} (skipped)`);
        });
    });
}

// Run tests when executed directly
run().catch((err: Error) => {
    console.error(err.message);
    process.exit(1);
});

