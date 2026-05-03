import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { EventEmitter } from 'events';
import { Logger, LogLevel } from '../utils/logger.js';
import { UnityModalHelper, HelperEnvironment } from '../utils/unityModalHelper.js';
import { McpUnityError, ErrorType } from '../utils/errors.js';

/**
 * Fake child process: emits planned stdout/stderr and a close event on the next tick.
 * Captures stdin so tests can assert what the helper sent to PowerShell.
 */
class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdinChunks: string[] = [];
  killed = false;

  stdin = {
    write: (chunk: string | Buffer) => {
      this.stdinChunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      return true;
    },
    end: () => {},
  };

  kill(_signal?: string) {
    this.killed = true;
    this.emit('close', null);
  }

  emitStdout(text: string) {
    this.stdout.emit('data', Buffer.from(text));
  }

  emitStderr(text: string) {
    this.stderr.emit('data', Buffer.from(text));
  }

  emitClose(code: number | null) {
    this.emit('close', code);
  }
}

interface PlannedSpawn {
  /** Substring expected to appear in JSON sent to PS stdin. Verifies the action we asked for. */
  expectActionContains?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  /** If true, the spawn never emits anything — used to test budget/timeout. */
  hang?: boolean;
}

interface SpawnHarness {
  spawn: HelperEnvironment['spawn'];
  calls: FakeChildProcess[];
  spawnArgs: Array<{ command: string; args: string[] }>;
}

function makeFakeSpawn(plan: PlannedSpawn[]): SpawnHarness {
  const calls: FakeChildProcess[] = [];
  const spawnArgs: Array<{ command: string; args: string[] }> = [];
  let idx = 0;

  const spawnFn = ((command: string, args: readonly string[]) => {
    spawnArgs.push({ command, args: [...args] });
    const proc = new FakeChildProcess();
    calls.push(proc);
    const planned = plan[idx++];
    if (!planned) {
      throw new Error(`unexpected spawn call #${idx} — no plan entry`);
    }
    if (planned.hang) {
      return proc as unknown as ReturnType<HelperEnvironment['spawn']>;
    }
    // Emit on next tick so helper has time to attach listeners
    setImmediate(() => {
      if (planned.stdout) proc.emitStdout(planned.stdout);
      if (planned.stderr) proc.emitStderr(planned.stderr);
      proc.emitClose(planned.exitCode ?? 0);
    });
    return proc as unknown as ReturnType<HelperEnvironment['spawn']>;
  }) as unknown as HelperEnvironment['spawn'];

  return { spawn: spawnFn, calls, spawnArgs };
}

const silentLogger = new Logger('Test', LogLevel.ERROR);

// ---- PS contract fixtures: locks the JSON shape expected from the inline PowerShell script.

const SNAPSHOT_EMPTY = JSON.stringify({ ok: true, processes: [] });

const SNAPSHOT_SINGLE_NO_DIALOG = JSON.stringify({
  ok: true,
  processes: [
    {
      pid: 12345,
      projectPath: 'C:\\Users\\Foo\\MyProject',
      mainWindowTitle: 'SampleScene - MyProject - Windows, Mac, Linux - Unity 2022.3.10f1',
      topLevelWindows: [
        { title: 'SampleScene - MyProject', className: 'UnityContainerWndClass' },
      ],
    },
  ],
});

const SNAPSHOT_SINGLE_WITH_DIALOG = JSON.stringify({
  ok: true,
  processes: [
    {
      pid: 12345,
      projectPath: 'C:\\Users\\Foo\\MyProject',
      mainWindowTitle: 'SampleScene - MyProject - Windows, Mac, Linux - Unity 2022.3.10f1',
      topLevelWindows: [
        { title: 'SampleScene - MyProject', className: 'UnityContainerWndClass' },
        {
          title: 'Scene(s) Have Been Modified',
          className: '#32770',
          buttons: [
            { name: 'Save', automationId: '1' },
            { name: "Don't Save", automationId: '2' },
            { name: 'Cancel', automationId: '3' },
          ],
        },
      ],
    },
  ],
});

