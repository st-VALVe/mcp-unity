import { McpUnityError, ErrorType } from '../utils/errors.js';
/**
 * Default configuration values
 */
const DEFAULT_CONFIG = {
    maxSize: 100,
    defaultTimeout: 60000, // 60 seconds
    cleanupInterval: 5000 // 5 seconds
};
/**
 * CommandQueue manages commands that are queued when the Unity connection is unavailable.
 * Commands are stored and replayed when the connection is restored.
 */
export class CommandQueue {
    queue = [];
    config;
    cleanupTimer = null;
    logger;
    // Statistics
    droppedCount = 0;
    expiredCount = 0;
    replayedCount = 0;
    constructor(logger, config = {}) {
        this.logger = logger;
        this.config = {
            ...DEFAULT_CONFIG,
            ...config
        };
        // Start cleanup timer
        this.startCleanupTimer();
    }
    /**
     * Enqueue a command to be sent when the connection is restored
     * @param command The command to queue (without queuedAt, which will be added automatically)
     * @returns Result indicating whether the command was queued successfully
     */
    enqueue(command) {
        // Check if queue is full
        if (this.queue.length >= this.config.maxSize) {
            this.droppedCount++;
            this.logger.warn(`Command queue full (${this.config.maxSize}), dropping command: ${command.request.method}`);
            // Reject the command immediately
            command.reject(new McpUnityError(ErrorType.CONNECTION, `Command queue full (${this.config.maxSize} commands). Try again later.`));
            return {
                success: false,
                reason: `Queue is full (max: ${this.config.maxSize})`
            };
        }
        const queuedCommand = {
            ...command,
            queuedAt: Date.now(),
            timeout: command.timeout ?? this.config.defaultTimeout
        };
        this.queue.push(queuedCommand);
        const position = this.queue.length;
        this.logger.debug(`Queued command ${command.id} (${command.request.method}), position: ${position}/${this.config.maxSize}`);
        return {
            success: true,
            position
        };
    }
    /**
     * Get the number of commands currently in the queue
     */
    get size() {
        return this.queue.length;
    }
    /**
     * Check if the queue is empty
     */
    get isEmpty() {
        return this.queue.length === 0;
    }
    /**
     * Check if the queue is full
     */
    get isFull() {
        return this.queue.length >= this.config.maxSize;
    }
    /**
     * Get all queued commands and clear the queue.
     * Used when connection is restored to replay commands.
     * Expired commands are filtered out and rejected before returning.
     * @returns Array of valid (non-expired) queued commands
     */
    drain() {
        // Clean up expired commands first
        this.cleanupExpired();
        const commands = [...this.queue];
        this.queue = [];
        if (commands.length > 0) {
            this.logger.info(`Draining ${commands.length} commands from queue for replay`);
        }
        return commands;
    }
    /**
     * Peek at the next command without removing it
     * @returns The next command in the queue, or undefined if empty
     */
    peek() {
        return this.queue[0];
    }
    /**
     * Clear all queued commands, rejecting each with an error
     * @param reason The reason for clearing the queue
     */
    clear(reason = 'Queue cleared') {
        const count = this.queue.length;
        for (const command of this.queue) {
            command.reject(new McpUnityError(ErrorType.CONNECTION, reason));
        }
        this.queue = [];
        if (count > 0) {
            this.logger.info(`Cleared ${count} commands from queue: ${reason}`);
        }
    }
    /**
     * Remove expired commands from the queue
     * @returns Number of commands that were expired and removed
     */
    cleanupExpired() {
        const now = Date.now();
        const initialSize = this.queue.length;
        this.queue = this.queue.filter(command => {
            const timeout = command.timeout ?? this.config.defaultTimeout;
            const isExpired = (now - command.queuedAt) > timeout;
            if (isExpired) {
                this.expiredCount++;
                this.logger.debug(`Command ${command.id} (${command.request.method}) expired after ${timeout}ms`);
                command.reject(new McpUnityError(ErrorType.TIMEOUT, `Command expired after ${timeout}ms in queue`));
                return false;
            }
            return true;
        });
        const expiredCount = initialSize - this.queue.length;
        if (expiredCount > 0) {
            this.logger.info(`Cleaned up ${expiredCount} expired commands from queue`);
        }
        return expiredCount;
    }
    /**
     * Start the periodic cleanup timer
     */
    startCleanupTimer() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
        }
        this.cleanupTimer = setInterval(() => {
            this.cleanupExpired();
        }, this.config.cleanupInterval);
        // Don't prevent process exit
        this.cleanupTimer.unref();
    }
    /**
     * Stop the cleanup timer
     */
    stopCleanupTimer() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }
    /**
     * Record that a command was successfully replayed
     */
    recordReplaySuccess() {
        this.replayedCount++;
    }
    /**
     * Get statistics about the command queue
     */
    getStats() {
        return {
            size: this.queue.length,
            maxSize: this.config.maxSize,
            droppedCount: this.droppedCount,
            expiredCount: this.expiredCount,
            replayedCount: this.replayedCount
        };
    }
    /**
     * Reset statistics counters
     */
    resetStats() {
        this.droppedCount = 0;
        this.expiredCount = 0;
        this.replayedCount = 0;
    }
    /**
     * Update configuration dynamically
     * Note: maxSize changes won't affect already-queued commands
     */
    updateConfig(config) {
        this.config = { ...this.config, ...config };
        // Restart cleanup timer if interval changed
        if (config.cleanupInterval !== undefined) {
            this.startCleanupTimer();
        }
    }
    /**
     * Clean up resources
     */
    dispose() {
        this.stopCleanupTimer();
        this.clear('Command queue disposed');
    }
}
