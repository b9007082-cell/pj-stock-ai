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
const geminiKeyStorageKey = "pj-stock-ai-gemini-key";
const dataVersion = "8111-history-1";

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
const positionForm = document.querySelector("#positionForm");
const buyDateInput = document.querySelector("#buyDateInput");
const buyPriceInput = document.querySelector("#buyPriceInput");
const positionStatus = document.querySelector("#positionStatus");
const positionResult = document.querySelector("#positionResult");
const geminiKeyInput = document.querySelector("#geminiKeyInput");
const saveGeminiKeyBtn = document.querySelector("#saveGeminiKeyBtn");
const clearGeminiKeyBtn = document.querySelector("#clearGeminiKeyBtn");
const googleAiBtn = document.querySelector("#googleAiBtn");
const googleAiStatus = document.querySelector("#googleAiStatus");
const googleAiResult = document.querySelector("#googleAiResult");
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

function formatPercent(value) {
  if (!Number.isFinite(value)) return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function getPriceZone(prices, livePrice) {
  const rangePrices = (prices || [])
    .slice(-120)
    .filter((item) => (
      Number.isFinite(item.high)
      && Number.isFinite(item.low)
      && Number.isFinite(item.close)
    ));

  if (rangePrices.length < 20 || !Number.isFinite(livePrice)) {
    return {
      label: "資料不足",
      percent: NaN,
      low: NaN,
      high: NaN,
      note: "行情天數不足，暫不判斷高低檔。"
    };
  }

  const rangeHigh = Math.max(...rangePrices.map((item) => item.high));
  const rangeLow = Math.min(...rangePrices.map((item) => item.low));
  const percent = rangeHigh === rangeLow
    ? 50
    : clamp(((livePrice - rangeLow) / (rangeHigh - rangeLow)) * 100, 0, 100);

  if (percent >= 75) {
    return {
      label: "高檔",
      percent,
      low: rangeLow,
      high: rangeHigh,
      note: "接近近期區間上緣，追價要保守，優先看突破是否有量。"
    };
  }

  if (percent <= 35) {
    return {
      label: "低檔",
      percent,
      low: rangeLow,
      high: rangeHigh,
      note: "接近近期區間下緣，適合觀察止跌，但要防守破底風險。"
    };
  }

  return {
    label: "中位",
    percent,
    low: rangeLow,
    high: rangeHigh,
    note: "位在近期區間中段，等方向表態比預設多空更重要。"
  };
}

function escapeHTML(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderPlainText(container, text) {
  container.innerHTML = escapeHTML(text)
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function getNextTradingDate(dateText) {
  if (!dateText) return "下一交易日";
  const date = new Date(`${dateText}T12:00:00+08:00`);
  if (Number.isNaN(date.getTime())) return "下一交易日";

  do {
    date.setDate(date.getDate() + 1);
  } while (date.getDay() === 0 || date.getDay() === 6);

  return date.toISOString().slice(0, 10);
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

function twseMonthList(monthCount = 7) {
  const now = new Date();
  const months = [];
  for (let index = 0; index < monthCount; index += 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    months.push(`${year}${month}01`);
  }
  return months;
}

function tpexMonthList(monthCount = 7) {
  const now = new Date();
  const months = [];
  for (let index = 0; index < monthCount; index += 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    months.push(`${year}/${month}/01`);
  }
  return months;
}

function parseOfficialNumber(value) {
  const clean = String(value || "").replace(/,/g, "").replace(/X/g, "").trim();
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseRocDate(rocDate) {
  const [rocYear, month, day] = String(rocDate || "").split("/").map(Number);
  if (!rocYear || !month || !day) return null;
  return `${rocYear + 1911}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseListedName(title, symbol) {
  const match = String(title || "").match(new RegExp(`${symbol}\\s+([^\\s]+)`));
  return match?.[1]?.trim() || symbol;
}

async function fetchOfficialJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`官方資料讀取失敗 (${response.status})`);
  return response.json();
}

function buildTwseQuote(symbol, payloads) {
  const okPayloads = payloads.filter((payload) => payload.stat === "OK" && Array.isArray(payload.data));
  const rows = okPayloads.flatMap((payload) => payload.data);
  const prices = rows
    .map((row) => ({
      date: parseRocDate(row[0]),
      volume: parseOfficialNumber(row[1]),
      open: parseOfficialNumber(row[3]),
      high: parseOfficialNumber(row[4]),
      low: parseOfficialNumber(row[5]),
      close: parseOfficialNumber(row[6])
    }))
    .filter((item) => item.date && Number.isFinite(item.close))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!prices.length) return null;

  const latest = prices.at(-1);
  const title = okPayloads.find((payload) => payload.title)?.title || "";
  return {
    symbol,
    source: "TWSE_STOCK_DAY",
    name: parseListedName(title, symbol),
    currency: "TWD",
    exchangeName: "TWSE",
    regularMarketPrice: latest.close,
    regularMarketTime: `${latest.date}T13:30:00+08:00`,
    dataDate: latest.date,
    prices
  };
}

function buildTpexQuote(symbol, payloads) {
  const rows = payloads.flatMap((payload) => payload.tables?.[0]?.data || []);
  const prices = rows
    .map((row) => ({
      date: parseRocDate(row[0]),
      volume: parseOfficialNumber(row[1]) ? parseOfficialNumber(row[1]) * 1000 : null,
      open: parseOfficialNumber(row[3]),
      high: parseOfficialNumber(row[4]),
      low: parseOfficialNumber(row[5]),
      close: parseOfficialNumber(row[6])
    }))
    .filter((item) => item.date && Number.isFinite(item.close))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!prices.length) return null;

  const latest = prices.at(-1);
  const subtitle = payloads.find((payload) => payload.tables?.[0]?.subtitle)?.tables?.[0]?.subtitle || "";
  return {
    symbol,
    source: "TPEX_TRADING_STOCK",
    name: parseListedName(subtitle, symbol),
    currency: "TWD",
    exchangeName: "TPEx",
    regularMarketPrice: latest.close,
    regularMarketTime: `${latest.date}T13:30:00+08:00`,
    dataDate: latest.date,
    prices
  };
}

async function fetchOfficialQuote(cleanSymbol) {
  const twsePayloads = await Promise.all(twseMonthList().map((date) => (
    fetchOfficialJson(`https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${date}&stockNo=${cleanSymbol}`)
  )));
  const twseQuote = buildTwseQuote(cleanSymbol, twsePayloads);
  if (twseQuote) return twseQuote;

  const tpexPayloads = await Promise.all(tpexMonthList().map((date) => (
    fetchOfficialJson(`https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock?code=${cleanSymbol}&date=${date}&response=json`)
  )));
  const tpexQuote = buildTpexQuote(cleanSymbol, tpexPayloads);
  if (tpexQuote) return tpexQuote;

  throw new Error("TWSE/TPEx 查無日成交資料");
}

async function fetchLatestMarketQuote(cleanSymbol) {
  const response = await fetch(`./data/latest.json?v=${dataVersion}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`最新行情索引讀取失敗 (${response.status})`);
  const payload = await response.json();
  const item = payload.stocks?.find((stock) => stock.symbol === cleanSymbol);
  if (!item) throw new Error("最新行情索引查無此代號");

  const close = Number(item.regularMarketPrice);
  const price = {
    date: item.dataDate,
    volume: Number(item.volume),
    open: Number(item.open),
    high: Number(item.high),
    low: Number(item.low),
    close
  };

  return {
    symbol: item.symbol,
    source: item.source,
    name: item.name,
    currency: "TWD",
    exchangeName: item.exchangeName,
    regularMarketPrice: close,
    regularMarketTime: `${item.dataDate}T13:30:00+08:00`,
    dataDate: item.dataDate,
    prices: [price].filter((row) => row.date && Number.isFinite(row.close))
  };
}

async function fetchQuote(symbol) {
  const cleanSymbol = String(symbol).replace(/\D/g, "").slice(0, 6) || "2327";
  const isLocalServer = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  const forceStaticData = new URLSearchParams(window.location.search).has("static");
  const staticUrl = `./data/stocks/${cleanSymbol}.json?v=${dataVersion}`;
  const apiUrl = `/api/tw-stock/${cleanSymbol}`;
  const urls = isLocalServer
    ? (forceStaticData ? [staticUrl, apiUrl] : [apiUrl, staticUrl])
    : [staticUrl];
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

  try {
    return await fetchOfficialQuote(cleanSymbol);
  } catch (error) {
    errors.push(error.message);
  }

  try {
    return await fetchLatestMarketQuote(cleanSymbol);
  } catch (error) {
    errors.push(error.message);
  }

  if (!isLocalServer) {
    throw new Error(`無法取得 ${cleanSymbol} 資料。靜態檔不存在，且瀏覽器直接讀官方 API 失敗：${errors.at(-1)}`);
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
  const priceZone = getPriceZone(comparablePrices.length >= 20 ? comparablePrices : prices, livePrice);
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
    nextTradingDate: getNextTradingDate(quote.dataDate),
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
    priceZone,
    breakout,
    pullback,
    stop,
    target,
    signals: [
      ["趨勢", trendText, trendScore * 5],
      ["均線", maText, maScore * 5],
      ["頭頭高", higherHigh ? "是" : "否", higherHigh ? 92 : 52],
      ["底底高", higherLow ? "是" : "否", higherLow ? 90 : 50],
      ["高低檔", priceZone.label, Number.isFinite(priceZone.percent) ? priceZone.percent : NaN],
      ["KD", `${Math.round(kdK)} / ${Math.round(kdD)}`, kdScore * 6],
      ["MACD", macdRed ? "翻紅" : "整理", macdScore * 8],
      ["量能", volumeUp ? "量增" : "普通", volumeScore * 8],
      ["糾結度", Number.isFinite(ma20) ? `${Math.abs((ma5 - ma20) / ma20 * 100).toFixed(2)}%` : "--", maScore * 5]
    ],
    aiText: `${name}最新資料時間為 ${dataLabel}，價格 ${formatPrice(livePrice)}。目前${trendText === "多頭" ? "偏多" : "仍在震盪"}，股價位置屬於${priceZone.label}${Number.isFinite(priceZone.percent) ? `（區間 ${priceZone.percent.toFixed(0)}%）` : ""}，${priceZone.note} 均線狀態為${maText}，KD ${Math.round(kdK)} / ${Math.round(kdD)}，MACD ${macdRed ? "翻紅" : "尚未明確翻紅"}。${actionText}停損先看 ${formatPrice(stop)}，第一目標看 ${formatPrice(target)}。`
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
  document.querySelector("#verdictText").textContent = `${analysis.priceZone.label} · ${analysis.score >= 88 ? "多方條件集中，留意突破與回測買點。" : analysis.score >= 74 ? "條件接近成形，等待量價確認。" : "勝率不足，先等結構轉強。"}`;
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
  updatePositionStrategy();
  updateGoogleAiStatus();
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
  updatePositionStrategy();
  updateGoogleAiStatus();
}

function buildTomorrowStrategy(analysis, buyDate, buyPrice) {
  const profitPercent = ((analysis.last - buyPrice) / buyPrice) * 100;
  const riskPercent = ((analysis.stop - analysis.last) / analysis.last) * 100;
  const resistancePercent = ((analysis.breakout - analysis.last) / analysis.last) * 100;
  const nextTradingText = analysis.nextTradingDate || "下一交易日";
  const foundBuyDay = analysis.prices.find((item) => item.date === buyDate);
  const buyDayText = foundBuyDay
    ? `買進日收盤 ${formatPrice(foundBuyDay.close)}`
    : "買進日不在目前資料區間";
  let action = "續抱觀察";
  let tone = "目前不急著動作，明天先看關鍵價位。";

  if (analysis.last <= analysis.stop || profitPercent <= -8) {
    action = "優先控風險";
    tone = `若 ${nextTradingText} 跌破 ${formatPrice(analysis.stop)}，先減碼或停損，不要凹單。`;
  } else if (profitPercent >= 12 && resistancePercent <= 3) {
    action = "靠近壓力分批落袋";
    tone = `已獲利 ${formatPercent(profitPercent)}，又接近突破壓力 ${formatPrice(analysis.breakout)}，${nextTradingText} 若上攻無量可先分批賣一部分。`;
  } else if (analysis.score >= 88 && analysis.last > buyPrice) {
    action = "偏多續抱";
    tone = `趨勢分數仍強，${nextTradingText} 不跌破 ${formatPrice(analysis.pullback)} 可續抱；突破 ${formatPrice(analysis.breakout)} 且有量再考慮加碼。`;
  } else if (analysis.score >= 74) {
    action = "等確認";
    tone = `條件還可以，但不要追高。${nextTradingText} 站上 ${formatPrice(analysis.breakout)} 才轉強，跌破 ${formatPrice(analysis.pullback)} 要保守。`;
  } else {
    action = "降低持股";
    tone = `目前分數偏弱，${nextTradingText} 若反彈無法站回 ${formatPrice(analysis.pullback)}，建議降低持股。`;
  }

  return {
    action,
    html: `
      <p><strong>${analysis.name} ${analysis.symbol}</strong>，買進價 ${formatPrice(buyPrice)}，目前收盤 ${formatPrice(analysis.last)}，損益 ${formatPercent(profitPercent)}。</p>
      <p>${buyDayText}。目前屬於<strong>${analysis.priceZone.label}</strong>，${analysis.priceZone.note} ${nextTradingText} 策略：<strong>${action}</strong>。${tone}</p>
      <p>關鍵價位：壓力 ${formatPrice(analysis.breakout)}，回測 ${formatPrice(analysis.pullback)}，防守 ${formatPrice(analysis.stop)}。目前離防守價 ${formatPercent(riskPercent)}，離突破價 ${formatPercent(resistancePercent)}。</p>
    `
  };
}

function updatePositionStrategy() {
  if (!positionResult || !positionStatus) return;

  const buyDate = buyDateInput.value;
  const buyPrice = Number(buyPriceInput.value);

  if (!currentAnalysis) {
    positionStatus.textContent = "無行情";
    positionResult.innerHTML = "<p>目前沒有可用行情，先不要產生策略。</p>";
    return;
  }

  if (!buyDate || !Number.isFinite(buyPrice) || buyPrice <= 0) {
    positionStatus.textContent = "未輸入";
    positionResult.innerHTML = "<p>輸入買進日期與買進價後，會依照目前官方收盤資料產生下一交易日策略。</p>";
    return;
  }

  const strategy = buildTomorrowStrategy(currentAnalysis, buyDate, buyPrice);
  positionStatus.textContent = strategy.action;
  positionResult.innerHTML = strategy.html;
}

function getGeminiKey() {
  return (geminiKeyInput?.value || localStorage.getItem(geminiKeyStorageKey) || "").trim();
}

function updateGoogleAiStatus(message) {
  if (!googleAiStatus || !googleAiResult) return;
  const hasKey = Boolean(getGeminiKey());
  googleAiStatus.textContent = message || (hasKey ? "已啟用" : "未啟用");
}

function saveGeminiKey() {
  const key = (geminiKeyInput.value || "").trim();
  if (!key) {
    updateGoogleAiStatus("缺少 Key");
    renderPlainText(googleAiResult, "請先貼上 Gemini API Key，再按儲存。");
    return;
  }
  localStorage.setItem(geminiKeyStorageKey, key);
  updateGoogleAiStatus("已儲存");
  renderPlainText(googleAiResult, "Gemini API Key 已儲存在這台瀏覽器。GitHub 不會看到你的 Key。");
}

function clearGeminiKey() {
  localStorage.removeItem(geminiKeyStorageKey);
  geminiKeyInput.value = "";
  updateGoogleAiStatus("已清除");
  renderPlainText(googleAiResult, "已清除這台瀏覽器中的 Gemini API Key。");
}

function buildGoogleAiPrompt(analysis, buyDate, buyPrice) {
  const profitPercent = Number.isFinite(buyPrice) && buyPrice > 0
    ? ((analysis.last - buyPrice) / buyPrice) * 100
    : null;
  const builtInStrategy = Number.isFinite(buyPrice) && buyPrice > 0 && buyDate
    ? buildTomorrowStrategy(analysis, buyDate, buyPrice).action
    : "尚未輸入持股成本";

  return `
你是台股短線策略助理，請用繁體中文回答。請只根據以下資料做風險控管與下一交易日策略整理，不要保證漲跌，不要鼓吹重倉，不要說自己能預測未來。

股票：${analysis.name} ${analysis.symbol}
資料來源：${analysis.exchangeName} ${analysis.source}
最新資料時間：${analysis.dataLabel}
下一交易日：${analysis.nextTradingDate}
目前價格：${formatPrice(analysis.last)}
PJ Score：${analysis.score}
系統判斷：${analysis.verdict}
股價位置：${analysis.priceZone.label}${Number.isFinite(analysis.priceZone.percent) ? `，位於近 120 日區間約 ${analysis.priceZone.percent.toFixed(0)}%` : ""}
高低檔提醒：${analysis.priceZone.note}
趨勢：${analysis.trendText}
均線：${analysis.maText}
KD：${Math.round(analysis.kdK)} / ${Math.round(analysis.kdD)}
MACD：${analysis.macdRed ? "翻紅" : "整理"}
壓力：${formatPrice(analysis.breakout)}
回測：${formatPrice(analysis.pullback)}
防守：${formatPrice(analysis.stop)}
目標：${formatPrice(analysis.target)}
買進日期：${buyDate || "未輸入"}
買進價：${Number.isFinite(buyPrice) && buyPrice > 0 ? formatPrice(buyPrice) : "未輸入"}
目前損益：${Number.isFinite(profitPercent) ? formatPercent(profitPercent) : "未輸入"}
內建策略：${builtInStrategy}

請輸出：
1. 下一交易日開盤前策略
2. 盤中觀察價位
3. 停損或減碼條件
4. 若轉強，怎麼加碼或續抱
5. 一句最重要提醒

每點最多 80 字，務必完整寫完 1 到 5 點；回答要務實、保守、有條件式。`.trim();
}

async function callGemini(prompt, apiKey) {
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature: 0.25,
        maxOutputTokens: 2048
      }
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error?.message || `Google AI 回應失敗 (${response.status})`;
    throw new Error(message);
  }

  const candidate = payload.candidates?.[0];
  const text = candidate?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();
  if (!text) throw new Error("Google AI 沒有回傳文字內容");
  if (candidate.finishReason === "MAX_TOKENS") {
    return `${text}\n\n提醒：Google AI 回覆被長度限制截斷，請再按一次「用 Google AI 分析」重新產生。`;
  }
  return text;
}

async function generateGoogleAiStrategy() {
  if (!currentAnalysis) {
    updateGoogleAiStatus("無行情");
    renderPlainText(googleAiResult, "目前沒有可用行情，先查詢股票後再使用 Google AI。");
    return;
  }

  const apiKey = getGeminiKey();
  if (!apiKey) {
    updateGoogleAiStatus("缺少 Key");
    renderPlainText(googleAiResult, "請先貼上 Gemini API Key。Key 只會存在你的瀏覽器 localStorage，不會放到 GitHub。");
    return;
  }

  const buyDate = buyDateInput.value;
  const buyPrice = Number(buyPriceInput.value);
  if (!buyDate || !Number.isFinite(buyPrice) || buyPrice <= 0) {
    updateGoogleAiStatus("缺少持股");
    renderPlainText(googleAiResult, "請先輸入買進日期與買進價，Google AI 才能依照你的持股狀態分析策略。");
    return;
  }

  googleAiBtn.disabled = true;
  updateGoogleAiStatus("分析中");
  renderPlainText(googleAiResult, "Google AI 正在整理策略...");

  try {
    const prompt = buildGoogleAiPrompt(currentAnalysis, buyDate, buyPrice);
    const text = await callGemini(prompt, apiKey);
    updateGoogleAiStatus("完成");
    renderPlainText(googleAiResult, text);
  } catch (error) {
    updateGoogleAiStatus("失敗");
    renderPlainText(googleAiResult, `Google AI 分析失敗：${error.message}`);
  } finally {
    googleAiBtn.disabled = false;
  }
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

positionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  updatePositionStrategy();
});

buyDateInput.addEventListener("change", updatePositionStrategy);
buyPriceInput.addEventListener("input", updatePositionStrategy);

if (geminiKeyInput) {
  geminiKeyInput.value = localStorage.getItem(geminiKeyStorageKey) || "";
  geminiKeyInput.addEventListener("input", () => updateGoogleAiStatus());
}

saveGeminiKeyBtn?.addEventListener("click", saveGeminiKey);
clearGeminiKeyBtn?.addEventListener("click", clearGeminiKey);
googleAiBtn?.addEventListener("click", generateGoogleAiStrategy);

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
updateGoogleAiStatus();
loadAndRender(input.value);
