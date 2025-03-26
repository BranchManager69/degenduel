/**
 * WebSocket Buffer Fix for RSV1 Issues
 * 
 * This module provides a fix for WebSocket "RSV1 must be clear" errors
 * by patching the underlying buffer handling in the ws library.
 * 
 * The fix works by detecting when HTTP headers leak into the WebSocket
 * frame buffer and skipping those bytes before processing frames.
 */

import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';

/**
 * Apply the WebSocket buffer fix to patch the ws library
 * Call this function BEFORE initializing any WebSocket servers
 */
export async function applyWebSocketBufferFix() {
  try {
    logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} WS BUFFER FIX ${fancyColors.RESET} Applying WebSocket buffer fix for RSV1 issues...`);
    
    // Import the WebSocket module
    const WebSocketModule = await import('ws');
    
    // Find the Receiver class that handles buffer processing
    let Receiver;
    
    if (WebSocketModule.Receiver) {
      Receiver = WebSocketModule.Receiver;
      logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} WS BUFFER FIX ${fancyColors.RESET} Found Receiver class directly on WebSocketModule`);
    } else if (WebSocketModule.default && WebSocketModule.default.Receiver) {
      Receiver = WebSocketModule.default.Receiver;
      logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} WS BUFFER FIX ${fancyColors.RESET} Found Receiver class on WebSocketModule.default`);
    } else {
      // Last attempt - try to find it by checking known paths
      for (const key of Object.keys(WebSocketModule)) {
        if (WebSocketModule[key] && WebSocketModule[key].prototype && 
            typeof WebSocketModule[key].prototype.startLoop === 'function') {
          Receiver = WebSocketModule[key];
          logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} WS BUFFER FIX ${fancyColors.RESET} Found Receiver class at WebSocketModule.${key}`);
          break;
        }
      }
      
      if (!Receiver) {
        logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} WS BUFFER FIX ${fancyColors.RESET} Could not find WebSocket Receiver class - fix cannot be applied`);
        return false;
      }
    }
    
    if (Receiver && Receiver.prototype && Receiver.prototype.startLoop) {
      logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} WS BUFFER FIX ${fancyColors.RESET} Found startLoop method on Receiver.prototype`);
      
      // Store the original startLoop method
      const originalStartLoop = Receiver.prototype.startLoop;
      
      // Patch the startLoop method to detect and skip HTTP headers
      Receiver.prototype.startLoop = function() {
        try {
          // Check if we have buffers to process
          if (this._buffers && this._buffers.length > 0) {
            const buf = this._buffers[0];
            if (buf && buf.length > 4) {
              // Check for different patterns that indicate HTTP or other non-WS data
              
              // Pattern 1: HTTP GET request
              if (buf[0] === 71 && buf[1] === 69 && buf[2] === 84 && buf[3] === 32) { // "GET "
                logApi.warn(`${fancyColors.BG_YELLOW}${fancyColors.BLACK} WS BUFFER FIX ${fancyColors.RESET} Detected HTTP GET request in WebSocket buffer (${buf.length} bytes)`);
                
                // Convert buffer to string to find header boundary
                let str = "";
                for (let i = 0; i < Math.min(buf.length, 500); i++) {
                  str += String.fromCharCode(buf[i]);
                }
                
                // Find end of HTTP headers
                const headersEndPos = str.indexOf('\r\n\r\n');
                
                if (headersEndPos > 0) {
                  // Skip headers plus the \r\n\r\n
                  const skipSize = headersEndPos + 4;
                  logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} WS BUFFER FIX ${fancyColors.RESET} Skipping ${skipSize} bytes of HTTP headers`);
                  this.consume(skipSize);
                } else {
                  // Can't find header boundary, skip aggressively
                  logApi.warn(`${fancyColors.BG_YELLOW}${fancyColors.BLACK} WS BUFFER FIX ${fancyColors.RESET} Could not find end of HTTP headers, skipping entire buffer (${buf.length} bytes)`);
                  this.consume(buf.length);
                }
              }
              // Pattern 2: HTTP POST request
              else if (buf[0] === 80 && buf[1] === 79 && buf[2] === 83 && buf[3] === 84) { // "POST"
                logApi.warn(`${fancyColors.BG_YELLOW}${fancyColors.BLACK} WS BUFFER FIX ${fancyColors.RESET} Detected HTTP POST request in WebSocket buffer`);
                
                // Convert buffer to string to find header boundary
                let str = "";
                for (let i = 0; i < Math.min(buf.length, 500); i++) {
                  str += String.fromCharCode(buf[i]);
                }
                
                // Find end of HTTP headers
                const headersEndPos = str.indexOf('\r\n\r\n');
                
                if (headersEndPos > 0) {
                  // Skip headers plus the \r\n\r\n
                  const skipSize = headersEndPos + 4;
                  logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} WS BUFFER FIX ${fancyColors.RESET} Skipping ${skipSize} bytes of HTTP headers`);
                  this.consume(skipSize);
                } else {
                  // Can't find header boundary, skip aggressively
                  logApi.warn(`${fancyColors.BG_YELLOW}${fancyColors.BLACK} WS BUFFER FIX ${fancyColors.RESET} Could not find end of HTTP headers, skipping entire buffer`);
                  this.consume(buf.length);
                }
              }
              // Pattern 3: HTTP response header
              else if (buf[0] === 72 && buf[1] === 84 && buf[2] === 84 && buf[3] === 80) { // "HTTP"
                logApi.warn(`${fancyColors.BG_YELLOW}${fancyColors.BLACK} WS BUFFER FIX ${fancyColors.RESET} Detected HTTP response in WebSocket buffer`);
                
                // Convert buffer to string to find header boundary
                let str = "";
                for (let i = 0; i < Math.min(buf.length, 500); i++) {
                  str += String.fromCharCode(buf[i]);
                }
                
                // Find end of HTTP headers
                const headersEndPos = str.indexOf('\r\n\r\n');
                
                if (headersEndPos > 0) {
                  // Skip headers plus the \r\n\r\n
                  const skipSize = headersEndPos + 4;
                  logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} WS BUFFER FIX ${fancyColors.RESET} Skipping ${skipSize} bytes of HTTP headers`);
                  this.consume(skipSize);
                } else {
                  // Can't find header boundary, skip aggressively
                  logApi.warn(`${fancyColors.BG_YELLOW}${fancyColors.BLACK} WS BUFFER FIX ${fancyColors.RESET} Could not find end of HTTP headers, skipping entire buffer`);
                  this.consume(buf.length);
                }
              }
              // Check for repeated RSV1 errors - this is more dangerous, so we log extensively
              else if (buf[0] > 128 && (buf[0] & 0x40) === 0x40) { // RSV1 bit is set
                logApi.warn(`${fancyColors.BG_RED}${fancyColors.WHITE} WS BUFFER FIX ${fancyColors.RESET} Detected RSV1 bit set in WebSocket frame (0x${buf[0].toString(16)})`);
                
                // This is tricky - we'll try a more conservative approach first
                // Log the first few bytes for debugging
                let hexDump = '';
                for (let i = 0; i < Math.min(buf.length, 16); i++) {
                  hexDump += buf[i].toString(16).padStart(2, '0') + ' ';
                }
                
                logApi.warn(`${fancyColors.BG_RED}${fancyColors.WHITE} WS BUFFER FIX ${fancyColors.RESET} Frame bytes: ${hexDump}`);
                
                // Clear the RSV1 bit by modifying the buffer directly
                // This is a last resort approach, but can help in some cases
                if (buf[0] & 0x40) {
                  const originalByte = buf[0];
                  buf[0] = buf[0] & 0xBF; // Clear the RSV1 bit (0x40)
                  logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} WS BUFFER FIX ${fancyColors.RESET} Cleared RSV1 bit: 0x${originalByte.toString(16)} -> 0x${buf[0].toString(16)}`);
                }
              }
              // Another special case - if the first byte is text content rather than a frame header
              else if (buf[0] >= 32 && buf[0] <= 126) { // ASCII printable range
                // This indicates the frame has already been partially processed
                // We'll log it but not modify it to avoid breaking working connections
                let preview = '';
                for (let i = 0; i < Math.min(buf.length, 16); i++) {
                  if (buf[i] >= 32 && buf[i] <= 126) {
                    preview += String.fromCharCode(buf[i]);
                  } else {
                    preview += '.';
                  }
                }
                
                logApi.info(`${fancyColors.BG_BLUE}${fancyColors.WHITE} WS BUFFER FIX ${fancyColors.RESET} Detected text content without frame header: "${preview}..."`);
              }
            }
          }
        } catch (err) {
          logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} WS BUFFER FIX ${fancyColors.RESET} Error in buffer processing: ${err.message}`);
        }
        
        // Call the original startLoop method
        return originalStartLoop.apply(this, arguments);
      };
      
      logApi.info(`${fancyColors.BG_GREEN}${fancyColors.WHITE} WS BUFFER FIX ${fancyColors.RESET} ${fancyColors.BOLD}Successfully patched WebSocket Receiver - RSV1 issue should be fixed!${fancyColors.RESET}`);
      return true;
    }
    
    logApi.warn(`${fancyColors.BG_YELLOW}${fancyColors.BLACK} WS BUFFER FIX ${fancyColors.RESET} Could not find startLoop method on Receiver.prototype`);
    return false;
  } catch (err) {
    logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} WS BUFFER FIX ${fancyColors.RESET} Failed to apply buffer fix: ${err.message}`, err);
    return false;
  }
}

/**
 * Force skip a specific number of bytes in the WebSocket buffer
 * This can be used as a last resort if automatic detection fails
 * 
 * @param {WebSocket} ws - The WebSocket instance to patch
 * @param {number} bytesToSkip - Number of bytes to skip in the buffer
 */
export function forceSkipBytes(ws, bytesToSkip) {
  try {
    if (!ws || !ws._receiver) {
      logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} WS BUFFER FIX ${fancyColors.RESET} Invalid WebSocket or missing _receiver property`);
      return false;
    }
    
    // Access the _receiver object which has the buffer methods
    const receiver = ws._receiver;
    
    if (typeof receiver.consume !== 'function') {
      logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} WS BUFFER FIX ${fancyColors.RESET} WebSocket receiver doesn't have consume method`);
      return false;
    }
    
    // Force consume bytes from the buffer
    receiver.consume(bytesToSkip);
    logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} WS BUFFER FIX ${fancyColors.RESET} Manually skipped ${bytesToSkip} bytes from WebSocket buffer`);
    return true;
  } catch (err) {
    logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} WS BUFFER FIX ${fancyColors.RESET} Error in forceSkipBytes: ${err.message}`);
    return false;
  }
}