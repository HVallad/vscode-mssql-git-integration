// @ts-check

import tseslint from "typescript-eslint";

export default [
    {
        ignores: ["out/**/*", "node_modules/**/*"],
    },
    ...tseslint.configs.recommended,
    {
        files: ["src/**/*.ts"],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            parser: tseslint.parser,
            parserOptions: {
                project: "./tsconfig.extension.json",
            },
        },
        plugins: {
            ["@typescript-eslint"]: tseslint.plugin,
        },
        rules: {
            "@typescript-eslint/no-unused-vars": ["error", { 
                argsIgnorePattern: "^_",
                varsIgnorePattern: "^_"
            }],
            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/explicit-function-return-type": "off",
            "@typescript-eslint/no-namespace": "off",
            "no-unused-vars": "off",
        },
    },
];

