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

  // SUPER ENHANCED WEBSOCKET DETECTION:
  // 1. Check for the _isWebSocketRequest flag from the websocketBypassMiddleware
  // 2. Check all common WebSocket URL patterns
  // 3. Check for WebSocket upgrade headers
  const isWebSocketRequest = (
    // Check for flag from bypass middleware
    req._isWebSocketRequest === true ||
    // Check for WebSocket URLs (any common pattern)
    req.url.includes('/api/v69/ws/') || 
    req.url.includes('/ws/') ||
    req.url.includes('/socket') ||
    req.url.includes('/websocket') ||
    // Check for WebSocket headers
    (req.headers && 
     req.headers.upgrade && 
     req.headers.upgrade.toLowerCase() === 'websocket') ||
    // Check for WebSocket protocols
    (req.headers && 
     req.headers['sec-websocket-protocol'])
  );
  
  if (isWebSocketRequest) {
    // Log with different verbosity based on debug mode
    if (SECURE_MIDDLEWARE_ACCESS_DEBUG_MODE === true) {
      // Enhanced logging with WebSocket details
      logApi.info(`${fancyColors.YELLOW}[devAccess]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} WS-BYPASS ${fancyColors.RESET} Bypassing auth for WebSocket: ${req.url}`, {
        headers: {
          upgrade: req.headers.upgrade,
          connection: req.headers.connection,
          'sec-websocket-key': req.headers['sec-websocket-key'] ? '(present)' : '(missing)',
          'sec-websocket-version': req.headers['sec-websocket-version'],
          'sec-websocket-protocol': req.headers['sec-websocket-protocol'],
          'sec-websocket-extensions': req.headers['sec-websocket-extensions']
        },
        wsEvent: 'dev_access_bypass',
        bypass_reason: req._isWebSocketRequest ? 'early_bypass_middleware' : 'websocket_pattern',
        _highlight: true
      });
    } else {
      // Simpler logging for production
      logApi.warn(`${fancyColors.YELLOW}[devAccess]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} WS-BYPASS ${fancyColors.RESET} Bypassing auth for WebSocket: ${req.url}`);
    }
    
    // Automatically grant access to all WebSocket requests
    return next();
  } else {
    // Not a WebSocket request, continue with normal processing
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

  // Method 1: Check for special dev access cookie
  if (devAccessToken) {
    try {
      // Verify special dev access token if it exists
      const decoded = jwt.verify(devAccessToken, config.jwt.secret);
      if (decoded && decoded.authorized) {
        if (SECURE_MIDDLEWARE_ACCESS_DEBUG_MODE === true) {
          logApi.info(`${fancyColors.YELLOW}[devAccess]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} ${securityMode} ${fancyColors.RESET} ${fancyColors.DARK_YELLOW}${host}${fancyColors.RESET} ${fancyColors.GRAY}${req.url}${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} GRANTED ${fancyColors.RESET} ${fancyColors.GREEN}Auth via cookie token${fancyColors.RESET}`);
        }
        // Grant access
        return next();
      } else {
        // Log the miss if in debug mode
        if (SECURE_MIDDLEWARE_ACCESS_DEBUG_MODE === true) {
          logApi.warn(`${fancyColors.YELLOW}[devAccess]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} ${securityMode} ${fancyColors.RESET} ${fancyColors.DARK_YELLOW}${host}${fancyColors.RESET} ${fancyColors.GRAY}${req.url}${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} REJECTED ${fancyColors.RESET} ${fancyColors.RED}Invalid cookie token: ${error.message}${fancyColors.RESET}`);
        }
      }
    } catch (error) {
      if (SECURE_MIDDLEWARE_ACCESS_DEBUG_MODE === true) {
        logApi.error(`${fancyColors.YELLOW}[devAccess]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} ${securityMode} ${fancyColors.RESET} ${fancyColors.DARK_YELLOW}${host}${fancyColors.RESET} ${fancyColors.GRAY}${req.url}${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} REJECTED ${fancyColors.RESET} ${fancyColors.RED}Invalid cookie token: ${error.message}${fancyColors.RESET}`);
      }
    }
  }
  
  // Method 2: Check for special dev access header
  const devAccessHeader = req.headers['x-dev-access-token'];
  // Check if the special header token is valid
  if (devAccessHeader === config.secure_middleware.branch_manager_header_token) {
    if (SECURE_MIDDLEWARE_ACCESS_DEBUG_MODE === true) {
      logApi.info(`${fancyColors.YELLOW}[devAccess]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} ${securityMode} ${fancyColors.RESET} ${fancyColors.DARK_YELLOW}${host}${fancyColors.RESET} ${fancyColors.GRAY}${req.url}${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} GRANTED ${fancyColors.RESET} ${fancyColors.GREEN}Auth via header token${fancyColors.RESET}`);
    }
    
    // Set a special dev access cookie for future requests if it doesn't exist
    if (!devAccessToken) {
      // Log the cookie set attempt
      logApi.info(`${fancyColors.YELLOW}[devAccess]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} ${securityMode} ${fancyColors.RESET} ${fancyColors.DARK_YELLOW}${host}${fancyColors.RESET} ${fancyColors.GRAY}${req.url}${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} GRANTED ${fancyColors.RESET} ${fancyColors.GREEN}Auth via header token${fancyColors.RESET}`);
      const token = jwt.sign({ authorized: true }, config.jwt.secret, { expiresIn: '30d' });
      res.cookie('devAccess', token, { 
        httpOnly: true, 
        secure: true, 
        sameSite: 'strict',
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
      });
      // Log the cookie set
      logApi.info(`${fancyColors.YELLOW}[devAccess]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} ${securityMode} ${fancyColors.RESET} ${fancyColors.DARK_YELLOW}${host}${fancyColors.RESET} ${fancyColors.GRAY}${req.url}${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} GRANTED ${fancyColors.RESET} ${fancyColors.GREEN}Auth via header token${fancyColors.RESET}`);
    }
    // Grant access
    return next();
  } else {
    // Log the miss if in debug mode
    if (SECURE_MIDDLEWARE_ACCESS_DEBUG_MODE === true) {
      logApi.warn(`${fancyColors.YELLOW}[devAccess]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} ${securityMode} ${fancyColors.RESET} ${fancyColors.DARK_YELLOW}${host}${fancyColors.RESET} ${fancyColors.GRAY}${req.url}${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} REJECTED ${fancyColors.RESET} ${fancyColors.RED}Invalid cookie token: ${error.message}${fancyColors.RESET}`);
    }
  }

  // Method 2.5: Check for Branch Manager dev access token in query parameters
  const devAccessQuery = req.query?.devAccess;
  // Check if the special query token is valid
  if (devAccessQuery === config.secure_middleware.branch_manager_header_token) {
    if (SECURE_MIDDLEWARE_ACCESS_DEBUG_MODE === true) {
      // Extract query string for debugging
      const queryString = req.url.includes('?') ? req.url.split('?')[1] : 'none';
      logApi.info(`${fancyColors.YELLOW}[devAccess]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} ${securityMode} ${fancyColors.RESET} ${fancyColors.DARK_YELLOW}${host}${fancyColors.RESET} ${fancyColors.GRAY}${req.url}${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} GRANTED ${fancyColors.RESET} ${fancyColors.GREEN}Auth via query param${fancyColors.RESET} ${fancyColors.GRAY}${queryString}${fancyColors.RESET}`);
    }
    // Grant access
    return next();
  } else {
    // Log the miss if in debug mode
    if (SECURE_MIDDLEWARE_ACCESS_DEBUG_MODE === true) {
      logApi.warn(`${fancyColors.YELLOW}[devAccess]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} ${securityMode} ${fancyColors.RESET} ${fancyColors.DARK_YELLOW}${host}${fancyColors.RESET} ${fancyColors.GRAY}${req.url}${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} REJECTED ${fancyColors.RESET} ${fancyColors.RED}Invalid cookie token: ${error.message}${fancyColors.RESET}`);
    }
  }
  
  // Method 3: Check for authorized user session
  const sessionToken = req.cookies?.session;
  // Check if there is a session token
  if (sessionToken) {
    try {
      // Verify session token against the JWT secret
      const decoded = jwt.verify(sessionToken, config.jwt.secret);
      const walletAddress = decoded.wallet_address;
      
      // List of "authorized" "wallet addresses" (hmm...)
      const authorizedWallets = [
        config.secure_middleware.branch_manager_wallet_address,
        // (any future authorized wallets here)
      ];
      // Check if the "wallet address" is "authorized" (Hmmmmmm......)
      if (authorizedWallets.includes(walletAddress)) {
        if (SECURE_MIDDLEWARE_ACCESS_DEBUG_MODE === true) {
          logApi.info(`${fancyColors.YELLOW}[devAccess]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} ${securityMode} ${fancyColors.RESET} ${fancyColors.DARK_YELLOW}${host}${fancyColors.RESET} ${fancyColors.GRAY}${req.url}${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} GRANTED ${fancyColors.RESET} ${fancyColors.GREEN}Auth via session${fancyColors.RESET} ${fancyColors.YELLOW}${walletAddress.substring(0, 8)}...${fancyColors.RESET}`);
        }
        // Grant access
        return next();
      } else {
        // Log the miss if in debug mode
        if (SECURE_MIDDLEWARE_ACCESS_DEBUG_MODE === true) {
          logApi.warn(`${fancyColors.YELLOW}[devAccess]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} ${securityMode} ${fancyColors.RESET} ${fancyColors.DARK_YELLOW}${host}${fancyColors.RESET} ${fancyColors.GRAY}${req.url}${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} REJECTED ${fancyColors.RESET} ${fancyColors.RED}Invalid session: ${error.message}${fancyColors.RESET}`);
        }
      }
    } catch (error) {
      // Log the error
      if (SECURE_MIDDLEWARE_ACCESS_DEBUG_MODE === true) {
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
    'localhost',
    '127.0.0.1',
    '::ffff:127.0.0.1',
    // Other authorized IPs
    '69.420.69.420',
  ];
  // Check if the client IP is authorized
  if (authorizedIps.includes(clientIp)) {
    if (SECURE_MIDDLEWARE_ACCESS_DEBUG_MODE === true) {
      logApi.info(`${fancyColors.YELLOW}[devAccess]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} ${securityMode} ${fancyColors.RESET} ${fancyColors.DARK_YELLOW}${host}${fancyColors.RESET} ${fancyColors.GRAY}${req.url}${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} GRANTED ${fancyColors.RESET} ${fancyColors.GREEN}Auth via IP${fancyColors.RESET} ${fancyColors.GRAY}${clientIp}${fancyColors.RESET}`);
    }
    // Grant access
    return next();
  } else {
    // Log this [final chance] miss if in debug mode
    if (SECURE_MIDDLEWARE_ACCESS_DEBUG_MODE === true) {
      logApi.warn(`${fancyColors.YELLOW}[devAccess]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} ${securityMode} ${fancyColors.RESET} ${fancyColors.DARK_YELLOW}${host}${fancyColors.RESET} ${fancyColors.GRAY}${req.url}${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} REJECTED ${fancyColors.RESET} ${fancyColors.RED}Invalid IP: ${clientIp}${fancyColors.RESET}`);
    }
  }


  /* At this point, we've exhausted all methods of obtaining valid credentials */

  // Make a quick 403 Forbidden HTML page
  const rude403ForbiddenPageHTML =`<!DOCTYPE html>
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
    </html>`;

  // Access denied - return Branch Manager's exquisite 403 page
  if (SECURE_MIDDLEWARE_ACCESS_DEBUG_MODE === true) {
    logApi.warn(`${fancyColors.YELLOW}[devAccess]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} ${securityMode} ${fancyColors.RESET} ${fancyColors.DARK_YELLOW}${host}${fancyColors.RESET} ${fancyColors.GRAY}${req.url}${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} DENIED ${fancyColors.RESET} ${fancyColors.RED}No valid credentials${fancyColors.RESET} ${fancyColors.DARK_GRAY}IP:${clientIp}${fancyColors.RESET}`);
    return res.status(403).send(rude403ForbiddenPageHTML); 
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