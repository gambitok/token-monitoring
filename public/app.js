const state = {
  assets: [],
  buyTargets: [],
  prices: {},
  openAssetId: null,
  activeTab: 'portfolio',
  assetSort: {
    key: 'currentValue',
    direction: 'desc'
  }
};

const els = {
  assetForm: document.querySelector('#assetForm'),
  targetForm: document.querySelector('#targetForm'),
  activeTargetsSection: document.querySelector('#activeTargetsSection'),
  activeTargetsGrid: document.querySelector('#activeTargetsGrid'),
  assetsBody: document.querySelector('#assetsBody'),
  targetsGrid: document.querySelector('#targetsGrid'),
  emptyAssets: document.querySelector('#emptyAssets'),
  emptyTargets: document.querySelector('#emptyTargets'),
  message: document.querySelector('#message'),
  refreshPrices: document.querySelector('#refreshPrices'),
  totalInvested: document.querySelector('#totalInvested'),
  totalValue: document.querySelector('#totalValue'),
  totalPnl: document.querySelector('#totalPnl'),
  lastUpdated: document.querySelector('#lastUpdated'),
  detailsTemplate: document.querySelector('#detailsTemplate'),
  tokenSuggestions: document.querySelector('#tokenSuggestions'),
  targetTokenSuggestions: document.querySelector('#targetTokenSuggestions'),
  sortButtons: document.querySelectorAll('.sort-button'),
  tabs: document.querySelectorAll('.tab'),
  tabPanels: document.querySelectorAll('.tab-panel')
};

let symbolSearchTimer = null;
let targetSymbolSearchTimer = null;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function formatNumber(value, digits = 2) {
  if (!Number.isFinite(value)) {
    return '-';
  }

  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  }).format(value);
}

function formatMoney(value) {
  return `${formatNumber(value, 2)} USDT`;
}

function getFormPayload(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function setMessage(text, tone = 'neutral') {
  els.message.textContent = text || '';
  els.message.className = `message ${tone}`;
}

function fillPurchaseForm(form, purchase) {
  form.elements.amount.value = purchase.amount ?? '';
  form.elements.price.value = purchase.price ?? '';
  form.elements.date.value = purchase.date || today();
  form.elements.exchange.value = purchase.exchange || '';
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Request failed.');
  }

  return data;
}

function calculateAsset(asset) {
  const purchases = Array.isArray(asset.purchases) ? asset.purchases : [];
  const totalAmount = purchases.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const totalInvested = purchases.reduce((sum, item) => sum + Number(item.amount || 0) * Number(item.price || 0), 0);
  const averageEntryPrice = totalAmount > 0 ? totalInvested / totalAmount : 0;
  const priceInfo = state.prices[asset.symbol] || {};
  const currentPrice = Number(priceInfo.price);
  const hasPrice = Number.isFinite(currentPrice);
  const currentValue = hasPrice ? totalAmount * currentPrice : null;
  const pnl = hasPrice ? currentValue - totalInvested : null;
  const pnlPercent = hasPrice && totalInvested > 0 ? (pnl / totalInvested) * 100 : null;

  return {
    totalAmount,
    totalInvested,
    averageEntryPrice,
    currentPrice,
    hasPrice,
    currentValue,
    pnl,
    pnlPercent,
    priceError: priceInfo.error
  };
}

function calculateTarget(target) {
  const priceInfo = state.prices[target.symbol] || {};
  const currentPrice = Number(priceInfo.price);
  const hasPrice = Number.isFinite(currentPrice);
  const canBuy = hasPrice && currentPrice >= Number(target.buyFrom) && currentPrice <= Number(target.buyTo);

  return {
    currentPrice,
    hasPrice,
    canBuy,
    priceError: priceInfo.error
  };
}

function getAssetSortValue(asset, calc, key) {
  const values = {
    token: asset.baseSymbol,
    amount: calc.totalAmount,
    averageEntry: calc.averageEntryPrice,
    currentPrice: calc.hasPrice ? calc.currentPrice : null,
    invested: calc.totalInvested,
    currentValue: calc.currentValue,
    pnl: calc.pnl
  };

  return values[key];
}

function compareAssetValues(aValue, bValue) {
  if (typeof aValue === 'string' || typeof bValue === 'string') {
    return String(aValue || '').localeCompare(String(bValue || ''), 'en');
  }

  const aMissing = aValue === null || aValue === undefined || Number.isNaN(aValue);
  const bMissing = bValue === null || bValue === undefined || Number.isNaN(bValue);

  if (aMissing && bMissing) {
    return 0;
  }

  if (aMissing) {
    return 1;
  }

  if (bMissing) {
    return -1;
  }

  return Number(aValue) - Number(bValue);
}

