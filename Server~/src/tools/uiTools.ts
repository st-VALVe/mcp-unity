import * as z from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { McpUnity } from '../unity/mcpUnity.js';
import { ErrorType, McpUnityError } from '../utils/errors.js';
import { Logger } from '../utils/logger.js';

const targetSchema = {
  instanceId: z.number().optional().describe('The instance ID of the target GameObject'),
  objectPath: z.string().optional().describe('The hierarchy path of the target GameObject')
};

const screenPositionSchema = z.object({
  x: z.number().describe('Screen-space X coordinate'),
  y: z.number().describe('Screen-space Y coordinate')
});

const clickUiSchema = z.object({
  ...targetSchema,
  screenPosition: screenPositionSchema.optional().describe('Optional screen position. Defaults to the target RectTransform center.'),
  button: z.enum(['Left', 'Right', 'Middle']).optional().default('Left').describe('Pointer button to use for the click'),
  clickCount: z.number().int().min(1).optional().default(1).describe('Pointer click count'),
  sendSubmit: z.boolean().optional().default(false).describe('Also send a submit event after the pointer click'),
  forceButtonInvoke: z.boolean().optional().default(true).describe('Invoke Button.onClick directly if pointer events do not find a click handler')
});

const scrollUiSchema = z.object({
  ...targetSchema,
  verticalNormalizedPosition: z.number().optional().describe('Absolute ScrollRect vertical normalized position, where 1 is top and 0 is bottom'),
  horizontalNormalizedPosition: z.number().optional().describe('Absolute ScrollRect horizontal normalized position'),
  verticalDelta: z.number().optional().default(0).describe('Delta to add to vertical normalized position'),
  horizontalDelta: z.number().optional().default(0).describe('Delta to add to horizontal normalized position'),
  verticalWheelDelta: z.number().optional().describe('Scroll event wheel delta Y. Defaults to verticalDelta.'),
  horizontalWheelDelta: z.number().optional().describe('Scroll event wheel delta X. Defaults to horizontalDelta.'),
  screenPosition: screenPositionSchema.optional().describe('Optional screen position for the scroll event'),
  searchParents: z.boolean().optional().default(true).describe('Search parent GameObjects for a ScrollRect'),
  searchChildren: z.boolean().optional().default(false).describe('Search child GameObjects for a ScrollRect'),
  clamp: z.boolean().optional().default(true).describe('Clamp normalized positions to 0..1'),
  dispatchScrollEvent: z.boolean().optional().default(true).describe('Also dispatch an EventSystem scroll event')
});

const setUiInputTextSchema = z.object({
  ...targetSchema,
  text: z.string().describe('Text to apply to the target input/text component'),
  notify: z.boolean().optional().default(true).describe('Notify input field value changed callbacks when possible'),
  submit: z.boolean().optional().default(false).describe('Invoke input submit/end-edit callbacks when possible'),
  searchParents: z.boolean().optional().default(false).describe('Search parent GameObjects for text/input components'),
  searchChildren: z.boolean().optional().default(false).describe('Search child GameObjects for text/input components')
});

const invokeComponentMethodSchema = z.object({
  ...targetSchema,
  componentName: z.string().describe('Component type name or full name'),
  methodName: z.string().describe('Method to invoke on the component'),
  arguments: z.array(z.any()).optional().default([]).describe('Method arguments encoded as JSON values'),
  includeNonPublic: z.boolean().optional().default(false).describe('Allow invoking private/protected methods'),
  searchParents: z.boolean().optional().default(false).describe('Search parent GameObjects for the component'),
  searchChildren: z.boolean().optional().default(false).describe('Search child GameObjects for the component')
});

type UnityToolResponse = {
  success?: boolean;
  type?: string;
  message?: string;
  [key: string]: unknown;
};

type ToolRegistration = {
  name: string;
  description: string;
  schema: z.ZodObject<any>;
};

const registrations: ToolRegistration[] = [
  {
    name: 'click_ui',
    description: 'Clicks a Unity UI GameObject by instance ID or hierarchy path using EventSystem pointer events.',
    schema: clickUiSchema
  },
  {
    name: 'scroll_ui',
    description: 'Scrolls a Unity UI ScrollRect by normalized position/delta and can dispatch a scroll event.',
    schema: scrollUiSchema
  },
  {
    name: 'set_ui_input_text',
    description: 'Sets text on Unity UI InputField, TMP_InputField, Text, or TMP_Text components.',
    schema: setUiInputTextSchema
  },
  {
    name: 'invoke_component_method',
    description: 'Invokes a method on a component attached to a GameObject, with optional non-public access.',
    schema: invokeComponentMethodSchema
  }
];

export function registerUiTools(server: McpServer, mcpUnity: McpUnity, logger: Logger) {
  for (const registration of registrations) {
    logger.info(`Registering tool: ${registration.name}`);

    server.tool(
      registration.name,
      registration.description,
      registration.schema.shape,
      async (params: any) => {
        try {
          logger.info(`Executing tool: ${registration.name}`, params);
          const result = await uiToolHandler(mcpUnity, registration.name, params);
          logger.info(`Tool execution successful: ${registration.name}`);
          return result;
        } catch (error) {
          logger.error(`Tool execution failed: ${registration.name}`, error);
          throw error;
        }
      }
    );
  }
}

async function uiToolHandler(mcpUnity: McpUnity, toolName: string, params: Record<string, unknown>): Promise<CallToolResult> {
  validateTarget(params);

  const response = await mcpUnity.sendRequest({
    method: toolName,
    params
  }) as UnityToolResponse;

  if (!response.success) {
    throw new McpUnityError(
      ErrorType.TOOL_EXECUTION,
      response.message || `Failed to execute Unity UI tool '${toolName}'`
    );
  }

  return {
    content: [{
      type: 'text',
      text: response.message || `Unity UI tool '${toolName}' completed successfully`
    }]
  };
}

function validateTarget(params: Record<string, unknown>) {
  const hasInstanceId = params.instanceId !== undefined && params.instanceId !== null;
  const hasObjectPath = typeof params.objectPath === 'string' && params.objectPath.trim() !== '';

  if (!hasInstanceId && !hasObjectPath) {
    throw new McpUnityError(
      ErrorType.VALIDATION,
      "Either 'instanceId' or 'objectPath' must be provided"
    );
  }
}
