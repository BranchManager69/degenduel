#!/usr/bin/env node

/**
 * IP Lookup Utility
 * 
 * A command-line tool to look up information about IP addresses.
 * 
 * Usage:
 *   node ip-lookup.js <ip-address>
 * 
 * Example:
 *   node ip-lookup.js 73.0.48.167
 */

import dotenv from 'dotenv';
import axios from 'axios';
import { config } from '../config/config.js';
import chalk from 'chalk';
import Table from 'cli-table3';

// Load environment variables
dotenv.config();

// Get IP info configuration
const IPINFO_API_KEY = config.ipinfo.api_key;
const IPINFO_API_URL = config.ipinfo.full_url || `https://ipinfo.io`;

/**
 * Fetch IP information from ipinfo.io
 * @param {string} ip - IP address to look up
 * @returns {Promise<Object>} - IP information
 */
async function getIpInfo(ip) {
  // Skip for local/private IPs
  if (!ip || ip === '127.0.0.1' || ip === 'localhost' || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.16.')) {
    return { 
      ip,
      bogon: true,
      private: true
    };
  }

  try {
    // Add API key if available
    const url = IPINFO_API_KEY 
      ? `${IPINFO_API_URL}/${ip}/json?token=${IPINFO_API_KEY}`
      : `${IPINFO_API_URL}/${ip}/json`;
    
    const response = await axios.get(url, { timeout: 5000 });
    return response.data;
  } catch (error) {
    console.error('IP info lookup failed:', error.message);
    return { 
      ip,
      error: error.message,
      lookup_failed: true
    };
  }
}

/**
 * Format and display IP information in a nice table
 * @param {Object} ipInfo - IP information object
 */
function displayIpInfo(ipInfo) {
  // Check for errors
  if (ipInfo.error) {
    console.error(chalk.red(`Error: ${ipInfo.error}`));
    process.exit(1);
  }

  // Check for private IP
  if (ipInfo.bogon || ipInfo.private) {
    console.log(chalk.yellow(`IP ${ipInfo.ip} is a private/local IP address.`));
    process.exit(0);
  }

  // Create a table for display
  const table = new Table({
    head: [chalk.cyan('Property'), chalk.cyan('Value')],
    colWidths: [20, 50]
  });

  // Add IP info to table
  table.push(
    ['IP', chalk.green(ipInfo.ip)],
    ['Hostname', ipInfo.hostname ? chalk.green(ipInfo.hostname) : chalk.gray('N/A')],
    ['City', ipInfo.city ? chalk.green(ipInfo.city) : chalk.gray('N/A')],
    ['Region', ipInfo.region ? chalk.green(ipInfo.region) : chalk.gray('N/A')],
    ['Country', ipInfo.country ? chalk.green(ipInfo.country) : chalk.gray('N/A')],
    ['Location', ipInfo.loc ? chalk.green(ipInfo.loc) : chalk.gray('N/A')],
    ['Postal Code', ipInfo.postal ? chalk.green(ipInfo.postal) : chalk.gray('N/A')],
    ['Timezone', ipInfo.timezone ? chalk.green(ipInfo.timezone) : chalk.gray('N/A')],
    ['Organization', ipInfo.org ? chalk.green(ipInfo.org) : chalk.gray('N/A')]
  );

  // Print the table
  console.log(table.toString());

  // Print any additional information
  if (ipInfo.company) {
    console.log(chalk.cyan('\nCompany Information:'));
    console.log(`  Name: ${chalk.green(ipInfo.company.name || 'N/A')}`);
    console.log(`  Domain: ${chalk.green(ipInfo.company.domain || 'N/A')}`);
    console.log(`  Type: ${chalk.green(ipInfo.company.type || 'N/A')}`);
  }

  if (ipInfo.abuse) {
    console.log(chalk.cyan('\nAbuse Contact:'));
    console.log(`  Email: ${chalk.green(ipInfo.abuse.email || 'N/A')}`);
    console.log(`  Phone: ${chalk.green(ipInfo.abuse.phone || 'N/A')}`);
  }

  if (ipInfo.asn) {
    console.log(chalk.cyan('\nASN Information:'));
    console.log(`  ASN: ${chalk.green(ipInfo.asn.asn || 'N/A')}`);
    console.log(`  Name: ${chalk.green(ipInfo.asn.name || 'N/A')}`);
    console.log(`  Domain: ${chalk.green(ipInfo.asn.domain || 'N/A')}`);
    console.log(`  Route: ${chalk.green(ipInfo.asn.route || 'N/A')}`);
    console.log(`  Type: ${chalk.green(ipInfo.asn.type || 'N/A')}`);
  }

  // Print map link
  if (ipInfo.loc) {
    const [lat, lon] = ipInfo.loc.split(',');
    console.log(chalk.cyan('\nMap Link:'));
    console.log(chalk.blue(`  https://www.google.com/maps?q=${lat},${lon}`));
  }
}

/**
 * Main function
 */
async function main() {
  // Get IP from command line arguments
  const ip = process.argv[2];

  if (!ip) {
    console.error(chalk.red('Error: Please provide an IP address.'));
    console.log(chalk.yellow('\nUsage: node ip-lookup.js <ip-address>'));
    console.log(chalk.yellow('Example: node ip-lookup.js 73.0.48.167'));
    process.exit(1);
  }

  // Check if API key is available
  if (!IPINFO_API_KEY) {
    console.warn(chalk.yellow('Warning: No IPINFO_API_KEY found in config or .env file.'));
    console.warn(chalk.yellow('Limited data may be returned or request may be rate-limited.'));
  }
  
  try {
    console.log(chalk.cyan(`Looking up information for IP: ${ip}...`));
    const ipInfo = await getIpInfo(ip);
    displayIpInfo(ipInfo);
  } catch (error) {
    console.error(chalk.red(`Error: ${error.message}`));
    process.exit(1);
  }
}

// Run the main function
main();