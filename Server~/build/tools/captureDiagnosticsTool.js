import * as z from 'zod';
import { McpUnityError, ErrorType } from '../utils/errors.js';
const toolName = 'capture_diagnostics';
const toolDescription = 'Captures a diagnostic artifact bundle for UI/test failures: Game view screenshot, console logs, scene hierarchy, and metadata. Returns paths instead of huge payloads.';
const paramsSchema = z.object({
    label: z.string().optional().describe('Short label used in the output folder name.'),
    outputDir: z
        .string()
        .optional()
        .describe("Optional parent output directory. Absolute or relative to the Unity project root. Defaults to 'Temp/mcp-diagnostics'."),
    includeScreenshot: z.boolean().optional().default(true).describe('Capture the Unity Game view screenshot.'),
    includeConsoleLogs: z.boolean().optional().default(true).describe('Save recent Unity console logs.'),
    includeHierarchy: z.boolean().optional().default(true).describe('Save loaded scene hierarchy JSON.'),
    logType: z
        .string()
        .optional()
        .default('error')
        .describe("Console log type filter: 'error', 'warning', 'info', or omit for all."),
    logLimit: z.number().int().min(1).max(1000).optional().default(50).describe('Maximum console logs to save.'),
    includeStackTrace: z.boolean().optional().default(false).describe('Include stack traces in console log JSON.'),
    superSize: z.number().int().min(1).max(8).optional().default(1).describe('Screenshot resolution multiplier.'),
    waitSeconds: z.number().min(0.1).max(30).optional().default(2).describe('Screenshot file write timeout.'),
});
export function registerCaptureDiagnosticsTool(server, mcpUnity, logger) {
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
            label: params.label,
            outputDir: params.outputDir,
            includeScreenshot: params.includeScreenshot ?? true,
            includeConsoleLogs: params.includeConsoleLogs ?? true,
            includeHierarchy: params.includeHierarchy ?? true,
            logType: params.logType ?? 'error',
            logLimit: params.logLimit ?? 50,
            includeStackTrace: params.includeStackTrace ?? false,
            superSize: params.superSize ?? 1,
            waitSeconds: params.waitSeconds ?? 2,
        },
    });
    if (!response.success) {
        throw new McpUnityError(ErrorType.TOOL_EXECUTION, response.message || 'Failed to capture Unity diagnostics');
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
                    directory: response.directory,
                    label: response.label,
                    artifacts: response.artifacts,
                    warnings: response.warnings,
                }, null, 2),
            },
        ],
    };
}
