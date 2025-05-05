/**
 * Configuration specific to Discord services (Interactive Bot, Notifications).
 * Centralizes IDs and settings needed for Discord operations.
 */

export const discordConfig = {
    // Server (Guild) ID where the bot operates and roles exist
    GUILD_ID: '1359718077633134744',
    
    // Role IDs managed by the bot/services
    roles: {
        JUP_LIKER_ROLE_ID: '1367975448579018853'
        // Add other role IDs here as needed in the future
    },

    // Webhook URLs for various notification channels
    webhooks: {
        mainChat:      'https://discord.com/api/webhooks/1359823067701969028/KKfTlXB995Ipze21OmG-Lk2v0FAmXj5ufNJlnIWwUlOoshSplqW6HYbNSfYqqDhv7dnS',
        adminLogs:     'https://discord.com/api/webhooks/1360008681332412427/fOA7tIbVZRABNb8E7KAJT9y2iR4InhTxk6MkmMWLxuaKyeVX9rKKHbsRN1famPCiispi',
        duels:         'https://discord.com/api/webhooks/1368352994504212560/eA28Mj5FhtbhTfIVoFxBY6J2GFpGZF5tgVc_X-pxKzVFvspePVVOMKM7X4VovwzgcHaF',
        help:          'https://discord.com/api/webhooks/1366014702752370719/aL8JeNjuD47x0vG9Cp-T2bY5kjxoM6QRcPQNPGk28a6rk0yfCNtKry8i820edYDsrj8R',
        announcements: 'https://discord.com/api/webhooks/1366007812223664149/w1nn8Gr6GezTFTUuhS75J3TGzbnNZVVyZQ-eudfB98eBSSon-Kmh0q4fg4FGhpbb2CRN',
        welcome:       'https://discord.com/api/webhooks/1366027348570411018/aCHSKonKrqV3Cwd0TZA3P7r296HUkwp3VGgv6QVYx9RHacBf0g_yX1-1i-8Nq4O54_0v',
        launchStage:   'https://discord.com/api/webhooks/1368355230277697586/paX_kzi3s27e0O2dQ7jNcBMNudbbGrRZ2MzhmzoQj51VkP2-i_FSnwLx__xeI6nsSC8S',
        voiceChat:     'https://discord.com/api/webhooks/1366018837346254949/2sgohhlcNBGxhb45KuOk6iVs0d7j-1EjK3wPbZqusu4ARA536OeubVrI_ZLfhSyAe4hQ',
        // Add other webhook URLs here
        // Example: tokens: config.discord_webhook_urls.tokens, // If some still come from main config
    },

    // Optionally, centralize channel IDs/webhook URLs here too if desired later
    // channels: {
    //     contests_webhook: config.discord_webhook_urls.contests, // Example if pulling from main config
    //     admin_logs_webhook: config.discord_webhook_urls.admin_logs,
    //     general_chat_channel_id: 'YOUR_GENERAL_CHAT_ID_HERE' // If using bot client directly for messages
    // }
};

export default discordConfig; 