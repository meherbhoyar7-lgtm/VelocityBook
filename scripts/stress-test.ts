/**
 * VelocityBook — Institutional Concurrency & Invariant Stress Test
 *
 * Simulates 10 concurrent trader bots (5 buyers, 5 sellers) submitting
 * 1,000 orders each = 10,000 total orders.
 *
 * Validates the 4 core financial invariants:
 *   1. Zero Negative Balances: ∀ accounts, available >= 0 and locked >= 0
 *   2. Double-Entry Equality: Σ Debits === Σ Credits (to 8 decimal places)
 *   3. Conservation of Value: Total system assets remain constant (zero leaked/created)
 *   4. No Orphaned Locks: Locked balances exactly equal resting order commitments
 */

import Decimal from 'decimal.js';
import { v4 as uuidv4 } from 'uuid';
import { MatchingEngine, createOrder, Side, OrderType, OrderStatus } from '@velocitybook/engine';

interface VirtualAccount {
  available: Decimal;
  locked: Decimal;
}

interface VirtualLedgerEntry {
  transactionId: string;
  userId: string;
  currency: string;
  amount: Decimal;
  type: 'DEBIT' | 'CREDIT';
}

interface ActiveOrderCommitment {
  orderId: string;
  userId: string;
  side: Side;
  lockedPrice: Decimal;
  remainingQty: Decimal;
}