function getSortedAssets() {
  const { key, direction } = state.assetSort;
  const multiplier = direction === 'asc' ? 1 : -1;

  return state.assets
    .map((asset, index) => ({
      asset,
      index,
      calc: calculateAsset(asset)
    }))
    .sort((a, b) => {
      const result = compareAssetValues(
        getAssetSortValue(a.asset, a.calc, key),
        getAssetSortValue(b.asset, b.calc, key)
      );

      return result === 0 ? a.index - b.index : result * multiplier;
    });
}

function renderSortButtons() {
  for (const button of els.sortButtons) {
    const isActive = button.dataset.sort === state.assetSort.key;
    const indicator = button.querySelector('span');

    button.classList.toggle('active', isActive);
    indicator.textContent = isActive
      ? state.assetSort.direction === 'asc' ? '↑' : '↓'
      : '';
  }
}

function renderSummary() {
  const totals = state.assets.reduce((acc, asset) => {
    const calc = calculateAsset(asset);
    acc.invested += calc.totalInvested;
    if (calc.hasPrice) {
      acc.value += calc.currentValue;
    }
    return acc;
  }, { invested: 0, value: 0 });

  const pnl = totals.value - totals.invested;
  const pnlPercent = totals.invested > 0 ? (pnl / totals.invested) * 100 : 0;

  els.totalInvested.textContent = formatMoney(totals.invested);
  els.totalValue.textContent = formatMoney(totals.value);
  els.totalPnl.textContent = `${formatMoney(pnl)} (${formatNumber(pnlPercent, 2)}%)`;
  els.totalPnl.className = pnl >= 0 ? 'positive' : 'negative';
}

function renderAssets() {
  els.assetsBody.innerHTML = '';
  els.emptyAssets.style.display = state.assets.length ? 'none' : 'block';
  renderSortButtons();

  for (const item of getSortedAssets()) {
    const { asset, calc } = item;
    const row = document.createElement('tr');
    const pnlClass = calc.pnl === null || calc.pnl >= 0 ? 'positive' : 'negative';

    row.innerHTML = `
      <td>
        <div class="symbol">${asset.baseSymbol}</div>
        <div class="subtle">${asset.symbol}</div>
      </td>
      <td>${formatNumber(calc.totalAmount, 8)}</td>
      <td>${formatMoney(calc.averageEntryPrice)}</td>
      <td>${calc.hasPrice ? formatMoney(calc.currentPrice) : '-'}</td>
      <td>${formatMoney(calc.totalInvested)}</td>
      <td>${calc.currentValue === null ? '-' : formatMoney(calc.currentValue)}</td>
      <td class="${pnlClass}">
        ${calc.pnl === null ? '-' : `${formatMoney(calc.pnl)} (${formatNumber(calc.pnlPercent, 2)}%)`}
      </td>
      <td><button class="button small details-toggle" type="button">${state.openAssetId === asset.id ? 'Hide' : 'Details'}</button></td>
    `;

    row.querySelector('.details-toggle').addEventListener('click', () => {
      state.openAssetId = state.openAssetId === asset.id ? null : asset.id;
      render();
    });

    els.assetsBody.append(row);

    if (state.openAssetId === asset.id) {
      els.assetsBody.append(renderDetails(asset));
    }
  }
}

