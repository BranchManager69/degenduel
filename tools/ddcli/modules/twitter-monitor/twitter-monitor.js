import chalk from 'chalk';
import ora from 'ora';
import ui from '../../core/ui.js';
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

// Get the current module path for relative references
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from DegenDuel's .env file
const degenduelEnvPath = path.resolve('/home/websites/degenduel/.env');
if (fs.existsSync(degenduelEnvPath)) {
  dotenv.config({ path: degenduelEnvPath });
  console.log('Loaded environment variables from DegenDuel .env file');
}

// Path to Twitter session cookies
const TWITTER_SESSION_PATH = path.resolve('/home/websites/degenduel/keys/twitter-session.json');

// API Key for OpenAI (from environment variable or DegenDuel .env)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

// Store seen tweet IDs to avoid duplicates
const seenTweets = new Set();

/**
 * Format and display a tweet
 * @param {Object} tweet Tweet object
 */
function displayTweet(tweet) {
  // Format the timestamp safely
  let timestamp = 'Unknown time';
  if (tweet.date) {
    // Check if date is a string that needs to be converted
    const dateObj = tweet.date instanceof Date ? tweet.date : new Date(tweet.date);
    // Verify it's a valid date before using toLocaleTimeString
    timestamp = !isNaN(dateObj.getTime()) ? dateObj.toLocaleTimeString() : 'Unknown time';
  }
  
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
 * Create output directories for screenshots and data
 * @returns {Object} Paths to output directories
 */
function ensureOutputDirs() {
  // Create an output directory structure
  const outputDir = path.join(process.cwd(), 'twitter-monitor-output');
  const screenshotDir = path.join(outputDir, 'screenshots');
  const dataDir = path.join(outputDir, 'data');
  
  // Create directories if they don't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  return { outputDir, screenshotDir, dataDir };
}

/**
 * Scrape Twitter for tweets containing a keyword using Puppeteer with authenticated session
 * @param {string} keyword Keyword to search for
 * @returns {Promise<Array>} Array of tweet objects
 */
async function scrapeTweets(keyword) {
  if (!fs.existsSync(TWITTER_SESSION_PATH)) {
    console.error(chalk.red(`Twitter session file not found at: ${TWITTER_SESSION_PATH}`));
    return [];
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-features=site-per-process']
  });
  
  try {
    const page = await browser.newPage();
    
    // Prepare for screenshots and data output
    const { screenshotDir, dataDir } = ensureOutputDirs();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    // Set a realistic viewport
    await page.setViewport({ width: 1280, height: 800 });
    
    // Load the Twitter session cookies
    console.log(`Loading Twitter session from: ${TWITTER_SESSION_PATH}`);
    const sessionData = JSON.parse(fs.readFileSync(TWITTER_SESSION_PATH, 'utf8'));
    
    // Set the cookies and localStorage from the session file
    if (sessionData.cookies) {
      await page.setCookie(...sessionData.cookies);
      console.log(`Loaded ${sessionData.cookies.length} cookies from session file`);
    }
    
    try {
      // Navigate to Twitter search - using specific search format from the existing script
      const searchUrl = `https://twitter.com/search?q=${encodeURIComponent(keyword)}&f=live&src=typed_query`;
      console.log(`Navigating to: ${searchUrl}`);
      await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 45000 });
      
      // Check if we're on the right page
      const currentUrl = page.url();
      if (currentUrl.includes('/login') || currentUrl.includes('/i/flow/login')) {
        console.error(chalk.red('Twitter login page detected. Session may have expired.'));
        console.log(chalk.yellow('Please run "ddcli twitter login" to generate a new session.'));
        await page.screenshot({ path: path.join(screenshotDir, `login-redirect-${timestamp}.png`), fullPage: true });
        return [];
      }
    } catch (err) {
      console.error(chalk.red('Error navigating to Twitter search:'), err);
      return [];
    }
    
    // Take initial screenshot
    await page.screenshot({ path: path.join(screenshotDir, `twitter-search-${timestamp}.png`), fullPage: true });
    console.log(`Screenshot saved to screenshots directory`);

    // Scroll to load more tweets
    console.log('Scrolling to load more tweets...');
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Take another screenshot after scrolling (optional)
    await page.screenshot({ path: path.join(screenshotDir, `twitter-search-after-scroll-${timestamp}.png`), fullPage: true });
    
    // Extract tweets using the same approach as the existing script
    const tweets = await page.$$eval('article', articles =>
      articles.map(el => {
        // Extract text
        const text = el.querySelector('[data-testid="tweetText"]')?.innerText || el.innerText;
        
        // Extract user info
        const userBlock = el.querySelector('[data-testid="User-Name"]');
        const spans = userBlock?.querySelectorAll('span') || [];
        
        // Get name and handle
        let name = null;
        let handle = null;
        for (const span of spans) {
          const txt = span.innerText.trim();
          if (txt.startsWith('@')) handle = txt.replace('@', '');
          else if (!name) name = txt;
        }
        
        // Get timestamp
        const timeElement = el.querySelector('time');
        const timestamp = timeElement ? timeElement.getAttribute('datetime') : null;
        
        // Get tweet URL/ID
        const permalink = el.querySelector('a[href*="/status/"]');
        const id = permalink ? 
          permalink.getAttribute('href').split('/status/')[1]?.split(/[?#]/)[0] : 
          `temp-${Math.random().toString(36).substring(2, 15)}`;
          
        // Convert timestamp to a string format to avoid serialization issues
        const tweetDate = timestamp ? new Date(timestamp) : new Date();
        
        // Return the tweet data
        return {
          id,
          user: handle || name || 'unknown',
          text: text || 'No text available',
          date: tweetDate.toISOString(), // Store as ISO string instead of Date object
          url: permalink ? `https://twitter.com${permalink.getAttribute('href')}` : null
        };
      })
    );
    
    // Save the HTML source for debugging (in screenshots dir, less important)
    fs.writeFileSync(
      path.join(screenshotDir, `twitter-page-source-${timestamp}.html`),
      await page.content()
    );
    
    // Save extracted tweets to JSON (in data dir, more important)
    const jsonFilePath = path.join(dataDir, `tweets-${keyword.replace(/\s+/g, '-')}-${timestamp}.json`);
    fs.writeFileSync(
      jsonFilePath,
      JSON.stringify(tweets, null, 2)
    );
    console.log(`Found ${tweets.length} tweets matching "${keyword}"`);
    console.log(`Tweet data saved to: ${jsonFilePath}`);
    
    return tweets;
  } catch (error) {
    console.error(chalk.red('Error scraping tweets:'), error);
    return [];
  } finally {
    await browser.close();
  }
}

