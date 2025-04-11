// discord-simple-test.js
import DiscordWebhook from './utils/discord-webhook.js';

// Use webhook URL from environment variable
const webhookUrl = process.env.DISCORD_WEBHOOK_SYSTEM || 
  'https://discord.com/api/webhooks/1359823067701969028/KKfTlXB995Ipze21OmG-Lk2v0FAmXj5ufNJlnIWwUlOoshSplqW6HYbNSfYqqDhv7dnS';

async function runTests() {
  // Create webhook client
  const webhook = new DiscordWebhook(webhookUrl);
  
  console.log('Discord Webhook Testing');
  console.log('-----------------------');
  console.log(`Using webhook URL: ${webhookUrl.substring(0, 30)}...`);
  
  try {
    // Test 1: Simple message
    console.log('\n1. Sending simple message...');
    const simpleResult = await webhook.sendMessage('🎲 Hello from DegenDuel! This is a simple message test.');
    console.log(`Result: ${simpleResult ? 'Success ✅' : 'Failed ❌'}`);
    
    // Wait to avoid rate limiting
    await new Promise(r => setTimeout(r, 1500));
    
    // Test 2: Success notification
    console.log('\n2. Sending success notification...');
    const successEmbed = webhook.createSuccessEmbed(
      '✅ System Update Completed',
      'The scheduled system maintenance has been completed successfully.'
    );
    successEmbed.fields = [
      { name: 'Downtime', value: '5 minutes', inline: true },
      { name: 'Services Updated', value: '3', inline: true },
      { name: 'Next Maintenance', value: 'April 15th', inline: true }
    ];
    const successResult = await webhook.sendEmbed(successEmbed);
    console.log(`Result: ${successResult ? 'Success ✅' : 'Failed ❌'}`);
    
    // Wait to avoid rate limiting
    await new Promise(r => setTimeout(r, 1500));
    
    // Test 3: Error notification
    console.log('\n3. Sending error notification...');
    const errorEmbed = webhook.createErrorEmbed(
      '❌ Database Connection Error',
      'Unable to connect to the primary database. Failover has been activated.'
    );
    errorEmbed.fields = [
      { name: 'Error Code', value: 'CONN_REFUSED', inline: true },
      { name: 'Time', value: new Date().toLocaleTimeString(), inline: true },
      { name: 'Status', value: 'Failover Active', inline: true }
    ];
    const errorResult = await webhook.sendEmbed(errorEmbed);
    console.log(`Result: ${errorResult ? 'Success ✅' : 'Failed ❌'}`);
    
    // Wait to avoid rate limiting
    await new Promise(r => setTimeout(r, 1500));
    
    // Test 4: Info notification with contest data
    console.log('\n4. Sending contest notification...');
    const contestEmbed = webhook.createInfoEmbed(
      '🎮 New Contest Created: Weekend Warrior',
      'A new contest has been created and is accepting participants!'
    );
    contestEmbed.fields = [
      { name: 'Start Time', value: 'Tomorrow, 12:00 PM UTC', inline: true },
      { name: 'Prize Pool', value: '500 SOL', inline: true },
      { name: 'Entry Fee', value: '0.5 SOL', inline: true },
      { name: 'Max Participants', value: '100', inline: true },
      { name: 'Current Status', value: 'Registration Open', inline: true }
    ];
    contestEmbed.thumbnail = {
      url: 'https://cdn.icon-icons.com/icons2/1364/PNG/512/trophy_89528.png'
    };
    const contestResult = await webhook.sendEmbed(contestEmbed);
    console.log(`Result: ${contestResult ? 'Success ✅' : 'Failed ❌'}`);
    
    console.log('\nAll tests completed! Check your Discord channel.');
    
  } catch (error) {
    console.error('Error during testing:', error);
  }
}

runTests().catch(error => {
  console.error('Error running tests:', error);
});