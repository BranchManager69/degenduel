// utils/logger-suite/batch-progress.js

/**
 * Batch Progress Utility
 * 
 * A utility for tracking and displaying batch processing progress in the terminal
 * while handling non-TTY environments (like logs) appropriately.
 * 
 * Features:
 * - TTY-aware progress bar that updates in-place
 * - Fallback for non-TTY environments (like Logtail)
 * - Customizable display format
 * - Error tracking and reporting
 * - Built-in throttling to avoid log spam
 * 
 * @version 1.0.0
 * @license MIT
 */

import { logApi } from './logger.js';
import { fancyColors } from '../colors.js';

class BatchProgress {
  constructor({
    name = 'Batch Process',
    total = 100,
    batchSize = 10,
    service = 'BATCH_PROGRESS',
    logLevel = 'debug',
    progressChar = '█',
    emptyChar = '░',
    barLength = 20,
    throttleMs = 250, // Min time between progress updates
    displayErrors = true,
    updateInterval = 10, // Update every X% in non-TTY mode
    operation = null, // Optional operation identifier for analytics
    category = 'batch_process', // Category for analytics grouping
    metadata = {}, // Additional metadata for logging
  } = {}) {
    // Core tracking properties
    this.name = name;
    this.total = total;
    this.current = 0;
    this.batchSize = batchSize;
    this.throttleMs = throttleMs;
    this.displayErrors = displayErrors;
    this.updateInterval = updateInterval;
    
    // Analytics tracking properties
    this.operation = operation || name.toLowerCase().replace(/\s+/g, '_');
    this.category = category;
    this.metadata = metadata;
    this.batchTimings = [];
    
    // Display options
    this.service = service;
    this.logLevel = logLevel;
    this.progressChar = progressChar;
    this.emptyChar = emptyChar;
    this.barLength = barLength;
    
    // Stats tracking
    this.startTime = Date.now();
    this.lastUpdateTime = 0;
    this.errors = [];
    this.warnings = [];
    this.completedBatches = 0;
    this.skippedBatches = 0;
    
    // Terminal properties
    this.isTTY = process.stdout.isTTY;
    this.lastMessageLength = 0;
    
    // State management
    this.running = false;
    this.completed = false;
  }

  /**
   * Start the batch process
   */
  start() {
    this.running = true;
    this.startTime = Date.now();
    this.current = 0;
    this.completedBatches = 0;
    this.skippedBatches = 0;
    this.errors = [];
    this.warnings = [];
    this.batchTimings = [];

    // Initial progress display
    if (this.isTTY) {
      this._renderProgress();
    } else {
      // For non-TTY, log the start message
      logApi[this.logLevel](`Starting ${this.name}: 0/${this.total} (0%)`, {
        service: this.service,
        // Add structured analytics data for Logtail
        _batch_operation: {
          action: 'start',
          operation: this.operation,
          category: this.category,
          total_items: this.total,
          batch_size: this.batchSize,
          timestamp: new Date().toISOString(),
          ...this.metadata
        }
      });
    }

    // Emit a structured log event for batch operation start (always)
    logApi.debug(`Batch operation started: ${this.name}`, {
      service: this.service,
      event_type: 'batch_start',
      _source: 'batch_analytics',
      _batch_operation: {
        id: `${this.operation}_${Date.now()}`,
        name: this.name,
        operation: this.operation,
        category: this.category,
        total_items: this.total,
        batch_size: this.batchSize,
        timestamp: new Date().toISOString()
      },
      ...this.metadata
    });

    return this;
  }

  /**
   * Update progress
   * @param {number} increment - Number of items to increment progress by (default: 1)
   * @param {string[]} messageParts - Optional message parts to display with progress
   */
  update(increment = 1, messageParts = []) {
    if (!this.running) this.start();
    
    this.current += increment;
    if (this.current > this.total) this.current = this.total;
    
    const now = Date.now();
    const shouldUpdate = (
      // Always update if we're at 0, 100%, or if we've passed our throttle time
      this.current === this.total || 
      this.current === 0 || 
      (now - this.lastUpdateTime) >= this.throttleMs
    );
    
    if (!shouldUpdate) return this;
    
    // TTY mode - update the progress bar in place
    if (this.isTTY) {
      this._renderProgress(messageParts);
    } 
    // Non-TTY mode - log at specific intervals to avoid spam
    else {
      const percentComplete = Math.floor((this.current / this.total) * 100);
      const shouldLogProgress = (
        this.current === this.total || 
        this.current === 0 ||
        percentComplete % this.updateInterval === 0 || 
        (this.current % Math.max(1, Math.floor(this.total / 10)) === 0)
      );
      
      if (shouldLogProgress) {
        const message = messageParts.length > 0 
          ? `${messageParts.join(' ')} - ` 
          : '';
          
        logApi[this.logLevel](
          `${this.name}: ${message}${this.current}/${this.total} (${percentComplete}%)`, 
          { service: this.service }
        );
      }
    }
    
    this.lastUpdateTime = now;
    return this;
  }

