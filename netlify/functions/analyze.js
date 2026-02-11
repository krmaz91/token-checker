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
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input.trim());
}

function isLikelyEvmAddress(input) {
  if (!input) return false;
  return /^0x[a-fA-F0-9]{40}$/.test(input.trim());
}

function pickBestPair(pairs) {
  if (!Array.isArray(pairs) || pairs.length === 0) return null;
  return pairs.reduce((best, pair) => {
    const bestLiquidity = Number(best?.liquidity?.usd || 0);
    const pairLiquidity = Number(pair?.liquidity?.usd || 0);
    return pairLiquidity > bestLiquidity ? pair : best;
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
  return { label: score >= 4 ? "High" : score >= 2 ? "Medium" : "Low", signals };
}

function geckoNetworkFromChain(chain) {
  const map = {
    solana: "solana",
    ethereum: "eth",
    bsc: "bsc",
    base: "base",
    arbitrum: "arbitrum",
  };
  return map[chain] || null;
}

function decodeXml(text) {
  if (!text) return "";
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function firstMatch(source, pattern) {
  const match = source.match(pattern);
  return match ? decodeXml(match[1]).trim() : "";
}

function parseNewsRss(xml, maxItems = 6) {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  return items.slice(0, maxItems).map((item) => ({
    title: firstMatch(item, /<title>([\s\S]*?)<\/title>/i),
    url: firstMatch(item, /<link>([\s\S]*?)<\/link>/i),
    publishedAt: firstMatch(item, /<pubDate>([\s\S]*?)<\/pubDate>/i) || null,
    source: firstMatch(item, /<source[^>]*>([\s\S]*?)<\/source>/i) || "Unknown",
  }));
}

async function fetchDexScreener(mint) {
  const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
  if (!response.ok) throw new Error(`DexScreener error: ${response.status}`);
  return response.json();
}

async function fetchHolderCount(mint) {
  if (!HOLDERSCAN_API_KEY) return null;
  const response = await fetch(`https://api.holderscan.com/v0/sol/tokens/${mint}/holders?limit=1`, {
    headers: { "X-API-KEY": HOLDERSCAN_API_KEY },
  });
  if (!response.ok) throw new Error(`HolderScan error: ${response.status}`);
  const data = await response.json();
  if (typeof data?.holder_count === "number") return data.holder_count;
  if (typeof data?.total_holders === "number") return data.total_holders;
  if (typeof data?.total === "number") return data.total;
  return null;
}

async function fetchHeliusMintAuthorities(mint) {
  if (!HELIUS_API_KEY) return { mintAuthority: null, freezeAuthority: null };
  const response = await fetch(`https://rpc.helius.xyz/?api-key=${HELIUS_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "mint-info",
      method: "getAccountInfo",
      params: [mint, { encoding: "jsonParsed" }],
    }),
  });
  if (!response.ok) throw new Error(`Helius RPC error: ${response.status}`);
  const data = await response.json();
  const info = data?.result?.value?.data?.parsed?.info;
  return { mintAuthority: info?.mintAuthority ?? null, freezeAuthority: info?.freezeAuthority ?? null };
}

async function fetchEarliestSolanaActivity(mint) {
  if (!HELIUS_API_KEY) return null;
  const rpcUrl = `https://rpc.helius.xyz/?api-key=${HELIUS_API_KEY}`;
  let before = null;
  let oldest = null;

  for (let page = 0; page < 4; page += 1) {
    const params = [mint, { limit: 1000 }];
    if (before) params[1].before = before;

    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `sig-page-${page}`,
        method: "getSignaturesForAddress",
        params,
      }),
    });

    if (!response.ok) break;
    const data = await response.json();
    const rows = data?.result || [];
    if (!rows.length) break;

    oldest = rows[rows.length - 1];
    if (rows.length < 1000) break;
    before = oldest.signature;
  }

  return oldest?.blockTime ? new Date(oldest.blockTime * 1000).toISOString() : null;
}

