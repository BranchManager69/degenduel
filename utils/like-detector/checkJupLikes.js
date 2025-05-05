#!/usr/bin/env node

// Path: utils/like-detector/checkJupLikes.js

/**
 * Jupiter Like Detection Service
 * @description Checks a particular Jupiter token page for Likes.
 *   This script runs each minute and saves likers' Twitter handles to a database table.
 *   We attempt to match the Twitter handle to a DegenDuel user w/ associated Twitter handle.
 *   If a match is found, it applies special privileges to the user.
 * 
 * @author BranchManager69
 * @version 2.0.0
 * @created 2025-05-02
 * @updated 2025-05-02
 */
import fetch from 'node-fetch'
import prisma from '../../config/prisma.js'; // Import the Prisma Singleton
import discordInteractiveService from '../discord/discord-interactive-service.js'; // Import the Discord service
import serviceEvents from '../../utils/service-suite/service-events.js'; // Ensure serviceEvents is imported
import { SERVICE_EVENTS } from '../../utils/service-suite/service-events.js'; // Import the keys
import { discordConfig } from '../discord/discordConfig.js'; // Import the new Discord config

// Config
// import { config } from '../../config/config.js'; // Keep if needed for other things, comment out if not
const URL_TEMPLATE = `https://fe-api.jup.ag/api/v1/tokens/ADDRESS_PLACEHOLDER/reactions`;

// Basic Twitter username validation (alphanumeric + underscore, 1-15 chars)
const isValidTwitterHandle = (username) => /^[a-zA-Z0-9_]{1,15}$/.test(username);

