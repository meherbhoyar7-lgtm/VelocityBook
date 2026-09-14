/**
 * VelocityBook — Market Seeding Script
 *
 * Populates the order book with 20 bid and 20 ask levels for BTC-USD and ETH-USD
 * with realistic spread, price distribution, and liquidity depth.
 */

const API_URL = process.env.API_URL || 'http://localhost:3001';

interface SeedConfig {
  symbol: string;
  midPrice: number;
  spreadBps: number; // basis points
  levels: number;
  minQty: number;
  maxQty: number;
}

const configs: SeedConfig[] = [
  {
    symbol: 'BTC-USD',
    midPrice: 64250.0,
    spreadBps: 10, // 0.1% spread
    levels: 20,
    minQty: 0.05,
    maxQty: 1.5,
  },
  {
    symbol: 'ETH-USD',
    midPrice: 3450.0,
    spreadBps: 15, // 0.15% spread
    levels: 20,
    minQty: 0.5,
    maxQty: 15.0,
  },
];

async function seedMarket() {
  console.log('\n' + '═'.repeat(60));
  console.log('  VELOCITYBOOK: ORDER BOOK LIQUIDITY SEEDING');
  console.log(`  Target Backend: ${API_URL}`);
  console.log('═'.repeat(60));

  try {
    // 1. Fetch demo users to use the MarketMaker user
    const usersRes = await fetch(`${API_URL}/api/auth/demo-users`);
    if (!usersRes.ok) {
      throw new Error(`Failed to fetch demo users from ${API_URL}. Is the backend running?`);
    }

    const { users } = await usersRes.json();
    const mmUser = users.find((u: any) => u.email.includes('marketmaker')) || users[users.length - 1];

    if (!mmUser) {
      throw new Error('MarketMaker user not found in demo users');
    }

    console.log(`\n▶ Seeding as MarketMaker: ${mmUser.display_name} (${mmUser.id})`);

    // Switch/Login as MM
    const switchRes = await fetch(`${API_URL}/api/auth/switch/${mmUser.id}`, { method: 'POST' });
    const { token } = await switchRes.json();

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };

    for (const config of configs) {
      console.log(`\n▶ Seeding ${config.symbol} (Mid: $${config.midPrice}, Levels: ${config.levels} bids / ${config.levels} asks)...`);

      const halfSpread = (config.midPrice * (config.spreadBps / 10000)) / 2;
      const bestBid = config.midPrice - halfSpread;
      const bestAsk = config.midPrice + halfSpread;

      let seededBids = 0;
      let seededAsks = 0;

      // Seed Bids (below bestBid)
      for (let i = 0; i < config.levels; i++) {
        const step = (config.midPrice * 0.001) * (i + 1);
        const price = (bestBid - step).toFixed(2);
        const quantity = (Math.random() * (config.maxQty - config.minQty) + config.minQty).toFixed(4);

        try {
          const res = await fetch(`${API_URL}/api/orders`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              symbol: config.symbol,
              side: 'BUY',
              type: 'LIMIT',
              price,
              quantity,
            }),
          });
          if (res.ok) seededBids++;
        } catch {
          // Ignore individual order errors
        }
      }

      // Seed Asks (above bestAsk)
      for (let i = 0; i < config.levels; i++) {
        const step = (config.midPrice * 0.001) * (i + 1);
        const price = (bestAsk + step).toFixed(2);
        const quantity = (Math.random() * (config.maxQty - config.minQty) + config.minQty).toFixed(4);

        try {
          const res = await fetch(`${API_URL}/api/orders`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              symbol: config.symbol,
              side: 'SELL',
              type: 'LIMIT',
              price,
              quantity,
            }),
          });
          if (res.ok) seededAsks++;
        } catch {
          // Ignore individual order errors
        }
      }

      console.log(`  ✔ Seeded ${config.symbol}: ${seededBids} bids, ${seededAsks} asks`);
    }

    console.log('\n' + '═'.repeat(60));
    console.log('  ✔ MARKET SEEDING COMPLETE');
    console.log('═'.repeat(60) + '\n');
  } catch (error: any) {
    console.error('\n❌ Seeding Error:', error.message);
    console.log('Tip: Ensure the backend is started via `docker-compose up` or `npm run dev:backend`\n');
  }
}

seedMarket();
