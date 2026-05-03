import { spawn as nodeSpawn } from 'child_process';
import path from 'path';
import { promises as fs } from 'fs';
import { McpUnityError, ErrorType } from './errors.js';
const DEFAULT_DETECT_BUDGET_MS = 2000;
const DEFAULT_DISMISS_BUDGET_MS = 5000;
const NATIVE_DIALOG_CLASS = '#32770';
const UNITY_MAIN_WINDOW_CLASS = 'UnityContainerWndClass';
const realPathExists = async (p) => {
    try {
        await fs.access(p);
        return true;
    }
    catch {
        return false;
    }
};
const defaultEnvironment = () => ({
    spawn: nodeSpawn,
    env: process.env,
    cwd: () => process.cwd(),
    pathExists: realPathExists,
    platform: process.platform,
});
/**
 * Inline PowerShell helper. Reads JSON request from stdin, writes JSON response to stdout.
 *
 * Actions:
 *   snapshot                          — enumerate Unity.exe processes + top-level windows + #32770 buttons
 *   click  { targetPid, button }      — click named button in target's #32770 dialog (case-sensitive)
 *
 * NOTE: do NOT introduce ${...} interpolation here — PS uses $var (no braces), which is fine
 * inside a JS template literal, but ${...} would collide with JS template substitution.
 */
const POWERSHELL_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'

$req = [Console]::In.ReadToEnd() | ConvertFrom-Json

if (-not ('Win32.NativeWin' -as [type])) {
  Add-Type -Namespace Win32 -Name NativeWin -MemberDefinition @"
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, System.IntPtr lParam);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern int GetWindowThreadProcessId(System.IntPtr hWnd, out uint processId);
[System.Runtime.InteropServices.DllImport("user32.dll", CharSet=System.Runtime.InteropServices.CharSet.Unicode)]
public static extern int GetClassName(System.IntPtr hWnd, System.Text.StringBuilder lpClassName, int nMaxCount);
[System.Runtime.InteropServices.DllImport("user32.dll", CharSet=System.Runtime.InteropServices.CharSet.Unicode)]
public static extern int GetWindowText(System.IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool IsWindowVisible(System.IntPtr hWnd);
public delegate bool EnumWindowsProc(System.IntPtr hWnd, System.IntPtr lParam);
"@
}

[void][System.Reflection.Assembly]::LoadWithPartialName("UIAutomationClient")
[void][System.Reflection.Assembly]::LoadWithPartialName("UIAutomationTypes")

function Get-TopLevelWindowsForPid {
  param([int]$TargetPid)
  $script:tlw_acc = @()
  $script:tlw_pid = $TargetPid
  $cb = [Win32.NativeWin+EnumWindowsProc]{
    param($hWnd, $lParam)
    if (-not [Win32.NativeWin]::IsWindowVisible($hWnd)) { return $true }
    $pidOut = 0
    [void][Win32.NativeWin]::GetWindowThreadProcessId($hWnd, [ref]$pidOut)
    if ($pidOut -ne $script:tlw_pid) { return $true }
    $sbClass = New-Object System.Text.StringBuilder 256
    [void][Win32.NativeWin]::GetClassName($hWnd, $sbClass, 256)
    $sbTitle = New-Object System.Text.StringBuilder 512
    [void][Win32.NativeWin]::GetWindowText($hWnd, $sbTitle, 512)
    $script:tlw_acc += @{ hWnd = [int64]$hWnd; className = $sbClass.ToString(); title = $sbTitle.ToString() }
    return $true
  }
  [void][Win32.NativeWin]::EnumWindows($cb, [IntPtr]::Zero)
  return $script:tlw_acc
}

function Get-ButtonsForNativeDialog {
  param([int64]$HwndInt)
  $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$HwndInt)
  if (-not $root) { return @() }
  $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
  $buttons = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
  $result = @()
  foreach ($b in $buttons) {
    $aid = $b.Current.AutomationId
    if ([string]::IsNullOrEmpty($aid)) { $aid = $null }
    $result += @{ name = $b.Current.Name; automationId = $aid }
  }
  return ,$result
}

