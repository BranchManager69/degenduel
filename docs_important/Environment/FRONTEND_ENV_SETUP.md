# Frontend Environment Setup Instructions

## Recent Infrastructure Changes

We've implemented a complete development environment parallel to production. Here are the key changes and testing requirements:

### Environment URLs & Ports

**Production Environment**
- Main URL: `https://degenduel.me`
- API Endpoint: `https://degenduel.me/api`
- WebSocket: `wss://degenduel.me/api/v2/ws/portfolio`
- Port: 3004 (internal)

**Development Environment**
- Main URL: `https://dev.degenduel.me`
- API Endpoint: `https://dev.degenduel.me/api`
- WebSocket: `wss://dev.degenduel.me/api/v2/ws/portfolio`
- Port: 3005 (internal)

### Required Frontend Updates

1. **Environment Detection**
   ```typescript
   const isDev = 
     window.location.hostname === "localhost" ||
     window.location.hostname.startsWith("127.0.0.1") ||
     window.location.hostname === "dev.degenduel.me";
   ```

2. **API Configuration**
   ```typescript
   export const API_URL = isDev
     ? `https://dev.degenduel.me/api`
     : `https://degenduel.me/api`;
   ```

3. **WebSocket Configuration**
   ```typescript
   export const WS_URL = isDev
     ? `wss://dev.degenduel.me/api/v2/ws/portfolio`
     : `wss://degenduel.me/api/v2/ws/portfolio`;
   ```

### Testing Requirements

1. **Authentication**
   - Login should work on both environments
   - Sessions are currently shared between environments
   - Test wallet connections in both environments

2. **WebSocket Testing**
   - Verify portfolio updates in both environments
   - Test reconnection behavior
   - Verify subscription messages are working
   - Check real-time updates in development

3. **Environment-Specific Testing**
   - Test all API endpoints in development
   - Verify WebSocket connections
   - Check CORS settings
   - Test authentication flows

### Important Notes

1. **Authentication Behavior**
   - You may remain logged in across environments
   - This is temporary and will change post-launch
   - Report any authentication issues separately for each environment

2. **Development Environment**
   - Uses separate database (degenduel_test)
   - May have different data than production
   - Perfect for testing new features

3. **SSL/Security**
   - Both environments use valid SSL certificates
   - Same security headers in both environments
   - WebSocket connections require authentication

### Common Issues & Solutions

1. **401 Unauthorized**
   - Check if token exists
   - Verify WebSocket connection includes session cookie
   - Try re-authenticating

2. **WebSocket Connection Failed**
   - Verify correct URL for environment
   - Check authentication status
   - Inspect browser console for CORS issues

3. **CORS Issues**
   - Development allows localhost
   - Production restricts to specific domains
   - Report any CORS errors with full details

### Testing Checklist

- [ ] Login/Authentication
- [ ] WebSocket Connection
- [ ] Portfolio Updates
- [ ] Real-time Data Flow
- [ ] Error Handling
- [ ] Reconnection Logic
- [ ] Environment Switching
- [ ] Session Management

### Reporting Issues

When reporting issues, please specify:
1. Environment (dev/prod)
2. Steps to reproduce
3. Expected vs actual behavior
4. Browser console logs
5. Network request details

### Next Steps

1. Update your local frontend configuration
2. Test both environments thoroughly
3. Report any inconsistencies
4. Document any additional requirements

### Contact

For any questions about the environment setup or testing requirements, contact:
- Backend Team Lead (BranchManager)
- DevOps Team (via Discord)

Remember to always specify which environment you're working with when discussing issues or features. 