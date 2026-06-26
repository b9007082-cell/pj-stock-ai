const stockNames = {
  2327: "國巨",
  6104: "創惟",
  3236: "千如",
  4973: "廣穎",
  6173: "信昌電",
  3530: "晶相光",
  2375: "凱美"
};

const scannerSymbols = ["6173", "3530", "2327", "3236", "2375", "6104", "4973"];
const storageKey = "pj-stock-ai-watchlist";

let currentAnalysis = null;
let deferredInstallPrompt = null;

const form = document.querySelector("#stockForm");
const input = document.querySelector("#tickerInput");
const quickList = document.querySelector(".quick-list");
const signalGrid = document.querySelector("#signalGrid");
const scannerList = document.querySelector("#scannerList");
const watchlist = document.querySelector("#watchlist");
const watchBtn = document.querySelector("#watchBtn");
const clearWatchBtn = document.querySelector("#clearWatchBtn");
const installBtn = document.querySelector("#installBtn");
const canvas = document.querySelector("#priceChart");
const ctx = canvas.getContext("2d");

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function stars(score) {
  if (!Number.isFinite(score)) return "資料不足";
  const count = clamp(Math.round(score / 20), 1, 5);
  return "★★★★★".slice(0, count) + "☆☆☆☆☆".slice(0, 5 - count);
}

function formatPrice(value) {
  if (!Number.isFinite(value)) return "--";
  return value >= 100 ? Number(value).toFixed(0) : Number(value).toFixed(2);
}

function movingAverage(values, days) {
  const segment = values.slice(-days);
  if (segment.length < days) return NaN;
  return segment.reduce((sum, value) => sum + value, 0) / segment.length;
}

function ema(values, days) {
  const weight = 2 / (days + 1);
  return values.reduce((average, value, index) => {
    if (index === 0) return value;
    return value * weight + average * (1 - weight);
  }, values[0] || 0);
}

async function fetchQuote(symbol) {
  const cleanSymbol = String(symbol).replace(/\D/g, "").slice(0, 6) || "2327";
  const isLocalServer = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  const forceStaticData = new URLSearchParams(window.location.search).has("static");
  const urls = isLocalServer && !forceStaticData
    ? [`/api/tw-stock/${cleanSymbol}`, `./data/stocks/${cleanSymbol}.json`]
    : [`./data/stocks/${cleanSymbol}.json`];
  const errors = [];

  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `行情資料讀取失敗 (${response.status})`);
      }
      return response.json();
    } catch (error) {
      errors.push(error.message);
    }
  }

  throw new Error(errors.at(-1) || "行情資料讀取失敗");
}

