# AI Service Documentation

## Overview

The DegenDuel AI Service is a dual-purpose service that provides:

1. **Periodic Analysis**: Automatically analyzes various collections (default: every 10 minutes)
    - Admin Logs
    - Client Errors
    - (more collections to be added)
2. **On-Demand AI**: Provides chat completion and streaming response APIs for application use
    - OpenAI API
    - (more AI APIs to be added)

The service follows the established service patterns in the codebase, extending BaseService and implementing circuit breaker functionality for resilience.

## Architecture

```
┌─────────────────┐       ┌─────────────────┐
│   Application   │       │   Admin Panel   │
└────────┬────────┘       └────────┬────────┘
         │                         │
         ▼                         ▼
┌─────────────────────────────────────────────┐
│                   AIApi                     │
└────────────────────┬────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────┐
│                 AIService                   │
├─────────────────────┬───────────────────────┤
│ Periodic Analysis   │  Chat Completions     │
└─────────────────────┴───────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────┐
│             OpenAI API Client               │
└─────────────────────────────────────────────┘
```

## Features

### Periodic Analysis

The service analyzes two types of data on a scheduled basis:

1. **Client Errors**: 
   - Analyzes errors logged in the `client_errors` table
   - Generates insights about error patterns, frequency, and severity
   - Stores analysis summaries in `system_settings` for reference

2. **Admin Actions**:
   - Analyzes admin activity from the `admin_logs` table
   - Identifies patterns, unusual activities, and potential security concerns
   - Stores analysis summaries in `system_settings` for reference

### On-Demand AI

The service provides two main methods for AI completions:

1. **Chat Completions**: 
   - Standard request/response model
   - Provides system prompts customized to user profiles
   - Logs conversation history in the database

2. **Streaming Responses**:
   - Real-time streaming of AI responses for better UX
   - Suitable for chat interfaces with typing indicators
   - Also logs conversations to database

## Usage

### AIApi Interface

The AI functionality is exposed through a clean API interface:

```javascript
import { AIApi } from '../api/aiApi.js';

// Generate a standard completion with default loadout
const result = await AIApi.generateCompletion([
  { role: 'user', content: 'Hello, how can you help me with DegenDuel?' }
], { 
  userId: req.user.wallet_address
});

// Generate a completion with a specific loadout
const creativeResult = await AIApi.generateCompletionWithLoadout([
  { role: 'user', content: 'Write a catchy slogan for our new token contest' }
], 'creative', { 
  userId: req.user.wallet_address 
});

// Alternative syntax for using loadouts
const tradingResult = await AIApi.generateCompletion([
  { role: 'user', content: 'Should I invest in this new token?' }
], { 
  userId: req.user.wallet_address
}, 'trading');

// Generate a streaming response with a specific loadout
const { stream, conversationId } = await AIApi.generateStreamingResponseWithLoadout([
  { role: 'user', content: 'Tell me a joke about crypto' }
], 'funny', { 
  userId: req.user.wallet_address
});

// Stream is a Node.js readable stream you can pipe to response
stream.pipe(res);

// Get available loadouts and their configurations
const loadouts = AIApi.getAvailableLoadouts();
console.log(loadouts);

// Get the latest client error analysis
const analysis = await AIApi.getLatestErrorAnalysis();

// Run an immediate analysis (don't wait for the schedule)
await AIApi.analyzeClientErrorsNow();

// Check if AI service is available
if (AIApi.isAvailable()) {
  // Use AI features
}

// Get service health metrics
const health = AIApi.getServiceHealth();
```

### Conversation Storage

AI conversations are automatically stored for authenticated users in:

- `ai_conversations`: Tracks conversation sessions
- `ai_conversation_messages`: Stores individual messages

This enables:
- History viewing for users
- Analysis of common questions
- Training data collection
- Compliance and auditing

## Configuration

The AI service is configured through several settings:

### In AIService Config

