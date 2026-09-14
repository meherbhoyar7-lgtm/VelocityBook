import Decimal from 'decimal.js';
import {
  Order,
  Side,
  OrderType,
  OrderStatus,
  PriceLevel,
  OrderBookSnapshot,
  PriceLevelSnapshot,
  TradeExecution,
} from './types';

/**
 * In-Memory Order Book with Price-Time Priority.
 *
 * Bids (buyers) are sorted highest price → lowest.
 * Asks (sellers) are sorted lowest price → highest.
 * Within each price level, orders are queued FIFO by arrival time.
 *
 * The orderIndex Map<OrderId, Order> enables O(1) lookups and cancellations.
 */
export class OrderBook {
  public readonly symbol: string;

  /** Bid levels sorted highest price first */
  private bids: PriceLevel[] = [];

  /** Ask levels sorted lowest price first */
  private asks: PriceLevel[] = [];

  /** O(1) order lookup by ID for instant cancellation */
  private orderIndex: Map<string, { order: Order; levelIndex: number; side: Side }> = new Map();

  private tradeIdCounter = 0;

  constructor(symbol: string) {
    this.symbol = symbol;
  }

  // ─── Public API ──────────────────────────────────────────────────

  /**
   * Add an order to the book. Returns any resulting trades.
   * LIMIT orders match against the opposite side if crossing the spread,
   * then rest the unfilled remainder on the book.
   * MARKET orders sweep the opposite side until filled or liquidity exhausted.
   */
  public addOrder(order: Order): TradeExecution[] {
    const trades: TradeExecution[] = [];

    if (order.type === OrderType.MARKET) {
      this.matchMarketOrder(order, trades);
    } else {
      this.matchLimitOrder(order, trades);
    }

    // If LIMIT order has remaining quantity, rest it on the book
    if (
      order.type === OrderType.LIMIT &&
      order.status !== OrderStatus.FILLED &&
      order.status !== OrderStatus.CANCELLED
    ) {
      const remainingQty = order.quantity.minus(order.filledQuantity);
      if (remainingQty.gt(0)) {
        this.insertOrder(order);
        order.status =
          order.filledQuantity.gt(0) ? OrderStatus.PARTIALLY_FILLED : OrderStatus.OPEN;
      }
    }

    // MARKET orders that couldn't fully fill are cancelled
    if (order.type === OrderType.MARKET && order.quantity.minus(order.filledQuantity).gt(0)) {
      order.status = OrderStatus.CANCELLED;
    }

    return trades;
  }

  /**
   * Cancel an order by ID. Returns the cancelled order or null if not found.
   */
  public cancelOrder(orderId: string): Order | null {
    const entry = this.orderIndex.get(orderId);
    if (!entry) return null;

    const { order, side } = entry;
    const levels = side === Side.BUY ? this.bids : this.asks;

    // Find the price level
    const levelIdx = this.findLevelIndex(levels, order.price, side);
    if (levelIdx === -1) return null;

    const level = levels[levelIdx];

    // Remove order from the FIFO queue
    const orderIdx = level.orders.findIndex((o) => o.id === orderId);
    if (orderIdx === -1) return null;

    level.orders.splice(orderIdx, 1);
    const remainingQty = order.quantity.minus(order.filledQuantity);
    level.totalQuantity = level.totalQuantity.minus(remainingQty);

    // If level is empty, remove it
    if (level.orders.length === 0) {
      levels.splice(levelIdx, 1);
    }

    // Clean up index
    this.orderIndex.delete(orderId);
    order.status = OrderStatus.CANCELLED;

    return order;
  }

  /**
   * Get the best (highest) bid price, or null if empty.
   */
  public getBestBid(): Decimal | null {
    return this.bids.length > 0 ? this.bids[0].price : null;
  }

  /**
   * Get the best (lowest) ask price, or null if empty.
   */
  public getBestAsk(): Decimal | null {
    return this.asks.length > 0 ? this.asks[0].price : null;
  }

  /**
   * Get the spread (best ask - best bid), or null if either side is empty.
   */
  public getSpread(): Decimal | null {
    const bestBid = this.getBestBid();
    const bestAsk = this.getBestAsk();
    if (!bestBid || !bestAsk) return null;
    return bestAsk.minus(bestBid);
  }