async function fetchPoolVolumes(chain, pairAddress) {
  const network = geckoNetworkFromChain(chain);
  if (!network || !pairAddress) return { volume7dUsd: null, volume30dUsd: null, volatility7dPercent: null };

  const url = `https://api.geckoterminal.com/api/v2/networks/${network}/pools/${pairAddress}/ohlcv/day?limit=30`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) return { volume7dUsd: null, volume30dUsd: null, volatility7dPercent: null };

  const data = await response.json();
  const list = data?.data?.attributes?.ohlcv_list;
  if (!Array.isArray(list) || list.length === 0) {
    return { volume7dUsd: null, volume30dUsd: null, volatility7dPercent: null };
  }

  const volumeRows = list.map((row) => Number(Array.isArray(row) ? row[5] : 0)).filter((v) => Number.isFinite(v));
  const volatilityRows = list
    .slice(0, 7)
    .map((row) => {
      if (!Array.isArray(row)) return null;
      const open = Number(row[1]);
      const high = Number(row[2]);
      const low = Number(row[3]);
      if (!Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || open <= 0) return null;
      return ((high - low) / open) * 100;
    })
    .filter((v) => v !== null);
  const latest30 = volumeRows.slice(0, 30);
  const latest7 = latest30.slice(0, 7);

  return {
    volume7dUsd: latest7.reduce((sum, v) => sum + v, 0) || null,
    volume30dUsd: latest30.reduce((sum, v) => sum + v, 0) || null,
    volatility7dPercent:
      volatilityRows.length > 0 ? volatilityRows.reduce((sum, v) => sum + v, 0) / volatilityRows.length : null,
  };
}

async function fetchBitcoinMarket() {
  const url = "https://api.coingecko.com/api/v3/coins/bitcoin?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false";
  const response = await fetch(url);
  if (!response.ok) throw new Error(`CoinGecko error: ${response.status}`);
  return response.json();
}

async function fetchTokenNews({ chain, mint, symbol, name }) {
  const baseQuery = chain === "bitcoin" ? "Bitcoin OR BTC" : `${name || symbol || mint} ${symbol || ""}`.trim();
  const query = encodeURIComponent(`${baseQuery} crypto token`);
  const url = `https://news.google.com/rss/search?q=${query}+when:7d&hl=en-US&gl=US&ceid=US:en`;

  try {
    const response = await fetch(url, { headers: { Accept: "application/rss+xml" } });
    if (!response.ok) return [];
    const xml = await response.text();
    return parseNewsRss(xml, 6);
  } catch {
    return [];
  }
}

function buildChartUrls(bestPair) {
  if (!bestPair?.chainId || !bestPair?.pairAddress) return { dexUrl: null, embedUrl: null };
  const dexUrl = `https://dexscreener.com/${bestPair.chainId}/${bestPair.pairAddress}`;
  return { dexUrl, embedUrl: `${dexUrl}?embed=1&theme=light` };
}

function computePoolAgeDays(pairCreatedAt) {
  if (!pairCreatedAt) return null;
  const created = new Date(pairCreatedAt).getTime();
  if (!Number.isFinite(created)) return null;
  const diffMs = Date.now() - created;
  if (diffMs < 0) return 0;
  return diffMs / (1000 * 60 * 60 * 24);
}