```javascript
// AI Service configuration
const AI_SERVICE_CONFIG = {
  // Service registration info
  name: SERVICE_NAMES.AI_SERVICE,
  description: 'AI Analysis and Processing Service',
  layer: 'application',
  criticalLevel: 'non-critical',
  
  // Analysis schedule (every 10 minutes)
  checkIntervalMs: 10 * 60 * 1000,
  
  // Circuit breaker settings
  circuitBreaker: {
    enabled: true,
    failureThreshold: 3,
    resetTimeoutMs: 30000
  },
  
  // Analysis settings
  analysis: {
    clientErrors: {
      enabled: true,
      lookbackMinutes: 10,
      minErrorsToAnalyze: 1
    },
    adminActions: {
      enabled: true,
      lookbackMinutes: 15,
      minActionsToAnalyze: 1
    }
  },
  
  // Model loadouts - specialized configurations for different operations
  loadouts: {
    // Default loadout - used when no specific loadout is specified
    default: {
      model: 'gpt-4o',
      maxTokens: 1000,
      temperature: 0.76,
      systemPrompt: "You are a helpful assistant for DegenDuel users."
    },
    
    // Special loadout for error analysis - focused on precision
    errorAnalysis: {
      model: 'gpt-4o',
      maxTokens: 2000,  // More tokens for thorough analysis
      temperature: 0.3, // Lower temperature for more deterministic analysis
      systemPrompt: "You are an error analysis assistant for DegenDuel..."
    },
    
    // Special loadout for admin log analysis - focused on pattern detection
    adminAnalysis: {
      model: 'gpt-4o',
      maxTokens: 2000,  // More tokens for thorough analysis
      temperature: 0.3, // Lower temperature for more deterministic analysis
      systemPrompt: "You are an admin activity analysis assistant for DegenDuel..."
    },
    
    // Creative personality for Degen Terminal
    degenTerminal: {
      model: 'gpt-4o',
      maxTokens: 600,   // Shorter, punchier responses
      temperature: 0.9, // Higher temperature for more creative responses
      systemPrompt: "You are Dgen, the sassy and fun virtual assistant for DegenDuel..."
    },
    
    // Additional specialized loadouts
    trading: { /* Configuration for trading advice */ },
    support: { /* Configuration for technical support */ },
    creative: { /* Configuration for creative content */ },
    coding: { /* Configuration for code-related queries */ },
    funny: { /* Configuration for humor-focused responses */ }
  },
  
  // Legacy support for previous configuration pattern
  systemPrompts: {
    default: "...",
    trading: "...",
    // Other specialized prompts
  }
};
```

### Service Registration

The AI service is registered with the service manager and included in service constants:

```javascript
// In service-constants.js
export const SERVICE_NAMES = {
  // ...other services...
  AI_SERVICE: 'ai_service',
  // ...
};

// AI Service metadata
[SERVICE_NAMES.AI_SERVICE]: {
  layer: SERVICE_LAYERS.INFRASTRUCTURE,
  description: 'AI processing and analysis service',
  updateFrequency: '10m',
  criticalLevel: 'medium',
  dependencies: []
},
```

## Loadout System

The AI service uses a "loadout" system to provide specialized configurations for different types of AI operations. Each loadout includes:

- **Model**: The specific OpenAI model to use
- **Temperature**: Controls randomness/creativity (lower = more deterministic)
- **Max Tokens**: Maximum response length
- **System Prompt**: Specialized instructions for the AI's role and behavior

### Available Loadouts

| Loadout | Temperature | Tokens | Purpose |
|---------|-------------|--------|---------|
| default | 0.76 | 1000 | General-purpose assistance for users |
| errorAnalysis | 0.3 | 2000 | Technical analysis of client errors with high precision |
| adminAnalysis | 0.3 | 2000 | Analysis of admin actions to detect patterns and anomalies |
| degenTerminal | 0.9 | 600 | Creative, sassy interactions for the Degen Terminal interface |
| trading | 0.5 | 1200 | Balanced trading advice with moderate creativity |
| support | 0.3 | 1500 | Technical support with high precision |
| creative | 0.9 | 800 | Creative content generation (slogans, ideas, etc.) |
| coding | 0.2 | 1500 | Programming and technical help with high precision |
| funny | 0.95 | 600 | Humor-focused responses with high creativity |

### When to Use Each Loadout

- Use **errorAnalysis** for technical diagnostics that require precision
- Use **adminAnalysis** for pattern recognition in admin actions
- Use **degenTerminal** for engaging, personality-rich user interactions 
- Use **trading** for balanced investment discussions
- Use **support** for accurate technical support responses
- Use **creative** for generating marketing content, ideas, or descriptions
- Use **coding** for programming help, debugging, or technical explanations
- Use **funny** for humor, jokes, or light-hearted interactions

### Customizing Loadouts

Loadouts can be adjusted in the AIService configuration. Each loadout is defined in the `loadouts` section of the service config:

