import prisma from '../config/prisma.js';
import { logApi } from './logger-suite/logger.js';

/**
 * Utility for safely handling system_settings operations
 * Prevents recursion limit issues with large JSON objects
 */
class SystemSettingsUtil {
    /**
     * Safely serialize an object for storage in the database
     * Handles circular references and large objects
     * @param {any} obj - The object to serialize
     * @returns {any} A safely serialized version of the object
     */
    static safeSerialize(obj) {
        try {
            // First attempt to stringify and parse to catch circular references
            return JSON.parse(JSON.stringify(obj));
        } catch (error) {
            // If circular reference is detected, create a simplified object
            if (error.message.includes('circular') || error.message.includes('recursion')) {
                // For objects, create a simplified version
                if (obj && typeof obj === 'object') {
                    if (Array.isArray(obj)) {
                        return [`Array with ${obj.length} items (simplified)`];
                    }
                    
                    // Create a simplified object with just the keys
                    const simplified = {};
                    for (const key in obj) {
                        if (typeof obj[key] === 'function') {
                            simplified[key] = 'function (simplified)';
                        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                            simplified[key] = 'object (simplified)';
                        } else {
                            simplified[key] = obj[key];
                        }
                    }
                    return simplified;
                }
            }
            // Return a basic representation if all else fails
            return String(obj).substring(0, 100) + '... (simplified)';
        }
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
            // Safely serialize the value
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
            if (error.message.includes('recursion limit exceeded') || error.code === 'InvalidArg') {
                try {
                    // Clean up if needed
                    await this.deleteSetting(key);
                    
                    // Create with basic info
                    const basicValue = {
                        simplified: true,
                        original_type: typeof value,
                        timestamp: new Date().toISOString()
                    };
                    
                    return await prisma.system_settings.create({
                        data: {
                            key,
                            value: basicValue,
                            description: `${description || key} (simplified)`,
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
            if (!error.message.includes('Record to delete does not exist')) {
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