  /**
   * Get the mid-market price, or null if either side is empty.
   */
  public getMidPrice(): Decimal | null {
    const bestBid = this.getBestBid();
    const bestAsk = this.getBestAsk();
    if (!bestBid || !bestAsk) return null;
    return bestBid.plus(bestAsk).div(2);
  }

  /**
   * Check if a specific order exists on the book.
   */
  public hasOrder(orderId: string): boolean {
    return this.orderIndex.has(orderId);
  }

  /**
   * Get the total number of resting orders on both sides.
   */
  public getOrderCount(): number {
    return this.orderIndex.size;
  }

  /**
   * Get a full L2 snapshot of the book (top N levels each side).
   */
  public getSnapshot(depth: number = 25): OrderBookSnapshot {
    const bidSnap = this.getLevelSnapshots(this.bids, depth);
    const askSnap = this.getLevelSnapshots(this.asks, depth);

    return {
      symbol: this.symbol,
      bids: bidSnap,
      asks: askSnap,
      spread: this.getSpread(),
      midPrice: this.getMidPrice(),
      timestamp: Date.now(),
    };
  }

  /**
   * Get raw bid levels (for testing / internal use).
   */
  public getBidLevels(): ReadonlyArray<PriceLevel> {
    return this.bids;
  }

  /**
   * Get raw ask levels (for testing / internal use).
   */
  public getAskLevels(): ReadonlyArray<PriceLevel> {
    return this.asks;
  }

  // ─── Matching Logic ──────────────────────────────────────────────

  /**
   * Match a LIMIT order against the opposite book.
   * Buy LIMIT: match against asks where ask.price <= buy.price
   * Sell LIMIT: match against bids where bid.price >= sell.price
   */
  private matchLimitOrder(order: Order, trades: TradeExecution[]): void {
    const oppositeLevels = order.side === Side.BUY ? this.asks : this.bids;

    while (oppositeLevels.length > 0) {
      const bestLevel = oppositeLevels[0];
      const remainingQty = order.quantity.minus(order.filledQuantity);

      if (remainingQty.lte(0)) break;

      // Check if price crosses
      if (order.side === Side.BUY && bestLevel.price.gt(order.price)) break;
      if (order.side === Side.SELL && bestLevel.price.lt(order.price)) break;

      this.matchAtLevel(order, bestLevel, oppositeLevels, trades);
    }

    if (order.filledQuantity.gte(order.quantity)) {
      order.status = OrderStatus.FILLED;
    }
  }

  /**
   * Match a MARKET order — sweep the opposite book until filled or empty.
   */
  private matchMarketOrder(order: Order, trades: TradeExecution[]): void {
    const oppositeLevels = order.side === Side.BUY ? this.asks : this.bids;

    while (oppositeLevels.length > 0) {
      const remainingQty = order.quantity.minus(order.filledQuantity);
      if (remainingQty.lte(0)) break;

      const bestLevel = oppositeLevels[0];
      this.matchAtLevel(order, bestLevel, oppositeLevels, trades);
    }

    if (order.filledQuantity.gte(order.quantity)) {
      order.status = OrderStatus.FILLED;
    }
  }

  /**
   * Execute matches at a single price level.
   * Walks the FIFO queue, filling against resting orders.
   */
  private matchAtLevel(
    incomingOrder: Order,
    level: PriceLevel,
    levels: PriceLevel[],
    trades: TradeExecution[]
  ): void {
    while (level.orders.length > 0) {
      const remainingQty = incomingOrder.quantity.minus(incomingOrder.filledQuantity);
      if (remainingQty.lte(0)) break;

      const restingOrder = level.orders[0];
      const restingRemainingQty = restingOrder.quantity.minus(restingOrder.filledQuantity);
      const fillQty = Decimal.min(remainingQty, restingRemainingQty);

      // Execute the trade at the resting order's price
      const trade = this.createTrade(incomingOrder, restingOrder, level.price, fillQty);
      trades.push(trade);

      // Update fill quantities
      incomingOrder.filledQuantity = incomingOrder.filledQuantity.plus(fillQty);
      restingOrder.filledQuantity = restingOrder.filledQuantity.plus(fillQty);

      // Update level total
      level.totalQuantity = level.totalQuantity.minus(fillQty);

      // Check if resting order is fully filled
      if (restingOrder.filledQuantity.gte(restingOrder.quantity)) {
        restingOrder.status = OrderStatus.FILLED;
        level.orders.shift(); // Remove from FIFO queue head
        this.orderIndex.delete(restingOrder.id);
      } else {
        restingOrder.status = OrderStatus.PARTIALLY_FILLED;
      }
    }

    // If level is depleted, remove it
    if (level.orders.length === 0) {
      levels.shift();
    }
  }

