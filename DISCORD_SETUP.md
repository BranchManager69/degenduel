# DegenDuel Discord Integration

This guide explains how to use the Discord webhook integration in the DegenDuel platform.

## Setup

1. **Create Discord Webhooks**:
   - In your Discord server, right-click on a channel → Edit Channel → Integrations → Webhooks
   - Create webhooks for different notification types (or use the same one for all)
   - Copy the webhook URLs

2. **Configure Environment Variables**:
   Add these to your .env file:
   ```
   DISCORD_WEBHOOK_SYSTEM=https://discord.com/api/webhooks/your-webhook-url
   DISCORD_WEBHOOK_ALERTS=https://discord.com/api/webhooks/your-webhook-url
   DISCORD_WEBHOOK_CONTESTS=https://discord.com/api/webhooks/your-webhook-url
   DISCORD_WEBHOOK_TRANSACTIONS=https://discord.com/api/webhooks/your-webhook-url
   ```

3. **Restart Your Server**:
   ```bash
   pm2 restart all   # Or however you restart your application
   ```

## Using Discord Webhooks

### Option 1: Direct Use

You can directly use the Discord webhook utility for simple one-off notifications:

```javascript
import DiscordWebhook from './utils/discord-webhook.js';

// Create webhook client
const webhook = new DiscordWebhook('https://discord.com/api/webhooks/your-webhook-url');

// Send a simple message
await webhook.sendMessage('Hello from DegenDuel!');

// Send a rich embed
const embed = webhook.createInfoEmbed(
  'System Status Update',
  'Weekly maintenance completed successfully.'
);
embed.fields = [
  { name: 'Uptime', value: '99.9%', inline: true },
  { name: 'Services', value: 'All operational', inline: true }
];
await webhook.sendEmbed(embed);
```

### Option 2: Using the Discord Service

For automated notifications throughout your application, use the Discord notification service:

```javascript
import serviceEvents from './utils/service-suite/service-events.js';
import { SERVICE_EVENTS } from './utils/service-suite/service-events.js';

// Trigger a notification when a contest is created
serviceEvents.emit(SERVICE_EVENTS.CONTEST_CREATED, {
  name: 'Weekend Tournament',
  contest_code: 'WKD123',
  start_time: new Date().toISOString(),
  prize_pool: 500,
  entry_fee: 0.25,
  status: 'pending'
});

// Trigger a system alert
serviceEvents.emit(SERVICE_EVENTS.SYSTEM_ALERT, {
  title: 'Database Warning',
  message: 'Database CPU usage is above 80%',
  fields: [
    { name: 'Current Usage', value: '83%', inline: true },
    { name: 'Severity', value: 'Medium', inline: true }
  ]
});
```

### Option 3: Admin Interface

Administrators can use the built-in admin interface to manage Discord webhooks:

- **View Webhooks**: `/api/admin/discord-webhooks`
- **Test Webhooks**: `/api/admin/discord-webhooks/test`
- **Trigger Events**: `/api/admin/discord-webhooks/trigger-event`

## Notification Types

The system supports these notification types:

1. **Simple Messages**: Plain text messages
2. **Success Embeds**: Green-colored notifications for successful operations
3. **Error Embeds**: Red-colored notifications for errors and issues
4. **Info Embeds**: Blue-colored notifications for general information

## Event Types

The following events trigger Discord notifications:

- `CONTEST_CREATED`: When new contests are created
- `SYSTEM_ALERT`: For system alerts and warnings
- `SERVICE_STATUS_CHANGE`: When services change status (down/up)
- `LARGE_TRANSACTION`: For significant transaction events

## Testing

Use the test scripts to verify your webhook configuration:

```bash
# Basic test
node test-discord-webhook.js

# More detailed examples
node discord-simple-test.js
```

## Troubleshooting

- **No Notifications**: Check that environment variables are set and Discord permissions are correct
- **Rate Limiting**: Discord has rate limits. Don't send too many messages too quickly
- **Webhook URL Expired**: If webhooks stop working, recreate them in Discord

## Additional Configuration

For more advanced configuration, you can modify:

- `/services/discordNotificationService.js`: Change event handling behavior
- `/utils/discord-webhook.js`: Modify the webhook client
- `/utils/service-suite/service-events.js`: Add new event types