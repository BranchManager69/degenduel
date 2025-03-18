# Contest Scheduler Configuration Guide

## Overview

The Contest Scheduler Service automatically creates contests at scheduled intervals. This guide explains how to configure the scheduler to control contest frequency, duration, entry fees, and other parameters.

## Configuration Methods

There are several ways to configure the Contest Scheduler:

1. **Edit Configuration File (Recommended for major changes)**:
   - Edit the `/config/contest-scheduler-config.js` file directly
   - This is best for adding new schedule types or making multiple changes

2. **Command-line Tool (Best for quick changes)**:
   - Use the `update-contest-scheduler-config.js` script
   - Perfect for enabling/disabling schedules or changing fees and durations

3. **Admin API (For frontend integration)**:
   - Use the Admin API endpoints for configuration
   - Useful for integration with admin dashboards

## Using the Configuration File

The main configuration file is located at:
```
/config/contest-scheduler-config.js
```

This file contains all settings, including:
- How often the scheduler checks for new contests (`checkIntervalMs`)
- Default contest settings (template)
- Schedule definitions for when contests are created

After editing this file, restart the service:
```bash
npm run pm2:restart
```

## Command-line Configuration Tool

For quick changes, use the command-line tool:

```bash
# Show help
node scripts/update-contest-scheduler-config.js --help

# List all configured schedules
node scripts/update-contest-scheduler-config.js --list

# Enable a schedule
node scripts/update-contest-scheduler-config.js --enable "Tri-Hourly Contest"

# Disable a schedule
node scripts/update-contest-scheduler-config.js --disable "Weekend Special"

# Change entry fee (in SOL)
node scripts/update-contest-scheduler-config.js --fee "Daily Contest - 12pm" 0.2

# Change contest duration (in hours)
node scripts/update-contest-scheduler-config.js --duration "Weekend Special" 2

# Change check interval (in minutes)
node scripts/update-contest-scheduler-config.js --interval 30
```

After making changes, restart the service:
```bash
npm run pm2:restart
```

## Current Contest Schedules

The default configuration includes:

1. **Daily Contest - 12pm**
   - Every day at 12:00 PM
   - Duration: 1 hour
   - Entry Fee: 0.1 SOL

2. **Daily Contest - 6pm**
   - Every day at 6:00 PM
   - Duration: 1 hour
   - Entry Fee: 0.1 SOL

3. **Weekend Special**
   - Friday and Saturday at 3:00 PM
   - Duration: 1 hour
   - Entry Fee: 1.0 SOL

4. **Tri-Hourly Contest**
   - Every 3 hours (12am, 3am, 6am, 9am, 12pm, 3pm, 6pm, 9pm)
   - Duration: 1 hour
   - Entry Fee: 0.5 SOL

## Adding New Schedule Types

To add a new contest schedule, edit the configuration file and add a new entry to the `schedules` array:

```javascript
{
    name: "My New Contest",
    template: "defaultTemplate",
    hour: 20,               // 8 PM
    minute: 30,             // 8:30 PM
    days: [1, 3, 5],        // Monday, Wednesday, Friday
    entryFeeOverride: "0.3", 
    nameOverride: "Special Weekday Contest",
    durationHours: 1.5,     // 1.5 hour duration
    enabled: true
}
```

For contests at different hours on the same day, use an array of hours:
```javascript
hour: [9, 13, 17, 21],  // 9am, 1pm, 5pm, 9pm
```

## Maintenance Mode Behavior

The Contest Scheduler continues to function during system maintenance mode. This ensures contests are always created on schedule even when the rest of the system is under maintenance.

## Logging

Service logs can be viewed with:
```bash
tail -f /home/branchmanager/.pm2/logs/degenduel-api-out.log | grep contest_scheduler_service
```

## Troubleshooting

If contests are not being created:

1. Check if the service is running:
   ```bash
   npm run pm2:status
   ```

2. Verify the schedules are enabled in the config file

3. Check the logs for any errors:
   ```bash
   tail -n 50 /home/branchmanager/.pm2/logs/degenduel-api-error.log
   ```

4. Make sure the system clock is correctly set on the server