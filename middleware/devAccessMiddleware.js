// middleware/devAccessMiddleware.js

/**
 * Middleware to restrict access to the development subdomain
 * 
 * This middleware checks if the request is coming from the development subdomain
 * and restricts access to only authorized users. It can use various methods for authentication:
 * 
 */

import { logApi } from '../utils/logger-suite/logger.js';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fancyColors } from '../utils/colors.js';

// Config
import { config } from '../config/config.js';
const SECURE_MIDDLEWARE_ACCESS_DEBUG_MODE = config.debug_modes.secure_middleware; // Debug mode flag

// Get current directory name
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Middleware to restrict access to the development subdomain
 * 
 * This middleware checks if the request is coming from the development subdomain
 * and restricts access to only authorized users. It can use various methods for authentication:
 * 
 * 1. IP-based authentication (less secure, but simple)
 * 2. Cookie-based authentication (more secure)
 * 3. Special header token authentication (for API access)
 */
export const restrictDevAccess = async (req, res, next) => {
  // Check if the request is for the development subdomain
  const host = req.headers.host;
  const origin = req.headers.origin;
  
  // We'll store the request details and determine access status later
  // This will allow us to log everything in a single line
  let securityMode = SECURE_MIDDLEWARE_ACCESS_DEBUG_MODE ? 'SECURE' : 'RELAXED';
  let authMethod = '';
  let authDetails = '';
  
  // Check if this is the development subdomain or production domain
  const isDev = host?.includes('dev.degenduel.me') || origin?.includes('dev.degenduel.me');
  if (!isDev) {
    // Not trying to access dev.degenduel.me! End restriction checks here and allow all access
    // NOTE: This is an imperfect bypass. Websockets are not handled well.
    return next();
  }

  // Check if this is a websocket (or v69) request
  if (req.url.includes('/ws/') || req.url.includes('v69')) {
    // Log a single line with both security status and access grant
    if (SECURE_MIDDLEWARE_ACCESS_DEBUG_MODE) {
      logApi.info(`${fancyColors.YELLOW}[devAccess]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} ${securityMode} ${fancyColors.RESET} ${fancyColors.DARK_YELLOW}${host}${fancyColors.RESET} ${fancyColors.GRAY}${req.url}${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} GRANTED ${fancyColors.RESET} ${fancyColors.GREEN}Public resource${fancyColors.RESET}`);
    } else {
      logApi.warn(`${fancyColors.YELLOW}[devAccess]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} ${securityMode} ${fancyColors.RESET} ${fancyColors.DARK_YELLOW}${host}${fancyColors.RESET} ${fancyColors.GRAY}${req.url}${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} INSECURE ${fancyColors.RESET} ${fancyColors.RED}WS auth disabled${fancyColors.RESET}`);
    }
    // Automatically grant access to websocket requests
    return next();
  } else {
    // Not a websocket request, proceed normally
  }

  // Check if it has no auth method
  if (!authMethod) {
    // Log a single line with both security status and access grant
    logApi.info(`${fancyColors.YELLOW}[devAccess]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} ${securityMode} ${fancyColors.RESET} ${fancyColors.DARK_YELLOW}${host}${fancyColors.RESET} ${fancyColors.GRAY}${req.url}${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} GRANTED ${fancyColors.RESET} ${fancyColors.GREEN}Public resource${fancyColors.RESET}`);
  }
  
  // Special case: Allow access to the dev-access.js page
  if (req.url === '/dev-access.js') {
    // Log a single line with both security status and access grant
    logApi.info(`${fancyColors.YELLOW}[devAccess]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} ${securityMode} ${fancyColors.RESET} ${fancyColors.DARK_YELLOW}${host}${fancyColors.RESET} ${fancyColors.GRAY}${req.url}${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} GRANTED ${fancyColors.RESET} ${fancyColors.GREEN}Public resource${fancyColors.RESET}`);
    return next();
  }

  // BYPASS ALL WEBSOCKET REQUESTS - no auth needed for WebSockets
  // TODO: WTF???
  //if (req.url.includes('/ws/') || req.url.includes('socket')) {
  //  const wsEndpoint = req.url.split('/').pop();
  //  if (SECURE_MIDDLEWARE_ACCESS_DEBUG_MODE) {
  //    logApi.info(`${fancyColors.YELLOW}[devAccess]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} ${securityMode} ${fancyColors.RESET} ${fancyColors.DARK_YELLOW}${host}${fancyColors.RESET} ${fancyColors.GRAY}${req.url}${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} WS-BYPASS ${fancyColors.RESET} ${fancyColors.LIGHT_YELLOW}${wsEndpoint}${fancyColors.RESET}`);
  //  } else {
  //    logApi.warn(`${fancyColors.YELLOW}[devAccess]${fancyColors.RESET} ${fancyColors.BG_DARK_YELLOW}${fancyColors.BLACK} ${securityMode} ${fancyColors.RESET} ${fancyColors.DARK_YELLOW}${host}${fancyColors.RESET} ${fancyColors.GRAY}${req.url}${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} INSECURE ${fancyColors.RESET} ${fancyColors.RED}WS auth disabled${fancyColors.RESET}`);
  //  }
  //  return next();
  //}
  
  // This is the dev subdomain, check for authorization

  // Check for a special dev access cookie
  const devAccessToken = req.cookies?.devAccess;

  // Method 1: Check for a special dev access cookie
  if (devAccessToken) {
    try {
      // Verify the token
      const decoded = jwt.verify(devAccessToken, config.jwt.secret);
      if (decoded && decoded.authorized) {
        if (SECURE_MIDDLEWARE_ACCESS_DEBUG_MODE) {
          logApi.info(`${fancyColors.YELLOW}[devAccess]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} ${securityMode} ${fancyColors.RESET} ${fancyColors.DARK_YELLOW}${host}${fancyColors.RESET} ${fancyColors.GRAY}${req.url}${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} GRANTED ${fancyColors.RESET} ${fancyColors.GREEN}Auth via cookie token${fancyColors.RESET}`);
        }
        return next();
      }
    } catch (error) {
      if (SECURE_MIDDLEWARE_ACCESS_DEBUG_MODE) {
        logApi.error(`${fancyColors.YELLOW}[devAccess]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} ${securityMode} ${fancyColors.RESET} ${fancyColors.DARK_YELLOW}${host}${fancyColors.RESET} ${fancyColors.GRAY}${req.url}${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} REJECTED ${fancyColors.RESET} ${fancyColors.RED}Invalid cookie token: ${error.message}${fancyColors.RESET}`);
      }
    }
  }
  
  // Method 2: Check for a special header
  const devAccessHeader = req.headers['x-dev-access-token'];
  // Check if the special header token is valid
  if (devAccessHeader === config.secure_middleware.branch_manager_header_token) {
    if (SECURE_MIDDLEWARE_ACCESS_DEBUG_MODE) {
      logApi.info(`${fancyColors.YELLOW}[devAccess]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} ${securityMode} ${fancyColors.RESET} ${fancyColors.DARK_YELLOW}${host}${fancyColors.RESET} ${fancyColors.GRAY}${req.url}${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} GRANTED ${fancyColors.RESET} ${fancyColors.GREEN}Auth via header token${fancyColors.RESET}`);
    }
    
    // Set a cookie for future requests if it doesn't exist
    if (!devAccessToken) {
      logApi.info(`${fancyColors.YELLOW}[devAccess]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} ${securityMode} ${fancyColors.RESET} ${fancyColors.DARK_YELLOW}${host}${fancyColors.RESET} ${fancyColors.GRAY}${req.url}${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} GRANTED ${fancyColors.RESET} ${fancyColors.GREEN}Auth via header token${fancyColors.RESET}`);
      const token = jwt.sign({ authorized: true }, config.jwt.secret, { expiresIn: '30d' });
      res.cookie('devAccess', token, { 
        httpOnly: true, 
        secure: true, 
        sameSite: 'strict',
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
      });
      logApi.info(`${fancyColors.YELLOW}[devAccess]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} ${securityMode} ${fancyColors.RESET} ${fancyColors.DARK_YELLOW}${host}${fancyColors.RESET} ${fancyColors.GRAY}${req.url}${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} GRANTED ${fancyColors.RESET} ${fancyColors.GREEN}Auth via header token${fancyColors.RESET}`);
    }
    
    return next();
  }
  
  // Method 2.5: Check for Branch Manager dev access token in query parameters
  const devAccessQuery = req.query?.devAccess;
  if (devAccessQuery === config.secure_middleware.branch_manager_header_token) {
    if (SECURE_MIDDLEWARE_ACCESS_DEBUG_MODE) {
      // Extract query string for debugging
      const queryString = req.url.includes('?') ? req.url.split('?')[1] : 'none';
      
      logApi.info(`${fancyColors.YELLOW}[devAccess]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} ${securityMode} ${fancyColors.RESET} ${fancyColors.DARK_YELLOW}${host}${fancyColors.RESET} ${fancyColors.GRAY}${req.url}${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} GRANTED ${fancyColors.RESET} ${fancyColors.GREEN}Auth via query param${fancyColors.RESET}`);
    }
    return next();
  }
  
  // Method 3: Check for authorized user session
  const sessionToken = req.cookies?.session;
  if (sessionToken) {
    try {
      // Verify the session token against the JWT secret
      const decoded = jwt.verify(sessionToken, config.jwt.secret);
      const walletAddress = decoded.wallet_address;
      
      // List of authorized wallet addresses
      const authorizedWallets = [
        config.secure_middleware.branch_manager_wallet_address,
        // Add any other authorized wallets here
      ];
      
      // Check if the wallet address is authorized
      if (authorizedWallets.includes(walletAddress)) {
        if (SECURE_MIDDLEWARE_ACCESS_DEBUG_MODE) {
          logApi.info(`${fancyColors.YELLOW}[devAccess]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} ${securityMode} ${fancyColors.RESET} ${fancyColors.DARK_YELLOW}${host}${fancyColors.RESET} ${fancyColors.GRAY}${req.url}${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} GRANTED ${fancyColors.RESET} ${fancyColors.GREEN}Auth via session${fancyColors.RESET} ${fancyColors.YELLOW}${walletAddress.substring(0, 8)}...${fancyColors.RESET}`);
        }
        return next();
      }
    } catch (error) {
      if (SECURE_MIDDLEWARE_ACCESS_DEBUG_MODE) {
        logApi.error(`${fancyColors.YELLOW}[devAccess]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} ${securityMode} ${fancyColors.RESET} ${fancyColors.DARK_YELLOW}${host}${fancyColors.RESET} ${fancyColors.GRAY}${req.url}${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} REJECTED ${fancyColors.RESET} ${fancyColors.RED}Invalid session: ${error.message}${fancyColors.RESET}`);
      }
    }
  }
  
  // Method 4: Check for authorized IP addresses (least secure)
  const clientIp = req.ip || req.connection.remoteAddress;
  // List of all authorized IP addresses
  const authorizedIps = [
    // Branch Manager IP address
    config.secure_middleware.branch_manager_ip_address,
    // Server internal IPs
    '127.0.0.1',
    'localhost',
    // Other authorized IPs
    '69.420.69.420',
  ];
  // Check if the client IP is authorized
  if (authorizedIps.includes(clientIp)) {
    if (SECURE_MIDDLEWARE_ACCESS_DEBUG_MODE) {
      logApi.info(`${fancyColors.YELLOW}[devAccess]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} ${securityMode} ${fancyColors.RESET} ${fancyColors.DARK_YELLOW}${host}${fancyColors.RESET} ${fancyColors.GRAY}${req.url}${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} GRANTED ${fancyColors.RESET} ${fancyColors.GREEN}Auth via IP${fancyColors.RESET} ${fancyColors.GRAY}${clientIp}${fancyColors.RESET}`);
    }
    return next();
  }
  
  // Access denied - return a 403 Forbidden response
  if (SECURE_MIDDLEWARE_ACCESS_DEBUG_MODE) {
    logApi.warn(`${fancyColors.YELLOW}[devAccess]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} ${securityMode} ${fancyColors.RESET} ${fancyColors.DARK_YELLOW}${host}${fancyColors.RESET} ${fancyColors.GRAY}${req.url}${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} DENIED ${fancyColors.RESET} ${fancyColors.RED}No valid credentials${fancyColors.RESET} ${fancyColors.DARK_GRAY}IP:${clientIp}${fancyColors.RESET}`);
  }
  
  // Try to read the access guide HTML file
  try {
    const accessGuidePath = path.join(__dirname, '..', 'public', 'dev-access-guide.html');
    const accessGuideHtml = fs.readFileSync(accessGuidePath, 'utf8');
    return res.status(403).send(accessGuideHtml);
  } catch (error) {
    // If the access guide file doesn't exist, try the access denied file
    try {
      const accessDeniedPath = path.join(__dirname, '..', 'public', 'dev-access-denied.html');
      const accessDeniedHtml = fs.readFileSync(accessDeniedPath, 'utf8');
      return res.status(403).send(accessDeniedHtml);
    } catch (error) {
      // If both files don't exist, return a simple access denied message
      if (SECURE_MIDDLEWARE_ACCESS_DEBUG_MODE) {
        logApi.error('Error reading access HTML files:', error);
      }
      
      // Return a simple access denied message
      return res.status(403).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Access DENIED by Branch Manager</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              background-color: #f5f5f5;
              color: #333;
              text-align: center;
              padding: 50px;
              line-height: 1.6;
            }
            .container {
              max-width: 600px;
              margin: 0 auto;
              background-color: #fff;
              padding: 30px;
              border-radius: 5px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            h1 {
              color: #e74c3c;
            }
            p {
              margin-bottom: 20px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Access DENIED by Branch Manager</h1>
            <p>You have attempted to access a secure DegenDuel environment without proper authorization from the Branch Manager.</p>
            <p>Further attempts to breach DegenDuel security will be harshly treated with the utmost severity. Govern yourself accordingly.</p>
          </div>
        </body>
        </html>
      `);
    }
  }
}; 