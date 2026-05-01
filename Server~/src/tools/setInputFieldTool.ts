import * as z from 'zod';
import { Logger } from '../utils/logger.js';
import { McpUnity } from '../unity/mcpUnity.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpUnityError, ErrorType } from '../utils/errors.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const toolName = 'set_input_field';
const toolDescription =
  "Sets the text on an InputField or TMP_InputField on the target GameObject. " +
  "Records Undo and optionally fires onEndEdit(text) after the assignment.";

const paramsSchema = z.object({
  objectPath: z.string().min(1).describe("Hierarchy path or leaf name of the GameObject."),
  text: z.string().describe("Text to assign to the input field."),
  triggerEndEdit: z
    .boolean()
    .optional()
    .default(true)
    .describe("If true, invoke onEndEdit(text) after setting the value. Default true."),
});

export function registerSetInputFieldTool(server: McpServer, mcpUnity: McpUnity, logger: Logger) {
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
      text: params.text,
      triggerEndEdit: params.triggerEndEdit ?? true,
    },
  });

  if (!response.success) {
    throw new McpUnityError(
      ErrorType.TOOL_EXECUTION,
      response.message || `Failed to set input field text on ${params.objectPath}`
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
            triggerEndEdit: response.triggerEndEdit,
            endEditFired: response.endEditFired,
          },
          null,
          2
        ),
      },
    ],
  };
}
