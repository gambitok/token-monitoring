# Token Monitoring

Minimal local portfolio monitor for spot tokens. It stores your data in a JSON file and uses Binance Spot prices for USDT pairs.

## Features

- Portfolio tracking by token purchases
- Average entry price calculation
- Current value and PnL calculation
- Purchase exchange field per transaction
- Editable purchase history per token
- Separate buy target tab
- Active buy targets shown on the main screen
- Buy target low/high price range for day, week, month, or year
- Binance USDT token autocomplete
- JSON file storage

## Requirements

- Node.js
- npm

## Install

```bash
npm install
```

## Run

```bash
npm start
```

Open:

```text
http://localhost:3000
```

## Data Storage

All user data is stored locally in:

```text
data/assets.json
```

Current format:

```json
{
  "assets": [],
  "buyTargets": []
}
```

## Portfolio

Use the `Portfolio` tab to add purchases. Enter:

- token, for example `BTC`
- amount
- entry price
- purchase date
- exchange text, for example `Binance`, `Bybit`, or `Telegram`

The app automatically converts `BTC` to the Binance pair `BTCUSDT`.

## Buy Targets

Use the `Buy Targets` tab to save one buy range per token.

Example:

```text
ETH
Buy From: 1600
Buy To: 1850
```

If the current Binance Spot price is inside the range, the app shows `BUY ALLOWED`. Otherwise it shows `DO NOT BUY`.

All active `BUY ALLOWED` targets are also shown on the main screen.

Buy Signal cards also show the selected period low/high price. The default period is `Day`; available options are `Day`, `Week`, `Month`, and `Year`.

## Deployment

This app writes to `data/assets.json`, so it needs a Node hosting option with persistent writable storage.

Good options:

- VPS
- Render web service with a persistent disk
- Railway service with a volume
- Fly.io app with a volume

Avoid plain static hosting or serverless-only deployments unless you replace JSON file storage with a database or object storage.

## Notes

- Pricing source is currently Binance Spot only.
- Quote currency is currently USDT only.
- The data model keeps `provider` and `quoteSymbol` fields so more sources or currencies can be added later.
- Fees are not included in calculations.
