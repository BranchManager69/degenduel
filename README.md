<h1 align="center">
  ⚔️ DEGENDUEL ⚔️ 
</h1>
<h3 align="center">
  Server Backend
</h3>
<p align="center"><i>Looking for the <a href="https://github.com/oyoops/degenduel-fe">Client Frontend</a> repo?</i></p>

<div align="center">
  <p>
    DegenDuel is a hunt for god candles, giga-alpha, and cooks in pursuit of ultimate <b>degen supremacy.</b>
    <br>
    Sharpen your trading skills while competing for big bragging rights and <b>even bigger top payouts.</b>
  </p>
</div>

</br>

<h2 align="center">
   📙 README
</h2>

</br>

  [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org/)
  [![React](https://img.shields.io/badge/React-18.3-blue)](https://reactjs.org/)
  [![Node.js](https://img.shields.io/badge/Node.js-20.x-green)](https://nodejs.org/)
  [![Express](https://img.shields.io/badge/Express-4.x-lightgrey)](https://expressjs.com/)
  [![PM2](https://img.shields.io/badge/PM2-5.3-green)](https://pm2.keymetrics.io/)
  [![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16.x-blue)](https://www.postgresql.org/)

## 🌟 Features
### Web3 Integration
- Phantom Wallet connection
- Wallet address verification
- Secure authentication flow
- Session management
- Network detection (mainnet/devnet)

### Real-Time Trading Simulation
- Live token prices from DexScreener API
- Real-time portfolio updates
- Accurate price tracking
- Historical price charts

### Portfolio Management
- Position tracking
- Trade history
- Performance metrics
- Unrealized/realized P&L
- Win streak tracking

### Advanced Trading Features
- Hot tokens feed
- Token search
- Price alerts
- Market statistics

### User Experience
- Dark/Light mode
- Responsive design
- Real-time updates
- Trade animations
- Performance optimizations

## 🚀 Quick Start

### Prerequisites

```bash
node -v  # Must be 20.x or higher
npm -v   # Must be 8.x or higher
```

### Development Setup

1. Clone and install:
   ```bash
   git clone https://github.com/yourusername/branchbet.git
   cd branchbet
   npm install
   ```

2. Initialize the database:
   ```bash
   npm run init-db
   ```

3. Start development servers:
   ```bash
   npm run dev  # Starts both frontend and API servers
   ```

4. Access the application:
   - Frontend: [http://localhost:3002](http://localhost:3002)
   - API: [http://localhost:3003](http://localhost:3003)

### Production Deployment

1. Build and start:
   ```bash
   npm run build  # Build frontend
   npm start      # Start PM2 processes
   ```

2. Monitor services:
   ```bash
   npm run status  # Check PM2 status
   npm run logs    # View application logs
   ```

## 🏗️ Technical Architecture

### System Overview

```mermaid
graph TD
    A[Nginx Reverse Proxy] --> B[Frontend Server :3002]
    A --> C[API Server :3003]
    B --> D[DexScreener API]
    C --> E[(PostgreSQL Database)]
    
    subgraph "Frontend Services"
        B --> F[Static Assets]
        B --> G[React SPA]
        G --> H[Zustand Store]
    end
    
    subgraph "Backend Services"
        C --> I[Express API]
        I --> J[PostgreSQL Models]
        I --> K[Web3 Services]
    end
```

### Key Technologies

- **Frontend Stack**
  - React 18.3 with TypeScript
  - Zustand for state management
  - Tailwind CSS for styling
  - Recharts for data visualization
  - Vite for development/building
  - Phantom Wallet SDK

- **Backend Stack**
  - Node.js with Express
  - PostgreSQL for persistence
  - Winston for logging
  - PM2 for process management

## 📁 Project Organization

### Directory Structure

```
branchbet/
├── src/                    # Frontend source
│   ├── components/         # React components
│   ├── hooks/             # React hooks
│   ├── store/             # State management
│   ├── types/             # TypeScript types
│   └── utils/             # Utilities
├── server/                 # Backend source
│   ├── config/            # Configuration
│   ├── controllers/       # Route handlers
│   ├── middleware/        # Express middleware
│   ├── models/            # Data models
│   ├── routes/            # API routes
│   ├── services/          # Business logic
│   └── utils/             # Server utilities
└── scripts/               # Tooling scripts
```

## 🔧 Configuration

### Environment Variables

```bash
# Frontend (.env)
VITE_API_URL=http://localhost:3003
VITE_WS_URL=ws://localhost:3003

# Backend (.env)
PORT=3003
NODE_ENV=development
DB_URL=postgresql://username:password@localhost:5432/dbname
```

### PM2 Configuration

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'frontend',
    script: 'server/frontend.js',
    env: {
      PORT: 3002
    }
  }, {
    name: 'api',
    script: 'server/server.js',
    env: {
      PORT: 3003
    }
  }]
};
```

## 🔍 Monitoring

### Available Commands

```bash
# System Status
npm run status    # PM2 process status
npm run logs      # All application logs
npm run logs:api  # API server logs only

# Maintenance
npm run rebuild   # Rebuild application
npm run restart   # Restart services
```

## 🔒 Security

### Implemented Measures

1. **API Security**
   - Rate limiting
   - Input validation
   - CORS policies
   - Error sanitization

2. **Frontend Security**
   - XSS prevention
   - Content Security Policy
   - Secure dependencies
   - Regular updates

3. **Infrastructure**
   - HTTPS enforcement
   - Secure headers
   - Database security
   - Access controls

4. **Wallet Security**
   - Message signing
   - Network validation
   - Session management
   - Connection pooling

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

### Development Workflow

```bash
git checkout -b feature/your-feature
npm install
npm run dev
# Make changes
npm run test
git commit -m "feat: your feature"
git push origin feature/your-feature
```

## 📞 Support

- **Issues**: GitHub Issues
- **Discussions**: GitHub Discussions
- **Twitter**: [@BranchManager69](https://twitter.com/BranchManager69)
- **Discord**: Join our server
- **Blog**: [blog.branch.bet](https://blog.branch.bet)

---

<div align="center">
  <p><b>DEGENDUEL</b> | Battle for degenerate supremacy.</p>
  <p>Sharpen your trading skills while competing to win real prizes. Ape and jeet with zero risk.</p>
  <p><b>DEGENDUEL</b> is a Branch Manager production. All rights reserved.</p>
</div>
