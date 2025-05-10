# Logtail Dashboard Generator

This tool programmatically creates Logtail dashboards and alerts for your batch processing operations, eliminating the need to manually configure them through the Logtail web UI.

## Setup

Before using the dashboard generator, you need to set up a Logtail API token:

1. Go to [Logtail Dashboard](https://betterstack.com/logs)
2. Navigate to **Settings > API Tokens**
3. Create a new API token with **Read/Write** permissions
4. Add the token to your `.env` file:

```
LOGTAIL_API_TOKEN=your_api_token_here
LOGTAIL_TEAM_ID=your_team_id_here
```

You can find your Team ID in the URL when you're logged into Logtail: `https://betterstack.com/logs/teams/{TEAM_ID}/...`

## Usage

The dashboard generator supports three commands:

```bash
# Create just the dashboards
node tools/logtail-dashboard-generator.js create-dashboards

# Create just the alerts
node tools/logtail-dashboard-generator.js create-alerts

# Create both dashboards and alerts
node tools/logtail-dashboard-generator.js create-all
```

## Generated Dashboards

The tool creates three dashboards:

### 1. Token Batching Analytics

This dashboard provides an overview of your token batch processing operations:

- **Batch Processing Volume**: Count of batch operations grouped by operation
- **Tokens Processed Per Hour**: Sum of tokens processed each hour
- **Average Processing Time**: Average duration of batch operations
- **Success Rate**: Average success rate percentage
- **Errors by Type**: Count of errors grouped by error type

### 2. API Rate Limit Analysis

This dashboard helps you understand your API rate limiting patterns:

- **Rate Limit Occurrences**: Count of rate limit errors over time
- **Rate Limits by Operation**: Count of rate limits grouped by operation
- **Average Retry-After Time**: Average retry delay time
- **Rate Limit Distribution by Hour**: Distribution of rate limits by hour of day

### 3. Batch Performance Overview

This dashboard focuses on performance metrics:

- **Items Processed Per Second**: Average processing speed by operation
- **Batch Timing Distribution**: Percentile distribution of batch durations
- **Slowest Batches**: Table of the slowest batch operations
- **Performance by Time of Day**: Average performance by hour of day

## Generated Alerts

The tool also creates three alerts:

### 1. High Rate Limit Frequency

Triggers when there are too many rate limit errors (>5) in a 15-minute period.

### 2. High Batch Error Rate

Triggers when any batch operation reports a high error rate.

### 3. Performance Degradation

Triggers when batch processing performance degrades significantly (slowdown factor >2).

## Customizing Dashboards and Alerts

You can customize the dashboards and alerts by editing the `dashboards` and `alerts` objects in the script.

For dashboards, you can:
- Change dashboard names and descriptions
- Add, remove, or modify widgets
- Change query parameters and fields
- Change visualization types and grouping

For alerts, you can:
- Change alert names and descriptions
- Modify query parameters
- Adjust threshold values and time windows
- Configure notification channels

## Adding Notification Channels

By default, the alerts don't have notification channels configured. To add notification channels, modify the `notification_channels` array in each alert definition.

Example:

```javascript
notification_channels: [
  {
    type: 'email',
    address: 'alerts@yourdomain.com'
  },
  {
    type: 'slack',
    webhook_url: 'https://hooks.slack.com/services/XXX/YYY/ZZZ'
  }
]
```

## Troubleshooting

If you encounter errors:

1. **API Token Issues**: Make sure your API token has the correct permissions
2. **Rate Limiting**: The Logtail API has rate limits; reduce the number of requests if needed
3. **Existing Resources**: The script won't overwrite existing dashboards or alerts with the same name

For further assistance, check the Logtail API documentation:
https://betterstack.com/docs/logs/api/