function renderDetails(asset) {
  const fragment = els.detailsTemplate.content.cloneNode(true);
  const row = fragment.querySelector('.details-row');
  const purchaseForm = fragment.querySelector('.purchase-form');
  const purchases = fragment.querySelector('.purchases');

  purchaseForm.elements.date.value = today();

  purchaseForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    try {
      await api(`/api/assets/${asset.id}/purchases`, {
        method: 'POST',
        body: JSON.stringify(getFormPayload(purchaseForm))
      });
      purchaseForm.reset();
      purchaseForm.elements.date.value = today();
      setMessage('Purchase added.');
      await loadAll();
    } catch (error) {
      setMessage(error.message, 'negative');
    }
  });

  fragment.querySelector('.delete-asset').addEventListener('click', async () => {
    if (!confirm(`Delete ${asset.symbol} and all its purchases?`)) {
      return;
    }

    try {
      await api(`/api/assets/${asset.id}`, { method: 'DELETE' });
      state.openAssetId = null;
      setMessage('Asset deleted.');
      await loadAll();
    } catch (error) {
      setMessage(error.message, 'negative');
    }
  });

  for (const purchase of asset.purchases) {
    const item = document.createElement('div');
    item.className = 'purchase-item';
    item.innerHTML = `
      <form class="purchase-edit">
        <label>
          <span>Amount</span>
          <input name="amount" type="number" min="0" step="any" required>
        </label>
        <label>
          <span>Entry Price</span>
          <input name="price" type="number" min="0" step="any" required>
        </label>
        <label>
          <span>Date</span>
          <input name="date" type="date" required>
        </label>
        <label>
          <span>Exchange</span>
          <input name="exchange" placeholder="Binance" autocomplete="off">
        </label>
        <button class="button small" type="submit">Save</button>
        <button class="button danger small delete-purchase" type="button">Delete</button>
      </form>
    `;

    const editForm = item.querySelector('.purchase-edit');
    fillPurchaseForm(editForm, purchase);

    editForm.addEventListener('submit', async (event) => {
      event.preventDefault();

      try {
        await api(`/api/assets/${asset.id}/purchases/${purchase.id}`, {
          method: 'PUT',
          body: JSON.stringify(getFormPayload(editForm))
        });
        setMessage('Purchase updated.');
        await loadAll();
      } catch (error) {
        setMessage(error.message, 'negative');
      }
    });

    item.querySelector('.delete-purchase').addEventListener('click', async () => {
      if (!confirm('Delete this purchase?')) {
        return;
      }

      try {
        await api(`/api/assets/${asset.id}/purchases/${purchase.id}`, { method: 'DELETE' });
        setMessage('Purchase deleted.');
        await loadAll();
      } catch (error) {
        setMessage(error.message, 'negative');
      }
    });

    purchases.append(item);
  }

  return row;
}

function renderTargets() {
  els.targetsGrid.innerHTML = '';
  els.emptyTargets.style.display = state.buyTargets.length ? 'none' : 'block';

  for (const target of state.buyTargets) {
    const calc = calculateTarget(target);
    const card = document.createElement('article');
    const statusClass = calc.priceError ? 'error' : calc.canBuy ? 'buy' : 'wait';
    const statusText = calc.priceError || (calc.canBuy ? 'BUY ALLOWED' : 'DO NOT BUY');

    card.className = 'target-card';
    card.innerHTML = `
      <div class="target-head">
        <div>
          <div class="symbol">${target.baseSymbol}</div>
          <div class="subtle">${target.symbol}</div>
        </div>
        <span class="badge ${statusClass}">${statusText}</span>
      </div>
      <div class="target-price">
        <span>Current Price</span>
        <strong>${calc.hasPrice ? formatMoney(calc.currentPrice) : '-'}</strong>
      </div>
      <form class="target-edit">
        <label>
          <span>Buy From</span>
          <input name="buyFrom" type="number" min="0" step="any" required>
        </label>
        <label>
          <span>Buy To</span>
          <input name="buyTo" type="number" min="0" step="any" required>
        </label>
        <button class="button small" type="submit">Save</button>
        <button class="button danger small delete-target" type="button">Delete</button>
      </form>
    `;

    const editForm = card.querySelector('.target-edit');
    editForm.elements.buyFrom.value = target.buyFrom;
    editForm.elements.buyTo.value = target.buyTo;

    editForm.addEventListener('submit', async (event) => {
      event.preventDefault();

      try {
        await api(`/api/buy-targets/${target.id}`, {
          method: 'PUT',
          body: JSON.stringify(getFormPayload(editForm))
        });
        setMessage('Buy target updated.');
        await loadAll();
      } catch (error) {
        setMessage(error.message, 'negative');
      }
    });

    card.querySelector('.delete-target').addEventListener('click', async () => {
      if (!confirm(`Delete buy target for ${target.symbol}?`)) {
        return;
      }

      try {
        await api(`/api/buy-targets/${target.id}`, { method: 'DELETE' });
        setMessage('Buy target deleted.');
        await loadAll();
      } catch (error) {
        setMessage(error.message, 'negative');
      }
    });

    els.targetsGrid.append(card);
  }
}

