import { Logger } from '../utils/logger.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpUnity } from '../unity/mcpUnity.js';
/**
 * Registers the get_console_logs resource with the MCP server
 */
export declare function registerGetConsoleLogsResource(server: McpServer, mcpUnity: McpUnity, logger: Logger): void;
