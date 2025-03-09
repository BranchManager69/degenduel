# DegenDuel Development Environment Access Control

This document explains how the development environment access control system works and how to set it up.

## Overview

The development environment (`dev.degenduel.me`) is restricted to authorized users only. This is to prevent unauthorized access to the development environment while still allowing the development team to access it.

The access control system uses multiple authentication methods to determine if a user is authorized to access the development environment:

1. **IP-based authentication**: If the user's IP address is in the allowed list, they are granted access.
2. **Wallet-based authentication**: If the user is logged in with an authorized wallet address, they are granted access.
3. **Token-based authentication**: If the user provides a valid access token, they are granted access.

## Setup

To set up the development environment access control system, follow these steps:

1. Run the setup script:

```bash
node scripts/setup-dev-access.js
```

This script will:
- Generate a secure token for the `BRANCH_MANAGER_ACCESS_SECRET` environment variable
- Prompt you for your wallet address
- Detect your current IP address
- Update the `.env` file with these values

2. Restart the server to apply the changes:

```bash
pm2 restart degenduel
```

## Access Methods

### Method 1: IP Address Authentication

If your current IP address is in the allowed list, you'll automatically have access to the development environment. This is the simplest method, but it only works from devices with the allowed IP address.

### Method 2: Wallet Authentication

If you're logged in with an authorized wallet address, you'll automatically have access to the development environment. This works from any device as long as you're logged in.

### Method 3: Access Token

You can use a special access token to access the development environment from any device. There are two ways to use the access token:

1. **HTTP Header**: Add the `X-Dev-Access-Token` header to your requests with the token as the value.
2. **Browser Script**: Use the provided browser script to add the token to your requests.

To use the browser script:
- Open the dev subdomain in your browser
- Open the browser console (F12 or Ctrl+Shift+I)
- Copy and paste the contents of `public/dev-access.js` into the console
- Press Enter to run the script
- Enter your token when prompted

## Files

The development environment access control system consists of the following files:

- `middleware/devAccessMiddleware.js`: The main middleware that restricts access to the development environment.
- `public/dev-access-denied.html`: The HTML page shown to unauthorized users.
- `public/dev-access-guide.html`: A guide explaining how to access the development environment.
- `public/dev-access.js`: A client-side script to help access the development environment from any device.
- `scripts/setup-dev-access.js`: A script to help set up the development environment access control system.
- `scripts/generate-dev-token.js`: A script to generate a secure token for the `BRANCH_MANAGER_ACCESS_SECRET` environment variable.

## Environment Variables

The development environment access control system uses the following environment variables:

- `BRANCH_MANAGER_ACCESS_SECRET`: A secure token used for token-based authentication.
- `BRANCH_MANAGER_WALLET_ADDRESS`: Your wallet address, used for wallet-based authentication.
- `BRANCH_MANAGER_IP_ADDRESS`: Your IP address, used for IP-based authentication.

These variables are set by the setup script and stored in the `.env` file.

## Troubleshooting

If you're having trouble accessing the development environment, try the following:

1. Make sure you're using the correct access method.
2. Check that your IP address or wallet address is in the allowed list.
3. Make sure you're using the correct access token.
4. Clear your browser cache and cookies.
5. Try using a different browser.
6. Contact the system administrator for assistance.

## Security Considerations

The development environment access control system is designed to be secure, but it's not foolproof. Here are some security considerations:

- IP-based authentication is the least secure method, as IP addresses can be spoofed.
- Wallet-based authentication is more secure, but it requires you to be logged in.
- Token-based authentication is the most secure method, but it requires you to set up the token on each device.

For maximum security, use a combination of all three methods. 