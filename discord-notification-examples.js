// discord-notification-examples.js
import discordNotificationService from './services/discordNotificationService.js';
import serviceEvents from './utils/service-suite/service-events.js';
import { SERVICE_EVENTS } from './utils/service-suite/service-events.js';

/**
 * This file demonstrates how to trigger Discord notifications
 * from different parts of your application.
 */

// First, make sure the Discord service is initialized
async function runExamples() {
  console.log('Initializing Discord notification service...');
  await discordNotificationService.init();
  
  // Example 1: Contest Created Notification
  console.log('\nExample 1: Emitting CONTEST_CREATED event');
  serviceEvents.emit(SERVICE_EVENTS.CONTEST_CREATED, {
    name: 'Weekend Showdown',
    contest_code: 'WKD123',
    start_time: new Date(Date.now() + 86400000).toISOString(), // Tomorrow
    end_time: new Date(Date.now() + 172800000).toISOString(),  // Day after tomorrow
    prize_pool: 500,
    entry_fee: 0.25,
    status: 'pending'
  });
  
  // Wait 2 seconds between notifications
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Example 2: System Alert Notification
  console.log('\nExample 2: Emitting SYSTEM_ALERT event');
  serviceEvents.emit(SERVICE_EVENTS.SYSTEM_ALERT, {
    title: 'Database Connectivity Issue',
    message: 'Intermittent connection issues detected with primary database.',
    fields: [
      { name: 'Severity', value: 'Medium', inline: true },
      { name: 'Affected Service', value: 'Market Data Service', inline: true },
      { name: 'Error Rate', value: '5.2%', inline: true },
      { name: 'First Detected', value: new Date().toLocaleString(), inline: true }
    ]
  });
  
  // Wait 2 seconds between notifications
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Example 3: Service Status Change Notification
  console.log('\nExample 3: Emitting SERVICE_STATUS_CHANGE event');
  serviceEvents.emit(SERVICE_EVENTS.SERVICE_STATUS_CHANGE, {
    serviceName: 'solana_engine_service',
    newStatus: 'down',
    details: 'Service is experiencing high latency with RPC providers.'
  });
  
  // Wait 2 seconds between notifications
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Example 4: Large Transaction Notification
  console.log('\nExample 4: Emitting LARGE_TRANSACTION event');
  serviceEvents.emit(SERVICE_EVENTS.LARGE_TRANSACTION, {
    type: 'DEPOSIT',
    amount: 1000,
    wallet_address: 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH',
    status: 'completed',
    contest_id: 42
  });
  
  // Wait 2 seconds between notifications
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Example 5: Direct use of the Discord service
  console.log('\nExample 5: Using discordNotificationService directly');
  try {
    const result = await discordNotificationService.sendTestNotification(
      'system',
      'This is a direct test of the Discord notification service'
    );
    
    console.log('Direct test result:', result ? 'Success' : 'Failed');
  } catch (error) {
    console.error('Error sending direct test:', error);
  }
  
  console.log('\nAll examples completed! Check your Discord channels for notifications.');
}

// Run the examples
runExamples().catch(error => {
  console.error('Error running examples:', error);
});