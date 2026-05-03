import * as z from 'zod';
const toolName = 'dismiss_unity_modal';
const toolDescription = 'Out-of-process dismissal of a native Win32 modal dialog blocking the Unity Editor main thread. Caller must specify the exact button name (case-sensitive). Idempotent — returns dialog_already_dismissed if the dialog is gone. Windows-only.';
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
    button: z
        .string()
        .min(1)
        .describe('Exact button name to click. Must equal one of the buttons listed by detect_unity_modal. Case-sensitive — no fuzzy matching.'),
});
export function registerDismissUnityModalTool(server, mcpUnity, helper, logger) {
    logger.info(`Registering tool: ${toolName}`);
    server.tool(toolName, toolDescription, paramsSchema.shape, async (params) => {
        try {
            logger.info(`Executing tool: ${toolName}`, params);
            const result = await toolHandler(mcpUnity, helper, params);
            logger.info(`Tool execution successful: ${toolName}`);
            return result;
        }
        catch (error) {
            logger.error(`Tool execution failed: ${toolName}`, error);
            throw error;
        }
    });
}
async function toolHandler(mcpUnity, helper, params) {
    const dismissResult = await helper.dismiss({
        targetPid: params.targetPid,
        projectPath: params.projectPath,
        button: params.button,
    });
    const unityResponsiveAfter = await probeUnityResponsiveness(mcpUnity);
    const response = { ...dismissResult, unityResponsiveAfter };
    return {
        content: [
            { type: 'text', text: summarize(response) },
            { type: 'text', text: JSON.stringify(response, null, 2) },
        ],
    };
}
async function probeUnityResponsiveness(mcpUnity) {
    if (!mcpUnity.isConnected) {
        return { wsConnected: false };
    }
    const start = Date.now();
    try {
        await mcpUnity.sendRequest({ method: 'get_scene_info', params: {} }, { queueIfDisconnected: false, timeout: 1500, skipModalDiagnosticsOnTimeout: true });
        return { wsConnected: true, mainThreadResponsive: true, probeMs: Date.now() - start };
    }
    catch {
        return { wsConnected: true, mainThreadResponsive: false, probeMs: Date.now() - start };
    }
}
function summarize(r) {
    const probe = formatProbe(r.unityResponsiveAfter);
    switch (r.outcome) {
        case 'clicked':
            return `Clicked "${r.selectedAction}" on Unity PID ${r.targetProcess.pid}. ${probe}`;
        case 'dialog_already_dismissed':
            return `No native modal to dismiss on Unity PID ${r.targetProcess.pid} — already gone. ${probe}`;
        case 'button_not_available': {
            const have = (r.availableButtons ?? []).map((b) => `"${b.name}"`).join(', ');
            return `Button not found on Unity PID ${r.targetProcess.pid}. Available: ${have}. ${probe}`;
        }
    }
}
function formatProbe(p) {
    if (!p.wsConnected)
        return 'WebSocket not connected — cannot probe Unity responsiveness.';
    if (p.mainThreadResponsive)
        return `Unity main thread responsive (${p.probeMs}ms).`;
    return `Unity main thread STILL unresponsive after dismiss (probe ${p.probeMs}ms).`;
}
