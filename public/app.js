const form = document.getElementById("lookup-form");
const input = document.getElementById("mint-input");
const chainSelect = document.getElementById("chain-select");
const results = document.getElementById("results");
const statusEl = document.getElementById("status");

const tokenTitle = document.getElementById("token-title");
const tokenMint = document.getElementById("token-mint");
const marketCap = document.getElementById("market-cap");
const dailyChange = document.getElementById("daily-change");
const holders = document.getElementById("holders");
const liquidity = document.getElementById("liquidity");
const authorities = document.getElementById("authorities");
const dexPair = document.getElementById("dex-pair");
const riskBadge = document.getElementById("risk-badge");
const riskList = document.getElementById("risk-list");
const riskNote = document.getElementById("risk-note");
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
  if (value === null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value < 1 ? 6 : 2,
  }).format(value);
}

function formatNumber(value) {
  if (value === null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US").format(value);
}

function formatPercent(value) {
  if (value === null || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#c0432d" : "";
}

function renderResult(data) {
  tokenTitle.textContent = data?.dexPair?.baseToken?.symbol || "Token summary";
  tokenMint.textContent = data.mint;

  marketCap.textContent = formatCurrency(data.marketCapUsd);
  dailyChange.textContent = formatPercent(data.dailyChangePercent);
  holders.textContent = data.holders === null ? "Requires HolderScan API" : formatNumber(data.holders);
  liquidity.textContent = data.dexPair ? formatCurrency(data.dexPair.liquidityUsd) : "—";

  const mintAuth = data.mintAuthority ? "Enabled" : "Disabled";
  const freezeAuth = data.freezeAuthority ? "Enabled" : "Disabled";
  if (data.chain !== "solana") {
    authorities.textContent = "Not applicable for this chain";
  } else {
    authorities.textContent =
      data.mintAuthority === null && data.freezeAuthority === null
        ? "Requires Helius API"
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

  const sourceNotes = [];
  if (data.chain === "solana") {
    if (!data.sources.holderScan) sourceNotes.push("holder count");
    if (!data.sources.helius) sourceNotes.push("mint/freeze authority");
  }
  riskNote.textContent = sourceNotes.length
    ? `Missing ${sourceNotes.join(" & ")} data. Add API keys to improve accuracy.`
    : "All data sources are active.";

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
    const response = await fetch(
      `/api/analyze?chain=${encodeURIComponent(chain)}&mint=${encodeURIComponent(mint)}`
    );
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
