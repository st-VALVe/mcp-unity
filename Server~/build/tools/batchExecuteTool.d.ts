import { McpUnity } from '../unity/mcpUnity.js';
import { Logger } from '../utils/logger.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
/**
 * Creates and registers the Batch Execute tool with the MCP server
 */
export declare function registerBatchExecuteTool(server: McpServer, mcpUnity: McpUnity, logger: Logger): void;
