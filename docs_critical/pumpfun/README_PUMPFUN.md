# 🚀 DegenDuel | Pump.fun API Test Suite

This TypeScript script provides a comprehensive solution for interacting with Pump.fun tokens, featuring enhanced visual output with colored logging and real-time status indicators. The code is structured into well-documented functions with proper type definitions, robust error handling, and parallel data fetching for optimal performance.

> 📋 Looking for token creation documentation? See the [Token Creation Guide](./README_LAUNCH.md)

## 🌟 Introduction to Pump.fun API

Pump.fun API provides easy-to-use HTTP endpoints for seamless token trading on the Pump.fun platform. This unofficial yet powerful API removes typical hurdles of authorization or hidden surcharges, giving you direct access to a range of core trading functions.

### 🔑 Key Features

- **💲 No Hidden Fees** - A transparent pricing structure ensures you only pay a fixed fee of 0.001 SOL per transaction
- **🔓 No API Key Required** - All endpoints are publicly accessible—no need to register or manage additional credentials
- **🔄 Multiple Endpoints** - Effortlessly send transactions, buy or sell tokens, stream newly listed tokens, create your token, and retrieve token price data
- **👨‍💻 User-Friendly** - Straightforward API design allows you to integrate quickly and securely without a complex setup

### 💡 What You Can Do

- **💰 Buy & Sell Tokens** - Execute trades instantly without extra overhead or complex verification steps
- **🪙 Create a Token** - Launch your token on Pump.fun in just a few steps using our dedicated endpoint
- **📊 Stream Real-Time Token Data** - Stay updated with the latest token listings, prices, and market trends
- **📈 Fetch Token Price Info** - Quickly obtain price data to make informed trading decisions

### 🚀 Quick Start Guide

1. **🎯 Choose Your Endpoint** - Identify the HTTP endpoint you need (Buy, Sell, Create, Stream, etc.)
2. **📡 Send a Request** - Make a standard HTTP request with the relevant parameters
3. **✅ Verify Transaction** - Once the transaction is confirmed, it will be reflected on the Pump.fun platform
4. **💲 Pay Only 0.001 SOL** - Each transaction is charged a minimal fixed fee—no surprises

## 🔍 Extended Pump.fun API Integration

To gather deeper insights on tokens and trading activity, we utilize several Pump.fun API endpoints in addition to the basic ones:

