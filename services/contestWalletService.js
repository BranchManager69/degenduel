// Polyfill WebSocket for Node.js (use ws package)
import WebSocket from 'ws';
global.WebSocket = WebSocket;

// ** Service Auth **
import { generateServiceAuthHeader } from '../../config/service-auth.js';
// ** Service Class **
import { BaseService } from '../../utils/service-suite/base-service.js';
import { ServiceError, ServiceErrorTypes } from '../../utils/service-suite/service-error.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import AdminLogger from '../../utils/admin-logger.js';
import prisma from '../../config/prisma.js';
import { fancyColors, serviceSpecificColors } from '../../utils/colors.js';
// REMOVED: Old @solana/web3.js import (e.g., for PublicKey, LAMPORTS_PER_SOL)
import crypto from 'crypto';
import { SERVICE_NAMES, getServiceMetadata } from '../../utils/service-suite/service-constants.js';
import { solanaEngine } from '../../services/solana-engine/index.js'; 
import TreasuryCertifier from './treasury-certifier.js';
import VanityApiClient from '../../services/vanity-wallet/vanity-api-client.js';
import { generateKeyPair as generateKeyPairV2, createKeyPairSignerFromBytes } from '@solana/keys';
import { getAddressFromPublicKey, address as v2Address } from '@solana/addresses';
import { Buffer } from 'node:buffer';
import { createSystemTransferInstruction } from '@solana/pay';

// Config
import { config } from '../../config/config.js';

const LAMPORTS_PER_SOL_V2 = 1_000_000_000;
// ... (rest of contestWalletService.js) 