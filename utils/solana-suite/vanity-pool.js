// /utils/solana-suite/vanity-pool.js

import { Keypair } from '@solana/web3.js';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { cpus } from 'os';
import WalletGenerator from '../../services/walletGenerationService.js';
import { fileURLToPath } from 'url';
import path from 'path';
import os from 'os';
import { BaseService } from '../service-suite/base-service.js';
import { SERVICE_NAMES, getServiceMetadata } from '../service-suite/service-constants.js';
import { logApi } from '../logger-suite/logger.js';

class VanityGeneratorError extends Error {
    constructor(message, code, details) {
        super(message);
        this.name = 'VanityGeneratorError';
        this.code = code;
        this.details = details;
    }
}

// Worker thread code
if (!isMainThread) {
    const { pattern, isCaseSensitive, position } = workerData;
    
    function matchesPattern(address, pattern, isCaseSensitive, position) {
        const compareStr = isCaseSensitive ? address : address.toLowerCase();
        const searchPattern = isCaseSensitive ? pattern : pattern.toLowerCase();
        
        if (position === 'start') {
            return compareStr.startsWith(searchPattern);
        } else if (position === 'end') {
            return compareStr.endsWith(searchPattern);
        } else {
            return compareStr.includes(searchPattern);
        }
    }

    function generateVanityAddress() {
        while (true) {
            const keypair = Keypair.generate();
            const address = keypair.publicKey.toString();
            
            if (matchesPattern(address, pattern, isCaseSensitive, position)) {
                return {
                    publicKey: address,
                    secretKey: Buffer.from(keypair.secretKey).toString('base64')
                };
            }
        }
    }

    // Start generating and send result back when found
    const result = generateVanityAddress();
    parentPort.postMessage(result);
}

const VANITY_POOL_CONFIG = {
    name: SERVICE_NAMES.VANITY_WALLET,
    description: getServiceMetadata(SERVICE_NAMES.VANITY_WALLET).description,
    checkIntervalMs: 5000, // Check pool health every 5 seconds
    maxRetries: 3,
    retryDelayMs: 5000,
    circuitBreaker: {
        failureThreshold: 5,
        resetTimeoutMs: 60000,
        minHealthyPeriodMs: 120000
    }
};

export class VanityPool extends BaseService {
    constructor(config = {}) {
        super(VANITY_POOL_CONFIG.name, {
            ...VANITY_POOL_CONFIG,
            ...config
        });

        // Instance properties
        this.maxWorkers = Math.max(1, cpus().length - 1); // Leave one core free
        this.activeWorkers = new Map();
        this.taskQueue = [];
        this.isProcessing = false;
        
        // CPU utilization management
        this.targetUtilization = config.targetUtilization || 0.80; // 80% target CPU utilization
        this.utilizationCheckInterval = 5000; // Check every 5 seconds
        this.utilizationWindow = 30000; // 30 second window for averaging
        this.utilizationHistory = [];
        this.utilizationChecker = null;

        // Service stats
        this.poolStats = {
            operations: {
                total: 0,
                successful: 0,
                failed: 0
            },
            workers: {
                active: 0,
                total_created: 0,
                current_load: 0
            },
            patterns: {
                total_generated: 0,
                by_complexity: {}
            },
            performance: {
                average_generation_time_ms: 0,
                last_generation_time_ms: 0
            }
        };
    }

    async initialize() {
        try {
            // Call parent initialize
            await super.initialize();

            // Start utilization monitoring
            this.startUtilizationMonitoring();

            logApi.info('Vanity Pool Service initialized');
            return true;
        } catch (error) {
            logApi.error('Failed to initialize Vanity Pool Service:', error);
            throw error;
        }
    }

    async stop() {
        try {
            // Stop utilization monitoring
            this.stopUtilizationMonitoring();

            // Terminate all workers
            for (const [id, worker] of this.activeWorkers) {
                worker.terminate();
                this.activeWorkers.delete(id);
            }

            // Call parent stop
            await super.stop();
            
            logApi.info('Vanity Pool Service stopped');
        } catch (error) {
            logApi.error('Error stopping Vanity Pool Service:', error);
            throw error;
        }
    }

