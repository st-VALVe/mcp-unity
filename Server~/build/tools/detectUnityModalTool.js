import * as z from 'zod';
const toolName = 'detect_unity_modal';
const toolDescription = 'Out-of-process detection of native Win32 modal dialogs blocking the Unity Editor main thread. Read-only — never clicks anything. Use when WebSocket is connected but Unity stops responding to tool calls. Windows-only.';
const paramsSchema = z.object({
    targetPid: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Explicit Unity process PID. If omitted, helper auto-resolves via projectPath / cwd / UNITY_PID env / single-Unity heuristic.'),
    projectPath: z
        .string()
        .optional()
        .describe('Unity project root. Helper filters Unity.exe processes by their -projectpath command-line argument.'),
});
export function registerDetectUnityModalTool(server, _mcpUnity, helper, logger) {
    logger.info(`Registering tool: ${toolName}`);
    server.tool(toolName, toolDescription, paramsSchema.shape, async (params) => {
        try {
            logger.info(`Executing tool: ${toolName}`, params);
            const result = await toolHandler(helper, params);
            logger.info(`Tool execution successful: ${toolName}`);
            return result;
        }
        catch (error) {
            logger.error(`Tool execution failed: ${toolName}`, error);
            throw error;
        }
    });
}
async function toolHandler(helper, params) {
    const result = await helper.detect({
        targetPid: params.targetPid,
        projectPath: params.projectPath,
    });
    return {
        content: [
            { type: 'text', text: summarize(result) },
            { type: 'text', text: JSON.stringify(result, null, 2) },
        ],
    };
}
function summarize(result) {
    if (result.found) {
        const buttons = result.dialog.availableButtons.map((b) => `"${b.name}"`).join(', ');
        return `Native modal detected on Unity PID ${result.targetProcess.pid}: "${result.dialog.title}". Buttons: ${buttons}.`;
    }
    if (result.unsupportedDialog) {
        const classes = result.unsupportedDialog.topLevelWindows.map((w) => w.className).join(', ');
        return `No native modal detected on Unity PID ${result.targetProcess.pid}, but extra non-#32770 windows are present (classes: ${classes}). Likely IMGUI / unsupported_dialog_kind.`;
    }
    return `No modal detected on Unity PID ${result.targetProcess.pid}.`;
}
