import prisma from '../config/prisma.js';
import { logApi } from './logger-suite/logger.js';

/**
 * Utility for safely handling system_settings operations
 * Prevents recursion limit issues with large JSON objects
 */
class SystemSettingsUtil {
    /**
     * Maximum size for any system setting value in characters
     * Prevent extremely large objects from causing issues
     */
    static MAX_VALUE_SIZE = 50000;

    /**
     * Safely serialize an object for storage in the database
     * Handles circular references and large objects
     * @param {any} obj - The object to serialize
     * @returns {any} A safely serialized version of the object
     */
    static safeSerialize(obj) {
        try {
            // First attempt to stringify 
            const jsonStr = JSON.stringify(obj);
            
            // Check size - if it's too large, create a simplified version
            if (jsonStr.length > this.MAX_VALUE_SIZE) {
                return this.createSimplifiedObject(obj, "Object too large");
            }
            
            // If size is acceptable, parse it back to an object
            return JSON.parse(jsonStr);
        } catch (error) {
            // If circular reference is detected, create a simplified object
            if (error.message.includes('circular') || error.message.includes('recursion')) {
                return this.createSimplifiedObject(obj, "Circular reference detected");
            }
            
            // Return a basic representation if all else fails
            return {
                simplified: true,
                message: "Failed to serialize: " + String(error).substring(0, 100),
                timestamp: new Date().toISOString()
            };
        }
    }
    
    /**
     * Create a simplified version of a complex object
     * @param {any} obj - The original object
     * @param {string} reason - The reason for simplification
     * @returns {object} A simplified representation of the object
     */
    static createSimplifiedObject(obj, reason) {
        // Basic metadata about the original object
        const simplified = {
            simplified: true,
            simplification_reason: reason,
            original_type: typeof obj,
            timestamp: new Date().toISOString()
        };
        
        // If it's an array, add information about its length
        if (Array.isArray(obj)) {
            simplified.is_array = true;
            simplified.length = obj.length;
            
            // Add sample of first few items if available
            if (obj.length > 0) {
                try {
                    // Try to add up to 3 items as samples
                    const samples = [];
                    for (let i = 0; i < Math.min(3, obj.length); i++) {
                        const sample = typeof obj[i] === 'object' && obj[i] !== null
                            ? { type: Array.isArray(obj[i]) ? 'array' : 'object' }
                            : obj[i];
                        samples.push(sample);
                    }
                    simplified.samples = samples;
                } catch (e) {
                    simplified.samples_error = String(e).substring(0, 100);
                }
            }
            return simplified;
        }
        
        // For objects, create a simplified version with just the keys
        if (obj && typeof obj === 'object') {
            try {
                const keys = Object.keys(obj);
                simplified.key_count = keys.length;
                simplified.keys = keys.slice(0, 10); // Only include first 10 keys
                
                // Try to preserve some primitive values
                const preservedValues = {};
                let preservedCount = 0;
                
                for (const key of keys) {
                    if (preservedCount >= 5) break; // Limit to 5 preserved values
                    
                    const value = obj[key];
                    if (value === null || 
                        typeof value === 'string' || 
                        typeof value === 'number' ||
                        typeof value === 'boolean') {
                        // For strings, truncate if too long
                        preservedValues[key] = typeof value === 'string' && value.length > 100
                            ? value.substring(0, 100) + '...'
                            : value;
                        preservedCount++;
                    }
                }
                
                if (preservedCount > 0) {
                    simplified.preserved_values = preservedValues;
                }
            } catch (e) {
                simplified.simplification_error = String(e).substring(0, 100);
            }
        }
        
        return simplified;
    }

