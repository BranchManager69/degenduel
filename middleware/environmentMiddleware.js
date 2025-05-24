import { config } from '../config/config.js';
import { logApi } from '../utils/logger-suite/logger.js';
import { fancyColors } from '../utils/colors.js';

// Cache to track which origins we've already logged
const seenOrigins = new Set();

export const environmentMiddleware = (req, res, next) => {
  // Get environment from request origin
  const environment = config.getEnvironment(req.headers.origin);
  
  // Set environment on request object
  req.environment = environment;
  
  // Add environment to request logger context
  if (req.log && typeof req.log.child === 'function') {
    req.log = req.log.child({ environment });
  }
  
  // Format origin for logging - identify internal requests
  let formattedOrigin;
  if (!req.headers.origin) {
    // Try to identify internal service calls
    const path = req.originalUrl || req.url || 'unknown';
    const method = req.method || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    
    // Determine if this is likely an internal service call
    if (
      path.includes('/api/status') || 
      path.includes('/health') || 
      path.includes('/api/v69') ||
      userAgent.includes('node-fetch') ||
      userAgent.includes('axios')
    ) {
      formattedOrigin = `${fancyColors.DARK_CYAN}[INTERNAL SERVICE]${fancyColors.RESET} ${method} ${path}`;
    } else {
      formattedOrigin = `${fancyColors.LIGHT_GRAY}[undefined]${fancyColors.RESET} ${method} ${path}`;
    }
  } else {
    formattedOrigin = req.headers.origin;
  }
  
  // Create a unique key for this request type to avoid duplicate logs
  const requestKey = `${formattedOrigin}|${environment}|${config.services.active_profile}`;
  
  // Helper function to format user info
  const formatUserInfo = () => {
    if (req.user && req.user.wallet_address) {
      const nickname = req.user.nickname || 'No nickname';
      const shortWallet = req.user.wallet_address.slice(0, 3) + '...' + req.user.wallet_address.slice(-4);
      return ` 👤${fancyColors.GREEN}"${nickname}"${fancyColors.RESET} ${fancyColors.GRAY}(${shortWallet})${fancyColors.RESET}`;
    }
    return '';
  };

  // Helper function to create user metadata
  const getUserMetadata = () => {
    return req.user ? {
      wallet_address: req.user.wallet_address,
      nickname: req.user.nickname,
      role: req.user.role
    } : null;
  };
  
  // Debug logging - expanded to include NODE_ENV
  // Only log if:
  // 1. Debug mode is enabled, OR
  // 2. We haven't seen this origin before, OR
  // 3. This is the first request in this session
  if (
    config.debug_mode === 'true' || 
    config.debug_modes.middleware === 'true' ||
    !seenOrigins.has(requestKey) ||
    seenOrigins.size === 0
  ) {
    // Get client IP and user agent for improved logging
    const clientIp = req.ip || 
                    req.headers['x-forwarded-for'] || 
                    req.headers['x-real-ip'] || 
                    req.connection.remoteAddress || 'no-ip';
    const userAgent = req.headers['user-agent'] || 'no-ua';
    
    // Extract OS, browser, and device type info from user agent
    let osInfo = '';
    let browserInfo = '';
    let deviceTypeEmoji = '💻'; // Default to desktop emoji
    let osEmoji = '❓';        // Default OS emoji
    let browserEmoji = '❓';   // Default browser emoji
    
    if (userAgent) {
      // Detect device type first (mobile vs desktop)
      const isMobile = /Mobile|Android|iPhone|iPad|iPod|Windows Phone|IEMobile/i.test(userAgent);
      deviceTypeEmoji = isMobile ? '📱' : '💻';
      
      // Detect OS with version and assign emoji
      if (userAgent.includes('iPhone') || userAgent.includes('iPad')) {
        const iosMatch = userAgent.match(/OS (\d+[._]\d+)/);
        osInfo = iosMatch ? `iOS ${iosMatch[1].replace('_', '.')}` : 'iOS';
        osEmoji = '🍎'; // Apple emoji for iOS
      } else if (userAgent.includes('Android')) {
        const androidMatch = userAgent.match(/Android (\d+(\.\d+)?)/);
        osInfo = androidMatch ? `Android ${androidMatch[1]}` : 'Android';
        osEmoji = '🤖'; // Robot emoji for Android
      } else if (userAgent.includes('Windows')) {
        osInfo = 'Windows';
        osEmoji = '🪟'; // Window emoji for Windows
      } else if (userAgent.includes('Mac OS X')) {
        osInfo = 'macOS';
        osEmoji = '🍎'; // Apple emoji for macOS
      } else if (userAgent.includes('Linux')) {
        osInfo = 'Linux';
        osEmoji = '🐧'; // Penguin emoji for Linux (Tux)
      } else {
        osInfo = 'Unknown OS';
        osEmoji = '❓'; // Question mark for unknown OS
      }
      
      // Detect browser separately and assign emoji
      if (userAgent.includes('Chrome') && !userAgent.includes('Edge')) {
        browserInfo = 'Chrome';
        browserEmoji = '🌐'; // Globe with meridians for Chrome
      } else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) {
        browserInfo = 'Safari';
        browserEmoji = '🧭'; // Compass emoji for Safari
      } else if (userAgent.includes('Firefox')) {
        browserInfo = 'Firefox';
        browserEmoji = '🦊'; // Fox emoji for Firefox
      } else if (userAgent.includes('Edge')) {
        browserInfo = 'Edge';
        browserEmoji = '💠'; // Diamond with dot for Edge
      } else if (userAgent.includes('MSIE') || userAgent.includes('Trident/')) {
        browserInfo = 'IE';
        browserEmoji = '🔄'; // Arrows in circle for Internet Explorer (legacy)
      } else {
        browserInfo = 'Unknown Browser';
        browserEmoji = '❓'; // Question mark for unknown browser
      }
    }
    
    // Format method and path with colors
    const methodColor = req.method === 'GET' ? fancyColors.BLUE : 
                        req.method === 'POST' ? fancyColors.GREEN :
                        req.method === 'PUT' ? fancyColors.YELLOW :
                        req.method === 'DELETE' ? fancyColors.RED : fancyColors.CYAN;
                        
    const formattedMethod = `${methodColor}${req.method}${fancyColors.RESET}`;
    const formattedPath = `${fancyColors.BOLD}${req.originalUrl || req.url}${fancyColors.RESET}`;
    
    // Format OS and browser info
    const formattedOS = osInfo ? `${fancyColors.CYAN}${osInfo}${fancyColors.RESET}` : '';
    const formattedBrowser = browserInfo ? `${fancyColors.PURPLE}${browserInfo}${fancyColors.RESET}` : '';
    
    // Format IP clearly
    const formattedIP = `${fancyColors.YELLOW}${clientIp}${fancyColors.RESET}`;
    
    // Use the IPInfo service to get location data (if available in logApi)
    if (typeof logApi.getIpInfo === 'function') {
      try {
        // Use the existing getIpInfo function to avoid duplicating logic
        logApi.getIpInfo(clientIp).then(ipInfo => {
          let locationInfo = '';
          
          // Only add location if we have valid data
          if (ipInfo && !ipInfo.bogon && !ipInfo.error) {
            locationInfo = `${ipInfo.city || ''}${ipInfo.region ? ', ' + ipInfo.region : ''}${ipInfo.country ? ' (' + ipInfo.country + ')' : ''}`;
          }
          
          const userInfo = formatUserInfo();
          
          // Format the final log with vertical bars and proper spacing (all on one line)
          const logMessage = `${fancyColors.DARK_GRAY}[Env]${fancyColors.RESET} ${formattedMethod} ${formattedPath} ${deviceTypeEmoji}|${osEmoji}${browserEmoji} ${formattedIP}${locationInfo ? ' 🌎' + locationInfo : ''}${userInfo}`;
          
          // Send the log with minimal metadata in the JSON
          logApi.info(logMessage, { 
            environment,
            origin: req.headers.origin || 'internal',
            path: req.originalUrl || req.url,
            user: getUserMetadata()
          });
        }).catch(() => {
          const userInfo = formatUserInfo();
          
          // If IPInfo fails, fall back to a simpler log without location
          const logMessage = `${fancyColors.DARK_GRAY}[Env]${fancyColors.RESET} ${formattedMethod} ${formattedPath} ${deviceTypeEmoji}|${osEmoji}${browserEmoji} ${formattedIP}${userInfo}`;
          
          logApi.info(logMessage, { 
            environment,
            origin: req.headers.origin || 'internal',
            path: req.originalUrl || req.url,
            user: getUserMetadata()
          });
        });
      } catch (error) {
        const userInfo = formatUserInfo();
        
        // Fallback if getIpInfo fails completely
        const logMessage = `${fancyColors.DARK_GRAY}[Env]${fancyColors.RESET} ${formattedMethod} ${formattedPath} ${deviceTypeEmoji}|${osEmoji}${browserEmoji} ${formattedIP}${userInfo}`;
        
        logApi.info(logMessage, { 
          environment,
          origin: req.headers.origin || 'internal',
          path: req.originalUrl || req.url,
          user: getUserMetadata()
        });
      }
    } else {
      const userInfo = formatUserInfo();
      
      // If IPInfo service isn't available, use the simple format
      const logMessage = `${fancyColors.DARK_GRAY}[Env]${fancyColors.RESET} ${formattedMethod} ${formattedPath} ${deviceTypeEmoji}|${osEmoji}${browserEmoji} ${formattedIP}${userInfo}`;
      
      logApi.info(logMessage, { 
        environment,
        origin: req.headers.origin || 'internal',
        path: req.originalUrl || req.url,
        user: getUserMetadata()
      });
    }
    
    // Add to seen origins
    seenOrigins.add(requestKey);
    
    // Prevent the set from growing too large over time
    if (seenOrigins.size > 100) {
      seenOrigins.clear();
    }
  }
  
  next();
}; 
