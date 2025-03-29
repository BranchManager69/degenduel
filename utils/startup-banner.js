// utils/startup-banner.js
// Spectacular server startup banner with gradient colors and perfect alignment

import chalk from 'chalk';
import gradient from 'gradient-string';
import boxen from 'boxen';
import figlet from 'figlet';

/**
 * Creates a spectacular server startup banner
 * @param {Object} options - Banner options
 * @param {number} options.port - Server port
 * @param {string} options.startupTime - Formatted startup time 
 * @param {number} options.onlineServices - Number of online services
 * @param {number} options.totalServices - Total number of services
 * @param {boolean} options.success - If server started successfully
 * @param {string} options.environment - Current environment (dev/prod)
 * @returns {string} - Spectacular banner string
 */
export function createStartupBanner(options) {
  const {
    port = 3004,
    startupTime = '0.00s',
    onlineServices = 0,
    totalServices = 0,
    success = true,
    environment = 'development'
  } = options;

  // Create vibrant gradient colors based on success and environment
  // Title gradient - more vibrant colors
  const titleGradient = success 
    ? gradient(['#FF0099', '#493240', '#00CCFF']) // Vibrant pink to blue
    : gradient(['#FF5F6D', '#2C3E50']); // Red to dark blue for error state
  
  // Details gradient - gold/green for success, purple/blue for errors
  const detailsGradient = success
    ? gradient(['#FFD700', '#00FF00']) // Gold to green
    : gradient(['#9D50BB', '#6E48AA']); // Purple gradient
  
  // Border gradient - based on environment
  const borderGradient = environment === 'production'
    ? gradient(['#FF0000', '#FF8C00', '#FFFF00']) // Hot fire gradient
    : gradient(['#00FFFF', '#0099FF', '#0033FF']); // Cool blue gradient

  // Create a more reliable figlet title with proper spacing
  const title = figlet.textSync('DEGEN DUEL', {
    font: 'Small',
    horizontalLayout: 'default',
    width: 60,
    whitespaceBreak: true
  });

  // Define status line with perfect centering
  const statusText = success ? '🚀 SERVER ONLINE' : '⚠️ SERVER ERRORS';
  // Center the status text
  const statusLine = success
    ? chalk.greenBright.bold(`             ${statusText}             `)
    : chalk.redBright.bold(`             ${statusText}             `);

  // Create detail lines with perfect right-aligned padding
  const statusSymbol = success ? '✓' : '✗';
  // Add extra padding to ensure alignment with the right border
  const portLine        = `${chalk.cyanBright('⚙️')}  ${chalk.blueBright('PORT:')}       ${chalk.yellowBright(port.toString().padEnd(24))}`;
  const timeLine        = `${chalk.cyanBright('⏱️')}  ${chalk.blueBright('STARTUP:')}    ${chalk.yellowBright(startupTime.padEnd(24))}`;
  const servicesLine    = `${chalk.cyanBright('🔗')}  ${chalk.blueBright('SERVICES:')}   ${chalk.yellowBright(`${onlineServices}/${totalServices} Online`.padEnd(24))}`;
  const environmentLine = `${chalk.cyanBright('🌐')}  ${chalk.blueBright('ENV:')}        ${environment === 'production' ? chalk.redBright('🔥 PRODUCTION'.padEnd(24)) : chalk.greenBright('🧪 DEVELOPMENT'.padEnd(24))}`;
  const statusDetailLine = `${chalk.cyanBright('📊')}  ${chalk.blueBright('STATUS:')}     ${success ? chalk.greenBright('Fully Operational'.padEnd(23)) : chalk.redBright('Issues Detected'.padEnd(23))}`;

  // Format glory message with random emoji decorations
  const gloryEmojis = ['⚔️', '🏆', '💎', '🚀', '🔥', '💰', '🎮', '👑', '💪', '🏅'];
  const randEmoji1 = gloryEmojis[Math.floor(Math.random() * gloryEmojis.length)];
  const randEmoji2 = gloryEmojis[Math.floor(Math.random() * gloryEmojis.length)];
  
  // Create rainbow effect for the glory line
  const rainbowGradient = gradient(['#FF0000', '#FF7F00', '#FFFF00', '#00FF00', '#0000FF', '#4B0082', '#8B00FF']);
  const gloryText = '✨ GLORY AWAITS ✨';
  
  // Center the glory line
  const gloryLine = `          ${randEmoji1}  ${rainbowGradient(gloryText)}  ${randEmoji2}          `;

  // Generate timestamp with better formatting
  const now = new Date();
  const dateOptions = { year: 'numeric', month: 'numeric', day: 'numeric' };
  const timeOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true };
  const formattedDate = now.toLocaleDateString('en-US', dateOptions);
  const formattedTime = now.toLocaleTimeString('en-US', timeOptions);
  const timestampLine = chalk.gray(`Launched: ${formattedDate} at ${chalk.white(formattedTime)}`);

  // Build the banner content with vibrant colors
  const content = [
    titleGradient(title),
    '',
    statusLine,
    '',
    portLine,
    timeLine,
    servicesLine,
    environmentLine,
    statusDetailLine,
    '',
    gloryLine,
    '',
    timestampLine
  ].join('\n');

  // Create the boxed output with fancy border optimized for console width
  // Use a more adaptive approach for PM2 logs
  return boxen(content, {
    borderStyle: 'double', // More distinctive border style
    borderColor: success 
      ? environment === 'production' ? 'redBright' : 'cyanBright' 
      : 'yellowBright',
    padding: 1,
    margin: 0, // Remove margin for cleaner server logs
    // Don't set fixed width to allow natural content width
    float: 'center',
    title: environment === 'production' 
      ? '💥 PRODUCTION 💥'
      : '🚀 DEVELOPMENT',
    titleAlignment: 'center'
  });
}

/**
 * Display a spectacular startup banner with animation
 * @param {number} port - The server port
 * @param {Object} initResults - Service initialization results
 * @param {boolean} success - Whether server started successfully
 * @param {string} environment - Current environment
 */
export function displayStartupBanner(port, initResults = {}, success = true) {
  // Helper to format time
  const formatDuration = (seconds) => {
    if (seconds < 60) return `${seconds.toFixed(2)}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds.toFixed(0)}s`;
  };

  // Get service metrics from initResults
  const initializedServices = initResults.Services?.initialized || [];
  const failedServices = initResults.Services?.failed || [];
  
  // Get environment
  const environment = process.env.NODE_ENV || 'development';
  
  // Calculate total services
  const totalServices = (initializedServices.length + failedServices.length) || 1;
  
  // Get duration
  const duration = formatDuration(process.uptime());
  
  // Create and display the banner
  const banner = createStartupBanner({
    port,
    startupTime: duration,
    onlineServices: initializedServices.length,
    totalServices,
    success,
    environment
  });
  
  console.log(banner);
  
  // Return true to indicate banner was displayed
  return true;
}

export default displayStartupBanner;