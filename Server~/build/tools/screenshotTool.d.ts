import { Logger } from '../utils/logger.js';
import { McpUnity } from '../unity/mcpUnity.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
/**
 * Registers the screenshot tool with the MCP server.
 */
export declare function registerScreenshotTool(server: McpServer, mcpUnity: McpUnity, logger: Logger): void;
