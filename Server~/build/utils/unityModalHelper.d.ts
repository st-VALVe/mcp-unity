import { spawn as nodeSpawn, ChildProcess, SpawnOptions } from 'child_process';
import { Logger } from './logger.js';
export interface UnityProcessInfo {
    pid: number;
    projectPath: string | null;
    mainWindowTitle: string;
    topLevelWindows: Array<{
        title: string;
        className: string;
        /** Present on #32770 windows only — buttons enumerated via UIAutomation. */
        buttons?: Array<{
            name: string;
            automationId: string | null;
        }>;
    }>;
}
export interface ModalDialog {
    title: string;
    windowClass: string;
    isNative: true;
    availableButtons: Array<{
        name: string;
        automationId: string | null;
    }>;
}
export interface DetectFoundResult {
    found: true;
    targetProcess: {
        pid: number;
        mainWindowTitle: string;
        projectPath: string | null;
    };
    dialog: ModalDialog;
}
export interface DetectNotFoundResult {
    found: false;
    targetProcess: {
        pid: number;
        mainWindowTitle: string;
        projectPath: string | null;
    };
    unsupportedDialog?: {
        topLevelWindows: Array<{
            title: string;
            className: string;
        }>;
    };
}
export type DetectResult = DetectFoundResult | DetectNotFoundResult;
export type DismissOutcome = 'clicked' | 'dialog_already_dismissed' | 'button_not_available';
export interface DismissResult {
    outcome: DismissOutcome;
    selectedAction?: string;
    targetProcess: {
        pid: number;
        mainWindowTitle: string;
        projectPath: string | null;
    };
    dialog?: ModalDialog;
    availableButtons?: Array<{
        name: string;
        automationId: string | null;
    }>;
}
export interface ResolutionInput {
    targetPid?: number;
    projectPath?: string;
}
export interface DetectOptions extends ResolutionInput {
    budgetMs?: number;
}
export interface DismissOptions extends ResolutionInput {
    button: string;
    budgetMs?: number;
}
export interface HelperEnvironment {
    spawn: typeof nodeSpawn;
    env: NodeJS.ProcessEnv;
    cwd: () => string;
    pathExists: (p: string) => Promise<boolean>;
    platform: NodeJS.Platform;
}
declare const DEFAULT_DETECT_BUDGET_MS = 2000;
declare const DEFAULT_DISMISS_BUDGET_MS = 5000;
export declare class UnityModalHelper {
    private readonly logger;
    private readonly envCtx;
    private inflight;
    constructor(logger: Logger, envCtx?: Partial<HelperEnvironment>);
    get isDetectInflight(): boolean;
    detect(options?: DetectOptions): Promise<DetectResult>;
    dismiss(options: DismissOptions): Promise<DismissResult>;
    private assertWindows;
    private withInflightGuard;
    private runSnapshot;
    private runClick;
    private mapPsError;
    private spawnPs;
    private resolveTarget;
    private matchByProjectPath;
    private candidateInfo;
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
export declare function attachModalDiagnosticsOnTimeout(helper: UnityModalHelper | null | undefined, enabled: boolean, budgetMs: number, error: {
    details?: any;
}): Promise<void>;
export type { ChildProcess, SpawnOptions };
export { DEFAULT_DETECT_BUDGET_MS, DEFAULT_DISMISS_BUDGET_MS };
