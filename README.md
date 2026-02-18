# Keo Stonks - Investment Ranking & Trading Platform

A comprehensive stock ranking and paper trading platform with AI-powered analysis, technical indicators, and real-time market data.

## Features

- **Stock Ranking System** - Rank stocks using customizable weighted metrics
- **Paper Trading** - Practice trading with Alpaca's paper trading API
- **AI Trading Simulation** - Simulate AI-driven trading strategies
- **Technical Analysis** - RSI, EMA, Bollinger Bands, VWAP and more
- **Backtesting** - Test strategies against historical data
- **Real-time Charts** - TradingView-powered candlestick charts
- **Portfolio Tracking** - Monitor positions and P&L

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/yourusername/rank.git
cd rank
npm install
```

### 2. Configure Environment

Copy the example environment file and add your API keys:

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

- **Polygon.io** (Required) - Get free key at [polygon.io](https://polygon.io/dashboard/signup)
- **Alpaca** (Required for trading) - Get keys at [alpaca.markets](https://app.alpaca.markets/paper/dashboard/overview)
- **Anthropic** (Optional) - For AI research features

### 3. Run the Application

```bash
# Terminal 1: Start the server
npm run server-dev

# Terminal 2: Start the React client
npm run react-dev
```

Visit `http://localhost:8080/`

## Project Structure

```
rank/
├── server/           # Express.js backend
│   ├── index.js      # Main server
│   ├── alpacaClient.js
│   ├── polygonClient.js
│   └── ...
├── react-client/     # React frontend
│   └── src/
│       ├── Components/
│       ├── hooks/
│       ├── utils/
│       └── config/
└── data/            # Local data storage
```

## API Keys Required

| Service | Purpose | Required |
|---------|---------|----------|
| Polygon.io | Market data, quotes, historical | Yes |
| Alpaca | Paper/live trading | For trading features |
| Anthropic | AI research assistant | Optional |

## Development

```bash
npm run server-dev    # Start server with hot reload
npm run react-dev     # Start React with webpack watch
npm run build         # Production build
npm run format        # Format code with Prettier
```

## License

MIT
