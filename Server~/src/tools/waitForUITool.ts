import * as z from 'zod';
import { Logger } from '../utils/logger.js';
import { McpUnity } from '../unity/mcpUnity.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpUnityError, ErrorType } from '../utils/errors.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const toolName = 'wait_for_ui';
const toolDescription =
  "Polls for a GameObject by hierarchy path until it appears, is active, and (optionally) is interactable, " +
  "or a timeout elapses. Works in both Edit Mode and Play Mode. Useful as a synchronization primitive between " +
  "UI clicks — wait for the next FTUE step to render before acting on it. Default timeoutMs=5000, max 60000.";

// Custom timeout buffer: Unity-side wait can run up to MAX_WAIT_MS; the WebSocket request
// must outlive that, so we add 5s of headroom for transport overhead.
const MAX_WAIT_MS = 60_000;
const TRANSPORT_BUFFER_MS = 5_000;

const paramsSchema = z.object({
  objectPath: z
    .string()
    .min(1)
    .describe("Hierarchy path or leaf name of the GameObject to wait for, e.g. 'Canvas/Panel/StartButton'."),
  timeoutMs: z
    .number()
    .int()
    .min(0)
    .max(MAX_WAIT_MS)
    .optional()
    .default(5000)
    .describe(`How long to poll before giving up, in milliseconds. Default 5000, max ${MAX_WAIT_MS}.`),
  requireInteractable: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "If true (default), require the GameObject to be active AND not blocked by a CanvasGroup AND its " +
      "Selectable (if any) to be interactable. If false, only checks active state."
    ),
});

export function registerWaitForUITool(server: McpServer, mcpUnity: McpUnity, logger: Logger) {
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
  const timeoutMs = params.timeoutMs ?? 5000;
  const requireInteractable = params.requireInteractable ?? true;

  // Override the default 30s WebSocket request timeout so it can outlast the Unity-side wait.
  const requestTimeout = timeoutMs + TRANSPORT_BUFFER_MS;

  const response = await mcpUnity.sendRequest(
    {
      method: toolName,
      params: {
        objectPath: params.objectPath,
        timeoutMs,
        requireInteractable,
      },
    },
    { timeout: requestTimeout }
  );

  if (!response.success) {
    throw new McpUnityError(
      ErrorType.TOOL_EXECUTION,
      response.message || `wait_for_ui failed for '${params.objectPath}'`
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
            objectPath: response.objectPath,
            elapsedMs: response.elapsedMs,
          },
          null,
          2
        ),
      },
    ],
  };
}
