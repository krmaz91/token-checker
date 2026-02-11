const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const HELIUS_API_KEY = process.env.HELIUS_API_KEY || "";
const HOLDERSCAN_API_KEY = process.env.HOLDERSCAN_API_KEY || "";
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
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
  const response = await fetch(`https://api.holderscan.com/v0/solana/tokens/${mint}/holders?limit=1`, {
    headers: { "X-API-KEY": HOLDERSCAN_API_KEY },
  });
  if (!response.ok) throw new Error(`HolderScan error: ${response.status}`);
  const data = await response.json();
  return typeof data?.total === "number" ? data.total : null;
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
  if (!network || !pairAddress) return { volume7dUsd: null, volume30dUsd: null };

  const url = `https://api.geckoterminal.com/api/v2/networks/${network}/pools/${pairAddress}/ohlcv/day?limit=30`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) return { volume7dUsd: null, volume30dUsd: null };

  const data = await response.json();
  const list = data?.data?.attributes?.ohlcv_list;
  if (!Array.isArray(list) || list.length === 0) {
    return { volume7dUsd: null, volume30dUsd: null };
  }

  const volumeRows = list.map((row) => Number(Array.isArray(row) ? row[5] : 0)).filter((v) => Number.isFinite(v));
  const latest30 = volumeRows.slice(0, 30);
  const latest7 = latest30.slice(0, 7);

  return {
    volume7dUsd: latest7.reduce((sum, v) => sum + v, 0) || null,
    volume30dUsd: latest30.reduce((sum, v) => sum + v, 0) || null,
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

async function analyzeToken(chain, mint) {
  if (chain === "bitcoin") {
    if (mint) {
      return { status: 400, body: { error: "Bitcoin does not use token contracts. Leave the address empty to fetch BTC." } };
    }

    const btc = await fetchBitcoinMarket();
    const market = btc?.market_data || {};
    const news = await fetchTokenNews({ chain, mint: "BTC", symbol: "BTC", name: "Bitcoin" });

    return {
      status: 200,
      body: {
        chain,
        mint: "BTC",
        priceUsd: market?.current_price?.usd ?? null,
        marketCapUsd: market?.market_cap?.usd ?? null,
        dailyChangePercent: market?.price_change_percentage_24h ?? null,
        volume24hUsd: market?.total_volume?.usd ?? null,
        volume7dUsd: null,
        volume30dUsd: null,
        firstMintedAt: btc?.genesis_date ? new Date(btc.genesis_date).toISOString() : null,
        holders: null,
        mintAuthority: null,
        freezeAuthority: null,
        dexPair: null,
        chart: { dexUrl: null, embedUrl: null },
        risk: { label: "Low", signals: [] },
        news,
        sources: { dexScreener: false, holderScan: false, helius: false, news: true },
      },
    };
  }

  const isSolana = chain === "solana";
  const isEvm = ["ethereum", "base", "arbitrum", "bsc"].includes(chain);
  if (isSolana && !isLikelySolanaMint(mint)) {
    return { status: 400, body: { error: "Please provide a valid Solana mint address." } };
  }
  if (isEvm && !isLikelyEvmAddress(mint)) {
    return { status: 400, body: { error: "Please provide a valid EVM token address." } };
  }

  const [dexData, holderCount, authorityInfo] = await Promise.all([
    fetchDexScreener(mint),
    isSolana ? fetchHolderCount(mint) : Promise.resolve(null),
    isSolana ? fetchHeliusMintAuthorities(mint) : Promise.resolve({ mintAuthority: null, freezeAuthority: null }),
  ]);

  const bestPair = pickBestPair(dexData?.pairs || []);
  const volumes = await fetchPoolVolumes(chain, bestPair?.pairAddress);
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

  return {
    status: 200,
    body: {
      chain,
      mint,
      priceUsd: Number(bestPair?.priceUsd || 0),
      marketCapUsd: Number(bestPair?.fdv || bestPair?.marketCap || 0) || null,
      dailyChangePercent: Number(bestPair?.priceChange?.h24 || 0),
      volume24hUsd: Number(bestPair?.volume?.h24 || 0) || null,
      volume7dUsd: volumes.volume7dUsd,
      volume30dUsd: volumes.volume30dUsd,
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
    },
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api/analyze") {
    try {
      const chain = (url.searchParams.get("chain") || "solana").toLowerCase();
      const mint = url.searchParams.get("mint")?.trim() || "";
      const output = await analyzeToken(chain, mint);
      return sendJson(res, output.status, output.body);
    } catch (error) {
      return sendJson(res, 500, { error: "Failed to analyze this token right now.", details: error.message });
    }
  }

  const filePath = url.pathname === "/" ? "/index.html" : url.pathname;
  const resolvedPath = path.join(PUBLIC_DIR, filePath);
  if (!resolvedPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(resolvedPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end("Not found");
    }
    const ext = path.extname(resolvedPath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Token analyzer running on http://localhost:${PORT}`);
});
