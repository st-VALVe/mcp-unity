import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { ErrorType } from '../utils/errors.js';
import { registerEnterPlayModeTool } from '../tools/enterPlayModeTool.js';

const mockSendRequest = jest.fn();
const mockMcpUnity = {
  sendRequest: mockSendRequest
};

const mockLogger = {
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};

const mockServerTool = jest.fn();
const mockServer = {
  tool: mockServerTool
};

describe('enter_play_mode tool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registers dirty scene preflight schema fields', () => {
    registerEnterPlayModeTool(mockServer as any, mockMcpUnity as any, mockLogger as any);

    const [name, , schema] = mockServerTool.mock.calls[0] as any;
    expect(name).toBe('enter_play_mode');
    expect(schema).toHaveProperty('dirtyScenePolicy');
    expect(schema).toHaveProperty('dirtyScenePolicyScope');
    expect(schema.dirtyScenePolicy.parse(undefined)).toBe('report');
  });

  it('forwards dirty scene policy fields to Unity', async () => {
    registerEnterPlayModeTool(mockServer as any, mockMcpUnity as any, mockLogger as any);
    const handler = (mockServerTool.mock.calls[0] as any)[3];
    mockSendRequest.mockResolvedValue({
      success: true,
      type: 'text',
      message: 'Requested Play Mode entry.',
      preflight: { dirtyScenePolicy: 'fail', warnings: [] }
    } as never);

    await handler({ dirtyScenePolicy: 'fail', dirtyScenePolicyScope: 'loaded' });

    expect(mockSendRequest).toHaveBeenCalledWith({
      method: 'enter_play_mode',
      params: {
        dirtyScenePolicy: 'fail',
        dirtyScenePolicyScope: 'loaded'
      }
    });
  });

  it('defaults dirtyScenePolicy to report when handler is called directly', async () => {
    registerEnterPlayModeTool(mockServer as any, mockMcpUnity as any, mockLogger as any);
    const handler = (mockServerTool.mock.calls[0] as any)[3];
    mockSendRequest.mockResolvedValue({
      success: true,
      type: 'text',
      message: 'Requested Play Mode entry.',
      preflight: { dirtyScenePolicy: 'report', warnings: [] }
    } as never);

    await handler({});

    expect(mockSendRequest).toHaveBeenCalledWith({
      method: 'enter_play_mode',
      params: {
        dirtyScenePolicy: 'report',
        dirtyScenePolicyScope: undefined
      }
    });
  });

  it('propagates structured dirty scene refusal details', async () => {
    registerEnterPlayModeTool(mockServer as any, mockMcpUnity as any, mockLogger as any);
    const handler = (mockServerTool.mock.calls[0] as any)[3];
    mockSendRequest.mockResolvedValue({
      success: false,
      error: {
        type: 'dirty_scene_preflight_refused',
        errcode: 'dirty_scenes_blocked',
        message: 'Refused to proceed.',
        dirtyScenes: [{ name: 'Main', path: 'Assets/Main.unity', isActive: true, hasPath: true }]
      }
    } as never);

    await expect(handler({ dirtyScenePolicy: 'fail' })).rejects.toMatchObject({
      type: ErrorType.TOOL_EXECUTION,
      message: 'Refused to proceed.',
      details: expect.objectContaining({
        errcode: 'dirty_scenes_blocked'
      })
    });
  });
});
