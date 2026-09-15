import Decimal from 'decimal.js';
import { v4 as uuidv4 } from 'uuid';
import { MatchingEngine, createOrder, Side, OrderType, OrderStatus, TradeExecution } from '@velocitybook/engine';
import { withTransaction } from '../db/pool';
import { query } from '../db/pool';
import { RiskService } from './RiskService';
import { SettlementService } from './SettlementService';

const MM_USER_ID = 'c0000000-0000-0000-0000-000000000003';

/**
 * MarketMakerBot — Automated Liquidity Provider
 *
 * Generates realistic market activity so the trading terminal
 * has live data from the moment the app starts.
 *
 * 1. Seeds the order book with 20 bid + 20 ask levels
 * 2. Continuously adjusts prices with random walk drift
 * 3. Occasionally crosses the spread to generate trade executions
 */
export class MarketMakerBot {
  private engine: any;
  private wsServer: any;
  private running = false;
  private intervalId: NodeJS.Timeout | null = null;
  private activeOrderIds: Map<string, { symbol: string; side: 'BUY' | 'SELL'; price: Decimal; quantity: Decimal }> = new Map();
  private midPrice: Record<string, Decimal> = {};

  constructor(engine: any, wsServer?: any) {
    this.engine = (engine && typeof engine.getLocalEngine === 'function' && engine.getLocalEngine())
      ? engine.getLocalEngine()
      : engine;
    this.wsServer = wsServer;
    this.midPrice = {
      'BTC-INR': new Decimal(4250000),
      'ETH-INR': new Decimal(255000),
      'BTC-USD': new Decimal(50000),
      'ETH-USD': new Decimal(3000),
    };
  }

  /**
   * Start the bot — seed initial liquidity and begin continuous updates.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    console.log('[MarketMaker] Starting...');

    // Seed initial order book
    for (const symbol of this.engine.getSymbols()) {
      await this.seedOrderBook(symbol);
    }

    // Start continuous market making
    this.intervalId = setInterval(async () => {
      if (!this.running) return;
      try {
        for (const symbol of this.engine.getSymbols()) {
          await this.tick(symbol);
        }
      } catch (err: any) {
        console.error('[MarketMaker] Tick error:', err.message);
      }
    }, 1000 + Math.random() * 1500); // 1-2.5 seconds

    console.log('[MarketMaker] Started — liquidity seeded');
  }

  /**
   * Stop the bot.
   */
  stop(): void {
    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    console.log('[MarketMaker] Stopped');
  }

  /**
   * Seed the initial order book with 20 bid + 20 ask levels.
   */
  private async seedOrderBook(symbol: string): Promise<void> {
    const mid = this.midPrice[symbol] || new Decimal(50000);
    const tickSize = symbol === 'BTC-USD' ? new Decimal(10) : new Decimal(1);

    // 20 bid levels below mid
    for (let i = 1; i <= 20; i++) {
      const price = mid.minus(tickSize.times(i));
      const quantity = new Decimal(0.01 + Math.random() * 0.49).toDecimalPlaces(8);
      await this.placeMMOrder(symbol, Side.BUY, price, quantity);
    }

    // 20 ask levels above mid
    for (let i = 1; i <= 20; i++) {
      const price = mid.plus(tickSize.times(i));
      const quantity = new Decimal(0.01 + Math.random() * 0.49).toDecimalPlaces(8);
      await this.placeMMOrder(symbol, Side.SELL, price, quantity);
    }
  }

