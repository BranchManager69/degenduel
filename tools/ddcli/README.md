# DegenDuel CLI (ddcli)

A modular command-line interface tool for DegenDuel project management and operations.

## Installation

```bash
# From the root directory
cd /home/websites/degenduel/tools/ddcli
npm link
```

## Usage

```bash
# Get help
ddcli --help

# Show interactive menu of available modules
ddcli menu

# Twitter Monitor
ddcli twitter monitor kanye     # Monitor tweets with "kanye"
ddcli twitter monitor "$GHIBLI" # Monitor tweets with a token ticker
ddcli twitter monitor kanye -i 60 -l 20  # Custom interval and tweet limit

# Twitter Scraper (similar to 'npm run x')
ddcli twitter scrape https://x.com/username/status/123456789
ddcli twitter scrape https://x.com/username/status/123456789 --visible=false

# X Scraper shorthand (same as npm run x)
ddcli twitter x https://x.com/username/status/123456789
ddcli twitter x https://x.com/username/status/123456789 -f  # Fast mode (skip visible elements)

# Liquidity Pool Monitor
ddcli lp monitor <pool-address>  # Monitor a Pump.fun liquidity pool
ddcli lp list                    # List active Pump.fun liquidity pools
ddcli lp list -c 20              # Show top 20 liquidity pools

# Trade Tokens
ddcli trade buy <token-address> -a 0.05     # Buy tokens with 0.05 SOL
ddcli trade sell <token-address> -p 50      # Sell 50% of tokens
ddcli trade sell <token-address> -a 1000    # Sell exactly 1000 tokens
ddcli trade price <token-address>           # Get current token price
ddcli trade balance <token-address>         # Check token balance

# Settings Management
ddcli settings menu              # Open interactive settings menu
ddcli settings status            # Show current settings
ddcli settings rpc list          # List available RPC endpoints
ddcli settings rpc set <name>    # Set active RPC endpoint
ddcli settings wallet list       # List available wallets
ddcli settings wallet set <name> # Set active wallet

# Direct npm script (equivalent to twitter x)
npm run x https://x.com/username/status/123456789
```

## Settings Keyboard Shortcuts

While using any interactive command (like monitoring a liquidity pool), you can:

- Press `s` at any time to open the settings menu
- Change RPC endpoints or active wallets without exiting the current command
- Changes take effect immediately for the next data fetch

## Available Commands

### Twitter Commands

- `twitter monitor <keyword>` - Monitor Twitter for keywords
  - `-i, --interval <seconds>` - Polling interval in seconds (default: 30)
  - `-l, --limit <count>` - Maximum number of tweets to display (default: 10)

- `twitter scrape <url>` - Scrape content from a Twitter/X post
  - `-v, --visible <boolean>` - Include visible elements in output (default: true)

- `twitter x <url>` - Quick command to scrape Twitter/X posts (alias for scrape)
  - `-f, --fast` - Skip visible elements collection for faster results

### Liquidity Pool Commands

- `lp list` - List active Pump.fun liquidity pools
  - `-c, --count <number>` - Number of pools to display (default: 10)

- `lp monitor <address>` - Monitor a Pump.fun liquidity pool
  - `-i, --interval <seconds>` - Polling interval in seconds (default: 15)
  - `-c, --change-threshold <percent>` - Minimum change threshold to highlight (default: 1.0)

### Trading Commands

- `trade buy <tokenAddress>` - Buy tokens on Pump.fun
  - `-a, --amount <amount>` - Amount of SOL to spend (default: 0.01)
  - `-s, --slippage <slippage>` - Slippage tolerance in basis points (default: 500)
  - `-p, --priority-fee <fee>` - Optional priority fee in microLamports
  - `-w, --wallet <walletPath>` - Path to wallet keyfile (uses active wallet by default)

- `trade sell <tokenAddress>` - Sell tokens on Pump.fun
  - `-p, --percentage <percentage>` - Percentage of tokens to sell (default: 100)
  - `-a, --amount <amount>` - Exact amount of tokens to sell (overrides percentage)
  - `-s, --slippage <slippage>` - Slippage tolerance in basis points (default: 500)
  - `-f, --priority-fee <fee>` - Optional priority fee in microLamports
  - `-w, --wallet <walletPath>` - Path to wallet keyfile (uses active wallet by default)

- `trade price <tokenAddress>` - Get current price of a token on Pump.fun

- `trade balance <tokenAddress>` - Check token balance for an address
  - `-w, --wallet <walletPath>` - Path to wallet keyfile (uses active wallet by default)

### Settings Commands

- `settings menu` - Open interactive settings menu
- `settings status` - Show current settings status

- `settings rpc list` - List available RPC endpoints
- `settings rpc set <name>` - Set active RPC endpoint
- `settings rpc add <name> <url>` - Add a custom RPC endpoint
- `settings rpc remove <name>` - Remove a custom RPC endpoint
- `settings rpc select` - Select RPC endpoint with an interactive menu

- `settings wallet list` - List all available wallets
- `settings wallet list-private` - List private trading wallets only
- `settings wallet list-public` - List public treasury wallets only
- `settings wallet set <name>` - Set active wallet
- `settings wallet refresh` - Refresh wallet list
- `settings wallet select` - Select wallet with an interactive menu

## Wallet Management

The settings system categorizes wallets into three groups:

- **Private Wallets** (shown in green): Trading wallets with private keys used for transactions
- **Public Wallets** (shown in yellow): Treasury/watch-only wallets for monitoring
- **Other Wallets** (shown in blue): Default Solana wallets and other miscellaneous wallets

The wallet system scans and manages keypairs from the following locations:
- Private wallets: `/addresses/keypairs/private/` (and all subdirectories)
- Public wallets: `/addresses/keypairs/public/` (and all subdirectories)
- Other wallets: Standard Solana CLI location and other sources

## Features

- Colorized, formatted output for better readability
- Keyboard navigation in interactive menus
- Modular design for easy extension
- Consistent command structure
- Compatible with existing npm run x script

## Project Structure

```
ddcli/
├── core/                 # Core utilities
│   ├── keypress.js       # Keyboard input handling
│   ├── menu.js           # Interactive menu system
│   ├── module-loader.js  # Module discovery and loading
│   ├── ui.js             # UI utilities and styling
│   └── settings/         # Settings management
│       ├── config-store.js    # Configuration storage
│       ├── keyboard-handler.js # Settings keyboard shortcuts
│       └── settings-manager.js # Settings API
├── modules/              # Command modules
│   ├── twitter-monitor/  # Twitter monitoring module
│   │   ├── index.js      # Command registration
│   │   ├── twitter-monitor.js # Tweet monitoring logic
│   │   └── twitter-scraper.js # Tweet scraping logic
│   ├── lp-monitor/       # Liquidity pool monitoring module
│   │   ├── index.js      # Command registration
│   │   └── lp-monitor.js # Liquidity pool monitoring logic
│   ├── settings/         # Settings module
│   │   └── index.js      # Settings commands registration
│   └── trade/            # Trading module
│       ├── index.js      # Command registration
│       └── trade.js      # Buy/sell implementation
├── index.js              # CLI entry point
├── package.json          # Project metadata
└── README.md             # Documentation
```