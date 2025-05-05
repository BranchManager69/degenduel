# Cloudflare Management Tool

A utility script to help manage Cloudflare settings for dduel.me and degenduel.me.

## Features

- Fix redirect loops by configuring SSL and redirect rules
- Compare settings between domains
- Copy settings from one domain to another
- Interactive CLI interface

## Usage

```bash
# Run the Cloudflare Manager utility
npm run cf
```

## Key Functions

1. **Fix Redirect Loop**: Addresses issues with domains stuck in redirect loops by:
   - Setting SSL mode to "flexible" to stop HTTPS redirect loops
   - Disabling "Always Use HTTPS" setting that may conflict with NGINX
   - Removing page rules that cause circular redirects

2. **Compare Domains**: Shows differences between dduel.me and degenduel.me:
   - SSL configurations
   - Page rules
   - Other relevant settings

3. **Copy Settings**: Can copy entire configurations from one domain to another

## Authentication

The first time you run the tool, it will prompt you to enter your Cloudflare credentials:

- **API Token** (recommended): A scoped access token created in Cloudflare dashboard
- **API Key + Email**: Your global API key and account email

Credentials are stored in a local configuration file for subsequent use.

## Required Permissions

For the API Token authentication method, ensure your token has these permissions:

- Zone > Zone > Read
- Zone > Zone Settings > Edit
- Zone > Page Rules > Edit

## Troubleshooting SSL Redirect Loops

Common causes of redirect loops:

1. **SSL Mode Mismatch**: When Cloudflare's SSL mode doesn't match your origin server
   - Cloudflare set to "Full" but server redirects HTTP to HTTPS
   - Cloudflare set to "Flexible" but server expects HTTPS

2. **Always Use HTTPS**: Can cause loops when:
   - Your NGINX is also configured to force HTTPS
   - You're using "Flexible" SSL mode

3. **Page Rules**: Conflicting rules that create circular redirects

## Security Notes

- The configuration file stores your API credentials
- Keep this file secure and do not commit it to version control
- Consider using environment variables instead for production use