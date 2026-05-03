import * as z from 'zod';
import { McpUnityError, ErrorType } from '../utils/errors.js';
const toolName = 'enter_play_mode';
const toolDescription = "Enters Unity Play Mode. The editor reloads the domain, so the MCP connection will briefly drop and reconnect. No-op if already playing.";
const DirtyScenePolicy = z.enum(['fail', 'report', 'save', 'discard']);
const DirtyScenePolicyScope = z.enum(['active', 'loaded']);
const paramsSchema = z.object({
    dirtyScenePolicy: DirtyScenePolicy.optional().default('report')
        .describe("Policy for dirty scenes before action: 'fail' (refuse), 'report' (warn+proceed, default), 'save' (persist), 'discard' (reload from disk; requires dirtyScenePolicyScope)."),
    dirtyScenePolicyScope: DirtyScenePolicyScope.optional()
        .describe("Required when dirtyScenePolicy='discard'. 'active' reloads only the active scene (additive scenes detached). 'loaded' reloads all loaded scenes by path.")
});
export function registerEnterPlayModeTool(server, mcpUnity, logger) {
    logger.info(`Registering tool: ${toolName}`);
    server.tool(toolName, toolDescription, paramsSchema.shape, async (params = {}) => {
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
async function toolHandler(mcpUnity, params = {}) {
    const { dirtyScenePolicy = 'report', dirtyScenePolicyScope } = params;
    const response = await mcpUnity.sendRequest({
        method: toolName,
        params: {
            dirtyScenePolicy,
            dirtyScenePolicyScope
        },
    });
    if (!response.success) {
        throw new McpUnityError(ErrorType.TOOL_EXECUTION, response.error?.message || response.message || 'Failed to enter Play Mode', response.error || response);
    }
    const content = [
        {
            type: 'text',
            text: response.message,
        },
    ];
    if (response.preflight) {
        content.push({
            type: 'text',
            text: JSON.stringify({ preflight: response.preflight }, null, 2),
        });
    }
    return {
        content: [
            ...content
        ],
    };
}
