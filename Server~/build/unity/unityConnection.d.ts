import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { Logger } from '../utils/logger.js';
/**
 * Connection states for the Unity WebSocket connection
 */
export declare enum ConnectionState {
    Disconnected = "disconnected",
    Connecting = "connecting",
    Connected = "connected",
    Reconnecting = "reconnecting"
}
/**
 * Custom WebSocket close codes for Unity-specific events
 * Range 4000-4999 is reserved for application use
 */
export declare const UnityCloseCode: {
    /** Unity is entering Play mode - use fast polling instead of backoff */
    readonly PLAY_MODE: 4001;
};
/**
 * Connection state change event data
 */
export interface ConnectionStateChange {
    previousState: ConnectionState;
    currentState: ConnectionState;
    reason?: string;
    attemptNumber?: number;
}
/**
 * Configuration for the Unity connection
 */
export interface UnityConnectionConfig {
    host: string;
    port: number;
    requestTimeout: number;
    connectTimeout?: number;
    clientName?: string;
    minReconnectDelay?: number;
    maxReconnectDelay?: number;
    reconnectBackoffMultiplier?: number;
    maxReconnectAttempts?: number;
    heartbeatInterval?: number;
    heartbeatTimeout?: number;
    playModePollingInterval?: number;
}
/**
 * UnityConnection manages the WebSocket connection to Unity Editor
 * with automatic reconnection, exponential backoff, and heartbeat monitoring.
 *
 * Events:
 * - 'stateChange': Emitted when connection state changes
 * - 'message': Emitted when a message is received from Unity
 * - 'error': Emitted when an error occurs
 */
export declare class UnityConnection extends EventEmitter {
    private logger;
    private config;
    private ws;
    private state;
    private reconnectAttempt;
    private reconnectTimer;
    private connectionTimeoutTimer;
    private isManualDisconnect;
    private isPlayModeReconnect;
    private heartbeatTimer;
    private heartbeatTimeoutTimer;
    private lastPongTime;
    private awaitingPong;
    constructor(logger: Logger, config: UnityConnectionConfig);
    /**
     * Get the current connection state
     */
    get connectionState(): ConnectionState;
    /**
     * Check if currently connected
     */
    get isConnected(): boolean;
    /**
     * Check if currently connecting or reconnecting
     */
    get isConnecting(): boolean;
    /**
     * Get time since last successful heartbeat response (pong)
     */
    get timeSinceLastPong(): number;
    /**
     * Update configuration dynamically
     */
    updateConfig(config: Partial<UnityConnectionConfig>): void;
    /**
     * Connect to Unity WebSocket server
     */
    connect(): Promise<void>;
    /**
     * Disconnect from Unity WebSocket server
     */
    disconnect(reason?: string): void;
    /**
     * Send a message to Unity
     */
    send(message: string): void;
    /**
     * Get WebSocket instance (for advanced use)
     */
    get webSocket(): WebSocket | null;
    /**
     * Internal: Perform the actual connection
     */
    private doConnect;
    /**
     * Handle connection failure and schedule reconnection
     */
    private handleConnectionFailure;
    /**
     * Calculate exponential backoff delay
     */
    private calculateBackoffDelay;
    /**
     * Stop reconnection timer
     */
    private stopReconnectTimer;
    /**
     * Start heartbeat monitoring
     */
    private startHeartbeat;
    /**
     * Stop heartbeat monitoring
     */
    private stopHeartbeat;
    /**
     * Send heartbeat ping
     */
    private sendHeartbeat;
    /**
     * Handle pong response
     */
    private handlePong;
    /**
     * Handle stale connection detected by heartbeat
     */
    private handleStaleConnection;
    /**
     * Close WebSocket immediately
     *
     * Always uses terminate() instead of close() to prevent file descriptor
     * accumulation. A graceful close (ws.close()) leaves the socket alive
     * during the TCP close handshake, which can overlap with the next
     * connection attempt and accumulate file descriptors on the Unity side.
     * websocket-sharp uses Mono's IOSelector/select(), which crashes when
     * file descriptor values exceed ~1024 (POSIX FD_SETSIZE limit).
     * See: https://github.com/CoderGamester/mcp-unity/issues/110
     */
    private closeWebSocket;
    private clearConnectionTimeout;
    /**
     * Set connection state and emit event
     */
    private setState;
    /**
     * Force a reconnection (useful after Unity domain reload)
     */
    forceReconnect(): void;
    /**
     * Get connection statistics
     */
    getStats(): {
        state: ConnectionState;
        reconnectAttempt: number;
        timeSinceLastPong: number;
        isAwaitingPong: boolean;
    };
}
