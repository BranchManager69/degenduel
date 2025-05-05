# DEX Screener API Cheatsheet

The DEX Screener API is a RESTful API that provides access to DEX Screener data. It is a public API that is free to use; no API key is required.

## Table of Contents

- [Market Data](#market-data)
  - [Rate Limits](#rate-limits)
  - [Endpoints](#endpoints-market)
    - [Get pairs by chain and pair address](#get-pairs-by-chain-and-pair-address)
    - [Search pairs](#search-pairs)
    - [Get pools by token address](#get-pools-by-token-address)
    - [Get pairs by token address](#get-pairs-by-token-address)
  - [Notes](#notes-market)
- [Proprietary DEX Screener Data](#proprietary-dex-screener-data)
  - [Rate Limits](#rate-limits-proprietary)
  - [Endpoints](#endpoints-proprietary)
    - [Latest Token Profiles](#latest-token-profiles)
    - [Top Token Boosts](#top-token-boosts)
    - [DEX Screener Orders](#dex-screener-orders)
  - [Notes](#notes-proprietary)

## Market Data

### Rate Limits
- 300 requests per minute

### Endpoints

<a name="get-pairs-by-chain-and-pair-address"></a>
- **Get one or multiple pairs by chain and pair address:**
  ```
  GET https://api.dexscreener.com/latest/dex/pairs/{chainId}/{pairIds}
  ```
  *Note: Rate limit is 300 requests per minute. `{pairIds}` can likely be a comma-separated list of pair addresses (up to 30, similar to token addresses endpoint).*

  **Response Format:**

  The response contains a `schemaVersion` and a `pairs` array. Each object in the `pairs` array follows the structure confirmed across other market data endpoints and aligned with the provided schema.

  ```json
  {
    "schemaVersion": "1.0.0", // Example version, may not be in actual response
    "pairs": [
      {
        "chainId": "solana", // String
        "dexId": "raydium", // String
        "url": "https://dexscreener.com/solana/...", // String (URI)
        "pairAddress": "Gj5t6KjTw3...", // String
        "labels": ["CLMM"], // Optional/Nullable String Array (e.g., "DLMM", "CLMM", "CPMM", "v2", "wp")
        "baseToken": {
          "address": "DitHyRMQiS...", // String
          "name": "Housecoin", // String
          "symbol": "House" // String
        },
        "quoteToken": {
          "address": "So11111111...", // String (Nullable)
          "name": "Wrapped SOL", // String (Nullable)
          "symbol": "SOL" // String (Nullable)
        },
        "priceNative": "0.0006183", // String (Price in terms of quote token)
        "priceUsd": "0.09129",    // String (Nullable, Price in USD)
        "txns": { // Object containing transaction counts for specific timeframes
          "m5": { "buys": 39, "sells": 33 },
          "h1": { "buys": 724, "sells": 613 },
          "h6": { "buys": 5934, "sells": 5687 },
          "h24": { "buys": 20755, "sells": 17123 }
        },
        "volume": { // Object containing volume in USD for specific timeframes
          "m5": 31356.76,
          "h1": 618793.3,
          "h6": 6465210.07,
          "h24": 18391531.36
        },
        "priceChange": { // Object (Nullable) containing percentage change for specific timeframes
          "m5": -0.47,
          "h1": 2.11,
          "h6": 16.64,
          "h24": 49.62
        },
        "liquidity": { // Object (Nullable) containing liquidity details
          "usd": 2258353.03, // Number (Nullable, Total liquidity in USD)
          "base": 12353144,   // Number (Liquidity in base token units)
          "quote": 7657.7428  // Number (Liquidity in quote token units)
        },
        "fdv": 91180662,        // Number (Nullable, Fully Diluted Valuation)
        "marketCap": 91180662, // Number (Nullable, Market Cap)
        "pairCreatedAt": 1742836571000, // Integer (Nullable, Unix timestamp milliseconds)
        "info": { // Object (Nullable) containing additional token info
          "imageUrl": "https://dd.dexscreener.com/ds-data/...", // String (URI, Nullable)
          "header": "https://dd.dexscreener.com/ds-data/...", // String (URI, Assumed based on other examples)
          "openGraph": "https://cdn.dexscreener.com/...",   // String (URI, Assumed based on other examples)
          "websites": [ // Array (Nullable)
            { "label": "Website", "url": "https://..." } // Objects with label/url (Assumed based on other examples)
          ],
          "socials": [ // Array (Nullable)
            { "type": "twitter", "url": "https://..." }, // Objects with type/url (Assumed based on other examples)
            { "type": "telegram", "url": "https://..." }
          ]
        },
        "boosts": { // Optional/Nullable Object
           "active": 1
        }
      }
      // ... more pair objects if multiple pairIds were requested
    ]
  }
  ```

  **Notes on Response Format:**
  *   The response structure is assumed to be consistent with other confirmed market data endpoints (`/latest/dex/search`, `/latest/dex/tokens/...`, `/token-pairs/v1/...`).
  *   Specific timeframes (`m5`, `h1`, `h6`, `h24`) are assumed for `txns`, `volume`, and `priceChange` based on observed consistency.
  *   The `info` object structure (including `header`, `openGraph`, `websites.label`, `socials.type/url`) is assumed based on observed consistency.
  *   Fields like `labels`, `priceUsd`, `priceChange`, `liquidity`, `fdv`, `marketCap`, `pairCreatedAt`, `info` fields, and `boosts` are optional/nullable.

<a name="search-pairs"></a>
- **Search for pairs matching query:**
  ```
  GET https://api.dexscreener.com/latest/dex/search?q={query}
  ```
  *Note: Rate limit is 300 requests per minute. The `{query}` parameter is a string used for broad matching against token names, symbols, or pair addresses (e.g., "SOL/USDC", "House", "Gj5t6K...").*

  **Response Format:**

  The response contains a `schemaVersion` and a `pairs` array. Each object in the `pairs` array follows a structure consistent with other market data endpoints, refined by real-world examples.

  ```json
  {
    "schemaVersion": "1.0.0",
    "pairs": [
      {
        "chainId": "solana", // String
        "dexId": "pumpswap", // String
        "url": "https://dexscreener.com/solana/...", // String (URI)
        "pairAddress": "Gj5t6KjTw3...", // String
        "labels": ["CLMM"], // Optional/Nullable String Array (e.g., "DLMM", "CLMM", "CPMM", "v2", "wp")
        "baseToken": {
          "address": "DitHyRMQiS...", // String
          "name": "Housecoin", // String
          "symbol": "House" // String
        },
        "quoteToken": {
          "address": "So11111111...", // String (Nullable)
          "name": "Wrapped SOL", // String (Nullable)
          "symbol": "SOL" // String (Nullable)
        },
        "priceNative": "0.0006183", // String (Price in terms of quote token)
        "priceUsd": "0.09129",    // String (Nullable, Price in USD)
        "txns": { // Object containing transaction counts for specific timeframes
          "m5": { "buys": 39, "sells": 33 },
          "h1": { "buys": 724, "sells": 613 },
          "h6": { "buys": 5934, "sells": 5687 },
          "h24": { "buys": 20755, "sells": 17123 }
        },
        "volume": { // Object containing volume in USD for specific timeframes
          "m5": 31356.76,
          "h1": 618793.3,
          "h6": 6465210.07,
          "h24": 18391531.36
        },
        "priceChange": { // Object (Nullable) containing percentage change for specific timeframes
          "m5": -0.47,
          "h1": 2.11,
          "h6": 16.64,
          "h24": 49.62
        },
        "liquidity": { // Object (Nullable) containing liquidity details
          "usd": 2258353.03, // Number (Nullable, Total liquidity in USD)
          "base": 12353144,   // Number (Liquidity in base token units)
          "quote": 7657.7428  // Number (Liquidity in quote token units)
        },
        "fdv": 91180662,        // Number (Nullable, Fully Diluted Valuation)
        "marketCap": 91180662, // Number (Nullable, Market Cap)
        "pairCreatedAt": 1742836571000, // Integer (Nullable, Unix timestamp milliseconds)
        "info": { // Object (Nullable) containing additional token info
          "imageUrl": "https://dd.dexscreener.com/ds-data/...", // String (URI, Nullable)
          "header": "https://dd.dexscreener.com/ds-data/...", // String (URI, Present in examples, not explicitly in schema)
          "openGraph": "https://cdn.dexscreener.com/...",   // String (URI, Present in examples, not explicitly in schema)
          "websites": [ // Array (Nullable)
            { "label": "Website", "url": "https://..." } // Objects with label/url (schema omits label)
          ],
          "socials": [ // Array (Nullable)
            { "type": "twitter", "url": "https://..." }, // Objects with type/url (schema shows platform/handle)
            { "type": "telegram", "url": "https://..." }
          ]
        },
        "boosts": { // Optional/Nullable Object (Present in some example responses)
           "active": 30
        }
      }
      // ... more pair objects matching the search query
    ]
  }
  ```

  **Notes on Response Format:**
  *   The response structure is consistent with other market data endpoints (`/latest/dex/tokens/...`, `/token-pairs/v1/...`).
  *   The search query (`q`) matches broadly across token names, symbols, and potentially pair addresses, returning results across different chains if applicable.
  *   Specific timeframes (`m5`, `h1`, `h6`, `h24`) are consistently used for `txns`, `volume`, and `priceChange`.
  *   The `info.socials` structure uses `type`/`url` in examples, differing from the schema's `platform`/`handle`.
  *   The `info.websites` structure includes `label` in examples, absent in the schema.
  *   The `info` object also contains `header` and `openGraph` URLs in examples.
  *   Fields like `labels`, `priceUsd`, `priceChange`, `liquidity`, `fdv`, `marketCap`, `pairCreatedAt`, `info` fields, and `boosts` are optional/nullable.

<a name="get-pools-by-token-address"></a>
- **Get the pools of a given token address:** (Returns pairs for a *single* token address)
  ```
  GET https://api.dexscreener.com/token-pairs/v1/{chainId}/{tokenAddress}
  ```
  *Note: Rate limit is 300 requests per minute for this endpoint.*

  **Response Format:**

  The response is an array of pair objects. Below is the structure based on the documentation schema and confirmed/refined by real-world examples (`getTokenPairsResponseExample1.json`, `getTokenPairsResponseExample2.json`).

  ```json
  [
    {
      // "schemaVersion": "1.0.0", // Not present in actual response, added for conceptual clarity
      // "pairs": [ // The endpoint returns a direct array of pair objects, not nested under "pairs"
        {
          "chainId": "solana", // String
          "dexId": "pumpswap", // String
          "url": "https://dexscreener.com/solana/...", // String (URI)
          "pairAddress": "ANY6m193bZ...", // String
          "labels": ["DLMM"], // Optional/Nullable String Array (e.g., "DLMM", "CLMM", "CPMM", "wp")
          "baseToken": {
            "address": "qRUZaCpgxa...", // String
            "name": "100 Men vs 1 Gorilla", // String
            "symbol": "MvG" // String
          },
          "quoteToken": {
            "address": "So11111111...", // String (Nullable)
            "name": "Wrapped SOL", // String (Nullable)
            "symbol": "SOL" // String (Nullable)
          },
          "priceNative": "0.00004265", // String (Price in terms of quote token)
          "priceUsd": "0.006300",    // String (Nullable, Price in USD)
          "txns": { // Object containing transaction counts for specific timeframes
            "m5": { "buys": 367, "sells": 304 },
            "h1": { "buys": 2754, "sells": 2255 },
            "h6": { "buys": 6802, "sells": 5960 },
            "h24": { "buys": 33035, "sells": 29606 }
          },
          "volume": { // Object containing volume in USD for specific timeframes
            "m5": 130861.74,
            "h1": 1058864.43,
            "h6": 2318738.45,
            "h24": 12577718.45
          },
          "priceChange": { // Object (Nullable) containing percentage change for specific timeframes
            "m5": 8.26,
            "h1": 34.83,
            "h6": 56.54,
            "h24": 158
          },
          "liquidity": { // Object (Nullable) containing liquidity details
            "usd": 401970.82,   // Number (Nullable, Total liquidity in USD)
            "base": 31924900,   // Number (Liquidity in base token units)
            "quote": 1359.3655  // Number (Liquidity in quote token units)
          },
          "fdv": 6300139,        // Number (Nullable, Fully Diluted Valuation)
          "marketCap": 6300139, // Number (Nullable, Market Cap)
          "pairCreatedAt": 1745471712000, // Integer (Nullable, Unix timestamp milliseconds)
          "info": { // Object (Nullable) containing additional token info
            "imageUrl": "https://dd.dexscreener.com/ds-data/...", // String (URI, Nullable)
            "header": "https://dd.dexscreener.com/ds-data/...", // String (URI, Present in examples, not in schema)
            "openGraph": "https://cdn.dexscreener.com/...",   // String (URI, Present in examples, not in schema)
            "websites": [ // Array (Nullable)
              { "label": "Website", "url": "https://..." } // Objects with label/url (label not in schema)
            ],
            "socials": [ // Array (Nullable)
              { "type": "twitter", "url": "https://..." }, // Objects with type/url (schema shows platform/handle)
              { "type": "telegram", "url": "https://..." }
            ]
          }
          // "boosts": { "active": 1 } // Optional/Nullable Object (Absent in examples)
        }
        // ... more pair objects for the requested token address
      // ]
    }
  ]
  ```

  **Notes on Response Format:**
  *   The endpoint returns a JSON array directly containing the pair objects.
  *   The structure is based on the documentation schema, significantly refined by real-world examples.
  *   Specific timeframes (`m5`, `h1`, `h6`, `h24`) are consistently used for `txns`, `volume`, and `priceChange`.
  *   The `info.socials` object uses `type`/`url` in examples, though the schema mentions `platform`/`handle`.
  *   The `info.websites` object includes `label` in examples, which is not in the schema.
  *   The `info` object also contains `header` and `openGraph` URLs in examples, not explicitly listed in the schema.
  *   Fields like `labels`, `priceUsd`, `priceChange`, `liquidity`, `fdv`, `marketCap`, `pairCreatedAt`, `info` fields, and `boosts` are optional/nullable and may not be present in all responses or for all pairs.

<a name="get-pairs-by-token-address"></a>
- **Get pairs by token address:**
  ```
  GET https://api.dexscreener.com/latest/dex/tokens/{tokenAddresses}
  ```
  *Note: `{tokenAddresses}` can be a comma-separated list of up to 30 addresses. The chainId is not needed in the URL path.*

  **Response Format:**

  Below is an example response structure based on observed real-world responses (e.g., for `DitHyRM...`, `5UUH9R...`, `qRUZaC...` on Solana). It assumes a `schemaVersion` field for clarity.

  ```json
  {
    "schemaVersion": "1.0.0", // Example version
    "pairs": [
      {
        "chainId": "solana", // String
        "dexId": "pumpswap", // String
        "url": "https://dexscreener.com/solana/...", // String (URI)
        "pairAddress": "Gj5t6KjTw3gWW7SrMHEi1ojCkaYHyvLwb17gktf96HNH", // String
        // "labels": ["string", ...], // Optional/Nullable String Array
        "baseToken": {
          "address": "DitHyRMQiSDhn5cnKMJV2CDDt6sVct96YrECiM49pump", // String
          "name": "Housecoin", // String
          "symbol": "House" // String
        },
        "quoteToken": {
          "address": "So11111111111111111111111111111111111111112", // String (Nullable)
          "name": "Wrapped SOL", // String (Nullable)
          "symbol": "SOL" // String (Nullable)
        },
        "priceNative": "0.0006424", // String (Price in terms of quote token)
        "priceUsd": "0.09419",    // String (Nullable, Price in USD)
        "txns": { // Object containing transaction counts for specific timeframes
          "m5": { "buys": 128, "sells": 58 }, // 5-minute buys/sells
          "h1": { "buys": 766, "sells": 648 }, // 1-hour buys/sells
          "h6": { "buys": 6164, "sells": 5897 }, // 6-hour buys/sells
          "h24": { "buys": 20594, "sells": 17002 } // 24-hour buys/sells
        },
        "volume": { // Object containing volume in USD for specific timeframes
          "m5": 81432.62,
          "h1": 755131.32,
          "h6": 6830861.71,
          "h24": 18313247.42
        },
        "priceChange": { // Object (Nullable) containing percentage change for specific timeframes
          "m5": -1.03,
          "h1": 2.39,
          "h6": 16.84,
          "h24": 54.17
        },
        "liquidity": { // Object (Nullable) containing liquidity details
          "usd": 2285651.53,   // Number (Nullable, Total liquidity in USD)
          "base": 12132263,   // Number (Liquidity in base token units)
          "quote": 7794.5997  // Number (Liquidity in quote token units)
        },
        "fdv": 94079126,        // Number (Nullable, Fully Diluted Valuation)
        "marketCap": 94079126, // Number (Nullable, Market Cap)
        "pairCreatedAt": 1742836571000, // Integer (Nullable, Unix timestamp milliseconds)
        "info": { // Object containing additional token info
          "imageUrl": "https://dd.dexscreener.com/ds-data/...", // String (URI, Nullable)
          "websites": [ // Array (Nullable)
            { "label": "Website", "url": "https://..." } // Objects with label/url
          ],
          "socials": [ // Array (Nullable)
            { "type": "twitter", "url": "https://..." }, // Objects with type/url
            { "type": "telegram", "url": "https://..." }
          ]
        }
        // "boosts": { "active": 1 } // Optional/Nullable Object
      }
      // ... more pairs involving the requested token(s)
    ]
  }
  ```

  **Notes on Response Format:**
  *   The structure above is based on consistent observations across multiple real-world examples.
  *   Specific timeframes (`m5`, `h1`, `h6`, `h24`) are consistently used for `txns`, `volume`, and `priceChange` objects.
  *   Fields like `marketCap` appear consistently in examples, although marked nullable in some schemas.
  *   Documentation indicates several fields are `nullable` (optional), including `labels`, `quoteToken` details, `priceUsd`, `priceChange`, `liquidity`, `fdv`, `marketCap`, `pairCreatedAt`, `info` fields, and `boosts`. These may not be present in all responses.

<a name="notes-market"></a>
### Notes:
- All endpoints use the `GET` method.
- All are paginated with a default limit of 100 items per page.
- All return JSON.

## Proprietary DEX Screener Data

### Rate Limits
- 60 requests per minute for all endpoints

### Endpoints

<a name="latest-token-profiles"></a>
- **Latest DEX Screener Enhanced Token Profiles:**
  ```
  GET https://api.dexscreener.com/token-profiles/latest/v1
  ```
  *Note: Rate limit is 60 requests per minute.*

  **Response Format:**

  The response is a JSON array, where each object represents an enhanced token profile.

  ```json
  [
    {
      "url": "https://dexscreener.com/solana/...", // String (URI, Dexscreener URL for the token)
      "chainId": "solana", // String
      "tokenAddress": "7DasPgeC8T...", // String
      "icon": "https://dd.dexscreener.com/ds-data/...", // String (URI, Nullable, Token icon URL)
      "header": "https://dd.dexscreener.com/ds-data/...", // String (URI, Nullable, Token header image URL)
      "openGraph": "https://cdn.dexscreener.com/...",   // String (URI, Nullable, OpenGraph image URL, observed in examples)
      "description": "FIRST BANNER EVER ON PUMPFUN!", // String (Nullable, Token description)
      "links": [ // Array (Nullable)
        {
          "type": "telegram", // String (Nullable, e.g., "twitter", "telegram")
          "label": "Website", // String (Nullable, e.g., "Website")
          "url": "https://pump.fun/..." // String (URI)
        }
        // ... more links
      ]
    }
    // ... more token profile objects
  ]
  ```

  **Notes on Response Format:**
  *   The endpoint returns a direct JSON array of profile objects.
  *   The `openGraph` field was observed in real-world examples but may not be listed in all schema versions.
  *   Fields like `header`, `openGraph`, `description`, the `links` array itself, and `links.type`/`links.label` are optional/nullable and may not be present for all tokens.

<a name="top-token-boosts"></a>
- **Top DEX Screener Token Boosts:**
  ```
  GET https://api.dexscreener.com/token-boosts/top/v1
  ```
  *Note: Rate limit is 60 requests per minute. This endpoint retrieves tokens ranked by the highest total boost amount.*

  **Response Format:**

  The response is a JSON array, where each object represents a boosted token profile, ordered by `totalAmount`.

  ```json
  [
    {
      "url": "https://dexscreener.com/solana/...", // String (URI, Dexscreener URL for the token)
      "chainId": "solana", // String
      "tokenAddress": "8paqsi3mj8...", // String
      // "amount": 1000, // Number (Nullable, Boost amount for a specific event, might be absent in /top/v1)
      "totalAmount": 1000, // Number (Total cumulative boost amount for the token, used for ranking)
      "icon": "8b2d2e6bbc...", // String (URI, Nullable, Token icon - sometimes a hash?)
      "header": "https://cdn.dexscreener.com/cms/...", // String (URI, Nullable, Token header image URL)
      "openGraph": "https://cdn.dexscreener.com/...",   // String (URI, Nullable, OpenGraph image URL, observed in examples)
      "description": "Tired of uncertainty?...", // String (Nullable, Token description)
      "links": [ // Array (Nullable)
        {
          "type": "telegram", // String (Nullable, e.g., "twitter", "telegram")
          "label": "Website", // String (Nullable, e.g., "Website")
          "url": "https://t.me/..." // String (URI)
        }
        // ... more links
      ]
    }
    // ... more boosted token objects, ordered by totalAmount descending
  ]
  ```

  **Notes on Response Format:**
  *   The endpoint returns a direct JSON array of boost objects, ranked by `totalAmount`.
  *   The structure is very similar to `/token-boosts/latest/v1` but may omit the `amount` field.
  *   Includes token profile information (`icon`, `header`, `openGraph`, `description`, `links`).
  *   The `openGraph` field was observed in real-world examples.
  *   Fields like `icon`, `header`, `openGraph`, `description`, `links` array, `links.type`/`links.label`, and potentially `amount` are optional/nullable.

<a name="dex-screener-orders"></a>
- **DEX Screener Orders:** (Check status of paid orders for a token)
  ```
  GET https://api.dexscreener.com/orders/v1/{chainId}/{tokenAddress}
  ```
  *Note: Rate limit is 60 requests per minute.*

  **Response Format:**

  The response is a JSON array, where each object represents a paid order associated with the token.

  ```json
  [
    {
      "type": "tokenProfile", // String (Enum: "tokenProfile", "communityTakeover", "tokenAd", "trendingBarAd")
      "status": "approved", // String (Enum: "processing", "cancelled", "on-hold", "approved", "rejected")
      "paymentTimestamp": 1745950112274 // Number (Unix timestamp milliseconds, likely)
    }
    // ... potentially more order objects for the token
  ]
  ```

  **Notes on Response Format:**
  *   The endpoint returns a direct JSON array of order status objects.
  *   Provides the type and status for different kinds of paid services related to the token.

<a name="notes-proprietary"></a>
### Notes:
- All endpoints use the `GET` method.
- All are paginated with a default limit of 100 items per page.
- All return JSON.
