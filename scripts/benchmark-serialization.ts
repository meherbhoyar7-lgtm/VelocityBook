import Decimal from 'decimal.js';
import {
  ProtocolSerializer,
  ZeroCopyOrderCodec,
  Side,
  OrderType,
  OrderStatus,
  type Order,
  type TradeExecution,
  type OrderBookSnapshot,
} from '@velocitybook/engine';

// ─── Test Data Generator ───────────────────────────────────────────

function createSampleOrder(i: number): Order {
  return {
    id: `ord-${i.toString().padStart(8, '0')}-uuid-test-123456`,
    userId: `usr-${(i % 10).toString().padStart(8, '0')}-uuid-user-123456`,
    symbol: i % 2 === 0 ? 'BTC-USD' : 'ETH-USD',
    side: i % 2 === 0 ? Side.BUY : Side.SELL,
    type: OrderType.LIMIT,
    price: new Decimal((50000 + (i % 100)).toFixed(2)),
    quantity: new Decimal((0.1 + (i % 5) * 0.05).toFixed(8)),
    filledQuantity: new Decimal('0'),
    status: OrderStatus.OPEN,
    timestamp: 1726000000000 + i,
  };
}

function createSampleSnapshot(): OrderBookSnapshot {
  const bids = Array.from({ length: 25 }, (_, i) => ({
    price: (50000 - i * 10).toFixed(2),
    size: (0.5 + i * 0.1).toFixed(4),
    total: (0.5 + i * 0.1).toFixed(4),
  }));
  const asks = Array.from({ length: 25 }, (_, i) => ({
    price: (50010 + i * 10).toFixed(2),
    size: (0.5 + i * 0.1).toFixed(4),
    total: (0.5 + i * 0.1).toFixed(4),
  }));

  return {
    symbol: 'BTC-USD',
    bids,
    asks,
    spread: new Decimal('10.00'),
    midPrice: new Decimal('50005.00'),
    timestamp: Date.now(),
  };
}

// ─── Benchmark Runner ──────────────────────────────────────────────

function runBenchmark() {
  const ITERATIONS = 50_000;
  console.log(`\n═══════════════════════════════════════════════════════════════`);
  console.log(`  VelocityBook Serialization Benchmark (${ITERATIONS.toLocaleString()} iterations)`);
  console.log(`═══════════════════════════════════════════════════════════════\n`);

  const sampleOrder = createSampleOrder(1);
  const sampleSnapshot = createSampleSnapshot();

  // ── 1. Order Serialization Wire Size ──
  const jsonOrder = JSON.stringify(sampleOrder);
  const jsonOrderBytes = Buffer.byteLength(jsonOrder, 'utf8');

  const protoOrderBuf = ProtocolSerializer.encodeOrder(sampleOrder);
  const protoOrderBytes = protoOrderBuf.length;

  const zeroCopyOrderBuf = ZeroCopyOrderCodec.encode(sampleOrder);
  const zeroCopyOrderBytes = zeroCopyOrderBuf.length;

  console.log(`--- [1] Order Payload Size Comparison ---`);
  console.log(`  Standard JSON:       ${jsonOrderBytes} bytes`);
  console.log(`  Protobuf Binary:     ${protoOrderBytes} bytes (${((1 - protoOrderBytes / jsonOrderBytes) * 100).toFixed(1)}% reduction)`);
  console.log(`  Zero-Copy Struct:    ${zeroCopyOrderBytes} bytes (fixed layout)\n`);

  // ── 2. OrderBook Snapshot Wire Size ──
  const jsonSnap = JSON.stringify(sampleSnapshot);
  const jsonSnapBytes = Buffer.byteLength(jsonSnap, 'utf8');

  const protoSnapBuf = ProtocolSerializer.encodeSnapshot(sampleSnapshot);
  const protoSnapBytes = protoSnapBuf.length;

  console.log(`--- [2] OrderBook Snapshot (50 levels) Size Comparison ---`);
  console.log(`  Standard JSON:       ${jsonSnapBytes} bytes`);
  console.log(`  Protobuf Binary:     ${protoSnapBytes} bytes (${((1 - protoSnapBytes / jsonSnapBytes) * 100).toFixed(1)}% reduction)\n`);

  // ── 3. Speed: JSON Encode / Decode ──
  let t0 = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    const s = JSON.stringify(sampleOrder);
    JSON.parse(s);
  }
  const jsonElapsed = performance.now() - t0;
  const jsonOps = Math.round((ITERATIONS / jsonElapsed) * 1000);

  // ── 4. Speed: Protobuf Encode / Decode ──
  t0 = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    const buf = ProtocolSerializer.encodeOrder(sampleOrder);
    ProtocolSerializer.decodeOrder(buf);
  }
  const protoElapsed = performance.now() - t0;
  const protoOps = Math.round((ITERATIONS / protoElapsed) * 1000);

  // ── 5. Speed: Zero-Copy Binary Encode / Decode ──
  t0 = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    const buf = ZeroCopyOrderCodec.encode(sampleOrder);
    ZeroCopyOrderCodec.decode(buf);
  }
  const zeroCopyElapsed = performance.now() - t0;
  const zeroCopyOps = Math.round((ITERATIONS / zeroCopyElapsed) * 1000);

  console.log(`--- [3] Throughput & Round-Trip Speed ---`);
  console.log(`  JSON Roundtrip:      ${jsonOps.toLocaleString()} ops/sec  (${jsonElapsed.toFixed(1)} ms total)`);
  console.log(`  Protobuf Roundtrip:  ${protoOps.toLocaleString()} ops/sec  (${protoElapsed.toFixed(1)} ms total)`);
  console.log(`  Zero-Copy Codec:     ${zeroCopyOps.toLocaleString()} ops/sec  (${zeroCopyElapsed.toFixed(1)} ms total)`);

  const speedup = (zeroCopyOps / jsonOps).toFixed(2);
  console.log(`\n  >> Zero-Copy Speedup: ~${speedup}x over standard JSON <<\n`);
}

runBenchmark();
