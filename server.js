import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'assets.json');
const DEFAULT_PROVIDER = 'binance';
const DEFAULT_QUOTE = 'USDT';
const STATS_PERIODS = {
  '1d': { interval: '1h', limit: 24 },
  '1w': { interval: '4h', limit: 42 },
  '1m': { interval: '1d', limit: 30 },
  '1y': { interval: '1w', limit: 52 }
};

let symbolCache = {
  loadedAt: 0,
  symbols: []
};

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

async function ensureDataFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, '{\n  "assets": [],\n  "buyTargets": []\n}\n', 'utf8');
  }
}

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeBaseSymbol(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function normalizeExchange(value) {
  return String(value || '').trim();
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function symbolFromBase(baseSymbol, quoteSymbol = DEFAULT_QUOTE) {
  return `${baseSymbol}${quoteSymbol}`;
}

function normalizeStatsPeriod(value) {
  return STATS_PERIODS[value] ? value : '1d';
}

function cleanPurchase(input, existingId = null) {
  const amount = toNumber(input.amount);
  const price = toNumber(input.price);
  const date = String(input.date || '').trim();
  const exchange = normalizeExchange(input.exchange);

  if (amount === null || amount <= 0) {
    return { error: 'Amount must be greater than zero.' };
  }

  if (price === null || price <= 0) {
    return { error: 'Entry price must be greater than zero.' };
  }

  if (!date) {
    return { error: 'Purchase date is required.' };
  }

  return {
    purchase: {
      id: existingId || makeId('purchase'),
      amount,
      price,
      date,
      exchange
    }
  };
}

function cleanBuyTarget(input, existingId = null) {
  const baseSymbol = normalizeBaseSymbol(input.baseSymbol || input.symbol);
  const quoteSymbol = DEFAULT_QUOTE;
  const buyFrom = toNumber(input.buyFrom);
  const buyTo = toNumber(input.buyTo);

  if (!baseSymbol) {
    return { error: 'Token is required.' };
  }

  if (buyFrom === null || buyFrom < 0 || buyTo === null || buyTo < 0 || buyFrom > buyTo) {
    return { error: 'Enter a valid buy range.' };
  }

  return {
    target: {
      id: existingId || makeId(`target-${baseSymbol.toLowerCase()}`),
      baseSymbol,
      quoteSymbol,
      symbol: symbolFromBase(baseSymbol, quoteSymbol),
      provider: DEFAULT_PROVIDER,
      buyFrom,
      buyTo
    }
  };
}

function migrateData(parsed) {
  if (Array.isArray(parsed)) {
    return {
      assets: parsed.map((asset) => ({
        id: asset.id || makeId(normalizeBaseSymbol(asset.baseSymbol || asset.symbol).toLowerCase() || 'asset'),
        baseSymbol: normalizeBaseSymbol(asset.baseSymbol || String(asset.symbol || '').replace(DEFAULT_QUOTE, '')),
        quoteSymbol: asset.quoteSymbol || DEFAULT_QUOTE,
        symbol: asset.symbol || symbolFromBase(normalizeBaseSymbol(asset.baseSymbol), asset.quoteSymbol || DEFAULT_QUOTE),
        provider: asset.provider || DEFAULT_PROVIDER,
        purchases: Array.isArray(asset.purchases) ? asset.purchases.map((purchase) => ({
          id: purchase.id || makeId('purchase'),
          amount: Number(purchase.amount || 0),
          price: Number(purchase.price || 0),
          date: purchase.date || '',
          exchange: purchase.exchange || ''
        })) : []
      })),
      buyTargets: parsed
        .filter((asset) => asset.buyFrom !== undefined && asset.buyTo !== undefined)
        .map((asset) => {
          const baseSymbol = normalizeBaseSymbol(asset.baseSymbol || String(asset.symbol || '').replace(DEFAULT_QUOTE, ''));
          return {
            id: makeId(`target-${baseSymbol.toLowerCase()}`),
            baseSymbol,
            quoteSymbol: asset.quoteSymbol || DEFAULT_QUOTE,
            symbol: asset.symbol || symbolFromBase(baseSymbol, asset.quoteSymbol || DEFAULT_QUOTE),
            provider: asset.provider || DEFAULT_PROVIDER,
            buyFrom: Number(asset.buyFrom || 0),
            buyTo: Number(asset.buyTo || 0)
          };
        })
    };
  }

  return {
    assets: Array.isArray(parsed?.assets) ? parsed.assets : [],
    buyTargets: Array.isArray(parsed?.buyTargets) ? parsed.buyTargets : []
  };
}

async function readData() {
  await ensureDataFile();
  const raw = await fs.readFile(DATA_FILE, 'utf8');

  try {
    return migrateData(JSON.parse(raw));
  } catch {
    return { assets: [], buyTargets: [] };
  }
}

async function writeData(data) {
  await ensureDataFile();
  await fs.writeFile(DATA_FILE, `${JSON.stringify({
    assets: data.assets || [],
    buyTargets: data.buyTargets || []
  }, null, 2)}\n`, 'utf8');
}

async function fetchBinancePrices(symbols) {
  const uniqueSymbols = [...new Set(symbols.filter(Boolean))];

  if (!uniqueSymbols.length) {
    return {};
  }

  const prices = {};

  await Promise.all(uniqueSymbols.map(async (symbol) => {
    const url = `https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`;
    const response = await fetch(url);

    if (!response.ok) {
      prices[symbol] = {
        price: null,
        error: response.status === 400
          ? 'Token not found on Binance Spot.'
          : `Binance API error: ${response.status}`
      };
      return;
    }

    const item = await response.json();
    const price = Number(item.price);
    prices[symbol] = {
      price: Number.isFinite(price) ? price : null,
      error: Number.isFinite(price) ? null : 'Token not found on Binance Spot.'
    };
  }));

  return prices;
}

async function fetchBinanceSymbols() {
  const cacheTtlMs = 60 * 60 * 1000;

  if (Date.now() - symbolCache.loadedAt < cacheTtlMs && symbolCache.symbols.length) {
    return symbolCache.symbols;
  }

  const response = await fetch('https://api.binance.com/api/v3/exchangeInfo');

  if (!response.ok) {
    throw new Error(`Binance API error: ${response.status}`);
  }

  const data = await response.json();
  const symbols = (Array.isArray(data.symbols) ? data.symbols : [])
    .filter((item) => item.status === 'TRADING' && item.quoteAsset === DEFAULT_QUOTE && item.isSpotTradingAllowed !== false)
    .map((item) => ({
      baseSymbol: item.baseAsset,
      quoteSymbol: item.quoteAsset,
      symbol: item.symbol,
      provider: DEFAULT_PROVIDER
    }))
    .sort((a, b) => a.baseSymbol.localeCompare(b.baseSymbol));

  symbolCache = {
    loadedAt: Date.now(),
    symbols
  };

  return symbols;
}

async function fetchBinancePriceStats(symbols, period) {
  const uniqueSymbols = [...new Set(symbols.filter(Boolean))];
  const config = STATS_PERIODS[normalizeStatsPeriod(period)];

  if (!uniqueSymbols.length) {
    return {};
  }

  const stats = {};

  await Promise.all(uniqueSymbols.map(async (symbol) => {
    const params = new URLSearchParams({
      symbol,
      interval: config.interval,
      limit: String(config.limit)
    });
    const response = await fetch(`https://api.binance.com/api/v3/klines?${params.toString()}`);

    if (!response.ok) {
      stats[symbol] = {
        low: null,
        high: null,
        error: response.status === 400
          ? 'Token not found on Binance Spot.'
          : `Binance API error: ${response.status}`
      };
      return;
    }

    const klines = await response.json();
    const lows = [];
    const highs = [];

    for (const kline of Array.isArray(klines) ? klines : []) {
      const high = Number(kline[2]);
      const low = Number(kline[3]);

      if (Number.isFinite(high)) {
        highs.push(high);
      }

      if (Number.isFinite(low)) {
        lows.push(low);
      }
    }

    stats[symbol] = lows.length && highs.length
      ? {
        low: Math.min(...lows),
        high: Math.max(...highs),
        error: null
      }
      : {
        low: null,
        high: null,
        error: 'Price range is not available.'
      };
  }));

  return stats;
}

app.get('/api/assets', async (req, res) => {
  const data = await readData();
  res.json({ assets: data.assets });
});

app.post('/api/assets', async (req, res) => {
  const data = await readData();
  const baseSymbol = normalizeBaseSymbol(req.body.baseSymbol || req.body.symbol);

  if (!baseSymbol) {
    res.status(400).json({ error: 'Token is required.' });
    return;
  }

  const purchaseResult = cleanPurchase(req.body);

  if (purchaseResult.error) {
    res.status(400).json({ error: purchaseResult.error });
    return;
  }

  const symbol = symbolFromBase(baseSymbol);
  let asset = data.assets.find((item) => item.symbol === symbol);
  let status = 200;

  if (!asset) {
    asset = {
      id: makeId(baseSymbol.toLowerCase()),
      baseSymbol,
      quoteSymbol: DEFAULT_QUOTE,
      symbol,
      provider: DEFAULT_PROVIDER,
      purchases: []
    };
    data.assets.push(asset);
    status = 201;
  }

  asset.purchases.push(purchaseResult.purchase);
  await writeData(data);
  res.status(status).json({ asset });
});

app.delete('/api/assets/:id', async (req, res) => {
  const data = await readData();
  const nextAssets = data.assets.filter((asset) => asset.id !== req.params.id);

  if (nextAssets.length === data.assets.length) {
    res.status(404).json({ error: 'Asset not found.' });
    return;
  }

  data.assets = nextAssets;
  await writeData(data);
  res.json({ ok: true });
});

app.post('/api/assets/:id/purchases', async (req, res) => {
  const data = await readData();
  const asset = data.assets.find((item) => item.id === req.params.id);

  if (!asset) {
    res.status(404).json({ error: 'Asset not found.' });
    return;
  }

  const result = cleanPurchase(req.body);

  if (result.error) {
    res.status(400).json({ error: result.error });
    return;
  }

  asset.purchases.push(result.purchase);
  await writeData(data);
  res.status(201).json({ purchase: result.purchase });
});

app.put('/api/assets/:id/purchases/:purchaseId', async (req, res) => {
  const data = await readData();
  const asset = data.assets.find((item) => item.id === req.params.id);

  if (!asset) {
    res.status(404).json({ error: 'Asset not found.' });
    return;
  }

  const purchaseIndex = asset.purchases.findIndex((item) => item.id === req.params.purchaseId);

  if (purchaseIndex === -1) {
    res.status(404).json({ error: 'Purchase not found.' });
    return;
  }

  const result = cleanPurchase(req.body, req.params.purchaseId);

  if (result.error) {
    res.status(400).json({ error: result.error });
    return;
  }

  asset.purchases[purchaseIndex] = result.purchase;
  await writeData(data);
  res.json({ purchase: result.purchase });
});

app.delete('/api/assets/:id/purchases/:purchaseId', async (req, res) => {
  const data = await readData();
  const asset = data.assets.find((item) => item.id === req.params.id);

  if (!asset) {
    res.status(404).json({ error: 'Asset not found.' });
    return;
  }

  const purchases = asset.purchases.filter((purchase) => purchase.id !== req.params.purchaseId);

  if (purchases.length === asset.purchases.length) {
    res.status(404).json({ error: 'Purchase not found.' });
    return;
  }

  asset.purchases = purchases;
  await writeData(data);
  res.json({ ok: true });
});

app.get('/api/buy-targets', async (req, res) => {
  const data = await readData();
  res.json({ buyTargets: data.buyTargets });
});

app.post('/api/buy-targets', async (req, res) => {
  const data = await readData();
  const result = cleanBuyTarget(req.body);

  if (result.error) {
    res.status(400).json({ error: result.error });
    return;
  }

  const existingIndex = data.buyTargets.findIndex((target) => target.symbol === result.target.symbol);
  const status = existingIndex === -1 ? 201 : 200;

  if (existingIndex === -1) {
    data.buyTargets.push(result.target);
  } else {
    data.buyTargets[existingIndex] = {
      ...result.target,
      id: data.buyTargets[existingIndex].id
    };
  }

  await writeData(data);
  res.status(status).json({ buyTarget: existingIndex === -1 ? result.target : data.buyTargets[existingIndex] });
});

app.put('/api/buy-targets/:id', async (req, res) => {
  const data = await readData();
  const targetIndex = data.buyTargets.findIndex((target) => target.id === req.params.id);

  if (targetIndex === -1) {
    res.status(404).json({ error: 'Buy target not found.' });
    return;
  }

  const result = cleanBuyTarget({
    ...req.body,
    baseSymbol: data.buyTargets[targetIndex].baseSymbol
  }, req.params.id);

  if (result.error) {
    res.status(400).json({ error: result.error });
    return;
  }

  data.buyTargets[targetIndex] = result.target;
  await writeData(data);
  res.json({ buyTarget: result.target });
});

app.delete('/api/buy-targets/:id', async (req, res) => {
  const data = await readData();
  const nextTargets = data.buyTargets.filter((target) => target.id !== req.params.id);

  if (nextTargets.length === data.buyTargets.length) {
    res.status(404).json({ error: 'Buy target not found.' });
    return;
  }

  data.buyTargets = nextTargets;
  await writeData(data);
  res.json({ ok: true });
});

app.get('/api/symbols', async (req, res) => {
  const query = normalizeBaseSymbol(req.query.q).slice(0, 20);

  try {
    const symbols = await fetchBinanceSymbols();
    const filtered = query
      ? symbols.filter((item) => item.baseSymbol.includes(query) || item.symbol.includes(query))
      : symbols;

    res.json({ provider: DEFAULT_PROVIDER, quoteSymbol: DEFAULT_QUOTE, symbols: filtered.slice(0, 20) });
  } catch (error) {
    res.status(502).json({ error: 'Could not load Binance token list.', details: error.message });
  }
});

app.get('/api/prices', async (req, res) => {
  const data = await readData();
  const symbols = [
    ...data.assets.map((asset) => asset.symbol),
    ...data.buyTargets.map((target) => target.symbol)
  ];

  try {
    const prices = await fetchBinancePrices(symbols);
    const result = {};

    for (const symbol of symbols) {
      result[symbol] = prices[symbol] || {
        price: null,
        error: 'Token not found on Binance Spot.'
      };
    }

    res.json({ provider: DEFAULT_PROVIDER, quoteSymbol: DEFAULT_QUOTE, prices: result });
  } catch (error) {
    res.status(502).json({ error: 'Could not load prices from Binance.', details: error.message });
  }
});

app.get('/api/price-stats', async (req, res) => {
  const data = await readData();
  const period = normalizeStatsPeriod(req.query.period);
  const symbols = data.buyTargets.map((target) => target.symbol);

  try {
    const stats = await fetchBinancePriceStats(symbols, period);
    const result = {};

    for (const symbol of symbols) {
      result[symbol] = stats[symbol] || {
        low: null,
        high: null,
        error: 'Price range is not available.'
      };
    }

    res.json({
      provider: DEFAULT_PROVIDER,
      quoteSymbol: DEFAULT_QUOTE,
      period,
      stats: result
    });
  } catch (error) {
    res.status(502).json({ error: 'Could not load price range from Binance.', details: error.message });
  }
});

app.listen(PORT, async () => {
  await ensureDataFile();
  console.log(`Token Monitoring: http://localhost:${PORT}`);
});
