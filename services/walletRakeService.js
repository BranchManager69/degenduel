// services/walletRakeService.js

/*
 * This service is responsible for collecting leftover Solana from contest wallets.
 * It should check all already-evaluated contests every 10 minutes for leftover SOL/tokens.
 *   Remember, the contestEvaluateService should have already transferred all prizes to the contest winners.
 *   Therefore, if anything is left over, it belongs to us and should be transferred to the 'main' DegenDuel wallet.
 * For buffer purposes, I will always want to keep 0.01 SOL in contest wallets; account for this while raking.
 * 
 * DegenDuel's 'main' wallet address to rake contest wallet funds to: BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp (my main personal wallet!)
 * 
 */

import { PrismaClient } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { logApi } from '../utils/logger';

