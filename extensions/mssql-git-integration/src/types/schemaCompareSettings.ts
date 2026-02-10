/*---------------------------------------------------------------------------------------------
 *  Schema Compare Settings Types
 *  Type definitions for schema compare settings stored in VS Code configuration
 *--------------------------------------------------------------------------------------------*/

/**
 * Schema compare boolean options stored in VS Code configuration.
 * Key is the option name, value is the enabled state.
 * These are stored in mssqlGit.schemaCompare.options
 */
export type SchemaCompareBooleanOptions = { [key: string]: boolean };

/**
 * Schema compare excluded object types stored in VS Code configuration.
 * These are stored in mssqlGit.schemaCompare.excludedObjectTypes
 */
export type SchemaCompareExcludedObjectTypes = string[];