  /**
   * Mark a batch as completed
   * @param {number} batchNum - The batch number that completed
   * @param {number} itemCount - Number of items in the batch (default: batch size)
   * @param {string[]} messageParts - Optional message parts to display with progress
   * @param {number} batchTimeMs - Time taken to process this batch in milliseconds (for analytics)
   */
  completeBatch(batchNum, itemCount = this.batchSize, messageParts = [], batchTimeMs = null) {
    this.completedBatches++;
    
    // Auto-calculate increment based on batch size if not specified
    const actualIncrement = (itemCount > 0) ? itemCount : this.batchSize;
    
    // Record batch timing metrics
    const now = Date.now();
    const elapsed = now - this.startTime;
    const batchTiming = {
      batchNum,
      itemCount: actualIncrement,
      timeMs: batchTimeMs || 0, // If not provided, we don't know the actual time
      timestamp: new Date(now).toISOString(),
      elapsedMs: elapsed,
      itemsPerSecond: batchTimeMs ? (actualIncrement / (batchTimeMs / 1000)).toFixed(2) : 0
    };
    
    this.batchTimings.push(batchTiming);
    
    // Update progress with the count from this batch
    this.update(actualIncrement, [
      `Batch ${batchNum} complete`,
      ...messageParts
    ]);
    
    // Emit structured batch completion data for analytics
    logApi.debug(`Batch ${batchNum} completed`, {
      service: this.service,
      event_type: 'batch_complete',
      _source: 'batch_analytics',
      _batch_metrics: {
        operation: this.operation,
        category: this.category,
        batch_num: batchNum,
        items_processed: actualIncrement,
        duration_ms: batchTiming.timeMs,
        items_per_second: batchTiming.itemsPerSecond,
        total_progress: {
          completed: this.current + actualIncrement,
          total: this.total,
          percent: Math.floor(((this.current + actualIncrement) / this.total) * 100)
        },
        timestamp: batchTiming.timestamp
      }
    });
    
    return this;
  }

