# Model Service Architecture

This document provides a template for creating services that fully adhere to the BaseService architecture in DegenDuel.

## Key Components of a Proper Service

1. **BaseService Extension**: All services must extend BaseService
2. **Proper Initialization**: Call super.initialize() and register with ServiceManager
3. **Event Emission**: Use standardized service lifecycle events
4. **Circuit Breaker Pattern**: Properly implement circuit breaker functionality
5. **Error Handling**: Use this.handleError() consistently
6. **Singleton Database Access**: Use the Prisma singleton client
7. **Graceful Shutdown**: Implement stop() method with cleanup

## Model Service Template

```javascript
// services/example/exampleService.js

/**
 * Example Service
 * @module services/example/exampleService
 * 
 * This service demonstrates the proper architecture pattern
 * for services in the DegenDuel platform.
 * 
 * @author DegenDuel Team
 * @version 1.0.0
 * @created 2025-05-01
 */

// Service Suite
import { BaseService } from '../../utils/service-suite/base-service.js';
import { SERVICE_NAMES } from '../../utils/service-suite/service-constants.js';
import serviceManager from '../../utils/service-suite/service-manager.js';
import serviceEvents from '../../utils/service-suite/service-events.js';
import { ServiceError } from '../../utils/service-suite/service-error.js';
// Prisma
import prisma from '../../config/prisma.js';
// Logger
import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';

/**
 * Example Service Class
 * 
 * @class ExampleService
 * @extends {BaseService}
 */
class ExampleService extends BaseService {
  constructor() {
    // Always pass config with required fields to BaseService
    super({
      name: SERVICE_NAMES.EXAMPLE,
      description: 'Example Service',
      layer: 'DATA', // Use SERVICE_LAYERS constant in real code
      criticalLevel: 'medium',
      checkIntervalMs: 60 * 1000 // Check interval for operations
    });
    
    // Initialize state variables
    this.processingQueue = [];
    this.isProcessing = false;
    
    // Initialize statistics
    this.stats = {
      processedTotal: 0,
      processedSuccess: 0,
      processedFailed: 0,
      lastProcessedTime: null
    };
  }
  
  /**
   * Initialize the service
   * @returns {Promise<boolean>}
   */
  async initialize() {
    try {
      // ALWAYS call parent initialize first (CRITICAL)
      // This sets up circuit breaker, loads previous state, etc
      await super.initialize();
      
      // Register dependencies with service manager
      const dependencies = [SERVICE_NAMES.OTHER_SERVICE];
      serviceManager.register(this, dependencies);
      
      // Set up event listeners
      this.registerEventListeners();
      
      // Start processing worker or other background tasks
      this.startProcessingQueue();
      
      logApi.info(`${fancyColors.CYAN}[ExampleSvc]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} INITIALIZED ${fancyColors.RESET} Example service ready`);
      return true;
    } catch (error) {
      logApi.error(`${fancyColors.CYAN}[ExampleSvc]${fancyColors.RESET} ${fancyColors.RED}Initialization error:${fancyColors.RESET} ${error.message || 'Unknown error'}`);
      // ALWAYS call handleError for proper circuit breaker integration
      await this.handleError(error);
      return false;
    }
  }
  
  /**
   * Register event listeners
   */
  registerEventListeners() {
    // Listen for events from other services
    serviceEvents.on('other:event', async (data) => {
      try {
        await this.handleEvent(data);
      } catch (error) {
        // Always use handleError for error tracking
        await this.handleError(error);
      }
    });
    
    // Listen for system events
    serviceEvents.on('system:maintenance', async (data) => {
      // React to system events
      this.pauseProcessing = data.active;
    });
  }
  
  /**
   * Start the processing queue
   */
  startProcessingQueue() {
    // Set interval for regular processing
    this.processingInterval = setInterval(async () => {
      if (this.processingQueue.length > 0 && !this.isProcessing && !this.pauseProcessing) {
        await this.processNextItem();
      }
      
      // Emit heartbeat event for service monitoring
      this.emitHeartbeat();
    }, 5000);
    
    logApi.info(`${fancyColors.CYAN}[ExampleSvc]${fancyColors.RESET} Started processing queue`);
  }
  
  /**
   * Emit heartbeat event
   * Used for service monitoring
   */
  emitHeartbeat() {
    // Create safe stats object (no circular references)
    const safeStats = {
      processingQueue: this.processingQueue.length,
      processedTotal: this.stats.processedTotal,
      processedSuccess: this.stats.processedSuccess,
      processedFailed: this.stats.processedFailed,
      lastProcessedTime: this.stats.lastProcessedTime,
      isProcessing: this.isProcessing
    };
    
    // Emit service heartbeat event
    serviceEvents.emit('service:heartbeat', {
      name: this.name,
      timestamp: new Date().toISOString(),
      stats: safeStats
    });
  }
  
  /**
   * Process the next item in the queue
   * @returns {Promise<boolean>}
   */
  async processNextItem() {
    if (this.processingQueue.length === 0) return false;
    
    this.isProcessing = true;
    
    try {
      // Take item from queue
      const item = this.processingQueue.shift();
      
      // Process the item
      await this.processItem(item);
      
      // Update stats
      this.stats.processedTotal++;
      this.stats.processedSuccess++;
      this.stats.lastProcessedTime = new Date().toISOString();
      
      // Emit completion event
      serviceEvents.emit('example:processed', {
        id: item.id,
        processedAt: new Date().toISOString(),
        success: true
      });
      
      return true;
    } catch (error) {
      // Log error but with safe error details
      logApi.error(`${fancyColors.CYAN}[ExampleSvc]${fancyColors.RESET} ${fancyColors.RED}Processing error:${fancyColors.RESET} ${error.message || 'Unknown error'}`);
      logApi.debug(`[ExampleSvc] Error details: ${error.code || ''} ${error.name || ''}`);
      
      // Update stats
      this.stats.processedFailed++;
      
      // Handle error with circuit breaker integration
      await this.handleError(error);
      
      return false;
    } finally {
      // Always reset processing flag
      this.isProcessing = false;
    }
  }
  
  /**
   * Process a single item
   * @param {Object} item - The item to process
   * @returns {Promise<void>}
   */
  async processItem(item) {
    // Implement your business logic here
    // Use try/catch and handleError for all error handling
    
    // Example database operation using singleton Prisma
    const result = await prisma.example_items.update({
      where: { id: item.id },
      data: { 
        processed_at: new Date(),
        status: 'completed'
      }
    });
    
    return result;
  }
  
  /**
   * Add item to processing queue
   * @param {Object} item - The item to add
   * @returns {Promise<void>}
   */
  async enqueueItem(item) {
    try {
      // Validate item
      if (!item || !item.id) {
        throw new Error('Invalid item');
      }
      
      // Add to queue
      this.processingQueue.push(item);
      
      logApi.debug(`${fancyColors.CYAN}[ExampleSvc]${fancyColors.RESET} Enqueued item ${item.id}`);
      
      // Start processing if not already running
      if (!this.isProcessing && !this.pauseProcessing) {
        this.processNextItem();
      }
    } catch (error) {
      // Always use handleError for proper error tracking
      logApi.error(`${fancyColors.CYAN}[ExampleSvc]${fancyColors.RESET} ${fancyColors.RED}Error enqueueing item:${fancyColors.RESET} ${error.message || 'Unknown error'}`);
      await this.handleError(error);
    }
  }
  
  /**
   * Perform health check
   * @returns {Promise<boolean>}
   */
  async checkHealth() {
    try {
      // Basic database connectivity check
      await prisma.$queryRaw`SELECT 1 as health_check`;
      
      // Additional health checks
      // ...
      
      return true;
    } catch (error) {
      logApi.error(`${fancyColors.CYAN}[ExampleSvc]${fancyColors.RESET} ${fancyColors.RED}Health check failed:${fancyColors.RESET} ${error.message || 'Unknown error'}`);
      await this.handleError(error);
      return false;
    }
  }
  
  /**
   * Perform service operation - called by BaseService
   * @returns {Promise<boolean>}
   */
  async performOperation() {
    try {
      // Check health
      const isHealthy = await this.checkHealth();
      
      if (!isHealthy) {
        throw new Error('Service health check failed');
      }
      
      // Run periodic maintenance
      await this.performMaintenance();
      
      return true;
    } catch (error) {
      logApi.error(`${fancyColors.CYAN}[ExampleSvc]${fancyColors.RESET} ${fancyColors.RED}Operation failed:${fancyColors.RESET} ${error.message || 'Unknown error'}`);
      await this.handleError(error);
      return false;
    }
  }
  
  /**
   * Perform periodic maintenance
   * @returns {Promise<void>}
   */
  async performMaintenance() {
    // Implement maintenance operations
    // For example, clean up old data, update statistics, etc.
  }
  
  /**
   * Handle error with circuit breaker
   * @param {Error} error - The error to handle
   * @returns {Promise<void>}
   */
  async handleError(error) {
    // Call parent handleError for circuit breaker integration
    await super.handleError(error);
    
    // Emit service error event
    serviceEvents.emit('service:error', {
      name: this.name,
      error: {
        message: error.message,
        code: error.code,
        stack: error.stack
      },
      timestamp: new Date().toISOString()
    });
  }
  
  /**
   * Stop the service
   * @returns {Promise<boolean>}
   */
  async stop() {
    try {
      // Call parent stop first
      await super.stop();
      
      // Clean up resources
      if (this.processingInterval) {
        clearInterval(this.processingInterval);
        this.processingInterval = null;
      }
      
      // Remove event listeners
      serviceEvents.removeAllListeners('other:event');
      serviceEvents.removeAllListeners('system:maintenance');
      
      // Emit service stopped event
      serviceEvents.emit('service:stopped', {
        name: this.name,
        timestamp: new Date().toISOString()
      });
      
      logApi.info(`${fancyColors.CYAN}[ExampleSvc]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} STOPPED ${fancyColors.RESET}`);
      return true;
    } catch (error) {
      logApi.error(`${fancyColors.CYAN}[ExampleSvc]${fancyColors.RESET} ${fancyColors.RED}Error stopping service:${fancyColors.RESET} ${error.message || 'Unknown error'}`);
      return false;
    }
  }
}

// Create and export singleton instance
const exampleService = new ExampleService();
export default exampleService;
```

