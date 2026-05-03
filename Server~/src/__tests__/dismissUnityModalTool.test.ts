import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { registerDismissUnityModalTool } from '../tools/dismissUnityModalTool.js';
import { McpUnityError, ErrorType } from '../utils/errors.js';

const mockHelperDismiss = jest.fn();
const mockHelper = { detect: jest.fn(), dismiss: mockHelperDismiss };

const mockSendRequest = jest.fn();
let mockIsConnected = true;
const mockMcpUnity = {
  sendRequest: mockSendRequest,
  get isConnected() {
    return mockIsConnected;
  },
};

const mockLogger = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
const mockServerTool = jest.fn();
const mockServer = { tool: mockServerTool };

const SAMPLE_DIALOG = {
  title: 'Scene(s) Have Been Modified',
  windowClass: '#32770',
  isNative: true as const,
  availableButtons: [
    { name: 'Save', automationId: '1' },
    { name: "Don't Save", automationId: '2' },
  ],
};

const SAMPLE_TARGET_PROCESS = {
  pid: 12345,
  mainWindowTitle: 'Sample',
  projectPath: 'C:\\Project',
};

describe('dismiss_unity_modal tool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsConnected = true;
  });

  describe('registration', () => {
    it('registers dismiss_unity_modal with the server', () => {
      registerDismissUnityModalTool(
        mockServer as any,
        mockMcpUnity as any,
        mockHelper as any,
        mockLogger as any
      );
      const [name, description, schema, handler] = mockServerTool.mock.calls[0] as any;
      expect(name).toBe('dismiss_unity_modal');
      expect(description).toContain('Idempotent');
      expect(schema).toHaveProperty('button');
      expect(schema).toHaveProperty('targetPid');
      expect(schema).toHaveProperty('projectPath');
      expect(typeof handler).toBe('function');
    });
  });

  describe('handler', () => {
    let toolHandler: (params: any) => Promise<any>;

    beforeEach(() => {
      registerDismissUnityModalTool(
        mockServer as any,
        mockMcpUnity as any,
        mockHelper as any,
        mockLogger as any
      );
      toolHandler = (mockServerTool.mock.calls[0] as any)[3];
    });

    it('forwards button + targetPid + projectPath to helper.dismiss', async () => {
      mockHelperDismiss.mockResolvedValue({
        outcome: 'clicked',
        selectedAction: "Don't Save",
        targetProcess: SAMPLE_TARGET_PROCESS,
        dialog: SAMPLE_DIALOG,
      } as never);
      mockSendRequest.mockResolvedValue({} as never);

      await toolHandler({ button: "Don't Save", targetPid: 12345, projectPath: 'C:\\Project' });

      expect(mockHelperDismiss).toHaveBeenCalledWith({
        button: "Don't Save",
        targetPid: 12345,
        projectPath: 'C:\\Project',
      });
    });

    it('runs probe via mcpUnity.sendRequest after successful click', async () => {
      mockHelperDismiss.mockResolvedValue({
        outcome: 'clicked',
        selectedAction: "Don't Save",
        targetProcess: SAMPLE_TARGET_PROCESS,
        dialog: SAMPLE_DIALOG,
      } as never);
      mockSendRequest.mockResolvedValue({} as never);

      const res = await toolHandler({ button: "Don't Save" });

      expect(mockSendRequest).toHaveBeenCalledWith(
        { method: 'get_scene_info', params: {} },
        { queueIfDisconnected: false, timeout: 1500 }
      );
      const json = JSON.parse(res.content[1].text);
      expect(json.unityResponsiveAfter.wsConnected).toBe(true);
      expect(json.unityResponsiveAfter.mainThreadResponsive).toBe(true);
      expect(typeof json.unityResponsiveAfter.probeMs).toBe('number');
    });

    it('reports mainThreadResponsive:false when probe rejects', async () => {
      mockHelperDismiss.mockResolvedValue({
        outcome: 'clicked',
        selectedAction: "Don't Save",
        targetProcess: SAMPLE_TARGET_PROCESS,
        dialog: SAMPLE_DIALOG,
      } as never);
      mockSendRequest.mockRejectedValue(new McpUnityError(ErrorType.TIMEOUT, 'probe timed out') as never);

      const res = await toolHandler({ button: "Don't Save" });
      const json = JSON.parse(res.content[1].text);
      expect(json.unityResponsiveAfter.wsConnected).toBe(true);
      expect(json.unityResponsiveAfter.mainThreadResponsive).toBe(false);
      expect(typeof json.unityResponsiveAfter.probeMs).toBe('number');
      expect(res.content[0].text).toContain('STILL unresponsive');
    });

    it('skips probe when websocket is not connected', async () => {
      mockIsConnected = false;
      mockHelperDismiss.mockResolvedValue({
        outcome: 'clicked',
        selectedAction: "Don't Save",
        targetProcess: SAMPLE_TARGET_PROCESS,
        dialog: SAMPLE_DIALOG,
      } as never);

      const res = await toolHandler({ button: "Don't Save" });
      expect(mockSendRequest).not.toHaveBeenCalled();
      const json = JSON.parse(res.content[1].text);
      expect(json.unityResponsiveAfter).toEqual({ wsConnected: false });
      expect(res.content[0].text).toContain('WebSocket not connected');
    });

    it('runs probe even when outcome is dialog_already_dismissed', async () => {
      mockHelperDismiss.mockResolvedValue({
        outcome: 'dialog_already_dismissed',
        targetProcess: SAMPLE_TARGET_PROCESS,
      } as never);
      mockSendRequest.mockResolvedValue({} as never);

      const res = await toolHandler({ button: "Don't Save" });
      expect(mockSendRequest).toHaveBeenCalled();
      const json = JSON.parse(res.content[1].text);
      expect(json.outcome).toBe('dialog_already_dismissed');
      expect(json.unityResponsiveAfter.mainThreadResponsive).toBe(true);
    });

    it('surfaces button_not_available with availableButtons in summary', async () => {
      mockHelperDismiss.mockResolvedValue({
        outcome: 'button_not_available',
        targetProcess: SAMPLE_TARGET_PROCESS,
        dialog: SAMPLE_DIALOG,
        availableButtons: [
          { name: 'Save', automationId: '1' },
          { name: "Don't Save", automationId: '2' },
        ],
      } as never);
      mockSendRequest.mockResolvedValue({} as never);

      const res = await toolHandler({ button: 'Apply' });
      expect(res.content[0].text).toContain('Button not found');
      expect(res.content[0].text).toContain('"Save"');
      const json = JSON.parse(res.content[1].text);
      expect(json.availableButtons).toHaveLength(2);
    });

    it('propagates helper errors (e.g. unsupported_dialog_kind)', async () => {
      mockHelperDismiss.mockRejectedValue(
        new McpUnityError(ErrorType.VALIDATION, 'unsupported_dialog_kind', {
          topLevelWindows: [],
        }) as never
      );
      await expect(toolHandler({ button: 'Save' })).rejects.toMatchObject({
        type: ErrorType.VALIDATION,
        message: expect.stringContaining('unsupported_dialog_kind'),
      });
      expect(mockSendRequest).not.toHaveBeenCalled();
    });
  });
});
