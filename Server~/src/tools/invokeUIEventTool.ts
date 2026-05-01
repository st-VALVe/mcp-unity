import * as z from 'zod';
import { Logger } from '../utils/logger.js';
import { McpUnity } from '../unity/mcpUnity.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpUnityError, ErrorType } from '../utils/errors.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const toolName = 'invoke_ui_event';
const toolDescription =
  "Invokes a UnityEvent on a component of the target GameObject (e.g. Button.onClick, Toggle.onValueChanged, InputField.onEndEdit). " +
  "Fires registered listeners via UnityEvent.Invoke, bypassing the EventSystem pointer lifecycle. " +
  "Does not mutate component state (e.g. Toggle.isOn stays unchanged) — use set_input_field or direct component setters for state changes.";

const paramsSchema = z.object({
  objectPath: z
    .string()
    .min(1)
    .describe("Hierarchy path or leaf name of the GameObject, e.g. 'Canvas/Panel/StartButton'. Includes inactive objects."),
  eventName: z
    .string()
    .min(1)
    .describe("Name of the UnityEvent member to invoke, e.g. 'onClick', 'onValueChanged', 'onEndEdit'."),
  value: z
    .union([z.boolean(), z.number(), z.string()])
    .optional()
    .describe("Optional argument for UnityEvent<T>. Coerced to the event's parameter type (bool/int/float/string)."),
});

export function registerInvokeUIEventTool(server: McpServer, mcpUnity: McpUnity, logger: Logger) {
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
      objectPath: params.objectPath,
      eventName: params.eventName,
      value: params.value,
    },
  });

  if (!response.success) {
    throw new McpUnityError(
      ErrorType.TOOL_EXECUTION,
      response.message || `Failed to invoke ${params.eventName} on ${params.objectPath}`
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
            component: response.component,
            eventName: response.eventName,
            paramCount: response.paramCount,
          },
          null,
          2
        ),
      },
    ],
  };
}
