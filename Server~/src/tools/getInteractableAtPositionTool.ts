import * as z from 'zod';
import { Logger } from '../utils/logger.js';
import { McpUnity } from '../unity/mcpUnity.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpUnityError, ErrorType } from '../utils/errors.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const toolName = 'get_interactable_at_position';
const toolDescription =
  "Returns the GameObjects under a screen-space point in front-to-back order (up to 5), with " +
  "clickable / selectable / raycaster info for each. Coordinates default to top-left origin (matching " +
  "screenshot pixel coordinates); pass origin='bottom-left' for Unity's native convention. " +
  "Useful diagnostic before ui_click_gameobject — answers 'is this button reachable?' / 'what's covering it?'. " +
  "Requires Play Mode and an active EventSystem.";

const paramsSchema = z.object({
  x: z
    .number()
    .int()
    .min(0)
    .describe("Screen X coordinate, in pixels. Top-left origin by default."),
  y: z
    .number()
    .int()
    .min(0)
    .describe("Screen Y coordinate, in pixels. Top-left origin by default."),
  origin: z
    .enum(['top-left', 'bottom-left'])
    .optional()
    .default('top-left')
    .describe(
      "Coordinate origin convention. 'top-left' matches screenshots and most UI tooling (default). " +
      "'bottom-left' matches Unity's native Screen / Input space."
    ),
});

export function registerGetInteractableAtPositionTool(
  server: McpServer,
  mcpUnity: McpUnity,
  logger: Logger
) {
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
      x: params.x,
      y: params.y,
      origin: params.origin ?? 'top-left',
    },
  });

  if (!response.success) {
    throw new McpUnityError(
      ErrorType.TOOL_EXECUTION,
      response.message || `Failed to query interactable at (${params.x}, ${params.y})`
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
            screenSize: response.screenSize,
            queryPosition: response.queryPosition,
            hitCount: response.hitCount,
            hits: response.hits,
          },
          null,
          2
        ),
      },
    ],
  };
}
