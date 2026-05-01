import * as z from 'zod';
import { McpUnityError, ErrorType } from '../utils/errors.js';
const toolName = 'find_gameobjects';
const toolDescription = "Searches loaded scenes for GameObjects matching optional filters (name substring, tag, component type). " +
    "Includes inactive objects. Returns hierarchy path, name, instanceId, and active state.";
const paramsSchema = z.object({
    name: z
        .string()
        .optional()
        .describe("Case-insensitive substring to match against GameObject names."),
    tag: z
        .string()
        .optional()
        .describe("Exact tag to match. Must be a tag defined in the project."),
    componentType: z
        .string()
        .optional()
        .describe("Component type to filter by. Accepts full name ('UnityEngine.UI.Button'), assembly-qualified, or simple class name."),
    limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .default(50)
        .describe("Maximum number of results to return. Default 50, max 500."),
});
export function registerFindGameObjectsTool(server, mcpUnity, logger) {
    logger.info(`Registering tool: ${toolName}`);
    server.tool(toolName, toolDescription, paramsSchema.shape, async (params) => {
        try {
            logger.info(`Executing tool: ${toolName}`, params);
            const result = await toolHandler(mcpUnity, params);
            logger.info(`Tool execution successful: ${toolName}`);
            return result;
        }
        catch (error) {
            logger.error(`Tool execution failed: ${toolName}`, error);
            throw error;
        }
    });
}
async function toolHandler(mcpUnity, params) {
    const response = await mcpUnity.sendRequest({
        method: toolName,
        params: {
            name: params.name,
            tag: params.tag,
            componentType: params.componentType,
            limit: params.limit ?? 50,
        },
    });
    if (!response.success) {
        throw new McpUnityError(ErrorType.TOOL_EXECUTION, response.message || 'Failed to find GameObjects');
    }
    return {
        content: [
            {
                type: 'text',
                text: response.message,
            },
            {
                type: 'text',
                text: JSON.stringify({
                    matchedCount: response.matchedCount,
                    returnedCount: response.returnedCount,
                    limit: response.limit,
                    results: response.results,
                }, null, 2),
            },
        ],
    };
}
