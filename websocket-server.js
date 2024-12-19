import fs from 'fs';
import dotenv from 'dotenv';
import { WebSocketServer } from 'ws';
import axios from 'axios';

dotenv.config();

const LOG_FILE_PATH = '/home/websites/degenduel/logs/app.log';
const LOGS_PORT = process.env.LOGS_PORT || 3334;
const PRICE_FETCH_INTERVAL = 5000; // Interval in milliseconds

// Solana tokens
const TOKENS = [
    { name: 'FARTCOIN', address: '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump' },
    { name: 'SOL', address: 'So11111111111111111111111111111111111111112' },
    { name: 'USDC', address: 'Es9vMFrzaCERD5JTrwxxpgc9oegBfs99wGNobG1ZoyGu' },
];

// Ensure log file exists or create it
if (!fs.existsSync(LOG_FILE_PATH)) {
    console.log(`Log file not found. Creating ${LOG_FILE_PATH}...`);
    fs.writeFileSync(LOG_FILE_PATH, '', { encoding: 'utf8' });
    console.log(`Log file created at ${LOG_FILE_PATH}`);
}

// Initialize WebSocket server
const wss = new WebSocketServer({ port: LOGS_PORT, host: '0.0.0.0' });
console.log(`WebSocket server listening on ws://localhost:${LOGS_PORT} and logs.degenduel.me`);

// Function to fetch token prices using CoinGecko API
async function fetchTokenPrices() {
    const results = [];

    for (const token of TOKENS) {
        try {
            const response = await axios.get(`https://api.coingecko.com/api/v3/simple/token_price/solana`, {
                params: {
                    contract_addresses: token.mint,
                    vs_currencies: 'usd'
                }
            });

            const price = response.data[token.mint]?.usd;
            if (price) {
                results.push({ name: token.name, mint: token.mint, price });
            } else {
                results.push({ name: token.name, mint: token.mint, price: 'N/A' });
            }
        } catch (error) {
            console.error(`Error fetching price for ${token.name}:`, error.message);
            results.push({ name: token.name, mint: token.mint, price: 'Error' });
        }
    }

    return results;
}

wss.on('connection', (ws) => {
    console.log('Client connected');
    ws.send(`You're connected to the DegenDuel WebSocket and logs server 🚀`);

    // Stream log file to connected clients
    const logStream = fs.createReadStream(LOG_FILE_PATH, { encoding: 'utf8' });

    logStream.on('data', (chunk) => {
        ws.send(chunk);
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        logStream.destroy();
    });

    ws.on('error', (error) => {
        console.error('WebSocket client error:', error);
    });
});

// Broadcast token prices to all connected clients every interval
setInterval(async () => {
    const prices = await fetchTokenPrices();

    const message = {
        type: 'token_prices',
        timestamp: new Date().toISOString(),
        data: prices
    };

    wss.clients.forEach((client) => {
        if (client.readyState === client.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
}, PRICE_FETCH_INTERVAL);

wss.on('error', (error) => {
    console.error('WebSocket server error:', error);
});
