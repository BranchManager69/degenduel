// config/contest-scheduler-config.js

/**
 * Central Configuration for Contest Scheduler
 * 
 * This file contains all configurable parameters for the Contest Scheduler Service.
 * Modify these values to adjust contest frequency, duration, entry fees, etc.
 * 
 * IMPORTANT: After changing this configuration, restart the service with:
 *   npm run pm2:restart
 */

export const CONTEST_SCHEDULER_CONFIG = {
    // How often the scheduler checks for new contests to create (in milliseconds)
    checkIntervalMs: 60 * 60 * 1000, // 60 minutes
    
    // Circuit breaker settings
    maxRetries: 3,
    retryDelayMs: 5000,
    circuitBreaker: {
        failureThreshold: 3,
        resetTimeoutMs: 60000,
        minHealthyPeriodMs: 300000
    },
    
    // Contest template and schedule settings
    contests: {
        // Default template (used as base for all contests)
        defaultTemplate: {
            name: "DegenDuel Trading Contest",
            contest_code: "DUEL",
            description: "Trade the most profitable portfolio to win!",
            entry_fee: "0.1", // Default entry fee in SOL
            duration_hours: 1, // Default contest duration
            min_participants: 2,
            max_participants: 100,
            allowed_buckets: [],
            advance_notice_hours: 1 // How many hours before contest starts it should be created
        },
        
        // Schedule definitions - these determine when contests are created
        schedules: [
            {
                name: "Morning Contest - 10am",
                template: "defaultTemplate",
                hour: 10, // 10:00 AM Eastern Time
                minute: 0,
                days: [0, 1, 2, 3, 4, 5, 6], // All days (0=Sun, 6=Sat)
                entryFeeOverride: "0.1", 
                nameOverride: "Morning Trading Contest",
                durationHours: 1,
                enabled: true
            },
            {
                name: "Evening Contest - 10pm",
                template: "defaultTemplate", 
                hour: 22, // 10:00 PM Eastern Time
                minute: 0,
                days: [0, 1, 2, 3, 4, 5, 6], // All days
                entryFeeOverride: "0.2", // Slightly higher for evening
                nameOverride: "Evening Trading Contest",
                durationHours: 1,
                enabled: true
            },
            {
                name: "Weekend Morning Special",
                template: "defaultTemplate",
                hour: 4, // 4:00 AM Eastern Time
                minute: 0, 
                days: [0, 6], // Saturday and Sunday only
                entryFeeOverride: "0.5",
                nameOverride: "Weekend Early Bird Special",
                durationHours: 1,
                enabled: true
            },
            {
                name: "Weekend Afternoon Special",
                template: "defaultTemplate",
                hour: 16, // 4:00 PM Eastern Time
                minute: 0, 
                days: [0, 6], // Saturday and Sunday only
                entryFeeOverride: "1.0", // Higher stakes for weekend afternoon
                nameOverride: "Weekend Prime Time Special",
                durationHours: 1,
                enabled: true
            },
            {
                name: "Friday Night Special",
                template: "defaultTemplate",
                hour: 20, // 8:00 PM Eastern Time
                minute: 0, 
                days: [5], // Friday only
                entryFeeOverride: "0.8", // Higher stakes
                nameOverride: "Friday Night Trading Frenzy",
                durationHours: 1.5, // Slightly longer duration
                enabled: true
            },
            {
                name: "Tri-Hourly Contest",
                template: "defaultTemplate",
                hour: [0, 3, 6, 9, 12, 15, 18, 21], // Every 3 hours
                minute: 0,
                days: [0, 1, 2, 3, 4, 5, 6], // All days
                entryFeeOverride: "0.5", // Medium stakes
                nameOverride: "Tri-Hourly Token Trading Contest",
                durationHours: 1,
                enabled: false // Disabled - too frequent for building anticipation
            }
            
            // Add new schedule templates here
            // Example (disabled by default):
            // {
            //     name: "Hourly Mini-Contest",
            //     template: "defaultTemplate",
            //     hour: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23], // Every hour
            //     minute: 30, // At half past the hour
            //     days: [0, 1, 2, 3, 4, 5, 6], // All days
            //     entryFeeOverride: "0.05", // Lower stakes for frequent contests
            //     nameOverride: "Hourly Mini-Contest",
            //     durationHours: 0.5, // 30 minute contests
            //     enabled: false // Disabled by default
            // }
        ]
    }
};

// Export default configuration
export default CONTEST_SCHEDULER_CONFIG;