  /**
   * Track a batch error
   * @param {number} batchNum - The batch number with the error
   * @param {any} error - The error object
   * @param {boolean} isFatal - Whether this is a fatal error
   * @param {number} statusCode - HTTP status code or error code
   * @param {string} errorType - Type of error (e.g., 'RateLimit', 'NetworkError')
   */
  trackError(batchNum, error, isFatal = false, statusCode = null, errorType = null) {
    const errorInfo = {
      batchNum,
      error: error.message || String(error),
      timestamp: new Date(),
      isFatal,
      statusCode: statusCode || (error.statusCode || error.status || null),
      errorType: errorType || (error.name || 'Error'),
      context: {
        progress: this.current,
        total: this.total,
        percent: Math.floor((this.current / this.total) * 100)
      }
    };
    
    this.errors.push(errorInfo);
    
    // Prepare structured error data for logging
    const structuredErrorData = {
      service: this.service,
      batchNum,
      errorCount: this.errors.length,
      // Add rich metadata for Logtail alerting and analytics
      event_type: 'batch_error',
      _source: 'batch_error',
      _error: {
        operation: this.operation,
        category: this.category,
        type: errorInfo.errorType,
        status_code: errorInfo.statusCode,
        batch_num: batchNum,
        is_fatal: isFatal,
        message: errorInfo.error,
        timestamp: errorInfo.timestamp.toISOString(),
        context: errorInfo.context
      },
      ...this.metadata
    };
    
    // Check if this is a rate limit error
    const isRateLimit = 
      statusCode === 429 || 
      (error.statusCode === 429) ||
      (error.response && error.response.status === 429) ||
      (errorInfo.error.includes('rate limit') || errorInfo.error.includes('too many requests'));
    
    if (isRateLimit) {
      structuredErrorData._error.rate_limit = true;
      structuredErrorData._alert_group = 'rate_limit';
      structuredErrorData._alert_priority = 'medium';
      
      // Extract retry after value if it exists
      let retryAfterMs = null;
      if (error.response && error.response.headers && error.response.headers['retry-after']) {
        const retryAfterValue = error.response.headers['retry-after'];
        const retryAfterSeconds = parseInt(retryAfterValue, 10);
        
        if (!isNaN(retryAfterSeconds)) {
          retryAfterMs = retryAfterSeconds * 1000;
        } else {
          const retryAfterDate = new Date(retryAfterValue);
          if (!isNaN(retryAfterDate.getTime())) {
            retryAfterMs = retryAfterDate.getTime() - Date.now();
          }
        }
        
        if (retryAfterMs > 0) {
          structuredErrorData._error.retry_after_ms = retryAfterMs;
        }
      }
    }
    
    // Only display errors in TTY mode if displayErrors is true
    if (this.isTTY && this.displayErrors) {
      // Save cursor position
      process.stdout.write('\u001B[s');
      
      // Move up a line, print error, and return to saved position
      process.stdout.write('\u001B[A\r');
      process.stdout.write(`${fancyColors.RED}Error in batch ${batchNum}: ${errorInfo.error}${fancyColors.RESET}\n`);
      
      // Restore cursor position
      process.stdout.write('\u001B[u');
      
      // Re-render progress since it might have been disrupted
      this._renderProgress();
    } 
    
    // Regardless of TTY, always log errors with structured data for analytics
    logApi.error(`${this.name} batch ${batchNum} error: ${errorInfo.error}`, structuredErrorData);
    
    return this;
  }

  /**
   * Track a batch warning
   * @param {number} batchNum - The batch number with the warning
   * @param {string} message - The warning message
   */
  trackWarning(batchNum, message) {
    const warningInfo = {
      batchNum,
      message,
      timestamp: new Date()
    };
    
    this.warnings.push(warningInfo);
    
    // Only display warnings in TTY mode if displayErrors is true
    if (this.isTTY && this.displayErrors) {
      // Save cursor position
      process.stdout.write('\u001B[s');
      
      // Move up a line, print warning, and return to saved position
      process.stdout.write('\u001B[A\r');
      process.stdout.write(`${fancyColors.YELLOW}Warning in batch ${batchNum}: ${message}${fancyColors.RESET}\n`);
      
      // Restore cursor position
      process.stdout.write('\u001B[u');
      
      // Re-render progress since it might have been disrupted
      this._renderProgress();
    } else {
      // For non-TTY, log through the normal logger
      logApi.warn(`${this.name} batch ${batchNum} warning: ${message}`, { 
        service: this.service,
        batchNum,
        warningCount: this.warnings.length 
      });
    }
    
    return this;
  }

  /**
   * Mark a batch as skipped
   * @param {number} batchNum - The batch number that was skipped
   * @param {string} reason - Reason for skipping
   */
  skipBatch(batchNum, reason = '') {
    this.skippedBatches++;
    
    // For non-TTY, log through the normal logger
    if (!this.isTTY) {
      logApi.info(`${this.name} batch ${batchNum} skipped${reason ? ': ' + reason : ''}`, { 
        service: this.service,
        batchNum,
        skippedCount: this.skippedBatches 
      });
    } else if (this.displayErrors) {
      // Save cursor position
      process.stdout.write('\u001B[s');
      
      // Move up a line, print skip message, and return to saved position
      process.stdout.write('\u001B[A\r');
      process.stdout.write(`${fancyColors.CYAN}Skipped batch ${batchNum}${reason ? ': ' + reason : ''}${fancyColors.RESET}\n`);
      
      // Restore cursor position
      process.stdout.write('\u001B[u');
      
      // Re-render progress since it might have been disrupted
      this._renderProgress();
    }
    
    return this;
  }

