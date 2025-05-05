# Discord Services Overview

This document outlines the roles and responsibilities of the two primary Discord integration services within the DegenDuel backend.

## 1. `discord-interactive-service.js` (Bot-Based)

*   **Purpose:** Logs in as the main Discord Bot (`Didi`). Handles tasks requiring bot permissions and user interactions.
*   **Mechanism:** Uses `discord.js` `Client`, connects via Bot Token.
*   **Key Responsibilities:**
    *   **Role Management:** Granting/Revoking roles (e.g., "Chad" role for JUP Likers) using the bot's permissions.
    *   **Direct Messaging (DMs):** Sending DMs to users (e.g., revocation notifications).
    *   **Interaction Handling:** Responding to button clicks or slash commands initiated by users in Discord.
    *   **Event Orchestration (Specific Events):** Listens for specific internal `serviceEvents` like `PRIVILEGE_GRANTED` and `PRIVILEGE_REVOKED`.
        *   On `PRIVILEGE_GRANTED`:
            1.  Finds user's Discord ID.
            2.  Calls `grantJupLikeRole` (Bot Action).
            3.  Uses the **`mainChat` webhook** (from `discordNotificationService`) to send a public announcement.
            4.  Uses the **`adminLogs` webhook** (from `discordNotificationService`) to log the grant.
        *   On `PRIVILEGE_REVOKED`:
            1.  Finds user's Discord ID.
            2.  Calls `revokeJupLikeRole` (Bot Action).
            3.  Sends a **DM** to the user (Bot Action).
            4.  Uses the **`adminLogs` webhook** (from `discordNotificationService`) to log the revocation.
    *   **Sending Interactive Messages:** Can send messages with buttons/components that it then listens for interactions on.

## 2. `discordNotificationService.js` (Webhook-Based)

*   **Purpose:** Sends formatted messages (primarily embeds) to various pre-configured Discord channels using Webhooks. Does *not* require bot login or special permissions beyond webhook access.
*   **Mechanism:** Uses `DiscordWebhook` utility class and specific Webhook URLs defined in `services/discord/discordConfig.js`.
*   **Key Responsibilities:**
    *   **Event-Based Channel Notifications:** Listens for various internal `serviceEvents` and posts relevant messages to designated channels:
        *   `CONTEST_CREATED`, `CONTEST_ACTIVITY`, `CONTEST_COMPLETED`: Posts to the `#duels` channel (via `duels` webhook).
        *   `USER_ACHIEVEMENT`, `USER_LEVEL_UP`, `USER_MILESTONE`: Posts to the `#main-chat` channel (via `mainChat` webhook).
        *   `SYSTEM_ALERT`, `SERVICE_STATUS_CHANGE`: Posts to `#alerts` or `#system` channels.
        *   `LARGE_TRANSACTION`, `TOKEN_PURCHASE`, `TOKEN_SALE`: Posts to `#transactions` or `#tokens` channels.
        *   `SYSTEM_STARTUP`, `SYSTEM_SHUTDOWN`: Posts to `#system` channel.
    *   **Provides Webhook Access:** Its initialized webhook clients (`this.webhooks`) can be imported and used by other services (like the interactive service) for sending messages to specific channels without needing direct bot permissions for that message.

## Interaction Flow Example (JUP Liker Grant)

1.  `checkJupLikes.js` detects a new like, updates `user_privileges` table.
2.  `checkJupLikes.js` emits `PRIVILEGE_GRANTED` event.
3.  `discord-interactive-service.js` listener catches the event.
4.  `discord-interactive-service.js` finds the user's Discord ID.
5.  `discord-interactive-service.js` calls its own `grantJupLikeRole` method (Bot Action).
6.  `discord-interactive-service.js` calls its `sendGrantToAdminLog` helper, which uses the `adminLogs` webhook instance imported from `discordNotificationService`.
7.  `discord-interactive-service.js` uses the `mainChat` webhook instance imported from `discordNotificationService` to send the public announcement. 