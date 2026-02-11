# Solana Token Lens (MVP)

Lightweight multi-chain token analyzer.

## Features
- Solana, Ethereum, BNB Chain, Base, Arbitrum token lookups via DexScreener
- Bitcoin (BTC) market data via CoinGecko
- Volume metrics: 24h, 7d, 1m (7d/1m from GeckoTerminal daily OHLCV when available)
- Embedded DexScreener live chart
- First minted/first seen timestamp (Solana prefers earliest on-chain activity when Helius is set)
- Token-related news aggregation (Google News RSS query)
- Market signals: buys/sells (5m, 1h, 24h), price change windows (5m/1h/6h/24h), liquidity/mcap ratio, pool age, 24h vs 7d volume trend, 7d volatility
- Holder count via HolderScan (optional API key, Solana only)
- Mint/freeze authority via Helius RPC (optional API key, Solana only)
- Simple risk scoring

## Local dev (Node server)
```bash
node server.js
```
Then open `http://localhost:3000`.

## Netlify deployment
This project is configured for Netlify with a serverless function.

- Publish directory: `public`
- Functions directory: `netlify/functions`
- Endpoint: `/api/analyze`

Set these environment variables in Netlify (optional but recommended):
- `HELIUS_API_KEY`
- `HOLDERSCAN_API_KEY`

## Notes
- Without API keys, the app still returns DEX pricing and liquidity.
- Risk scores are heuristic, not guarantees.
- Bitcoin does not use token contracts; leave the address empty to fetch BTC.
- For non-Solana chains, `firstMintedAt` falls back to earliest DEX pair creation when direct mint-time data is unavailable.
