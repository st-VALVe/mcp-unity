import * as z from 'zod';
import { Logger } from '../utils/logger.js';
import { McpUnity } from '../unity/mcpUnity.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpUnityError, ErrorType } from '../utils/errors.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// Constants for the tool
const toolName = 'run_tests';
const toolDescription = 'Runs Unity\'s Test Runner tests';
const DirtyScenePolicy = z.enum(['fail', 'report', 'save', 'discard']);
const DirtyScenePolicyScope = z.enum(['active', 'loaded']);
const paramsSchema = z.object({
  testMode: z.string().optional().default('EditMode').describe('The test mode to run (EditMode or PlayMode) - defaults to EditMode (optional)'),
  testFilter: z.string().optional().default('').describe('The specific test filter to run (e.g. specific test name or class name, must include namespace) (optional)'),
  returnOnlyFailures: z.boolean().optional().default(true).describe('Whether to show only failed tests in the results (optional)'),
  returnWithLogs: z.boolean().optional().default(false).describe('Whether to return the test logs in the results (optional)'),
  captureOnFailure: z.boolean().optional().default(false).describe('When true, automatically capture screenshot/log/hierarchy diagnostics if the test run has failures.'),
  diagnosticsOutputDir: z.string().optional().describe("Optional parent directory for failure diagnostics. Defaults to 'Temp/mcp-diagnostics'."),
  diagnosticsLabel: z.string().optional().describe('Optional label for the failure diagnostics folder.'),
  includeScreenshot: z.boolean().optional().default(true).describe('Include a Game view screenshot in failure diagnostics.'),
  includeConsoleLogs: z.boolean().optional().default(true).describe('Include console logs in failure diagnostics.'),
  includeHierarchy: z.boolean().optional().default(true).describe('Include scene hierarchy JSON in failure diagnostics.'),
  logType: z.string().optional().default('error').describe("Console log type filter for failure diagnostics: 'error', 'warning', 'info', or omit for all."),
  logLimit: z.number().int().min(1).max(1000).optional().default(50).describe('Maximum console logs to capture on failure.'),
  includeStackTrace: z.boolean().optional().default(false).describe('Include stack traces in failure diagnostics console logs.'),
  superSize: z.number().int().min(1).max(8).optional().default(1).describe('Screenshot resolution multiplier for failure diagnostics.'),
  waitSeconds: z.number().min(0.1).max(30).optional().default(2).describe('Screenshot file write timeout for failure diagnostics.'),
  dirtyScenePolicy: DirtyScenePolicy.optional().default('report')
    .describe("Policy for dirty scenes before action: 'fail' (refuse), 'report' (warn+proceed, default), 'save' (persist), 'discard' (reload from disk; requires dirtyScenePolicyScope)."),
  dirtyScenePolicyScope: DirtyScenePolicyScope.optional()
    .describe("Required when dirtyScenePolicy='discard'. 'active' reloads only the active scene (additive scenes detached). 'loaded' reloads all loaded scenes by path.")
});

/**
 * Creates and registers the Run Tests tool with the MCP server
 * This tool allows running tests in the Unity Test Runner
 * 
 * @param server The MCP server instance to register with
 * @param mcpUnity The McpUnity instance to communicate with Unity
 * @param logger The logger instance for diagnostic information
 */
export function registerRunTestsTool(server: McpServer, mcpUnity: McpUnity, logger: Logger) {
  logger.info(`Registering tool: ${toolName}`);
  
  // Register this tool with the MCP server
  server.tool(
    toolName,
    toolDescription,
    paramsSchema.shape,
    async (params: any = {}) => {
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

/**
 * Handles running tests in Unity
 * 
 * @param mcpUnity The McpUnity instance to communicate with Unity
 * @param params The parameters for the tool
 * @returns A promise that resolves to the tool execution result
 * @throws McpUnityError if the request to Unity fails
 */
async function toolHandler(mcpUnity: McpUnity, params: any = {}): Promise<CallToolResult> {
  const {
    testMode = 'EditMode',
    testFilter = '',
    returnOnlyFailures = true,
    returnWithLogs = false,
    captureOnFailure = false,
    diagnosticsOutputDir,
    diagnosticsLabel,
    includeScreenshot = true,
    includeConsoleLogs = true,
    includeHierarchy = true,
    logType = 'error',
    logLimit = 50,
    includeStackTrace = false,
    superSize = 1,
    waitSeconds = 2,
    dirtyScenePolicy = 'report',
    dirtyScenePolicyScope
  } = params;

  // Create and wait for the test run
  const response = await mcpUnity.sendRequest({
    method: toolName,
    params: { 
      testMode,
      testFilter,
      returnOnlyFailures,
      returnWithLogs,
      captureOnFailure,
      diagnosticsOutputDir,
      diagnosticsLabel,
      includeScreenshot,
      includeConsoleLogs,
      includeHierarchy,
      logType,
      logLimit,
      includeStackTrace,
      superSize,
      waitSeconds,
      dirtyScenePolicy,
      dirtyScenePolicyScope
    }
  });
  
  // Process the test results
  if (!response.success) {
    throw new McpUnityError(
      ErrorType.TOOL_EXECUTION,
      response.error?.message || response.message || `Failed to run tests: Mode=${testMode}, Filter=${testFilter || 'none'}`,
      response.error || response
    );
  }
  
  // Extract test results
  const testResults = response.results || [];
  const testCount = response.testCount || 0;
  const passCount = response.passCount || 0;
  const failCount = response.failCount || 0;
  const skipCount = response.skipCount || 0;
  const diagnostics = response.diagnostics;
  const preflight = response.preflight;
  
  return {
    content: [
      {
        type: 'text',
        text: response.message
      },
      {
        type: 'text',
        text: JSON.stringify({
          testCount,
          passCount,
          failCount,
          skipCount,
          preflight,
          diagnostics,
          results: testResults
        }, null, 2)
      }
    ]
  };
}
