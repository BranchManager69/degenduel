import prisma from '../config/prisma.js';
import { logApi } from '../utils/logger-suite/logger.js';
import { config } from '../config/config.js';

const DEVICE_AUTH_DEBUG_MODE = 0 || config.debug_mode;

/**
 * Middleware to check if the device is authorized for the user
 * This should be used after requireAuth middleware
 */
export const requireDeviceAuth = async (req, res, next) => {
  try {
    // Skip device auth check if not enabled
    if (!config.device_auth_enabled) {
      return next();
    }

    // Get device ID from headers
    const deviceId = req.headers['x-device-id'];
    
    if (!deviceId) {
      if (DEVICE_AUTH_DEBUG_MODE === 'true' || DEVICE_AUTH_DEBUG_MODE === true) { 
        logApi.info('No device ID provided'); 
      }
      return res.status(401).json({ error: 'No device ID provided' });
    }

    // User should be attached to request by requireAuth middleware
    if (!req.user || !req.user.wallet_address) {
      if (DEVICE_AUTH_DEBUG_MODE === 'true' || DEVICE_AUTH_DEBUG_MODE === true) { 
        logApi.info('No user found in request'); 
      }
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Check if device is authorized for this user
    const authorizedDevice = await prisma.authorized_devices.findUnique({
      where: {
        wallet_address_device_id: {
          wallet_address: req.user.wallet_address,
          device_id: deviceId
        }
      }
    });

    if (!authorizedDevice || !authorizedDevice.is_active) {
      if (DEVICE_AUTH_DEBUG_MODE === 'true' || DEVICE_AUTH_DEBUG_MODE === true) { 
        logApi.info('Device not authorized for user', { 
          wallet: req.user.wallet_address,
          deviceId
        }); 
      }
      return res.status(403).json({ 
        error: 'Device not authorized',
        code: 'DEVICE_NOT_AUTHORIZED'
      });
    }

    // Update last used timestamp
    await prisma.authorized_devices.update({
      where: {
        id: authorizedDevice.id
      },
      data: {
        last_used: new Date()
      }
    });

    // Attach device info to request
    req.device = authorizedDevice;
    next();
  } catch (error) {
    if (DEVICE_AUTH_DEBUG_MODE === 'true' || DEVICE_AUTH_DEBUG_MODE === true) { 
      logApi.error('Device auth middleware error:', error); 
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Middleware to check if the device is authorized for the user
 * This is a relaxed version that doesn't block the request if device is not authorized
 * It just attaches device info to the request if available
 */
export const checkDeviceAuth = async (req, res, next) => {
  try {
    // Skip device auth check if not enabled
    if (!config.device_auth_enabled) {
      return next();
    }

    // Get device ID from headers
    const deviceId = req.headers['x-device-id'];
    
    if (!deviceId || !req.user || !req.user.wallet_address) {
      return next();
    }

    // Check if device is authorized for this user
    const authorizedDevice = await prisma.authorized_devices.findUnique({
      where: {
        wallet_address_device_id: {
          wallet_address: req.user.wallet_address,
          device_id: deviceId
        }
      }
    });

    if (authorizedDevice && authorizedDevice.is_active) {
      // Update last used timestamp
      await prisma.authorized_devices.update({
        where: {
          id: authorizedDevice.id
        },
        data: {
          last_used: new Date()
        }
      });

      // Attach device info to request
      req.device = authorizedDevice;
    }

    next();
  } catch (error) {
    // Just log the error but don't block the request
    if (DEVICE_AUTH_DEBUG_MODE === 'true' || DEVICE_AUTH_DEBUG_MODE === true) { 
      logApi.error('Device auth check error:', error); 
    }
    next();
  }
}; 