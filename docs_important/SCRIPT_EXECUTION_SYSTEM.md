# DegenDuel Script Execution System

This document provides comprehensive documentation for the DegenDuel Script Execution System, which allows authorized administrators to execute scripts remotely via API endpoints.

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
   - [Dev Login Endpoint](#dev-login-endpoint)
   - [Session Management](#session-management)
3. [Available Scripts](#available-scripts)
4. [Script Execution](#script-execution)
   - [API Endpoint](#api-endpoint)
   - [Script Categories](#script-categories)
   - [Parameter Passing](#parameter-passing)
5. [Test Client](#test-client)
6. [Known Issues](#known-issues)
7. [Troubleshooting](#troubleshooting)

## Overview

The Script Execution System provides a secure way for administrators to execute predefined scripts on the server. This system is designed to facilitate common administrative tasks without requiring direct server access.

Key features:
- Authentication via wallet address
- Execution of JavaScript and Shell scripts
- Parameter passing to scripts
- Support for scripts in multiple directories
- Secure execution environment
- Command-line test client

## Authentication

### Dev Login Endpoint

The system provides a development login endpoint that allows administrators to authenticate using their wallet address.

**Endpoint:** `/api/auth/dev-login`

**Method:** `POST`

**Request Body:**
```json
{
  "wallet_address": "YOUR_WALLET_ADDRESS",
  "secret": "BRANCH_MANAGER_LOGIN_SECRET"
}
```

**Response:**
- Success: HTTP 200 with session cookie
- Failure: HTTP 401 or 403 with error message

The `BRANCH_MANAGER_LOGIN_SECRET` is a shared secret that is defined in the `.env` file. The default value is `[REDACTED]`.

### Session Management

Upon successful authentication, the server issues a session cookie that is used for subsequent requests. This cookie is valid for 24 hours by default.

The session cookie can be:
1. Automatically saved by the browser
2. Manually saved using the test client's `set-cookie` command
3. Generated from a JWT token using the test client's `set-token` command

## Available Scripts

Scripts are stored in two directories:
- `scripts/shortcuts/` - Contains scripts optimized for API execution
- `scripts/` - Contains main scripts that can also be executed via API

Currently available scripts:
1. `manage-logs.js` - View and manage log files
2. `restart-app.sh` - Restart application services
3. `server-status.js` - Check server status
4. `test-client.js` - Test client for script execution

To list all available scripts, use the API endpoint `/api/admin/scripts` or the test client's `list` command.

## Script Execution

### API Endpoint

**Endpoint:** `/api/admin/scripts/{scriptName}`

**Method:** `POST`

**Headers:**
- `Cookie: session=YOUR_SESSION_COOKIE`
- `Content-Type: application/json`

**Request Body:**
```json
{
  "params": ["param1", "param2"],  // For shell scripts
  "category": "shortcuts"          // Optional: "shortcuts" (default) or "main"
}
```

or

```json
{
  "params": {
    "key1": "value1",
    "key2": "value2"
  },  // For JavaScript scripts
  "category": "main"  // Optional: Use "main" to execute from the main scripts directory
}
```

**Response:**
- Success: HTTP 200 with script output
- Failure: HTTP 400, 401, 404, or 500 with error message

### Script Categories

The system supports two script categories:

1. **shortcuts** (default) - Scripts in the `scripts/shortcuts/` directory
   - Optimized for API execution
   - Typically smaller and focused on specific tasks
   - Default when no category is specified

2. **main** - Scripts in the main `scripts/` directory
   - Full-featured scripts that can also be run directly on the server
   - May include more complex functionality
   - Must be explicitly specified using the `category` parameter

### Parameter Passing

- **Shell Scripts**: Parameters are passed as positional arguments
- **JavaScript Scripts**: Parameters are passed as named arguments

## Test Client

The system includes a command-line test client (`scripts/shortcuts/test-client.js`) that simplifies interaction with the script execution API.

### Installation

No installation is required. The test client is included in the codebase.

### Configuration

The test client uses the following environment variables:
- `API_URL` - The URL of the API server (default: `https://degenduel.me`)
- `SESSION_COOKIE` - Optional session cookie
- `BRANCH_MANAGER_LOGIN_SECRET` - Secret for dev login (default: `[REDACTED]`)

These can be defined in a `.env` file in the `scripts/shortcuts/` directory.

### Usage

```bash
# Login with wallet address
node scripts/shortcuts/test-client.js login YOUR_WALLET_ADDRESS

# List available scripts
node scripts/shortcuts/test-client.js list

# Run a script from shortcuts directory (default)
node scripts/shortcuts/test-client.js run script-name.js param1 param2

# Run a script from main scripts directory
node scripts/shortcuts/test-client.js run script-name.js --category main param1 param2

# Run a shell script
node scripts/shortcuts/test-client.js run restart-app.sh degenduel-api

# Set session cookie manually
node scripts/shortcuts/test-client.js set-cookie YOUR_SESSION_COOKIE

# Set session from JWT token
node scripts/shortcuts/test-client.js set-token YOUR_JWT_TOKEN
```

### Examples

```bash
# Login
node scripts/shortcuts/test-client.js login BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp

# Restart API server
node scripts/shortcuts/test-client.js run restart-app.sh degenduel-api

# Check server status
node scripts/shortcuts/test-client.js run server-status.js

# Run database tools from main scripts directory
node scripts/shortcuts/test-client.js run db-tools.sh --category main status

# Run database comparison with AI analysis
node scripts/shortcuts/test-client.js run db-tools.sh --category main compare --ai-analysis

# Manage logs
node scripts/shortcuts/test-client.js run manage-logs.js --check
```

## Frontend Integration Examples

### Listing Available Scripts

```javascript
// Function to list available scripts
async function listScripts() {
  try {
    const response = await fetch('/api/admin/scripts', {
      method: 'GET',
      credentials: 'include' // Include session cookies
    });
    
    if (!response.ok) {
      throw new Error(`Error: ${response.status}`);
    }
    
    const data = await response.json();
    return data.scripts;
  } catch (error) {
    console.error('Failed to list scripts:', error);
    return [];
  }
}

// Example usage
listScripts().then(scripts => {
  console.log('Available scripts:');
  scripts.forEach(script => {
    console.log(`- ${script.name} (${script.category})`);
  });
});
```

### Executing a Script

```javascript
// Function to execute a script
async function executeScript(scriptName, params = [], category = 'shortcuts') {
  try {
    const response = await fetch(`/api/admin/scripts/${scriptName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include', // Include session cookies
      body: JSON.stringify({
        params,
        category
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `Error: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error(`Failed to execute script ${scriptName}:`, error);
    throw error;
  }
}

// Example: Run database status check
executeScript('db-tools.sh', ['status'], 'main')
  .then(result => {
    console.log('Script output:', result.output);
  })
  .catch(error => {
    console.error('Script execution failed:', error);
  });

// Example: Run database comparison with AI analysis
executeScript('db-tools.sh', ['compare', '--ai-analysis'], 'main')
  .then(result => {
    console.log('Comparison report:', result.output);
  })
  .catch(error => {
    console.error('Comparison failed:', error);
  });
```

## Known Issues

### Restart Script Error Reporting

When running the `restart-app.sh` script, you may encounter an error message indicating that the script execution failed, even though the restart was successful. This is due to how the script execution API handles the response from the script.

**Error Message:**
```
Error: Script execution failed
Details: Command failed: bash /home/websites/degenduel/scripts/shortcuts/restart-app.sh degenduel-api
```

**What's Actually Happening:**
The script is successfully triggering the restart, but the API endpoint is reporting an error. This is because:

1. The server takes time to restart
2. During restart, the API may return 502 errors
3. The script execution API doesn't properly wait for the restart to complete

**Solution:**
Despite the error message, the restart is typically successful. You can verify this by:
1. Checking the server logs
2. Running the `server-status.js` script after a short delay
3. Observing that the application is functioning normally

## Troubleshooting

### Login Failures

If you encounter "Bad Gateway (502)" errors when trying to log in, it may be because:
1. The API server is restarting
2. There's a temporary network issue
3. The API server is under heavy load

**Solution:** Wait a few moments and try again. If the issue persists, check the server status.

### Session Expiration

If your requests start failing with 401 errors, your session may have expired. Sessions typically last for 24 hours.

**Solution:** Log in again to obtain a fresh session.

### Script Execution Failures

If script execution fails with an error, check:
1. That you're using the correct script name
2. That you're passing parameters in the correct format
3. That your session is still valid

For shell scripts that modify the server state (like `restart-app.sh`), be aware that the script may actually succeed even if an error is reported. Check the server status to confirm.

### API URL Configuration

If you're having trouble connecting to the API, ensure that the `API_URL` in your `.env` file is correct. The default is `https://degenduel.me`.

### Script Category Issues

If you encounter "Script not found" errors, check:
1. That you're using the correct script name
2. That you've specified the correct category (`shortcuts` or `main`)
3. That the script exists in the specified directory

Remember that the default category is `shortcuts`, so if you're trying to run a script from the main scripts directory, you must explicitly specify `category: "main"`.

---

This documentation is maintained by the DegenDuel development team. For questions or issues, please contact the team. 