- **🆕 New Tokens Endpoint** – Retrieves newly minted or trending tokens on Pump.fun, providing details like mint address, token name, symbol, and creation info ([DOCS.PUMPFUNAPI.ORG](https://docs.pumpfunapi.org)). This helps identify tokens of interest.

- **📝 Token Metadata Endpoint** – Given a token mint, fetches metadata such as the token's name, ticker/symbol, image URL, and description ([DOCS.PUMPAPI.FUN](https://docs.pumpapi.fun)). This ensures we have up-to-date token identifiers and branding.

- **💲 Token Price Endpoint** – Provides real-time price of a Pump.fun token in both SOL and USD, based on Pump.fun's bonding curve mechanics ([DOCS.PUMPFUNAPI.ORG](https://docs.pumpfunapi.org)). This is useful for understanding the token's current valuation on the Pump.fun platform.

- **📊 Token Volume Endpoint** – Returns trading volume information for a specific token (in lamports of SOL) ([CALLSTATIC.COM](https://callstatic.com)). Volume is a key indicator of trading activity and token interest. (Note: This endpoint may require an API key or subscription if using certain services.)

These endpoints allow us to compile a richer dataset for each token, beyond just its existence. The script will fetch new token listings, then for each token gather its metadata, current price, and volume. All Pump.fun API calls are wrapped in proper error handling (with descriptive logging on failure) to ensure reliability.

Full [API Documentation](https://docs.pumpfunapi.org) at docs.pumpfunapi.org

## 💰 Token Price API

Instantly obtain real-time prices for Pump.fun tokens in both SOL and USD through a simple GET request to our dedicated API.

### 📊 Pump.fun Token Price API

Effortlessly fetch the latest price information for any Pump.fun-listed token by sending a GET request to our endpoint. The returned data includes both SOL and USD values, dynamically calculated based on each token's current bonding curve.

### 🔗 API Endpoint

GET: `https://api.pumpfunapi.org/price/$MINT`

### ⚙️ How It Works

When you issue a GET request to this endpoint, the token's price is determined in real time, reflecting up-to-date bonding curve activity on Pump.fun. Please be aware that only tokens actively traded on Pump.fun will yield a valid price. If a token has migrated to Raydium, this API will not supply pricing data. In such cases, refer to our Raydium Price API for accurate rates.

### 🌟 Key Features

- **⏱️ Real-Time Pricing** - Stay informed with current token prices the moment you make a request.
- **💱 Dual Currency Support** - Obtain comprehensive insights by viewing prices in both SOL and USD.
- **📈 Dynamic Calculations** - Ensure accurate valuations with prices determined by the token's ongoing bonding curve status.

### 💻 Code Example (Node.js)

```javascript
const axios = require('axios');

async function testPriceApi() {
  try {
    const response = await axios.get('https://api.pumpfunapi.org/price/Yngq1h5T6frA435CcP46a6emZuaqfs9bjPiPxAKpump');
    
    // Log the response data
    console.log('Price Data:', response.data);
  } catch (error) {
    // If there was an error, log it
    console.error('Error fetching price:', error.message);
  }
}

// Call the test function
testPriceApi();
```

### 📝 Example Response

```json
{ "SOL": "0.0000000897", "USD": "0.0000137945" }
```

### ⚠️ Important Notes

- Only tokens still active on Pump.fun provide valid results.
- For migrated tokens, please utilize our Raydium Price API to ensure you receive the most accurate, up-to-date pricing data.

## 🔄 Jupiter API Integration for Supplementary Data

Once tokens are identified via Pump.fun, we use the Jupiter API (a Solana swap aggregator) to get additional market data:

- **💲 On-Chain Price from Jupiter** – Using Jupiter's Price API, we can retrieve the token's price as seen across Solana DEX markets ([BETASTATION.JUP.AG](https://betastation.jup.ag)). By default, Jupiter returns the price in terms of USD (via USDC) for the given token mint. This cross-checks the Pump.fun price and indicates if the token is listed and liquid on mainstream markets.

- **🔄 Swap Route Quote** – We integrate Jupiter's Quote API to fetch a potential swap route from the token to a reference asset (e.g. USDC or SOL) ([STATION.JUP.AG](https://station.jup.ag)). This provides insight into liquidity and possible trade paths. For example, the script can request a quote to swap a certain amount of the token to USDC. If a route is returned, it implies the token is tradable on public DEXs and shows the best path and price (including how many hops and through which AMMs).

- **ℹ️ Token Information** – Jupiter's token info endpoint can fetch metadata such as the token's decimals and name ([STATION.JUP.AG](https://station.jup.ag)). We use this to determine the proper amount units for quotes (ensuring we account for token decimals when constructing the swap amount).

By integrating Jupiter, the script gains insight into the token's liquidity and market presence outside Pump.fun. For instance, a token with a Pump.fun price but no Jupiter price likely hasn't been listed on external exchanges yet, whereas a token present on Jupiter with a swap route suggests broader trading activity.

## 🛠️ Improvements in Error Handling and Logging

The script now includes robust error handling and logging at each step:

- Each API call is wrapped in a try/catch block with real-time status indicators using spinners
- Network or response errors are caught and logged with a clear message indicating which function or API failed
- HTTP responses are checked for non-200 status codes with detailed error reporting
- Consistent formatting with color-coded output makes monitoring the script's progress easier
- Parallel requests are handled gracefully, with individual failures not affecting the entire operation

These measures ensure the script is resilient and provides useful feedback during execution, which is critical for reliability.

## 📋 Code Structure and Performance Optimizations

The code is organized into self-contained async functions for each major task (fetching new tokens, getting metadata, prices, etc.), each documented with comments explaining its purpose, inputs, and outputs. Key improvements include:

- **⚡ Parallel Requests**: When retrieving data for multiple tokens, the script uses Promise.all to run these requests concurrently. This significantly speeds up data gathering when multiple tokens are involved.

- **🏷️ Type Definitions**: We define TypeScript interfaces for the responses of Pump.fun and Jupiter endpoints (e.g., PumpFunNewToken, PumpFunPriceInfo, JupiterPriceData, JupiterRouteQuote). This provides compile-time checks and easier debugging.

- **📝 Clear Documentation**: Each function is preceded by a JSDoc comment explaining what it does, its parameters, return type, and any important details.

- **⚙️ Configurability**: The script uses constants for endpoint URLs and allows passing in API keys or other config (if needed for certain endpoints). This makes it easy to adapt without modifying the core logic.

## 🛒 Buy Tokens API

Seamlessly purchase tokens from the latest bonding curves on Pump.fun through PumpfunApi. This robust and user-friendly API is designed for speedy, efficient, and convenient trading on the Solana blockchain.

### 💡 Why Use the Pump.fun Buy API?

The Pump.fun Buy API from PumpfunApi allows you to acquire tokens with a simple POST request. This streamlined process ensures rapid transaction confirmations, low overhead, and minimal hassle for individuals or developers who want to integrate token purchases on Pump.fun.

### 🔑 Key Features

- **⚡ Fast and Efficient Trading** - Experience rapid transaction processing that keeps you ahead in the competitive Solana ecosystem.

- **🔄 Easy Integration** - Effortlessly incorporate the API into any programming language or development environment, making setup and usage as smooth as possible.

- **⚙️ Customizable Parameters** - Tailor your token purchases by configuring slippage rates and fee settings according to your needs.

### 🚀 How to Buy Tokens on Pump.fun Using PumpfunApi

Send a POST request to the Pump.fun Buy API endpoint with the following parameters:

- `private_key` - Your main wallet key, which covers transaction costs and fees.
- `mint` - The token mint address for the asset you intend to buy.
- `amount` - The amount in SOL you plan to spend (e.g., 0.001 or 1.0).
- `microlamports` (Default: 433000) - Manages the base fee for the transaction.
- `units` (Default: 300000) - Works in tandem with microlamports to determine transaction speed and cost.
- `slippage` - A rate set in whole numbers. For example, 10 denotes 10% slippage, 1 denotes 1%, etc.

### 🔗 API Endpoint

Buy API Endpoint: `https://api.pumpfunapi.org/pumpfun/buy`

### ⚙️ Optimizing Your Transactions

The default fee settings are microlamports=1000000 and units=1000000, resulting in approximately 0.001 SOL per transaction. If you require even faster processing, consider raising the fee and slippage settings to meet your specific trading needs.

### 💻 Code Example (Node.js)

```javascript
const axios = require('axios');

// Replace these values with appropriate test values
const privateKey = ''; // APIs Test PK
const mint = '';
const amount = 0.001; // Amount in SOL
const microlamports = 1000000;
const units = 1000000;
const slippage = 10; // 10%

const testBuyRequest = async () => {
  try {
    const response = await axios.post('https://api.pumpfunapi.org/pumpfun/buy', {
      private_key: privateKey,
      mint: mint,
      amount: amount,
      microlamports: microlamports,
      units: units,
      slippage: slippage
    });

    console.log('Response:', response.data);
  } catch (error) {
    console.error('Error:', error.response ? error.response.data : error.message);
  }
};

testBuyRequest();
```

### 📝 Example Response

```json
{ "status": "", "txid": "" }
```

## 💸 Sell Tokens API

Effortlessly convert your SPL tokens to SOL on Pump.fun using PumpfunApi. Experience lightning-fast and hassle-free transactions backed by the reliability of the Solana blockchain.

If you want a quick and straightforward way to sell your SPL tokens on Pump.fun, the Pump.fun Sell API from PumpfunApi offers one of the fastest solutions available. Enjoy efficient swaps for SOL without any complex procedures, perfect for both developers and individual traders.

### 💡 Why Choose the Pump.fun Sell API?

This service has been carefully designed to simplify token-selling processes on Pump.fun. With PumpfunApi, you can effortlessly execute transactions at high speed, keeping unnecessary steps to a minimum. It's the ideal choice for anyone needing a reliable, user-friendly tool for token swaps on the Solana network.

### 🔑 Key Benefits

- **⚡ Fast Transactions** - Execute your token swaps at a rapid pace, ensuring minimal waiting times.
- **🔄 Easy Integration** - Implement the API into virtually any programming language or environment with ease.
- **⚙️ Customizable Parameters** - Adapt the fees and slippage settings based on your specific requirements for the best performance.

### 🚀 How to Sell SPL Tokens on Pump.fun Using PumpfunApi

Send a POST request to the Pump.fun Sell API with the parameters below:

- `private_key` – Your main wallet key to pay for transaction fees.
- `mint` – The token mint address (CA) of the SPL token you intend to sell.
- `amount` – The number of tokens you wish to offload.
- `microlamports` – Default set to 1000000.
- `units` – Default set to 1000000.
- `slippage` – Specify a slippage rate, for instance 10 for 10% or 1 for 1%.

### 🔗 API Endpoint

Sell API Endpoint: `https://api.pumpfunapi.org/pumpfun/sell`

### ⚙️ Optimizing Your Transactions

By default, microlamports and units are set to 1000000, which generally results in about 0.001 SOL in fees. If you need faster processing, consider increasing the fee and slippage parameters.

### 💻 Code Example (Node.js)

```javascript
const axios = require('axios');

const privateKey = ''; // APIs Test PK
const mint = '';
const amount = 500000; // Amount in TOKENS
const microlamports = 1000000;
const units = 1000000;
const slippage = 50; // 50%

const testSellRequest = async () => {
  try {
    const response = await axios.post('https://api.pumpfunapi.org/pumpfun/sell', {
      private_key: privateKey,
      mint: mint,
      amount: amount,
      microlamports: microlamports,
      units: units,
      slippage: slippage
    });

    console.log('Response:', response.data);
  } catch (error) {
    console.error('Error:', error.response ? error.response.data : error.message);
  }
};

testSellRequest();
```

### 📝 Example Response

```json
{ "status": "", "txid": "" }
```

## 📝 Notes

- The script uses the Pump.fun unofficial API (pumpfunapi.org) for new tokens and price, and the official Pump.fun API (pumpapi.fun) for metadata. Depending on availability, these endpoints might require adjustments (e.g., an API key for volume or different base URL if using a specific service). The code is written to be flexible in this regard.

- Jupiter API integration assumes the token mint can be used directly. For very new tokens, Jupiter may not have them in its index until liquidity is added on a Solana DEX. The script handles this by checking if Jupiter returns data, and logs appropriately if not.

- All functions include visually enhanced console output with color coding and status indicators for clarity on what's happening. Progress spinners show real-time status of API requests.