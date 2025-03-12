import crypto from 'crypto';

// Generate a secure service key if not provided in environment
const SERVICE_AUTH_KEY = process.env.SERVICE_AUTH_KEY || crypto.randomBytes(32).toString('hex');

export const generateServiceAuthHeader = () => {
    const timestamp = Date.now().toString();
    const signature = crypto
        .createHmac('sha256', SERVICE_AUTH_KEY)
        .update(timestamp)
        .digest('hex');
    
    return {
        'X-Service-Auth': `${timestamp}.${signature}`
    };
};

export const validateServiceAuth = (authHeader) => {
    if (!authHeader) return false;
    
    const [timestamp, signature] = authHeader.split('.');
    if (!timestamp || !signature) return false;
    
    // Reject requests with timestamps older than 5 minutes
    if (Date.now() - parseInt(timestamp) > 5 * 60 * 1000) return false;
    
    const expectedSignature = crypto
        .createHmac('sha256', SERVICE_AUTH_KEY)
        .update(timestamp)
        .digest('hex');
    
    return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
    );
}; 