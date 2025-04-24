# Solana Blinks API Implementation

This is the backend implementation for the Solana Blinks (Actions) protocol integration.

## Integration Steps

1. Install required dependencies:
```bash
npm install @solana/web3.js @solana/spl-memo
```

2. Import and use this router in your Express app (usually in app.js or server.js):
```javascript
const blinksRoutes = require('./routes/blinks');
app.use('/api/blinks', blinksRoutes);
```

3. Configure environment variables:
```
SOLANA_RPC_URL=<your-private-rpc-url>
PLATFORM_FEE_ACCOUNT=<your-fee-wallet-address>
```

## API Endpoints

### GET Endpoints (Metadata)
- `GET /api/blinks/join-contest` - Get metadata for joining a contest
- `GET /api/blinks/view-contest` - Get metadata for viewing a live contest
- `GET /api/blinks/view-results` - Get metadata for viewing contest results
- `GET /api/blinks/place-token-bet` - Get metadata for placing a token bet

### POST Endpoints (Transaction Generation)
- `POST /api/blinks/join-contest` - Generate transaction for joining a contest
- `POST /api/blinks/place-token-bet` - Generate transaction for placing a token bet

## Technical Details

- Transactions use SPL Memo program to include metadata
- Proper CORS configuration for security
- Base64 serialized transactions for compatibility
EOL < /dev/null