    // Main operation - health check and maintenance
    async performOperation() {
        try {
            // Check worker health
            const workerCount = this.activeWorkers.size;
            const optimalCount = this.getOptimalWorkerCount();
            
            // Adjust workers if needed
            if (optimalCount !== workerCount) {
                this.adjustWorkerCount(optimalCount);
            }

            // Update stats
            this.poolStats.workers.active = this.activeWorkers.size;
            this.poolStats.workers.current_load = this.getCurrentCPUUtilization();

            return {
                workers: this.poolStats.workers,
                patterns: this.poolStats.patterns,
                performance: this.poolStats.performance
            };
        } catch (error) {
            // Let base class handle error and circuit breaker
            throw error;
        }
    }

    getOptimalWorkerCount() {
        const cpuCount = cpus().length;
        const currentLoad = this.getCurrentCPUUtilization();
        
        // If we're above target utilization, reduce workers
        if (currentLoad > this.targetUtilization) {
            return Math.max(1, Math.floor(this.activeWorkers.size * 0.8));
        }
        
        // If we're well below target, we can add more workers
        if (currentLoad < this.targetUtilization * 0.7) {
            return Math.min(cpuCount - 1, Math.ceil(this.activeWorkers.size * 1.2));
        }
        
        // Keep current count if utilization is good
        return this.activeWorkers.size;
    }

    getCurrentCPUUtilization() {
        const cpus = os.cpus();
        let totalUsage = 0;
        let totalTime = 0;

        cpus.forEach(cpu => {
            const total = Object.values(cpu.times).reduce((acc, time) => acc + time, 0);
            const idle = cpu.times.idle;
            totalUsage += total - idle;
            totalTime += total;
        });

        return totalUsage / totalTime;
    }

    startUtilizationMonitoring() {
        if (this.utilizationChecker) return;

        this.utilizationChecker = setInterval(() => {
            const utilization = this.getCurrentCPUUtilization();
            
            // Keep a rolling window of utilization history
            this.utilizationHistory.push({
                timestamp: Date.now(),
                utilization
            });

            // Remove old entries
            const cutoff = Date.now() - this.utilizationWindow;
            this.utilizationHistory = this.utilizationHistory.filter(
                entry => entry.timestamp > cutoff
            );

            // Calculate average utilization
            const avgUtilization = this.utilizationHistory.reduce(
                (acc, entry) => acc + entry.utilization, 0
            ) / this.utilizationHistory.length;

            // Adjust workers if needed
            if (avgUtilization > this.targetUtilization) {
                this.throttleWorkers();
            }
        }, this.utilizationCheckInterval);
    }

    stopUtilizationMonitoring() {
        if (this.utilizationChecker) {
            clearInterval(this.utilizationChecker);
            this.utilizationChecker = null;
        }
    }

    throttleWorkers() {
        const currentWorkers = this.activeWorkers.size;
        const optimalCount = this.getOptimalWorkerCount();

        if (optimalCount < currentWorkers) {
            // Remove excess workers
            let workersToRemove = currentWorkers - optimalCount;
            for (const [id, worker] of this.activeWorkers) {
                if (workersToRemove <= 0) break;
                worker.terminate();
                this.activeWorkers.delete(id);
                workersToRemove--;
            }
        }
    }

    adjustWorkerCount(targetCount) {
        const currentCount = this.activeWorkers.size;
        
        if (targetCount > currentCount) {
            // Add workers
            for (let i = currentCount; i < targetCount; i++) {
                const worker = new Worker(fileURLToPath(import.meta.url));
                const workerId = Date.now() + i;
                this.activeWorkers.set(workerId, worker);
                this.poolStats.workers.total_created++;
            }
        } else if (targetCount < currentCount) {
            // Remove workers
            let toRemove = currentCount - targetCount;
            for (const [id, worker] of this.activeWorkers) {
                if (toRemove <= 0) break;
                worker.terminate();
                this.activeWorkers.delete(id);
                toRemove--;
            }
        }
    }

    validatePattern(pattern) {
        // Check for valid base58 characters
        const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;
        if (!base58Regex.test(pattern)) {
            throw new VanityGeneratorError(
                'Invalid pattern: must contain only base58 characters',
                'INVALID_PATTERN',
                { pattern }
            );
        }

        // Check length constraints
        if (pattern.length < 1 || pattern.length > 20) {
            throw new VanityGeneratorError(
                'Invalid pattern length: must be between 1 and 20 characters',
                'INVALID_LENGTH',
                { pattern, length: pattern.length }
            );
        }
    }

