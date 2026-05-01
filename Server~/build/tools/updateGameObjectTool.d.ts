import { McpUnity } from '../unity/mcpUnity.js';
import { Logger } from '../utils/logger.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
/**
 * Creates and registers the Update GameObject tool with the MCP server
 * This tool allows updating or creating GameObjects into the Unity Editor active scene
 *
 * @param server The MCP server instance to register with
 * @param mcpUnity The McpUnity instance to communicate with Unity
 * @param logger The logger instance for diagnostic information
 */
export declare function registerUpdateGameObjectTool(server: McpServer, mcpUnity: McpUnity, logger: Logger): void;
