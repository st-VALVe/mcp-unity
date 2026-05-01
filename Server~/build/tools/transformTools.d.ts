import { McpUnity } from '../unity/mcpUnity.js';
import { Logger } from '../utils/logger.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
/**
 * Registers the move_gameobject tool with the MCP server
 */
export declare function registerMoveGameObjectTool(server: McpServer, mcpUnity: McpUnity, logger: Logger): void;
/**
 * Registers the rotate_gameobject tool with the MCP server
 */
export declare function registerRotateGameObjectTool(server: McpServer, mcpUnity: McpUnity, logger: Logger): void;
/**
 * Registers the scale_gameobject tool with the MCP server
 */
export declare function registerScaleGameObjectTool(server: McpServer, mcpUnity: McpUnity, logger: Logger): void;
/**
 * Registers the set_transform tool with the MCP server
 */
export declare function registerSetTransformTool(server: McpServer, mcpUnity: McpUnity, logger: Logger): void;
/**
 * Registers all transform tools with the MCP server
 */
export declare function registerTransformTools(server: McpServer, mcpUnity: McpUnity, logger: Logger): void;
