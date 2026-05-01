import { Logger } from '../utils/logger.js';
import { McpUnity } from '../unity/mcpUnity.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
/**
 * Registers the Create Material tool with the MCP server
 */
export declare function registerCreateMaterialTool(server: McpServer, mcpUnity: McpUnity, logger: Logger): void;
/**
 * Registers the Assign Material tool with the MCP server
 */
export declare function registerAssignMaterialTool(server: McpServer, mcpUnity: McpUnity, logger: Logger): void;
/**
 * Registers the Modify Material tool with the MCP server
 */
export declare function registerModifyMaterialTool(server: McpServer, mcpUnity: McpUnity, logger: Logger): void;
/**
 * Registers the Get Material Info tool with the MCP server
 */
export declare function registerGetMaterialInfoTool(server: McpServer, mcpUnity: McpUnity, logger: Logger): void;
