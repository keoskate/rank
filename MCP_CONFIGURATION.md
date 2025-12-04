# Alpaca MCP Server Configuration

This document explains how to use the Alpaca MCP (Model Context Protocol) Server for AI-powered trading interactions.

## What is MCP?

The Model Context Protocol (MCP) allows AI assistants like Claude to interact directly with your Alpaca trading accounts using natural language. You can ask questions, place orders, check positions, and analyze markets through conversational AI.

## Installation Status

✅ **MCP Server Installed**: `alpaca-mcp-server` is installed via `uvx`
✅ **Location**: `~/.local/bin/uvx`
✅ **Paper Trading Credentials**: Configured
✅ **Live Trading Credentials**: Configured

## Available MCP Servers

### 1. Alpaca Paper Trading Server
- **Purpose**: Safe testing with $100k virtual money
- **Account**: PA3Q8Y2RHTID
- **Endpoint**: https://paper-api.alpaca.markets

### 2. Alpaca Live Trading Server
- **Purpose**: Real money trading
- **Account**: 111972835
- **Endpoint**: https://api.alpaca.markets

## Configuration for Claude Desktop / Other MCP Clients

Add this to your MCP client configuration (e.g., `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "alpaca-paper": {
      "command": "/Users/keo/.local/bin/uvx",
      "args": ["alpaca-mcp-server"],
      "env": {
        "ALPACA_API_KEY": "PKOS5B9EF0884GN7OU0V",
        "ALPACA_API_SECRET": "IsLmeBTirFHtXqsG1u8FvFFdo9cVpKKmNxWIes2W",
        "ALPACA_BASE_URL": "https://paper-api.alpaca.markets"
      }
    },
    "alpaca-live": {
      "command": "/Users/keo/.local/bin/uvx",
      "args": ["alpaca-mcp-server"],
      "env": {
        "ALPACA_API_KEY": "${ALPACA_LIVE_API_KEY}",
        "ALPACA_API_SECRET": "${ALPACA_LIVE_SECRET_KEY}",
        "ALPACA_BASE_URL": "https://api.alpaca.markets"
      }
    }
  }
}
```

**Note**: Replace `${ALPACA_LIVE_API_KEY}` and `${ALPACA_LIVE_SECRET_KEY}` with your actual live trading credentials from environment variables or hardcode them (not recommended for security).

## Testing MCP Server

### Test Paper Trading Connection:
```bash
ALPACA_API_KEY="PKOS5B9EF0884GN7OU0V" \
ALPACA_API_SECRET="IsLmeBTirFHtXqsG1u8FvFFdo9cVpKKmNxWIes2W" \
ALPACA_BASE_URL="https://paper-api.alpaca.markets" \
~/.local/bin/uvx alpaca-mcp-server --help
```

### Test Live Trading Connection:
```bash
ALPACA_API_KEY="$ALPACA_LIVE_API_KEY" \
ALPACA_API_SECRET="$ALPACA_LIVE_SECRET_KEY" \
ALPACA_BASE_URL="https://api.alpaca.markets" \
~/.local/bin/uvx alpaca-mcp-server --help
```

## Available MCP Functions (50+ total)

The Alpaca MCP Server provides these categories of functions:

### Account Management
- `get_account` - Get account details
- `get_account_activities` - View account activity
- `get_account_configurations` - Get trading settings

### Portfolio & Positions
- `list_positions` - View all open positions
- `get_position` - Get specific position details
- `close_position` - Close a position
- `close_all_positions` - Close all positions

### Orders
- `list_orders` - View orders (open, filled, cancelled)
- `get_order` - Get specific order details
- `create_order` - Place new order (market, limit, stop, etc.)
- `cancel_order` - Cancel an order
- `replace_order` - Modify an existing order

### Market Data
- `get_latest_quote` - Get latest bid/ask prices
- `get_latest_trade` - Get latest executed trade
- `get_bars` - Get historical OHLCV data
- `get_snapshot` - Get complete market snapshot
- `get_news` - Get market news for symbols

### Watchlists
- `create_watchlist` - Create a new watchlist
- `list_watchlists` - View all watchlists
- `add_to_watchlist` - Add symbols to watchlist
- `remove_from_watchlist` - Remove symbols

### Options (if enabled)
- `get_option_contracts` - Search option contracts
- `get_option_chain` - Get full option chain
- `get_latest_option_quote` - Get option pricing

### Corporate Actions
- `get_corporate_actions` - View dividends, splits, mergers

## Example Natural Language Commands

Once configured with Claude or another MCP client, you can use natural language:

### Paper Trading Examples:
- "What's my current paper trading account balance?"
- "Show me my open positions in the paper account"
- "Buy 10 shares of AAPL in paper trading at market price"
- "What's the latest price for NVDA?"
- "Show me TSLA's performance over the last month"

### Live Trading Examples (use with caution):
- "What's my live account balance?"
- "Show me my real positions"
- "Place a limit order to buy 5 shares of MSFT at $350"
- "Cancel all open orders in my live account"

## Safety Considerations

### Paper Trading Server
- ✅ Safe to experiment
- ✅ No real money at risk
- ✅ Full access to all features
- ✅ Unlimited orders

### Live Trading Server
- ⚠️ **REAL MONEY AT RISK**
- ⚠️ All orders execute with actual funds
- ⚠️ Use paper trading first to test strategies
- ⚠️ Start with small positions
- ⚠️ Set stop losses for risk management

## Integration with This Application

The MCP server is complementary to the web-based trading interface:

1. **Web UI** (`http://localhost:8080/paper-trading`):
   - Visual interface with charts and tables
   - Click-based trading
   - Mode toggle (paper/live)

2. **MCP Server** (via Claude/AI):
   - Natural language trading
   - AI-powered analysis
   - Conversational workflow
   - Research and recommendations

Both connect to the same Alpaca accounts, so:
- Orders placed via MCP appear in the web UI
- Orders placed via web UI appear in MCP
- Account balances sync in real-time

## Next Steps

1. **Configure Claude Desktop**: Add the MCP configuration to Claude Desktop app
2. **Test Connection**: Ask Claude "What's my Alpaca paper trading account balance?"
3. **Explore Features**: Try different natural language commands
4. **Build AI Research UI**: Integrate MCP into the web application for AI-powered stock research

## Resources

- **Alpaca MCP Server Docs**: https://github.com/alpacahq/alpaca-mcp-server
- **MCP Protocol**: https://modelcontextprotocol.io
- **Alpaca API Docs**: https://docs.alpaca.markets

## Troubleshooting

### MCP Server Not Found
```bash
# Add to PATH
export PATH="$HOME/.local/bin:$PATH"
```

### Permission Denied
```bash
# Make executable
chmod +x ~/.local/bin/uvx
```

### Connection Errors
- Verify API keys are correct
- Check that BASE_URL matches (paper vs live)
- Ensure internet connection is active
- Check Alpaca API status: https://status.alpaca.markets
