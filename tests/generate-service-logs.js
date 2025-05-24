// Generate sample logs for all services to test AI analysis

import { logApi } from '../utils/logger-suite/logger.js';
import prisma from '../config/prisma.js';
import { SERVICE_NAMES } from '../utils/service-suite/service-constants.js';

// Create a set of test log messages for different log levels
const testLogMessages = {
  info: [
    "Service initialized successfully",
    "Operation completed in {duration}ms",
    "Successfully processed {count} items",
    "Connected to external service",
    "Cache hit rate: {percent}%",
    "Scheduled task started",
    "Configuration loaded successfully",
    "User {userId} performed {action}",
    "Database connection established",
    "Heartbeat check passed"
  ],
  warn: [
    "Slow operation detected ({duration}ms)",
    "Retrying operation (attempt {attempt})",
    "Resource usage high: {resourceType} at {percent}%",
    "Deprecated method called: {method}",
    "Connection pool nearly exhausted ({available} available)",
    "Cache miss for key: {key}",
    "Response time degraded",
    "Token refresh delayed",
    "Database query took {duration}ms",
    "Possible duplicate transaction detected"
  ],
  error: [
    "Operation failed: {errorMessage}",
    "Connection to external service failed",
    "Database query error: {errorMessage}",
    "Unexpected response from API: {status}",
    "Transaction processing failed for {entityId}",
    "Rate limit exceeded",
    "Authentication failed for request",
    "Invalid configuration: {parameter}",
    "Resource not found: {resource}",
    "Service dependency unavailable: {dependency}"
  ],
  debug: [
    "Request parameters: {params}",
    "Response payload: {payload}",
    "Processing step {step} completed",
    "Cache state updated",
    "Function {function} called with args: {args}",
    "Event emitted: {event}",
    "Internal state transition: {from} -> {to}",
    "Performance metric: {metric} = {value}",
    "Trace ID: {traceId}",
    "Data validation passed for {entity}"
  ]
};

// Create a set of test events for different services
const testEvents = {
  'solana_engine_service': ['rpc_connection', 'transaction_submit', 'account_lookup', 'token_metadata_fetch'],
  'admin_wallet_service': ['fund_transfer', 'balance_check', 'key_rotation', 'wallet_create'],
  'contest_wallet_service': ['prize_payout', 'entry_fee_collect', 'wallet_provision', 'balance_reconcile'],
  'market_data_service': ['price_update', 'volume_check', 'liquidity_calculation', 'token_rank_update'],
      'token_refresh_scheduler': ['refresh_job_scheduled', 'priority_recalculation', 'batch_optimization'],
  'default': ['system_check', 'task_scheduled', 'operation_complete', 'heartbeat']
};

// Create a set of test related entities for different services
const testEntities = {
  'solana_engine_service': ['wallet_SgV3W6sck5uVdqV56zkYUJ6X6GGsH5AZQzBSXKiHbpz3', 'token_SoLEGH66r1TJppcy1u7QgdcFFj6vYMnsjr2zPXNfmLV'],
  'admin_wallet_service': ['admin_wallet_1', 'admin_wallet_2', 'treasury_wallet'],
  'contest_wallet_service': ['contest_123', 'contest_456', 'contest_789'],
  'market_data_service': ['token_solana', 'token_jupiter', 'token_duel'],
  'default': ['general', 'system', 'service', 'user_123']
};

// Random sample from array
function sample(array) {
  return array[Math.floor(Math.random() * array.length)];
}

