#!/usr/bin/env node

/**
 * System Status Quick Check
 * Programmatic usage example:
 * 
 * ```js
 * import { checkSystemStatus } from './tools/system-status/system-status.js';
 * 
 * // Get all service statuses
 * const status = await checkSystemStatus();
 * console.log(`${status.activeCount} active services, ${status.staleCount} stale`);
 * 
 * // Get stale services (not updated in the last 10 minutes)
 * const staleServices = await checkSystemStatus({ staleMinutes: 10 });
 * if (staleServices.staleServices.length > 0) {
 *   console.log('Warning: Some services appear to be stale!');
 * }
 * ```
 */

import prisma from '../../config/prisma.js';
import { formatDistance } from 'date-fns';

/**
 * Check system status
 * @param {Object} options - Options
 * @param {boolean} options.includeInactive - Include inactive services
 * @param {number} options.staleMinutes - Minutes threshold for stale services
 * @returns {Promise<Object>} System status
 */
export async function checkSystemStatus(options = {}) {
  const opts = {
    includeInactive: false,
    staleMinutes: 10,
    ...options
  };
  
  try {
    // Get services and their statuses
    const services = await prisma.$queryRaw`
      SELECT 
        key as service_name, 
        value->>'status' as status,
        value->>'running' as running,
        updated_at,
        EXTRACT(EPOCH FROM (NOW() - updated_at))/60 as minutes_ago
      FROM system_settings
      WHERE value ? 'status'
      ${!opts.includeInactive ? prisma.$raw`AND value->>'status' = 'active'` : prisma.$raw``}
      ORDER BY updated_at DESC
    `;
    
    // Format results
    const formattedServices = services.map(service => ({
      name: service.service_name,
      status: service.status,
      running: service.running === 'true',
      updated_at: service.updated_at,
      minutes_ago: parseFloat(service.minutes_ago),
      is_stale: parseFloat(service.minutes_ago) > opts.staleMinutes
    }));
    
    // Calculate summary
    const activeServices = formattedServices.filter(s => s.status === 'active');
    const staleServices = formattedServices.filter(s => s.is_stale);
    
    return {
      timestamp: new Date(),
      services: formattedServices,
      serviceCount: formattedServices.length,
      activeCount: activeServices.length,
      staleCount: staleServices.length,
      staleServices,
      isHealthy: staleServices.length === 0
    };
  } catch (error) {
    console.error('Error checking system status:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// If this script is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const jsonOutput = args.includes('--json');
  const staleMinutes = args.includes('--stale-minutes') 
    ? parseInt(args[args.indexOf('--stale-minutes') + 1], 10) 
    : 10;
  
  try {
    const status = await checkSystemStatus({
      includeInactive: args.includes('--include-inactive'),
      staleMinutes
    });
    
    if (jsonOutput) {
      console.log(JSON.stringify(status, null, 2));
    } else {
      console.log('\n=== DegenDuel System Status ===');
      console.log(`Timestamp: ${status.timestamp}`);
      console.log(`Services: ${status.serviceCount} (${status.activeCount} active)`);
      console.log(`Stale services: ${status.staleCount}`);
      console.log(`System health: ${status.isHealthy ? '✅ Healthy' : '❌ Issues detected'}`);
      
      if (status.staleServices.length > 0) {
        console.log('\nStale services:');
        status.staleServices.forEach(service => {
          console.log(`- ${service.name} (${Math.round(service.minutes_ago)} minutes ago)`);
        });
      }
      
      console.log('\nLast updated services:');
      status.services.slice(0, 5).forEach(service => {
        const timeAgo = formatDistance(new Date(service.updated_at), new Date(), { addSuffix: true });
        console.log(`- ${service.name}: ${timeAgo}`);
      });
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

export default { checkSystemStatus };