## Key Architecture Components

### 1. Initialization Flow
- Call `super.initialize()` first to inherit BaseService functionality
- Register with ServiceManager with explicit dependencies
- Set up event listeners
- Start background processing if needed

### 2. Event System Integration
- Listen for events from other services
- Emit standardized lifecycle events
- Use try/catch and handleError in event handlers

### 3. Error Handling Pattern
- Always use `this.handleError(error)` for errors
- Extract error details for logging to prevent circular references
- Respect the circuit breaker pattern

### 4. Database Access
- Use the singleton Prisma client
- Handle database errors with proper error management
- Use async/await for all database operations

### 5. Resource Management
- Clean up resources in stop() method
- Remove event listeners when stopping
- Clear timers and intervals

### 6. Health Monitoring
- Implement health checks
- Emit heartbeat events
- Track and report service statistics

### 7. Circuit Breaker Integration
- Use handleError for circuit breaker state management
- Respect circuit breaker open state in operations
- Report service status changes

## Common Mistakes to Avoid

1. ❌ Creating new PrismaClient instances instead of using the singleton
2. ❌ Forgetting to call `super.initialize()` in initialize method
3. ❌ Not calling `super.stop()` in stop method
4. ❌ Passing full error objects to logApi (circular reference risk)
5. ❌ Not registering with serviceManager properly
6. ❌ Missing handleError calls in catch blocks
7. ❌ Not cleaning up resources in stop method
8. ❌ Not respecting circuit breaker open state