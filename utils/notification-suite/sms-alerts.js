import twilio from 'twilio';

// Initialize Twilio client
const client = new twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Send SMS alert
async function sendSMSAlert(message) {
    try {
        console.log('Attempting to send SMS with:', {
            from: process.env.TWILIO_PHONE_NUMBER,
            to: process.env.ALERT_PHONE_NUMBER,
            body: message
        });

        const response = await client.messages.create({
            body: message,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: process.env.ALERT_PHONE_NUMBER
        });
        
        console.log('SMS alert sent:', {
            messageId: response.sid,
            status: response.status,
            timestamp: new Date().toISOString()
        });
        
        return response;
    } catch (error) {
        console.error('Failed to send SMS alert:', {
            error: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        });
        throw error;
    }
}

// Format contest wallet alert
function formatContestWalletAlert(type, data) {
    switch(type) {
        case 'creation':
            return `🎮 Contest Wallet Created\nContest: ${data.contest_id}\nWallet: ${data.wallet_address}`;
        case 'error':
            return `❌ Contest Wallet Error\nContest: ${data.contest_id}\nError: ${data.error}`;
        default:
            return `Contest Wallet Alert: ${JSON.stringify(data)}`;
    }
}

// Format system alert
function formatSystemAlert(type, data) {
    const timestamp = new Date().toISOString();
    switch(type) {
        case 'server_restart':
            return `🔄 Server Restart\nTimestamp: ${timestamp}\nEnvironment: ${process.env.NODE_ENV}\nPort: ${process.env.PORT}`;
        case 'circuit_breaker':
            return `⚡ Circuit Breaker Triggered\nService: ${data.service}\nReason: ${data.reason}\nTimestamp: ${timestamp}`;
        case 'login':
            return `🔐 Login Alert\nUser: ${data.user}\nIP: ${data.ip}\nTimestamp: ${timestamp}`;
        case 'test':
            return `🧪 Test Alert\nMessage: ${data.message}\nTimestamp: ${timestamp}`;
        default:
            return `System Alert: ${JSON.stringify(data)}`;
    }
}

export {
    sendSMSAlert,
    formatContestWalletAlert,
    formatSystemAlert
}; 