const HELIUS_API_KEY = process.env.HELIUS_API_KEY || "";
const HOLDERSCAN_API_KEY = process.env.HOLDERSCAN_API_KEY || "";

function sendJson(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function isLikelySolanaMint(input) {
  if (!input) return false;
  const trimmed = input.trim();
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed);
}

function isLikelyEvmAddress(input) {
  if (!input) return false;
  const trimmed = input.trim();
  return /^0x[a-fA-F0-9]{40}$/.test(trimmed);
}

function pickBestPair(pairs) {
  if (!Array.isArray(pairs) || pairs.length === 0) return null;
  return pairs.reduce((best, pair) => {
    const bestLiquidity = Number(best?.liquidity?.usd || 0);
    const pairLiquidity = Number(pair?.liquidity?.usd || 0);
    if (pairLiquidity > bestLiquidity) return pair;
    return best;
  }, pairs[0]);
}

function buildRiskSignals({ bestPair, holdersCount, mintAuthority, freezeAuthority }) {
  const signals = [];
  if (mintAuthority) {
    signals.push({ level: "high", message: "Mint authority is still enabled (token supply can be increased)." });
  }
  if (freezeAuthority) {
    signals.push({ level: "medium", message: "Freeze authority is enabled (accounts can be frozen)." });
  }
  if (holdersCount !== null && holdersCount <= 50) {
    signals.push({ level: "medium", message: "Very low holder count (<= 50)." });
  }
  if (bestPair && Number(bestPair?.liquidity?.usd || 0) < 5000) {
    signals.push({ level: "medium", message: "Low DEX liquidity (< $5k)." });
  }
  if (!bestPair) {
    signals.push({ level: "high", message: "No active DEX pair found for this mint." });
  }
  const score = signals.reduce((acc, s) => acc + (s.level === "high" ? 2 : 1), 0);
  let label = "Low";
  if (score >= 4) label = "High";
  else if (score >= 2) label = "Medium";
  return { label, signals };
}

async function fetchDexScreener(mint) {
  const url = `https://api.dexscreener.com/latest/dex/tokens/${mint}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`DexScreener error: ${response.status}`);
  }
  return response.json();
}

async function fetchHeliusMintAuthorities(mint) {
  if (!HELIUS_API_KEY) return { mintAuthority: null, freezeAuthority: null };
  const url = `https://rpc.helius.xyz/?api-key=${HELIUS_API_KEY}`;
  const body = {
    jsonrpc: "2.0",
    id: "mint-info",
    method: "getAccountInfo",
    params: [mint, { encoding: "jsonParsed" }],
  };
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Helius RPC error: ${response.status}`);
  }
  const data = await response.json();
  const info = data?.result?.value?.data?.parsed?.info;
  return {
    mintAuthority: info?.mintAuthority ?? null,
    freezeAuthority: info?.freezeAuthority ?? null,
  };
}

async function fetchHolderCount(mint) {
  if (!HOLDERSCAN_API_KEY) return null;
  const url = `https://api.holderscan.com/v0/solana/tokens/${mint}/holders?limit=1`;
  const response = await fetch(url, {
    headers: { "X-API-KEY": HOLDERSCAN_API_KEY },
  });
  if (!response.ok) {
    throw new Error(`HolderScan error: ${response.status}`);
  }
  const data = await response.json();
  return typeof data?.total === "number" ? data.total : null;
}

async function fetchBitcoinMarket() {
  const url =
    "https://api.coingecko.com/api/v3/coins/bitcoin?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false";
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`CoinGecko error: ${response.status}`);
  }
  return response.json();
}

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const mint = (params.mint || "").trim();
  const chain = (params.chain || "solana").toLowerCase();

  if (chain === "bitcoin") {
    if (mint) {
      return sendJson(400, {
        error: "Bitcoin does not use token contracts. Leave the address empty to fetch BTC.",
      });
    }
    try {
      const btc = await fetchBitcoinMarket();
      const market = btc?.market_data || {};
      return sendJson(200, {
        chain,
        mint: "BTC",
        priceUsd: market?.current_price?.usd ?? null,
        marketCapUsd: market?.market_cap?.usd ?? null,
        dailyChangePercent: market?.price_change_percentage_24h ?? null,
        volume24hUsd: market?.total_volume?.usd ?? null,
        holders: null,
        mintAuthority: null,
        freezeAuthority: null,
        dexPair: null,
        risk: { label: "Low", signals: [] },
        sources: { dexScreener: false, holderScan: false, helius: false },
      });
    } catch (error) {
      return sendJson(500, {
        error: "Failed to fetch BTC market data.",
        details: error.message,
      });
    }
  }

  const isSolana = chain === "solana";
  const isEvm = ["ethereum", "base", "arbitrum", "bsc"].includes(chain);
  if (isSolana && !isLikelySolanaMint(mint)) {
    return sendJson(400, { error: "Please provide a valid Solana mint address." });
  }
  if (isEvm && !isLikelyEvmAddress(mint)) {
    return sendJson(400, { error: "Please provide a valid EVM token address." });
  }

  try {
    const [dexData, holderCount, authorityInfo] = await Promise.all([
      fetchDexScreener(mint),
      isSolana ? fetchHolderCount(mint) : Promise.resolve(null),
      isSolana ? fetchHeliusMintAuthorities(mint) : Promise.resolve({ mintAuthority: null, freezeAuthority: null }),
    ]);

    const bestPair = pickBestPair(dexData?.pairs || []);
    const price = Number(bestPair?.priceUsd || 0);
    const marketCap = Number(bestPair?.fdv || bestPair?.marketCap || 0) || null;
    const dailyChange = Number(bestPair?.priceChange?.h24 || 0);
    const volume24h = Number(bestPair?.volume?.h24 || 0) || null;

    const risk = isSolana
      ? buildRiskSignals({
          bestPair,
          holdersCount: holderCount,
          mintAuthority: authorityInfo.mintAuthority,
          freezeAuthority: authorityInfo.freezeAuthority,
        })
      : buildRiskSignals({
          bestPair,
          holdersCount: null,
          mintAuthority: null,
          freezeAuthority: null,
        });

    return sendJson(200, {
      chain,
      mint,
      priceUsd: price,
      marketCapUsd: marketCap,
      dailyChangePercent: dailyChange,
      volume24hUsd: volume24h,
      holders: holderCount,
      mintAuthority: authorityInfo.mintAuthority,
      freezeAuthority: authorityInfo.freezeAuthority,
      dexPair: bestPair
        ? {
            dexId: bestPair.dexId,
            url: bestPair.url,
            liquidityUsd: Number(bestPair?.liquidity?.usd || 0),
            baseToken: bestPair.baseToken,
            quoteToken: bestPair.quoteToken,
          }
        : null,
      risk,
      sources: {
        dexScreener: true,
        holderScan: isSolana ? Boolean(HOLDERSCAN_API_KEY) : false,
        helius: isSolana ? Boolean(HELIUS_API_KEY) : false,
      },
    });
  } catch (error) {
    return sendJson(500, {
      error: "Failed to analyze this token right now.",
      details: error.message,
    });
  }
};
