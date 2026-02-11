const form = document.getElementById("lookup-form");
const input = document.getElementById("mint-input");
const chainSelect = document.getElementById("chain-select");
const results = document.getElementById("results");
const statusEl = document.getElementById("status");

const tokenTitle = document.getElementById("token-title");
const tokenMint = document.getElementById("token-mint");
const marketCap = document.getElementById("market-cap");
const dailyChange = document.getElementById("daily-change");
const volume24h = document.getElementById("volume-24h");
const liquidity = document.getElementById("liquidity");
const volume7d = document.getElementById("volume-7d");
const volume30d = document.getElementById("volume-30d");
const firstMinted = document.getElementById("first-minted");
const txns5m = document.getElementById("txns-5m");
const txns1h = document.getElementById("txns-1h");
const txns24h = document.getElementById("txns-24h");
const price5m = document.getElementById("price-5m");
const price1h = document.getElementById("price-1h");
const price6h = document.getElementById("price-6h");
const price24h = document.getElementById("price-24h");
const liqMcapRatio = document.getElementById("liq-mcap-ratio");
const poolAge = document.getElementById("pool-age");
const volumeTrend = document.getElementById("volume-trend");
const volatility7d = document.getElementById("volatility-7d");
const authorities = document.getElementById("authorities");
const dexPair = document.getElementById("dex-pair");
const riskBadge = document.getElementById("risk-badge");
const riskList = document.getElementById("risk-list");
const riskNote = document.getElementById("risk-note");
const newsList = document.getElementById("news-list");
const chartFrame = document.getElementById("dex-chart");
const chartLink = document.getElementById("chart-link");
const demoBtn = document.getElementById("demo-btn");

function updatePlaceholder() {
  const chain = chainSelect.value;
  if (chain === "solana") {
    input.placeholder = "Paste Solana mint address";
  } else if (chain === "bitcoin") {
    input.placeholder = "Leave empty for BTC";
  } else {
    input.placeholder = "Paste token contract address (0x...)";
  }
}

function formatCurrency(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  const normalized = Number(value);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: normalized < 1 ? 6 : 2,
  }).format(normalized);
}

function formatNumber(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat("en-US").format(Number(value));
}

function formatPercent(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  const normalized = Number(value);
  const sign = normalized > 0 ? "+" : "";
  return `${sign}${normalized.toFixed(2)}%`;
}

function formatMultiplier(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return `${Number(value).toFixed(2)}x`;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#c0432d" : "";
}

function renderNews(items) {
  newsList.innerHTML = "";

  if (!Array.isArray(items) || items.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No recent token-specific headlines found.";
    newsList.appendChild(li);
    return;
  }

  items.forEach((item) => {
    const li = document.createElement("li");
    const source = item.source || "Unknown";
    const when = item.publishedAt ? new Date(item.publishedAt).toLocaleDateString("en-US") : "";

    if (item.url) {
      const link = document.createElement("a");
      link.href = item.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = item.title || "Read article";
      li.appendChild(link);
    } else {
      li.textContent = item.title || "Untitled article";
    }

    const meta = document.createElement("p");
    meta.className = "muted";
    meta.textContent = when ? `${source} • ${when}` : source;
    li.appendChild(meta);
    newsList.appendChild(li);
  });
}

