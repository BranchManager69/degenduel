<div align="center">
  <img src="https://degenduel.me/assets/media/logos/transparent_WHITE.png" alt="DegenDuel Logo (White)" width="300">
  
  [![Node.js](https://img.shields.io/badge/Node.js-20.x-green)](https://nodejs.org/)
  [![OpenAI](https://img.shields.io/badge/OpenAI-API-blue)](https://platform.openai.com/)
  [![GPT-4.1-mini](https://img.shields.io/badge/GPT--4.1--mini-Responses%20API-purple)](https://platform.openai.com/docs/models)
  [![Function Calling](https://img.shields.io/badge/Function%20Calling-Enhanced-orange)](https://platform.openai.com/docs/guides/function-calling)
  [![Image Generation](https://img.shields.io/badge/Image%20Generation-GPT--Image--1-green)](https://platform.openai.com/docs/guides/images)
</div>

# DegenDuel AI Service

## Overview

The AI Service is DegenDuel's central intelligence system that provides:

1. **Real-time AI chat capabilities** with platform data integration
2. **Periodic data analysis** for errors, admin actions, and logs
3. **Image generation** for profiles and contests
4. **Dynamic function calling** for accessing platform data

## Architecture

The AI Service follows a modular architecture:

```
services/ai-service/
├── ai-service.js            # Main service implementation
├── index.js                 # Entry point
├── image-generator.js       # Profile image generation
├── analyzers/               # Analysis modules
│   ├── error-analyzer.js    # Client error analysis
│   ├── admin-analyzer.js    # Admin action analysis
│   └── log-analyzer.js      # Log file analysis
├── models/                  # Service configuration
│   └── loadout-config.js    # AI model configurations
└── utils/                   # Utility functions
    ├── prompt-builder.js    # AI prompt enhancement
    ├── terminal-function-handler.js  # Function implementations
    └── additional-functions.js       # Extended function set
```

## Main Components

### 1. Core Service (`ai-service.js`)

The main service implementation that:
- Extends the platform's BaseService
- Initializes the OpenAI client
- Provides AI response methods
- Manages conversation storage
- Runs periodic analysis tasks

API Methods:
- `generateChatCompletion` - Legacy method using OpenAI Chat API
- `generateTokenAIResponse` - Uses OpenAI Responses API with function calling
- `generateAIResponse` - Streaming version using OpenAI Responses API

### 2. Terminal Functions (`terminal-function-handler.js`)

Implements a rich set of platform data access functions:

- **Token Data**: Price, history, pools, metrics
- **Contests**: Active contests, details
- **User Data**: Profiles, leaderboards, history
- **Platform Activity**: Recent transactions, achievements
- **Admin Tools**: Service status, system settings

### 3. Image Generation (`image-generator.js`)

Provides AI-powered image generation:

- User profile pictures with customizable styles
- Enhanced profile images with token integration
- Support for various image formats and configurations

## Usage

### Basic AI Response

```javascript
import aiService from '../services/ai-service';

// Generate an AI response with function calling capabilities
const response = await aiService.generateTokenAIResponse(
  [{ role: 'user', content: 'What tokens are trending today?' }],
  {
    userId: user.wallet_address,
    userRole: user.role
  }
);

// Use streaming for real-time responses
const stream = await aiService.generateAIResponse(
  [{ role: 'user', content: 'Explain how contests work' }],
  { userId: user.wallet_address }
);
```

### Profile Image Generation

```javascript
import imageGenerator from '../services/ai-service/image-generator';

// Generate a profile image
const imageUrl = await imageGenerator.generateUserProfileImage(
  walletAddress,
  { style: 'cyberpunk' }
);
```

## Configuration

AI Service configuration lives in `models/loadout-config.js`. Here are the current configurations:

### Default Configuration
```javascript
// Default loadout
default: {
  model: 'gpt-4.1-mini',
  maxTokens: 1000,
  temperature: 0.6,
  systemPrompt: '...'  // Didi personality prompt
}
```

### Specialized Loadouts

| Loadout Name | Model | Max Tokens | Temperature | Purpose |
|--------------|-------|------------|-------------|---------|
| errorAnalysis | gpt-4.1-mini | 2000 | 0.4 | Client error analysis |
| adminAnalysis | gpt-4.1-mini | 2000 | 0.4 | Admin action analysis |
| logAnalysis | gpt-4.1-mini | 2500 | 0.2 | Server log analysis |
| terminal | gpt-4.1-mini | 1000 | 0.6 | Terminal interface persona |
| trading | gpt-4.1-mini | 1200 | 0.6 | Trading advisor functionality |
| support | gpt-4.1-mini | 1500 | 0.4 | Technical support responses |
| creative | gpt-4.1-mini | 1000 | 0.7 | Creative content generation |
| coding | gpt-4.1-mini | 4000 | 0.4 | Code generation and analysis |

### Image Generation Configurations

The system has two separate image generation implementations:

1. **AI Service Image Generator** (`image-generator.js`)
```javascript
// Profile images configuration
profile: {
  model: "gpt-image-1",
  size: "1024x1024",      // Square format
  quality: "medium",      // Options: "high", "medium", "low"
  output_format: "png"
}
```

2. **Contest Image Service** (`utils/contest-image-utils.js` - separate service)
```javascript
// Contest images configuration
DEFAULT_CONFIG = {
  model: "gpt-image-1",     
  size: "1536x1024",        // Landscape format
  quality: "medium",        // Options: "high", "medium", "low"
  output_format: "png",     
  background: "auto",       
  moderation: "low",        
  useTokenData: true        // Uses token data to enhance prompts
}
```

> **Note:** These are separate implementations with their own OpenAI client instances and configuration. See Architecture section for details.

### Analysis Intervals
- Client Errors: Every 10 minutes
- Admin Actions: Every 15 minutes
- General Logs: Every 5 minutes
- Error Logs: Every 5 minutes
- Service Logs: Every 5 minutes

## Prompt Engineering Comparison

The two image generation systems use dramatically different prompt engineering approaches.

### Image Generator Approaches

#### 1. Profile Image Generator (`image-generator.js`)

**Purpose:** Generates personalized profile images for users

**Base Prompts:**
The system has predefined style templates like:
- **Default:** `Create a high-quality profile picture. The image should be a creative abstract design that would make a good profile picture. Use vibrant colors, interesting patterns, and modern design elements. Make it visually striking and unique.`
- **Cyberpunk:** `Create a cyberpunk-themed profile picture. Use neon colors, digital elements, and futuristic cyberpunk aesthetics. Include glowing elements, circuit patterns, and a high-tech feel.`
- **Minimalist:** `Create a minimalist, modern profile picture. Use simple shapes, clean lines, and a limited color palette. The design should be elegant, uncluttered, and contemporary.`
- Plus other styles: avatar, pixelart, space, crypto

**Personalization:**
- Inserts the user's name into the prompt: `profile picture for a user named "UserName"`
- Adds user's achievements: `Consider that this user has achievements related to: Diamond Trader, Contest Master, etc.`
- Adds user's level and title: `The user has reached level 5 and has the title "Crypto Wizard"`
- Adds user stats: `The user has entered 10 contests and won 3` and `The user has made 50 trades`

**Explicit Styling Guidance:**
```
IMPORTANT: DO NOT include any text, letters, numbers, or words in the image. 
DO NOT include a frame, border, or any UI elements. The image should be a 
standalone visual design without any text elements whatsoever. Create a 
centered composition that works well as a profile picture.
```

#### 2. Contest Image Generator (`utils/contest-image-utils.js`)

**Purpose:** Creates banner images for trading contests with token-specific elements

**Base Prompt:**
```
Create a high-impact banner image for a cryptocurrency trading contest on DegenDuel. 
The contest is called "[CONTEST NAME]" and described as: "[CONTEST DESCRIPTION]".
```

**Token Data Enhancement:**
This is where it gets extremely sophisticated:

1. **Basic Token Info:**
   - Lists featured tokens: `This contest features these tokens: BTC, ETH, SOL.`
   - Adds descriptions for each token

2. **Token Metadata (from DexScreener & Database):**
   - Social links: `SOL Twitter: https://twitter.com/solana`
   - Financial data: `SOL Liquidity: $25,000,000 USD`
   - Trading data: `SOL 24h Volume: $15,000,000 USD`
   - Pool information: `SOL traded in SOL/USDC pool`
   - Price changes: `SOL 24h Price Change: +5.2%`
   - Market caps: `SOL Market Cap: $50,000,000,000 USD`

3. **Token Tags:**
   - Categories like: `Token categories: meme, utility, gaming, DeFi`

**Explicit Styling Guidance:**
```
The image should be high-quality, modern, and visually striking, suitable for 
a crypto trading platform. Include crypto trading elements like charts, token symbols, 
and trading interfaces. IMPORTANT: DO NOT include any text, words, or labels in the 
image - create a purely visual experience without any readable text.
```

### Key Differences

1. **Data Sources:**
   - Profile generator: Uses user data (level, achievements, stats)
   - Contest generator: Uses comprehensive token data (financial metrics, social links, descriptions)

2. **Complexity:**
   - Profile generator: Simpler prompts focused on style and user identity
   - Contest generator: Extremely detailed prompts with rich token data from multiple sources

3. **External API Integration:**
   - Profile generator: None
   - Contest generator: Integrates with DexScreener for real-time token data

4. **Customization:**
   - Profile generator: Multiple predefined visual styles (cyberpunk, minimalist, etc.)
   - Contest generator: Dynamic style based on token characteristics

5. **Scope:**
   - Profile generator: Personal identity focused
   - Contest generator: Financial/trading context focused

### Example Prompts

#### Profile Image - Complete Prompt Example

```
Create a cyberpunk-themed profile picture for a user named "CryptoRebel". Use neon colors, digital elements, and futuristic cyberpunk aesthetics. Include glowing elements, circuit patterns, and a high-tech feel. Consider that this user has achievements related to: Diamond Hands, Trading Master, Early Adopter. The user has reached level 12 and has the title "Blockchain Sage". The user has entered 27 contests and won 8. The user has made 143 trades. IMPORTANT: DO NOT include any text, letters, numbers, or words in the image. DO NOT include a frame, border, or any UI elements. The image should be a standalone visual design without any text elements whatsoever. Create a centered composition that works well as a profile picture.
```

#### Contest Image - Complete Prompt Example

```
Create a high-impact banner image for a cryptocurrency trading contest on DegenDuel. The contest is called "Solana Summer Showdown" and described as: "Battle for the highest returns using only Solana ecosystem tokens in this 48-hour trading competition with a prize pool of 500 SOL!".

This contest features these tokens: SOL, BONK, MANGO. 

SOL: Solana is a high-performance blockchain supporting builders around the world creating crypto apps that scale. Solana is known for its fast transaction speeds and low costs, making it suitable for a variety of applications including DeFi, NFTs, and Web3 applications. DexScreener description: Solana is a high-throughput blockchain designed for decentralized apps and marketplaces. | 

BONK: The first Solana dog coin for the people, by the people. A community-focused token that aims to bring back the fun in crypto while providing utility within the Solana ecosystem. DexScreener description: Solana-based meme coin created by the community as a counter to establishment coins. | 

MANGO: Decentralized, cross-margin trading platform with up to 5x leverage for spot and perpetual futures trading with integrated limit orders. DexScreener description: Decentralized trading platform on Solana with leveraged trading capabilities. | 

SOL Twitter: https://twitter.com/solana SOL Telegram: https://t.me/solana SOL Website: https://solana.com SOL Discord: https://discord.com/invite/solana

SOL Liquidity: $1,250,000,000 USD. SOL 24h Volume: $750,000,000 USD. SOL traded in SOL/USDC pool. SOL Fully Diluted Value: $21,500,000,000 USD. SOL 24h Price Change: +3.7%. SOL 6h Price Change: +1.2%. SOL 1h Price Change: -0.3%. SOL Market Cap: $18,750,000,000 USD. SOL Current Price: $45.37 USD.

BONK Twitter: https://twitter.com/bonk_inu BONK Telegram: https://t.me/bonkcoinsol BONK Website: https://bonkcoin.com BONK Discord: https://discord.gg/bonktoken

BONK Liquidity: $25,000,000 USD. BONK 24h Volume: $12,500,000 USD. BONK traded in BONK/SOL pool. BONK 24h Price Change: +15.2%. BONK Market Cap: $750,000,000 USD. BONK Current Price: $0.00000235 USD.

MANGO Twitter: https://twitter.com/mangomarkets MANGO Website: https://mango.markets

MANGO Liquidity: $8,500,000 USD. MANGO 24h Volume: $3,200,000 USD. MANGO traded in MANGO/USDC pool. MANGO 24h Price Change: -2.5%. MANGO Market Cap: $125,000,000 USD. MANGO Current Price: $0.18 USD. MANGO Raydium: Liquidity $3,250,000 USD, Volume $1,800,000 USD. MANGO Orca: Liquidity $2,750,000 USD, Volume $1,400,000 USD.

Token categories: defi, meme, solana-ecosystem, trading, utility.

The image should be high-quality, modern, and visually striking, suitable for a crypto trading platform. Include crypto trading elements like charts, token symbols, and trading interfaces. IMPORTANT: DO NOT include any text, words, or labels in the image - create a purely visual experience without any readable text.
```

## Test & Development

Run the test suite:

```bash
node tests/terminal-ai-real-test.js
```

## Future Improvements

1. **Unified OpenAI Client**
   - Create a shared client for all AI services
   - Centralize token usage tracking

2. **Integrated Image Generation**
   - Add image generation functions to terminal functions
   - Combine duplicate prompt building logic

3. **Enhanced Function System**
   - Add structured output capabilities
   - Expand available functions
   - Create more admin tools

4. **Standardize on Responses API**
   - Migrate away from Chat Completions API
   - Create consistent interfaces