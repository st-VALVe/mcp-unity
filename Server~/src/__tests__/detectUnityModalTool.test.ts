import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { registerDetectUnityModalTool } from '../tools/detectUnityModalTool.js';
import { McpUnityError, ErrorType } from '../utils/errors.js';

const mockHelperDetect = jest.fn();
const mockHelper = { detect: mockHelperDetect, dismiss: jest.fn() };

const mockMcpUnity = {};
const mockLogger = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
const mockServerTool = jest.fn();
const mockServer = { tool: mockServerTool };

describe('detect_unity_modal tool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('registration', () => {
    it('registers detect_unity_modal with the server', () => {
      registerDetectUnityModalTool(
        mockServer as any,
        mockMcpUnity as any,
        mockHelper as any,
        mockLogger as any
      );
      expect(mockServerTool).toHaveBeenCalledTimes(1);
      const [name, description, schema, handler] = mockServerTool.mock.calls[0] as any;
      expect(name).toBe('detect_unity_modal');
      expect(description).toContain('modal');
      expect(description).toContain('Windows');
      expect(schema).toHaveProperty('targetPid');
      expect(schema).toHaveProperty('projectPath');
      expect(typeof handler).toBe('function');
    });
  });

  describe('handler', () => {
    let toolHandler: (params: any) => Promise<any>;

    beforeEach(() => {
      registerDetectUnityModalTool(
        mockServer as any,
        mockMcpUnity as any,
        mockHelper as any,
        mockLogger as any
      );
      toolHandler = (mockServerTool.mock.calls[0] as any)[3];
    });

    it('forwards targetPid and projectPath to helper.detect', async () => {
      mockHelperDetect.mockResolvedValue({
        found: false,
        targetProcess: { pid: 12345, mainWindowTitle: 'X', projectPath: 'C:\\X' },
      } as never);

      await toolHandler({ targetPid: 12345, projectPath: 'C:\\X' });

      expect(mockHelperDetect).toHaveBeenCalledWith({ targetPid: 12345, projectPath: 'C:\\X' });
    });

    it('returns summary mentioning button names when modal found', async () => {
      mockHelperDetect.mockResolvedValue({
        found: true,
        targetProcess: { pid: 12345, mainWindowTitle: 'X', projectPath: 'C:\\X' },
        dialog: {
          title: 'Scene(s) Have Been Modified',
          windowClass: '#32770',
          isNative: true,
          availableButtons: [
            { name: 'Save', automationId: '1' },
            { name: "Don't Save", automationId: '2' },
            { name: 'Cancel', automationId: '3' },
          ],
        },
      } as never);

      const res = await toolHandler({});
      expect(res.content[0].text).toContain('Native modal detected');
      expect(res.content[0].text).toContain('"Save"');
      expect(res.content[0].text).toContain('"Don\'t Save"');
      expect(res.content[0].text).toContain('"Cancel"');
      const json = JSON.parse(res.content[1].text);
      expect(json.found).toBe(true);
      expect(json.dialog.availableButtons).toHaveLength(3);
    });

    it('returns clean summary when no modal and no extras', async () => {
      mockHelperDetect.mockResolvedValue({
        found: false,
        targetProcess: { pid: 12345, mainWindowTitle: 'X', projectPath: 'C:\\X' },
      } as never);

      const res = await toolHandler({});
      expect(res.content[0].text).toContain('No modal detected');
      expect(res.content[0].text).not.toContain('IMGUI');
    });

    it('flags unsupportedDialog in summary when extras present', async () => {
      mockHelperDetect.mockResolvedValue({
        found: false,
        targetProcess: { pid: 12345, mainWindowTitle: 'X', projectPath: 'C:\\X' },
        unsupportedDialog: {
          topLevelWindows: [
            { title: 'Main', className: 'UnityContainerWndClass' },
            { title: 'Mystery', className: 'SomeIMGUIClass' },
          ],
        },
      } as never);

      const res = await toolHandler({});
      expect(res.content[0].text).toContain('IMGUI');
      expect(res.content[0].text).toContain('SomeIMGUIClass');
      const json = JSON.parse(res.content[1].text);
      expect(json.unsupportedDialog.topLevelWindows).toHaveLength(2);
    });

    it('propagates helper errors (e.g. multiple_unity_processes)', async () => {
      mockHelperDetect.mockRejectedValue(
        new McpUnityError(
          ErrorType.VALIDATION,
          'multiple_unity_processes_require_explicit_target',
          { candidates: [] }
        ) as never
      );

      await expect(toolHandler({})).rejects.toMatchObject({
        type: ErrorType.VALIDATION,
        message: expect.stringContaining('multiple_unity_processes'),
      });
    });
  });
});
