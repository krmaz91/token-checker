# Solana Token Lens (MVP)

Lightweight Solana token analyzer with no framework dependencies.

## Features
- Solana, Ethereum, Base, Arbitrum token lookups via DexScreener
- Bitcoin (BTC) market data via CoinGecko
- Holder count via HolderScan (optional API key, Solana only)
- Mint/freeze authority via Helius RPC (optional API key, Solana only)
- Simple risk scoring

## Run locally
```bash
node server.js
```

Then open `http://localhost:3000`.

## Environment variables (optional)
```bash
export HELIUS_API_KEY=your_key
export HOLDERSCAN_API_KEY=your_key
```

## Notes
- Without API keys, the app still returns DEX pricing and liquidity.
- Risk scores are heuristic, not guarantees.
- Bitcoin does not use token contracts; leave the address empty to fetch BTC.