    estimateTime(pattern) {
        // Rough estimation based on pattern length and character set
        const base58Size = 58;
        const patternLength = pattern.length;
        const averageAttempts = Math.pow(base58Size, patternLength);
        const attemptsPerSecondPerCore = 50000; // Approximate
        
        return {
            estimatedAttempts: averageAttempts,
            estimatedSeconds: averageAttempts / (attemptsPerSecondPerCore * this.maxWorkers),
            cores: this.maxWorkers
        };
    }

    async generateVanityWallet(options) {
        const startTime = Date.now();

        try {
            const {
                pattern,
                identifier,
                isCaseSensitive = false,
                position = 'start',
                timeout = 300000,
                metadata = {}
            } = options;

            this.validatePattern(pattern);

            const workerPromise = new Promise((resolve, reject) => {
                const workers = [];
                let completed = false;

                // Use optimal worker count
                const workerCount = this.getOptimalWorkerCount();
                
                for (let i = 0; i < workerCount; i++) {
                    const worker = new Worker(fileURLToPath(import.meta.url), {
                        workerData: { pattern, isCaseSensitive, position }
                    });

                    const workerId = Date.now() + i;
                    this.activeWorkers.set(workerId, worker);
                    workers.push(worker);

                    worker.on('message', async (result) => {
                        if (!completed) {
                            completed = true;
                            
                            // Cleanup
                            workers.forEach(w => w.terminate());
                            workers.forEach((_, index) => {
                                this.activeWorkers.delete(Date.now() + index);
                            });

                            const wallet = await WalletGenerator.generateWallet(
                                identifier,
                                {
                                    fromPrivateKey: result.secretKey,
                                    metadata: {
                                        ...metadata,
                                        vanity: {
                                            pattern,
                                            position,
                                            isCaseSensitive
                                        }
                                    }
                                }
                            );

                            // Update stats
                            this.poolStats.operations.total++;
                            this.poolStats.operations.successful++;
                            this.poolStats.patterns.total_generated++;
                            this.poolStats.patterns.by_complexity[pattern.length] = 
                                (this.poolStats.patterns.by_complexity[pattern.length] || 0) + 1;
                            
                            const duration = Date.now() - startTime;
                            this.poolStats.performance.last_generation_time_ms = duration;
                            this.poolStats.performance.average_generation_time_ms = 
                                (this.poolStats.performance.average_generation_time_ms * 
                                (this.poolStats.operations.total - 1) + duration) / 
                                this.poolStats.operations.total;

                            resolve(wallet);
                        }
                    });

                    worker.on('error', (err) => {
                        if (!completed) {
                            completed = true;
                            workers.forEach(w => w.terminate());
                            this.poolStats.operations.total++;
                            this.poolStats.operations.failed++;
                            reject(new VanityGeneratorError(
                                'Worker error during generation',
                                'WORKER_ERROR',
                                { error: err.message }
                            ));
                        }
                    });
                }

                // Set timeout
                setTimeout(() => {
                    if (!completed) {
                        completed = true;
                        workers.forEach(w => w.terminate());
                        this.poolStats.operations.total++;
                        this.poolStats.operations.failed++;
                        reject(new VanityGeneratorError(
                            'Generation timed out',
                            'TIMEOUT',
                            { timeout }
                        ));
                    }
                }, timeout);
            });

            return await workerPromise;
        } catch (error) {
            this.poolStats.operations.total++;
            this.poolStats.operations.failed++;
            throw error;
        }
    }

    static async generateBatch(requests) {
        const results = {
            successful: [],
            failed: [],
            timing: {
                start: Date.now(),
                end: null,
                duration: null
            }
        };

        for (const request of requests) {
            try {
                const wallet = await this.generateVanityWallet(request);
                results.successful.push({
                    request,
                    wallet
                });
            } catch (error) {
                results.failed.push({
                    request,
                    error: {
                        code: error.code,
                        message: error.message,
                        details: error.details
                    }
                });
            }
        }

        results.timing.end = Date.now();
        results.timing.duration = results.timing.end - results.timing.start;

        return results;
    }

    static validatePatternComplexity(pattern) {
        const base58Size = 58;
        const patternLength = pattern.length;
        const complexity = Math.pow(base58Size, patternLength);
        
        return {
            complexity,
            isReasonable: complexity < 1e12, // Arbitrary threshold
            estimatedTime: this.estimateTime(pattern)
        };
    }

    static getActiveWorkers() {
        return {
            total: this.maxWorkers,
            active: this.activeWorkers.size,
            available: this.maxWorkers - this.activeWorkers.size,
            queue: this.taskQueue.length
        };
    }

