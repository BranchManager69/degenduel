// routes/devices.js

import express from 'express';
import { z } from 'zod';
import prisma from '../config/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireDeviceAuth, checkDeviceAuth } from '../middleware/deviceAuth.js';
import { logApi } from '../utils/logger-suite/logger.js';
import { config } from '../config/config.js';

const router = express.Router();
const deviceLogger = logApi.forService('DEVICES');

// Zod validation schemas
const deviceIdSchema = z.string().min(1).max(100);
const deviceNameSchema = z.string().min(1).max(100).optional();
const deviceTypeSchema = z.string().min(1).max(50).optional();

/**
 * @swagger
 * /api/devices:
 *   get:
 *     summary: Get all authorized devices for the current user
 *     tags: [Devices]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: List of authorized devices
 *       401:
 *         description: Not authenticated
 */
router.get('/', requireAuth, checkDeviceAuth, async (req, res) => {
  try {
    const devices = await prisma.authorized_devices.findMany({
      where: {
        wallet_address: req.user.wallet_address
      },
      orderBy: {
        last_used: 'desc'
      }
    });

    // Mark current device
    const currentDeviceId = req.headers['x-device-id'];
    const devicesWithCurrent = devices.map(device => ({
      ...device,
      is_current_device: device.device_id === currentDeviceId
    }));

    return res.json({
      devices: devicesWithCurrent,
      current_device_id: currentDeviceId,
      max_devices: config.device_auth.max_devices_per_user
    });
  } catch (error) {
    deviceLogger.error('Error fetching devices', {
      user: req.user.wallet_address,
      error: error.message
    });
    return res.status(500).json({ error: 'Failed to fetch devices' });
  }
});

/**
 * @swagger
 * /api/devices/{id}:
 *   put:
 *     summary: Update a device
 *     tags: [Devices]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               device_name:
 *                 type: string
 *               is_active:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Device updated successfully
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Not authorized
 *       404:
 *         description: Device not found
 */
router.put('/:id', requireAuth, requireDeviceAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { device_name, is_active } = req.body;

    // Validate input
    if (device_name !== undefined && (typeof device_name !== 'string' || device_name.length < 1 || device_name.length > 100)) {
      return res.status(400).json({ error: 'Invalid device name' });
    }

    if (is_active !== undefined && typeof is_active !== 'boolean') {
      return res.status(400).json({ error: 'Invalid is_active value' });
    }

    // Find the device
    const device = await prisma.authorized_devices.findUnique({
      where: { id: parseInt(id) }
    });

    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // Check if device belongs to the user
    if (device.wallet_address !== req.user.wallet_address) {
      return res.status(403).json({ error: 'Not authorized to update this device' });
    }

    // Update the device
    const updatedDevice = await prisma.authorized_devices.update({
      where: { id: parseInt(id) },
      data: {
        device_name: device_name !== undefined ? device_name : undefined,
        is_active: is_active !== undefined ? is_active : undefined
      }
    });

    deviceLogger.info('Device updated', {
      user: req.user.wallet_address,
      device_id: device.device_id,
      device_name: updatedDevice.device_name,
      is_active: updatedDevice.is_active
    });

    return res.json({
      device: updatedDevice,
      is_current_device: device.device_id === req.headers['x-device-id']
    });
  } catch (error) {
    deviceLogger.error('Error updating device', {
      user: req.user.wallet_address,
      device_id: req.params.id,
      error: error.message
    });
    return res.status(500).json({ error: 'Failed to update device' });
  }
});

/**
 * @swagger
 * /api/devices/{id}:
 *   delete:
 *     summary: Delete a device
 *     tags: [Devices]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Device deleted successfully
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Not authorized or cannot delete current device
 *       404:
 *         description: Device not found
 */
router.delete('/:id', requireAuth, requireDeviceAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // Find the device
    const device = await prisma.authorized_devices.findUnique({
      where: { id: parseInt(id) }
    });

    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // Check if device belongs to the user
    if (device.wallet_address !== req.user.wallet_address) {
      return res.status(403).json({ error: 'Not authorized to delete this device' });
    }

    // Check if trying to delete current device
    if (device.device_id === req.headers['x-device-id']) {
      return res.status(403).json({ error: 'Cannot delete current device' });
    }

    // Delete the device
    await prisma.authorized_devices.delete({
      where: { id: parseInt(id) }
    });

    deviceLogger.info('Device deleted', {
      user: req.user.wallet_address,
      device_id: device.device_id,
      device_name: device.device_name
    });

    return res.json({
      success: true,
      message: 'Device deleted successfully'
    });
  } catch (error) {
    deviceLogger.error('Error deleting device', {
      user: req.user.wallet_address,
      device_id: req.params.id,
      error: error.message
    });
    return res.status(500).json({ error: 'Failed to delete device' });
  }
});

/**
 * @swagger
 * /api/devices/authorize:
 *   post:
 *     summary: Authorize a new device
 *     tags: [Devices]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - device_id
 *             properties:
 *               device_id:
 *                 type: string
 *               device_name:
 *                 type: string
 *               device_type:
 *                 type: string
 *     responses:
 *       200:
 *         description: Device authorized successfully
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Maximum number of devices reached
 */
router.post('/authorize', requireAuth, requireDeviceAuth, async (req, res) => {
  try {
    const { device_id, device_name, device_type } = req.body;

    // Validate input
    try {
      deviceIdSchema.parse(device_id);
      if (device_name) deviceNameSchema.parse(device_name);
      if (device_type) deviceTypeSchema.parse(device_type);
    } catch (validationError) {
      return res.status(400).json({ error: 'Invalid input', details: validationError.errors });
    }

    // Check if device already exists
    const existingDevice = await prisma.authorized_devices.findUnique({
      where: {
        wallet_address_device_id: {
          wallet_address: req.user.wallet_address,
          device_id: device_id
        }
      }
    });

    if (existingDevice) {
      // Update existing device
      const updatedDevice = await prisma.authorized_devices.update({
        where: { id: existingDevice.id },
        data: {
          device_name: device_name || existingDevice.device_name,
          device_type: device_type || existingDevice.device_type,
          is_active: true,
          last_used: new Date()
        }
      });

      deviceLogger.info('Existing device authorized', {
        user: req.user.wallet_address,
        device_id,
        device_name: updatedDevice.device_name
      });

      return res.json({
        device: updatedDevice,
        message: 'Device authorized successfully'
      });
    }

    // Check if maximum number of devices reached
    const deviceCount = await prisma.authorized_devices.count({
      where: {
        wallet_address: req.user.wallet_address,
        is_active: true
      }
    });

    if (deviceCount >= config.device_auth.max_devices_per_user) {
      return res.status(403).json({
        error: 'Maximum number of devices reached',
        max_devices: config.device_auth.max_devices_per_user
      });
    }

    // Create new device
    const newDevice = await prisma.authorized_devices.create({
      data: {
        wallet_address: req.user.wallet_address,
        device_id,
        device_name: device_name || 'New Device',
        device_type: device_type || 'Unknown',
        is_active: true
      }
    });

    deviceLogger.info('New device authorized', {
      user: req.user.wallet_address,
      device_id,
      device_name: newDevice.device_name
    });

    return res.json({
      device: newDevice,
      message: 'Device authorized successfully'
    });
  } catch (error) {
    deviceLogger.error('Error authorizing device', {
      user: req.user.wallet_address,
      error: error.message
    });
    return res.status(500).json({ error: 'Failed to authorize device' });
  }
});

export default router; 