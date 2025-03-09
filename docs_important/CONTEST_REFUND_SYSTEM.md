# Contest Refund System Documentation

## Overview

The Contest Refund System is responsible for processing refunds when contests are cancelled. This document provides comprehensive documentation on how refunds are processed, when they are triggered, and the technical implementation details.

## Configuration Flags

The system supports the following configuration flags at the top of `contestEvaluationService.js`:

| Flag | Default | Description |
|------|---------|-------------|
| `REFUND_SINGLE_PARTICIPANT_CONTESTS` | `true` | When enabled, contests with exactly one participant will be cancelled and the entry fee refunded. When disabled, single-participant contests will proceed normally. |

## Table of Contents

1. [Refund Triggers](#refund-triggers)
2. [Refund Process Flow](#refund-process-flow)
3. [Auto-Cancellation Conditions](#auto-cancellation-conditions)
4. [Single Participant Scenarios](#single-participant-scenarios)
5. [Technical Implementation](#technical-implementation)
6. [Error Handling and Retry Mechanism](#error-handling-and-retry-mechanism)
7. [Transaction Records](#transaction-records)
8. [Admin Controls](#admin-controls)
9. [Monitoring and Debugging](#monitoring-and-debugging)

## Refund Triggers

Refunds are automatically processed in the following scenarios:

1. **Manual Cancellation**: When an admin cancels a contest through the admin interface via `adminContestController.js`.

2. **Auto-Cancellation (No Participants)**: When a contest has no participants at its scheduled start time.

3. **Auto-Cancellation (Insufficient Participants)**: When a contest has some participants but fewer than the required minimum after the auto-cancel waiting period.

4. **Auto-Cancellation (Single Participant)**: When a contest has exactly one participant and the `REFUND_SINGLE_PARTICIPANT_CONTESTS` flag is enabled.

5. **System Failure**: When system issues prevent a contest from starting or completing correctly.

## Refund Process Flow

The refund process follows these steps:

1. **Contest Status Update**: Contest status is changed to 'cancelled'.

2. **Contest Wallet Validation**: System retrieves and validates the contest wallet to ensure sufficient balance for all refunds.

3. **Participant Identification**: System identifies all participants who haven't yet received refunds.

4. **Balance Calculation**: Total refund amount is calculated based on all participants' entry fees.

5. **Refund Transactions**:
   - For each participant, a refund transaction is created in the database with 'PENDING' status
   - A blockchain transaction transfers SOL from the contest wallet to the participant's wallet
   - Transaction record is updated with completion status and blockchain signature
   - Participant record is updated with refund details

6. **Retry Mechanism**: Failed refunds are retried up to 3 times with a 5-second delay between attempts.

7. **Logging**: All refund operations are logged for audit purposes.

## Auto-Cancellation Conditions

The system automatically cancels contests under these conditions:

1. **Zero Participants**: If a contest has no participants at its scheduled start time, it's immediately cancelled.

2. **Insufficient Participants**: If a contest has fewer participants than the minimum required (configured per contest), the system:
   - Waits for the auto-cancel window period (1 minute and 29 seconds by default)
   - Checks again after the waiting period
   - Cancels the contest if participant count is still below the minimum

The auto-cancel window is defined in the `CONTEST_EVALUATION_CONFIG`:
```javascript
autoCancelWindow: (0 * 24 * 60 * 60 * 1000) + (0 * 60 * 60 * 1000) + (1 * 60 * 1000) + (29 * 1000), // 0 days, 0 hours, 1 minutes, and 29 seconds
```

## Single Participant Scenarios

When a contest has only one participant at start time:

1. **Global Setting**: The `REFUND_SINGLE_PARTICIPANT_CONTESTS` flag determines the system's behavior:
   - When `true` (default): Contests with only one participant will be automatically cancelled and refunded, regardless of the contest's minimum participant setting
   - When `false`: The system will follow the contest-specific minimum participant setting

2. **Contest-Specific Setting**: If `REFUND_SINGLE_PARTICIPANT_CONTESTS` is `false`:
   - By default, a contest's minimum participant requirement is set to 1. In this case, a contest with a single participant will start normally.
   - If a contest is configured with a minimum participant count greater than 1, then:
     - The system waits for the auto-cancel window period
     - If still only one participant after this window, the contest is cancelled
     - Refund is processed for the single participant

3. **Cancellation Reason**: When a contest is cancelled due to having only one participant, it's logged with a specific reason code:
   ```javascript
   cancelContestSingleParticipant(contest) {
       return this.cancelContest(
           contest,
           this.config.states.CANCELLED,
           `Contest auto-cancelled due to having only one participant (based on REFUND_SINGLE_PARTICIPANT_CONTESTS setting)`,
           AdminLogger.Actions.CONTEST.CANCEL,
           {
               required_participants: 2, // At least 2 participants needed for competition
               actual_participants: 1,
               auto_cancelled: true,
               single_participant_policy: true
           }
       );
   }
   ```

The minimum participant check is implemented in `contestEvaluationService.js`:
```javascript
const minParticipants = contest.settings?.minimum_participants || 1;
if (participants.length < minParticipants) {
    await this.handleInsufficientParticipants(contest, participants.length, minParticipants);
    // This triggers the refund process
}
```

## Technical Implementation

The refund system is implemented in the `contestEvaluationService.js` file with two key methods:

1. **processContestRefunds (Lines 1158-1251)**: Orchestrates the entire refund process for a contest:
   - Retrieves contest wallet
   - Gets participants needing refunds
   - Validates wallet balance
   - Processes refunds for each participant with retry logic
   - Tracks and reports results

2. **processRefund (Lines 1095-1155)**: Handles an individual participant refund:
   - Creates transaction record
   - Performs blockchain transfer
   - Updates database records
   - Returns success/failure status

## Error Handling and Retry Mechanism

The refund system includes robust error handling:

1. **Retry Configuration**:
   ```javascript
   refunds: {
       maxRetries: 3,
       retryDelayMs: 5000
   }
   ```

2. **Retry Loop Implementation**:
   ```javascript
   let retries = 0;
   while (retries < this.config.refunds.maxRetries) {
       try {
           const result = await this.processRefund(participant, contest, contestWallet);
           // Success handling
           break;
       } catch (error) {
           retries++;
           if (retries === this.config.refunds.maxRetries) {
               // Final failure handling
           } else {
               await new Promise(resolve => setTimeout(resolve, this.config.refunds.retryDelayMs));
           }
       }
   }
   ```

3. **Failure Tracking**: Failed refunds are logged and can be manually retried through the admin interface.

## Transaction Records

Every refund creates detailed transaction records:

1. **Initial Transaction Record**:
   ```javascript
   const transaction = await prisma.transactions.create({
       data: {
           wallet_address: participant.wallet_address,
           type: config.transaction_types.CONTEST_REFUND,
           amount: participant.entry_amount,
           balance_before: participant.initial_dxd_points,
           balance_after: participant.current_dxd_points,
           contest_id: contest.id,
           description: `Refund for cancelled contest ${contest.contest_code}`,
           status: config.transaction_statuses.PENDING,
           created_at: new Date(),
           user_id: participant.user_id
       }
   });
   ```

2. **Transaction Update**:
   ```javascript
   await prisma.transactions.update({
       where: { id: transaction.id },
       data: {
           status: config.transaction_statuses.COMPLETED,
           blockchain_signature: signature,
           completed_at: new Date()
       }
   });
   ```

3. **Participant Record Update**:
   ```javascript
   await prisma.contest_participants.update({
       where: {
           contest_id_wallet_address: {
               contest_id: contest.id,
               wallet_address: participant.wallet_address
           }
       },
       data: {
           refunded_at: new Date(),
           refund_amount: participant.entry_amount,
           refund_transaction_id: transaction.id
       }
   });
   ```

## Admin Controls

Admins can manually control the refund process through:

1. **Manual Contest Cancellation**: The admin interface allows cancelling contests, which automatically triggers the refund process. Implemented in `adminContestController.js`:
   ```javascript
   if (action.toUpperCase() === 'CANCEL' && contest.participants.length > 0) {
       contestEvaluationService.processContestRefunds(
           contest,
           adminAddress,
           {
               ip_address: req.ip,
               user_agent: req.headers['user-agent']
           }
       ).catch(error => {
           logApi.error('Failed to process refunds for cancelled contest:', {
               contest_id: contestId,
               error: error.message
           });
       });
   }
   ```

2. **Failed Transaction Retry**: Admins can retry failed refund transactions through a dedicated endpoint:
   ```javascript
   async function retryFailedTransaction(req, res) {
       const { transactionId } = req.params;
       try {
           const transaction = await prisma.transactions.findUnique({
               where: { id: parseInt(transactionId) }
           });

           // Reset transaction status to pending for retry
           await prisma.transactions.update({
               where: { id: parseInt(transactionId) },
               data: {
                   status: 'pending',
                   error_details: null,
                   retry_count: (transaction.retry_count || 0) + 1,
                   updated_at: new Date()
               }
           });

           res.json({
               success: true,
               message: 'Transaction queued for retry'
           });
       } catch (error) {
           logApi.error('Failed to retry transaction:', error);
           res.status(500).json({
               success: false,
               error: 'Failed to retry transaction'
           });
       }
   }
   ```

## Monitoring and Debugging

The system provides several tools for monitoring and debugging refund operations:

1. **Extensive Logging**: All refund operations are logged with detailed information:
   ```javascript
   logApi.info(`Contest wallet balance validated as sufficient for refunds`, {
       contest_id: contest.id,
       wallet: contestWallet.wallet_address,
       total_refund_amount: totalRefundAmount.toString()
   });
   ```

2. **Admin Audit Logs**: Admin actions related to refunds are recorded in the admin activity log:
   ```javascript
   await AdminLogger.logAction(
       adminAddress,
       AdminLogger.Actions.CONTEST.CANCEL,
       {
           contest_id: contest.id,
           participant_count: contest.participants.length
       },
       context
   );
   ```

3. **Failed Transaction Endpoint**: Admins can view failed transactions for a specific contest:
   ```javascript
   async function getFailedTransactions(req, res) {
       const { contestId } = req.params;
       try {
           const failedTxs = await prisma.transactions.findMany({
               where: {
                   contest_id: parseInt(contestId),
                   status: 'failed'
               },
               orderBy: {
                   created_at: 'desc'
               }
           });

           res.json({
               success: true,
               data: failedTxs
           });
       } catch (error) {
           logApi.error('Failed to get failed transactions:', error);
           res.status(500).json({
               success: false,
               error: 'Failed to get failed transactions'
           });
       }
   }
   ```

4. **Service Statistics**: The contest evaluation service maintains detailed statistics about refund operations:
   ```javascript
   this.evaluationStats.refunds = {
       total: 0,
       successful: 0,
       failed: 0,
       total_amount: 0
   };
   ```

---

## Implementation Notes

1. The refund system is designed to be resilient and ensure participants receive their entry fees back when contests are cancelled.

2. The retry mechanism helps handle temporary blockchain network issues.

3. All refund operations are tracked and can be audited through the admin interface.

4. The default configuration values can be adjusted in the `CONTEST_EVALUATION_CONFIG` object in `contestEvaluationService.js`.

5. **Important**: Refunds are automatically triggered in the following cancellation methods:
   - `cancelContestSingleParticipant` - When a contest has only one participant
   - `cancelContestInsufficientParticipants` - When a contest has insufficient participants after the waiting period
   - Admin-initiated cancellations through the admin interface

   Each of these methods explicitly calls `processContestRefunds()` to ensure participants receive their refunds immediately after cancellation.