  /**
   * One tick of market making — adjust prices, cancel/replace, occasional cross.
   */
  private async tick(symbol: string): Promise<void> {
    const mid = this.midPrice[symbol];
    if (!mid) return;

    // Random walk on mid price (±0.01-0.05%)
    const drift = mid.times(new Decimal((Math.random() - 0.5) * 0.001));
    this.midPrice[symbol] = mid.plus(drift).toDecimalPlaces(2);

    // Cancel 2-5 random old orders and replace them
    const orderIds = Array.from(this.activeOrderIds.keys());
    const symbolOrders = orderIds.filter((id) => this.activeOrderIds.get(id)?.symbol === symbol);
    const cancelCount = Math.min(Math.floor(2 + Math.random() * 3), symbolOrders.length);

    for (let i = 0; i < cancelCount; i++) {
      const idx = Math.floor(Math.random() * symbolOrders.length);
      const orderId = symbolOrders[idx];
      if (!orderId) continue;

      const orderInfo = this.activeOrderIds.get(orderId);
      if (!orderInfo) continue;

      // Cancel in engine
      await this.engine.cancelOrder(symbol, orderId);

      // Unlock in DB
      try {
        await withTransaction(async (client) => {
          await RiskService.unlockFundsForCancel(client, {
            userId: MM_USER_ID,
            symbol,
            side: orderInfo.side,
            price: orderInfo.price,
            remainingQuantity: orderInfo.quantity,
          });
        });
        await query(`UPDATE orders SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1`, [orderId]);
      } catch {
        // Ignore cancel errors for bot orders
      }

      this.activeOrderIds.delete(orderId);
      symbolOrders.splice(idx, 1);
    }

    // Place new replacement orders
    const newMid = this.midPrice[symbol];
    const tickSize = symbol === 'BTC-USD' ? new Decimal(10) : new Decimal(1);

    for (let i = 0; i < cancelCount; i++) {
      const side = Math.random() > 0.5 ? Side.BUY : Side.SELL;
      const offset = tickSize.times(Math.floor(1 + Math.random() * 15));
      const price = side === Side.BUY
        ? newMid.minus(offset).toDecimalPlaces(2)
        : newMid.plus(offset).toDecimalPlaces(2);
      const quantity = new Decimal(0.01 + Math.random() * 0.3).toDecimalPlaces(8);

      await this.placeMMOrder(symbol, side, price, quantity);
    }

    // 15% chance: cross the spread with a small market order for trade generation
    if (Math.random() < 0.15) {
      const side = Math.random() > 0.5 ? Side.BUY : Side.SELL;
      const quantity = new Decimal(0.001 + Math.random() * 0.05).toDecimalPlaces(8);

      const bestPrice = side === Side.BUY
        ? this.engine.getBestAsk(symbol)
        : this.engine.getBestBid(symbol);

      if (bestPrice) {
        await this.placeMMOrder(symbol, side, bestPrice, quantity, OrderType.MARKET);
      }
    }

    // Broadcast updated order book
    if (this.wsServer) {
      const snapshot = this.engine.getOrderBookSnapshot(symbol);
      this.wsServer.broadcastOrderBook(symbol, {
        symbol: snapshot.symbol,
        bids: snapshot.bids,
        asks: snapshot.asks,
        spread: snapshot.spread?.toString() || null,
        midPrice: snapshot.midPrice?.toString() || null,
        timestamp: snapshot.timestamp,
      });
    }
  }

  /**
   * Place a market maker order — handles DB insert, risk check, matching, and settlement.
   */
  private async placeMMOrder(
    symbol: string,
    side: Side,
    price: Decimal,
    quantity: Decimal,
    type: OrderType = OrderType.LIMIT
  ): Promise<void> {
    const orderId = uuidv4();

    try {
      // Lock funds in DB
      await withTransaction(async (client) => {
        await RiskService.lockFundsForOrder(client, {
          userId: MM_USER_ID,
          symbol,
          side,
          price,
          quantity,
        });

        await client.query(
          `INSERT INTO orders (id, user_id, symbol, side, type, price, quantity, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'OPEN')`,
          [orderId, MM_USER_ID, symbol, side, type, type === OrderType.LIMIT ? price.toFixed(8) : null, quantity.toFixed(8)]
        );
      });

      // Submit to engine
      const order = createOrder({
        id: orderId,
        userId: MM_USER_ID,
        symbol,
        side,
        type,
        price: price.toString(),
        quantity: quantity.toString(),
      });

      const trades = await this.engine.submitOrder(order);

      // Track active limit orders
      if (type === OrderType.LIMIT && order.status !== OrderStatus.FILLED) {
        this.activeOrderIds.set(orderId, { symbol, side, price, quantity: quantity.minus(order.filledQuantity) });
      }

      // Settle any resulting trades
      for (const trade of trades) {
        try {
          await SettlementService.settleTrade(trade);

          if (this.wsServer) {
            this.wsServer.broadcastTrade(symbol, {
              tradeId: trade.tradeId,
              symbol: trade.symbol,
              price: trade.price.toString(),
              quantity: trade.quantity.toString(),
              buyerId: trade.buyerId,
              sellerId: trade.sellerId,
              timestamp: trade.timestamp,
            });
          }
        } catch (settleErr: any) {
          console.error(`[MarketMaker] Settlement error:`, settleErr.message);
        }
      }

      // If market order was cancelled (unfilled portion), update DB + unlock
      if (order.status === OrderStatus.CANCELLED) {
        await query(`UPDATE orders SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1`, [orderId]);
        const remaining = order.quantity.minus(order.filledQuantity);
        if (remaining.gt(0)) {
          await withTransaction(async (client) => {
            await RiskService.unlockFundsForCancel(client, {
              userId: MM_USER_ID,
              symbol,
              side,
              price,
              remainingQuantity: remaining,
            });
          });
        }
      }
    } catch (err: any) {
      // Silently handle insufficient balance or other errors for the bot
      if (!err.message.includes('Insufficient')) {
        console.error(`[MarketMaker] Order error:`, err.message);
      }
    }
  }
}
