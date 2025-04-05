// Trade module for buying and selling tokens on Pump.fun
import { Command } from 'commander';
import * as trade from './trade.js';

export const description = 'Trade Pump.fun tokens (buy/sell)';

export function registerCommands(program) {
  const tradeCmd = new Command('trade')
    .description('Trade Pump.fun tokens on Solana');

  tradeCmd.command('buy')
    .description('Buy tokens on Pump.fun')
    .argument('<tokenAddress>', 'The token/mint address to buy')
    .option('-a, --amount <amount>', 'Amount of SOL to spend', parseFloat, 0.01)
    .option('-s, --slippage <slippage>', 'Slippage tolerance in basis points (0.01% = 1)', parseInt, 500)
    .option('-p, --priority-fee <priorityFee>', 'Optional priority fee in microLamports', parseInt)
    .option('-w, --wallet <walletPath>', 'Path to wallet keyfile, defaults to active wallet in settings')
    .action(trade.buyToken);

  tradeCmd.command('sell')
    .description('Sell tokens on Pump.fun')
    .argument('<tokenAddress>', 'The token/mint address to sell')
    .option('-p, --percentage <percentage>', 'Percentage of tokens to sell (0-100)', parseFloat, 100)
    .option('-a, --amount <amount>', 'Exact amount of tokens to sell (overrides percentage)')
    .option('-s, --slippage <slippage>', 'Slippage tolerance in basis points (0.01% = 1)', parseInt, 500)
    .option('-f, --priority-fee <priorityFee>', 'Optional priority fee in microLamports', parseInt)
    .option('-w, --wallet <walletPath>', 'Path to wallet keyfile, defaults to active wallet in settings')
    .action(trade.sellToken);

  tradeCmd.command('price')
    .description('Get current price of a token on Pump.fun')
    .argument('<tokenAddress>', 'The token/mint address to check')
    .action(trade.getTokenPrice);

  tradeCmd.command('balance')
    .description('Check token balance for an address')
    .argument('<tokenAddress>', 'The token/mint address to check')
    .option('-w, --wallet <walletPath>', 'Path to wallet keyfile, defaults to active wallet in settings')
    .action(trade.getTokenBalance);

  program.addCommand(tradeCmd);
}