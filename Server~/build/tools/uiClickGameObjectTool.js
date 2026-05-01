import * as z from 'zod';
import { McpUnityError, ErrorType } from '../utils/errors.js';
const toolName = 'ui_click_gameobject';
const toolDescription = "Performs an honest pointer click on a GameObject through the EventSystem. " +
    "Computes the screen-space center of the target's RectTransform (or transform position for 3D), " +
    "raycasts via GraphicRaycaster / PhysicsRaycaster, and fires the full PointerEnter/Down/Up/Click/Exit " +
    "sequence on the topmost hit. Visual transitions and hover states play normally. Detects occlusion by " +
    "other UI and reports it as 'occluded'. Requires Play Mode and an active EventSystem.";
const paramsSchema = z.object({
    objectPath: z
        .string()
        .min(1)
        .describe("Hierarchy path or leaf name of the GameObject to click, e.g. 'Canvas/Panel/StartButton'. " +
        "Includes inactive objects in the search, but a click is only dispatched if the target is active and not occluded."),
});
export function registerUIClickGameObjectTool(server, mcpUnity, logger) {
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
            objectPath: params.objectPath,
        },
    });
    if (!response.success) {
        throw new McpUnityError(ErrorType.TOOL_EXECUTION, response.message || `Failed to click '${params.objectPath}'`);
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
                    target: response.target,
                    hitObject: response.hitObject,
                    clickHandler: response.clickHandler,
                    screenPosition: response.screenPosition,
                }, null, 2),
            },
        ],
    };
}
