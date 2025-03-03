# DegenDuel Device Authentication System

This document provides comprehensive documentation for the DegenDuel Device Authentication System, which allows restricting API access to specific authorized devices.

## Table of Contents

1. [Overview](#overview)
2. [Configuration](#configuration)
3. [How It Works](#how-it-works)
4. [API Endpoints](#api-endpoints)
5. [Client Implementation](#client-implementation)
6. [Security Considerations](#security-considerations)
7. [Troubleshooting](#troubleshooting)

## Overview

The Device Authentication System provides an additional layer of security by restricting API access to specific authorized devices. This is particularly useful for mobile applications where you want to ensure that only the official app can access your API.

Key features:
- Device ID verification during authentication
- Management of authorized devices
- Automatic authorization of first device
- Limit on maximum number of devices per user
- Device-specific endpoint restrictions

## Configuration

The device authentication system can be configured through environment variables:

```
# Enable/disable device authentication
DEVICE_AUTH_ENABLED=true

# Maximum number of devices per user
MAX_DEVICES_PER_USER=5

# Automatically authorize the first device
AUTO_AUTHORIZE_FIRST_DEVICE=true
```

These settings can be modified in the `.env` file or through environment variables.

## How It Works

### Device Registration

1. When a user logs in, they provide their device ID along with their authentication credentials.
2. If this is the user's first device and `AUTO_AUTHORIZE_FIRST_DEVICE` is enabled, the device is automatically authorized.
3. Otherwise, the device is recorded but marked as unauthorized until an admin approves it.

### Authentication Flow

1. User authenticates with their wallet as usual, but includes a device ID in the request.
2. The server verifies the wallet signature and checks if the device is authorized.
3. If the device is authorized, the authentication succeeds and a session token is issued.
4. If the device is not authorized, the authentication still succeeds, but certain API endpoints will be restricted.

### API Access Control

1. Endpoints that require device authentication use the `requireDeviceAuth` middleware.
2. This middleware checks if the device ID in the request header matches an authorized device for the user.
3. If the device is not authorized, the request is rejected with a 403 error.

## API Endpoints

### Device Management Endpoints

#### List Authorized Devices

**Endpoint:** `GET /api/devices`

**Description:** Get a list of all authorized devices for the current user.

**Response:**
```json
{
  "devices": [
    {
      "id": 1,
      "wallet_address": "USER_WALLET_ADDRESS",
      "device_id": "DEVICE_ID",
      "device_name": "iPhone 13",
      "device_type": "iOS",
      "last_used": "2023-06-01T12:00:00Z",
      "created_at": "2023-05-01T12:00:00Z",
      "is_active": true,
      "is_current_device": true
    }
  ],
  "current_device_id": "DEVICE_ID",
  "max_devices": 5
}
```

#### Update Device

**Endpoint:** `PUT /api/devices/:id`

**Description:** Update a device's name or active status.

**Request Body:**
```json
{
  "device_name": "My iPhone",
  "is_active": true
}
```

**Response:**
```json
{
  "device": {
    "id": 1,
    "wallet_address": "USER_WALLET_ADDRESS",
    "device_id": "DEVICE_ID",
    "device_name": "My iPhone",
    "device_type": "iOS",
    "last_used": "2023-06-01T12:00:00Z",
    "created_at": "2023-05-01T12:00:00Z",
    "is_active": true
  },
  "is_current_device": true
}
```

#### Delete Device

**Endpoint:** `DELETE /api/devices/:id`

**Description:** Delete a device from the authorized devices list.

**Response:**
```json
{
  "success": true,
  "message": "Device deleted successfully"
}
```

#### Authorize Device

**Endpoint:** `POST /api/devices/authorize`

**Description:** Authorize a new device for the current user.

**Request Body:**
```json
{
  "device_id": "NEW_DEVICE_ID",
  "device_name": "iPad Pro",
  "device_type": "iOS"
}
```

**Response:**
```json
{
  "device": {
    "id": 2,
    "wallet_address": "USER_WALLET_ADDRESS",
    "device_id": "NEW_DEVICE_ID",
    "device_name": "iPad Pro",
    "device_type": "iOS",
    "last_used": "2023-06-01T12:00:00Z",
    "created_at": "2023-06-01T12:00:00Z",
    "is_active": true
  },
  "message": "Device authorized successfully"
}
```

### Authentication Endpoint

The existing wallet verification endpoint has been updated to handle device IDs:

**Endpoint:** `POST /api/auth/verify-wallet`

**Request Body:**
```json
{
  "wallet": "WALLET_ADDRESS",
  "signature": [...],
  "message": "MESSAGE_WITH_NONCE",
  "device_id": "DEVICE_ID",
  "device_name": "iPhone 13",
  "device_type": "iOS"
}
```

**Response:**
```json
{
  "verified": true,
  "user": {
    "wallet_address": "WALLET_ADDRESS",
    "role": "user",
    "nickname": "User123"
  },
  "device": {
    "device_authorized": true,
    "device_id": "DEVICE_ID",
    "device_name": "iPhone 13",
    "requires_authorization": false
  }
}
```

## Client Implementation

### iOS Implementation

For iOS applications, you can use the device's UUID as the device ID:

```swift
import UIKit

func getDeviceId() -> String {
    return UIDevice.current.identifierForVendor?.uuidString ?? ""
}

func login(wallet: String, signature: [UInt8], message: String) {
    let deviceId = getDeviceId()
    let deviceName = UIDevice.current.name
    let deviceType = "iOS"
    
    let parameters: [String: Any] = [
        "wallet": wallet,
        "signature": signature,
        "message": message,
        "device_id": deviceId,
        "device_name": deviceName,
        "device_type": deviceType
    ]
    
    // Make API request with parameters
}

func apiRequest(endpoint: String, method: String, body: [String: Any]? = nil) {
    var request = URLRequest(url: URL(string: "https://api.degenduel.me" + endpoint)!)
    request.httpMethod = method
    
    // Add device ID to headers
    request.addValue(getDeviceId(), forHTTPHeaderField: "X-Device-ID")
    
    // Add other headers and body
    // ...
    
    // Make the request
}
```

### Android Implementation

For Android applications, you can use the device's Android ID as the device ID:

```kotlin
import android.content.Context
import android.provider.Settings

fun getDeviceId(context: Context): String {
    return Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
}

fun login(context: Context, wallet: String, signature: ByteArray, message: String) {
    val deviceId = getDeviceId(context)
    val deviceName = android.os.Build.MODEL
    val deviceType = "Android"
    
    val parameters = mapOf(
        "wallet" to wallet,
        "signature" to signature,
        "message" to message,
        "device_id" to deviceId,
        "device_name" to deviceName,
        "device_type" to deviceType
    )
    
    // Make API request with parameters
}

fun apiRequest(context: Context, endpoint: String, method: String, body: Map<String, Any>? = null) {
    val request = Request.Builder()
        .url("https://api.degenduel.me$endpoint")
        .method(method, body?.let { /* convert to RequestBody */ })
        
    // Add device ID to headers
    request.addHeader("X-Device-ID", getDeviceId(context))
    
    // Add other headers
    // ...
    
    // Make the request
}
```

## Security Considerations

### Device ID Generation

The device ID should be:
- Unique to each device
- Persistent across app reinstalls (if possible)
- Not easily spoofable

For iOS, `UIDevice.identifierForVendor` is a good choice as it's unique to the device for your app.
For Android, `Settings.Secure.ANDROID_ID` is a reasonable choice, though it can change on factory reset.

### Protecting Against Spoofing

While device IDs can be spoofed, the system provides an additional layer of security. To further enhance security:

1. Use HTTPS for all API requests
2. Implement certificate pinning in your mobile app
3. Consider additional factors like IP address and user behavior

### Rate Limiting

Implement rate limiting on authentication endpoints to prevent brute force attacks trying to guess valid device IDs.

## Troubleshooting

### Device Not Authorized

If you receive a "Device not authorized" error:

1. Check if the device ID is being correctly sent in the `X-Device-ID` header
2. Verify that the device has been authorized for the user
3. Check if the maximum number of devices has been reached

### Device ID Not Persisting

If the device ID changes between app launches:

1. For iOS, ensure the app ID hasn't changed (this can reset the vendor identifier)
2. For Android, check if the device has been factory reset
3. Consider implementing a fallback mechanism using secure storage

### Migration Considerations

When enabling device authentication on an existing system:

1. Consider a grace period where unauthorized devices can still access most endpoints
2. Implement a notification system to inform users about the new security feature
3. Provide clear instructions on how to authorize new devices

---

This documentation is maintained by the DegenDuel development team. For questions or issues, please contact the team. 