const SNAPSHOT_SINGLE_WITH_UNKNOWN_WINDOW = JSON.stringify({
  ok: true,
  processes: [
    {
      pid: 12345,
      projectPath: 'C:\\Users\\Foo\\MyProject',
      mainWindowTitle: 'SampleScene - MyProject - Windows, Mac, Linux - Unity 2022.3.10f1',
      topLevelWindows: [
        { title: 'SampleScene - MyProject', className: 'UnityContainerWndClass' },
        { title: 'Compile Error', className: 'SomeIMGUIClass' },
      ],
    },
  ],
});

const SNAPSHOT_TWO_PROCESSES = JSON.stringify({
  ok: true,
  processes: [
    {
      pid: 12345,
      projectPath: 'C:\\Users\\Foo\\ProjectA',
      mainWindowTitle: 'A - Unity',
      topLevelWindows: [{ title: 'A', className: 'UnityContainerWndClass' }],
    },
    {
      pid: 67890,
      projectPath: 'C:\\Users\\Foo\\ProjectB',
      mainWindowTitle: 'B - Unity',
      topLevelWindows: [{ title: 'B', className: 'UnityContainerWndClass' }],
    },
  ],
});

// Unity 6 spawns AssetImportWorker subprocesses with the same -projectpath but no main window.
const SNAPSHOT_EDITOR_PLUS_WORKERS = JSON.stringify({
  ok: true,
  processes: [
    {
      pid: 12345,
      projectPath: 'C:\\Users\\Foo\\MyProject',
      mainWindowTitle: 'SampleScene - MyProject - Windows, Mac, Linux - Unity 2022.3.10f1',
      topLevelWindows: [
        { title: 'SampleScene - MyProject', className: 'UnityContainerWndClass' },
      ],
    },
    {
      pid: 67890,
      projectPath: 'C:\\Users\\Foo\\MyProject',
      mainWindowTitle: '',
      topLevelWindows: [],
    },
    {
      pid: 67891,
      projectPath: 'C:\\Users\\Foo\\MyProject',
      mainWindowTitle: '',
      topLevelWindows: [],
    },
  ],
});

const SNAPSHOT_WORKERS_ONLY = JSON.stringify({
  ok: true,
  processes: [
    {
      pid: 67890,
      projectPath: 'C:\\Users\\Foo\\MyProject',
      mainWindowTitle: '',
      topLevelWindows: [],
    },
  ],
});

const SNAPSHOT_TWO_EDITORS_PLUS_WORKERS = JSON.stringify({
  ok: true,
  processes: [
    {
      pid: 12345,
      projectPath: 'C:\\Users\\Foo\\ProjectA',
      mainWindowTitle: 'A - Unity',
      topLevelWindows: [{ title: 'A', className: 'UnityContainerWndClass' }],
    },
    {
      pid: 67890,
      projectPath: 'C:\\Users\\Foo\\ProjectB',
      mainWindowTitle: 'B - Unity',
      topLevelWindows: [{ title: 'B', className: 'UnityContainerWndClass' }],
    },
    {
      pid: 70001,
      projectPath: 'C:\\Users\\Foo\\ProjectA',
      mainWindowTitle: '',
      topLevelWindows: [],
    },
    {
      pid: 70002,
      projectPath: 'C:\\Users\\Foo\\ProjectB',
      mainWindowTitle: '',
      topLevelWindows: [],
    },
  ],
});

const SNAPSHOT_UAC_DENIED = JSON.stringify({ ok: false, kind: 'uac_mismatch' });
const SNAPSHOT_INTERNAL_ERROR = JSON.stringify({
  ok: false,
  kind: 'internal',
  message: 'CIM provider unavailable',
});

