# DegenDuel Service Standardization Guide

## Overview

This document defines the standard structure and patterns for all services in the DegenDuel platform. Following these standards ensures consistency, reliability, and maintainability across the service architecture.

## Service Implementation Pattern

All services must extend `BaseService` and implement the required methods according to these standards.

### Required Method: `performOperation()`

Every service must implement this method with the following structure:

```javascript
async performOperation() {
    const startTime = Date.now();
    
    try {
        // 1. Check dependency health
        await this.checkDependencyHealth();
        
        // 2. Fetch required data for operation
        const dataToProcess = await this.getOperationData();
        
        // 3. Process primary operation (domain-specific logic)
        const results = await this.processDomainLogic(dataToProcess);
        
        // 4. Update statistics
        this.updateServiceStats(results);
        
        // 5. Update performance metrics
        const duration = Date.now() - startTime;
        this.updatePerformanceMetrics(duration);
        
        // 6. Record success with service manager
        await this.recordSuccess();
        
        // 7. Return structured result
        return {
            duration,
            results,
            stats: this.getDomainStats()
        };
    } catch (error) {
        // Let base service handle circuit breaker logic
        throw error;
    }
}
```

## Standard Components Explanation

### 1. Dependency Health Check

```javascript
async checkDependencyHealth() {
    const dependencies = this.config.dependencies || [];
    if (dependencies.length === 0) return { allHealthy: true };
    
    const results = {};
    let allHealthy = true;
    
    for (const dependency of dependencies) {
        const health = await serviceManager.checkServiceHealth(dependency);
        results[dependency] = health.isHealthy;
        allHealthy = allHealthy && health.isHealthy;
        
        // Update dependency stats
        this.domainStats.dependencies[dependency] = {
            status: health.isHealthy ? 'healthy' : 'unhealthy',
            lastCheck: new Date().toISOString()
        };
        
        // Critical dependencies cause early failure
        if (!health.isHealthy && this.isCriticalDependency(dependency)) {
            logApi.warn(`Critical dependency ${dependency} is unhealthy`);
            throw new ServiceError(`Critical dependency ${dependency} is unhealthy`);
        }
    }
    
    return { allHealthy, results };
}
```

### 2. Fetch Operation Data

Implement service-specific data retrieval:

```javascript
async getOperationData() {
    // Domain-specific implementation
    // Example for a contest service:
    const activeContests = await prisma.contests.findMany({
        where: { status: 'ACTIVE' }
    });
    
    return activeContests;
}
```

### 3. Process Domain Logic

Main business logic for the service:

```javascript
async processDomainLogic(data) {
    // Service-specific implementation
    const results = [];
    
    // Process in batches if needed
    if (data.length > this.config.batchSize) {
        return this.processBatches(data, this.config.batchSize, this.processItem.bind(this));
    }
    
    // Direct processing for small datasets
    for (const item of data) {
        try {
            const result = await this.processItem(item);
            results.push({ status: 'success', item, result });
        } catch (error) {
            results.push({ status: 'failed', item, error: error.message });
        }
    }
    
    return results;
}
```

### 4. Update Service Statistics

```javascript
updateServiceStats(results) {
    // Common stats updates
    this.domainStats.operations.total++;
    this.domainStats.operations.successful += results.filter(r => r.status === 'success').length;
    this.domainStats.operations.failed += results.filter(r => r.status === 'failed').length;
    
    // Domain-specific stats
    // Example for wallet service:
    this.domainStats.wallets.processed += results.length;
    this.domainStats.wallets.balanceUpdated += results.filter(r => r.result?.balanceUpdated).length;
}
```

### 5. Update Performance Metrics

```javascript
updatePerformanceMetrics(duration) {
    this.domainStats.performance.lastOperationTimeMs = duration;
    this.domainStats.performance.averageOperationTimeMs = 
        (this.domainStats.performance.averageOperationTimeMs * this.domainStats.operations.total + duration) / 
        (this.domainStats.operations.total + 1);
}
```

## Standard Statistics Structure

Every service should maintain domain-specific statistics with this base structure:

```javascript
this.domainStats = {
    // Common sections
    operations: {
        total: 0,
        successful: 0,
        failed: 0
    },
    performance: {
        averageOperationTimeMs: 0,
        lastOperationTimeMs: 0
    },
    dependencies: {
        // Each dependency status
        // dependencyName: { status: 'healthy', lastCheck: timestamp }
    },
    
    // Domain-specific sections (examples)
    wallets: { /* wallet-specific metrics */ },
    contests: { /* contest-specific metrics */ },
    tokens: { /* token-specific metrics */ }
};
```

## Additional Patterns

### Batch Processing

```javascript
async processBatches(items, batchSize = 10, processor) {
    const batches = [];
    for (let i = 0; i < items.length; i += batchSize) {
        batches.push(items.slice(i, i + batchSize));
    }
    
    const results = [];
    for (const batch of batches) {
        const batchResults = await Promise.all(batch.map(processor));
        results.push(...batchResults);
    }
    
    return results;
}
```

### Error Handling

```javascript
// Handle domain-specific errors
try {
    const result = await this.processItem(item);
    return { status: 'success', item, result };
} catch (error) {
    // Track specific error types if needed
    if (error.code === 'NETWORK_ERROR') {
        this.domainStats.errors.network++;
    }
    
    logApi.error(`Processing error for ${item.id}:`, error);
    return { status: 'failed', item, error: error.message };
}
```

### ResourceManagement

Ensure proper cleanup in the `stop()` method:

```javascript
async stop() {
    await super.stop();
    
    // Clear timeouts
    for (const timeout of this.activeTimeouts) {
        clearTimeout(timeout);
    }
    this.activeTimeouts.clear();
    
    // Clear intervals
    if (this.maintenanceInterval) {
        clearInterval(this.maintenanceInterval);
    }
    
    // Other cleanup
    this.cache.clear();
    
    logApi.info(`${this.name} stopped and resources cleaned up`);
}
```

## Backward Compatibility

To maintain compatibility with existing database settings:

1. Always load existing settings during initialization
2. Merge settings carefully, preserving existing structure 
3. Maintain the same keys in system_settings table
4. Add new fields rather than changing existing ones
5. Handle missing fields gracefully

## Minimal Viable Implementation

If a service doesn't need complex operations, a minimal implementation should:

```javascript
async performOperation() {
    const startTime = Date.now();
    
    try {
        // Implement basic health check
        const healthCheck = await this.performHealthCheck();
        
        // Update performance metrics
        const duration = Date.now() - startTime;
        this.domainStats.performance.lastOperationTimeMs = duration;
        this.domainStats.performance.averageOperationTimeMs = 
            (this.domainStats.performance.averageOperationTimeMs * this.domainStats.operations.total + duration) / 
            (this.domainStats.operations.total + 1);
        
        // Record success
        await this.recordSuccess();
        
        return {
            duration,
            status: 'healthy',
            checks: healthCheck
        };
    } catch (error) {
        throw error;
    }
}

async performHealthCheck() {
    // Implement minimal health verification
    // For example, verify database connectivity
    const check = await prisma.$queryRaw`SELECT 1 as health`;
    return { database: check[0].health === 1 };
}
```

## Implementation Checklist

- [ ] Service extends BaseService
- [ ] Service implements performOperation()
- [ ] Service maintains standardized statistics
- [ ] Service checks dependencies
- [ ] Service tracks performance metrics
- [ ] Service properly handles cleanup in stop()
- [ ] Service integrates with ServiceManager
- [ ] Service handles errors appropriately