  /**
   * Complete the batch process
   * @param {Object} options - Completion options
   * @param {string} options.message - Final completion message
   * @param {string} options.level - Log level for the completion message
   */
  finish({ message = "", level = this.logLevel } = {}) {
    if (!this.running) return this;
    
    this.running = false;
    this.completed = true;
    const endTime = Date.now();
    const durationMs = endTime - this.startTime;
    const durationSec = (durationMs / 1000).toFixed(2);
    
    // Generate stats
    const stats = {
      name: this.name,
      total: this.total,
      completed: this.current,
      percent: Math.floor((this.current / this.total) * 100),
      duration: {
        ms: durationMs,
        seconds: durationSec,
        formattedTime: this._formatDuration(durationMs)
      },
      batches: {
        completed: this.completedBatches,
        skipped: this.skippedBatches,
      },
      errors: this.errors.length,
      warnings: this.warnings.length,
      itemsPerSecond: (this.current / (durationMs / 1000)).toFixed(2)
    };
    
    // Calculate timing stats if we have batch timings
    if (this.batchTimings.length > 0) {
      // Calculate average, min, max batch processing times
      const batchTimes = this.batchTimings.map(b => b.timeMs).filter(t => t > 0);
      if (batchTimes.length > 0) {
        const avgBatchTimeMs = batchTimes.reduce((sum, time) => sum + time, 0) / batchTimes.length;
        const minBatchTimeMs = Math.min(...batchTimes);
        const maxBatchTimeMs = Math.max(...batchTimes);
        
        stats.batch_timing = {
          average_ms: avgBatchTimeMs.toFixed(2),
          min_ms: minBatchTimeMs.toFixed(2),
          max_ms: maxBatchTimeMs.toFixed(2),
          deviation_percent: ((maxBatchTimeMs - minBatchTimeMs) / avgBatchTimeMs * 100).toFixed(2)
        };
      }
    }
    
    // Clear the progress line in TTY mode
    if (this.isTTY) {
      process.stdout.write('\r' + ' '.repeat(this.lastMessageLength) + '\r');
    }
    
    // Use the provided message or generate a completion message
    const completionMessage = message || this._generateCompletionMessage(stats);
    
    // Create structured analytics data
    const analyticsData = {
      service: this.service,
      event_type: 'batch_complete',
      _source: 'batch_analytics',
      _batch_summary: {
        operation: this.operation,
        category: this.category,
        name: this.name,
        timestamp: new Date().toISOString(),
        start_time: new Date(this.startTime).toISOString(),
        end_time: new Date(endTime).toISOString(),
        duration_ms: durationMs,
        total_items: this.total,
        completed_items: this.current,
        completion_percent: stats.percent,
        items_per_second: stats.itemsPerSecond,
        batches_completed: this.completedBatches,
        batches_skipped: this.skippedBatches,
        batch_size: this.batchSize,
        errors: stats.errors,
        warnings: stats.warnings,
        success_rate: ((this.total - this.errors.length) / this.total * 100).toFixed(2)
      },
      ...this.metadata
    };
    
    // Add batch timing stats if available
    if (stats.batch_timing) {
      analyticsData._batch_summary.batch_timing = stats.batch_timing;
    }
    
    // Add error rate alert if over threshold
    const errorRate = this.errors.length / this.total;
    if (errorRate > 0.05) { // 5% error rate or higher
      analyticsData._alert_group = 'high_error_rate';
      analyticsData._alert_priority = errorRate > 0.2 ? 'high' : 'medium';
      analyticsData._alert_data = {
        error_rate: (errorRate * 100).toFixed(2) + '%',
        error_count: this.errors.length,
        total_items: this.total
      };
    }
    
    // If operation was slow, add performance alert
    const slowOperationThreshold = 500; // ms per item
    const avgTimePerItem = durationMs / this.current;
    if (avgTimePerItem > slowOperationThreshold && this.current > 10) { // Only alert if meaningful sample
      if (!analyticsData._alert_group) {
        analyticsData._alert_group = 'slow_performance';
        analyticsData._alert_priority = 'low';
      }
      analyticsData._performance_alert = {
        avg_time_per_item_ms: avgTimePerItem.toFixed(2),
        expected_threshold_ms: slowOperationThreshold,
        slowdown_factor: (avgTimePerItem / slowOperationThreshold).toFixed(2)
      };
    }
    
    // Log the completion message with all the structured data
    logApi[level](completionMessage, analyticsData);
    
    return stats;
  }

  /**
   * Generate a formatted completion message with stats
   * @param {Object} stats - Process statistics
   * @returns {string} Formatted completion message
   * @private
   */
  _generateCompletionMessage(stats) {
    let statusEmoji = stats.errors > 0 ? '⚠️' : '✅';

    return `${statusEmoji} ${this.name} completed: ${stats.completed}/${stats.total} items (${stats.percent}%) in ${stats.duration.seconds}s
    Processed: ${stats.itemsPerSecond} items/sec
    Batches: ${stats.batches.completed} completed, ${stats.batches.skipped} skipped
    Issues: ${stats.errors} errors, ${stats.warnings} warnings`;
  }