function Click-ButtonByName {
  param([int64]$HwndInt, [string]$ButtonName)
  $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$HwndInt)
  if (-not $root) { return @{ found = $false; available = @() } }
  $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
  $buttons = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
  $available = @()
  foreach ($b in $buttons) {
    $aid = $b.Current.AutomationId
    if ([string]::IsNullOrEmpty($aid)) { $aid = $null }
    $available += @{ name = $b.Current.Name; automationId = $aid }
    if ($b.Current.Name -ceq $ButtonName) {
      $invokePattern = $null
      try { $invokePattern = $b.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern) } catch { }
      if ($invokePattern) {
        $invokePattern.Invoke()
        return @{ found = $true; available = $available }
      }
    }
  }
  return @{ found = $false; available = $available }
}

try {
  if ($req.action -eq 'snapshot') {
    $unityProcs = @(Get-CimInstance Win32_Process -Filter "Name='Unity.exe'" -ErrorAction Stop)
    $output = @()
    foreach ($p in $unityProcs) {
      $cmdline = $p.CommandLine
      $projectPath = $null
      if ($cmdline) {
        if ($cmdline -match '-projectpath\\s+"([^"]+)"') {
          $projectPath = $matches[1]
        } elseif ($cmdline -match '-projectpath\\s+(\\S+)') {
          $projectPath = $matches[1]
        }
      }
      $procObj = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue
      $mainTitle = ''
      if ($procObj) { $mainTitle = $procObj.MainWindowTitle }
      $windows = Get-TopLevelWindowsForPid -TargetPid $p.ProcessId
      $enriched = @()
      foreach ($w in $windows) {
        $entry = @{ title = $w.title; className = $w.className }
        if ($w.className -eq '#32770') {
          $entry.buttons = Get-ButtonsForNativeDialog -HwndInt $w.hWnd
        }
        $enriched += $entry
      }
      $output += @{
        pid = [int]$p.ProcessId
        projectPath = $projectPath
        mainWindowTitle = $mainTitle
        topLevelWindows = $enriched
      }
    }
    @{ ok = $true; processes = $output } | ConvertTo-Json -Depth 8 -Compress
  }
  elseif ($req.action -eq 'click') {
    $targetPid = [int]$req.targetPid
    $button = [string]$req.button
    $windows = Get-TopLevelWindowsForPid -TargetPid $targetPid
    $native = @($windows | Where-Object { $_.className -eq '#32770' })
    if ($native.Count -eq 0) {
      @{ ok = $true; outcome = 'no_target_window' } | ConvertTo-Json -Compress
    } else {
      $first = $native[0]
      $clickResult = Click-ButtonByName -HwndInt $first.hWnd -ButtonName $button
      if ($clickResult.found) {
        @{ ok = $true; outcome = 'clicked' } | ConvertTo-Json -Compress
      } else {
        @{ ok = $true; outcome = 'button_not_available'; availableButtons = $clickResult.available } | ConvertTo-Json -Depth 4 -Compress
      }
    }
  }
  else {
    @{ ok = $false; kind = 'internal'; message = "unknown action: $($req.action)" } | ConvertTo-Json -Compress
  }
}
catch [System.UnauthorizedAccessException] {
  @{ ok = $false; kind = 'uac_mismatch' } | ConvertTo-Json -Compress
}
catch [System.ComponentModel.Win32Exception] {
  if ($_.Exception.NativeErrorCode -eq 5) {
    @{ ok = $false; kind = 'uac_mismatch' } | ConvertTo-Json -Compress
  } else {
    @{ ok = $false; kind = 'internal'; message = $_.Exception.Message } | ConvertTo-Json -Compress
  }
}
catch {
  @{ ok = $false; kind = 'internal'; message = $_.Exception.Message } | ConvertTo-Json -Compress
}
`;
const POWERSHELL_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', POWERSHELL_SCRIPT];
function normalizePathForCompare(p) {
    return p.toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '');
}
/**
 * Unity 6 spawns AssetImportWorker / batchmode subprocesses that share Name='Unity.exe'
 * and a matching -projectpath, but they are headless — no MainWindow. Auto-resolution
 * heuristics (single-Unity, projectPath, cwd-fallback) must skip them, otherwise a single
 * open Editor + N workers gets misreported as ambiguous. Explicit targetPid / UNITY_PID
 * still honor any process — user knows what they're targeting.
 */
function isLikelyEditorInstance(p) {
    return (p.mainWindowTitle ?? '').trim() !== '';
}
export class UnityModalHelper {
    logger;
    envCtx;
    inflight = false;
    constructor(logger, envCtx) {
        this.logger = logger;
        this.envCtx = { ...defaultEnvironment(), ...envCtx };
    }
    get isDetectInflight() {
        return this.inflight;
    }
    async detect(options = {}) {
        this.assertWindows();
        return this.withInflightGuard(async () => {
            const snapshot = await this.runSnapshot(options.budgetMs ?? DEFAULT_DETECT_BUDGET_MS);
            const target = await this.resolveTarget(snapshot.processes, options);
            const targetProcess = {
                pid: target.pid,
                mainWindowTitle: target.mainWindowTitle,
                projectPath: target.projectPath,
            };
            const native = target.topLevelWindows.find((w) => w.className === NATIVE_DIALOG_CLASS);
            if (native) {
                return {
                    found: true,
                    targetProcess,
                    dialog: {
                        title: native.title,
                        windowClass: NATIVE_DIALOG_CLASS,
                        isNative: true,
                        availableButtons: native.buttons ?? [],
                    },
                };
            }
            const extras = target.topLevelWindows.filter((w) => w.className !== UNITY_MAIN_WINDOW_CLASS && w.className !== NATIVE_DIALOG_CLASS);
            if (extras.length > 0) {
                return {
                    found: false,
                    targetProcess,
                    unsupportedDialog: {
                        topLevelWindows: target.topLevelWindows.map((w) => ({
                            title: w.title,
                            className: w.className,
                        })),
                    },
                };
            }
            return { found: false, targetProcess };
        });
    }
    async dismiss(options) {
        this.assertWindows();
        return this.withInflightGuard(async () => {
            const snapshot = await this.runSnapshot(options.budgetMs ?? DEFAULT_DISMISS_BUDGET_MS);
            const target = await this.resolveTarget(snapshot.processes, options);
            const targetProcess = {
                pid: target.pid,
                mainWindowTitle: target.mainWindowTitle,
                projectPath: target.projectPath,
            };
            const native = target.topLevelWindows.find((w) => w.className === NATIVE_DIALOG_CLASS);
            if (!native) {
                const extras = target.topLevelWindows.filter((w) => w.className !== UNITY_MAIN_WINDOW_CLASS && w.className !== NATIVE_DIALOG_CLASS);
                if (extras.length > 0) {
                    throw new McpUnityError(ErrorType.VALIDATION, 'unsupported_dialog_kind', {
                        topLevelWindows: target.topLevelWindows.map((w) => ({
                            title: w.title,
                            className: w.className,
                        })),
                    });
                }
                return { outcome: 'dialog_already_dismissed', targetProcess };
            }
            const dialog = {
                title: native.title,
                windowClass: NATIVE_DIALOG_CLASS,
                isNative: true,
                availableButtons: native.buttons ?? [],
            };
            const click = await this.runClick(target.pid, options.button, options.budgetMs ?? DEFAULT_DISMISS_BUDGET_MS);
            switch (click.outcome) {
                case 'clicked':
                    return { outcome: 'clicked', selectedAction: options.button, targetProcess, dialog };
                case 'no_target_window':
                    return { outcome: 'dialog_already_dismissed', targetProcess, dialog };
                case 'button_not_available':
                    return {
                        outcome: 'button_not_available',
                        targetProcess,
                        dialog,
                        availableButtons: click.availableButtons ?? [],
                    };
            }
        });
    }
    assertWindows() {
        if (this.envCtx.platform !== 'win32') {
            throw new McpUnityError(ErrorType.VALIDATION, 'modal_helper_unsupported_platform', {
                platform: this.envCtx.platform,
            });
        }
    }
    async withInflightGuard(fn) {
        if (this.inflight) {
            throw new McpUnityError(ErrorType.VALIDATION, 'detect_already_inflight');
        }
        this.inflight = true;
        try {
            return await fn();
        }
        finally {
            this.inflight = false;
        }
    }
    async runSnapshot(budgetMs) {
        const raw = await this.spawnPs({ action: 'snapshot' }, budgetMs, 'snapshot');
        if (!raw.ok) {
            throw this.mapPsError(raw);
        }
        return raw;
    }
    async runClick(targetPid, button, budgetMs) {
        const raw = await this.spawnPs({ action: 'click', targetPid, button }, budgetMs, 'click');
        if (!raw.ok) {
            throw this.mapPsError(raw);
        }
        return raw;
    }
    mapPsError(err) {
        if (err.kind === 'uac_mismatch') {
            return new McpUnityError(ErrorType.VALIDATION, 'permission_denied_uac_mismatch');
        }
        return new McpUnityError(ErrorType.INTERNAL, err.message ? `modal_helper_internal: ${err.message}` : 'modal_helper_internal');
    }
    spawnPs(payload, budgetMs, action) {
        return new Promise((resolve, reject) => {
            let proc;
            try {
                proc = this.envCtx.spawn('powershell.exe', POWERSHELL_ARGS, {
                    windowsHide: true,
                    stdio: ['pipe', 'pipe', 'pipe'],
                });
            }
            catch (e) {
                reject(new McpUnityError(ErrorType.INTERNAL, `modal_helper_spawn_failed: ${e.message}`));
                return;
            }
            let settled = false;
            let stdout = '';
            let stderr = '';
            const settle = (err, value) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(budgetTimer);
                if (err)
                    reject(err);
                else
                    resolve(value);
            };
            const budgetTimer = setTimeout(() => {
                if (settled)
                    return;
                // Settle FIRST so a synchronous 'close' from kill() cannot race past us.
                settle(new McpUnityError(ErrorType.TIMEOUT, `modal_helper_timeout_${action} budget=${budgetMs}ms`));
                try {
                    proc.kill('SIGTERM');
                }
                catch {
                    /* best-effort cleanup */
                }
            }, budgetMs);
            proc.stdout?.on('data', (chunk) => {
                stdout += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
            });
            proc.stderr?.on('data', (chunk) => {
                stderr += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
            });
            proc.on('error', (err) => {
                settle(new McpUnityError(ErrorType.INTERNAL, `modal_helper_spawn_error: ${err.message}`));
            });
            proc.on('close', () => {
                if (settled)
                    return;
                if (stderr.trim()) {
                    this.logger.debug(`modal_helper stderr (${action}): ${stderr.trim()}`);
                }
                const trimmed = stdout.trim();
                if (!trimmed) {
                    settle(new McpUnityError(ErrorType.INTERNAL, `modal_helper_empty_stdout_${action}`));
                    return;
                }
                try {
                    const parsed = JSON.parse(trimmed);
                    settle(undefined, parsed);
                }
                catch (e) {
                    settle(new McpUnityError(ErrorType.INTERNAL, `modal_helper_parse_failed_${action}: ${e.message}`, { stdout: trimmed.slice(0, 500) }));
                }
            });
            try {
                proc.stdin?.write(JSON.stringify(payload));
                proc.stdin?.end();
            }
            catch (e) {
                settle(new McpUnityError(ErrorType.INTERNAL, `modal_helper_stdin_failed: ${e.message}`));
            }
        });
    }
    async resolveTarget(processes, options) {
        if (processes.length === 0) {
            throw new McpUnityError(ErrorType.VALIDATION, 'no_unity_process_found');
        }
        // Explicit pid bypasses the editor-only filter — user owns the choice.
        if (typeof options.targetPid === 'number') {
            const match = processes.find((p) => p.pid === options.targetPid);
            if (!match) {
                throw new McpUnityError(ErrorType.VALIDATION, 'target_not_unity_process', {
                    requestedPid: options.targetPid,
                    candidates: processes.map((p) => this.candidateInfo(p)),
                });
            }
            return match;
        }
        const editors = processes.filter(isLikelyEditorInstance);
        if (editors.length === 0) {
            // Workers exist but no editor — equivalent to "no Unity Editor open".
            throw new McpUnityError(ErrorType.VALIDATION, 'no_unity_process_found');
        }
        if (options.projectPath) {
            return this.matchByProjectPath(editors, options.projectPath, false);
        }
        const cwdPath = this.envCtx.cwd();
        const projectSettingsDir = path.join(cwdPath, 'ProjectSettings');
        const isUnityProjectCwd = await this.envCtx.pathExists(projectSettingsDir);
        if (isUnityProjectCwd) {
            return this.matchByProjectPath(editors, cwdPath, true);
        }
        // UNITY_PID env hint — honor against ANY process (user-set, treat as explicit).
        const unityPidEnv = this.envCtx.env.UNITY_PID;
        if (unityPidEnv) {
            const parsed = parseInt(unityPidEnv, 10);
            if (Number.isFinite(parsed)) {
                const match = processes.find((p) => p.pid === parsed);
                if (!match) {
                    throw new McpUnityError(ErrorType.VALIDATION, 'target_not_unity_process', {
                        requestedPid: parsed,
                        source: 'UNITY_PID env',
                        candidates: processes.map((p) => this.candidateInfo(p)),
                    });
                }
                return match;
            }
        }
        if (editors.length === 1) {
            return editors[0];
        }
        throw new McpUnityError(ErrorType.VALIDATION, 'multiple_unity_processes_require_explicit_target', { candidates: editors.map((p) => this.candidateInfo(p)) });
    }
    matchByProjectPath(processes, projectPath, fromCwd) {
        const norm = normalizePathForCompare(projectPath);
        const matches = processes.filter((p) => p.projectPath && normalizePathForCompare(p.projectPath) === norm);
        if (matches.length === 0) {
            throw new McpUnityError(ErrorType.VALIDATION, fromCwd ? 'no_unity_process_for_cwd' : 'no_unity_process_for_project', {
                projectPath,
                candidates: processes.map((p) => this.candidateInfo(p)),
            });
        }
        if (matches.length > 1) {
            throw new McpUnityError(ErrorType.VALIDATION, 'multiple_unity_processes_require_explicit_target', { candidates: matches.map((p) => this.candidateInfo(p)) });
        }
        return matches[0];
    }
    candidateInfo(p) {
        return { pid: p.pid, projectPath: p.projectPath, mainWindowTitle: p.mainWindowTitle };
    }
}
/**
 * Attach modalDiagnostics to a timeout error, opt-in and failure-tolerant.
 *
 * Contract (AC of SER-339):
 *  - Skipped entirely when not enabled or helper missing.
 *  - Hard wall-clock budget — never blocks past `budgetMs`, regardless of helper internals.
 *  - Detection failure (rejection, parse error, re-entry, etc.) MUST NOT mask the original timeout.
 *  - On success: error.details.modalDiagnostics gets the DetectResult.
 */
export async function attachModalDiagnosticsOnTimeout(helper, enabled, budgetMs, error) {
    if (!enabled || !helper)
        return;
    try {
        const winner = await Promise.race([
            helper.detect({ budgetMs }).catch(() => null),
            new Promise((res) => setTimeout(() => res(null), budgetMs)),
        ]);
        if (winner) {
            error.details = { ...(error.details ?? {}), modalDiagnostics: winner };
        }
    }
    catch {
        /* never let detection mask the original timeout */
    }
}
export { DEFAULT_DETECT_BUDGET_MS, DEFAULT_DISMISS_BUDGET_MS };
