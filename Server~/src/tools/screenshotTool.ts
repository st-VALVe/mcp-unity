import * as z from 'zod';
import { Logger } from '../utils/logger.js';
import { McpUnity } from '../unity/mcpUnity.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpUnityError, ErrorType } from '../utils/errors.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const toolName = 'screenshot';
const toolDescription =
  'Legacy alias for capture_game_view. Captures a PNG screenshot of the Unity Game view and returns the absolute file path.';

const paramsSchema = z.object({
  outputPath: z
    .string()
    .optional()
    .describe(
      "Optional output path for the PNG. Absolute or relative to the Unity project root. Defaults to 'Temp/mcp-screenshots/screenshot_<utc>.png'."
    ),
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

/**
 * Registers the screenshot tool with the MCP server.
 */
export function registerScreenshotTool(server: McpServer, mcpUnity: McpUnity, logger: Logger) {
  logger.info(`Registering tool: ${toolName}`);

  server.tool(
    toolName,
    toolDescription,
    paramsSchema.shape,
    async (params: any) => {
      try {
        logger.info(`Executing tool: ${toolName}`, params);
        const result = await toolHandler(mcpUnity, params);
        logger.info(`Tool execution successful: ${toolName}`);
        return result;
      } catch (error) {
        logger.error(`Tool execution failed: ${toolName}`, error);
        throw error;
      }
    }
  );
}

async function toolHandler(
  mcpUnity: McpUnity,
  params: z.infer<typeof paramsSchema>
): Promise<CallToolResult> {
  const response = await mcpUnity.sendRequest({
    method: toolName,
    params: {
      outputPath: params.outputPath,
      superSize: params.superSize ?? 1,
      waitSeconds: params.waitSeconds ?? 2,
    },
  });

  if (!response.success) {
    throw new McpUnityError(
      ErrorType.TOOL_EXECUTION,
      response.message || 'Failed to capture screenshot'
    );
  }

  return {
    content: [
      {
        type: 'text',
        text: response.message,
      },
      {
        type: 'text',
        text: JSON.stringify(
          {
            path: response.path,
            sizeBytes: response.sizeBytes,
            superSize: response.superSize,
            playMode: response.playMode,
            screenWidth: response.screenWidth,
            screenHeight: response.screenHeight,
            activeScene: response.activeScene,
          },
          null,
          2
        ),
      },
    ],
  };
}
