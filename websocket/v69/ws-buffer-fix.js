/**
 * WebSocket Buffer Fix for RSV1 Issues (March 26, 2025)
 * 
 * This module provides comprehensive fixes for WebSocket "RSV1 must be clear" errors.
 * The fix operates at multiple levels to ensure RSV1 bits are cleared:
 * 
 * 1. Socket-level patching: Intercepts all outgoing socket data and clears RSV1 bits
 * 2. Frame-level utilities: Provides helpers to create WebSocket frames without RSV1 bits
 * 3. Error handling: Catches and logs RSV1-related issues
 */

import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';

/**
 * Apply the WebSocket buffer fix to patch the ws library
 * Call this function BEFORE initializing any WebSocket servers
 */
export async function applyWebSocketBufferFix() {
  try {
    logApi.warn(`${fancyColors.BG_YELLOW}${fancyColors.BLACK} 🚨 BUFFER FIX ACTIVATED 🚨 ${fancyColors.RESET} ${fancyColors.BOLD}APPLYING WEBSOCKET RSV1 FIXES${fancyColors.RESET}`);
    
    // SOCKET-LEVEL PATCH (most effective approach)
    // This intercepts all outgoing socket data and clears RSV1 bits
    const net = await import('net');
    const originalSocketWrite = net.Socket.prototype.write;
    
    net.Socket.prototype.write = function(data, encoding, callback) {
      try {
        // Only process Buffer data
        if (Buffer.isBuffer(data) && data.length > 1) {
          let modified = false;
          let modifiedBytes = 0;
          
          // Scan for WebSocket frames with RSV1 bit set (0x40)
          for (let i = 0; i < Math.min(data.length, 1000); i++) {
            // WebSocket frames start with byte >= 0x80 (high bit set)
            // RSV1 bit is 0x40
            if ((data[i] & 0x80) && (data[i] & 0x40)) {
              // Clear RSV1 bit (0x40)
              const original = data[i];
              data[i] = data[i] & 0xBF;  // Clear bit 0x40
              modified = true;
              modifiedBytes++;
              
              // Log the first few changes
              if (modifiedBytes <= 3) {
                logApi.warn(`${fancyColors.BG_YELLOW}${fancyColors.BLACK} RSV1 FIX ${fancyColors.RESET} Cleared RSV1 bit at byte ${i}: 0x${original.toString(16)} → 0x${data[i].toString(16)}`);
              }
            }
          }
          
          if (modified) {
            // Log summary of modifications
            logApi.warn(`${fancyColors.BG_GREEN}${fancyColors.BLACK} ✅ RSV1 FIX ${fancyColors.RESET} Cleared ${modifiedBytes} RSV1 bits in ${data.length} byte frame buffer`);
          }
        }
      } catch (err) {
        // Never let our patch crash the application
        logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} ❌ RSV1 ERROR ${fancyColors.RESET} Socket write patch error: ${err.message}`);
      }
      
      // Call original write with possibly modified data
      return originalSocketWrite.call(this, data, encoding, callback);
    };
    
    logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} ✅✅✅ SOCKET-LEVEL RSV1 FIX APPLIED SUCCESSFULLY ✅✅✅ ${fancyColors.RESET}`);
    
    // Add a WebSocket frame creation utility to the global scope
    // We need this because the raw WebSocket internals aren't accessible
    global.WebSocketFrameUtils = {
      // Create a WebSocket frame with RSV1 bit explicitly cleared
      createFrame: (data, options = {}) => {
        try {
          // Default options
          const opts = {
            fin: true,
            rsv1: false, // Explicitly disable compression
            rsv2: false,
            rsv3: false,
            opcode: 1, // Text frame
            mask: false, // Server doesn't need to mask
            ...options
          };
          
          // Convert string to buffer if needed
          const payload = typeof data === 'string' ? Buffer.from(data) : data;
          const dataLength = payload.length;
          
          // Calculate frame size
          let frameSize = 2; // At least 2 bytes for header
          
          // Add length field size
          if (dataLength < 126) {
            frameSize += 0; // Length fits in the initial byte
          } else if (dataLength < 65536) {
            frameSize += 2; // 16-bit length
          } else {
            frameSize += 8; // 64-bit length
          }
          
          // Add data size
          frameSize += dataLength;
          
          // Create the buffer
          const buffer = Buffer.alloc(frameSize);
          
          // Write the header - first byte
          // FIN bit (bit 0) + RSV1,2,3 (bits 1-3) + OPCODE (bits 4-7)
          let firstByte = 0;
          if (opts.fin) firstByte |= 0x80;
          if (opts.rsv1) firstByte |= 0x40; // RSV1 bit (should always be 0)
          if (opts.rsv2) firstByte |= 0x20; // RSV2 bit (should be 0)
          if (opts.rsv3) firstByte |= 0x10; // RSV3 bit (should be 0)
          firstByte |= (opts.opcode & 0x0F); // Opcode (usually 1 for text)
          
          buffer.writeUInt8(firstByte, 0);
          
          // Helper to write the length bytes
          let offset = 1;
          if (dataLength < 126) {
            buffer.writeUInt8(dataLength, offset);
            offset += 1;
          } else if (dataLength < 65536) {
            buffer.writeUInt8(126, offset);
            buffer.writeUInt16BE(dataLength, offset + 1);
            offset += 3;
          } else {
            buffer.writeUInt8(127, offset);
            // Write 0 for first 4 bytes since we don't support payload > 4GB
            buffer.writeUInt32BE(0, offset + 1);
            buffer.writeUInt32BE(dataLength, offset + 5);
            offset += 9;
          }
          
          // Copy payload data
          payload.copy(buffer, offset);
          
          return buffer;
        } catch (error) {
          logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} ❌ FRAME ERROR ${fancyColors.RESET} Error creating WebSocket frame: ${error.message}`);
          throw error;
        }
      },
      
      // Create and send a WebSocket text frame with RSV1 bit cleared
      sendSafeFrame: (socket, data) => {
        try {
          if (!socket || !socket.write || typeof socket.write !== 'function') {
            throw new Error("Invalid socket - must have write method");
          }
          
          // Convert to string if needed
          const message = typeof data === 'object' ? JSON.stringify(data) : data;
          
          // Create a buffer with the frame data
          const msgBuffer = Buffer.from(message);
          
          // Create a WebSocket frame with RSV1 explicitly disabled
          const frame = global.WebSocketFrameUtils.createFrame(msgBuffer, {
            fin: true,
            rsv1: false, // EXPLICITLY disable RSV1 bit
            opcode: 1,    // Text frame
            mask: false   // Server doesn't mask
          });
          
          // Send the frame directly
          socket.write(frame);
          
          return true;
        } catch (error) {
          logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} ❌ SEND ERROR ${fancyColors.RESET} Error sending safe frame: ${error.message}`);
          return false;
        }
      }
    };
    
    logApi.info(`${fancyColors.BG_GREEN}${fancyColors.BLACK} ✅ FRAME UTILS ${fancyColors.RESET} Created WebSocket frame utility functions`);
    
    return true;
  } catch (err) {
    logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} ❌❌❌ RSV1 FIX FAILED ${fancyColors.RESET} ${err.message}`, err);
    return false;
  }
}

/**
 * Create a WebSocket frame with RSV1 bit explicitly cleared
 * Safe utility function for creating WebSocket frames
 * 
 * @param {string|Buffer} data - The data to send
 * @param {Object} options - Frame options
 * @returns {Buffer} - The WebSocket frame buffer
 */
export function createSafeFrame(data, options = {}) {
  if (global.WebSocketFrameUtils && global.WebSocketFrameUtils.createFrame) {
    return global.WebSocketFrameUtils.createFrame(data, options);
  }
  
  // Fallback implementation if global util not available
  try {
    // Convert string to buffer if needed
    const payload = typeof data === 'string' ? Buffer.from(data) : data;
    const dataLength = payload.length;
    
    // Calculate frame size (header + length bytes + payload)
    let frameSize = 2; // At least 2 bytes for header
    
    // Add length field size
    if (dataLength < 126) {
      frameSize += 0; // Length fits in one byte
    } else if (dataLength < 65536) {
      frameSize += 2; // 16-bit length
    } else {
      frameSize += 8; // 64-bit length
    }
    
    // Add payload size
    frameSize += dataLength;
    
    // Create the frame buffer
    const frame = Buffer.alloc(frameSize);
    
    // Write header - first byte: 10000001 (FIN=1, RSV1=0, RSV2=0, RSV3=0, OPCODE=1)
    frame.writeUInt8(0x81, 0);
    
    // Write length
    let offset = 1;
    if (dataLength < 126) {
      frame.writeUInt8(dataLength, offset);
      offset += 1;
    } else if (dataLength < 65536) {
      frame.writeUInt8(126, offset);
      frame.writeUInt16BE(dataLength, offset + 1);
      offset += 3;
    } else {
      frame.writeUInt8(127, offset);
      // 64-bit length (high 32 bits are 0 for JavaScript strings)
      frame.writeUInt32BE(0, offset + 1);
      frame.writeUInt32BE(dataLength, offset + 5);
      offset += 9;
    }
    
    // Copy payload
    payload.copy(frame, offset);
    
    return frame;
  } catch (error) {
    logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} ❌ FRAME ERROR ${fancyColors.RESET} Error creating safe frame: ${error.message}`);
    throw error;
  }
}

