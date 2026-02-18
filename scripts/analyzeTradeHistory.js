#!/usr/bin/env node
/**
 * Analyze recent trade history from Alpaca orders
 * Match buys with sells to calculate P&L per round-trip trade
 */

const http = require('http');

function fetch(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function main() {
  const resp = await fetch('http://localhost:8080/api/alpaca/orders?status=closed&limit=100');
  const orders = resp.orders;

  if (!orders || orders.length === 0) {
    console.log('No orders found.');
    return;
  }

  // Sort orders by date (oldest first)
  orders.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  // Group by symbol and match buys with sells
  const trades = [];
  const openBuys = {}; // symbol -> [{ qty, price, date }]

  for (const order of orders) {
    const sym = order.symbol;
    const qty = parseInt(order.filledQty || order.quantity);
    const price = parseFloat(order.filledAvgPrice);
    const date = order.createdAt.split('T')[0];

    if (order.side === 'buy') {
      if (!openBuys[sym]) openBuys[sym] = [];
      openBuys[sym].push({ qty, price, date });
    } else if (order.side === 'sell') {
      let remaining = qty;
      while (remaining > 0 && openBuys[sym] && openBuys[sym].length > 0) {
        const buy = openBuys[sym][0];
        const matched = Math.min(remaining, buy.qty);
        const pnl = (price - buy.price) * matched;
        const pnlPercent = ((price - buy.price) / buy.price) * 100;

        trades.push({
          symbol: sym,
          buyQty: matched,
          buyPrice: buy.price,
          buyDate: buy.date,
          sellPrice: price,
          sellDate: date,
          pnl: pnl,
          pnlPercent: pnlPercent,
          holdDays: Math.round((new Date(date) - new Date(buy.date)) / (1000 * 60 * 60 * 24)),
        });

        remaining -= matched;
        buy.qty -= matched;
        if (buy.qty <= 0) openBuys[sym].shift();
      }
    }
  }

  // Group by date
  const byDate = {};
  for (const t of trades) {
    if (!byDate[t.sellDate]) byDate[t.sellDate] = [];
    byDate[t.sellDate].push(t);
  }

  // Print summary by date
  console.log('=== TRADE P&L ANALYSIS ===\n');
  let grandTotal = 0;
  let totalWins = 0;
  let totalLosses = 0;

  for (const [date, dayTrades] of Object.entries(byDate).sort()) {
    const dayPnL = dayTrades.reduce((sum, t) => sum + t.pnl, 0);
    grandTotal += dayPnL;
    const dayWins = dayTrades.filter(t => t.pnl > 0).length;
    const dayLosses = dayTrades.filter(t => t.pnl <= 0).length;
    totalWins += dayWins;
    totalLosses += dayLosses;

    const sign = dayPnL >= 0 ? '+' : '';
    console.log(`--- ${date} --- Day P&L: ${sign}$${dayPnL.toFixed(2)} (${dayWins}W/${dayLosses}L)`);

    for (const t of dayTrades) {
      const pnlSign = t.pnl >= 0 ? '+' : '';
      const icon = t.pnl >= 0 ? 'WIN ' : 'LOSS';
      console.log(
        `  ${icon} ${t.symbol.padEnd(5)} ${t.buyQty}x | Buy $${t.buyPrice.toFixed(2)} -> Sell $${t.sellPrice.toFixed(2)} | ${pnlSign}$${t.pnl.toFixed(2)} (${pnlSign}${t.pnlPercent.toFixed(2)}%) | Held ${t.holdDays}d`
      );
    }
    console.log('');
  }

  // Overall summary
  const totalTrades = totalWins + totalLosses;
  const winRate = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : 0;
  const grandSign = grandTotal >= 0 ? '+' : '';

  console.log('=== OVERALL SUMMARY ===');
  console.log(`Total P&L:    ${grandSign}$${grandTotal.toFixed(2)}`);
  console.log(`Total Trades: ${totalTrades} (${totalWins}W / ${totalLosses}L)`);
  console.log(`Win Rate:     ${winRate}%`);
  console.log(`Avg Win:      $${totalWins > 0 ? (trades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0) / totalWins).toFixed(2) : '0'}`);
  console.log(`Avg Loss:     $${totalLosses > 0 ? (trades.filter(t => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0) / totalLosses).toFixed(2) : '0'}`);

  // Biggest winners/losers
  const sorted = [...trades].sort((a, b) => b.pnl - a.pnl);
  console.log(`\nBiggest Win:  ${sorted[0]?.symbol} ${sorted[0]?.pnl >= 0 ? '+' : ''}$${sorted[0]?.pnl.toFixed(2)}`);
  console.log(`Biggest Loss: ${sorted[sorted.length - 1]?.symbol} ${sorted[sorted.length - 1]?.pnl >= 0 ? '+' : ''}$${sorted[sorted.length - 1]?.pnl.toFixed(2)}`);

  // Per-symbol breakdown
  console.log('\n=== PER-SYMBOL BREAKDOWN ===');
  const bySym = {};
  for (const t of trades) {
    if (!bySym[t.symbol]) bySym[t.symbol] = { pnl: 0, count: 0, wins: 0, losses: 0 };
    bySym[t.symbol].pnl += t.pnl;
    bySym[t.symbol].count++;
    if (t.pnl > 0) bySym[t.symbol].wins++;
    else bySym[t.symbol].losses++;
  }
  for (const [sym, stats] of Object.entries(bySym).sort((a, b) => a[1].pnl - b[1].pnl)) {
    const sign = stats.pnl >= 0 ? '+' : '';
    console.log(`  ${sym.padEnd(5)}: ${sign}$${stats.pnl.toFixed(2)} (${stats.count} trades, ${stats.wins}W/${stats.losses}L)`);
  }
}

main().catch(console.error);
