Technical Work Order: Vanity Solana Address Integration

  Overview

  Integrate vanity-grinder's CUDA-accelerated Solana address generator into our backend services
   via REST API.

  Architecture

  1. GPU Service: Lambda Labs instance running vanity-grinder API server
  2. Backend Service: Implements client for vanity-grinder API and callback handler

  Security Requirements

  - Restrict access to vanity-grinder API using firewall rules
  - Only allow connections from our Command Server (3.17.208.200)
  - Implement validation on callback data
  - Store keypairs securely, following our encryption standards

  Implementation Steps

  1. GPU Server Configuration

  # Open firewall port only to our server IP
  sudo ufw allow from 3.17.208.200 to any port 7777

  # Start API server as background service
  nohup /home/ubuntu/degenduel-gpu/vanity-grinder/target/release/vanity-grinder serve --host
  0.0.0.0 --port 7777 > /home/ubuntu/vanity-server.log 2>&1 &

  2. Backend API Endpoint

  Create endpoint in our backend to accept vanity address requests:

  // src/routes/vanity-address.ts
  import { Router } from 'express';
  import axios from 'axios';
  import { v4 as uuidv4 } from 'uuid';
  import { validateSchema } from '../middlewares/validation';
  import { verifyAuth } from '../middlewares/auth';
  import { KeypairManager } from '../services/keypair-manager';
  import { config } from '../config';

  const router = Router();
  const VANITY_API = config.vanityGrinder.apiUrl; // "http://gpu-server-ip:7777"
  const CALLBACK_URL = config.vanityGrinder.callbackUrl; // 
  "http://3.17.208.200:8080/api/internal/vanity-callback"

  // Request schema for frontend
  const vanityRequestSchema = {
    type: 'object',
    required: ['pattern'],
    properties: {
      pattern: { type: 'string', minLength: 1, maxLength: 10 },
      isSuffix: { type: 'boolean' },
      caseSensitive: { type: 'boolean' },
      userId: { type: 'string', format: 'uuid' }
    }
  };

  // Schema sent to GPU service
  interface GpuVanityRequest {
    pattern: string;
    is_suffix: boolean;
    case_sensitive: boolean;
    callback_url: string;
  }

  // POST /api/vanity-address
  router.post('/',
    verifyAuth,
    validateSchema(vanityRequestSchema),
    async (req, res) => {
      try {
        const { pattern, isSuffix = false, caseSensitive = true, userId } = req.body;

        // Generate request ID for tracking
        const requestId = uuidv4();

        // Store request in database
        await db.vanityRequests.create({
          id: requestId,
          userId,
          pattern,
          isSuffix,
          caseSensitive,
          status: 'pending',
          createdAt: new Date()
        });

        // Build request for GPU service
        const gpuRequest: GpuVanityRequest = {
          pattern,
          is_suffix: isSuffix,
          case_sensitive: caseSensitive,
          callback_url: `${CALLBACK_URL}?requestId=${requestId}`
        };

        // Send to GPU service
        const response = await axios.post(`${VANITY_API}/jobs`, gpuRequest);

        // Update database with job ID
        await db.vanityRequests.update({
          where: { id: requestId },
          data: {
            jobId: response.data.job_id,
            status: 'processing'
          }
        });

        // Return response to client
        res.status(202).json({
          requestId,
          jobId: response.data.job_id,
          status: 'processing',
          message: 'Vanity address generation in progress'
        });
      } catch (error) {
        console.error('Vanity address request failed:', error);
        res.status(500).json({
          error: 'Failed to submit vanity address request',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
      }
    }
  );

  // GET /api/vanity-address/:requestId
  router.get('/:requestId',
    verifyAuth,
    async (req, res) => {
      try {
        const { requestId } = req.params;

        // Get request from database
        const request = await db.vanityRequests.findUnique({
          where: { id: requestId }
        });

        if (!request) {
          return res.status(404).json({ error: 'Vanity address request not found' });
        }

        // Check permissions
        if (request.userId !== req.user.id && !req.user.isAdmin) {
          return res.status(403).json({ error: 'Not authorized to view this request' });
        }

        // Return status
        res.status(200).json({
          requestId,
          jobId: request.jobId,
          status: request.status,
          pattern: request.pattern,
          createdAt: request.createdAt,
          completedAt: request.completedAt,
          address: request.address
        });
      } catch (error) {
        console.error('Vanity address status check failed:', error);
        res.status(500).json({ error: 'Failed to check vanity address status' });
      }
    }
  );

  export default router;

  3. Callback Handler

  // src/routes/internal/vanity-callback.ts
  import { Router } from 'express';
  import { Keypair } from '@solana/web3.js';
  import { validateIp } from '../middlewares/security';
  import { KeypairManager } from '../services/keypair-manager';
  import { NotificationService } from '../services/notification';

  const router = Router();

  // Restrict access to GPU server IPs only
  router.post('/',
    validateIp(['gpu-server-ip']),
    async (req, res) => {
      try {
        const { requestId } = req.query;
        const jobData = req.body;

        // Validate callback data
        if (!jobData || !jobData.id || !jobData.status) {
          return res.status(400).json({ error: 'Invalid callback data' });
        }

        // Get request from database
        const request = await db.vanityRequests.findUnique({
          where: { id: requestId as string }
        });

        if (!request) {
          return res.status(404).json({ error: 'Request not found' });
        }

        // Update request status
        if (jobData.status === 'Completed' && jobData.result) {
          // Extract address and keypair
          const { address, keypair_bytes } = jobData.result;

          // Create Solana keypair from bytes
          const keypair = Keypair.fromSecretKey(new Uint8Array(keypair_bytes));

          // Store keypair securely
          const encryptedKeypair = await KeypairManager.encryptKeypair(keypair);

          // Update database
          await db.vanityRequests.update({
            where: { id: requestId as string },
            data: {
              status: 'completed',
              address,
              encryptedKeypair,
              completedAt: new Date(),
              attempts: jobData.attempts,
              durationMs: jobData.duration_ms
            }
          });

          // Notify user
          if (request.userId) {
            await NotificationService.sendVanityAddressNotification(
              request.userId,
              address,
              request.pattern
            );
          }
        } else if (jobData.status === 'Failed' || jobData.status === 'Cancelled') {
          // Update database for failed jobs
          await db.vanityRequests.update({
            where: { id: requestId as string },
            data: {
              status: jobData.status.toLowerCase(),
              completedAt: new Date()
            }
          });
        }

        // Always acknowledge receipt
        res.status(200).send('OK');
      } catch (error) {
        console.error('Vanity callback processing failed:', error);
        // Still return 200 to prevent retries
        res.status(200).send('Error processed');
      }
    }
  );

  export default router;

  4. Database Schema Updates

  -- Add to schema.prisma
  model VanityRequest {
    id              String      @id @default(uuid())
    userId          String      @map("user_id")
    pattern         String
    isSuffix        Boolean     @default(false) @map("is_suffix")
    caseSensitive   Boolean     @default(true) @map("case_sensitive")
    jobId           String?     @map("job_id")
    status          String      // pending, processing, completed, failed, cancelled
    address         String?
    encryptedKeypair String?    @map("encrypted_keypair")
    attempts        BigInt?
    durationMs      BigInt?     @map("duration_ms")
    createdAt       DateTime    @default(now()) @map("created_at")
    completedAt     DateTime?   @map("completed_at")

    user            User        @relation(fields: [userId], references: [id])

    @@index([userId])
    @@index([jobId])
    @@index([status])
  }

  5. Keypair Management Service

  // src/services/keypair-manager.ts
  import { Keypair } from '@solana/web3.js';
  import crypto from 'crypto';
  import { config } from '../config';

  export class KeypairManager {
    private static ENCRYPTION_KEY = config.encryption.key;
    private static ALGORITHM = 'aes-256-gcm';

    /**
     * Encrypt a Solana keypair for secure storage
     */
    static async encryptKeypair(keypair: Keypair): Promise<string> {
      const keypairBytes = keypair.secretKey;
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(
        this.ALGORITHM,
        Buffer.from(this.ENCRYPTION_KEY, 'hex'),
        iv
      );

      let encrypted = cipher.update(Buffer.from(keypairBytes));
      encrypted = Buffer.concat([encrypted, cipher.final()]);

      const authTag = cipher.getAuthTag();

      // Format: iv:authTag:encryptedData
      return Buffer.concat([iv, authTag, encrypted]).toString('hex');
    }

    /**
     * Decrypt a stored keypair
     */
    static async decryptKeypair(encryptedData: string): Promise<Keypair> {
      const data = Buffer.from(encryptedData, 'hex');

      // Extract components
      const iv = data.subarray(0, 16);
      const authTag = data.subarray(16, 32);
      const encryptedKeypair = data.subarray(32);

      const decipher = crypto.createDecipheriv(
        this.ALGORITHM,
        Buffer.from(this.ENCRYPTION_KEY, 'hex'),
        iv
      );

      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encryptedKeypair);
      decrypted = Buffer.concat([decrypted, decipher.final()]);

      return Keypair.fromSecretKey(new Uint8Array(decrypted));
    }
  }

  6. Health Monitoring

  Add health check for vanity-grinder service:

  // src/services/health-monitor.ts
  import axios from 'axios';
  import { config } from '../config';

  export async function checkVanityGrinderHealth(): Promise<boolean> {
    try {
      const response = await axios.get(`${config.vanityGrinder.apiUrl}/health`, {
        timeout: 5000
      });
      return response.data?.status === 'ok';
    } catch (error) {
      console.error('Vanity grinder health check failed:', error);
      return false;
    }
  }

  API Documentation

  Frontend API

  POST /api/vanity-address

  Create a new vanity address request

  Request:
  {
    "pattern": "BRANCH",
    "isSuffix": false,
    "caseSensitive": true
  }

  Response:
  {
    "requestId": "550e8400-e29b-41d4-a716-446655440000",
    "jobId": "d290f1ee-6c54-4b01-90e6-d701748f0851",
    "status": "processing",
    "message": "Vanity address generation in progress"
  }

  GET /api/vanity-address/:requestId

  Check status of a vanity address request

  Response:
  {
    "requestId": "550e8400-e29b-41d4-a716-446655440000",
    "jobId": "d290f1ee-6c54-4b01-90e6-d701748f0851",
    "status": "completed",
    "pattern": "BRANCH",
    "createdAt": "2025-04-06T10:15:30Z",
    "completedAt": "2025-04-06T10:16:45Z",
    "address": "BRANCHkF9Pd6MX9MWdGxRMw89iG4Pw4vgJY5CTCTbY8or"
  }

  GPU Service API

  POST /jobs

  Create a new vanity address generation job

  Request:
  {
    "pattern": "BRANCH",
    "is_suffix": false,
    "case_sensitive": true,
    "callback_url": "http://3.17.208.200:8080/api/internal/vanity-callback?requestId=550e8400-e2
  9b-41d4-a716-446655440000"
  }

  Response:
  {
    "job_id": "d290f1ee-6c54-4b01-90e6-d701748f0851",
    "status": "queued",
    "notification": {
      "type": "callback",
      "message": "A POST request will be sent to your callback URL when the job completes"
    }
  }

  Callback Data

  When job completes, this data is sent to the callback URL:

  {
    "id": "d290f1ee-6c54-4b01-90e6-d701748f0851",
    "status": "Completed",
    "request": {
      "pattern": "BRANCH",
      "is_suffix": false,
      "case_sensitive": true
    },
    "result": {
      "address": "BRANCHkF9Pd6MX9MWdGxRMw89iG4Pw4vgJY5CTCTbY8or",
      "keypair_bytes": [236,18,32,...],
      "attempts": 3726489,
      "duration_ms": 15284,
      "rate_per_second": 243815
    },
    "created_at": "2025-04-05T08:12:34.123Z",
    "updated_at": "2025-04-05T08:13:12.456Z",
    "attempts": 3726489,
    "duration_ms": 15284
  }

  Testing Instructions

  1. Start GPU service on Lambda Labs
  2. Implement callback endpoint
  3. Test with common patterns (4-5 chars)
  4. Verify secure storage of keypairs
  5. Test error conditions (service down, invalid patterns)

  Performance Notes

  - Expect ~1-3 million keypairs/sec on A100 GPU
  - 4-char pattern: ~10-30 seconds
  - 5-char pattern: ~10-15 minutes
  - 6-char pattern: ~10-15 hours

  Important: Configure appropriate timeouts for long-running jobs

  Security Notes

  - Never expose the GPU service directly to the internet
  - Keep encryption keys in secure storage, not in code
  - Implement strong access controls to keypair retrieval
  - Consider automatic deletion of keypairs after delivery
