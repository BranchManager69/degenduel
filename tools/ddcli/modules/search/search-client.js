import fetch from 'node-fetch';
import chalk from 'chalk';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the current module path for relative references
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from DegenDuel's .env file
const degenduelEnvPath = path.resolve('/home/websites/degenduel/.env');
if (fs.existsSync(degenduelEnvPath)) {
  dotenv.config({ path: degenduelEnvPath });
}

// API Configuration
const API_HOST = process.env.AI_API_HOST || '192.222.51.124';
const API_PORT = process.env.AI_API_PORT || '8000';
const API_BASE_URL = `http://${API_HOST}:${API_PORT}`;

/**
 * Performs a health check on the AI API server
 * @returns {Promise<Object>} Health status information
 */
export async function healthCheck() {
  try {
    const response = await fetch(`${API_BASE_URL}/health`);
    
    if (!response.ok) {
      throw new Error(`Server returned ${response.status}: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (err) {
    console.error(chalk.red('Health check failed:'), err.message);
    throw new Error(`API server health check failed: ${err.message}`);
  }
}

/**
 * Search the codebase using the AI API
 * @param {string} query The search query
 * @param {Object} options Search options
 * @param {number} options.limit Maximum number of results to return
 * @param {string} options.endpoint API endpoint to use
 * @returns {Promise<Object>} Search results
 */
export async function search(query, options = {}) {
  const { 
    limit = 5,
    endpoint = 'search'
  } = options;
  
  try {
    console.log(`Connecting to API: ${API_BASE_URL}/api/${endpoint}`);
    
    const requestData = {
      query,
      limit: parseInt(limit, 10)
    };
    
    // Add dynamic parameters for future extensibility
    if (options.filters) requestData.filters = options.filters;
    if (options.context) requestData.context = options.context;
    if (options.mode) requestData.mode = options.mode;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server returned ${response.status}: ${errorText}`);
      }
      
      return await response.json();
    } catch (fetchErr) {
      if (fetchErr.name === 'AbortError') {
        throw new Error('Request timed out after 15 seconds. Is the API server running?');
      }
      throw fetchErr;
    }
  } catch (err) {
    console.error(chalk.red('Search failed:'), err.message);
    
    // Return a structured error object that the display code can handle
    return {
      error: true,
      message: err.message,
      matches: [],
      summary: `Search failed: ${err.message}\n\nPlease check that the API server is running at ${API_BASE_URL}`
    };
  }
}

/**
 * Execute a custom API endpoint with the provided data
 * @param {string} endpoint API endpoint to call
 * @param {Object} data Data to send to the endpoint
 * @returns {Promise<Object>} Response data
 */
export async function executeEndpoint(endpoint, data = {}) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Server returned ${response.status}: ${errorText}`);
    }
    
    return await response.json();
  } catch (err) {
    console.error(chalk.red(`API call to ${endpoint} failed:`), err.message);
    throw new Error(`API call failed: ${err.message}`);
  }
}