// /utils/solana-suite/vanity-pool.js

import { Keypair } from '@solana/web3.js';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { cpus } from 'os';
import { WalletGenerator } from './wallet-generator.js';
import { fileURLToPath } from 'url';
import path from 'path';
import os from 'os';

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

export class VanityPool {
    static maxWorkers = Math.max(1, cpus().length - 1); // Leave one core free
    static activeWorkers = new Map();
    static taskQueue = [];
    static isProcessing = false;
    
    // CPU utilization management
    static targetUtilization = 0.80; // 80% target CPU utilization
    static utilizationCheckInterval = 5000; // Check every 5 seconds
    static utilizationWindow = 30000; // 30 second window for averaging
    static utilizationHistory = [];
    static utilizationChecker = null;

    // Dynamic worker management
    static getOptimalWorkerCount() {
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

    static getCurrentCPUUtilization() {
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

    static startUtilizationMonitoring() {
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

    static stopUtilizationMonitoring() {
        if (this.utilizationChecker) {
            clearInterval(this.utilizationChecker);
            this.utilizationChecker = null;
        }
    }

    static throttleWorkers() {
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

    static validatePattern(pattern) {
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

    static estimateTime(pattern) {
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

    static async generateVanityWallet(options) {
        const {
            pattern,
            identifier,
            isCaseSensitive = false,
            position = 'start',
            timeout = 300000,
            metadata = {}
        } = options;

        try {
            this.validatePattern(pattern);
            this.startUtilizationMonitoring();

            const workerPromise = new Promise((resolve, reject) => {
                const workers = [];
                let completed = false;

                // Use optimal worker count instead of max
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

                            resolve(wallet);
                        }
                    });

                    worker.on('error', (err) => {
                        if (!completed) {
                            reject(new VanityGeneratorError(
                                'Worker error',
                                'WORKER_ERROR',
                                { error: err.message }
                            ));
                        }
                    });
                }
            });

            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => {
                    reject(new VanityGeneratorError(
                        'Vanity address generation timed out',
                        'GENERATION_TIMEOUT',
                        { pattern, timeout }
                    ));
                }, timeout);
            });

            const result = await Promise.race([workerPromise, timeoutPromise]);
            
            // Only stop monitoring if no other generations are active
            if (this.activeWorkers.size === 0) {
                this.stopUtilizationMonitoring();
            }

            return result;

        } catch (error) {
            // Cleanup on error
            if (this.activeWorkers.size === 0) {
                this.stopUtilizationMonitoring();
            }

            throw new VanityGeneratorError(
                'Failed to generate vanity wallet',
                'GENERATION_FAILED',
                {
                    pattern,
                    identifier,
                    originalError: error.message
                }
            );
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