function renderActiveTargets() {
  const activeTargets = state.buyTargets
    .map((target) => ({
      target,
      calc: calculateTarget(target)
    }))
    .filter((item) => item.calc.canBuy);

  els.activeTargetsGrid.innerHTML = '';
  els.activeTargetsSection.style.display = activeTargets.length ? 'block' : 'none';

  for (const { target, calc } of activeTargets) {
    const card = document.createElement('article');
    card.className = 'active-target-card';
    card.innerHTML = `
      <div>
        <div class="symbol">${target.baseSymbol}</div>
        <div class="subtle">${target.symbol}</div>
      </div>
      <div>
        <span class="subtle">Current</span>
        <strong>${formatMoney(calc.currentPrice)}</strong>
      </div>
      <div>
        <span class="subtle">Range</span>
        <strong>${formatMoney(Number(target.buyFrom))} - ${formatMoney(Number(target.buyTo))}</strong>
      </div>
      <span class="badge buy">BUY ALLOWED</span>
    `;
    els.activeTargetsGrid.append(card);
  }
}

function render() {
  renderSummary();
  renderActiveTargets();
  renderAssets();
  renderTargets();
}

async function loadAssets() {
  const data = await api('/api/assets');
  state.assets = data.assets || [];
}

async function loadBuyTargets() {
  const data = await api('/api/buy-targets');
  state.buyTargets = data.buyTargets || [];
}

async function loadPrices() {
  const data = await api('/api/prices');
  state.prices = data.prices || {};
  els.lastUpdated.textContent = `Updated: ${new Date().toLocaleTimeString('en-US')}`;
}

async function loadAll() {
  try {
    await loadAssets();
    await loadBuyTargets();
    await loadPrices();
    render();
  } catch (error) {
    setMessage(error.message, 'negative');
    render();
  }
}

async function searchSymbols(query, datalist) {
  if (!datalist) {
    return;
  }

  if (!query || query.trim().length < 1) {
    datalist.innerHTML = '';
    return;
  }

  try {
    const data = await api(`/api/symbols?q=${encodeURIComponent(query)}`);
    datalist.innerHTML = '';

    for (const item of data.symbols || []) {
      const option = document.createElement('option');
      option.value = item.baseSymbol;
      option.label = item.symbol;
      datalist.append(option);
    }
  } catch (error) {
    setMessage(error.message, 'negative');
  }
}

function setActiveTab(tabName) {
  state.activeTab = tabName;

  for (const tab of els.tabs) {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  }

  for (const panel of els.tabPanels) {
    const isActive = panel.id === `${tabName}Panel`;
    panel.classList.toggle('active', isActive);
  }
}

els.assetForm.elements.date.value = today();

els.assetForm.elements.baseSymbol.addEventListener('input', (event) => {
  clearTimeout(symbolSearchTimer);
  symbolSearchTimer = setTimeout(() => searchSymbols(event.target.value, els.tokenSuggestions), 250);
});

els.targetForm.elements.baseSymbol.addEventListener('input', (event) => {
  clearTimeout(targetSymbolSearchTimer);
  targetSymbolSearchTimer = setTimeout(() => searchSymbols(event.target.value, els.targetTokenSuggestions), 250);
});

els.assetForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    await api('/api/assets', {
      method: 'POST',
      body: JSON.stringify(getFormPayload(els.assetForm))
    });
    const date = els.assetForm.elements.date.value;
    els.assetForm.reset();
    els.assetForm.elements.date.value = date || today();
    setMessage('Purchase saved.');
    await loadAll();
  } catch (error) {
    setMessage(error.message, 'negative');
  }
});

els.targetForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    await api('/api/buy-targets', {
      method: 'POST',
      body: JSON.stringify(getFormPayload(els.targetForm))
    });
    els.targetForm.reset();
    setMessage('Buy target saved.');
    await loadAll();
  } catch (error) {
    setMessage(error.message, 'negative');
  }
});

els.refreshPrices.addEventListener('click', async () => {
  try {
    await loadPrices();
    render();
    setMessage('Prices refreshed.');
  } catch (error) {
    setMessage(error.message, 'negative');
  }
});

for (const tab of els.tabs) {
  tab.addEventListener('click', () => setActiveTab(tab.dataset.tab));
}

for (const button of els.sortButtons) {
  button.addEventListener('click', () => {
    const key = button.dataset.sort;

    if (state.assetSort.key === key) {
      state.assetSort.direction = state.assetSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
      state.assetSort.key = key;
      state.assetSort.direction = key === 'token' ? 'asc' : 'desc';
    }

    render();
  });
}

setActiveTab(state.activeTab);
loadAll();
