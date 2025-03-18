# Contest Frequency Analysis

## Optimized Contest Schedule

The current contest schedule has been optimized to create a balance between availability and anticipation. The schedule provides more contests on weekends than weekdays, with carefully timed events throughout the week.

## Schedule Overview

### Weekday Schedule (Monday-Thursday)
- **Morning Contest**: 10:00 AM Eastern Time
  - Entry Fee: 0.1 SOL
  - Duration: 1 hour
- **Evening Contest**: 10:00 PM Eastern Time
  - Entry Fee: 0.2 SOL
  - Duration: 1 hour

### Friday Schedule
- **Morning Contest**: 10:00 AM Eastern Time
  - Entry Fee: 0.1 SOL
  - Duration: 1 hour
- **Friday Night Special**: 8:00 PM Eastern Time
  - Entry Fee: 0.8 SOL
  - Duration: 1.5 hours
- **Evening Contest**: 10:00 PM Eastern Time
  - Entry Fee: 0.2 SOL
  - Duration: 1 hour

### Weekend Schedule (Saturday-Sunday)
- **Weekend Morning Special**: 4:00 AM Eastern Time
  - Entry Fee: 0.5 SOL
  - Duration: 1 hour
- **Morning Contest**: 10:00 AM Eastern Time
  - Entry Fee: 0.1 SOL
  - Duration: 1 hour
- **Weekend Afternoon Special**: 4:00 PM Eastern Time
  - Entry Fee: 1.0 SOL
  - Duration: 1 hour
- **Evening Contest**: 10:00 PM Eastern Time
  - Entry Fee: 0.2 SOL
  - Duration: 1 hour

## Mathematical Analysis

### Weekly Contest Count
- Weekdays (Mon-Thu): 2 contests × 4 days = 8 contests
- Friday: 3 contests × 1 day = 3 contests
- Weekends (Sat-Sun): 4 contests × 2 days = 8 contests
- **Total**: 19 contests per week

### Weekly Contest Hours
- Weekdays (Mon-Thu): 2 hours × 4 days = 8 hours
- Friday: (2 × 1 hour) + (1 × 1.5 hours) = 3.5 hours
- Weekends (Sat-Sun): 4 hours × 2 days = 8 hours
- **Total**: 19.5 contest hours per week

### Temporal Coverage Analysis
- Total contest hours per week: 19.5 hours
- Total hours in a week: 24 hours × 7 days = 168 hours
- **Coverage ratio**: 19.5 ÷ 168 = 0.116 = 11.6%

This means with our current settings, contests are scheduled to run approximately 11.6% of the time, creating significant anticipation for each event.

### Participation Adjustment
If we assume some contests don't achieve minimum participation and end early:
- Assuming 60% success rate: 11.6% × 0.6 = 7.0% effective coverage
- Assuming 80% success rate: 11.6% × 0.8 = 9.3% effective coverage

### Contest Distribution
The distribution of contests across the day and week has been designed to:
1. Provide at least two reliable daily contests for all users
2. Offer higher-stakes weekend specials 
3. Create a special Friday night event
4. Accommodate various time zones with early morning weekend events

## Recommendations for Future Adjustment

As user participation patterns emerge, consider:

1. **Monitoring participation rates** by time slot to identify optimal scheduling
2. **Adjusting entry fees** based on demand (higher fees for popular time slots)
3. **Seasonal specials** for holidays or special events
4. **Gradually increasing frequency** as user base grows

## Adjustment Formula

The following formula can be used to calculate the optimal number of contests per week (N):

```
N = (Target Coverage % × 168) ÷ Average Contest Duration

Where:
- Target Coverage is the desired percentage of time contests should run (10-15% recommended)
- 168 is the total hours in a week
- Average Contest Duration is the typical contest length in hours
```

For our current settings with 1-hour contests and 11.6% desired coverage:
N = (0.116 × 168) ÷ 1 = 19.5 contests per week

## Conclusion

The current schedule provides a good balance of:
- **Regular availability**: Users can count on daily contests
- **Special events**: Higher stakes on weekends creates anticipation
- **Scarcity**: Low overall coverage (11.6%) ensures contests feel special
- **Variety**: Different entry fees and timing provides options for all users