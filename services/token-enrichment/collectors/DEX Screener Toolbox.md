**Clarifying pair and pool terminology**

The user's asking about whether calling the "pair" endpoint always returns all pools. Dexscreener has two relevant endpoints: one for all pairs (which are pools) for a token and one for information on a specific pair. It seems the user may be mixing up "pair" and "pool" — Dexscreener uses "pair" to represent both. So, if they’re always after the biggest pool, they’d expect to parse through the pairs to find it, but it shouldn't be necessary unless there’s an issue with the data they're receiving.

**Confirming pool and pair endpoints**

The user wants to clarify whether the pair endpoint includes all pools or if they need to identify the one with the highest liquidity. The answer is: the "token-pairs" endpoint returns all pools for a specific token. The single-pair endpoint only returns information for one pool. To get all pools, you’ll need to use the "token-pairs" or "tokens" endpoint and then parse the data for the top pool based on liquidity. There are no additional nested pools, except for minor delayed pools occasionally.


**Clarifying pair and pool endpoints**

The /latest/dex/search endpoint returns pairs based on search queries, but it’s not exhaustive. For a full list, you should use /token-pairs. The pair endpoint offers info about a single pool; it doesn’t include others. So to get all pools for a token, you need to call /token-pairs and parse the results to find the one with the highest liquidity. There’s no hidden nested pools—just multiple pair objects to sift through. I'll check out Dexscreener's API docs to confirm this.

**Confirming pool and pair endpoints**

To get all pools for a token, call the `/token-pairs/v1/{chainId}/{tokenAddress}` endpoint. The `/latest/dex/pairs/{chainId}/{pairId}` endpoint, on the other hand, only returns a single pool (pair). The `token-pairs` endpoint provides an array of pools for a token, while the pair endpoint gives you one pool. There's no nesting of pools within a pair, just multiple pair objects. If you want to find the pool with the highest liquidity, you’ll need to parse the list.


---

The pair endpoint doesn't include all pools because it's meant to return just one specific pool, not a list. The search endpoint only gives the first 30 results, unlike the token-pairs endpoint, which provides all matching pools. If a pool isn't indexed yet, it won't show up, but that's rare. To gather all available pools and avoid limitations, always use the `/token-pairs` endpoint. There’s no nesting of pools, so


Thought for 18 seconds


In DexScreener’s terminology, every **“pair”** object **is** a single on-chain liquidity pool—there is no separate “pools” array inside it. Here’s how it breaks down:

1. **All pools for a token**

   * **Endpoint:**

     ```
     GET /token-pairs/v1/{chainId}/{tokenAddress}
     ```
   * **What it returns:**
     A **raw JSON array** of `pairObject` entries—one per pool that token participates in. You get *every* pool (on Solana, in your case), and each object includes fields like `liquidity`, `volume`, `priceUsd`, `info`, etc. ([Dexscreener Docs][1]) (L21–L24)

2. **Single pool lookup**

   * **Endpoint:**

     ```
     GET /latest/dex/pairs/{chainId}/{pairId}
     ```
   * **What it returns:**
     A single `"pairs"`-wrapped object containing one `pairObject`. It **only** returns that one pool—you won’t see any of the token’s *other* pools here. ([Dexscreener Docs][1]) (L11–L15)

3. **Search endpoint (not exhaustive)**

   * **Endpoint:**

     ```
     GET /latest/dex/search?q=<query>
     ```
   * **Limitations:**
     Returns up to 30 matching `pairObject`s based on your search terms—**not** a complete list of all pools for a token. ([Dexscreener Docs][1]) (L16–L19)

---

**Conclusion:**

* To get *every* pool (i.e. “pair”) for a token, you must call **`/token-pairs/v1/{chainId}/{tokenAddress}`**.
* You will then always need to iterate through that array and pick out the pool with the highest `liquidity.usd` if you want “the main” pool—there is no single endpoint that returns only your top-liquidity pool.

[1]: https://docs.dexscreener.com/api/reference "Reference | DEX Screener - Docs"
