# Environment Authentication Considerations

## Overview

DegenDuel uses two distinct environments (Production and Development) with shared infrastructure components. This document outlines the authentication implications, security considerations, and potential solutions for managing user sessions across environments.

## Current Setup

### Environment Structure
- **Production**: `degenduel.me`
  - API Port: 3004
  - WebSocket: wss://degenduel.me/api/v2/ws/portfolio
  - Database: degenduel (production)

- **Development**: `dev.degenduel.me`
  - API Port: 3005
  - WebSocket: wss://dev.degenduel.me/api/v2/ws/portfolio
  - Database: degenduel_test

### Authentication Components
1. **JWT Tokens**
   - Single `JWT_SECRET` shared across environments
   - Tokens contain wallet address and role
   - No environment-specific claims

2. **Cookie Management**
   - HTTP-only cookies
   - Domain-specific (.degenduel.me)
   - Secure flag enabled
   - Same-site policy: lax

## Security Implications

### Current Risks

1. **Cross-Environment Token Validity**
   - Tokens signed in production work in development
   - Tokens signed in development work in production
   - Potential for unintended data access

2. **Development Environment Exposure**
   - If dev environment is compromised:
     - Valid production tokens could be created
     - Access to production data possible
     - Potential for privilege escalation

3. **Testing Complications**
   - Authentication bugs may be masked
   - Login flow testing becomes unreliable
   - Session management issues harder to detect

### Benefits of Current Setup

1. **Developer Experience**
   - Seamless switching between environments
   - Reduced login friction
   - Easier testing and debugging

2. **Implementation Simplicity**
   - Single secret management
   - Unified authentication logic
   - Simpler deployment process

## Potential Solutions

### Option 1: Complete Environment Separation
```javascript
// Environment-specific secrets
const JWT_SECRET_PROD = process.env.JWT_SECRET_PROD;
const JWT_SECRET_DEV = process.env.JWT_SECRET_DEV;

// Token generation with environment claim
const token = jwt.sign({
    wallet_address: user.wallet_address,
    role: user.role,
    environment: isDev ? 'development' : 'production'
}, isDev ? JWT_SECRET_DEV : JWT_SECRET_PROD);

// Middleware verification
const verifyToken = (req, res, next) => {
    const token = req.cookies.session;
    try {
        const secret = isDev ? JWT_SECRET_DEV : JWT_SECRET_PROD;
        const decoded = jwt.verify(token, secret);
        
        if (decoded.environment !== getCurrentEnvironment()) {
            return res.status(401).json({
                error: 'Invalid token for this environment'
            });
        }
        
        req.user = decoded;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
};
```

#### Pros:
- Maximum security
- Clear environment boundaries
- Proper testing isolation

#### Cons:
- More complex configuration
- Additional developer friction
- Separate secret management

### Option 2: Enhanced Shared Authentication
```javascript
// Add environment awareness but allow cross-env
const token = jwt.sign({
    wallet_address: user.wallet_address,
    role: user.role,
    issued_environment: isDev ? 'development' : 'production'
}, JWT_SECRET);

// Middleware with logging
const verifyToken = (req, res, next) => {
    const token = req.cookies.session;
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        
        if (decoded.issued_environment !== getCurrentEnvironment()) {
            logApi.warn('Cross-environment token used', {
                issued: decoded.issued_environment,
                current: getCurrentEnvironment(),
                wallet: decoded.wallet_address
            });
        }
        
        req.user = decoded;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
};
```

#### Pros:
- Maintains developer convenience
- Adds visibility to cross-env usage
- Simpler implementation

#### Cons:
- Security concerns remain
- Potential for confusion
- Less testing isolation

### Option 3: Development-Only Special Mode
```javascript
// Special dev-only authentication
const DEV_MASTER_KEY = process.env.DEV_MASTER_KEY;

const devLogin = async (req, res) => {
    if (!isDev) {
        return res.status(404).json({ error: 'Not found' });
    }
    
    const { master_key, wallet_address, role } = req.body;
    if (master_key !== DEV_MASTER_KEY) {
        return res.status(401).json({ error: 'Invalid master key' });
    }
    
    const token = jwt.sign({
        wallet_address,
        role,
        dev_mode: true
    }, JWT_SECRET);
    
    res.cookie('session', token, getCookieOptions());
    res.json({ success: true });
};
```

#### Pros:
- Clear development purpose
- Maintains security
- Flexible for testing

#### Cons:
- Different auth flows per environment
- Additional configuration needed
- Potential for confusion

## Immediate Recommendations

For the upcoming launch:

1. **Short Term (Current Launch)**
   - Keep existing shared authentication
   - Add enhanced logging for cross-environment access
   - Document known limitations

2. **Post-Launch Priorities**
   - Implement environment-specific secrets
   - Add environment claims to tokens
   - Create migration plan for existing sessions

3. **Future Considerations**
   - Evaluate need for complete separation
   - Consider developer workflow impact
   - Plan for scaling security needs

## Implementation Plan

### Phase 1: Enhanced Monitoring
1. Add logging for cross-environment token usage
2. Implement environment tracking in analytics
3. Monitor for suspicious patterns

### Phase 2: Security Enhancement
1. Deploy environment-specific secrets
2. Update token generation with environment claims
3. Implement stricter validation

### Phase 3: Complete Separation (If Needed)
1. Roll out environment-specific authentication
2. Migrate existing sessions
3. Update documentation and procedures

## Conclusion

The current shared authentication system, while convenient for development, presents some security considerations that should be addressed post-launch. The immediate focus should be on monitoring and logging, with a planned transition to more secure practices after the initial release is stable. 