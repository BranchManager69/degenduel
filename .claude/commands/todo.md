# DegenDuel Backend To-Do List

## Major Items
 
### Solana Transactions Need to be Updated 

- Update to the latest preferred method (the @solana/web3.js v2 method).

- Fix '*r.serialize is not a function*' error on both Token Whitelist Service and Contest Portfolio Entry transactions.

### Fix v69 Websocket System

- Has never worked; Cannot find the source of the 1006 errors!

### Find a new Solana RPC (need a great one and good value)

### Explore Database Consolidation

- Maintaining three databases is proving to be a ridiculous hassle.

## DegenDuel Databases List

1. GAME_DATABASE

    - All user, game, system settings, ... all the core data. 
    - Token prices and market data were intended to be synced from GAME_ but it's unclear if that's what's occuring.

2. MARKET_DATABASE

    - All token prices and market data.
    - This is our primary ingestion and broadcast depot for one-true-source price info which factors into portfolio returns and therefore contest outcome determinations.

3. REFLECTIONS_DATABASE

    - Establishes read-only connections to GAME_ and MARKET_
    - Actually is a good way to separate the Reflections logic.

