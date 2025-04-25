/**
 * Quick check for OpenAI client structure
 */

import OpenAI from 'openai';
import config from '../config/config.js';

console.log('Checking OpenAI client structure...');

// Create OpenAI client exactly like your AI service does
const client = new OpenAI({
  apiKey: config.api_keys.openai
});

// Check what properties are available
console.log('OpenAI client properties:', Object.keys(client));
console.log('Has responses property:', client.responses !== undefined);
console.log('Has chat property:', client.chat !== undefined);
console.log('Chat properties:', client.chat ? Object.keys(client.chat) : 'N/A');
// Try to access imported version directly
try {
  const pkg = await import('openai/package.json', { assert: { type: 'json' } });
  console.log('OpenAI package version:', pkg.default.version);
} catch (e) {
  console.log('Could not import version directly');
}

// Exit when done
setTimeout(() => process.exit(0), 100);