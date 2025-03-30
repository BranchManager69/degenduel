// scripts/twitter/utils/log-visible-elements.cjs

/**
 * This script is used to save the visible elements and data from a tweet page.
 * It is used to help debug the scraping process.
 * 
 * Usage:
 *   node log-visible-elements.cjs <tweet_url> [--format=md|json|txt|html]
 * 
 * @param {string} tweetUrl - The URL of the tweet to save the visible elements of.
 * @param {string} format - The output format (md, json, txt, html).
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
let outputFormat = 'md'; // Default format
let fixedTimestamp = null; // For coordinating multiple format outputs to same folder

// Check for format argument
const formatArg = args.find(arg => arg.startsWith('--format='));
if (formatArg) {
  const format = formatArg.split('=')[1].toLowerCase();
  if (['md', 'json', 'txt', 'html'].includes(format)) {
    outputFormat = format;
    // Remove format argument from args
    args.splice(args.indexOf(formatArg), 1);
  } else {
    console.error('Invalid format. Supported formats: md, json, txt, html');
    process.exit(1);
  }
}

// Check for timestamp argument
const timestampArg = args.find(arg => arg.startsWith('--timestamp='));
if (timestampArg) {
  fixedTimestamp = timestampArg.split('=')[1];
  // Remove timestamp argument from args
  args.splice(args.indexOf(timestampArg), 1);
}

// Output the visible elements to a file in the same directory as the results to help debugging
const OUTPUT_DIR = process.env.CUSTOM_OUTPUT_DIR || 'scrapes/';
const OUTPUT_FILE = process.env.CUSTOM_OUTPUT_FILE || `visible-elements.${outputFormat}`;

// Get formatted date-time string without colons for folder naming
function getFormattedDateTime() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0'); // Already 24-hour format
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  
  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

// Get the current working directory
const cwd = process.cwd();

// Get the output directory
const outputDir = path.join(cwd, OUTPUT_DIR);

// Run the script
(async () => {
  const tweetUrl = args[0];
  if (!tweetUrl) {
    console.error('Usage: node scripts/twitter/utils/log-visible-elements.cjs <tweet_url> [--format=md|json|txt|html]');
    process.exit(1);
  }

  // Launch the browser
  const browser = await chromium.launch({
    headless: true,
  });

  // Create a new context with the Twitter session
  const context = await browser.newContext({
    storageState: path.join(cwd, 'keys/twitter-session.json'),
  });

  // Create a new page
  const page = await context.newPage();
  console.log('[*] Navigating to tweet...');
  await page.goto(tweetUrl, { waitUntil: 'domcontentloaded' });

  // Scroll the page 5 times to load all the elements
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Log the visible <span> elements with text (count only, not content)
  console.log('\n[*] Extracting visible <span> elements...');
  const spanTexts = await page.$$eval('span', spans =>
    spans
      .map(span => span.innerText.trim())
      .filter(text => text.length > 0)
  );
  console.log(`[*] Found ${spanTexts.filter((v, i, a) => a.indexOf(v) === i).length} unique span elements`);

  // Log the visible <button> elements with text (count only, not content)
  console.log('\n[*] Extracting visible <button> elements...');
  const buttonTexts = await page.$$eval('button', buttons =>
    buttons
      .map(btn => btn.innerText.trim())
      .filter(text => text.length > 0)
  );
  console.log(`[*] Found ${buttonTexts.filter((v, i, a) => a.indexOf(v) === i).length} unique button elements`);
  
  // Extract enhanced tweet data
  console.log('\n[*] Extracting enhanced tweet data...');
  
  // Get tweet author info
  const authorData = await page.evaluate(() => {
    const authorElement = document.querySelector('a[role="link"][href*="/status/"]').closest('div[data-testid="cellInnerDiv"]');
    const nameElement = authorElement?.querySelector('a[role="link"] span:not([data-testid])');
    const handleElement = authorElement?.querySelector('a[role="link"] span[data-testid="tweetAuthorUsername"]');
    
    return {
      name: nameElement?.innerText?.trim() || "",
      handle: handleElement?.innerText?.trim() || "",
      avatarSrc: authorElement?.querySelector('img[src*="profile_images"]')?.src || ""
    };
  });
  
  // Get tweet content
  const tweetContent = await page.evaluate(() => {
    const tweetTextElement = document.querySelector('div[data-testid="tweetText"]');
    return tweetTextElement?.innerText?.trim() || "";
  });
  
  // Get tweet metrics
  const metrics = await page.evaluate(() => {
    const metricsContainer = document.querySelector('div[role="group"]');
    if (!metricsContainer) return {};
    
    const likesElement = metricsContainer.querySelector('div[data-testid="like"]');
    const retweetsElement = metricsContainer.querySelector('div[data-testid="retweet"]');
    const viewsElement = document.querySelector('span[data-testid="app-text-transition-container"]');
    
    return {
      likes: likesElement?.innerText?.trim() || "0",
      retweets: retweetsElement?.innerText?.trim() || "0",
      views: viewsElement?.innerText?.trim() || "0"
    };
  });
  
  // Get media elements
  const mediaUrls = await page.evaluate(() => {
    const mediaElements = Array.from(document.querySelectorAll('img[src*="/media/"]'));
    return mediaElements.map(img => img.src);
  });
  
  // Get timestamp
  const timestamp = await page.evaluate(() => {
    const timeElement = document.querySelector('time');
    return {
      datetime: timeElement?.getAttribute('datetime') || "",
      displayText: timeElement?.innerText?.trim() || ""
    };
  });
  
  // Combine all the enhanced data
  const enhancedTweetData = {
    url: tweetUrl,
    author: authorData,
    content: tweetContent,
    metrics,
    media: mediaUrls,
    timestamp,
    quoted: null, // Could extract quoted tweet data if needed
    replies: [] // Could extract reply data if needed
  };

  // Create the output directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log(`[*] Created output directory: ${outputDir}`);
  }

  // Collect the visible elements
  const visibleElements = {
    spans: spanTexts.filter((v, i, a) => a.indexOf(v) === i),
    buttons: buttonTexts.filter((v, i, a) => a.indexOf(v) === i),
    enhancedTweetData: enhancedTweetData
  };

  // Determine directory structure
  let timestampDir;
  
  // If CUSTOM_OUTPUT_DIR is set, we're being called by the unified scraper
  // and should not create our own timestamped directory
  if (process.env.CUSTOM_OUTPUT_DIR) {
    timestampDir = process.env.CUSTOM_OUTPUT_DIR;
  } else {
    // Standard behavior - create a timestamped directory
    const dirTimestamp = fixedTimestamp || getFormattedDateTime();
    timestampDir = path.join(outputDir, dirTimestamp);
  }
  
  // Create timestamped directory if it doesn't exist
  if (!fs.existsSync(timestampDir)) {
    fs.mkdirSync(timestampDir, { recursive: true });
  }
  
  // Return the timestamp for potential reuse (only if we're not using CUSTOM_OUTPUT_DIR)
  if (!process.env.CUSTOM_OUTPUT_DIR && typeof dirTimestamp !== 'undefined') {
    console.log(`[*] Using timestamp: ${dirTimestamp}`);
  }
  
  // Create the output file in timestamped directory
  const outputFile = path.join(timestampDir, OUTPUT_FILE);

  // Generate output based on format
  let outputContent = '';
  
  // Format the output based on the selected format
  switch (outputFormat) {
    case 'json':
      outputContent = JSON.stringify(visibleElements, null, 2);
      break;
      
    case 'txt':
      outputContent = `TWEET ELEMENTS FOR: ${tweetUrl}\n\n` +
        `TWEET AUTHOR: ${enhancedTweetData.author.name} (${enhancedTweetData.author.handle})\n` +
        `TWEET CONTENT: ${enhancedTweetData.content}\n\n` +
        `METRICS:\n` +
        `- Likes: ${enhancedTweetData.metrics.likes}\n` +
        `- Retweets: ${enhancedTweetData.metrics.retweets}\n` +
        `- Views: ${enhancedTweetData.metrics.views}\n\n` +
        `TIMESTAMP: ${enhancedTweetData.timestamp.displayText} (${enhancedTweetData.timestamp.datetime})\n\n` +
        `MEDIA URLs:\n${enhancedTweetData.media.map(url => `- ${url}`).join('\n')}\n\n` +
        `VISIBLE SPAN ELEMENTS:\n${visibleElements.spans.map(text => `- ${text}`).join('\n')}\n\n` +
        `VISIBLE BUTTON ELEMENTS:\n${visibleElements.buttons.map(text => `- ${text}`).join('\n')}`;
      break;
      
    case 'html':
      outputContent = `
<!DOCTYPE html>
<html>
<head>
  <title>Tweet Analysis: ${enhancedTweetData.author.handle}</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; max-width: 800px; margin: 0 auto; }
    h1, h2, h3 { color: #1DA1F2; }
    .tweet-card { border: 1px solid #ccc; border-radius: 12px; padding: 15px; margin-bottom: 20px; }
    .author-info { display: flex; align-items: center; margin-bottom: 15px; }
    .avatar { width: 50px; height: 50px; border-radius: 50%; margin-right: 15px; }
    .author-name { font-weight: bold; margin: 0; }
    .author-handle { color: #536471; margin: 0; }
    .tweet-content { font-size: 18px; line-height: 1.4; margin-bottom: 15px; }
    .metrics { display: flex; gap: 20px; color: #536471; margin-bottom: 15px; }
    .metric { display: flex; align-items: center; }
    .media-section img { max-width: 100%; border-radius: 12px; margin-bottom: 15px; }
    .data-section { border-top: 1px solid #eee; padding-top: 20px; margin-top: 20px; }
    ul { padding-left: 20px; }
    li { margin-bottom: 5px; }
  </style>
</head>
<body>
  <h1>Tweet Analysis</h1>
  <p>URL: <a href="${tweetUrl}" target="_blank">${tweetUrl}</a></p>
  
  <div class="tweet-card">
    <div class="author-info">
      ${enhancedTweetData.author.avatarSrc ? `<img src="${enhancedTweetData.author.avatarSrc}" class="avatar" alt="${enhancedTweetData.author.name}" />` : ''}
      <div>
        <p class="author-name">${enhancedTweetData.author.name}</p>
        <p class="author-handle">${enhancedTweetData.author.handle}</p>
      </div>
    </div>
    
    <div class="tweet-content">${enhancedTweetData.content.replace(/\n/g, '<br>')}</div>
    
    <div class="metrics">
      <div class="metric">❤️ ${enhancedTweetData.metrics.likes}</div>
      <div class="metric">🔁 ${enhancedTweetData.metrics.retweets}</div>
      <div class="metric">👁️ ${enhancedTweetData.metrics.views}</div>
    </div>
    
    <div class="timestamp">${enhancedTweetData.timestamp.displayText}</div>
    
    ${enhancedTweetData.media.length > 0 ? 
      `<div class="media-section">
        ${enhancedTweetData.media.map(url => `<img src="${url}" alt="Tweet media" />`).join('')}
      </div>` : ''}
  </div>
  
  <div class="data-section">
    <h2>Visible Span Elements</h2>
    <ul>
      ${visibleElements.spans.map(text => `<li>${text}</li>`).join('\n      ')}
    </ul>
    
    <h2>Visible Button Elements</h2>
    <ul>
      ${visibleElements.buttons.map(text => `<li>${text}</li>`).join('\n      ')}
    </ul>
  </div>
</body>
</html>`;
      break;
      
    case 'md':
    default:
      outputContent = `# Tweet Analysis: ${enhancedTweetData.author.handle}
URL: ${tweetUrl}

## Tweet Details

### Author
- **Name**: ${enhancedTweetData.author.name}
- **Handle**: ${enhancedTweetData.author.handle}
${enhancedTweetData.author.avatarSrc ? `- **Avatar**: ${enhancedTweetData.author.avatarSrc}` : ''}

### Content
${enhancedTweetData.content}

### Metrics
- **Likes**: ${enhancedTweetData.metrics.likes}
- **Retweets**: ${enhancedTweetData.metrics.retweets}
- **Views**: ${enhancedTweetData.metrics.views}

### Timestamp
- **Display**: ${enhancedTweetData.timestamp.displayText}
- **Datetime**: ${enhancedTweetData.timestamp.datetime}

### Media
${enhancedTweetData.media.length > 0 ? enhancedTweetData.media.map(url => `- ${url}`).join('\n') : '- No media found'}

## Raw Elements

### Visible Span Elements
${visibleElements.spans.map(text => `- ${text}`).join('\n')}

### Visible Button Elements
${visibleElements.buttons.map(text => `- ${text}`).join('\n')}
`;
      break;
  }

  // Save the formatted elements to the output file
  fs.writeFileSync(outputFile, outputContent);

  // Close the browser
  await browser.close();
})();