/**
 * Monitor Twitter for tweets containing a keyword
 * @param {string} keyword Keyword to search for
 * @param {Object} options Configuration options
 * @param {number} options.interval Polling interval in milliseconds
 * @param {number} options.limit Maximum tweets to keep track of
 */
/**
 * Analyze tweets using OpenAI API
 * @param {Array} tweets Array of tweet objects
 * @param {Object} options Analysis options
 * @returns {Promise<Object>} Structured analysis results
 */
async function analyzeTweets(tweets, options = {}) {
  if (!OPENAI_API_KEY) {
    console.log(chalk.yellow('OpenAI API key not provided. Skipping analysis.'));
    return null;
  }
  
  const { 
    analysisType = 'sentiment', // sentiment, topics, summary, alert
    alertThreshold = 'high', // low, medium, high
    prompt = null
  } = options;
  
  try {
    // Prepare tweets text for analysis
    const tweetTexts = tweets.map(t => t.text).join('\n\n');
    
    // Build system prompt based on analysis type
    let systemPrompt = '';
    switch (analysisType) {
      case 'sentiment':
        systemPrompt = `Analyze the sentiment of these tweets about "${options.keyword}". Provide a structured JSON response with: 
          overall_sentiment (positive, negative, neutral, mixed), 
          sentiment_score (-1.0 to 1.0), 
          prevalent_emotions (array), 
          key_positive_points (array), 
          key_negative_points (array),
          action_items (array)`;
        break;
      case 'topics':
        systemPrompt = `Identify the main topics and themes in these tweets about "${options.keyword}". Provide a structured JSON response with: 
          main_topics (array of topics with counts), 
          subtopics (array), 
          trending_hashtags (array), 
          key_influencers (array of usernames that appear influential),
          related_entities (people, products, companies mentioned)`;
        break;
      case 'summary':
        systemPrompt = `Summarize the key information and insights from these tweets about "${options.keyword}". Provide a structured JSON response with: 
          short_summary (100 words or less), 
          key_points (array), 
          notable_quotes (array), 
          emerging_trends (array),
          recommendations (array)`;
        break;
      case 'alert':
        systemPrompt = `Analyze these tweets about "${options.keyword}" for any concerning content that may require attention. Alert threshold: ${alertThreshold}. Provide a structured JSON response with: 
          alert_level (none, low, medium, high, critical), 
          alert_triggers (array of reasons for alerts),
          priority_messages (array of critical tweets that triggered alerts),
          recommended_actions (array),
          urgency (boolean indicating if immediate action is needed)`;
        break;
      default:
        // Custom analysis with user-provided prompt
        systemPrompt = prompt || `Analyze these tweets about "${options.keyword}" and provide structured insights.`;
    }
    
    const spinner = ora('Analyzing tweets with AI...').start();
    
    const response = await fetch(OPENAI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are an expert social media analyst. ${systemPrompt} Format your response as valid JSON without any additional text.`
          },
          {
            role: 'user',
            content: `Analyze these tweets:\n\n${tweetTexts}`
          }
        ],
        response_format: { type: 'json_object' }
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      spinner.fail('Analysis failed');
      console.error(chalk.red(`API Error: ${errorData.error?.message || 'Unknown error'}`));
      return null;
    }
    
    const data = await response.json();
    spinner.succeed('Tweet analysis completed');
    
    try {
      // Check if there's a valid response
      if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        console.error(chalk.red('Invalid API response:'), JSON.stringify(data, null, 2));
        return null;
      }
      
      // Parse the content as JSON
      const analysisResult = JSON.parse(data.choices[0].message.content);
      return analysisResult;
    } catch (err) {
      console.error(chalk.red('Error parsing analysis result:'), err);
      console.log('Raw response:', data.choices ? 
        (data.choices[0] ? 
          (data.choices[0].message ? 
            data.choices[0].message.content : 'No message content') 
          : 'No choices[0]')
        : 'No choices in response');
      console.log('Full response:', JSON.stringify(data, null, 2));
      return null;
    }
  } catch (err) {
    console.error(chalk.red('Error analyzing tweets:'), err);
    return null;
  }
}

/**
 * Display analysis results in a readable format
 * @param {Object} analysis Analysis results from OpenAI
 * @param {string} analysisType Type of analysis performed
 */
function displayAnalysis(analysis, analysisType) {
  if (!analysis) return;
  
  switch (analysisType) {
    case 'sentiment':
      ui.box(
        `${chalk.bold('Sentiment Analysis')}\n\n` +
        `Overall: ${getSentimentColor(analysis.overall_sentiment)(analysis.overall_sentiment)} (Score: ${analysis.sentiment_score})\n\n` +
        `${chalk.bold('Emotions:')}\n${analysis.prevalent_emotions.map(e => `• ${e}`).join('\n')}\n\n` +
        `${chalk.bold('Positive Points:')}\n${analysis.key_positive_points.map(p => `• ${p}`).join('\n')}\n\n` +
        `${chalk.bold('Negative Points:')}\n${analysis.key_negative_points.map(p => `• ${p}`).join('\n')}\n\n` +
        `${chalk.bold('Suggested Actions:')}\n${analysis.action_items.map(a => `• ${a}`).join('\n')}`,
        { padding: 1, borderColor: 'cyan', borderStyle: 'round' }
      );
      break;
    
    case 'topics':
      ui.box(
        `${chalk.bold('Topic Analysis')}\n\n` +
        `${chalk.bold('Main Topics:')}\n${analysis.main_topics.map(t => `• ${t}`).join('\n')}\n\n` +
        `${chalk.bold('Subtopics:')}\n${analysis.subtopics.map(t => `• ${t}`).join('\n')}\n\n` +
        `${chalk.bold('Trending Hashtags:')}\n${analysis.trending_hashtags.map(h => `• ${h}`).join('\n')}\n\n` +
        `${chalk.bold('Key Influencers:')}\n${analysis.key_influencers.map(i => `• ${i}`).join('\n')}`,
        { padding: 1, borderColor: 'magenta', borderStyle: 'round' }
      );
      break;
    
    case 'summary':
      ui.box(
        `${chalk.bold('Summary Analysis')}\n\n` +
        `${analysis.short_summary}\n\n` +
        `${chalk.bold('Key Points:')}\n${analysis.key_points.map(p => `• ${p}`).join('\n')}\n\n` +
        `${chalk.bold('Notable Quotes:')}\n${analysis.notable_quotes.map(q => `• ${q}`).join('\n')}\n\n` +
        `${chalk.bold('Emerging Trends:')}\n${analysis.emerging_trends.map(t => `• ${t}`).join('\n')}`,
        { padding: 1, borderColor: 'blue', borderStyle: 'round' }
      );
      break;
    
    case 'alert':
      const alertColor = getAlertColor(analysis.alert_level);
      ui.box(
        `${chalk.bold(`Alert Analysis: ${alertColor(analysis.alert_level.toUpperCase())}`)}\n\n` +
        `${chalk.bold('Alert Triggers:')}\n${analysis.alert_triggers.map(t => `• ${t}`).join('\n')}\n\n` +
        `${chalk.bold('Priority Messages:')}\n${analysis.priority_messages.map(m => `• ${m}`).join('\n')}\n\n` +
        `${chalk.bold('Recommended Actions:')}\n${analysis.recommended_actions.map(a => `• ${a}`).join('\n')}\n\n` +
        `${chalk.bold('Urgency:')} ${analysis.urgency ? chalk.red('IMMEDIATE ACTION REQUIRED') : chalk.green('No immediate action required')}`,
        { padding: 1, borderColor: alertColor === chalk.red ? 'red' : alertColor === chalk.yellow ? 'yellow' : 'green', borderStyle: 'round' }
      );
      break;
    
    default:
      // Display raw JSON for custom analysis
      ui.box(
        `${chalk.bold('Custom Analysis')}\n\n` +
        `${JSON.stringify(analysis, null, 2)}`,
        { padding: 1, borderColor: 'white', borderStyle: 'round' }
      );
  }
}

/**
 * Get chalk color function based on sentiment
 * @param {string} sentiment Sentiment value
 * @returns {Function} Chalk color function
 */
function getSentimentColor(sentiment) {
  switch (sentiment.toLowerCase()) {
    case 'positive': return chalk.green;
    case 'negative': return chalk.red;
    case 'mixed': return chalk.yellow;
    default: return chalk.blue;
  }
}

/**
 * Get chalk color function based on alert level
 * @param {string} level Alert level
 * @returns {Function} Chalk color function
 */
function getAlertColor(level) {
  switch (level.toLowerCase()) {
    case 'critical': 
    case 'high': return chalk.red;
    case 'medium': return chalk.yellow;
    case 'low': return chalk.blue;
    default: return chalk.green;
  }
}

/**
 * Monitor Twitter for tweets containing a keyword
 * @param {string} keyword Keyword to search for
 * @param {Object} options Configuration options
 * @param {number} options.interval Polling interval in milliseconds
 * @param {number} options.limit Maximum tweets to keep track of
 * @param {boolean} options.analyze Whether to analyze tweets with AI
 * @param {string} options.analysisType Type of analysis to perform
 */
export function monitorKeyword(keyword, options = {}) {
  const { 
    interval = 5000, 
    limit = 10, 
    analyze = false, 
    analysisType = 'sentiment',
    alertThreshold = 'medium',
    customPrompt = null
  } = options;
  
  let timer = null;
  
  // Function to fetch tweets using Puppeteer with authentication
  const fetchTweets = async () => {
    const spinner = ui.spinner('Fetching tweets...');
    spinner.start();
    
    try {
      // Use Puppeteer to scrape tweets
      const foundTweets = await scrapeTweets(keyword);
      
      spinner.succeed(`Found ${foundTweets.length} tweets matching "${keyword}"`);
      
      // Process new tweets
      let newTweets = [];
      let newTweetsCount = 0;
      
      foundTweets.forEach(tweet => {
        if (!seenTweets.has(tweet.id)) {
          seenTweets.add(tweet.id);
          displayTweet(tweet);
          newTweets.push(tweet);
          newTweetsCount++;
          
          // Keep the set of seen tweets to a reasonable size
          if (seenTweets.size > limit) {
            // Remove oldest entry
            seenTweets.delete([...seenTweets][0]);
          }
        }
      });
      
      if (newTweetsCount === 0) {
        ui.message('No new tweets found', 'info');
      } else if (analyze && newTweets.length > 0) {
        // If AI analysis is enabled and we have new tweets
        ui.message(`Analyzing ${newTweets.length} new tweets...`, 'info');
        
        // Only analyze if we have at least 3 tweets (to make analysis more meaningful)
        if (newTweets.length < 3) {
          ui.message('Not enough tweets for analysis (need at least 3)', 'warning');
        } else {
          const analysisResults = await analyzeTweets(newTweets, { 
            keyword,
            analysisType,
            alertThreshold,
            prompt: customPrompt
          });
        
          if (analysisResults) {
            displayAnalysis(analysisResults, analysisType);
            
            // Save analysis results
            const { dataDir } = ensureOutputDirs();
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const analysisFilePath = path.join(
              dataDir, 
              `analysis-${keyword.replace(/\s+/g, '-')}-${analysisType}-${timestamp}.json`
            );
            
            fs.writeFileSync(
              analysisFilePath,
              JSON.stringify({
                meta: {
                  keyword,
                  timestamp: new Date().toISOString(),
                  analysisType,
                  tweetCount: newTweets.length
                },
                tweets: newTweets,
                analysis: analysisResults
              }, null, 2)
            );
            
            ui.message(`Analysis saved to: ${chalk.blue(analysisFilePath)}`, 'info');
          }
        }
      }
      
      // Show output locations
      const { outputDir, dataDir } = ensureOutputDirs();
      ui.message(`Tweet data saved to: ${chalk.blue(dataDir)}`, 'info');
      
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