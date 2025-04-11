// test-discord-webhook.js
import fetch from 'node-fetch';

const webhookUrl = process.env.DISCORD_WEBHOOK_SYSTEM;

async function testWebhook() {
  if (!webhookUrl) {
    console.error('No webhook URL provided. Set DISCORD_WEBHOOK_SYSTEM environment variable.');
    process.exit(1);
  }

  console.log('Testing Discord webhook...');
  
  try {
    // Simple message
    const simpleResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: '🎮 Test message from DegenDuel platform!'
      }),
    });
    
    if (!simpleResponse.ok) {
      throw new Error(`Simple message failed: ${simpleResponse.status} ${await simpleResponse.text()}`);
    }
    
    console.log('Simple message sent successfully!');
    
    // Wait 1 second between messages to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Rich embed
    const embedResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        embeds: [{
          title: '📊 DegenDuel System Test',
          description: 'This is a test notification with rich formatting.',
          color: 0x00FFFF, // Cyan color
          fields: [
            {
              name: 'Environment',
              value: 'Development',
              inline: true
            },
            {
              name: 'Status',
              value: '✅ Online',
              inline: true
            },
            {
              name: 'Timestamp',
              value: new Date().toLocaleString(),
              inline: true
            }
          ],
          footer: {
            text: 'DegenDuel Platform'
          }
        }]
      }),
    });
    
    if (!embedResponse.ok) {
      throw new Error(`Embed message failed: ${embedResponse.status} ${await embedResponse.text()}`);
    }
    
    console.log('Embed message sent successfully!');
    
    console.log('All tests passed! Check your Discord channel.');
    
  } catch (error) {
    console.error('Error sending webhook message:', error);
    process.exit(1);
  }
}

testWebhook();