const CLICK_OK = JSON.stringify({ ok: true, outcome: 'clicked' });
const CLICK_NO_TARGET = JSON.stringify({ ok: true, outcome: 'no_target_window' });
const CLICK_BUTTON_MISSING = JSON.stringify({
  ok: true,
  outcome: 'button_not_available',
  availableButtons: [
    { name: 'Save', automationId: '1' },
    { name: "Don't Save", automationId: '2' },
  ],
});

// ---- Test environment factory: hermetic env/cwd/platform without touching globals.

function makeEnv(overrides: Partial<HelperEnvironment> = {}): Partial<HelperEnvironment> {
  return {
    env: {},
    cwd: () => 'C:\\not-a-unity-project',
    pathExists: async () => false,
    platform: 'win32',
    ...overrides,
  };
}

describe('UnityModalHelper', () => {
  describe('platform guard', () => {
    it('throws VALIDATION on non-Windows platforms without spawning anything', async () => {
      const harness = makeFakeSpawn([]);
      const helper = new UnityModalHelper(silentLogger, {
        ...makeEnv({ platform: 'darwin' }),
        spawn: harness.spawn,
      });

      await expect(helper.detect({})).rejects.toMatchObject({
        type: ErrorType.VALIDATION,
        message: expect.stringContaining('modal_helper_unsupported_platform'),
      });
      await expect(helper.dismiss({ button: 'Save' })).rejects.toMatchObject({
        type: ErrorType.VALIDATION,
      });
      expect(harness.spawnArgs).toHaveLength(0);
    });
  });

  describe('target resolution', () => {
    it('returns no_unity_process_found when snapshot lists zero processes', async () => {
      const harness = makeFakeSpawn([{ stdout: SNAPSHOT_EMPTY }]);
      const helper = new UnityModalHelper(silentLogger, { ...makeEnv(), spawn: harness.spawn });

      await expect(helper.detect({})).rejects.toMatchObject({
        type: ErrorType.VALIDATION,
        message: expect.stringContaining('no_unity_process_found'),
      });
    });

    it('uses single Unity process when no filter given', async () => {
      const harness = makeFakeSpawn([{ stdout: SNAPSHOT_SINGLE_NO_DIALOG }]);
      const helper = new UnityModalHelper(silentLogger, { ...makeEnv(), spawn: harness.spawn });

      const result = await helper.detect({});
      expect(result.found).toBe(false);
      expect(result.targetProcess.pid).toBe(12345);
    });

    it('returns multiple_unity_processes_require_explicit_target with candidates', async () => {
      const harness = makeFakeSpawn([{ stdout: SNAPSHOT_TWO_PROCESSES }]);
      const helper = new UnityModalHelper(silentLogger, { ...makeEnv(), spawn: harness.spawn });

      try {
        await helper.detect({});
        throw new Error('expected rejection');
      } catch (e: any) {
        expect(e).toBeInstanceOf(McpUnityError);
        expect(e.type).toBe(ErrorType.VALIDATION);
        expect(e.message).toContain('multiple_unity_processes_require_explicit_target');
        expect(e.details.candidates).toEqual([
          expect.objectContaining({ pid: 12345 }),
          expect.objectContaining({ pid: 67890 }),
        ]);
      }
    });

    it('honors explicit targetPid that exists in snapshot', async () => {
      const harness = makeFakeSpawn([{ stdout: SNAPSHOT_TWO_PROCESSES }]);
      const helper = new UnityModalHelper(silentLogger, { ...makeEnv(), spawn: harness.spawn });

      const result = await helper.detect({ targetPid: 67890 });
      expect(result.targetProcess.pid).toBe(67890);
    });

    it('rejects explicit targetPid not in Unity snapshot', async () => {
      const harness = makeFakeSpawn([{ stdout: SNAPSHOT_TWO_PROCESSES }]);
      const helper = new UnityModalHelper(silentLogger, { ...makeEnv(), spawn: harness.spawn });

      await expect(helper.detect({ targetPid: 999 })).rejects.toMatchObject({
        message: expect.stringContaining('target_not_unity_process'),
      });
    });

    it('filters by projectPath (case-insensitive on Windows, normalized slashes)', async () => {
      const harness = makeFakeSpawn([{ stdout: SNAPSHOT_TWO_PROCESSES }]);
      const helper = new UnityModalHelper(silentLogger, { ...makeEnv(), spawn: harness.spawn });

      const result = await helper.detect({ projectPath: 'c:/users/foo/projectb' });
      expect(result.targetProcess.pid).toBe(67890);
    });

    it('returns no_unity_process_for_project when projectPath matches nothing', async () => {
      const harness = makeFakeSpawn([{ stdout: SNAPSHOT_TWO_PROCESSES }]);
      const helper = new UnityModalHelper(silentLogger, { ...makeEnv(), spawn: harness.spawn });

      await expect(
        helper.detect({ projectPath: 'C:\\Users\\Foo\\NotOpened' })
      ).rejects.toMatchObject({
        message: expect.stringContaining('no_unity_process_for_project'),
      });
    });

    it('applies cwd-fallback when ProjectSettings/ exists in cwd', async () => {
      const harness = makeFakeSpawn([{ stdout: SNAPSHOT_TWO_PROCESSES }]);
      const helper = new UnityModalHelper(silentLogger, {
        ...makeEnv({
          cwd: () => 'C:\\Users\\Foo\\ProjectB',
          pathExists: async (p: string) => p.endsWith('ProjectSettings'),
        }),
        spawn: harness.spawn,
      });

      const result = await helper.detect({});
      expect(result.targetProcess.pid).toBe(67890);
    });

    it('honors UNITY_PID env after cwd-fallback does not apply', async () => {
      const harness = makeFakeSpawn([{ stdout: SNAPSHOT_TWO_PROCESSES }]);
      const helper = new UnityModalHelper(silentLogger, {
        ...makeEnv({ env: { UNITY_PID: '12345' } }),
        spawn: harness.spawn,
      });

      const result = await helper.detect({});
      expect(result.targetProcess.pid).toBe(12345);
    });

    it('explicit targetPid wins over UNITY_PID env', async () => {
      const harness = makeFakeSpawn([{ stdout: SNAPSHOT_TWO_PROCESSES }]);
      const helper = new UnityModalHelper(silentLogger, {
        ...makeEnv({ env: { UNITY_PID: '12345' } }),
        spawn: harness.spawn,
      });

      const result = await helper.detect({ targetPid: 67890 });
      expect(result.targetProcess.pid).toBe(67890);
    });

    it('cwd-fallback wins over UNITY_PID env when ProjectSettings/ exists', async () => {
      const harness = makeFakeSpawn([{ stdout: SNAPSHOT_TWO_PROCESSES }]);
      const helper = new UnityModalHelper(silentLogger, {
        ...makeEnv({
          env: { UNITY_PID: '12345' },
          cwd: () => 'C:\\Users\\Foo\\ProjectB',
          pathExists: async (p: string) => p.endsWith('ProjectSettings'),
        }),
        spawn: harness.spawn,
      });

      const result = await helper.detect({});
      expect(result.targetProcess.pid).toBe(67890);
    });

    it('rejects UNITY_PID that does not match any Unity process', async () => {
      const harness = makeFakeSpawn([{ stdout: SNAPSHOT_TWO_PROCESSES }]);
      const helper = new UnityModalHelper(silentLogger, {
        ...makeEnv({ env: { UNITY_PID: '999' } }),
        spawn: harness.spawn,
      });

      await expect(helper.detect({})).rejects.toMatchObject({
        message: expect.stringContaining('target_not_unity_process'),
      });
    });
  });

  describe('AssetImportWorker filtering', () => {
    it('auto-resolves to the single editor instance ignoring N headless workers', async () => {
      const harness = makeFakeSpawn([{ stdout: SNAPSHOT_EDITOR_PLUS_WORKERS }]);
      const helper = new UnityModalHelper(silentLogger, { ...makeEnv(), spawn: harness.spawn });

      const result = await helper.detect({});
      expect(result.targetProcess.pid).toBe(12345);
    });

    it('returns no_unity_process_found when only workers exist (no editor)', async () => {
      const harness = makeFakeSpawn([{ stdout: SNAPSHOT_WORKERS_ONLY }]);
      const helper = new UnityModalHelper(silentLogger, { ...makeEnv(), spawn: harness.spawn });

      await expect(helper.detect({})).rejects.toMatchObject({
        message: expect.stringContaining('no_unity_process_found'),
      });
    });

    it('projectPath filter ignores workers (workers report same -projectpath as editor)', async () => {
      const harness = makeFakeSpawn([{ stdout: SNAPSHOT_EDITOR_PLUS_WORKERS }]);
      const helper = new UnityModalHelper(silentLogger, { ...makeEnv(), spawn: harness.spawn });

      const result = await helper.detect({ projectPath: 'C:\\Users\\Foo\\MyProject' });
      expect(result.targetProcess.pid).toBe(12345);
    });

    it('cwd-fallback ignores workers when cwd matches their projectPath', async () => {
      const harness = makeFakeSpawn([{ stdout: SNAPSHOT_EDITOR_PLUS_WORKERS }]);
      const helper = new UnityModalHelper(silentLogger, {
        ...makeEnv({
          cwd: () => 'C:\\Users\\Foo\\MyProject',
          pathExists: async (p: string) => p.endsWith('ProjectSettings'),
        }),
        spawn: harness.spawn,
      });

      const result = await helper.detect({});
      expect(result.targetProcess.pid).toBe(12345);
    });

    it('ambiguity error candidates list excludes workers', async () => {
      const harness = makeFakeSpawn([{ stdout: SNAPSHOT_TWO_EDITORS_PLUS_WORKERS }]);
      const helper = new UnityModalHelper(silentLogger, { ...makeEnv(), spawn: harness.spawn });

      try {
        await helper.detect({});
        throw new Error('expected rejection');
      } catch (e: any) {
        expect(e.message).toContain('multiple_unity_processes_require_explicit_target');
        // Workers (pid 70001/70002) must NOT appear in candidates — only editor pids 12345/67890
        const candidatePids = e.details.candidates.map((c: any) => c.pid);
        expect(candidatePids).toEqual([12345, 67890]);
      }
    });

    it('explicit targetPid bypasses the editor-only filter (user owns the choice)', async () => {
      const harness = makeFakeSpawn([{ stdout: SNAPSHOT_EDITOR_PLUS_WORKERS }]);
      const helper = new UnityModalHelper(silentLogger, { ...makeEnv(), spawn: harness.spawn });

      const result = await helper.detect({ targetPid: 67890 }); // worker pid
      expect(result.targetProcess.pid).toBe(67890);
      expect(result.targetProcess.mainWindowTitle).toBe('');
    });

    it('UNITY_PID env honored even when it points to a worker (treated as explicit)', async () => {
      const harness = makeFakeSpawn([{ stdout: SNAPSHOT_EDITOR_PLUS_WORKERS }]);
      const helper = new UnityModalHelper(silentLogger, {
        ...makeEnv({ env: { UNITY_PID: '67890' } }),
        spawn: harness.spawn,
      });

      const result = await helper.detect({});
      expect(result.targetProcess.pid).toBe(67890);
    });
  });

  describe('detect outcomes', () => {
    it('returns found:false with no unsupportedDialog when only main editor is open', async () => {
      const harness = makeFakeSpawn([{ stdout: SNAPSHOT_SINGLE_NO_DIALOG }]);
      const helper = new UnityModalHelper(silentLogger, { ...makeEnv(), spawn: harness.spawn });

      const result = await helper.detect({});
      expect(result.found).toBe(false);
      expect((result as any).unsupportedDialog).toBeUndefined();
    });

    it('returns found:true with native dialog buttons mapped from #32770 window', async () => {
      const harness = makeFakeSpawn([{ stdout: SNAPSHOT_SINGLE_WITH_DIALOG }]);
      const helper = new UnityModalHelper(silentLogger, { ...makeEnv(), spawn: harness.spawn });

      const result = await helper.detect({});
      expect(result.found).toBe(true);
      if (!result.found) throw new Error();
      expect(result.dialog.windowClass).toBe('#32770');
      expect(result.dialog.title).toBe('Scene(s) Have Been Modified');
      expect(result.dialog.isNative).toBe(true);
      expect(result.dialog.availableButtons.map((b) => b.name)).toEqual([
        'Save',
        "Don't Save",
        'Cancel',
      ]);
    });

    it('returns found:false + unsupportedDialog when extra non-#32770 window is present', async () => {
      const harness = makeFakeSpawn([{ stdout: SNAPSHOT_SINGLE_WITH_UNKNOWN_WINDOW }]);
      const helper = new UnityModalHelper(silentLogger, { ...makeEnv(), spawn: harness.spawn });

      const result = await helper.detect({});
      expect(result.found).toBe(false);
      if (result.found) throw new Error();
      expect(result.unsupportedDialog).toBeDefined();
      expect(result.unsupportedDialog!.topLevelWindows).toEqual([
        { title: 'SampleScene - MyProject', className: 'UnityContainerWndClass' },
        { title: 'Compile Error', className: 'SomeIMGUIClass' },
      ]);
    });

    it('maps PS ok:false kind:uac_mismatch to permission_denied_uac_mismatch error', async () => {
      const harness = makeFakeSpawn([{ stdout: SNAPSHOT_UAC_DENIED }]);
      const helper = new UnityModalHelper(silentLogger, { ...makeEnv(), spawn: harness.spawn });

      await expect(helper.detect({})).rejects.toMatchObject({
        message: expect.stringContaining('permission_denied_uac_mismatch'),
      });
    });

    it('maps PS ok:false kind:internal to INTERNAL error preserving message', async () => {
      const harness = makeFakeSpawn([{ stdout: SNAPSHOT_INTERNAL_ERROR }]);
      const helper = new UnityModalHelper(silentLogger, { ...makeEnv(), spawn: harness.spawn });

      await expect(helper.detect({})).rejects.toMatchObject({
        type: ErrorType.INTERNAL,
        message: expect.stringContaining('CIM provider unavailable'),
      });
    });

    it('throws INTERNAL when PS exits non-zero with garbage stdout', async () => {
      const harness = makeFakeSpawn([{ stdout: 'not json at all', exitCode: 1 }]);
      const helper = new UnityModalHelper(silentLogger, { ...makeEnv(), spawn: harness.spawn });

      await expect(helper.detect({})).rejects.toMatchObject({ type: ErrorType.INTERNAL });
    });

    it('kills the process and throws TIMEOUT when PS exceeds budget', async () => {
      const harness = makeFakeSpawn([{ hang: true }]);
      const helper = new UnityModalHelper(silentLogger, { ...makeEnv(), spawn: harness.spawn });

      await expect(helper.detect({ budgetMs: 50 })).rejects.toMatchObject({
        type: ErrorType.TIMEOUT,
      });
      expect(harness.calls[0].killed).toBe(true);
    });

    it('writes the snapshot action JSON to PS stdin', async () => {
      const harness = makeFakeSpawn([{ stdout: SNAPSHOT_SINGLE_NO_DIALOG }]);
      const helper = new UnityModalHelper(silentLogger, { ...makeEnv(), spawn: harness.spawn });

      await helper.detect({});
      const stdinPayload = harness.calls[0].stdinChunks.join('');
      const parsed = JSON.parse(stdinPayload);
      expect(parsed.action).toBe('snapshot');
    });
  });

  describe('re-entry guard', () => {
    it('rejects concurrent detect() calls — only one inflight at a time', async () => {
      // First spawn hangs; second call must short-circuit before spawning.
      const harness = makeFakeSpawn([{ hang: true }]);
      const helper = new UnityModalHelper(silentLogger, { ...makeEnv(), spawn: harness.spawn });

      const first = helper.detect({ budgetMs: 100 });
      // Second call concurrent — should reject without spawning a second PS process
      await expect(helper.detect({ budgetMs: 100 })).rejects.toMatchObject({
        message: expect.stringContaining('detect_already_inflight'),
      });
      // Let first call time out so no leaked promise
      await expect(first).rejects.toMatchObject({ type: ErrorType.TIMEOUT });
      expect(harness.spawnArgs).toHaveLength(1);
    });

    it('clears inflight flag after detect resolves so subsequent calls work', async () => {
      const harness = makeFakeSpawn([
        { stdout: SNAPSHOT_SINGLE_NO_DIALOG },
        { stdout: SNAPSHOT_SINGLE_NO_DIALOG },
      ]);
      const helper = new UnityModalHelper(silentLogger, { ...makeEnv(), spawn: harness.spawn });

      await helper.detect({});
      const result = await helper.detect({});
      expect(result.found).toBe(false);
      expect(harness.spawnArgs).toHaveLength(2);
    });

    it('clears inflight flag after detect rejects', async () => {
      const harness = makeFakeSpawn([
        { stdout: SNAPSHOT_UAC_DENIED },
        { stdout: SNAPSHOT_SINGLE_NO_DIALOG },
      ]);
      const helper = new UnityModalHelper(silentLogger, { ...makeEnv(), spawn: harness.spawn });

      await expect(helper.detect({})).rejects.toBeInstanceOf(McpUnityError);
      const result = await helper.detect({});
      expect(result.found).toBe(false);
    });
  });

  describe('dismiss outcomes', () => {
    it('returns clicked when PS click action succeeds', async () => {
      const harness = makeFakeSpawn([
        { stdout: SNAPSHOT_SINGLE_WITH_DIALOG },
        { expectActionContains: 'click', stdout: CLICK_OK },
      ]);
      const helper = new UnityModalHelper(silentLogger, { ...makeEnv(), spawn: harness.spawn });

      const result = await helper.dismiss({ button: "Don't Save" });
      expect(result.outcome).toBe('clicked');
      expect(result.selectedAction).toBe("Don't Save");
      expect(result.dialog?.title).toBe('Scene(s) Have Been Modified');
      expect(harness.spawnArgs).toHaveLength(2);
    });

    it('forwards target pid and exact button name to PS click action', async () => {
      const harness = makeFakeSpawn([
        { stdout: SNAPSHOT_SINGLE_WITH_DIALOG },
        { stdout: CLICK_OK },
      ]);
      const helper = new UnityModalHelper(silentLogger, { ...makeEnv(), spawn: harness.spawn });

      await helper.dismiss({ button: "Don't Save" });

      const clickStdin = JSON.parse(harness.calls[1].stdinChunks.join(''));
      expect(clickStdin.action).toBe('click');
      expect(clickStdin.targetPid).toBe(12345);
      expect(clickStdin.button).toBe("Don't Save");
    });

    it('returns dialog_already_dismissed when only main editor is open (no #32770)', async () => {
      const harness = makeFakeSpawn([{ stdout: SNAPSHOT_SINGLE_NO_DIALOG }]);
      const helper = new UnityModalHelper(silentLogger, { ...makeEnv(), spawn: harness.spawn });

      const result = await helper.dismiss({ button: "Don't Save" });
      expect(result.outcome).toBe('dialog_already_dismissed');
      // Only snapshot was called, no click attempt
      expect(harness.spawnArgs).toHaveLength(1);
    });

    it('throws unsupported_dialog_kind when extra non-#32770 window is present', async () => {
      const harness = makeFakeSpawn([{ stdout: SNAPSHOT_SINGLE_WITH_UNKNOWN_WINDOW }]);
      const helper = new UnityModalHelper(silentLogger, { ...makeEnv(), spawn: harness.spawn });

      await expect(helper.dismiss({ button: 'Save' })).rejects.toMatchObject({
        message: expect.stringContaining('unsupported_dialog_kind'),
      });
      expect(harness.spawnArgs).toHaveLength(1);
    });

    it('returns button_not_available with PS-provided availableButtons', async () => {
      const harness = makeFakeSpawn([
        { stdout: SNAPSHOT_SINGLE_WITH_DIALOG },
        { stdout: CLICK_BUTTON_MISSING },
      ]);
      const helper = new UnityModalHelper(silentLogger, { ...makeEnv(), spawn: harness.spawn });

      const result = await helper.dismiss({ button: 'Apply' });
      expect(result.outcome).toBe('button_not_available');
      expect(result.availableButtons).toEqual([
        { name: 'Save', automationId: '1' },
        { name: "Don't Save", automationId: '2' },
      ]);
    });

    it('maps click outcome no_target_window to dialog_already_dismissed (race after snapshot)', async () => {
      // Snapshot saw dialog, but by the time click ran the user had dismissed it manually.
      const harness = makeFakeSpawn([
        { stdout: SNAPSHOT_SINGLE_WITH_DIALOG },
        { stdout: CLICK_NO_TARGET },
      ]);
      const helper = new UnityModalHelper(silentLogger, { ...makeEnv(), spawn: harness.spawn });

      const result = await helper.dismiss({ button: "Don't Save" });
      expect(result.outcome).toBe('dialog_already_dismissed');
    });

    it('does not include unityResponsiveAfter — that is a tool-level concern', async () => {
      const harness = makeFakeSpawn([
        { stdout: SNAPSHOT_SINGLE_WITH_DIALOG },
        { stdout: CLICK_OK },
      ]);
      const helper = new UnityModalHelper(silentLogger, { ...makeEnv(), spawn: harness.spawn });

      const result = await helper.dismiss({ button: "Don't Save" });
      expect((result as any).unityResponsiveAfter).toBeUndefined();
    });

    it('respects UAC mismatch from snapshot phase', async () => {
      const harness = makeFakeSpawn([{ stdout: SNAPSHOT_UAC_DENIED }]);
      const helper = new UnityModalHelper(silentLogger, { ...makeEnv(), spawn: harness.spawn });

      await expect(helper.dismiss({ button: 'Save' })).rejects.toMatchObject({
        message: expect.stringContaining('permission_denied_uac_mismatch'),
      });
    });

    it('respects UAC mismatch surfaced by click phase', async () => {
      const harness = makeFakeSpawn([
        { stdout: SNAPSHOT_SINGLE_WITH_DIALOG },
        { stdout: SNAPSHOT_UAC_DENIED },
      ]);
      const helper = new UnityModalHelper(silentLogger, { ...makeEnv(), spawn: harness.spawn });

      await expect(helper.dismiss({ button: 'Save' })).rejects.toMatchObject({
        message: expect.stringContaining('permission_denied_uac_mismatch'),
      });
    });
  });

  describe('PS spawn arguments', () => {
    it('uses powershell.exe with -NoProfile -NonInteractive -ExecutionPolicy Bypass', async () => {
      const harness = makeFakeSpawn([{ stdout: SNAPSHOT_SINGLE_NO_DIALOG }]);
      const helper = new UnityModalHelper(silentLogger, { ...makeEnv(), spawn: harness.spawn });

      await helper.detect({});
      const { command, args } = harness.spawnArgs[0];
      expect(command).toBe('powershell.exe');
      expect(args).toEqual(expect.arrayContaining(['-NoProfile', '-NonInteractive']));
      expect(args).toEqual(expect.arrayContaining(['-ExecutionPolicy', 'Bypass']));
    });
  });
});
