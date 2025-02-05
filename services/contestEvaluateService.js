// services/contestEvaluateService.js

/*
 * This service is responsible for starting, ending, and evaluating contests.
 * It also handles the logic for determining winners and distributing prizes to winners.
 * 
 */

import { PrismaClient } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { logApi } from '../utils/logger';