async function main() {
  console.log(`[${new Date().toISOString()}] Checking Jupiter likes...`);
  
  // --- Get the official token address from the database --- 
  const tokenConfig = await prisma.token_config.findFirst();
  if (!tokenConfig || !tokenConfig.address) {
    console.error('❌ Error: Could not find token address in token_config table. Ensure it is configured.');
    return; // Cannot proceed without the address
  }
  const TRACKED_TOKEN_ADDRESS = tokenConfig.address;
  console.log(`ℹ️ Tracking likes for official token: ${TRACKED_TOKEN_ADDRESS}`);
  // --- End token address fetch ---

  // 1. Fetch current likers from Jupiter API
  let currentApiHandles = [];
  try {
    const fetchUrl = URL_TEMPLATE.replace('ADDRESS_PLACEHOLDER', TRACKED_TOKEN_ADDRESS);
    const res = await fetch(fetchUrl, {
      headers: {
        'Accept':       'application/json',
        'User-Agent':   'DegenDuel/LikeDetector/2.0.0',
        'Origin':       'https://jup.ag',
        'Referer':      'https://jup.ag/'
      },
      timeout: 15000 // Add a reasonable timeout (15 seconds)
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => 'Could not read error body');
      throw new Error(`HTTP ${res.status} fetching ${fetchUrl}. Body: ${errorBody.substring(0, 200)}...`);
    }

    const { recentLikes } = await res.json();
    
    if (!Array.isArray(recentLikes)) {
      throw new Error(`Invalid API response format: recentLikes is not an array.`);
    }

    const rawHandles = recentLikes.map(l => l.username).filter(Boolean);
    currentApiHandles = rawHandles.filter(handle => {
      const isValid = isValidTwitterHandle(handle);
      if (!isValid) {
        console.warn(`⚠️ Invalid Twitter handle format detected from API and skipped: "${handle}"`);
      }
      return isValid;
    });
    console.log(`ℹ️ Found ${currentApiHandles.length} valid handles from Jupiter API.`);

  } catch (fetchError) {
      console.error(`❌ Failed to fetch or process data from Jupiter API: ${fetchError.message}`);
      // Exit gracefully if API fetch fails, don't proceed to DB updates
      return; 
  }
  
  const currentApiHandlesSet = new Set(currentApiHandles);

  // 2. Fetch current LIKING users from DB
  const dbLikingRecords = await prisma.jupLike.findMany({
    where: {
      status: 'LIKING',
      token_address: TRACKED_TOKEN_ADDRESS // Filter by current token address
     },
    select: { username: true },
  });
  const dbLikingHandles = dbLikingRecords.map(r => r.username);
  const dbLikingHandlesSet = new Set(dbLikingHandles);
  console.log(`ℹ️ Found ${dbLikingHandles.length} handles currently marked as LIKING in DB.`);

  // 3. Find New/Returning Likers (in API, not in DB as LIKING)
  const handlesToUpsert = currentApiHandles.filter(handle => !dbLikingHandlesSet.has(handle));
  
  let newLikersCount = 0;
  if (handlesToUpsert.length > 0) {
    console.log(`➕ Processing ${handlesToUpsert.length} new or returning likers...`);
    // Use upsert to add new ones or update status of previously UNLIKED ones
    for (const username of handlesToUpsert) {
      try {
          await prisma.jupLike.upsert({
              where: {
                // Use the compound unique constraint
                token_address_username: {
                  token_address: TRACKED_TOKEN_ADDRESS,
                  username: username
                }
               },
              update: { status: 'LIKING' }, // Update status if they exist but were UNLIKED
              create: { username, status: 'LIKING', token_address: TRACKED_TOKEN_ADDRESS }, // Create if they don't exist for this token
          });
          newLikersCount++;
      } catch (upsertError) {
          console.error(`❌ Error upserting handle "${username}":`, upsertError);
      }
    }
    console.log(`✅ ${newLikersCount} handles newly added or updated to LIKING.`);
    if (newLikersCount > 0) console.log('New/Returning Likers:', handlesToUpsert);

    // <<< TRIGGER PRIVILEGE GRANTING HERE >>>
    if (newLikersCount > 0) {
        console.log('ℹ️ Checking for associated users to grant privileges...');
        const privilegeKey = 'JUP_LIKE_DISCORD_ROLE'; // Define the privilege key

        for (const username of handlesToUpsert) {
            const socialProfile = await prisma.user_social_profiles.findUnique({
                where: { platform_username: { platform: 'twitter', username: username } },
                select: {
                    wallet_address: true,
                    user: {
                        select: {
                            social_profiles: {
                                where: { platform: 'discord' },
                                select: { platform_user_id: true }
                            }
                        }
                    }
                }
            });

            if (socialProfile) {
                const walletAddress = socialProfile.wallet_address;
                const discordProfile = socialProfile.user?.social_profiles?.[0];
                const discordUserId = discordProfile?.platform_user_id;

                console.log(`   -> Found user ${walletAddress} for new liker ${username}.`);

                // 1. Update our database privilege record (Upsert: create or mark as active)
                try {
                    await prisma.user_privileges.upsert({
                        where: { user_privilege_unique: { wallet_address: walletAddress, privilege_key: privilegeKey } },
                        update: { revoked_at: null, source: 'jup_like_check' }, // Mark as active again
                        create: { 
                            wallet_address: walletAddress, 
                            privilege_key: privilegeKey, 
                            token_address: TRACKED_TOKEN_ADDRESS, // Store which token triggered this
                            source: 'jup_like_check',
                            metadata: { twitter_username: username } // Optional: store context
                        }
                    });
                    console.log(`      -> Privilege record updated/created for ${walletAddress}.`);

                    // Emit event instead of calling Discord directly
                    serviceEvents.emit(SERVICE_EVENTS.PRIVILEGE_GRANTED, {
                        walletAddress: walletAddress,
                        privilegeKey: privilegeKey,
                        username: username // Pass twitter handle for context
                    });

                } catch (dbError) {
                    console.error(`      -> DB Error updating privilege for ${walletAddress}:`, dbError);
                    continue; // Skip if DB fails
                }

                // 2. Grant Discord Role (if discord ID exists)
                if (discordUserId) {
                    console.log(`      -> Attempting to grant Discord role to user ID ${discordUserId}...`);
                    const roleGranted = await discordInteractiveService.grantJupLikeRole(discordUserId);
                    if (roleGranted) {
                        console.log(`      -> Discord role granted successfully.`);
                    } else {
                        console.warn(`      -> Failed to grant Discord role (check service logs for details).`);
                    }
                } else {
                    console.log(`      -> User ${walletAddress} has not linked their Discord account.`);
                }
            } else {
                // console.log(`   -> New liker ${username} not associated with any user yet.`);
            }
        }
    }
  }

  // 4. Find Unlikers (in DB as LIKING, not in API)
  const handlesToMarkUnliked = dbLikingHandles.filter(handle => !currentApiHandlesSet.has(handle));

  let unlikersCount = 0;
  if (handlesToMarkUnliked.length > 0) {
      console.log(`➖ Processing ${handlesToMarkUnliked.length} unlikers...`);
      try {
          const updateResult = await prisma.jupLike.updateMany({
              where: {
                  token_address: TRACKED_TOKEN_ADDRESS, // Filter by current token address
                  username: { in: handlesToMarkUnliked },
                  status: 'LIKING', // Ensure we only update those currently liking this token
              },
              data: { status: 'UNLIKED' },
          });
          unlikersCount = updateResult.count;
          console.log(`✅ ${unlikersCount} handles marked as UNLIKED. Shame on them!`);
          if (unlikersCount > 0) console.log('Unlikers:', handlesToMarkUnliked);

          // 6. <<< TRIGGER PRIVILEGE REVOCATION HERE >>>
          if (unlikersCount > 0) {
              console.log('ℹ️ Checking for associated users to revoke privileges...');
              const privilegeKey = 'JUP_LIKE_DISCORD_ROLE'; // Define the privilege key

              for (const username of handlesToMarkUnliked) {
                  const socialProfile = await prisma.user_social_profiles.findUnique({
                      where: { platform_username: { platform: 'twitter', username: username } },
                      select: {
                          wallet_address: true,
                          user: {
                              select: {
                                  social_profiles: {
                                      where: { platform: 'discord' },
                                      select: { platform_user_id: true }
                                  }
                              }
                          }
                      }
                  });

                  if (socialProfile) {
                      const walletAddress = socialProfile.wallet_address;
                      const discordProfile = socialProfile.user?.social_profiles?.[0];
                      const discordUserId = discordProfile?.platform_user_id;

                      console.log(`   -> Found user ${walletAddress} for unliker ${username}.`);

                      // 1. Update our database privilege record (Mark as revoked)
                      try {
                          const updatePriv = await prisma.user_privileges.updateMany({
                              where: {
                                  wallet_address: walletAddress,
                                  privilege_key: privilegeKey,
                                  revoked_at: null // Only revoke active ones
                              },
                              data: { revoked_at: new Date() }
                          });
                          if (updatePriv.count > 0) {
                              console.log(`      -> Privilege record marked as revoked for ${walletAddress}.`);

                              // Emit event instead of calling Discord directly
                              serviceEvents.emit(SERVICE_EVENTS.PRIVILEGE_REVOKED, {
                                  walletAddress: walletAddress,
                                  privilegeKey: privilegeKey,
                                  username: username // Pass twitter handle for context
                              });

                          } else {
                              console.log(`      -> No active privilege record found for ${walletAddress} to revoke.`);
                              continue; // Skip if DB fails
                          }
                      } catch (dbError) {
                          console.error(`      -> DB Error revoking privilege for ${walletAddress}:`, dbError);
                          continue; // Skip Discord if DB fails
                      }

                      // 2. Revoke Discord Role (if discord ID exists)
                      if (discordUserId) {
                          console.log(`      -> Attempting to revoke Discord role from user ID ${discordUserId}...`);
                          const roleRevoked = await discordInteractiveService.revokeJupLikeRole(discordUserId);
                          if (roleRevoked) {
                              console.log(`      -> Discord role revoked successfully.`);
                          } else {
                              console.warn(`      -> Failed to revoke Discord role (check service logs for details).`);
                          }
                      } else {
                          console.log(`      -> User ${walletAddress} has not linked their Discord account.`);
                      }
                  } else {
                      // console.log(`   -> Unliker ${username} not associated with any user.`); // Can happen if user unlinked twitter
                  }
              }
              console.log('✅ All unlikers processed.');
          }

      } catch (updateError) {
          console.error(`❌ Error marking handles as UNLIKED:`, updateError);
      }
  }

  console.log(`[${new Date().toISOString()}] Jupiter like check finished. New/Updated: ${newLikersCount}, Unliked: ${unlikersCount}.`);
}

main().catch(err => {
  console.error('❌ Script execution failed:', err.message);
  process.exit(1); // Exit directly on failure
})