  /**
   * Format a duration in milliseconds to a human-readable string
   * @param {number} ms - Duration in milliseconds
   * @returns {string} Formatted duration string
   * @private
   */
  _formatDuration(ms) {
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor(ms / (1000 * 60 * 60));
    
    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
    
    return parts.join(' ');
  }

  /**
   * Render the progress bar to the console
   * @param {string[]} messageParts - Optional message parts to display
   * @private
   */
  _renderProgress(messageParts = []) {
    if (!this.isTTY) return;
    
    const percent = Math.floor((this.current / this.total) * 100);
    const filledLength = Math.floor((this.barLength * this.current) / this.total);
    const bar = this.progressChar.repeat(filledLength) + this.emptyChar.repeat(this.barLength - filledLength);
    
    // Calculate elapsed time and estimate remaining time
    const elapsed = Date.now() - this.startTime;
    let estimatedTotal = 0;
    let estimatedRemaining = 0;
    let timeDisplay = '';
    
    if (this.current > 0) {
      // Estimate total time
      estimatedTotal = (elapsed * this.total) / this.current;
      estimatedRemaining = estimatedTotal - elapsed;
      
      // Format time remaining
      if (estimatedRemaining > 0) {
        const remainingSec = Math.ceil(estimatedRemaining / 1000);
        const remainingMin = Math.floor(remainingSec / 60);
        const remainingHrs = Math.floor(remainingMin / 60);
        
        if (remainingHrs > 0) {
          timeDisplay = ` - ETA: ${remainingHrs}h ${remainingMin % 60}m`;
        } else if (remainingMin > 0) {
          timeDisplay = ` - ETA: ${remainingMin}m ${remainingSec % 60}s`;
        } else {
          timeDisplay = ` - ETA: ${remainingSec}s`;
        }
      }
    }
    
    // Build the message parts
    let message = messageParts.join(' ');
    if (message) message += ' '; // Add a space if there's a custom message
    
    // Error and warning counts if any
    let issueDisplay = '';
    if (this.errors.length > 0 || this.warnings.length > 0) {
      issueDisplay = ` [${this.errors.length > 0 ? `${fancyColors.RED}${this.errors.length}E${fancyColors.RESET}` : ''}${
        this.warnings.length > 0 ? `${this.errors.length > 0 ? ',' : ''}${fancyColors.YELLOW}${this.warnings.length}W${fancyColors.RESET}` : ''
      }]`;
    }
    
    // Build the full progress message
    const progressMessage = `\r${fancyColors.BLUE}${this.name}${fancyColors.RESET}: ${message}${this.current}/${this.total} [${bar}] ${percent}%${issueDisplay}${timeDisplay} `;
    
    // Clear the previous line content if this message is shorter
    const clearLength = Math.max(0, this.lastMessageLength - progressMessage.length);
    process.stdout.write(progressMessage + ' '.repeat(clearLength));
    this.lastMessageLength = progressMessage.length;
  }

  /**
   * Get the current stats without completing the process
   */
  getStats() {
    const currentTime = Date.now();
    const durationMs = currentTime - this.startTime;
    const durationSec = (durationMs / 1000).toFixed(2);
    
    return {
      name: this.name,
      total: this.total,
      completed: this.current,
      percent: Math.floor((this.current / this.total) * 100),
      duration: {
        ms: durationMs,
        seconds: durationSec,
        formattedTime: this._formatDuration(durationMs)
      },
      batches: {
        completed: this.completedBatches,
        skipped: this.skippedBatches,
      },
      errors: this.errors.length,
      errorDetails: this.errors,
      warnings: this.warnings.length,
      warningDetails: this.warnings,
      itemsPerSecond: (this.current / (durationMs / 1000)).toFixed(2),
      running: this.running,
      completed: this.completed
    };
  }
}

/**
 * Create a new batch progress tracker
 * @param {Object} options - Configuration options
 * @returns {BatchProgress} A new batch progress tracker
 */
export function createBatchProgress(options = {}) {
  return new BatchProgress(options);
}

export default BatchProgress;