import { McpUnity } from '../unity/mcpUnity.js';
import { Logger } from '../utils/logger.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
/**
 * Creates and registers the Duplicate GameObject tool with the MCP server
 */
export declare function registerDuplicateGameObjectTool(server: McpServer, mcpUnity: McpUnity, logger: Logger): void;
/**
 * Creates and registers the Delete GameObject tool with the MCP server
 */
export declare function registerDeleteGameObjectTool(server: McpServer, mcpUnity: McpUnity, logger: Logger): void;
/**
 * Creates and registers the Reparent GameObject tool with the MCP server
 */
export declare function registerReparentGameObjectTool(server: McpServer, mcpUnity: McpUnity, logger: Logger): void;
