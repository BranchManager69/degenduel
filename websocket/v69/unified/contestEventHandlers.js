/**
 * Handles backend events related to contests and broadcasts them
 * through the Unified WebSocket server.
 */

import serviceEvents from '../../../utils/service-suite/service-events.js';
import { logApi } from '../../../utils/logger-suite/logger.js';
import { fancyColors, wsColors } from '../../../utils/colors.js';
import { MESSAGE_TYPES, TOPICS } from './utils.js';
// Import shared WebSocket action enum if available and needed for action names
// import { DDWebSocketActions } from '@branchmanager69/degenduel-shared';

const VERBOSE_EVENT_LOGGING = false; // Set to true for detailed logging

/**
 * Registers event listeners for contest-related events.
 * @param {UnifiedWebSocketServer} server - The main WebSocket server instance.
 */
export function registerContestEventHandlers(server) {
    if (!server) {
        logApi.error(`${wsColors.tag}[ContestEvents]${fancyColors.RESET} ${fancyColors.RED}Server instance not provided. Cannot register handlers.${fancyColors.RESET}`);
        return;
    }

    logApi.info(`${wsColors.tag}[ContestEvents]${fancyColors.RESET} ${fancyColors.GREEN}Registering contest event handlers...${fancyColors.RESET}`);

    // --- Leaderboard Updates --- 
    serviceEvents.on('contest:leaderboard:updated', (data) => {
        try {
            if (!data || !data.contestId || !data.leaderboard) {
                logApi.warn(`${wsColors.tag}[ContestEvents]${fancyColors.RESET} ${fancyColors.YELLOW}Received invalid contest:leaderboard:updated event data.${fancyColors.RESET}`, { data });
                return;
            }
            const { contestId, leaderboard } = data;
            
            if (VERBOSE_EVENT_LOGGING) {
                 logApi.info(`${wsColors.tag}[ContestEvents]${fancyColors.RESET} ${wsColors.notification}Broadcasting leaderboard update for contest ${contestId}${fancyColors.RESET}`);
            }

            server.broadcastToTopic(TOPICS.CONTEST, { // Broadcasting on general CONTEST topic
                type: MESSAGE_TYPES.DATA,
                topic: TOPICS.CONTEST,
                subtype: 'leaderboard', // Add subtype for client-side filtering
                action: 'LEADERBOARD_UPDATE', // Use a specific action string
                data: { contestId, leaderboard },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            logApi.error(`${wsColors.tag}[ContestEvents]${fancyColors.RESET} ${fancyColors.RED}Error handling contest:leaderboard:updated event:${fancyColors.RESET}`, error);
        }
    });

    // --- Participant Updates (for user-specific data) ---
    serviceEvents.on('contest:participant:updated', (data) => {
        try {
             if (!data || !data.contestId || !data.walletAddress || !data.participantData) {
                logApi.warn(`${wsColors.tag}[ContestEvents]${fancyColors.RESET} ${fancyColors.YELLOW}Received invalid contest:participant:updated event data.${fancyColors.RESET}`, { data });
                return;
            }
            const { contestId, walletAddress, participantData } = data;

            if (VERBOSE_EVENT_LOGGING) {
                logApi.info(`${wsColors.tag}[ContestEvents]${fancyColors.RESET} ${wsColors.notification}Sending participant update for ${walletAddress} in contest ${contestId}${fancyColors.RESET}`);
            }
            
            // Send directly to the specific user
            server.sendToUser(walletAddress, {
                type: MESSAGE_TYPES.DATA,
                topic: TOPICS.USER, // Send on user-specific topic
                subtype: 'contest_participation', // Add subtype for clarity
                action: 'PARTICIPANT_UPDATE', // Use a specific action string
                data: { contestId, participantData }, // Include contestId for context
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            logApi.error(`${wsColors.tag}[ContestEvents]${fancyColors.RESET} ${fancyColors.RED}Error handling contest:participant:updated event:${fancyColors.RESET}`, error);
        }
    });

    // --- New Chat Messages --- 
    serviceEvents.on('contest:chat:message', (chatMessageData) => {
         try {
            if (!chatMessageData || !chatMessageData.contestId || !chatMessageData.sender || !chatMessageData.text) {
                logApi.warn(`${wsColors.tag}[ContestEvents]${fancyColors.RESET} ${fancyColors.YELLOW}Received invalid contest:chat:message event data.${fancyColors.RESET}`, { chatMessageData });
                return;
            }
            const { contestId } = chatMessageData;

             if (VERBOSE_EVENT_LOGGING) {
                logApi.info(`${wsColors.tag}[ContestEvents]${fancyColors.RESET} ${wsColors.notification}Broadcasting new chat message for contest ${contestId}${fancyColors.RESET}`);
            }

            server.broadcastToTopic(TOPICS.CONTEST_CHAT, { // Broadcast on the dedicated CONTEST_CHAT topic
                type: MESSAGE_TYPES.DATA,
                topic: TOPICS.CONTEST_CHAT,
                action: 'NEW_MESSAGE', // Specific action for new messages
                data: chatMessageData, // Send the full message object received from the event
                timestamp: chatMessageData.timestamp || new Date().toISOString() // Use event timestamp if available
            });
        } catch (error) {
            logApi.error(`${wsColors.tag}[ContestEvents]${fancyColors.RESET} ${fancyColors.RED}Error handling contest:chat:message event:${fancyColors.RESET}`, error);
        }
    });

    // --- Contest Status Updates --- (Example - add others as needed)
    serviceEvents.on('contest:status', (data) => {
        try {
            if (!data || !data.id || !data.status) {
                logApi.warn(`${wsColors.tag}[ContestEvents]${fancyColors.RESET} ${fancyColors.YELLOW}Received invalid contest:status event data.${fancyColors.RESET}`, { data });
                return;
            }
            const { id: contestId, status } = data;

            if (VERBOSE_EVENT_LOGGING) {
                logApi.info(`${wsColors.tag}[ContestEvents]${fancyColors.RESET} ${wsColors.notification}Broadcasting status update for contest ${contestId}: ${status}${fancyColors.RESET}`);
            }

            server.broadcastToTopic(TOPICS.CONTEST, {
                type: MESSAGE_TYPES.DATA,
                topic: TOPICS.CONTEST,
                subtype: 'status',
                action: 'STATUS_UPDATE', 
                data: { contestId, status },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            logApi.error(`${wsColors.tag}[ContestEvents]${fancyColors.RESET} ${fancyColors.RED}Error handling contest:status event:${fancyColors.RESET}`, error);
        }
    });

    // Add listeners for other relevant events like contest:created, contest:completed etc. if needed

} 