    /**
     * Safely update or create a system setting
     * @param {string} key - The setting key
     * @param {any} value - The value to store
     * @param {string} description - Optional description
     * @param {string} updatedBy - Optional wallet address of who updated it
     * @returns {Promise<any>} The result of the operation
     */
    static async upsertSetting(key, value, description = null, updatedBy = null) {
        try {
            // Skip attempt to update if key contains problematic services
            // These services are known to have large state objects that can cause recursion issues
            const problematicServices = [
                'token_sync_service',
                'wallet_generator_service',
                'achievement_service'
            ];
            
            // For problematic services, go straight to simplified storage
            if (problematicServices.includes(key)) {
                // Use a very basic representation for these services
                const basicValue = {
                    simplified: true,
                    original_type: typeof value,
                    service_name: key,
                    timestamp: new Date().toISOString(),
                    status: value?.status || 'unknown',
                    running: !!value?.running,
                    last_check: new Date().toISOString()
                };
                
                // Try to preserve some essential stats if available
                if (value?.stats) {
                    try {
                        const statsSample = {};
                        // Cherry-pick important stats that won't cause recursion
                        if (value.stats.circuitBreaker) {
                            statsSample.circuitBreaker = {
                                isOpen: value.stats.circuitBreaker.isOpen || false,
                                failures: value.stats.circuitBreaker.failures || 0,
                                lastFailure: value.stats.circuitBreaker.lastFailure || null
                            };
                        }
                        basicValue.stats_sample = statsSample;
                    } catch (e) {
                        // Ignore errors when extracting stats
                    }
                }
                
                try {
                    // First try to update if it exists
                    await prisma.system_settings.updateMany({
                        where: { key },
                        data: {
                            value: basicValue,
                            description: description || `${key} (auto-simplified)`,
                            updated_at: new Date(),
                            updated_by: updatedBy
                        }
                    });
                    
                    // Check if it was updated
                    const existing = await prisma.system_settings.findUnique({ where: { key } });
                    
                    if (!existing) {
                        // If it doesn't exist, create it
                        await prisma.system_settings.create({
                            data: {
                                key,
                                value: basicValue,
                                description: description || `${key} (auto-simplified)`,
                                updated_at: new Date(),
                                updated_by: updatedBy
                            }
                        });
                    }
                    
                    return {
                        key,
                        value: basicValue,
                        simplified: true
                    };
                } catch (directError) {
                    logApi.error(`Direct simplified update failed for ${key}:`, directError);
                    return null;
                }
            }
            
            // For normal services, safely serialize the value
            const safeValue = this.safeSerialize(value);
            
            // Try to update or create the setting
            return await prisma.system_settings.upsert({
                where: { key },
                update: {
                    value: safeValue,
                    description: description,
                    updated_at: new Date(),
                    updated_by: updatedBy
                },
                create: {
                    key,
                    value: safeValue,
                    description: description,
                    updated_at: new Date(),
                    updated_by: updatedBy
                }
            });
        } catch (error) {
            logApi.error(`Error upserting system setting ${key}:`, error);
            
            // If we still have issues, try with an extremely simplified value
            if ((error.message !== undefined && error.message !== null && typeof error.message === 'string' && error.message.includes('recursion limit exceeded')) || error.code === 'InvalidArg') {
                try {
                    // Try to delete existing record to avoid unique constraint issues
                    try {
                        await prisma.system_settings.delete({ where: { key } });
                    } catch (deleteError) {
                        // Ignore errors if the record doesn't exist
                    }
                    
                    // Create with basic info using direct query to bypass JSON serialization issues
                    const basicValue = {
                        simplified: true,
                        original_type: typeof value,
                        timestamp: new Date().toISOString(),
                        error_recovery: true
                    };
                    
                    return await prisma.system_settings.create({
                        data: {
                            key,
                            value: basicValue,
                            description: `${description || key} (error recovery)`,
                            updated_at: new Date(),
                            updated_by: updatedBy
                        }
                    });
                } catch (innerError) {
                    logApi.error(`Failed fallback for system setting ${key}:`, innerError);
                    // Don't throw, just return null to prevent cascading failures
                    return null;
                }
            }
            
            // Don't throw the error to prevent cascading failures
            return null;
        }
    }

    /**
     * Safely get a system setting
     * @param {string} key - The setting key
     * @returns {Promise<any>} The setting value or null if not found
     */
    static async getSetting(key) {
        try {
            const setting = await prisma.system_settings.findUnique({
                where: { key }
            });
            
            return setting ? setting.value : null;
        } catch (error) {
            logApi.error(`Error getting system setting ${key}:`, error);
            return null;
        }
    }

    /**
     * Safely delete a system setting
     * @param {string} key - The setting key
     * @returns {Promise<boolean>} True if successful, false otherwise
     */
    static async deleteSetting(key) {
        try {
            await prisma.system_settings.delete({
                where: { key }
            });
            return true;
        } catch (error) {
            // If the record doesn't exist, that's fine
            if (!(error.message !== undefined && error.message !== null && typeof error.message === 'string' && error.message.includes('Record to delete does not exist'))) {
                logApi.error(`Error deleting system setting ${key}:`, error);
            }
            return false;
        }
    }

    /**
     * Get the size of a system setting value in bytes
     * @param {string} key - The setting key
     * @returns {Promise<number>} The size in bytes or -1 if not found
     */
    static async getSettingSize(key) {
        try {
            const setting = await prisma.system_settings.findUnique({
                where: { key }
            });
            
            if (!setting) return -1;
            
            const valueStr = JSON.stringify(setting.value);
            return valueStr.length;
        } catch (error) {
            logApi.error(`Error getting system setting size for ${key}:`, error);
            return -1;
        }
    }

    /**
     * Find large system settings that might cause issues
     * @param {number} sizeThreshold - Size threshold in bytes (default 100KB)
     * @returns {Promise<Array>} Array of problematic settings
     */
    static async findLargeSettings(sizeThreshold = 100 * 1024) {
        try {
            const settings = await prisma.system_settings.findMany();
            const largeSettings = [];
            
            for (const setting of settings) {
                const valueStr = JSON.stringify(setting.value);
                if (valueStr.length > sizeThreshold) {
                    largeSettings.push({
                        key: setting.key,
                        size: valueStr.length,
                        description: setting.description
                    });
                }
            }
            
            return largeSettings;
        } catch (error) {
            logApi.error('Error finding large system settings:', error);
            return [];
        }
    }
}

export default SystemSettingsUtil; 