function renderResult(data) {
  const marketSignals = data.marketSignals || {};
  tokenTitle.textContent = data?.dexPair?.baseToken?.symbol || (data.chain === "bitcoin" ? "Bitcoin" : "Token summary");
  tokenMint.textContent = data.mint;

  marketCap.textContent = formatCurrency(data.marketCapUsd);
  dailyChange.textContent = formatPercent(data.dailyChangePercent);
  volume24h.textContent = formatCurrency(data.volume24hUsd);
  liquidity.textContent = data.dexPair ? formatCurrency(data.dexPair.liquidityUsd) : "—";
  volume7d.textContent = formatCurrency(data.volume7dUsd);
  volume30d.textContent = formatCurrency(data.volume30dUsd);
  firstMinted.textContent = formatDate(data.firstMintedAt);
  txns5m.textContent = marketSignals.txns
    ? `${formatNumber(marketSignals.txns.m5?.buys)} / ${formatNumber(marketSignals.txns.m5?.sells)}`
    : "—";
  txns1h.textContent = marketSignals.txns
    ? `${formatNumber(marketSignals.txns.h1?.buys)} / ${formatNumber(marketSignals.txns.h1?.sells)}`
    : "—";
  txns24h.textContent = marketSignals.txns
    ? `${formatNumber(marketSignals.txns.h24?.buys)} / ${formatNumber(marketSignals.txns.h24?.sells)}`
    : "—";
  price5m.textContent = marketSignals.priceChangePercent ? formatPercent(marketSignals.priceChangePercent.m5) : "—";
  price1h.textContent = marketSignals.priceChangePercent ? formatPercent(marketSignals.priceChangePercent.h1) : "—";
  price6h.textContent = marketSignals.priceChangePercent ? formatPercent(marketSignals.priceChangePercent.h6) : "—";
  price24h.textContent = marketSignals.priceChangePercent ? formatPercent(marketSignals.priceChangePercent.h24) : "—";
  liqMcapRatio.textContent = formatPercent(
    marketSignals.liquidityToMcapRatio === null ? null : marketSignals.liquidityToMcapRatio * 100
  );
  poolAge.textContent =
    marketSignals.poolAgeDays === null || Number.isNaN(marketSignals.poolAgeDays)
      ? "—"
      : `${marketSignals.poolAgeDays.toFixed(1)} days`;
  volumeTrend.textContent = formatMultiplier(marketSignals.volumeTrend24hVs7dRatio);
  volatility7d.textContent = formatPercent(marketSignals.volatility7dPercent);

  const mintAuth = data.mintAuthority ? "Enabled" : "Disabled";
  const freezeAuth = data.freezeAuthority ? "Enabled" : "Disabled";
  if (data.chain !== "solana") {
    authorities.textContent = "Not applicable for this chain";
  } else {
    authorities.textContent =
      data.mintAuthority === null && data.freezeAuthority === null
        ? "Unavailable"
        : `Mint: ${mintAuth} • Freeze: ${freezeAuth}`;
  }

  dexPair.textContent = data.dexPair
    ? `${data.dexPair.dexId} (${data.dexPair.baseToken?.symbol}/${data.dexPair.quoteToken?.symbol})`
    : "No active pair found";

  riskBadge.textContent = `Risk: ${data.risk.label}`;
  riskBadge.style.background =
    data.risk.label === "High" ? "#ffd2c6" : data.risk.label === "Medium" ? "#ffe9c7" : "#dff5e7";
  riskBadge.style.color = data.risk.label === "Low" ? "#256d3b" : "#9b3c21";

  riskList.innerHTML = "";
  if (data.risk.signals.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No major risk signals detected from the available data.";
    riskList.appendChild(li);
  } else {
    data.risk.signals.forEach((signal) => {
      const li = document.createElement("li");
      li.textContent = `${signal.level.toUpperCase()}: ${signal.message}`;
      riskList.appendChild(li);
    });
  }

  if (data.chart?.embedUrl) {
    chartFrame.src = data.chart.embedUrl;
    chartLink.href = data.chart.dexUrl || "#";
    chartLink.textContent = "Open on DexScreener";
  } else {
    chartFrame.src = "about:blank";
    chartLink.href = "#";
    chartLink.textContent = "Live chart unavailable for this asset";
  }

  renderNews(data.news || []);

  riskNote.textContent = "Risk score is based on currently available market and on-chain data.";

  results.classList.remove("hidden");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const mint = input.value.trim();
  const chain = chainSelect.value;
  if (chain !== "bitcoin" && !mint) return;

  setStatus("Analyzing token...", false);
  results.classList.add("hidden");

  try {
    const response = await fetch(`/api/analyze?chain=${encodeURIComponent(chain)}&mint=${encodeURIComponent(mint)}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Something went wrong");
    }

    renderResult(data);
    setStatus("Analysis complete.");
  } catch (error) {
    setStatus(error.message || "Failed to analyze token.", true);
  }
});

demoBtn.addEventListener("click", () => {
  input.value = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  chainSelect.value = "solana";
  form.requestSubmit();
});

chainSelect.addEventListener("change", updatePlaceholder);
updatePlaceholder();
