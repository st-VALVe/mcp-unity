import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { registerUiTools } from '../tools/uiTools.js';
import { McpUnityError } from '../utils/errors.js';

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

describe('UI Tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registers all Unity UI tools', () => {
    registerUiTools(mockServer as any, mockMcpUnity as any, mockLogger as any);

    const registeredNames = mockServerTool.mock.calls.map(call => call[0]);
    expect(registeredNames).toEqual([
      'click_ui',
      'scroll_ui',
      'set_ui_input_text',
      'invoke_component_method'
    ]);
  });

  it('exposes useful schemas for the UI tools', () => {
    registerUiTools(mockServer as any, mockMcpUnity as any, mockLogger as any);

    const clickSchema = mockServerTool.mock.calls[0][2];
    const scrollSchema = mockServerTool.mock.calls[1][2];
    const textSchema = mockServerTool.mock.calls[2][2];
    const invokeSchema = mockServerTool.mock.calls[3][2];

    expect(clickSchema).toHaveProperty('objectPath');
    expect(clickSchema).toHaveProperty('screenPosition');
    expect(scrollSchema).toHaveProperty('verticalDelta');
    expect(scrollSchema).toHaveProperty('verticalNormalizedPosition');
    expect(textSchema).toHaveProperty('text');
    expect(invokeSchema).toHaveProperty('componentName');
    expect(invokeSchema).toHaveProperty('methodName');
  });

  it('sends click_ui requests to Unity', async () => {
    registerUiTools(mockServer as any, mockMcpUnity as any, mockLogger as any);
    const clickHandler = mockServerTool.mock.calls[0][3];

    mockSendRequest.mockResolvedValue({
      success: true,
      type: 'text',
      message: 'Clicked UI GameObject'
    });

    const result = await clickHandler({
      objectPath: 'Canvas/ContinueButton',
      clickCount: 1
    });

    expect(mockSendRequest).toHaveBeenCalledWith({
      method: 'click_ui',
      params: expect.objectContaining({
        objectPath: 'Canvas/ContinueButton',
        clickCount: 1
      })
    });
    expect(result.content[0].text).toContain('Clicked');
  });

  it('rejects calls without instanceId or objectPath', async () => {
    registerUiTools(mockServer as any, mockMcpUnity as any, mockLogger as any);
    const textHandler = mockServerTool.mock.calls[2][3];

    await expect(textHandler({ text: '04/11/1982' })).rejects.toThrow(McpUnityError);
  });

  it('throws tool execution errors returned by Unity', async () => {
    registerUiTools(mockServer as any, mockMcpUnity as any, mockLogger as any);
    const invokeHandler = mockServerTool.mock.calls[3][3];

    mockSendRequest.mockResolvedValue({
      success: false,
      message: 'Method not found'
    });

    await expect(invokeHandler({
      objectPath: 'Canvas/Popup',
      componentName: 'DOBPopUpController',
      methodName: 'ClosePopup'
    })).rejects.toThrow('Method not found');
  });
});