/**
 * Send a message directly to a WebSocket client bypassing compression
 * This function sends a manually constructed WebSocket frame with RSV1 cleared
 * 
 * @param {WebSocket} ws - The WebSocket client
 * @param {Object|string} message - The message to send
 * @returns {boolean} - Whether the send was successful
 */
export function sendSafeMessage(ws, message) {
  try {
    // Ensure we have a valid WebSocket with socket
    if (!ws || !ws._socket || typeof ws._socket.write !== 'function') {
      logApi.warn(`${fancyColors.BG_YELLOW}${fancyColors.BLACK} SEND SAFE ${fancyColors.RESET} Invalid WebSocket or missing socket`);
      return false;
    }
    
    // Convert to string if needed
    const jsonStr = typeof message === 'object' ? JSON.stringify(message) : message;
    const msgBuffer = Buffer.from(jsonStr);
    
    // Use global utility if available
    if (global.WebSocketFrameUtils && global.WebSocketFrameUtils.createFrame) {
      const frame = global.WebSocketFrameUtils.createFrame(msgBuffer);
      ws._socket.write(frame);
      return true;
    }
    
    // Fallback to direct frame creation
    const frame = createSafeFrame(msgBuffer);
    ws._socket.write(frame);
    
    return true;
  } catch (error) {
    logApi.error(`${fancyColors.BG_RED}${fancyColors.WHITE} ❌ SEND ERROR ${fancyColors.RESET} Error sending safe message: ${error.message}`);
    return false;
  }
}