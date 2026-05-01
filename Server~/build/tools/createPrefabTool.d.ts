import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpUnity } from '../unity/mcpUnity.js';
import { Logger } from '../utils/logger.js';
/**
 * Creates and registers the CreatePrefab tool with the MCP server
 *
 * @param server The MCP server to register the tool with
 * @param mcpUnity The McpUnity instance to communicate with Unity
 * @param logger The logger instance for diagnostic information
 */
export declare function registerCreatePrefabTool(server: McpServer, mcpUnity: McpUnity, logger: Logger): void;
