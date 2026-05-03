import { jest, describe, it, expect } from '@jest/globals';
import { attachModalDiagnosticsOnTimeout } from '../utils/unityModalHelper.js';

describe('attachModalDiagnosticsOnTimeout', () => {
  it('does nothing when feature is disabled', async () => {
    const mockDetect = jest.fn();
    const helper = { detect: mockDetect } as any;
    const error: any = {};

    await attachModalDiagnosticsOnTimeout(helper, false, 500, error);

    expect(mockDetect).not.toHaveBeenCalled();
    expect(error.details).toBeUndefined();
  });

  it('does nothing when helper is null', async () => {
    const error: any = {};
    await attachModalDiagnosticsOnTimeout(null, true, 500, error);
    expect(error.details).toBeUndefined();
  });

  it('attaches modalDiagnostics on successful detect', async () => {
    const detectResult = {
      found: true,
      targetProcess: { pid: 12345, mainWindowTitle: 'X', projectPath: 'C:\\X' },
      dialog: {
        title: 'Modal',
        windowClass: '#32770',
        isNative: true,
        availableButtons: [{ name: 'OK', automationId: '1' }],
      },
    };
    const helper = { detect: jest.fn(async () => detectResult) } as any;
    const error: any = {};

    await attachModalDiagnosticsOnTimeout(helper, true, 500, error);

    expect(error.details).toEqual({ modalDiagnostics: detectResult });
    expect(helper.detect).toHaveBeenCalledWith({ budgetMs: 500 });
  });

  it('preserves existing error.details when attaching diagnostics', async () => {
    const detectResult = { found: false, targetProcess: { pid: 1, mainWindowTitle: '', projectPath: null } };
    const helper = { detect: jest.fn(async () => detectResult) } as any;
    const error: any = { details: { existing: 'value' } };

    await attachModalDiagnosticsOnTimeout(helper, true, 500, error);

    expect(error.details).toEqual({ existing: 'value', modalDiagnostics: detectResult });
  });

  it('does not mask the original timeout when detect rejects', async () => {
    const helper = {
      detect: jest.fn(async () => {
        throw new Error('detect blew up');
      }),
    } as any;
    const error: any = { details: { someExisting: 'data' } };

    await expect(
      attachModalDiagnosticsOnTimeout(helper, true, 500, error)
    ).resolves.toBeUndefined();
    // Original error untouched (no modalDiagnostics added)
    expect(error.details).toEqual({ someExisting: 'data' });
  });

  it('does not mask the original timeout when detect exceeds budget', async () => {
    const helper = {
      detect: jest.fn(
        () =>
          new Promise(() => {
            /* never resolves */
          })
      ),
    } as any;
    const error: any = {};

    await attachModalDiagnosticsOnTimeout(helper, true, 50, error);

    expect(error.details).toBeUndefined();
  });
});
