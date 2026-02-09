# Solana Token Lens (MVP)

Lightweight multi-chain token analyzer.

## Features
- Solana, Ethereum, BNB Chain, Base, Arbitrum token lookups via DexScreener
- Bitcoin (BTC) market data via CoinGecko
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