function buildMarketSignals({ bestPair, marketCapUsd, volume24hUsd, volume7dUsd, volatility7dPercent }) {
  const txns = bestPair?.txns || {};
  const priceChange = bestPair?.priceChange || {};
  const liquidityUsd = Number(bestPair?.liquidity?.usd || 0) || null;
  const liquidityToMcapRatio = liquidityUsd && marketCapUsd ? liquidityUsd / marketCapUsd : null;
  const avgDailyVolume7dUsd = volume7dUsd ? volume7dUsd / 7 : null;
  const volumeTrend24hVs7dRatio =
    avgDailyVolume7dUsd && volume24hUsd ? volume24hUsd / avgDailyVolume7dUsd : null;

  return {
    txns: {
      m5: txns.m5 || null,
      h1: txns.h1 || null,
      h24: txns.h24 || null,
    },
    priceChangePercent: {
      m5: Number(priceChange.m5 ?? NaN),
      h1: Number(priceChange.h1 ?? NaN),
      h6: Number(priceChange.h6 ?? NaN),
      h24: Number(priceChange.h24 ?? NaN),
    },
    liquidityToMcapRatio,
    poolAgeDays: computePoolAgeDays(bestPair?.pairCreatedAt),
    avgDailyVolume7dUsd,
    volumeTrend24hVs7dRatio,
    volatility7dPercent,
  };
}

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const mint = (params.mint || "").trim();
  const chain = (params.chain || "solana").toLowerCase();

  if (chain === "bitcoin") {
    if (mint) {
      return sendJson(400, { error: "Bitcoin does not use token contracts. Leave the address empty to fetch BTC." });
    }

    try {
      const btc = await fetchBitcoinMarket();
      const market = btc?.market_data || {};
      const news = await fetchTokenNews({ chain, mint: "BTC", symbol: "BTC", name: "Bitcoin" });

      return sendJson(200, {
        chain,
        mint: "BTC",
        priceUsd: market?.current_price?.usd ?? null,
        marketCapUsd: market?.market_cap?.usd ?? null,
        dailyChangePercent: market?.price_change_percentage_24h ?? null,
        volume24hUsd: market?.total_volume?.usd ?? null,
        volume7dUsd: null,
        volume30dUsd: null,
        marketSignals: {
          txns: { m5: null, h1: null, h24: null },
          priceChangePercent: { m5: null, h1: null, h6: null, h24: market?.price_change_percentage_24h ?? null },
          liquidityToMcapRatio: null,
          poolAgeDays: null,
          avgDailyVolume7dUsd: null,
          volumeTrend24hVs7dRatio: null,
          volatility7dPercent: null,
        },
        firstMintedAt: btc?.genesis_date ? new Date(btc.genesis_date).toISOString() : null,
        holders: null,
        mintAuthority: null,
        freezeAuthority: null,
        dexPair: null,
        chart: { dexUrl: null, embedUrl: null },
        risk: { label: "Low", signals: [] },
        news,
        sources: { dexScreener: false, holderScan: false, helius: false, news: true },
      });
    } catch (error) {
      return sendJson(500, { error: "Failed to fetch BTC market data.", details: error.message });
    }
  }

  const isSolana = chain === "solana";
  const isEvm = ["ethereum", "base", "arbitrum", "bsc"].includes(chain);
  if (isSolana && !isLikelySolanaMint(mint)) return sendJson(400, { error: "Please provide a valid Solana mint address." });
  if (isEvm && !isLikelyEvmAddress(mint)) return sendJson(400, { error: "Please provide a valid EVM token address." });

  try {
    const [dexData, holderCount, authorityInfo] = await Promise.all([
      fetchDexScreener(mint),
      isSolana ? fetchHolderCount(mint) : Promise.resolve(null),
      isSolana ? fetchHeliusMintAuthorities(mint) : Promise.resolve({ mintAuthority: null, freezeAuthority: null }),
    ]);

    const bestPair = pickBestPair(dexData?.pairs || []);
    const volumes = await fetchPoolVolumes(chain, bestPair?.pairAddress);
    const marketCapUsd = Number(bestPair?.fdv || bestPair?.marketCap || 0) || null;
    const volume24hUsd = Number(bestPair?.volume?.h24 || 0) || null;
    const firstMintedAt = isSolana
      ? (await fetchEarliestSolanaActivity(mint)) || (bestPair?.pairCreatedAt ? new Date(bestPair.pairCreatedAt).toISOString() : null)
      : bestPair?.pairCreatedAt
        ? new Date(bestPair.pairCreatedAt).toISOString()
        : null;

    const tokenMeta = {
      symbol: bestPair?.baseToken?.symbol || null,
      name: bestPair?.baseToken?.name || null,
    };
    const news = await fetchTokenNews({ chain, mint, ...tokenMeta });

    const risk = isSolana
      ? buildRiskSignals({
          bestPair,
          holdersCount: holderCount,
          mintAuthority: authorityInfo.mintAuthority,
          freezeAuthority: authorityInfo.freezeAuthority,
        })
      : buildRiskSignals({ bestPair, holdersCount: null, mintAuthority: null, freezeAuthority: null });

    const chart = buildChartUrls(bestPair);

    const marketSignals = buildMarketSignals({
      bestPair,
      marketCapUsd,
      volume24hUsd,
      volume7dUsd: volumes.volume7dUsd,
      volatility7dPercent: volumes.volatility7dPercent,
    });

    return sendJson(200, {
      chain,
      mint,
      priceUsd: Number(bestPair?.priceUsd || 0),
      marketCapUsd,
      dailyChangePercent: Number(bestPair?.priceChange?.h24 || 0),
      volume24hUsd,
      volume7dUsd: volumes.volume7dUsd,
      volume30dUsd: volumes.volume30dUsd,
      marketSignals,
      firstMintedAt,
      holders: holderCount,
      mintAuthority: authorityInfo.mintAuthority,
      freezeAuthority: authorityInfo.freezeAuthority,
      dexPair: bestPair
        ? {
            dexId: bestPair.dexId,
            url: bestPair.url,
            chainId: bestPair.chainId,
            pairAddress: bestPair.pairAddress,
            liquidityUsd: Number(bestPair?.liquidity?.usd || 0),
            baseToken: bestPair.baseToken,
            quoteToken: bestPair.quoteToken,
          }
        : null,
      chart,
      risk,
      news,
      sources: {
        dexScreener: true,
        holderScan: isSolana ? Boolean(HOLDERSCAN_API_KEY) : false,
        helius: isSolana ? Boolean(HELIUS_API_KEY) : false,
        news: true,
      },
    });
  } catch (error) {
    return sendJson(500, { error: "Failed to analyze this token right now.", details: error.message });
  }
};