async function runStressTest() {
  console.log('\n' + '═'.repeat(68));
  console.log('  VELOCITYBOOK: 10,000 ORDER HIGH-CONCURRENCY STRESS TEST');
  console.log('═'.repeat(68));

  const NUM_BOTS = 10;
  const ORDERS_PER_BOT = 1000;
  const TOTAL_ORDERS = NUM_BOTS * ORDERS_PER_BOT;
  const SYMBOL = 'BTC-USD';
  const BASE_PRICE = 50000;

  const engine = new MatchingEngine([SYMBOL]);

  // Virtual accounts for 10 bots
  const botAccounts: Map<string, { USD: VirtualAccount; BTC: VirtualAccount }> = new Map();
  const ledgerEntries: VirtualLedgerEntry[] = [];

  const INITIAL_USD = new Decimal('1000000.00');
  const INITIAL_BTC = new Decimal('100.00');

  for (let i = 0; i < NUM_BOTS; i++) {
    const botId = `bot-${i < 5 ? 'buyer' : 'seller'}-${i}`;
    botAccounts.set(botId, {
      USD: { available: new Decimal(INITIAL_USD), locked: new Decimal(0) },
      BTC: { available: new Decimal(INITIAL_BTC), locked: new Decimal(0) },
    });
  }

  console.log(`\n▶ Initialized ${NUM_BOTS} bots with:`);
  console.log(`  • USD per bot: $${INITIAL_USD.toLocaleString()}`);
  console.log(`  • BTC per bot: ${INITIAL_BTC.toFixed(2)} BTC`);
  console.log(`  • Target Orders: ${TOTAL_ORDERS.toLocaleString()} across concurrent event loop tasks`);

  let executedTradesCount = 0;
  let cancelledOrdersCount = 0;
  let rejectedOrdersCount = 0;
  const latencies: number[] = [];

  // Map of resting active order commitments for invariant tracking
  const activeOrders: Map<string, ActiveOrderCommitment> = new Map();

  const startTime = Date.now();

  async function botTask(botId: string, isBuyer: boolean, count: number) {
    const acc = botAccounts.get(botId)!;

    for (let i = 0; i < count; i++) {
      const orderStart = Date.now();

      // Random price variation ± 1.5% around BASE_PRICE
      const priceOffset = (Math.random() * 1500) - 750;
      const limitPrice = new Decimal(BASE_PRICE + priceOffset).toDecimalPlaces(2);
      const orderQty = new Decimal((Math.random() * 0.05 + 0.01).toFixed(4));
      const isMarket = Math.random() < 0.12; // 12% market orders
      const orderType = isMarket ? OrderType.MARKET : OrderType.LIMIT;
      const side = isBuyer ? Side.BUY : Side.SELL;

      // Determine locking price:
      // For Limit: limitPrice
      // For Market BUY: 1.1x BASE_PRICE buffer to cover any resting asks
      // For Market SELL: only locks BTC quantity
      const lockedPrice = isBuyer
        ? (isMarket ? new Decimal(BASE_PRICE * 1.1).toDecimalPlaces(2) : limitPrice)
        : limitPrice;

      // Risk Pre-check: Check and move available -> locked
      if (side === Side.BUY) {
        const requiredUSD = lockedPrice.times(orderQty);
        if (acc.USD.available.lt(requiredUSD)) {
          rejectedOrdersCount++;
          continue;
        }
        acc.USD.available = acc.USD.available.minus(requiredUSD);
        acc.USD.locked = acc.USD.locked.plus(requiredUSD);
      } else {
        if (acc.BTC.available.lt(orderQty)) {
          rejectedOrdersCount++;
          continue;
        }
        acc.BTC.available = acc.BTC.available.minus(orderQty);
        acc.BTC.locked = acc.BTC.locked.plus(orderQty);
      }

      const orderId = uuidv4();
      const order = createOrder({
        id: orderId,
        userId: botId,
        symbol: SYMBOL,
        side,
        type: orderType,
        price: isMarket ? '0' : limitPrice.toString(),
        quantity: orderQty.toString(),
      });

      // Track incoming order in active commitments temporarily
      const incomingCommitment: ActiveOrderCommitment = {
        orderId,
        userId: botId,
        side,
        lockedPrice,
        remainingQty: new Decimal(orderQty),
      };

      // Submit to matching engine
      const fills = engine.submitOrder(order);

      // Settle fills in double-entry ledger & accounts
      for (const fill of fills) {
        executedTradesCount++;
        const tradePrice = fill.price;
        const tradeQty = fill.quantity;
        const tradeUSD = tradePrice.times(tradeQty);

        const buyerAcc = botAccounts.get(fill.buyerId)!;
        const sellerAcc = botAccounts.get(fill.sellerId)!;

        // Identify maker and taker commitments
        const isBuyerTaker = fill.buyerId === botId;
        const makerOrderId = isBuyerTaker ? fill.sellOrderId : fill.buyOrderId;
        const makerCommitment = activeOrders.get(makerOrderId);

        // Seller settlement (seller always locked BTC):
        sellerAcc.BTC.locked = sellerAcc.BTC.locked.minus(tradeQty);
        sellerAcc.USD.available = sellerAcc.USD.available.plus(tradeUSD);

        // Buyer settlement:
        if (isBuyerTaker) {
          // Buyer is taker: locked at incomingCommitment.lockedPrice
          const lockedDebit = incomingCommitment.lockedPrice.times(tradeQty);
          const priceImprovementRefund = lockedDebit.minus(tradeUSD);

          buyerAcc.USD.locked = buyerAcc.USD.locked.minus(lockedDebit);
          buyerAcc.USD.available = buyerAcc.USD.available.plus(priceImprovementRefund);
          buyerAcc.BTC.available = buyerAcc.BTC.available.plus(tradeQty);

          incomingCommitment.remainingQty = incomingCommitment.remainingQty.minus(tradeQty);

          // Update maker commitment (resting seller)
          if (makerCommitment) {
            makerCommitment.remainingQty = makerCommitment.remainingQty.minus(tradeQty);
            if (makerCommitment.remainingQty.lte(0)) {
              activeOrders.delete(makerOrderId);
            }
          }
        } else {
          // Buyer is maker: maker locked at makerCommitment.lockedPrice === tradePrice
          buyerAcc.USD.locked = buyerAcc.USD.locked.minus(tradeUSD);
          buyerAcc.BTC.available = buyerAcc.BTC.available.plus(tradeQty);

          if (makerCommitment) {
            makerCommitment.remainingQty = makerCommitment.remainingQty.minus(tradeQty);
            if (makerCommitment.remainingQty.lte(0)) {
              activeOrders.delete(makerOrderId);
            }
          }

          incomingCommitment.remainingQty = incomingCommitment.remainingQty.minus(tradeQty);
        }

        // 4 Double-Entry Ledger entries per trade (Zero-Sum Invariant)
        const txId = uuidv4();
        ledgerEntries.push(
          { transactionId: txId, userId: fill.buyerId, currency: 'USD', amount: tradeUSD, type: 'DEBIT' },
          { transactionId: txId, userId: fill.sellerId, currency: 'USD', amount: tradeUSD, type: 'CREDIT' },
          { transactionId: txId, userId: fill.sellerId, currency: 'BTC', amount: tradeQty, type: 'DEBIT' },
          { transactionId: txId, userId: fill.buyerId, currency: 'BTC', amount: tradeQty, type: 'CREDIT' }
        );
      }

      // Handle remaining quantity of the incoming order
      if (order.status === OrderStatus.OPEN || order.status === OrderStatus.PARTIALLY_FILLED) {
        // Resting in order book
        activeOrders.set(orderId, incomingCommitment);
      } else if (order.status === OrderStatus.CANCELLED || incomingCommitment.remainingQty.gt(0)) {
        // Market order unfulfilled remainder or cancelled — unlock remaining funds
        const unfulfilled = incomingCommitment.remainingQty;
        if (unfulfilled.gt(0)) {
          if (side === Side.BUY) {
            const refundUSD = lockedPrice.times(unfulfilled);
            acc.USD.locked = acc.USD.locked.minus(refundUSD);
            acc.USD.available = acc.USD.available.plus(refundUSD);
          } else {
            acc.BTC.locked = acc.BTC.locked.minus(unfulfilled);
            acc.BTC.available = acc.BTC.available.plus(unfulfilled);
          }
        }
      }

      // Random cancellation of active resting orders (simulate realistic churn)
      if (Math.random() < 0.08 && activeOrders.size > 0) {
        const orderIds = Array.from(activeOrders.keys());
        const targetId = orderIds[Math.floor(Math.random() * orderIds.length)];
        const target = activeOrders.get(targetId);

        if (target && target.userId === botId) {
          const didCancel = engine.cancelOrder(SYMBOL, targetId);
          if (didCancel) {
            cancelledOrdersCount++;
            activeOrders.delete(targetId);

            if (target.side === Side.BUY) {
              const refundUSD = target.lockedPrice.times(target.remainingQty);
              acc.USD.locked = acc.USD.locked.minus(refundUSD);
              acc.USD.available = acc.USD.available.plus(refundUSD);
            } else {
              acc.BTC.locked = acc.BTC.locked.minus(target.remainingQty);
              acc.BTC.available = acc.BTC.available.plus(target.remainingQty);
            }
          }
        }
      }

      latencies.push(Date.now() - orderStart);

      // Yield event loop periodically for true asynchronous interleaving
      if (i % 25 === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
  }

  console.log('\n▶ Launching concurrent bot tasks...');
  const botPromises: Promise<void>[] = [];
  for (let i = 0; i < NUM_BOTS; i++) {
    const isBuyer = i < 5;
    const botId = `bot-${isBuyer ? 'buyer' : 'seller'}-${i}`;
    botPromises.push(botTask(botId, isBuyer, ORDERS_PER_BOT));
  }

  await Promise.all(botPromises);

  const durationMs = Date.now() - startTime;
  const throughput = Math.round((TOTAL_ORDERS / durationMs) * 1000);

  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const p99 = latencies[Math.floor(latencies.length * 0.99)];

  console.log('\n' + '─'.repeat(68));
  console.log('  PERFORMANCE BENCHMARKS');
  console.log('─'.repeat(68));
  console.log(`  Total Orders Processed:     ${TOTAL_ORDERS.toLocaleString()}`);
  console.log(`  Executed Trades (Fills):    ${executedTradesCount.toLocaleString()}`);
  console.log(`  Orders Cancelled (Churn):   ${cancelledOrdersCount.toLocaleString()}`);
  console.log(`  Orders Rejected (Risk):     ${rejectedOrdersCount.toLocaleString()}`);
  console.log(`  Total Elapsed Time:         ${durationMs} ms (${(durationMs / 1000).toFixed(2)} s)`);
  console.log(`  Engine Throughput:          ${throughput.toLocaleString()} orders/sec`);
  console.log(`  Latency P50:                ${p50} ms`);
  console.log(`  Latency P95:                ${p95} ms`);
  console.log(`  Latency P99:                ${p99} ms`);

  console.log('\n' + '─'.repeat(68));
  console.log('  FINANCIAL INVARIANT VERIFICATION');
  console.log('─'.repeat(68));

  // Invariant 1: Zero Negative Balances
  let hasNegative = false;
  botAccounts.forEach((acc, botId) => {
    if (acc.USD.available.lt(0) || acc.USD.locked.lt(0)) {
      console.error(`  ❌ [FAIL] Invariant 1: Negative USD on ${botId}: avail=${acc.USD.available.toFixed(4)}, locked=${acc.USD.locked.toFixed(4)}`);
      hasNegative = true;
    }
    if (acc.BTC.available.lt(0) || acc.BTC.locked.lt(0)) {
      console.error(`  ❌ [FAIL] Invariant 1: Negative BTC on ${botId}: avail=${acc.BTC.available.toFixed(8)}, locked=${acc.BTC.locked.toFixed(8)}`);
      hasNegative = true;
    }
  });
  if (!hasNegative) {
    console.log('  ✔ [PASS] Invariant 1: Zero Negative Balances (∀ accounts, available >= 0 and locked >= 0)');
  }

  // Invariant 2: Double-Entry Accounting Equality (Σ Debits == Σ Credits)
  let totalUSDDebits = new Decimal(0);
  let totalUSDCredits = new Decimal(0);
  let totalBTCDebits = new Decimal(0);
  let totalBTCCredits = new Decimal(0);

  for (const entry of ledgerEntries) {
    if (entry.currency === 'USD') {
      if (entry.type === 'DEBIT') totalUSDDebits = totalUSDDebits.plus(entry.amount);
      else totalUSDCredits = totalUSDCredits.plus(entry.amount);
    } else if (entry.currency === 'BTC') {
      if (entry.type === 'DEBIT') totalBTCDebits = totalBTCDebits.plus(entry.amount);
      else totalBTCCredits = totalBTCCredits.plus(entry.amount);
    }
  }

  const usdBalanced = totalUSDDebits.equals(totalUSDCredits);
  const btcBalanced = totalBTCDebits.equals(totalBTCCredits);

  if (usdBalanced && btcBalanced) {
    console.log(`  ✔ [PASS] Invariant 2: Double-Entry Ledger Equality`);
    console.log(`           USD Debits: $${totalUSDDebits.toFixed(2)} === Credits: $${totalUSDCredits.toFixed(2)}`);
    console.log(`           BTC Debits: ${totalBTCDebits.toFixed(8)} BTC === Credits: ${totalBTCCredits.toFixed(8)} BTC`);
  } else {
    console.error(`  ❌ [FAIL] Invariant 2: Double-Entry Mismatch!`);
    if (!usdBalanced) console.error(`         USD: Debits=${totalUSDDebits}, Credits=${totalUSDCredits}`);
    if (!btcBalanced) console.error(`         BTC: Debits=${totalBTCDebits}, Credits=${totalBTCCredits}`);
  }

  // Invariant 3: Conservation of Currency
  let currentTotalUSD = new Decimal(0);
  let currentTotalBTC = new Decimal(0);

  botAccounts.forEach((acc) => {
    currentTotalUSD = currentTotalUSD.plus(acc.USD.available).plus(acc.USD.locked);
    currentTotalBTC = currentTotalBTC.plus(acc.BTC.available).plus(acc.BTC.locked);
  });

  const expectedTotalUSD = INITIAL_USD.times(NUM_BOTS);
  const expectedTotalBTC = INITIAL_BTC.times(NUM_BOTS);

  const usdConserved = currentTotalUSD.minus(expectedTotalUSD).abs().lt(0.0001);
  const btcConserved = currentTotalBTC.minus(expectedTotalBTC).abs().lt(0.00000001);

  if (usdConserved && btcConserved) {
    console.log('  ✔ [PASS] Invariant 3: Conservation of Value (Zero leaked or created)');
    console.log(`           Net USD: $${currentTotalUSD.toFixed(2)} (Expected: $${expectedTotalUSD.toFixed(2)})`);
    console.log(`           Net BTC: ${currentTotalBTC.toFixed(8)} BTC (Expected: ${expectedTotalBTC.toFixed(8)} BTC)`);
  } else {
    console.error('  ❌ [FAIL] Invariant 3: Conservation of Value Violated!');
  }

  // Invariant 4: No Orphaned Locks
  let totalLockedUSD = new Decimal(0);
  let totalLockedBTC = new Decimal(0);

  botAccounts.forEach((acc) => {
    totalLockedUSD = totalLockedUSD.plus(acc.USD.locked);
    totalLockedBTC = totalLockedBTC.plus(acc.BTC.locked);
  });

  let sumActiveUSD = new Decimal(0);
  let sumActiveBTC = new Decimal(0);
  activeOrders.forEach((item) => {
    if (item.side === Side.BUY) {
      sumActiveUSD = sumActiveUSD.plus(item.lockedPrice.times(item.remainingQty));
    } else {
      sumActiveBTC = sumActiveBTC.plus(item.remainingQty);
    }
  });

  const locksConsistentUSD = totalLockedUSD.minus(sumActiveUSD).abs().lt(0.0001);
  const locksConsistentBTC = totalLockedBTC.minus(sumActiveBTC).abs().lt(0.00000001);

  if (locksConsistentUSD && locksConsistentBTC) {
    console.log('  ✔ [PASS] Invariant 4: No Orphaned Locks');
    console.log(`           Locked USD ($${totalLockedUSD.toFixed(2)}) === Resting Commitments ($${sumActiveUSD.toFixed(2)})`);
    console.log(`           Locked BTC (${totalLockedBTC.toFixed(8)}) === Resting Commitments (${sumActiveBTC.toFixed(8)})`);
  } else {
    console.error('  ❌ [FAIL] Invariant 4: Orphaned Locks Detected!');
    console.error(`         Locked USD: ${totalLockedUSD.toFixed(4)}, Active: ${sumActiveUSD.toFixed(4)}`);
    console.error(`         Locked BTC: ${totalLockedBTC.toFixed(8)}, Active: ${sumActiveBTC.toFixed(8)}`);
  }

  console.log('\n' + '═'.repeat(68));
  if (!hasNegative && usdBalanced && btcBalanced && usdConserved && btcConserved && locksConsistentUSD && locksConsistentBTC) {
    console.log('  🎉 ALL 4 FINANCIAL INVARIANTS PERFECTLY SATISFIED UNDER HIGH CONCURRENCY!');
  } else {
    console.log('  ❌ STRESS TEST FAILED ONE OR MORE INVARIANTS.');
    process.exit(1);
  }
  console.log('═'.repeat(68) + '\n');
}

runStressTest().catch((err) => {
  console.error('Fatal stress test error:', err);
  process.exit(1);
});
