// debug-ws-bytes.js - WebSocket raw byte inspector
// This script helps debug WebSocket frame corruption by showing raw bytes

import { WebSocketServer } from 'ws';
import http from 'http';
import { logApi } from './utils/logger-suite/logger.js';

// Create HTTP server for WebSocket to attach to
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('WebSocket Debug Server');
});

// Create WebSocket server with explicit disabling of compression
const wss = new WebSocketServer({
  server,
  path: '/ws-debug',
  perMessageDeflate: false
});

// Implement buffer inspection and skip technique based on the approach you found online
// This directly handles the underlying WebSocket Receiver buffer

// Access WebSocket internals to modify Receiver.prototype.startLoop
try {
  // Try to access the Receiver class
  const WebSocketModule = await import('ws');
  
  // This might be different depending on how ws is structured - we need to find the Receiver class
  // The Receiver class is what processes raw bytes from the socket
  let Receiver;
  
  // Try different paths that might contain Receiver
  if (WebSocketModule.Receiver) {
    Receiver = WebSocketModule.Receiver;
    logApi.info('Found Receiver class directly on WebSocketModule');
  } else if (WebSocketModule.default && WebSocketModule.default.Receiver) {
    Receiver = WebSocketModule.default.Receiver;
    logApi.info('Found Receiver class on WebSocketModule.default');
  } else {
    logApi.warn('Could not find WebSocket Receiver class - buffer inspection not possible');
  }
  
  if (Receiver && Receiver.prototype) {
    logApi.info('Successfully accessed WebSocket Receiver.prototype - installing buffer inspector');
    
    // Store the original startLoop method
    const originalStartLoop = Receiver.prototype.startLoop;
    
    // Patch the startLoop method to inspect and potentially skip HTTP data
    Receiver.prototype.startLoop = function() {
      try {
        // Check first buffer for HTTP patterns
        if (this._buffers && this._buffers.length > 0) {
          const buf = this._buffers[0];
          if (buf && buf.length > 4) {
            // Check if buffer starts with "GET " (indicating HTTP request)
            if (buf[0] === 71 && buf[1] === 69 && buf[2] === 84 && buf[3] === 32) {
              // This looks like an HTTP request! Log it for inspection
              let str = "";
              for (let i = 0; i < Math.min(buf.length, 500); i++) {
                str += String.fromCharCode(buf[i]);
              }
              
              logApi.error(`🚨 FOUND HTTP DATA IN WEBSOCKET BUFFER: ${buf.length} bytes`);
              logApi.error(`First 500 bytes as text: ${str}`);
              
              // Find the end of HTTP headers
              const headersEndPos = str.indexOf('\r\n\r\n');
              
              if (headersEndPos > 0) {
                // Calculate total size to skip (headers + 4 bytes for \r\n\r\n)
                const skipSize = headersEndPos + 4;
                logApi.info(`HTTP headers end at position ${skipSize} - will skip this data`);
                
                // Skip this data in the buffer - THIS IS THE KEY FIX from the solution you found
                this.consume(skipSize);
                logApi.info(`Skipped ${skipSize} bytes of HTTP data from WebSocket buffer`);
              } else {
                // Just try skipping the whole buffer as a brute force approach
                logApi.warn(`Could not find end of HTTP headers, skipping entire buffer (${buf.length} bytes)`);
                this.consume(buf.length);
              }
            }
          }
        }
      } catch (err) {
        logApi.error(`Error in WebSocket buffer inspection: ${err.message}`);
      }
      
      // Call the original startLoop method
      return originalStartLoop.apply(this, arguments);
    };
    
    logApi.info('✅ Successfully patched WebSocket Receiver.startLoop - will now inspect buffers');
  }
} catch (err) {
  logApi.error(`Failed to patch WebSocket internals: ${err.message}`);
}

