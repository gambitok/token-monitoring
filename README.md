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

## Notes

- Pricing source is currently Binance Spot only.
- Quote currency is currently USDT only.
- The data model keeps `provider` and `quoteSymbol` fields so more sources or currencies can be added later.
- Fees are not included in calculations.
