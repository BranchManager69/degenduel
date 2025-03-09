# User Notification WebSocket Implementation Guide

## Overview

The User Notification WebSocket provides real-time notification delivery for various notification types including level-ups, achievements, contest invitations, and system announcements. This WebSocket follows the v69 architecture with enhanced security, performance, and features.

## Connection Details

- **WebSocket URL**: `/api/v69/ws/notifications`
- **Authentication**: Required (except for public system announcements)
- **Protocol**: WebSocket with JWT authentication

## Authentication

Before connecting to the WebSocket, the client must obtain a WebSocket token:

1. **Get WebSocket Token**:
   ```javascript
   async function getWebSocketToken() {
     try {
       const response = await fetch('/api/auth/token');
       if (!response.ok) throw new Error('Failed to get token');
       
       const data = await response.json();
       return {
         token: data.token,
         expiresAt: Date.now() + (data.expiresIn * 1000)
       };
     } catch (error) {
       console.error('Error getting WebSocket token:', error);
       throw error;
     }
   }
   ```

2. **Connect with Token**:
   ```javascript
   async function connectToNotificationWebSocket() {
     // Get token first
     const { token } = await getWebSocketToken();
     
     // Connect with token
     const socket = new WebSocket(`wss://degenduel.me/api/v69/ws/notifications?token=${token}`);
     
     // Handle connection events
     socket.onopen = () => console.log('Notification WebSocket connected');
     socket.onerror = (error) => console.error('Notification WebSocket error:', error);
     
     return socket;
   }
   ```

## Message Types

### Server-to-Client Messages

| Type | Description | Example |
|------|-------------|---------|
| `notification` | Single notification | `{ type: "notification", id: "12345", notificationType: "LEVEL_UP", data: { level: 5 }, timestamp: "2023-01-01T00:00:00Z" }` |
| `notification_batch` | Multiple notifications | `{ type: "notification_batch", data: [...], count: 5, hasMore: false }` |
| `unread_count` | Number of unread notifications | `{ type: "unread_count", count: 3 }` |
| `read_confirmed` | Confirmation of read status update | `{ type: "read_confirmed", id: "12345" }` |

### Client-to-Server Messages

| Type | Description | Example |
|------|-------------|---------|
| `mark_read` | Mark a notification as read | `{ type: "mark_read", id: "12345" }` |
| `mark_all_read` | Mark all notifications as read | `{ type: "mark_all_read" }` |
| `get_unread` | Request unread notifications | `{ type: "get_unread" }` |
| `get_notifications` | Request notifications with filters | `{ type: "get_notifications", limit: 20, offset: 0, types: ["LEVEL_UP", "ACHIEVEMENT_UNLOCK"], onlyUnread: true }` |

## Notification Types

The WebSocket supports these notification types:

- `LEVEL_UP` - User leveled up
- `ACHIEVEMENT_UNLOCK` - User unlocked an achievement
- `CONTEST_INVITE` - User invited to a contest
- `SYSTEM_ANNOUNCEMENT` - System-wide announcement
- `PROFILE_UPDATE` - User profile update

## Example Implementation

```javascript
class NotificationManager {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectTimeout = null;
    this.messageHandlers = new Map();
    this.unreadCount = 0;
    this.notifications = [];
  }
  
  // Register message handlers
  onMessage(type, handler) {
    this.messageHandlers.set(type, handler);
    return this;
  }
  
  // Connect to WebSocket
  async connect() {
    try {
      // Get WebSocket token
      const response = await fetch('/api/auth/token');
      if (!response.ok) throw new Error('Failed to get token');
      
      const data = await response.json();
      const token = data.token;
      
      // Connect to WebSocket
      this.socket = new WebSocket(`wss://degenduel.me/api/v69/ws/notifications?token=${token}`);
      
      // Set up event handlers
      this.socket.onopen = this._handleOpen.bind(this);
      this.socket.onclose = this._handleClose.bind(this);
      this.socket.onerror = this._handleError.bind(this);
      this.socket.onmessage = this._handleMessage.bind(this);
      
      return true;
    } catch (error) {
      console.error('Error connecting to notification WebSocket:', error);
      this._scheduleReconnect();
      return false;
    }
  }
  
  // Handle WebSocket open
  _handleOpen(event) {
    console.log('Notification WebSocket connected');
    this.isConnected = true;
    this.reconnectAttempts = 0;
    
    // Dispatch connection event
    this._dispatchEvent('connected', { timestamp: new Date() });
  }
  
  // Handle WebSocket close
  _handleClose(event) {
    this.isConnected = false;
    console.log(`Notification WebSocket closed: ${event.code} ${event.reason}`);
    
    // Schedule reconnect unless closed intentionally
    if (event.code !== 1000) {
      this._scheduleReconnect();
    }
    
    // Dispatch disconnection event
    this._dispatchEvent('disconnected', { 
      code: event.code,
      reason: event.reason,
      timestamp: new Date()
    });
  }
  
  // Handle WebSocket error
  _handleError(error) {
    console.error('Notification WebSocket error:', error);
    
    // Dispatch error event
    this._dispatchEvent('error', { 
      error,
      timestamp: new Date()
    });
  }
  
  // Handle WebSocket message
  _handleMessage(event) {
    try {
      const message = JSON.parse(event.data);
      console.debug('Notification message received:', message);
      
      switch (message.type) {
        case 'notification':
          this._handleNotification(message);
          break;
          
        case 'notification_batch':
          this._handleNotificationBatch(message);
          break;
          
        case 'unread_count':
          this._handleUnreadCount(message);
          break;
          
        case 'read_confirmed':
          this._handleReadConfirmed(message);
          break;
          
        case 'welcome':
          // Handle welcome message
          console.log('Connected to notification system with capabilities:', message.capabilities);
          break;
          
        default:
          console.warn('Unknown message type:', message.type);
          break;
      }
      
      // Call registered handler if exists
      const handler = this.messageHandlers.get(message.type);
      if (handler) {
        handler(message);
      }
      
      // Dispatch message event
      this._dispatchEvent('message', { message });
    } catch (error) {
      console.error('Error processing notification message:', error);
    }
  }
  
  // Handle single notification
  _handleNotification(message) {
    // Add to notifications list
    this.notifications.unshift({
      id: message.id,
      type: message.notificationType,
      data: message.data,
      timestamp: message.timestamp,
      read: false
    });
    
    // Increase unread count
    this.unreadCount++;
    
    // Dispatch notification event
    this._dispatchEvent('notification', {
      notification: {
        id: message.id,
        type: message.notificationType,
        data: message.data,
        timestamp: message.timestamp
      }
    });
  }
  
  // Handle batch of notifications
  _handleNotificationBatch(message) {
    // Add notifications to list
    for (const notification of message.data) {
      this.notifications.unshift({
        id: notification.id,
        type: notification.type,
        data: notification.data,
        timestamp: notification.timestamp,
        read: notification.read || false
      });
    }
    
    // Dispatch batch event
    this._dispatchEvent('notification_batch', {
      notifications: message.data,
      count: message.count,
      hasMore: message.hasMore
    });
  }
  
  // Handle unread count update
  _handleUnreadCount(message) {
    this.unreadCount = message.count;
    
    // Dispatch unread count event
    this._dispatchEvent('unread_count', { count: message.count });
  }
  
  // Handle read confirmation
  _handleReadConfirmed(message) {
    // Update notification in list
    const index = this.notifications.findIndex(n => n.id === message.id);
    if (index !== -1) {
      this.notifications[index].read = true;
    }
    
    // Dispatch read confirmed event
    this._dispatchEvent('read_confirmed', { id: message.id });
  }
  
  // Schedule reconnection
  _scheduleReconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Maximum reconnection attempts reached');
      this._dispatchEvent('reconnect_failed', { 
        attempts: this.reconnectAttempts
      });
      return;
    }
    
    // Exponential backoff
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
    
    console.log(`Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);
    
    this.reconnectTimeout = setTimeout(() => {
      console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      this.connect();
    }, delay);
    
    // Dispatch reconnect event
    this._dispatchEvent('reconnecting', { 
      attempt: this.reconnectAttempts,
      delay
    });
  }
  
  // Dispatch custom event
  _dispatchEvent(name, detail) {
    const event = new CustomEvent(`notification:${name}`, { detail });
    window.dispatchEvent(event);
  }
  
  // API: Mark notification as read
  markAsRead(id) {
    if (!this.isConnected) return false;
    
    this.socket.send(JSON.stringify({
      type: 'mark_read',
      id
    }));
    
    return true;
  }
  
  // API: Mark all notifications as read
  markAllAsRead() {
    if (!this.isConnected) return false;
    
    this.socket.send(JSON.stringify({
      type: 'mark_all_read'
    }));
    
    return true;
  }
  
  // API: Request unread notifications
  getUnreadNotifications() {
    if (!this.isConnected) return false;
    
    this.socket.send(JSON.stringify({
      type: 'get_unread'
    }));
    
    return true;
  }
  
  // API: Request notifications with filters
  getNotifications({ limit = 20, offset = 0, types = null, onlyUnread = false } = {}) {
    if (!this.isConnected) return false;
    
    this.socket.send(JSON.stringify({
      type: 'get_notifications',
      limit,
      offset,
      types,
      onlyUnread
    }));
    
    return true;
  }
  
  // API: Close connection
  disconnect() {
    if (!this.socket) return;
    
    this.socket.close(1000, 'Client disconnected');
    this.socket = null;
    this.isConnected = false;
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }
  
  // API: Get unread count
  getUnreadCount() {
    return this.unreadCount;
  }
  
  // API: Get cached notifications
  getCachedNotifications() {
    return [...this.notifications];
  }
}

// Usage example
const notificationManager = new NotificationManager();

// Register event handlers
window.addEventListener('notification:notification', (e) => {
  const { notification } = e.detail;
  // Show notification to user
  showNotificationToast(notification);
});

window.addEventListener('notification:unread_count', (e) => {
  const { count } = e.detail;
  // Update notification badge
  updateNotificationBadge(count);
});

// Connect
notificationManager.connect();

// Notification UI components can interact with the manager
document.getElementById('mark-all-read').addEventListener('click', () => {
  notificationManager.markAllAsRead();
});

// Individual notification handling
function handleNotificationClick(id) {
  notificationManager.markAsRead(id);
}
```

## Integration with UI Components

### Notification Badge

```javascript
function updateNotificationBadge(count) {
  const badge = document.getElementById('notification-badge');
  
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : count.toString();
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}
```

### Notification List

```javascript
function renderNotificationList(notifications) {
  const container = document.getElementById('notification-list');
  container.innerHTML = '';
  
  if (notifications.length === 0) {
    container.innerHTML = '<div class="empty-state">No notifications</div>';
    return;
  }
  
  for (const notification of notifications) {
    const notificationElement = createNotificationElement(notification);
    container.appendChild(notificationElement);
  }
}

function createNotificationElement(notification) {
  const element = document.createElement('div');
  element.className = `notification ${notification.read ? 'read' : 'unread'}`;
  element.dataset.id = notification.id;
  
  // Format based on notification type
  let content = '';
  let icon = '';
  
  switch (notification.type) {
    case 'LEVEL_UP':
      icon = '🏆';
      content = `You've reached level ${notification.data.level}!`;
      break;
      
    case 'ACHIEVEMENT_UNLOCK':
      icon = '🎯';
      content = `Achievement unlocked: ${notification.data.name}`;
      break;
      
    case 'CONTEST_INVITE':
      icon = '🎮';
      content = `You've been invited to join the contest: ${notification.data.contestName}`;
      break;
      
    case 'SYSTEM_ANNOUNCEMENT':
      icon = '📢';
      content = notification.data.message;
      break;
      
    case 'PROFILE_UPDATE':
      icon = '👤';
      content = `Your profile has been updated: ${notification.data.message}`;
      break;
      
    default:
      icon = '🔔';
      content = 'You have a new notification';
  }
  
  // Format timestamp
  const timestamp = new Date(notification.timestamp);
  const timeFormatted = timestamp.toLocaleTimeString();
  const dateFormatted = timestamp.toLocaleDateString();
  
  element.innerHTML = `
    <div class="notification-icon">${icon}</div>
    <div class="notification-content">
      <div class="notification-message">${content}</div>
      <div class="notification-time">${timeFormatted} · ${dateFormatted}</div>
    </div>
    <div class="notification-actions">
      <button class="mark-read-btn" data-id="${notification.id}">
        ${notification.read ? 'Read' : 'Mark as read'}
      </button>
    </div>
  `;
  
  // Add event listeners
  element.querySelector('.mark-read-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    const id = e.target.dataset.id;
    notificationManager.markAsRead(id);
  });
  
  // Click on notification
  element.addEventListener('click', () => {
    handleNotificationClick(notification);
  });
  
  return element;
}