```javascript
// Example of adding a new specialized loadout
const AI_SERVICE_CONFIG = {
  // ...other config...
  loadouts: {
    // ...existing loadouts...
    
    // Custom loadout for tournament analysis
    tournamentAnalysis: {
      model: 'gpt-4o',
      maxTokens: 1800,
      temperature: 0.4,
      systemPrompt: "You are a tournament analysis expert for DegenDuel..."
    }
  }
};
```

## User Personalization

All loadouts are personalized with user data when available, including:
- User level and title
- Achievement count
- Contest history
- Account age

## Error Handling

The AI service implements robust error handling:

1. **Circuit Breaker**: Prevents cascading failures when OpenAI API is down
2. **Error Classification**: Categorizes errors by type (quota, auth, rate limit)
3. **Service Resilience**: Self-healing with automatic recovery attempts
4. **Performance Tracking**: Monitors operation success/failure rates

## Analysis Examples

### Client Error Analysis

The AI service generates insights such as:

```
Analysis of 12 client errors in the past 10 minutes:

PATTERNS DETECTED:
- 8 errors (67%) are related to WebSocket connection issues
- 3 errors (25%) show TypeError in portfolio rendering
- 1 error is a unique case related to authentication

ROOT CAUSES:
1. WebSocket errors appear to be caused by network instability
2. Portfolio rendering errors consistently occur when loading token data with missing properties
3. Authentication error happens during token refresh

RECOMMENDATIONS:
1. Add error handling for WebSocket reconnections
2. Implement null checks in portfolio rendering components
3. Monitor authentication token refresh process

CRITICAL ISSUES:
- Portfolio rendering error affects 25% of users
- Should be prioritized for immediate fix
```

### Admin Action Analysis

```
Analysis of 18 admin actions in the past 15 minutes:

ACTIVITY SUMMARY:
- 12 actions by admin1@wallet (67%)
- 5 actions by admin2@wallet (28%)
- 1 action by superadmin@wallet (5%)

ACTION TYPES:
- 8 contest modifications (44%)
- 6 user account adjustments (33%)
- 3 system setting changes (17%)
- 1 wallet operation (6%)

NOTABLE PATTERNS:
- Multiple contest parameter changes in short succession
- System settings modified during peak usage hours
- No unusual or suspicious activity detected

RECOMMENDATIONS:
- Consider batching contest parameter changes
- Schedule system setting updates during off-peak hours
```

## Future Enhancements

Planned enhancements to the AI service include:

1. **Function Calling**: Support for AI to call predefined functions
2. **Multimodal Support**: Handle image inputs for visual analysis
3. **User Behavior Analysis**: Analyze user patterns for personalization
4. **Scheduled Reports**: Generate weekly/monthly analysis reports
5. **Fine-tuning**: Custom model tuning with DegenDuel-specific data

## Security Considerations

The AI service implements several security measures:

1. **Content Filtering**: Prevents inappropriate content
2. **Quota Management**: Controls API usage to prevent cost overruns
3. **Sensitive Data Protection**: Removes sensitive data from logs
4. **Circuit Breaking**: Prevents cascading failures during outages
5. **Error Classification**: Properly handles different error types

## Debugging

To debug the AI service:

1. **View Service Status**:
   ```javascript
   // In admin dashboard or console
   import serviceManager from '../utils/service-suite/service-manager.js';
   const aiStatus = serviceManager.getServiceStatus(SERVICE_NAMES.AI_SERVICE);
   console.log(aiStatus);
   ```

2. **Check Analysis Results**:
   ```javascript
   // Query the system_settings table
   const analysis = await prisma.system_settings.findUnique({
     where: { key: 'latest_client_error_analysis' }
   });
   console.log(analysis.value);
   ```

3. **Monitor Logs**:
   ```
   tail -f /path/to/logs | grep "\[AIService\]"
   ```

4. **Service Circuit Breaker Status**:
   ```javascript
   const circuitBreakerState = await prisma.circuit_breaker_states.findUnique({
     where: { service_name: SERVICE_NAMES.AI_SERVICE }
   });
   console.log(circuitBreakerState);
   ```

## Conclusion

The DegenDuel AI Service provides a robust foundation for both automated analysis and on-demand AI interactions. By following the established service patterns and implementing proper error handling, it ensures reliability and resilience while leveraging the power of OpenAI's models for improved user experience and system insights.