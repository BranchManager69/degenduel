/**
 * Admin routes for managing service configurations
 */

import express from 'express';
import { requireAdmin } from '../../middleware/auth.js';
import prisma from '../../config/prisma.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import AdminLogger from '../../utils/admin-logger.js';
import { clearIntervalCache } from '../../utils/service-suite/service-interval-adapter.js';

const router = express.Router();

// Apply admin auth to all routes
router.use(requireAdmin);

/**
 * GET /admin/service-config
 * List all service configurations
 */
router.get('/', async (req, res) => {
  try {
    const configs = await prisma.service_configuration.findMany({
      orderBy: { display_name: 'asc' }
    });
    
    res.json({ success: true, data: configs });
  } catch (error) {
    logApi.error('Failed to get service configurations:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /admin/service-config/:serviceName
 * Get a specific service configuration
 */
router.get('/:serviceName', async (req, res) => {
  try {
    const { serviceName } = req.params;
    
    const config = await prisma.service_configuration.findUnique({
      where: { service_name: serviceName }
    });
    
    if (!config) {
      return res.status(404).json({ 
        success: false, 
        error: `Service configuration not found: ${serviceName}` 
      });
    }
    
    res.json({ success: true, data: config });
  } catch (error) {
    logApi.error(`Failed to get service configuration for ${req.params.serviceName}:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PATCH /admin/service-config/:serviceName/interval
 * Update just the interval for a service configuration
 */
router.patch('/:serviceName/interval', async (req, res) => {
  try {
    const { serviceName } = req.params;
    const { check_interval_ms } = req.body;
    
    if (!check_interval_ms || typeof check_interval_ms !== 'number' || check_interval_ms < 1000) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid interval: must be a number >= 1000ms' 
      });
    }
    
    // Get current configuration
    const existing = await prisma.service_configuration.findUnique({
      where: { service_name: serviceName }
    });
    
    if (!existing) {
      return res.status(404).json({ 
        success: false, 
        error: `Service configuration not found: ${serviceName}` 
      });
    }
    
    // Update the configuration
    const updated = await prisma.service_configuration.update({
      where: { service_name: serviceName },
      data: {
        check_interval_ms: check_interval_ms,
        updated_by: req.user.wallet_address
      }
    });
    
    // Clear the cache to ensure changes take effect immediately
    clearIntervalCache(serviceName);
    
    // Log the action
    await AdminLogger.logAction(
      req.user.wallet_address,
      AdminLogger.Actions.SYSTEM.UPDATE_SERVICE_CONFIG,
      {
        service_name: serviceName,
        previous_interval_ms: existing.check_interval_ms,
        new_interval_ms: check_interval_ms
      }
    );
    
    res.json({ 
      success: true, 
      message: `Updated interval for ${serviceName} to ${check_interval_ms}ms`,
      data: updated
    });
  } catch (error) {
    logApi.error(`Failed to update interval for ${req.params.serviceName}:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PATCH /admin/service-config/:serviceName
 * Update a service configuration
 */
router.patch('/:serviceName', async (req, res) => {
  try {
    const { serviceName } = req.params;
    const updates = req.body;
    
    // Prevent updating service_name directly
    delete updates.service_name;
    delete updates.id;
    
    // Validate check_interval_ms if provided
    if (updates.check_interval_ms && (
        typeof updates.check_interval_ms !== 'number' || 
        updates.check_interval_ms < 1000
    )) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid interval: must be a number >= 1000ms' 
      });
    }
    
    // Get current configuration
    const existing = await prisma.service_configuration.findUnique({
      where: { service_name: serviceName }
    });
    
    if (!existing) {
      return res.status(404).json({ 
        success: false, 
        error: `Service configuration not found: ${serviceName}` 
      });
    }
    
    // Update the configuration
    const updated = await prisma.service_configuration.update({
      where: { service_name: serviceName },
      data: {
        ...updates,
        updated_by: req.user.wallet_address
      }
    });
    
    // Clear the cache if interval was updated
    if (updates.check_interval_ms !== undefined) {
      clearIntervalCache(serviceName);
    }
    
    // Log the action
    await AdminLogger.logAction(
      req.user.wallet_address,
      AdminLogger.Actions.SYSTEM.UPDATE_SERVICE_CONFIG,
      {
        service_name: serviceName,
        updates: updates
      }
    );
    
    res.json({ 
      success: true, 
      message: `Updated configuration for ${serviceName}`,
      data: updated
    });
  } catch (error) {
    logApi.error(`Failed to update configuration for ${req.params.serviceName}:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;