# Discord Integration for DegenDuel

This directory contains services that integrate with Discord, including:

1. **Discord Interactive Service** - Provides rich, interactive notifications for contests, token price movements, and other platform events.
2. **Discord OAuth Authentication** - Allows users to authenticate with Discord and link their Discord accounts to DegenDuel wallets.

## Service Architecture

### Discord Interactive Service

The Discord Interactive Service handles:

- Contest notifications (creation, start, completion)
- Token price movement notifications (pumps)
- Interactive buttons for contest/token actions
- Rich embedded messages with platform branding

### Discord OAuth Authentication

Discord OAuth Authentication is implemented in the main authentication system (`routes/auth.js`) and provides:

- Discord account login and linking
- Profile image synchronization
- Authentication status detection
- Session management

## Configuration

### Environment Variables

| Variable | Description |
|----------|-------------|
| `DISCORD_BOT_TOKEN` | The bot token for the Discord Interactive Service |
| `DISCORD_CLIENT_ID` | OAuth application client ID |
| `DISCORD_CLIENT_SECRET` | OAuth application client secret |
| `DISCORD_CALLBACK_URI` | Production callback URI for OAuth flow |
| `DISCORD_CALLBACK_URI_DEVELOPMENT` | Development callback URI for OAuth flow |
| `DISCORD_CONTESTS_CHANNEL_ID` | Channel ID for contest notifications |
| `DISCORD_TRADES_CHANNEL_ID` | Channel ID for trade/token notifications |
| `DISCORD_ANNOUNCEMENTS_CHANNEL_ID` | Channel ID for general announcements |

### Discord Application Setup

1. Create a Discord application at [Discord Developer Portal](https://discord.com/developers/applications)
2. Configure OAuth2 settings:
   - Add redirect URIs for production and development
   - Get the Client ID and Client Secret
3. Set up a bot user and get the bot token
4. Add the bot to your server with the following permissions:
   - Send Messages
   - Embed Links
   - Attach Files
   - Read Message History
   - Add Reactions
   - Use External Emojis

## Usage

### Discord OAuth Testing

Test the Discord OAuth integration with:

```bash
npm run test-discord-oauth
```

This will open a browser window to test both the OAuth configuration and the authentication flow.

### Manual Integration Testing

To test the Discord Interactive Service manually:

```bash
node tests/test-discord-interactive.js
```

This tests all notification types to verify proper formatting and interactive functionality.

## API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/auth/discord/check-config` | GET | Check Discord OAuth configuration |
| `/api/auth/discord/login` | GET | Start Discord OAuth flow |
| `/api/auth/discord/callback` | GET | Handle Discord OAuth callback |
| `/api/auth/discord/link` | POST | Link Discord account to connected wallet |
| `/api/auth/status` | GET | Check auth status including Discord connection |

## Event System

The Discord Interactive Service listens for the following events:

- `contest:created` - New contest creation
- `contest:started` - Contest start
- `contest:completed` - Contest end
- `token:pump` - Token price movements

## Best Practices

1. **Security**: Always verify state parameters in OAuth flow
2. **Error Handling**: Provide user-friendly error messages
3. **Rate Limiting**: Be mindful of Discord's rate limits for messages
4. **UX**: Keep interactive buttons focused on high-value actions

## Troubleshooting

### Common Issues

- **Bot not sending messages**: Check channel permissions
- **OAuth flow failures**: Verify callback URIs and credentials
- **Missing notifications**: Ensure the service is properly initialized
- **Rate limiting**: Space out notifications to avoid Discord rate limits

### Debugging

Check logs with:

```bash
tail -n 150 /home/branchmanager/.pm2/logs/degenduel-api-out.log | grep "Discord"
```

or:

```bash
tail -n 150 /home/branchmanager/.pm2/logs/degenduel-api-error.log | grep "Discord"
```