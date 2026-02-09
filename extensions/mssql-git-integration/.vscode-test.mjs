import * as testCli from "@vscode/test-cli";

export default testCli.defineConfig([
    {
        label: "Unit Tests",
        files: "out/test/**/*.test.js",
        version: "stable",
        mocha: {
            ui: "tdd",
            timeout: 10_000,
        },
    },
]);