function analyze(quote) {
  const cleanSymbol = String(quote.symbol).replace(/\D/g, "").slice(0, 6);
  const prices = quote.prices || [];
  const closes = prices.map((item) => item.close).filter(Number.isFinite);
  const highs = prices.map((item) => item.high).filter(Number.isFinite);
  const lows = prices.map((item) => item.low).filter(Number.isFinite);
  const volumes = prices.map((item) => item.volume).filter(Number.isFinite);
  const lastClose = closes.at(-1);
  const livePrice = Number.isFinite(quote.regularMarketPrice) ? quote.regularMarketPrice : lastClose;
  const comparablePrices = prices.filter((item) => (
    Number.isFinite(item.close)
    && Number.isFinite(item.high)
    && Number.isFinite(item.low)
    && item.close > livePrice * 0.65
    && item.close < livePrice * 1.35
  ));
  const structurePrices = (comparablePrices.length >= 20 ? comparablePrices : prices).slice(-28);
  const structureHighs = structurePrices.map((item) => item.high).filter(Number.isFinite);
  const structureLows = structurePrices.map((item) => item.low).filter(Number.isFinite);
  const displayCandles = (comparablePrices.length >= 20 ? comparablePrices : prices)
    .slice(-60)
    .map((item) => item.close)
    .filter(Number.isFinite);
  const ma5 = movingAverage(closes, 5);
  const ma10 = movingAverage(closes, 10);
  const ma20 = movingAverage(closes, 20);
  const ma60 = movingAverage(closes, 60);
  const previous = closes.at(-8) || closes.at(-2) || lastClose;
  const recentHigh = Math.max(...structureHighs);
  const recentLow = Math.min(...structureLows);
  const priorHigh = Math.max(...highs.slice(-56, -28));
  const priorLow = Math.min(...lows.slice(-56, -28));
  const higherHigh = Number.isFinite(priorHigh) && recentHigh > priorHigh;
  const higherLow = Number.isFinite(priorLow) && recentLow > priorLow;
  const recentKHigh = Math.max(...highs.slice(-9));
  const recentKLow = Math.min(...lows.slice(-9));
  const rsv = recentKHigh === recentKLow ? 50 : ((lastClose - recentKLow) / (recentKHigh - recentKLow)) * 100;
  const kdK = clamp(rsv * 0.67 + 50 * 0.33, 0, 100);
  const kdD = clamp(kdK * 0.67 + 50 * 0.33, 0, 100);
  const ema12 = ema(closes.slice(-60), 12);
  const ema26 = ema(closes.slice(-60), 26);
  const macd = ema12 - ema26;
  const macdRed = macd > 0;
  const avgVolume5 = movingAverage(volumes, 5);
  const avgVolume20 = movingAverage(volumes, 20);
  const volumeUp = Number.isFinite(avgVolume5) && Number.isFinite(avgVolume20) && avgVolume5 > avgVolume20;
  const trendUp = livePrice > previous;
  const maBull = ma5 > ma10 && ma10 > ma20 && ma20 > ma60;
  const maImproving = ma5 > ma20;
  const trendScore = trendUp ? 18 : 8;
  const maScore = maBull ? 18 : maImproving ? 12 : 6;
  const structureScore = (higherHigh ? 12 : 5) + (higherLow ? 12 : 5);
  const kdScore = kdK > kdD && kdK >= 45 ? 15 : kdK >= 45 ? 10 : 5;
  const macdScore = macdRed ? 12 : 5;
  const volumeScore = volumeUp ? 12 : 7;
  const score = clamp(Math.round(trendScore + maScore + structureScore + kdScore + macdScore + volumeScore), 25, 99);
  const breakout = recentHigh * 1.01;
  const pullback = Number.isFinite(ma20) ? ma20 * 1.005 : lastClose * 0.97;
  const stop = Math.max(recentLow * 0.985, livePrice * 0.88);
  const target = breakout + (breakout - stop) * 0.8;
  const trendText = trendUp ? "多頭" : "震盪";
  const maText = maBull ? "5>10>20>60" : maImproving ? "短線轉強" : "尚未排列";
  const verdict = score >= 88 ? "可以布局" : score >= 74 ? "等待確認" : "先觀察";
  const name = stockNames[cleanSymbol] || quote.name || `台股 ${cleanSymbol}`;
  const dataLabel = quote.regularMarketTime
    ? new Date(quote.regularMarketTime).toLocaleString("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    : quote.dataDate;
  const actionText = score >= 88
    ? `條件偏強，可觀察 ${formatPrice(breakout)} 是否帶量突破，或等回測 ${formatPrice(pullback)} 附近量縮止跌。`
    : score >= 74
      ? `條件正在改善，但還需要突破 ${formatPrice(breakout)} 或回測不破 ${formatPrice(pullback)} 來確認。`
      : `目前勝率不足，先把 ${formatPrice(stop)} 當作轉弱線，等均線與量能同步轉強再評估。`;

  return {
    symbol: cleanSymbol,
    name,
    prices,
    candles: displayCandles,
    last: livePrice,
    lastClose,
    dataLabel,
    source: quote.source || "TWSE_STOCK_DAY",
    exchangeName: quote.exchangeName || "TWSE",
    score,
    verdict,
    trendText,
    maText,
    higherHigh,
    higherLow,
    kdK,
    kdD,
    macdRed,
    breakout,
    pullback,
    stop,
    target,
    signals: [
      ["趨勢", trendText, trendScore * 5],
      ["均線", maText, maScore * 5],
      ["頭頭高", higherHigh ? "是" : "否", higherHigh ? 92 : 52],
      ["底底高", higherLow ? "是" : "否", higherLow ? 90 : 50],
      ["KD", `${Math.round(kdK)} / ${Math.round(kdD)}`, kdScore * 6],
      ["MACD", macdRed ? "翻紅" : "整理", macdScore * 8],
      ["量能", volumeUp ? "量增" : "普通", volumeScore * 8],
      ["糾結度", Number.isFinite(ma20) ? `${Math.abs((ma5 - ma20) / ma20 * 100).toFixed(2)}%` : "--", maScore * 5]
    ],
    aiText: `${name}最新資料時間為 ${dataLabel}，價格 ${formatPrice(livePrice)}。目前${trendText === "多頭" ? "偏多" : "仍在震盪"}，均線狀態為${maText}，KD ${Math.round(kdK)} / ${Math.round(kdD)}，MACD ${macdRed ? "翻紅" : "尚未明確翻紅"}。${actionText}停損先看 ${formatPrice(stop)}，第一目標看 ${formatPrice(target)}。`
  };
}

function drawChart(analysis) {
  const candles = analysis.candles || [];
  const width = canvas.width;
  const height = canvas.height;
  const pad = 28;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#0c0f14";
  ctx.fillRect(0, 0, width, height);

  if (candles.length < 2) {
    ctx.fillStyle = "#a9b0b8";
    ctx.font = "700 24px system-ui";
    ctx.fillText("行情資料不足", pad, height / 2);
    return;
  }

  const max = Math.max(...candles, analysis.breakout) * 1.03;
  const min = Math.min(...candles, analysis.stop) * 0.97;

  ctx.strokeStyle = "#242a34";
  ctx.lineWidth = 1;
  for (let row = 1; row < 4; row += 1) {
    const y = pad + ((height - pad * 2) / 4) * row;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(width - pad, y);
    ctx.stroke();
  }

  const point = (price, index) => ({
    x: pad + (index / (candles.length - 1)) * (width - pad * 2),
    y: height - pad - ((price - min) / (max - min)) * (height - pad * 2)
  });

  ctx.beginPath();
  candles.forEach((price, index) => {
    const p = point(price, index);
    if (index === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.strokeStyle = analysis.score >= 74 ? "#3ecf8e" : "#f4b860";
  ctx.lineWidth = 4;
  ctx.stroke();

  [
    [analysis.breakout, "#67d4ff", "突破"],
    [analysis.pullback, "#f4b860", "回測"],
    [analysis.stop, "#ff6b6b", "停損"]
  ].forEach(([price, color, label]) => {
    if (!Number.isFinite(price)) return;
    const y = point(price, 0).y;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(width - pad, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.font = "700 20px system-ui";
    ctx.fillText(label, width - pad - 52, y - 8);
  });
}

function renderAnalysis(analysis) {
  currentAnalysis = analysis;
  input.value = analysis.symbol;
  document.querySelector("#stockName").textContent = `${analysis.name} ${analysis.symbol}`;
  document.querySelector("#scoreValue").textContent = analysis.score;
  document.querySelector("#scoreStars").textContent = stars(analysis.score);
  document.querySelector("#verdictBadge").textContent = analysis.verdict;
  document.querySelector("#verdictText").textContent = analysis.score >= 88 ? "多方條件集中，留意突破與回測買點。" : analysis.score >= 74 ? "條件接近成形，等待量價確認。" : "勝率不足，先等結構轉強。";
  document.querySelector("#chartTitle").textContent = `${analysis.name} ${analysis.symbol}`;
  document.querySelector("#chartMeta").textContent = `${analysis.exchangeName} 官方 · 收盤 ${formatPrice(analysis.last)} · ${analysis.dataLabel}`;
  document.querySelector("#breakoutBuy").textContent = formatPrice(analysis.breakout);
  document.querySelector("#pullbackBuy").textContent = formatPrice(analysis.pullback);
  document.querySelector("#stopLoss").textContent = formatPrice(analysis.stop);
  document.querySelector("#targetPrice").textContent = formatPrice(analysis.target);
  document.querySelector("#breakoutRank").textContent = stars(analysis.score);
  document.querySelector("#pullbackRank").textContent = stars(analysis.score - 8);
  document.querySelector("#aiText").textContent = analysis.aiText;

  signalGrid.innerHTML = analysis.signals.map(([label, value, score]) => `
    <article class="signal-card">
      <span>${label}</span>
      <strong>${value}</strong>
      <small>${stars(score)}</small>
    </article>
  `).join("");

  watchBtn.textContent = getWatchlist().includes(analysis.symbol) ? "已加入自選" : "加入自選";
  drawChart(analysis);
}

function renderLoading(symbol) {
  const cleanSymbol = String(symbol).replace(/\D/g, "").slice(0, 6) || "2327";
  input.value = cleanSymbol;
  document.querySelector("#stockName").textContent = `${stockNames[cleanSymbol] || "台股"} ${cleanSymbol}`;
  document.querySelector("#scoreValue").textContent = "--";
  document.querySelector("#scoreStars").textContent = "讀取中";
  document.querySelector("#verdictBadge").textContent = "讀取行情";
  document.querySelector("#verdictText").textContent = "正在抓取真實股價資料。";
  document.querySelector("#chartTitle").textContent = "行情讀取中";
  document.querySelector("#chartMeta").textContent = "不使用模擬價格";
  signalGrid.innerHTML = "";
}

function renderError(symbol, message) {
  const cleanSymbol = String(symbol).replace(/\D/g, "").slice(0, 6) || "2327";
  currentAnalysis = null;
  input.value = cleanSymbol;
  document.querySelector("#stockName").textContent = `${stockNames[cleanSymbol] || "台股"} ${cleanSymbol}`;
  document.querySelector("#scoreValue").textContent = "--";
  document.querySelector("#scoreStars").textContent = "無資料";
  document.querySelector("#verdictBadge").textContent = "資料失敗";
  document.querySelector("#verdictText").textContent = "行情 API 沒有回傳可用資料。";
  document.querySelector("#chartTitle").textContent = "無法取得行情";
  document.querySelector("#chartMeta").textContent = "不顯示模擬價格";
  document.querySelector("#breakoutBuy").textContent = "--";
  document.querySelector("#pullbackBuy").textContent = "--";
  document.querySelector("#stopLoss").textContent = "--";
  document.querySelector("#targetPrice").textContent = "--";
  document.querySelector("#aiText").textContent = `${cleanSymbol} 行情資料讀取失敗：${message}。我已停止使用假價格，請稍後重試或確認網路連線。`;
  signalGrid.innerHTML = `<article class="signal-card"><span>資料狀態</span><strong>讀取失敗</strong><small>未使用假資料</small></article>`;
  drawChart({ candles: [] });
}

async function loadAndRender(symbol) {
  const cleanSymbol = String(symbol).replace(/\D/g, "").slice(0, 6) || "2327";
  renderLoading(cleanSymbol);
  try {
    const quote = await fetchQuote(cleanSymbol);
    renderAnalysis(analyze(quote));
  } catch (error) {
    renderError(cleanSymbol, error.message);
  }
}

async function renderScanner() {
  scannerList.innerHTML = `<p class="empty">正在讀取今日排行...</p>`;
  const results = await Promise.all(scannerSymbols.map(async (symbol) => {
    try {
      return analyze(await fetchQuote(symbol));
    } catch {
      return null;
    }
  }));
  const analyses = results.filter(Boolean).sort((a, b) => b.score - a.score);

  if (!analyses.length) {
    scannerList.innerHTML = `<p class="empty">排行資料讀取失敗，未使用模擬排名。</p>`;
    return;
  }

  scannerList.innerHTML = analyses.map((item, index) => `
    <button class="scanner-row" type="button" data-symbol="${item.symbol}">
      <span class="scanner-rank">${index + 1}</span>
      <span>
        <strong>${item.name} ${item.symbol}</strong>
        <span>${item.verdict} · ${formatPrice(item.last)}</span>
      </span>
      <span class="scanner-score">${item.score}</span>
    </button>
  `).join("");
}

function getWatchlist() {
  try {
    return JSON.parse(localStorage.getItem(storageKey)) || [];
  } catch {
    return [];
  }
}

function setWatchlist(items) {
  localStorage.setItem(storageKey, JSON.stringify(items));
  renderWatchlist();
  if (currentAnalysis) {
    watchBtn.textContent = items.includes(currentAnalysis.symbol) ? "已加入自選" : "加入自選";
  }
}

function renderWatchlist() {
  const items = getWatchlist();
  if (!items.length) {
    watchlist.innerHTML = `<p class="empty">尚未加入自選股</p>`;
    return;
  }

  watchlist.innerHTML = items.map((symbol) => `
    <button class="watch-item" type="button" data-symbol="${symbol}">
      <span class="scanner-rank">--</span>
      <span>
        <strong>${stockNames[symbol] || "台股"} ${symbol}</strong>
        <span>點擊重新讀取行情</span>
      </span>
      <span class="scanner-score">讀取</span>
    </button>
  `).join("");
}

function activateTab(tabName) {
  document.querySelectorAll(".tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabName);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.remove("active"));
  document.querySelector(`#${tabName}Panel`).classList.add("active");
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  loadAndRender(input.value);
});

quickList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-symbol]");
  if (!button) return;
  loadAndRender(button.dataset.symbol);
});

document.querySelector(".tabs").addEventListener("click", (event) => {
  const button = event.target.closest("[data-tab]");
  if (!button) return;
  activateTab(button.dataset.tab);
});

scannerList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-symbol]");
  if (!button) return;
  loadAndRender(button.dataset.symbol);
  activateTab("signals");
  window.scrollTo({ top: 0, behavior: "smooth" });
});

watchlist.addEventListener("click", (event) => {
  const button = event.target.closest("[data-symbol]");
  if (!button) return;
  loadAndRender(button.dataset.symbol);
  window.scrollTo({ top: 0, behavior: "smooth" });
});

watchBtn.addEventListener("click", () => {
  if (!currentAnalysis) return;
  const items = getWatchlist();
  if (items.includes(currentAnalysis.symbol)) {
    setWatchlist(items.filter((symbol) => symbol !== currentAnalysis.symbol));
  } else {
    setWatchlist([currentAnalysis.symbol, ...items].slice(0, 12));
  }
});

clearWatchBtn.addEventListener("click", () => setWatchlist([]));

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installBtn.hidden = false;
});

installBtn.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then((registrations) => registrations.forEach((registration) => registration.unregister()))
    .catch(() => {});
}

renderScanner();
renderWatchlist();
loadAndRender(input.value);
