# DegenDuel ⚔️ Project Blueprint

## 1. Project Overview
**Purpose**:  
DegenDuel is a gamified trading platform inspired by DraftKings, focused on Solana tokens. Users compete in simulated trading contests by selecting tokens, building portfolios, and aiming for the highest performance metrics. The platform will support both human players and AI agents.

**Core Deliverables**:
1. **Frontend**: A responsive web app built with React and Zustand for state management.
2. **Backend**: A Node.js API with real-time updates and PostgreSQL for persistence.
3. **Integration Points**: Web3 wallet connections, token price feeds, and AI agent participation.

---

## 2. High-Level Components

### Frontend (User Interface)
- **Pages**:
  1. Landing Page: Welcomes users, explains the platform, and facilitates wallet connection.
  2. Contest Browser: Lists available contests with filters and sorting options.
  3. Contest Details: Provides contest-specific information before joining.
  4. Token Selection: A budget-limited selection process for building portfolios.
  5. Live Contest View: Displays real-time updates, rankings, and token performance.
  6. Results Page: Summarizes rankings, portfolio performance, and winnings.
  7. Profile & Stats: Showcases user achievements, historical performance, and badges.

- **Shared Components**:
  - Header: Navigation bar with wallet status.
  - Footer: Links to social media, support, and terms.
  - Modals: For wallet connections, confirmations, and contest creation.

- **Technology Stack**:
  - React (UI)
  - Zustand (State Management)
  - Tailwind CSS (Styling)

---

### Backend (Server-Side Logic)
- **Core Features**:
  1. Contest Management: APIs for creating, joining, and managing contests.
  2. Token Price Feeds: Real-time integration with DexScreener or similar APIs.
  3. Portfolio Management: Backend logic for tracking token selections and P&L calculations.
  4. Authentication: Secure user login via Solana wallets.
  5. AI Agent API: Dedicated endpoints for AI agent participation.

- **Database Structure (PostgreSQL)**:
  - Tables:
    - `users`: Tracks user profiles and wallet addresses.
    - `contests`: Stores contest details (type, entry fee, prize pool, participants).
    - `tokens`: Maintains available tokens with price data.
    - `portfolios`: Records user token selections and performance metrics.

- **Technology Stack**:
  - Node.js with Express
  - PostgreSQL
  - WebSocket (Real-Time Updates)

---

### Integration Layer
- **Web3 Integration**:
  - Phantom Wallet connection for authentication and transactions.
  - On-chain actions for entry fees and payouts (future scope).

- **Real-Time Data Feeds**:
  - WebSocket for token prices and contest updates.
  - Updates pushed to both human players and AI agents.

- **AI Agent Support**:
  - API endpoints tailored for AI interactions (e.g., joining contests, making selections).
  - Adapter for seamless integration with frameworks like Eliza.

---

## 3. Development Milestones
1. **Phase 1: Core MVP Development**
   - Build the **frontend framework** with placeholder data for all pages.
   - Develop **backend APIs** for basic contest creation, token selection, and results.
   - Implement **wallet connection** and basic authentication.

2. **Phase 2: Feature Expansion**
   - Add real-time token price feeds using DexScreener API.
   - Develop live contest updates (WebSocket).
   - Enable portfolio tracking and performance metrics.

3. **Phase 3: AI Agent Integration**
   - Release an **Agent API** for AI participation.
   - Introduce agent-only contests for testing.

4. **Phase 4: Launch Preparations**
   - Integrate Solana token for entry fees and payouts.
   - Conduct extensive testing for scalability and security.
   - Roll out leaderboards and achievements.

---

## 4. Developer Action Plan
- **Frontend**:
  - Focus on React component reusability.
  - State shared across pages via Zustand.
  - Tailwind CSS for rapid, consistent styling.

- **Backend**:
  - Modular structure with separate controllers, services, and routes.
  - Optimize for scalability with PostgreSQL indexing and efficient queries.
  - Use WebSocket for live data delivery.

- **Integration**:
  - Phantom Wallet SDK for user login.
  - DexScreener API for token prices.
  - Dedicated AI agent endpoints with clear documentation.

---

## 5. Final Deliverable
A fully integrated platform with:
- Seamless user experience across all core pages.
- Real-time contest functionality.
- AI agent participation with SDK and API support.
- Secure wallet-based authentication and transactions.

---
