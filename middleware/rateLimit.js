import rateLimit from 'express-rate-limit';

export const referralClickLimit = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: { error: 'Too many referral clicks from this IP' }
});

export const referralConversionLimit = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // Limit each IP to 10 conversion attempts per hour
    message: { error: 'Too many conversion attempts from this IP' }
}); 