function handleNotificationClick(notification) {
  // Mark as read
  notificationManager.markAsRead(notification.id);
  
  // Navigate or perform action based on notification type
  switch (notification.type) {
    case 'LEVEL_UP':
      // Navigate to profile page
      window.location.href = '/profile';
      break;
      
    case 'ACHIEVEMENT_UNLOCK':
      // Navigate to achievements page
      window.location.href = '/achievements';
      break;
      
    case 'CONTEST_INVITE':
      // Navigate to contest page
      window.location.href = `/contests/${notification.data.contestId}`;
      break;
      
    case 'SYSTEM_ANNOUNCEMENT':
      // Just mark as read
      break;
      
    case 'PROFILE_UPDATE':
      // Navigate to profile page
      window.location.href = '/profile';
      break;
  }
}
```

### Notification Toast

```javascript
function showNotificationToast(notification) {
  // Create toast element
  const toast = document.createElement('div');
  toast.className = 'notification-toast';
  
  // Format based on notification type
  let content = '';
  let icon = '';
  
  switch (notification.type) {
    case 'LEVEL_UP':
      icon = '🏆';
      content = `You've reached level ${notification.data.level}!`;
      break;
      
    case 'ACHIEVEMENT_UNLOCK':
      icon = '🎯';
      content = `Achievement unlocked: ${notification.data.name}`;
      break;
      
    case 'CONTEST_INVITE':
      icon = '🎮';
      content = `You've been invited to join the contest: ${notification.data.contestName}`;
      break;
      
    case 'SYSTEM_ANNOUNCEMENT':
      icon = '📢';
      content = notification.data.message;
      break;
      
    case 'PROFILE_UPDATE':
      icon = '👤';
      content = `Your profile has been updated: ${notification.data.message}`;
      break;
      
    default:
      icon = '🔔';
      content = 'You have a new notification';
  }
  
  toast.innerHTML = `
    <div class="toast-icon">${icon}</div>
    <div class="toast-content">${content}</div>
    <button class="toast-close">×</button>
  `;
  
  // Add to container
  const container = document.getElementById('toast-container') || createToastContainer();
  container.appendChild(toast);
  
  // Add event listeners
  toast.querySelector('.toast-close').addEventListener('click', () => {
    toast.classList.add('toast-exiting');
    setTimeout(() => {
      toast.remove();
    }, 300);
  });
  
  // Auto-remove after 5 seconds
  setTimeout(() => {
    toast.classList.add('toast-exiting');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 5000);
  
  // Add entrance animation
  setTimeout(() => {
    toast.classList.add('toast-visible');
  }, 10);
  
  function createToastContainer() {
    const container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
    return container;
  }
}
```

## CSS Styling

```css
/* Notification Badge */
.notification-badge {
  display: inline-block;
  background-color: #ff3b30;
  color: white;
  border-radius: 50%;
  min-width: 20px;
  height: 20px;
  line-height: 20px;
  text-align: center;
  font-size: 12px;
  font-weight: bold;
  position: absolute;
  top: -5px;
  right: -5px;
}

.notification-badge.hidden {
  display: none;
}

/* Notification List */
.notification-list {
  max-height: 400px;
  overflow-y: auto;
  background-color: #fff;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.notification {
  display: flex;
  padding: 12px 16px;
  border-bottom: 1px solid #f0f0f0;
  cursor: pointer;
  transition: background-color 0.2s;
}

.notification:hover {
  background-color: #f7f7f7;
}

.notification.unread {
  background-color: #f0f7ff;
}

.notification-icon {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background-color: #f0f0f0;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 12px;
  font-size: 16px;
}

.notification-content {
  flex-grow: 1;
}

.notification-message {
  font-size: 14px;
  margin-bottom: 4px;
}

.notification-time {
  font-size: 12px;
  color: #666;
}

.notification-actions {
  flex-shrink: 0;
  margin-left: 12px;
}

.mark-read-btn {
  font-size: 12px;
  color: #0070f3;
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
}

.mark-read-btn:hover {
  background-color: #e6f2ff;
}

/* Empty state */
.empty-state {
  padding: 24px;
  text-align: center;
  color: #666;
  font-size: 14px;
}

/* Toast */
#toast-container {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.notification-toast {
  display: flex;
  align-items: center;
  background-color: #fff;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 12px 16px;
  width: 300px;
  opacity: 0;
  transform: translateX(100%);
  transition: all 0.3s ease;
}

