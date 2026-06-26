const fs = require('fs/promises');
const path = require('path');

const seedSymbols = ['6173', '3530', '2327', '2330', '3236', '2375', '6104', '4973', '8043'];
const outputDir = path.join(__dirname, '..', 'public', 'pj-stock-ai', 'data', 'stocks');
const includeAllTpex = process.env.PJ_STOCK_ALL_TPEX === '1';
const includeAllTwse = process.env.PJ_STOCK_ALL_TWSE === '1';
const maxTpexSymbols = Number(process.env.PJ_STOCK_MAX_TPEX || 0);
const maxTwseSymbols = Number(process.env.PJ_STOCK_MAX_TWSE || 0);
const batchSize = Number(process.env.PJ_STOCK_BATCH_SIZE || 4);

function normalizeTaiwanSymbol(symbol) {
  return String(symbol || '').replace(/\D/g, '').slice(0, 6);
}

function twseMonthList(monthCount = 7) {
  const now = new Date();
  const months = [];
  for (let index = 0; index < monthCount; index += 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
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
    const month = String(date.getMonth() + 1).padStart(2, '0');
    months.push(`${year}/${month}/01`);
  }
  return months;
}

function parseNumber(value) {
  const clean = String(value || '').replace(/,/g, '').replace(/X/g, '').trim();
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseRocDate(rocDate) {
  const [rocYear, month, day] = String(rocDate || '').split('/').map(Number);
  if (!rocYear || !month || !day) return null;
  return `${rocYear + 1911}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseListedName(title, symbol) {
  const match = String(title || '').match(new RegExp(`${symbol}\\s+([^\\s]+)`));
  return match?.[1]?.trim() || symbol;
}

async function fetchJson(url) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'PJ Stock AI GitHub Data Updater'
        }
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return response.json();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError;
}

async function fetchTwseMonth(symbol, date) {
  const url = `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${date}&stockNo=${symbol}`;
  return fetchJson(url);
}

async function fetchTpexMonth(symbol, date) {
  const url = `https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock?code=${symbol}&date=${date}&response=json`;
  return fetchJson(url);
}

async function fetchTpexStockList() {
  const rows = await fetchJson('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes');
  const stocks = rows
    .map((row) => ({
      symbol: normalizeTaiwanSymbol(row.SecuritiesCompanyCode),
      name: String(row.CompanyName || '').trim(),
      close: parseNumber(row.Close)
    }))
    .filter((row) => /^[0-9]{4}$/.test(row.symbol) && Number.isFinite(row.close))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  return maxTpexSymbols > 0 ? stocks.slice(0, maxTpexSymbols) : stocks;
}

async function fetchTwseStockList() {
  const rows = await fetchJson('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL');
  const stocks = rows
    .map((row) => ({
      symbol: normalizeTaiwanSymbol(row.Code),
      name: String(row.Name || '').trim(),
      close: parseNumber(row.ClosingPrice)
    }))
    .filter((row) => /^[0-9]{4}$/.test(row.symbol) && Number.isFinite(row.close))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  return maxTwseSymbols > 0 ? stocks.slice(0, maxTwseSymbols) : stocks;
}

function buildTwseQuote(symbol, payloads) {
  const okPayloads = payloads.filter((payload) => payload.stat === 'OK' && Array.isArray(payload.data));
  const rows = okPayloads.flatMap((payload) => payload.data);
  const prices = rows
    .map((row) => ({
      date: parseRocDate(row[0]),
      volume: parseNumber(row[1]),
      open: parseNumber(row[3]),
      high: parseNumber(row[4]),
      low: parseNumber(row[5]),
      close: parseNumber(row[6])
    }))
    .filter((item) => item.date && Number.isFinite(item.close))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!prices.length) return null;

  const latest = prices.at(-1);
  const title = okPayloads.find((payload) => payload.title)?.title || '';
  return {
    symbol,
    source: 'TWSE_STOCK_DAY',
    name: parseListedName(title, symbol),
    currency: 'TWD',
    exchangeName: 'TWSE',
    regularMarketPrice: latest.close,
    regularMarketTime: `${latest.date}T13:30:00+08:00`,
    dataDate: latest.date,
    generatedAt: new Date().toISOString(),
    prices
  };
}

function buildTpexQuote(symbol, payloads) {
  const rows = payloads.flatMap((payload) => payload.tables?.[0]?.data || []);
  const prices = rows
    .map((row) => ({
      date: parseRocDate(row[0]),
      volume: parseNumber(row[1]) ? parseNumber(row[1]) * 1000 : null,
      open: parseNumber(row[3]),
      high: parseNumber(row[4]),
      low: parseNumber(row[5]),
      close: parseNumber(row[6])
    }))
    .filter((item) => item.date && Number.isFinite(item.close))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!prices.length) return null;

  const latest = prices.at(-1);
  const subtitle = payloads.find((payload) => payload.tables?.[0]?.subtitle)?.tables?.[0]?.subtitle || '';
  return {
    symbol,
    source: 'TPEX_TRADING_STOCK',
    name: parseListedName(subtitle, symbol),
    currency: 'TWD',
    exchangeName: 'TPEx',
    regularMarketPrice: latest.close,
    regularMarketTime: `${latest.date}T13:30:00+08:00`,
    dataDate: latest.date,
    generatedAt: new Date().toISOString(),
    prices
  };
}

async function fetchOfficialQuote(rawSymbol, exchangeHint = '') {
  const symbol = normalizeTaiwanSymbol(rawSymbol);
  if (!symbol) throw new Error('股票代號格式錯誤');

  if (exchangeHint !== 'TPEx') {
    const twsePayloads = await Promise.all(twseMonthList().map((date) => fetchTwseMonth(symbol, date)));
    const twseQuote = buildTwseQuote(symbol, twsePayloads);
    if (twseQuote) return twseQuote;
  }

  if (exchangeHint !== 'TWSE') {
    const tpexPayloads = await Promise.all(tpexMonthList().map((date) => fetchTpexMonth(symbol, date)));
    const tpexQuote = buildTpexQuote(symbol, tpexPayloads);
    if (tpexQuote) return tpexQuote;
  }

  throw new Error('TWSE/TPEx 查無日成交資料');
}

async function buildSymbolTargets() {
  const targets = new Map(seedSymbols.map((symbol) => [symbol, { symbol, exchangeHint: '' }]));

  if (includeAllTwse) {
    const twseStocks = await fetchTwseStockList();
    for (const stock of twseStocks) {
      targets.set(stock.symbol, { symbol: stock.symbol, exchangeHint: 'TWSE', name: stock.name });
    }
    console.log(`loaded ${twseStocks.length} TWSE stock symbols`);
  }

  if (includeAllTpex) {
    const tpexStocks = await fetchTpexStockList();
    for (const stock of tpexStocks) {
      targets.set(stock.symbol, { symbol: stock.symbol, exchangeHint: 'TPEx', name: stock.name });
    }
    console.log(`loaded ${tpexStocks.length} TPEx stock symbols`);
  }

  return Array.from(targets.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
}

async function runInBatches(items, worker, size) {
  const results = [];
  for (let index = 0; index < items.length; index += size) {
    const batch = items.slice(index, index + size);
    results.push(...await Promise.all(batch.map(worker)));
  }
  return results;
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  const index = [];
  const targets = await buildSymbolTargets();

  await runInBatches(targets, async (target) => {
    try {
      const quote = await fetchOfficialQuote(target.symbol, target.exchangeHint);
      await fs.writeFile(
        path.join(outputDir, `${target.symbol}.json`),
        `${JSON.stringify(quote, null, 2)}\n`,
        'utf8'
      );
      index.push({
        symbol: target.symbol,
        name: quote.name,
        source: quote.source,
        exchangeName: quote.exchangeName,
        dataDate: quote.dataDate,
        regularMarketPrice: quote.regularMarketPrice
      });
      console.log(`updated ${target.symbol} ${quote.name} ${quote.exchangeName} ${quote.dataDate}`);
    } catch (error) {
      console.error(`failed ${target.symbol}: ${error.message}`);
    }
  }, batchSize);

  index.sort((a, b) => a.symbol.localeCompare(b.symbol));

  await fs.writeFile(
    path.join(outputDir, '..', 'index.json'),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), stocks: index }, null, 2)}\n`,
    'utf8'
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
