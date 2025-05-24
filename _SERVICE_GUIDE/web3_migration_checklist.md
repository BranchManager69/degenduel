# Web3 Migration Status Overview

This document provides a visual overview of the migration status from the legacy `@solana/web3.js` (v1) to the new v2 stack.

<table style="width:100%; border-collapse: collapse;">
  <thead>
    <tr>
      <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Service Name</th>
      <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Migration Status</th>
      <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Mapped Out</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td style="border: 1px solid #ddd; padding: 8px;">admin-wallet</td>
      <td style="border: 1px solid #ddd; padding: 8px; background-color: #FFFFE0;">Partial Migration</td>
      <td style="border: 1px solid #ddd; padding: 8px;">*</td>
    </tr>
    <tr>
      <td style="border: 1px solid #ddd; padding: 8px;">contest-wallet</td>
      <td style="border: 1px solid #ddd; padding: 8px; background-color: #FFCCCB;">Needs Migration</td>
      <td style="border: 1px solid #ddd; padding: 8px;">*</td>
    </tr>
    <tr>
      <td style="border: 1px solid #ddd; padding: 8px;">contestEvaluationService.js</td>
      <td style="border: 1px solid #ddd; padding: 8px; background-color: #FFCCCB;">Needs Migration</td>
      <td style="border: 1px solid #ddd; padding: 8px;">*</td>
    </tr>
    <tr>
      <td style="border: 1px solid #ddd; padding: 8px;">liquidityService.js</td>
      <td style="border: 1px solid #ddd; padding: 8px; background-color: #FFCCCB;">Needs Migration</td>
      <td style="border: 1px solid #ddd; padding: 8px;">*</td>
    </tr>
    <tr>
      <td style="border: 1px solid #ddd; padding: 8px;">solana-engine</td>
      <td style="border: 1px solid #ddd; padding: 8px; background-color: #FFCCCB;">Needs Migration</td>
      <td style="border: 1px solid #ddd; padding: 8px;">*</td>
    </tr>
    <tr>
      <td style="border: 1px solid #ddd; padding: 8px;">solanaService.js</td>
      <td style="border: 1px solid #ddd; padding: 8px; background-color: #FFCCCB;">Needs Migration</td>
      <td style="border: 1px solid #ddd; padding: 8px;">*</td>
    </tr>
    <tr>
      <td style="border: 1px solid #ddd; padding: 8px;">tokenWhitelistService.js</td>
      <td style="border: 1px solid #ddd; padding: 8px; background-color: #FFCCCB;">Needs Migration</td>
      <td style="border: 1px solid #ddd; padding: 8px;">*</td>
    </tr>
    <tr>
      <td style="border: 1px solid #ddd; padding: 8px;">userBalanceTrackingService.js</td>
      <td style="border: 1px solid #ddd; padding: 8px; background-color: #FFCCCB;">Needs Migration</td>
      <td style="border: 1px solid #ddd; padding: 8px;"> </td>
    </tr>
    <tr>
      <td style="border: 1px solid #ddd; padding: 8px;">vanity-wallet</td>
      <td style="border: 1px solid #ddd; padding: 8px; background-color: #FFCCCB;">Needs Migration</td>
      <td style="border: 1px solid #ddd; padding: 8px;">*</td>
    </tr>
    <tr>
      <td style="border: 1px solid #ddd; padding: 8px;">walletGenerationService.js</td>
      <td style="border: 1px solid #ddd; padding: 8px; background-color: #FFCCCB;">Needs Migration</td>
      <td style="border: 1px solid #ddd; padding: 8px;">*</td>
    </tr>
    <tr>
      <td style="border: 1px solid #ddd; padding: 8px;">walletRakeService.js</td>
      <td style="border: 1px solid #ddd; padding: 8px; background-color: #FFCCCB;">Needs Migration</td>
      <td style="border: 1px solid #ddd; padding: 8px;"> </td>
    </tr>
    <tr>
      <td style="border: 1px solid #ddd; padding: 8px;">achievementService.js</td>
      <td style="border: 1px solid #ddd; padding: 8px; background-color: #D0F0C0;">OK / N-A</td>
      <td style="border: 1px solid #ddd; padding: 8px;"> </td>
    </tr>
    <tr>
      <td style="border: 1px solid #ddd; padding: 8px;">ai-service/</td>
      <td style="border: 1px solid #ddd; padding: 8px; background-color: #D0F0C0;">OK / N-A</td>
      <td style="border: 1px solid #ddd; padding: 8px;"> </td>
    </tr>
    <tr>
      <td style="border: 1px solid #ddd; padding: 8px;">contestImageService.js</td>
      <td style="border: 1px solid #ddd; padding: 8px; background-color: #D0F0C0;">OK / N-A</td>
      <td style="border: 1px solid #ddd; padding: 8px;"> </td>
    </tr>
    <tr>
      <td style="border: 1px solid #ddd; padding: 8px;">contestSchedulerService.js</td>
      <td style="border: 1px solid #ddd; padding: 8px; background-color: #D0F0C0;">OK / N-A</td>
      <td style="border: 1px solid #ddd; padding: 8px;"> </td>
    </tr>
    <tr>
      <td style="border: 1px solid #ddd; padding: 8px;">utils/contest-utils.js</td>
      <td style="border: 1px solid #ddd; padding: 8px; background-color: #D0F0C0;">OK / N-A</td>
      <td style="border: 1px solid #ddd; padding: 8px;"> </td>
    </tr>
    <tr>
      <td style="border: 1px solid #ddd; padding: 8px;">discord/</td>
      <td style="border: 1px solid #ddd; padding: 8px; background-color: #D0F0C0;">OK / N-A</td>
      <td style="border: 1px solid #ddd; padding: 8px;"> </td>
    </tr>
    <tr>
      <td style="border: 1px solid #ddd; padding: 8px;">launchEventService.js</td>
      <td style="border: 1px solid #ddd; padding: 8px; background-color: #D0F0C0;">OK / N-A</td>
      <td style="border: 1px solid #ddd; padding: 8px;"> </td>
    </tr>
    <tr>
      <td style="border: 1px solid #ddd; padding: 8px;">levelingService.js</td>
      <td style="border: 1px solid #ddd; padding: 8px; background-color: #D0F0C0;">OK / N-A</td>
      <td style="border: 1px solid #ddd; padding: 8px;"> </td>
    </tr>
    <tr>
      <td style="border: 1px solid #ddd; padding: 8px;">liquidity-sim/</td>
      <td style="border: 1px solid #ddd; padding: 8px; background-color: #D0F0C0;">OK / N-A</td>
      <td style="border: 1px solid #ddd; padding: 8px;"> </td>
    </tr>
    <tr>
      <td style="border: 1px solid #ddd; padding: 8px;">market-data/</td>
      <td style="border: 1px solid #ddd; padding: 8px; background-color: #D0F0C0;">OK / N-A</td>
      <td style="border: 1px solid #ddd; padding: 8px;"> </td>
    </tr>
    <tr>
      <td style="border: 1px solid #ddd; padding: 8px;">pool-data-manager/</td>
      <td style="border: 1px solid #ddd; padding: 8px; background-color: #D0F0C0;">OK / N-A</td>
      <td style="border: 1px solid #ddd; padding: 8px;">*</td>
    </tr>
    <tr>
      <td style="border: 1px solid #ddd; padding: 8px;">portfolioSnapshotService.js</td>
      <td style="border: 1px solid #ddd; padding: 8px; background-color: #D0F0C0;">OK / N-A</td>
      <td style="border: 1px solid #ddd; padding: 8px;"> </td>
    </tr>
    <tr>
      <td style="border: 1px solid #ddd; padding: 8px;">referralService.js</td>
      <td style="border: 1px solid #ddd; padding: 8px; background-color: #D0F0C0;">OK / N-A</td>
      <td style="border: 1px solid #ddd; padding: 8px;"> </td>
    </tr>
    <tr>
      <td style="border: 1px solid #ddd; padding: 8px;">token-dex-data-service.js</td>
      <td style="border: 1px solid #ddd; padding: 8px; background-color: #D0F0C0;">OK / N-A</td>
      <td style="border: 1px solid #ddd; padding: 8px;">*</td>
    </tr>
    <tr>
      <td style="border: 1px solid #ddd; padding: 8px;">token-enrichment/</td>
      <td style="border: 1px solid #ddd; padding: 8px; background-color: #D0F0C0;">OK / N-A</td>
      <td style="border: 1px solid #ddd; padding: 8px;"> </td>
    </tr>
    <tr>
      <td style="border: 1px solid #ddd; padding: 8px;">token-history-functions.js</td>
      <td style="border: 1px solid #ddd; padding: 8px; background-color: #D0F0C0;">OK / N-A</td>
      <td style="border: 1px solid #ddd; padding: 8px;"> </td>
    </tr>
    <tr>
      <td style="border: 1px solid #ddd; padding: 8px;">token-refresh-integration.js</td>
      <td style="border: 1px solid #ddd; padding: 8px; background-color: #D0F0C0;">OK / N-A</td>
      <td style="border: 1px solid #ddd; padding: 8px;"> </td>
    </tr>
    <tr>
      <td style="border: 1px solid #ddd; padding: 8px;">token-refresh-scheduler/ (and token-refresh-scheduler.js)</td>
      <td style="border: 1px solid #ddd; padding: 8px; background-color: #D0F0C0;">OK / N-A</td>
      <td style="border: 1px solid #ddd; padding: 8px;">*</td>
    </tr>
    <tr>
      <td style="border: 1px solid #ddd; padding: 8px;">tokenMonitorService.js</td>
      <td style="border: 1px solid #ddd; padding: 8px; background-color: #D0F0C0;">OK / N-A</td>
      <td style="border: 1px solid #ddd; padding: 8px;">*</td>
    </tr>
    <tr>
      <td style="border: 1px solid #ddd; padding: 8px;">userProfileImageService.js</td>
      <td style="border: 1px solid #ddd; padding: 8px; background-color: #D0F0C0;">OK / N-A</td>
      <td style="border: 1px solid #ddd; padding: 8px;"> </td>
    </tr>
  </tbody>
</table>

<br>

*(Note: `services/SOLANA_COMPAT_ANSWERS.md` also references `@solana/web3.js` but is a non-executable documentation file.)* 