    static getSystemStatus() {
        return {
            workers: this.getActiveWorkers(),
            cpuUtilization: {
                current: this.getCurrentCPUUtilization(),
                average: this.utilizationHistory.length ? 
                    this.utilizationHistory.reduce((acc, entry) => acc + entry.utilization, 0) / 
                    this.utilizationHistory.length : 0,
                target: this.targetUtilization
            },
            memory: {
                total: os.totalmem(),
                free: os.freemem(),
                usage: (1 - os.freemem() / os.totalmem()) * 100
            }
        };
    }

    // Get pool alerts
    static async getPoolAlerts() {
        const cpuUtilization = this.getCurrentCPUUtilization();
        const alerts = [];

        // Check CPU utilization
        if (cpuUtilization > this.targetUtilization) {
            alerts.push({
                type: 'warning',
                level: 'high',
                message: 'High CPU utilization',
                details: {
                    current: cpuUtilization,
                    target: this.targetUtilization
                }
            });
        }

        // Check active workers
        if (this.activeWorkers.size === this.maxWorkers) {
            alerts.push({
                type: 'info',
                level: 'medium',
                message: 'All workers are active',
                details: {
                    active: this.activeWorkers.size,
                    max: this.maxWorkers
                }
            });
        }

        // Check task queue
        if (this.taskQueue.length > 10) {
            alerts.push({
                type: 'warning',
                level: 'medium',
                message: 'Large task queue',
                details: {
                    queueSize: this.taskQueue.length
                }
            });
        }

        return alerts;
    }

    // Get pattern statistics
    static async getPatternStats() {
        try {
            const patterns = await prisma.vanity_wallet_pool.groupBy({
                by: ['pattern'],
                _count: {
                    pattern: true
                },
                _sum: {
                    is_used: true
                }
            });

            return patterns.map(p => ({
                pattern: p.pattern,
                total: p._count.pattern,
                used: p._sum.is_used || 0,
                available: p._count.pattern - (p._sum.is_used || 0),
                complexity: this.validatePatternComplexity(p.pattern)
            }));
        } catch (error) {
            throw new VanityGeneratorError(
                'Failed to get pattern statistics',
                'STATS_FAILED',
                { error: error.message }
            );
        }
    }

    // Get pool status
    static async getPoolStatus() {
        const status = this.getSystemStatus();
        const patterns = await this.getPatternStats();
        const alerts = await this.getPoolAlerts();

        return {
            workers: status.workers,
            patterns,
            alerts,
            system: {
                cpu: status.cpuUtilization,
                memory: status.memory
            },
            queue: {
                size: this.taskQueue.length,
                processing: this.isProcessing
            }
        };
    }

    // Add generation task
    static async addGenerationTask(pattern, count = 1, position = 'start', caseSensitive = false) {
        try {
            // Validate pattern first
            this.validatePattern(pattern);
            
            // Check complexity
            const complexity = this.validatePatternComplexity(pattern);
            if (!complexity.isReasonable) {
                throw new VanityGeneratorError(
                    'Pattern is too complex',
                    'PATTERN_TOO_COMPLEX',
                    complexity
                );
            }

            // Add to task queue
            const task = {
                pattern,
                count,
                position,
                caseSensitive,
                timestamp: Date.now()
            };
            this.taskQueue.push(task);

            // Start processing if not already
            if (!this.isProcessing) {
                this.processTaskQueue();
            }

            return {
                task,
                position: this.taskQueue.length,
                estimatedTime: this.estimateTime(pattern)
            };
        } catch (error) {
            throw new VanityGeneratorError(
                'Failed to add generation task',
                'TASK_ADD_FAILED',
                { pattern, count, error: error.message }
            );
        }
    }

    // Process task queue
    static async processTaskQueue() {
        if (this.isProcessing || this.taskQueue.length === 0) return;

        this.isProcessing = true;
        try {
            while (this.taskQueue.length > 0) {
                const task = this.taskQueue[0];
                const { pattern, count, position, caseSensitive } = task;

                for (let i = 0; i < count; i++) {
                    await this.generateVanityWallet({
                        pattern,
                        identifier: `vanity-${pattern}-${Date.now()}`,
                        position,
                        isCaseSensitive: caseSensitive,
                        metadata: { source: 'task-queue' }
                    });
                }

                this.taskQueue.shift(); // Remove completed task
            }
        } catch (error) {
            logApi.error('Task queue processing failed:', error);
        } finally {
            this.isProcessing = false;
        }
    }
} 