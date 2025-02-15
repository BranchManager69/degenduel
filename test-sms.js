import { config } from 'dotenv';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { join } from 'path';

// Get the directory name of the current module
const __dirname = dirname(fileURLToPath(import.meta.url));

// Load environment variables from the root .env file
config({ path: join(__dirname, '.env') });

import { sendSMSAlert, formatSystemAlert } from './utils/notification-suite/sms-alerts.js';

async function test() {
    try {
        // First check if environment variables are properly loaded
        const envCheck = {
            TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID ? 
                `${process.env.TWILIO_ACCOUNT_SID.substring(0, 2)}...${process.env.TWILIO_ACCOUNT_SID.substring(process.env.TWILIO_ACCOUNT_SID.length - 4)}` : 'Not set',
            TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN ? 
                `${process.env.TWILIO_AUTH_TOKEN.substring(0, 2)}...${process.env.TWILIO_AUTH_TOKEN.substring(process.env.TWILIO_AUTH_TOKEN.length - 4)}` : 'Not set',
            TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER,
            ALERT_PHONE_NUMBER: process.env.ALERT_PHONE_NUMBER,
            SID_LENGTH: process.env.TWILIO_ACCOUNT_SID?.length,
            TOKEN_LENGTH: process.env.TWILIO_AUTH_TOKEN?.length
        };

        console.log('Environment check:', envCheck);

        if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || 
            !process.env.TWILIO_PHONE_NUMBER || !process.env.ALERT_PHONE_NUMBER) {
            throw new Error('Missing required environment variables');
        }

        // Validate SID format (should start with 'AC' and be 34 characters)
        if (!process.env.TWILIO_ACCOUNT_SID.startsWith('AC') || 
            process.env.TWILIO_ACCOUNT_SID.length !== 34) {
            throw new Error('Invalid Account SID format');
        }

        // Validate auth token length (should be 32 characters)
        if (process.env.TWILIO_AUTH_TOKEN.length !== 32) {
            throw new Error('Invalid Auth Token format');
        }

        console.log('Sending test SMS alert...');
        await sendSMSAlert(formatSystemAlert('test', { 
            message: 'Testing SMS alerts configuration' 
        }));
        console.log('Test alert sent successfully!');
    } catch (error) {
        console.error('Test failed:', error);
        console.error(error.stack);
        process.exit(1);
    }
}

test(); 