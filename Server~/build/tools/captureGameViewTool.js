import * as z from 'zod';
import { McpUnityError, ErrorType } from '../utils/errors.js';
const toolName = 'capture_game_view';
const toolDescription = 'Captures a PNG screenshot of the Unity Game view and returns the absolute file path plus scene/play-mode metadata. Useful for preserving visual evidence during UI and FTUE tests.';
const paramsSchema = z.object({
    outputPath: z
        .string()
        .optional()
        .describe("Optional output path for the PNG. Absolute or relative to the Unity project root. Defaults to 'Temp/mcp-screenshots/game_view_<utc>.png'."),
    superSize: z
        .number()
        .int()
        .min(1)
        .max(8)
        .optional()
        .default(1)
        .describe('Multiplier for the final image resolution (1-8). Default 1.'),
    waitSeconds: z
        .number()
        .min(0.1)
        .max(30)
        .optional()
        .default(2)
        .describe('How long Unity should wait for the screenshot file to be written. Default 2 seconds.'),
});
export function registerCaptureGameViewTool(server, mcpUnity, logger) {
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
            outputPath: params.outputPath,
            superSize: params.superSize ?? 1,
            waitSeconds: params.waitSeconds ?? 2,
        },
    });
    if (!response.success) {
        throw new McpUnityError(ErrorType.TOOL_EXECUTION, response.message || 'Failed to capture Unity Game view');
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
                    path: response.path,
                    sizeBytes: response.sizeBytes,
                    superSize: response.superSize,
                    playMode: response.playMode,
                    screenWidth: response.screenWidth,
                    screenHeight: response.screenHeight,
                    activeScene: response.activeScene,
                }, null, 2),
            },
        ],
    };
}
