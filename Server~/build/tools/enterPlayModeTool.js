import * as z from 'zod';
import { McpUnityError, ErrorType } from '../utils/errors.js';
const toolName = 'enter_play_mode';
const toolDescription = "Enters Unity Play Mode. The editor reloads the domain, so the MCP connection will briefly drop and reconnect. No-op if already playing.";
const paramsSchema = z.object({});
export function registerEnterPlayModeTool(server, mcpUnity, logger) {
    logger.info(`Registering tool: ${toolName}`);
    server.tool(toolName, toolDescription, paramsSchema.shape, async (params) => {
        try {
            logger.info(`Executing tool: ${toolName}`);
            const result = await toolHandler(mcpUnity);
            logger.info(`Tool execution successful: ${toolName}`);
            return result;
        }
        catch (error) {
            logger.error(`Tool execution failed: ${toolName}`, error);
            throw error;
        }
    });
}
async function toolHandler(mcpUnity) {
    const response = await mcpUnity.sendRequest({
        method: toolName,
        params: {},
    });
    if (!response.success) {
        throw new McpUnityError(ErrorType.TOOL_EXECUTION, response.message || 'Failed to enter Play Mode');
    }
    return {
        content: [
            {
                type: 'text',
                text: response.message,
            },
        ],
    };
}