// Handle new WebSocket connections
wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  logApi.info(`WebSocket connection from ${ip}`);
  
  // Log the raw HTTP upgrade request headers for inspection
  logApi.info('HTTP UPGRADE REQUEST HEADERS:', {
    headers: req.headers,
    url: req.url,
    method: req.method,
    _highlight: true
  });
  
  // Try to access lower-level socket for debugging
  if (ws._socket) {
    // Original socket data handler
    const originalOnData = ws._socket.ondata;
    
    // Replace with our instrumented version
    ws._socket.ondata = function(buf, start, end) {
      try {
        const data = buf.slice(start, end);
        
        // Check if this might be an HTTP request leaking into WS frames
        const isHttpLike = data.length > 20 && 
                       data[0] === 71 && // 'G'
                       data[1] === 69 && // 'E'
                       data[2] === 84 && // 'T'
                       data[3] === 32;   // ' '
                      
        let hexOutput = '';
        let asciiOutput = '';
        
        // Create a nice hex+ascii view of the first 100 bytes
        for (let i = 0; i < Math.min(data.length, 100); i++) {
          const byte = data[i];
          // Add hex value
          hexOutput += byte.toString(16).padStart(2, '0') + ' ';
          // Add ASCII character (if printable)
          if (byte >= 32 && byte <= 126) {
            asciiOutput += String.fromCharCode(byte);
          } else {
            asciiOutput += '.';
          }
          
          // Add a newline every 16 bytes for readability
          if ((i + 1) % 16 === 0) {
            hexOutput += '  ' + asciiOutput.slice(-16);
            hexOutput += '\n';
            asciiOutput = '';
          }
        }
        
        // If didn't end on a 16-byte boundary, pad and print remaining ASCII
        if (asciiOutput.length > 0) {
          const padding = ' '.repeat((16 - asciiOutput.length) * 3);
          hexOutput += padding + '  ' + asciiOutput;
        }
        
        const bufferSize = data.length;
        const firstFewBytes = Array.from(data.slice(0, 16));
        
        // Log with different highlighting based on what we found
        if (isHttpLike) {
          logApi.error(`🚨 HTTP-LIKE DATA IN SOCKET BUFFER (${bufferSize} bytes):\n${hexOutput}`, { 
            bufferSize, 
            firstFewBytes,
            _highlight: true
          });
          
          // Attempt to show the HTTP headers more clearly
          const httpText = data.toString('utf8', 0, Math.min(data.length, 500));
          const headers = httpText.split('\r\n\r\n')[0];
          logApi.error(`HTTP HEADERS FOUND IN SOCKET BUFFER:\n${headers}`, {
            bufferSize,
            _highlight: true
          });
          
          // Log the actual byte count for reference (to find the right amount to skip)
          logApi.info(`If this is HTTP data in WebSocket buffer, you may need to consume ${bufferSize} bytes`);
        } else {
          logApi.info(`Raw socket bytes (${bufferSize} bytes):\n${hexOutput}`, { 
            bufferSize, 
            firstFewBytes,
            firstByte: data[0].toString(16)
          });
        }
      } catch (err) {
        logApi.error('Error in socket data inspection:', err);
      }
      
      // Call the original handler to maintain functionality
      return originalOnData.call(this, buf, start, end);
    };
    
    logApi.info('✅ Successfully instrumented socket data handler for inspection');
  } else {
    logApi.warn('⚠️ Could not access socket for raw data inspection');
  }
  
  // Log buffer sizes on connection
  if (ws._socket && typeof ws._socket.bufferSize !== 'undefined') {
    logApi.info(`Socket buffer size on connection: ${ws._socket.bufferSize} bytes`);
  }
  
  // Handle incoming messages
  ws.on('message', (message) => {
    // Create a Buffer view of the message
    const buf = Buffer.from(message);
    
    // Log first byte in hex - this helps identify WebSocket frame type
    // In a proper WS frame, first byte will typically be 0x81 for text frame
    const firstByte = buf.length > 0 ? buf[0].toString(16) : 'empty';
    
    logApi.info(`Received message (first byte: 0x${firstByte}): ${message.toString()}`);
    
    // Check if first byte looks wrong (not 0x81 for text frames)
    if (buf.length > 0 && buf[0] !== 0x81 && buf[0] !== 0x82) {
      logApi.warn(`⚠️ Unusual first byte in WebSocket frame: 0x${firstByte} (expected 0x81 for text or 0x82 for binary)`);
    }
    
    // Echo the message back
    ws.send(`Echo: ${message}`);
  });
  
  // Handle connection closing
  ws.on('close', (code, reason) => {
    logApi.info(`Connection closed: ${code} - ${reason}`);
  });
  
  // Handle errors
  ws.on('error', (error) => {
    logApi.error(`WebSocket error: ${error.message}`);
  });
  
  // Send welcome message
  ws.send(JSON.stringify({
    type: 'welcome',
    message: 'Connected to WebSocket Debug Server'
  }));
});

// Start the server on port 3008
const PORT = 3008;
server.listen(PORT, () => {
  logApi.info(`WebSocket Debug Server running on http://localhost:${PORT}/ws-debug`);
  logApi.info(`Connect using: wscat -c ws://localhost:${PORT}/ws-debug`);
});

// Handle server errors
server.on('error', (error) => {
  logApi.error(`Server error: ${error.message}`);
});

// Add a test endpoint to verify HTTP request isolation
server.on('request', (req, res) => {
  if (req.url === '/test') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', message: 'Debug server is running' }));
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logApi.error(`Uncaught exception: ${error.message}`, error);
});