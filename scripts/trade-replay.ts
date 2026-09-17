/**
 * VelocityBook — Historical Market Session Trade Replay CLI
 *
 * Replays historical trades tick-by-tick into the exchange.
 * Usage:
 *   npx ts-node scripts/trade-replay.ts [symbol] [speed] [limit]
 * Example:
 *   npx ts-node scripts/trade-replay.ts BTC-USD 5 200
 */

const symbol = process.argv[2] || 'BTC-USD';
const speed = Number(process.argv[3]) || 5;
const limit = Number(process.argv[4]) || 100;
export {};
const API_URL = process.env.API_URL || 'http://localhost:3001';

async function triggerReplay() {
  console.log(`\n═══════════════════════════════════════════════════════════════`);
  console.log(`  VelocityBook Historical Trade Replay Session Trigger`);
  console.log(`  Target Pair:    ${symbol}`);
  console.log(`  Playback Speed: ${speed}x`);
  console.log(`  Ticks to Play:  ${limit}`);
  console.log(`  Target Backend: ${API_URL}`);
  console.log(`═══════════════════════════════════════════════════════════════\n`);

  try {
    const res = await fetch(`${API_URL}/api/replay/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, speed, limit }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Backend error (${res.status}): ${err}`);
    }

    const data = await res.json();
    console.log(`  ✓ Replay status:`, data.message);
    console.log(`  ✓ Session started for ${data.status.totalTrades} trades at ${data.status.speed}x speed`);
    console.log(`  ✓ Check trading terminal or Grafana to watch real-time replay stream!\n`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`  ✕ Replay trigger failed:`, message);
    console.log(`  (Note: ensure backend is running at ${API_URL})\n`);
  }
}

triggerReplay();
