import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { ErrorType } from '../utils/errors.js';
import { registerRunTestsTool } from '../tools/runTestsTool.js';

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

describe('run_tests tool dirty scene preflight', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registers dirty scene preflight schema fields', () => {
    registerRunTestsTool(mockServer as any, mockMcpUnity as any, mockLogger as any);

    const [name, , schema] = mockServerTool.mock.calls[0] as any;
    expect(name).toBe('run_tests');
    expect(schema).toHaveProperty('dirtyScenePolicy');
    expect(schema).toHaveProperty('dirtyScenePolicyScope');
    expect(schema.dirtyScenePolicy.parse(undefined)).toBe('report');
  });

  it('forwards dirty scene policy fields to Unity', async () => {
    registerRunTestsTool(mockServer as any, mockMcpUnity as any, mockLogger as any);
    const handler = (mockServerTool.mock.calls[0] as any)[3];
    mockSendRequest.mockResolvedValue({
      success: true,
      type: 'text',
      message: 'Tests completed.',
      testCount: 1,
      passCount: 1,
      failCount: 0,
      skipCount: 0,
      results: [],
      preflight: { dirtyScenePolicy: 'save', warnings: [] }
    } as never);

    await handler({ testMode: 'EditMode', dirtyScenePolicy: 'save', dirtyScenePolicyScope: 'active' });

    expect(mockSendRequest).toHaveBeenCalledWith({
      method: 'run_tests',
      params: expect.objectContaining({
        testMode: 'EditMode',
        dirtyScenePolicy: 'save',
        dirtyScenePolicyScope: 'active'
      })
    });
  });

  it('defaults dirtyScenePolicy to report when handler is called directly', async () => {
    registerRunTestsTool(mockServer as any, mockMcpUnity as any, mockLogger as any);
    const handler = (mockServerTool.mock.calls[0] as any)[3];
    mockSendRequest.mockResolvedValue({
      success: true,
      type: 'text',
      message: 'Tests completed.',
      testCount: 0,
      passCount: 0,
      failCount: 0,
      skipCount: 0,
      results: [],
      preflight: { dirtyScenePolicy: 'report', warnings: [] }
    } as never);

    await handler({});

    expect(mockSendRequest).toHaveBeenCalledWith({
      method: 'run_tests',
      params: expect.objectContaining({
        dirtyScenePolicy: 'report',
        dirtyScenePolicyScope: undefined
      })
    });
  });

  it('propagates structured dirty scene refusal details', async () => {
    registerRunTestsTool(mockServer as any, mockMcpUnity as any, mockLogger as any);
    const handler = (mockServerTool.mock.calls[0] as any)[3];
    mockSendRequest.mockResolvedValue({
      success: false,
      error: {
        type: 'dirty_scene_preflight_refused',
        errcode: 'discard_requires_scope',
        message: "dirtyScenePolicy='discard' requires dirtyScenePolicyScope='active' or 'loaded'.",
        discardScopes: ['active', 'loaded']
      }
    } as never);

    await expect(handler({ dirtyScenePolicy: 'discard' })).rejects.toMatchObject({
      type: ErrorType.TOOL_EXECUTION,
      details: expect.objectContaining({
        errcode: 'discard_requires_scope'
      })
    });
  });
});