// Random integer between min and max
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Replace placeholders in messages
function fillTemplate(message) {
  return message
    .replace('{duration}', randomInt(10, 5000))
    .replace('{count}', randomInt(1, 1000))
    .replace('{percent}', randomInt(1, 100))
    .replace('{userId}', `user_${randomInt(1000, 9999)}`)
    .replace('{action}', sample(['login', 'trade', 'withdraw', 'deposit']))
    .replace('{resourceType}', sample(['CPU', 'memory', 'disk', 'network']))
    .replace('{available}', randomInt(1, 10))
    .replace('{key}', `cache_key_${randomInt(1000, 9999)}`)
    .replace('{errorMessage}', sample(['Timeout', 'Connection refused', 'Invalid response', 'Not found', 'Unexpected error']))
    .replace('{status}', sample(['404', '500', '403', '429', '400']))
    .replace('{entityId}', `entity_${randomInt(1000, 9999)}`)
    .replace('{parameter}', sample(['timeout', 'endpoint', 'credentials', 'retry_count']))
    .replace('{resource}', sample(['file', 'record', 'account', 'transaction']))
    .replace('{dependency}', sample(['database', 'auth_service', 'cache', 'rpc_endpoint']))
    .replace('{params}', JSON.stringify({ id: randomInt(1, 1000), type: sample(['user', 'token', 'transaction']) }))
    .replace('{payload}', JSON.stringify({ status: 'success', data: { id: randomInt(1, 1000) } }))
    .replace('{step}', randomInt(1, 5))
    .replace('{function}', sample(['processData', 'validateInput', 'computeMetrics', 'fetchResults']))
    .replace('{args}', JSON.stringify([randomInt(1, 100), sample(['a', 'b', 'c'])]))
    .replace('{event}', sample(['data_processed', 'user_action', 'system_event', 'timer_expired']))
    .replace('{from}', sample(['idle', 'processing', 'waiting', 'connected']))
    .replace('{to}', sample(['processing', 'completed', 'failed', 'disconnected']))
    .replace('{metric}', sample(['latency', 'throughput', 'error_rate', 'success_rate']))
    .replace('{value}', randomInt(1, 1000))
    .replace('{traceId}', `trace-${Math.random().toString(36).substring(2, 15)}`)
    .replace('{entity}', sample(['user', 'transaction', 'token', 'wallet']));
}

// Generate random metadata for a service
function generateMetadata(service) {
  return {
    instanceId: `${service.replace('_service', '')}-${randomInt(1, 3)}`,
    hostname: sample(['host-1', 'host-2', 'host-3']),
    pid: randomInt(1000, 9999),
    memory: {
      heapUsed: randomInt(50, 200) * 1024 * 1024,
      heapTotal: 512 * 1024 * 1024
    }
  };
}

// Generate service logs for all services
async function generateServiceLogs() {
  console.log('Generating service logs for all services...');
  
  // Get all service names
  const serviceNames = Object.values(SERVICE_NAMES);
  
  // Count existing logs
  const existingCount = await prisma.service_logs.count();
  console.log(`Existing service logs: ${existingCount}`);
  
  let totalGenerated = 0;
  
  // Generate logs for each service
  for (const service of serviceNames) {
    // Number of logs to generate per service
    const logsToGenerate = randomInt(5, 15);
    console.log(`Generating ${logsToGenerate} logs for ${service}...`);
    
    for (let i = 0; i < logsToGenerate; i++) {
      // Select random log level with weighted distribution
      const level = sample([
        'info', 'info', 'info', 'info', 'info',  // 50% chance for info
        'warn', 'warn',                          // 20% chance for warn
        'error',                                 // 10% chance for error
        'debug', 'debug'                         // 20% chance for debug
      ]);
      
      // Select message and events specific to this service if available
      const messages = testLogMessages[level];
      const events = testEvents[service] || testEvents['default'];
      const entities = testEntities[service] || testEntities['default'];
      
      // Generate random message from template
      const message = fillTemplate(sample(messages));
      
      // Generate event type
      const eventType = sample(events);
      
      // Generate related entity
      const relatedEntity = sample(entities);
      
      // Generate random duration for performance metrics
      const durationMs = level === 'warn' ? randomInt(500, 2000) : 
                        level === 'error' ? randomInt(2000, 5000) : 
                        randomInt(10, 500);
      
      // Generate random details
      const details = {
        operation: eventType,
        success: level !== 'error',
        test: true,
        timestamp: new Date().toISOString()
      };
      
      // Write to service logs using the API
      await logApi.serviceLog.write(
        service,
        level,
        message,
        details,
        generateMetadata(service),
        eventType,
        durationMs,
        relatedEntity
      );
      
      totalGenerated++;
    }
  }
  
  // Count the logs again after generation
  const newCount = await prisma.service_logs.count();
  
  console.log(`Generated ${totalGenerated} service logs.`);
  console.log(`Total service logs in database: ${newCount} (${newCount - existingCount} new)`);
}

// Run the function
generateServiceLogs()
  .then(() => {
    console.log('Service log generation completed successfully.');
    
    // Run a quick test of the AI service log analyzer
    console.log('\nNow checking if AI analyzer will have enough logs...');
    
    return prisma.$queryRaw`
      SELECT service, COUNT(*) as count 
      FROM service_logs 
      GROUP BY service 
      ORDER BY count DESC
    `;
  })
  .then(results => {
    console.log('\nLog counts by service:');
    results.forEach(row => {
      console.log(`${row.service}: ${row.count} logs` + 
                 (row.count >= 5 ? ' ✅' : ' ❌') + 
                 (row.count >= 5 ? '' : ' (less than minimum 5 logs required)'));
    });
    
    process.exit(0);
  })
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });