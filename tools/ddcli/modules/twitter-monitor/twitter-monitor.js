import chalk from 'chalk';
import ora from 'ora';
import ui from '../../core/ui.js';

// Mock tweets for demonstration (since we can't actually connect to Twitter API without credentials)
const MOCK_TWEETS = [
  { id: '1', user: 'user1', text: 'Just heard the new Kanye album - amazing!', date: new Date() },
  { id: '2', user: 'user2', text: 'Kanye West announces new fashion line', date: new Date() },
  { id: '3', user: 'user3', text: 'Debating if Kanye is the GOAT or not', date: new Date() },
  { id: '4', user: 'user4', text: 'Kanye\'s latest interview is wild', date: new Date() },
  { id: '5', user: 'user5', text: 'Did you see what Kanye said today?', date: new Date() },
];

// Store seen tweet IDs to avoid duplicates
const seenTweets = new Set();

/**
 * Format and display a tweet
 * @param {Object} tweet Tweet object
 */
function displayTweet(tweet) {
  const timestamp = tweet.date.toLocaleTimeString();
  
  ui.box(
    `${chalk.blue('@' + tweet.user)} ${chalk.dim(`· ${timestamp}`)}\n\n` +
    `${tweet.text}\n`,
    {
      padding: 1,
      borderColor: 'blue',
      borderStyle: 'round',
    }
  );
}

/**
 * Monitor Twitter for tweets containing a keyword
 * @param {string} keyword Keyword to search for
 * @param {Object} options Configuration options
 * @param {number} options.interval Polling interval in milliseconds
 * @param {number} options.limit Maximum tweets to keep track of
 */
export function monitorKeyword(keyword, options = {}) {
  const { interval = 30000, limit = 10 } = options;
  let timer = null;
  
  // This is where you would normally connect to the Twitter API
  // For this demo, we'll simulate finding tweets in the mock data
  const fetchTweets = async () => {
    const spinner = ui.spinner('Fetching tweets...');
    spinner.start();
    
    try {
      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // In a real implementation, this would query the Twitter API
      // For demonstration, we'll just use the mock data and randomize which ones we "find"
      const foundTweets = MOCK_TWEETS
        .filter(() => Math.random() > 0.6) // Randomly include tweets
        .map(tweet => ({
          ...tweet,
          date: new Date(Date.now() - Math.floor(Math.random() * 300000)), // Random time in last 5 minutes
        }));
      
      spinner.succeed(`Found ${foundTweets.length} tweets matching "${keyword}"`);
      
      // Process new tweets
      let newTweetsCount = 0;
      foundTweets.forEach(tweet => {
        if (!seenTweets.has(tweet.id)) {
          seenTweets.add(tweet.id);
          displayTweet(tweet);
          newTweetsCount++;
          
          // Keep the set of seen tweets to a reasonable size
          if (seenTweets.size > limit) {
            // Remove oldest entry (though in practice with real IDs this is harder to determine)
            seenTweets.delete([...seenTweets][0]);
          }
        }
      });
      
      if (newTweetsCount === 0) {
        ui.message('No new tweets found', 'info');
      }
    } catch (err) {
      spinner.fail('Error fetching tweets');
      console.error(chalk.red(err.message));
    }
    
    // Schedule next fetch
    timer = setTimeout(fetchTweets, interval);
  };
  
  // Start the first fetch
  fetchTweets();
  
  // Return a function to stop monitoring
  return {
    stop: () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}