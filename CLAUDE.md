# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Single-user local crypto portfolio monitor: tracks spot purchases, buy-range targets and PnL against live Binance prices. Data lives in a local JSON file. There is no database and no auth.

## Commands

- `npm install`, then `npm start` (`npm run dev` is identical). Serves http://localhost:3000; override with `PORT`.
- There are no tests, linter or build step. Verify changes by running the app.
- No auto-reload: restart after changing `server.js`. Files in `public/` only need a browser refresh.
- Requires outbound access to `api.binance.com`.

## Architecture

Express (ESM) in `server.js` plus a vanilla JS frontend in `public/` with no framework or bundler. `express` is the only dependency.

**The server only stores data and proxies Binance.** All financial calculations (average entry, PnL, buy signals, profitable positions) run in the browser, in the `calculate*` functions in `public/app.js`. Fees are not included.

**Storage:** `data/assets.json`, gitignored and holding the user's real data, so never overwrite or delete it. Each request does a full read-modify-write through `readData`/`writeData`.

```
{ assets: [{ id, baseSymbol, quoteSymbol, symbol, provider, purchases: [{ id, amount, price, date, exchange }] }],
  buyTargets: [{ id, baseSymbol, quoteSymbol, symbol, provider, buyFrom, buyTo }] }
```

`writeData` persists only `assets` and `buyTargets`, so a new top-level key must be added there and in `migrateData` and `readData`. `migrateData` also upgrades the legacy array format on read.

**Identity and upserts:** `symbol` is `baseSymbol + "USDT"`. `POST /api/assets` appends to the existing asset for that symbol, and `POST /api/buy-targets` replaces the existing target (one per token). Input is validated by `cleanPurchase` and `cleanBuyTarget`.

**Binance endpoints:**
- `/api/prices`: ticker price for every asset and target symbol, one request per symbol.
- `/api/price-stats?period=1d|1w|1m|1y`: low/high from klines (`STATS_PERIODS`), for buy targets only.
- `/api/symbols?q=`: autocomplete from `exchangeInfo`, cached in memory for 1 hour.

Nothing caches prices or stats. A per-symbol Binance error response comes back as `{ price: null, error }`; a network failure fails the whole request with a 502.

**Frontend flow:** global `state` and cached DOM references in `els`. `loadAll()` refetches everything, then `render()` rebuilds all sections with `innerHTML`, and every mutation handler calls `loadAll()`. Prices refresh only on page load, on a mutation, or via the Refresh button (no polling).

Number display: use `formatPrice` for prices and `formatMoney` for sums and PnL. `formatNumber` collapses 3+ leading decimal zeros into a subscript (`0.00000507` becomes `0.0₅507`), by the owner's choice. Do not use `e` notation. The Assets table uses `compactCell`: `M`/`B` from one million, no `USDT` per cell, and the full value in a tooltip via `data-full` (shown by the single `#numberTooltip`, which is `position: fixed` because `.table-wrap` clips overflow).

Assets with no price (a token missing from Binance gives `price: null`): read API numbers through `parseApiNumber`, since `Number(null)` is 0. Such assets show `-`, count in `Invested` but not in `Current Value` or `Total PnL`, and stay at the bottom of the table in stored order under any sort.

Tabs are matched by convention: `data-tab="x"` on the button maps to `#xPanel`. Portfolio sort keys in `data-sort` must exist in `getAssetSortValue`. The Sell Now tab lists each profitable purchase separately, not aggregated per token.

## Gotchas

- `readData` throws on invalid JSON or an unknown shape, and must never fall back to empty data, because the next write would wipe the file. Every API route returns a 500 until the file is fixed.
- `writeData` copies the current file to `data/assets.json.bak` first. Only one previous version is kept.
- Express 4 does not catch rejected async handlers, so wrap every new route in `route()`, or a rejection crashes the process.
- Writes are not atomic or locked, so concurrent mutating requests can lose updates.
- `render()` destroys and recreates form inputs, so unsaved edits are lost on any re-render. Keep this in mind before adding polling.
- Templates interpolate stored values into `innerHTML` unescaped, including free-text `exchange`.
- Stats period defaults differ: the UI uses `1w` (`state.statsPeriod` and the `selected` option in `index.html`), the server falls back to `1d`, and the README says Day.

## Constraints

- Binance Spot and USDT only. The `provider` and `quoteSymbol` fields exist for future expansion but are effectively constants.
- Deployment needs a Node host with persistent writable disk (VPS, or Render/Railway/Fly with a volume), not static or serverless hosting, unless JSON storage is replaced.
- `TODO.md` (gitignored, written in Ukrainian) holds the owner's backlog. Open items: free deployment, auto-deploy on push to `main`, and a product version in the site footer.