  // ─── Book Insertion ──────────────────────────────────────────────

  /**
   * Insert a resting order into the correct side of the book.
   * Maintains price sorting and FIFO within each level.
   */
  private insertOrder(order: Order): void {
    const levels = order.side === Side.BUY ? this.bids : this.asks;
    const remainingQty = order.quantity.minus(order.filledQuantity);

    // Find or create the price level
    let levelIdx = this.findLevelIndex(levels, order.price, order.side);

    if (levelIdx !== -1 && levels[levelIdx].price.eq(order.price)) {
      // Existing level — append to FIFO queue
      levels[levelIdx].orders.push(order);
      levels[levelIdx].totalQuantity = levels[levelIdx].totalQuantity.plus(remainingQty);
    } else {
      // New level — insert at correct sorted position
      const newLevel: PriceLevel = {
        price: order.price,
        orders: [order],
        totalQuantity: remainingQty,
      };

      const insertIdx = this.findInsertIndex(levels, order.price, order.side);
      levels.splice(insertIdx, 0, newLevel);
      levelIdx = insertIdx;
    }

    // Register in the O(1) index
    this.orderIndex.set(order.id, { order, levelIndex: levelIdx, side: order.side });
  }

  // ─── Helpers ─────────────────────────────────────────────────────

  /**
   * Find the index of a price level. Returns -1 if not found.
   */
  private findLevelIndex(levels: PriceLevel[], price: Decimal, side: Side): number {
    for (let i = 0; i < levels.length; i++) {
      if (levels[i].price.eq(price)) return i;
      // Early exit since levels are sorted
      if (side === Side.BUY && levels[i].price.lt(price)) return -1;
      if (side === Side.SELL && levels[i].price.gt(price)) return -1;
    }
    return -1;
  }

  /**
   * Find the correct insertion index to maintain sort order.
   * Bids: descending (highest first). Asks: ascending (lowest first).
   */
  private findInsertIndex(levels: PriceLevel[], price: Decimal, side: Side): number {
    for (let i = 0; i < levels.length; i++) {
      if (side === Side.BUY && levels[i].price.lt(price)) return i;
      if (side === Side.SELL && levels[i].price.gt(price)) return i;
    }
    return levels.length;
  }

  /**
   * Create a TradeExecution event from an incoming and resting order match.
   */
  private createTrade(
    incomingOrder: Order,
    restingOrder: Order,
    price: Decimal,
    quantity: Decimal
  ): TradeExecution {
    this.tradeIdCounter++;

    const isBuy = incomingOrder.side === Side.BUY;
    return {
      tradeId: `T-${this.symbol}-${this.tradeIdCounter}-${Date.now()}`,
      symbol: this.symbol,
      buyOrderId: isBuy ? incomingOrder.id : restingOrder.id,
      sellOrderId: isBuy ? restingOrder.id : incomingOrder.id,
      buyerId: isBuy ? incomingOrder.userId : restingOrder.userId,
      sellerId: isBuy ? restingOrder.userId : incomingOrder.userId,
      price,
      quantity,
      timestamp: Date.now(),
    };
  }

  /**
   * Convert price levels to snapshot format with cumulative depth.
   */
  private getLevelSnapshots(levels: PriceLevel[], depth: number): PriceLevelSnapshot[] {
    const snapshots: PriceLevelSnapshot[] = [];
    let cumulative = new Decimal(0);

    const count = Math.min(levels.length, depth);
    for (let i = 0; i < count; i++) {
      cumulative = cumulative.plus(levels[i].totalQuantity);
      snapshots.push({
        price: levels[i].price.toFixed(2),
        size: levels[i].totalQuantity.toFixed(8),
        total: cumulative.toFixed(8),
      });
    }

    return snapshots;
  }
}
