// routes/admin/discord-webhooks.js
import express from 'express';
import { logApi } from '../../utils/logger-suite/logger.js';
import discordNotificationService from '../../services/discordNotificationService.js';
import { SERVICE_EVENTS } from '../../utils/service-suite/service-events.js';
import serviceEvents from '../../utils/service-suite/service-events.js';
import serviceManager from '../../utils/service-suite/service-manager.js';
import { requireAdmin } from '../../middleware/auth.js';
import prisma from '../../config/prisma.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Discord Management
 *   description: Manage Discord webhooks and notifications
 */

/**
 * @swagger
 * /api/admin/discord-webhooks:
 *   get:
 *     summary: Get all configured Discord webhooks
 *     tags: [Discord Management]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Successfully retrieved webhooks
 *       403:
 *         description: Not authorized
 */
router.get('/', requireAdmin, async (req, res) => {
  try {
    // Get webhook configurations from environment or database
    const webhooks = {
      alerts: process.env.DISCORD_WEBHOOK_ALERTS || '',
      contests: process.env.DISCORD_WEBHOOK_CONTESTS || '',
      transactions: process.env.DISCORD_WEBHOOK_TRANSACTIONS || '',
      system: process.env.DISCORD_WEBHOOK_SYSTEM || '',
    };
    
    // Get additional metadata from database if it exists
    const settings = await prisma.system_settings.findUnique({
      where: { key: 'discord_webhooks' }
    });
    
    const webhookData = {};
    
    // For each webhook, check if it's configured and provide status info
    for (const [channel, url] of Object.entries(webhooks)) {
      webhookData[channel] = {
        configured: Boolean(url),
        url: url ? `${url.substring(0, 20)}...` : '', // Mask the full URL for security
        lastSent: settings?.value?.[channel]?.lastSent || null,
        status: Boolean(url) ? 'configured' : 'not_configured'
      };
    }
    
    res.json({
      success: true,
      webhooks: webhookData,
      serviceStatus: serviceManager.getServiceStatus(discordNotificationService.name)
    });
  } catch (error) {
    logApi.error('Failed to get Discord webhooks:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get Discord webhooks'
    });
  }
});

/**
 * @swagger
 * /api/admin/discord-webhooks/test:
 *   post:
 *     summary: Send a test notification to a Discord webhook
 *     tags: [Discord Management]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               channel:
 *                 type: string
 *                 description: The webhook channel to test (alerts, contests, transactions, system)
 *               message:
 *                 type: string
 *                 description: Optional test message
 *     responses:
 *       200:
 *         description: Test notification sent successfully
 *       400:
 *         description: Invalid webhook channel
 *       403:
 *         description: Not authorized
 *       500:
 *         description: Failed to send test notification
 */
router.post('/test', requireAdmin, async (req, res) => {
  try {
    const { channel, message } = req.body;
    
    if (!channel || !['alerts', 'contests', 'transactions', 'system'].includes(channel)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid webhook channel. Must be one of: alerts, contests, transactions, system'
      });
    }
    
    // Log who ran the test
    logApi.info(`Admin ${req.user.wallet_address} running Discord webhook test for channel: ${channel}`);
    
    // Send test notification
    const result = await discordNotificationService.sendTestNotification(
      channel, 
      message || `Test notification from admin ${req.user.wallet_address}`
    );
    
    if (result) {
      // Update last sent timestamp in database
      await prisma.system_settings.upsert({
        where: { key: 'discord_webhooks' },
        update: {
          value: {
            ...(await prisma.system_settings.findUnique({ where: { key: 'discord_webhooks' } }))?.value || {},
            [channel]: {
              lastSent: new Date().toISOString(),
              lastSentBy: req.user.wallet_address
            }
          }
        },
        create: {
          key: 'discord_webhooks',
          value: {
            [channel]: {
              lastSent: new Date().toISOString(),
              lastSentBy: req.user.wallet_address
            }
          },
          description: 'Discord webhook configuration and status'
        }
      });
      
      res.json({
        success: true,
        message: `Test notification sent to ${channel} webhook`
      });
    } else {
      res.status(500).json({
        success: false,
        error: `Failed to send test notification to ${channel} webhook`
      });
    }
  } catch (error) {
    logApi.error('Failed to send Discord test notification:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to send test notification'
    });
  }
});

/**
 * @swagger
 * /api/admin/discord-webhooks/trigger-event:
 *   post:
 *     summary: Trigger a Discord notification for a specific event type
 *     tags: [Discord Management]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               event:
 *                 type: string
 *                 enum: [contest_created, system_alert, service_status, large_transaction]
 *                 description: The event type to trigger
 *               data:
 *                 type: object
 *                 description: Event-specific data
 *     responses:
 *       200:
 *         description: Event triggered successfully
 *       400:
 *         description: Invalid event type
 *       403:
 *         description: Not authorized
 *       500:
 *         description: Failed to trigger event
 */
router.post('/trigger-event', requireAdmin, async (req, res) => {
  try {
    const { event, data } = req.body;
    
    if (!event) {
      return res.status(400).json({
        success: false,
        error: 'Event type is required'
      });
    }
    
    // Log who triggered the event
    logApi.info(`Admin ${req.user.wallet_address} triggering Discord event: ${event}`);
    
    // Map to actual event type
    let eventType;
    let eventData;
    
    switch (event) {
      case 'contest_created':
        eventType = SERVICE_EVENTS.CONTEST_CREATED;
        eventData = data || {
          name: 'Test Contest',
          contest_code: 'TEST123',
          start_time: new Date().toISOString(),
          prize_pool: 100,
          entry_fee: 0.1,
          status: 'pending'
        };
        break;
        
      case 'system_alert':
        eventType = SERVICE_EVENTS.SYSTEM_ALERT;
        eventData = data || {
          title: 'Test Alert',
          message: 'This is a test system alert triggered by an admin.',
          fields: [
            { name: 'Severity', value: 'Low (Test)', inline: true },
            { name: 'Timestamp', value: new Date().toLocaleString(), inline: true }
          ]
        };
        break;
        
      case 'service_status':
        eventType = SERVICE_EVENTS.SERVICE_STATUS_CHANGE;
        eventData = data || {
          serviceName: 'test_service',
          newStatus: 'down',
          details: 'This is a test service status change event triggered by an admin.'
        };
        break;
        
      case 'large_transaction':
        eventType = SERVICE_EVENTS.LARGE_TRANSACTION;
        eventData = data || {
          type: 'DEPOSIT',
          amount: 100,
          wallet_address: req.user.wallet_address,
          status: 'completed'
        };
        break;
        
      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid event type. Must be one of: contest_created, system_alert, service_status, large_transaction'
        });
    }
    
    // Emit the event
    serviceEvents.emit(eventType, eventData);
    
    res.json({
      success: true,
      message: `${event} event triggered successfully`,
      eventType: eventType
    });
  } catch (error) {
    logApi.error('Failed to trigger Discord event:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to trigger event'
    });
  }
});

export default router;