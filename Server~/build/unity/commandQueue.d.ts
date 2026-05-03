import { Logger } from '../utils/logger.js';
/**
 * Represents a queued command with its metadata
 */
export interface QueuedCommand {
    /** Unique identifier for the command */
    id: string;
    /** The request to send to Unity */
    request: {
        id?: string;
        method: string;
        params: any;
    };
    /** Resolve callback for the promise */
    resolve: (value: any) => void;
    /** Reject callback for the promise */
    reject: (reason: any) => void;
    /** Timestamp when the command was queued */
    queuedAt: number;
    /** Optional custom timeout for this specific command (in ms) */
    timeout?: number;
    /** If true, skip opt-in modal diagnostics when this command times out */
    skipModalDiagnosticsOnTimeout?: boolean;
}
/**
 * Configuration options for the CommandQueue
 */
export interface CommandQueueConfig {
    /** Maximum number of commands to queue (default: 100) */
    maxSize?: number;
    /** Default timeout in milliseconds for queued commands (default: 60000) */
    defaultTimeout?: number;
    /** Interval in milliseconds to check for expired commands (default: 5000) */
    cleanupInterval?: number;
}
/**
 * Statistics about the command queue
 */
export interface CommandQueueStats {
    /** Current number of queued commands */
    size: number;
    /** Maximum queue size */
    maxSize: number;
    /** Number of commands that were dropped due to queue overflow */
    droppedCount: number;
    /** Number of commands that expired while queued */
    expiredCount: number;
    /** Number of commands successfully replayed */
    replayedCount: number;
}
/**
 * Result of attempting to enqueue a command
 */
export interface EnqueueResult {
    /** Whether the command was successfully queued */
    success: boolean;
    /** Position in queue (1-indexed) if successful */
    position?: number;
    /** Reason for failure if not successful */
    reason?: string;
}
/**
 * CommandQueue manages commands that are queued when the Unity connection is unavailable.
 * Commands are stored and replayed when the connection is restored.
 */
export declare class CommandQueue {
    private queue;
    private config;
    private cleanupTimer;
    private logger;
    private droppedCount;
    private expiredCount;
    private replayedCount;
    constructor(logger: Logger, config?: CommandQueueConfig);
    /**
     * Enqueue a command to be sent when the connection is restored
     * @param command The command to queue (without queuedAt, which will be added automatically)
     * @returns Result indicating whether the command was queued successfully
     */
    enqueue(command: Omit<QueuedCommand, 'queuedAt'>): EnqueueResult;
    /**
     * Get the number of commands currently in the queue
     */
    get size(): number;
    /**
     * Check if the queue is empty
     */
    get isEmpty(): boolean;
    /**
     * Check if the queue is full
     */
    get isFull(): boolean;
    /**
     * Get all queued commands and clear the queue.
     * Used when connection is restored to replay commands.
     * Expired commands are filtered out and rejected before returning.
     * @returns Array of valid (non-expired) queued commands
     */
    drain(): QueuedCommand[];
    /**
     * Peek at the next command without removing it
     * @returns The next command in the queue, or undefined if empty
     */
    peek(): QueuedCommand | undefined;
    /**
     * Clear all queued commands, rejecting each with an error
     * @param reason The reason for clearing the queue
     */
    clear(reason?: string): void;
    /**
     * Remove expired commands from the queue
     * @returns Number of commands that were expired and removed
     */
    cleanupExpired(): number;
    /**
     * Start the periodic cleanup timer
     */
    private startCleanupTimer;
    /**
     * Stop the cleanup timer
     */
    stopCleanupTimer(): void;
    /**
     * Record that a command was successfully replayed
     */
    recordReplaySuccess(): void;
    /**
     * Get statistics about the command queue
     */
    getStats(): CommandQueueStats;
    /**
     * Reset statistics counters
     */
    resetStats(): void;
    /**
     * Update configuration dynamically
     * Note: maxSize changes won't affect already-queued commands
     */
    updateConfig(config: Partial<CommandQueueConfig>): void;
    /**
     * Clean up resources
     */
    dispose(): void;
}
