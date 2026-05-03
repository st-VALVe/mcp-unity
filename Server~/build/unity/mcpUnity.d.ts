import { Logger } from '../utils/logger.js';
import { ConnectionState, ConnectionStateChange } from './unityConnection.js';
import { CommandQueueConfig, CommandQueueStats } from './commandQueue.js';
import { UnityModalHelper } from '../utils/unityModalHelper.js';
interface UnityRequest {
    id?: string;
    method: string;
    params: any;
}
/**
 * Connection state change callback type
 */
export type ConnectionStateCallback = (change: ConnectionStateChange) => void;
export { ConnectionState, type ConnectionStateChange } from './unityConnection.js';
export { type CommandQueueConfig, type CommandQueueStats } from './commandQueue.js';
/**
 * Options for sending a request
 */
export interface SendRequestOptions {
    /** If true, queue the command when disconnected instead of failing immediately (default: uses queueingEnabled setting) */
    queueIfDisconnected?: boolean;
    /** Custom timeout for this request in milliseconds */
    timeout?: number;
    /** If true, do not run opt-in modal diagnostics when this request times out */
    skipModalDiagnosticsOnTimeout?: boolean;
}
/**
 * Configuration for McpUnity
 */
export interface McpUnityConfig {
    /** Command queue configuration */
    queue?: CommandQueueConfig;
    /** Whether command queuing is enabled by default (default: true) */
    queueingEnabled?: boolean;
    /**
     * Optional out-of-process modal helper. When provided AND timeout-path detection is enabled
     * (env MCP_UNITY_DETECT_MODALS_ON_TIMEOUT=true), request timeouts will attach
     * `details.modalDiagnostics` to the error in a fast, failure-tolerant way.
     */
    modalHelper?: UnityModalHelper;
}
export declare class McpUnity {
    private logger;
    private port;
    private host;
    private requestTimeout;
    private connection;
    private pendingRequests;
    private clientName;
    private stateListeners;
    private commandQueue;
    private queueingEnabled;
    private isReplayingQueue;
    private modalHelper;
    private detectModalsOnTimeout;
    constructor(logger: Logger, config?: McpUnityConfig);
    /**
     * Enable or disable command queuing
     */
    setQueueingEnabled(enabled: boolean): void;
    /**
     * Check if command queuing is enabled
     */
    get isQueueingEnabled(): boolean;
    /**
     * Get command queue statistics
     */
    getQueueStats(): CommandQueueStats;
    /**
     * Get number of commands currently queued
     */
    get queuedCommandCount(): number;
    /**
     * Start the Unity connection
     * @param clientName Optional name of the MCP client connecting to Unity
     */
    start(clientName?: string): Promise<void>;
    /**
     * Reads our configuration file and sets parameters of the server based on them.
     */
    private parseAndSetConfig;
    /**
     * Handle connection state changes
     */
    private handleStateChange;
    /**
     * Replay queued commands after connection is restored
     */
    private replayQueuedCommands;
    /**
     * Handle messages received from Unity
     */
    private handleMessage;
    /**
     * Reject all pending requests with an error
     */
    private rejectAllPendingRequests;
    /**
     * Stop the Unity connection and clean up resources
     */
    stop(): Promise<void>;
    /**
     * Send a request to the Unity server
     * @param request The request to send
     * @param options Optional settings for the request
     */
    sendRequest(request: UnityRequest, options?: SendRequestOptions): Promise<any>;
    /**
     * Internal method to send a request directly to Unity
     * Bypasses queuing logic - assumes connection is already established
     */
    private sendRequestInternal;
    /**
     * Check if connected to Unity
     * Only returns true if the connection is guaranteed to be active
     */
    get isConnected(): boolean;
    /**
     * Get current connection state
     */
    get connectionState(): ConnectionState;
    /**
     * Check if currently connecting or reconnecting
     */
    get isConnecting(): boolean;
    /**
     * Add a listener for connection state changes
     * @param callback Function to call when connection state changes
     * @returns Function to remove the listener
     */
    onConnectionStateChange(callback: ConnectionStateCallback): () => void;
    /**
     * Force a reconnection to Unity
     * Useful when Unity has reloaded and the connection may be stale
     */
    forceReconnect(): void;
    /**
     * Get connection statistics
     */
    getConnectionStats(): {
        state: ConnectionState;
        pendingRequests: number;
        reconnectAttempt?: number;
        timeSinceLastPong?: number;
    };
    /**
     * Read the McpUnitySettings.json file and return its contents as a JSON object.
     * @returns a JSON object with the contents of the McpUnitySettings.json file.
     */
    private readConfigFileAsJson;
}