.notification-toast.toast-visible {
  opacity: 1;
  transform: translateX(0);
}

.notification-toast.toast-exiting {
  opacity: 0;
  transform: translateX(100%);
}

.toast-icon {
  flex-shrink: 0;
  margin-right: 12px;
  font-size: 20px;
}

.toast-content {
  flex-grow: 1;
  font-size: 14px;
}

.toast-close {
  flex-shrink: 0;
  background: none;
  border: none;
  font-size: 18px;
  cursor: pointer;
  color: #999;
  padding: 0;
  margin-left: 8px;
}

.toast-close:hover {
  color: #333;
}
```

## Best Practices

1. **Token Refresh**: Implement token refresh logic to maintain the WebSocket connection without interruptions

2. **Reconnection Strategy**: Use exponential backoff for reconnections to avoid overwhelming the server

3. **Offline Support**: Cache notifications locally for offline access and sync when reconnected

4. **Error Handling**: Provide meaningful error messages and recovery mechanisms

5. **Notification Grouping**: Group similar notifications to avoid cluttering the UI

6. **Performance**: Limit the number of notifications displayed at once to maintain performance

7. **Accessibility**: Ensure notifications are accessible with proper ARIA attributes and keyboard navigation

## Testing

To test the WebSocket connection, you can use the provided test client:

```bash
node websocket/v69/test-client.js notifications
```



## UPDATE:

### The User Notification WebSocket system has recently been implemented.

Testing is underway. Progress will be reported shortly.

In the mean time, the backend developers did have this note attached to their untested deliverable:

```
● For future enhancements to the notification system, here are recommended next steps:

  1. Analytics WebSocket Implementation
    - Create the v69 Analytics WebSocket to provide real-time platform metrics
    - Focus on admin dashboards with real-time user activity and system performance data
  2. Notification Management UI for Admins
    - Build an admin interface to create and manage system announcements
    - Add broadcast targeting capabilities (by user segment, activity level, etc.)
  3. Enhanced Notification Types
    - Add support for rich media notifications (images, interactive elements)
    - Implement priority levels for notifications (urgent, standard, low)
  4. User Preferences
    - Allow users to configure which notifications they receive
    - Add notification categories and filtering options
  5. Mobile Push Integration
    - Connect the notification system to mobile push notifications
    - Implement delivery coordination between websocket and push channels
  6. Analytics on Notification Effectiveness
    - Track open rates, click-through rates, and user engagement with notifications
    - Implement A/B testing for notification content and timing
  7. Notification Grouping
    - Implement smart grouping of similar notifications to reduce noise
    - Add digest functionality for periodic summaries of activity
  8. Offline Sync Mechanism
    - Enhance the frontend to handle offline scenarios better
    - Implement read status sync when users reconnect
  9. Rate Limiting and Throttling
    - Add more sophisticated rate limiting to prevent notification fatigue
    - Implement intelligent delivery timing based on user activity patterns
  10. Automated Testing
    - Create comprehensive test suite for the notification system
    - Add load testing to ensure it handles high notification volumes

  These enhancements would take the notification system from functional to truly exceptional, providing a more engaging and personalized
  user experience while giving administrators better tools for communication and analysis.
```


