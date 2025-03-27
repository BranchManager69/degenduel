// test-diagnose.js - ESM-compatible WebSocket diagnostic
import net from 'net';
import tls from 'tls';
import { URL } from 'url';
import { fancyColors } from './utils/colors.js';

// Manual WebSocket handshake diagnostic function (ESM compatible)
async function diagnoseWebSocketHandshake(url, options = {}) {
  // Parse the URL
  const urlObj = new URL(url);
  const isSecure = urlObj.protocol === 'wss:';
  const host = urlObj.hostname;
  const port = urlObj.port || (isSecure ? 443 : 80);
  const path = urlObj.pathname + urlObj.search;
  
  console.log(`\n${fancyColors.BG_BLUE}${fancyColors.WHITE} TCP HANDSHAKE DIAGNOSTICS ${fancyColors.RESET}`);
  console.log(`${fancyColors.CYAN}Connecting to: ${fancyColors.BOLD}${url}${fancyColors.RESET}`);
  console.log(`${fancyColors.CYAN}Host: ${host}, Port: ${port}, Path: ${path}${fancyColors.RESET}\n`);
  
  return new Promise((resolve, reject) => {
    try {
      // Generate a random WebSocket key
      const wsKey = Buffer.from(Math.random().toString(36).substring(2, 12)).toString('base64');
      
      // Create the upgrade request
      const request = [
        `GET ${path} HTTP/1.1`,
        `Host: ${host}${port ? `:${port}` : ''}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${wsKey}`,
        'Sec-WebSocket-Version: 13',
        // Add this line to explicitly request no extensions
        options.testWithCompression ? 'Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits' : '',
        '',
        ''
      ].filter(Boolean).join('\r\n');
      
      console.log(`${fancyColors.BG_YELLOW}${fancyColors.BLACK} SENDING REQUEST ${fancyColors.RESET}`);
      console.log(`${fancyColors.GRAY}${request.replace(/\r\n/g, '\n')}${fancyColors.RESET}`);
      
      // Connect using appropriate protocol
      const socket = isSecure ? 
        tls.connect(port, host, { rejectUnauthorized: false }) : 
        net.connect(port, host);
      
      let responseData = '';
      
      // Set timeout
      socket.setTimeout(5000, () => {
        socket.end();
        console.log(`${fancyColors.BG_RED}${fancyColors.WHITE} TIMEOUT ${fancyColors.RESET} Connection timed out after 5 seconds`);
        resolve({ success: false, error: 'Timeout' });
      });
      
      socket.on('connect', () => {
        console.log(`${fancyColors.BG_GREEN}${fancyColors.BLACK} CONNECTED ${fancyColors.RESET} TCP connection established to ${host}:${port}`);
        // Send the HTTP upgrade request
        socket.write(request);
      });
      
      socket.on('data', (data) => {
        responseData += data.toString();
        
        // Check if we've received the full headers (ending with \r\n\r\n)
        if (responseData.includes('\r\n\r\n')) {
          console.log(`${fancyColors.BG_GREEN}${fancyColors.BLACK} RESPONSE RECEIVED ${fancyColors.RESET}`);
          
          // Split headers from body
          const [headers, body] = responseData.split('\r\n\r\n', 2);
          const headerLines = headers.split('\r\n');
          
          console.log(`${fancyColors.CYAN}Headers:${fancyColors.RESET}`);
          headerLines.forEach(line => console.log(`${fancyColors.YELLOW}${line}${fancyColors.RESET}`));
          
          // Check for compression headers
          const extensionHeader = headerLines.find(h => h.toLowerCase().startsWith('sec-websocket-extensions:'));
          
          if (extensionHeader) {
            if (extensionHeader.toLowerCase().includes('permessage-deflate')) {
              console.log(`\n${fancyColors.BG_RED}${fancyColors.WHITE} COMPRESSION ENABLED ${fancyColors.RESET} ${fancyColors.RED}Server is negotiating compression: ${extensionHeader}${fancyColors.RESET}`);
              console.log(`${fancyColors.RED}This will cause the 'RSV1 must be clear' error with clients that don't support compression.${fancyColors.RESET}`);
            } else {
              console.log(`\n${fancyColors.BG_YELLOW}${fancyColors.BLACK} EXTENSIONS FOUND ${fancyColors.RESET} Server returned extensions: ${extensionHeader}`);
            }
          } else {
            console.log(`\n${fancyColors.BG_GREEN}${fancyColors.BLACK} NO COMPRESSION ${fancyColors.RESET} Server correctly disabled WebSocket extensions`);
          }
          
          // Check if upgrade was successful
          const statusLine = headerLines[0];
          const upgradeHeader = headerLines.find(h => h.toLowerCase().startsWith('upgrade:'));
          
          if (statusLine.includes('101') && upgradeHeader && upgradeHeader.toLowerCase().includes('websocket')) {
            console.log(`\n${fancyColors.BG_GREEN}${fancyColors.BLACK} HANDSHAKE SUCCESSFUL ${fancyColors.RESET} WebSocket connection established`);
            
            // Don't close immediately to see if frames arrive
            setTimeout(() => {
              socket.end();
              resolve({ 
                success: true, 
                headers: headerLines,
                compression: !!extensionHeader && extensionHeader.toLowerCase().includes('permessage-deflate')
              });
            }, 1000);
          } else {
            console.log(`\n${fancyColors.BG_RED}${fancyColors.WHITE} HANDSHAKE FAILED ${fancyColors.RESET} Server did not upgrade the connection: ${statusLine}`);
            socket.end();
            resolve({ 
              success: false, 
              headers: headerLines,
              status: statusLine
            });
          }
        }
      });
      
      socket.on('error', (err) => {
        console.log(`${fancyColors.BG_RED}${fancyColors.WHITE} CONNECTION ERROR ${fancyColors.RESET} ${err.message}`);
        reject(err);
      });
      
      socket.on('end', () => {
        console.log(`${fancyColors.BG_BLUE}${fancyColors.WHITE} CONNECTION CLOSED ${fancyColors.RESET}`);
      });
    } catch (err) {
      console.error(`${fancyColors.BG_RED}${fancyColors.WHITE} DIAGNOSTIC ERROR ${fancyColors.RESET} ${err.message}`);
      reject(err);
    }
  });
}

// Run the diagnostic on the token-data WebSocket endpoint
async function runDiagnostic() {
  console.log('Running WebSocket diagnostic...');
  
  try {
    // First try without compression 
    console.log('\n=== TEST WITHOUT COMPRESSION ===');
    const result1 = await diagnoseWebSocketHandshake(
      'ws://localhost:3004/api/v69/ws/token-data',
      { testWithCompression: false }
    );
    
    // Then try with compression to see if that's the issue
    console.log('\n=== TEST WITH COMPRESSION ===');
    const result2 = await diagnoseWebSocketHandshake(
      'ws://localhost:3004/api/v69/ws/token-data',
      { testWithCompression: true }
    );
    
    // Also try the test WebSocket to see if it works
    console.log('\n=== TEST WEBSOCKET ENDPOINT ===');
    const result3 = await diagnoseWebSocketHandshake(
      'ws://localhost:3004/api/v69/ws/test',
      { testWithCompression: false }
    );
  } catch (error) {
    console.error('Diagnostic failed with error:', error);
  }
}

runDiagnostic();