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
 *
 * Supported order types on the book:
 *  - LIMIT / MARKET     — standard matching
 *  - ICEBERG            — only displayQty rests on the book; hiddenQty replenishes
 *                         atomically with refreshed FIFO priority at the price level
 *  - FILL_OR_KILL (FOK) — pre-walk validates 100% fill; zero partial fills on rejection
 *
 * Stop-Loss and Trailing-Stop orders are managed by TriggerRegistry (off-book).
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
   *
   * Routing by order type:
   *  LIMIT        → match opposite side, then rest remainder on book
   *  MARKET       → sweep opposite side until filled or exhausted
   *  ICEBERG      → insert only displayQty on the book (hiddenQty stays off-book)
   *  FILL_OR_KILL → pre-walk validates 100% fill; atomic reject if insufficient
   *
   * Stop-Loss / Trailing-Stop are NOT handled here — use TriggerRegistry.
   */
  public addOrder(order: Order): TradeExecution[] {
    const trades: TradeExecution[] = [];

    switch (order.type) {
      // ── Fill-or-Kill: reject immediately if not enough liquidity ─
      case OrderType.FILL_OR_KILL: {
        if (!this.canFillEntirely(order)) {
          order.status = OrderStatus.CANCELLED;
          return trades; // Zero partial fills — book untouched
        }
        // Sufficient liquidity → execute as immediate market sweep
        this.matchMarketOrder(order, trades);
        order.status = order.filledQuantity.eq(order.quantity)
          ? OrderStatus.FILLED
          : OrderStatus.CANCELLED;
        return trades;
      }

      // ── Iceberg: insert visible slice only ──────────────────────
      case OrderType.ICEBERG: {
        this.initIcebergDefaults(order);
        // Set the order's quantity to the visible slice for book depth
        const sliceQty = Decimal.min(order.displayQty!, order.hiddenQty!);
        order.quantity = sliceQty;
        order.hiddenQty = order.hiddenQty!.minus(sliceQty);
        order.status = OrderStatus.OPEN;
        this.insertOrder(order);
        return trades;
      }

      // ── Standard LIMIT / MARKET (+ triggered stop orders promoted to MARKET) ─
      default: {
        if (order.type === OrderType.MARKET) {
          this.matchMarketOrder(order, trades);
        } else {
          this.matchLimitOrder(order, trades);
        }
        break;
      }
    }

    // Rest unfilled LIMIT quantity on the book
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

  // ─── Order Cancellation ────────────────────────────────────────

  /**
   * Cancel an order by ID. Returns the cancelled order or null if not found.
   */
  public cancelOrder(orderId: string): Order | null {
    const entry = this.orderIndex.get(orderId);
    if (!entry) return null;

    const { order, side } = entry;
    const levels = side === Side.BUY ? this.bids : this.asks;

    const levelIdx = this.findLevelIndex(levels, order.price, side);
    if (levelIdx === -1) return null;

    const level = levels[levelIdx];
    const orderIdx = level.orders.findIndex((o) => o.id === orderId);
    if (orderIdx === -1) return null;

    level.orders.splice(orderIdx, 1);
    const remainingQty = order.quantity.minus(order.filledQuantity);
    level.totalQuantity = level.totalQuantity.minus(remainingQty);

    if (level.orders.length === 0) {
      levels.splice(levelIdx, 1);
    }

    this.orderIndex.delete(orderId);
    order.status = OrderStatus.CANCELLED;
    return order;
  }

  // ─── Queries ─────────────────────────────────────────────────────

  public getBestBid(): Decimal | null {
    return this.bids.length > 0 ? this.bids[0].price : null;
  }

  public getBestAsk(): Decimal | null {
    return this.asks.length > 0 ? this.asks[0].price : null;
  }

  public getSpread(): Decimal | null {
    const bestBid = this.getBestBid();
    const bestAsk = this.getBestAsk();
    if (!bestBid || !bestAsk) return null;
    return bestAsk.minus(bestBid);
  }

  public getMidPrice(): Decimal | null {
    const bestBid = this.getBestBid();
    const bestAsk = this.getBestAsk();
    if (!bestBid || !bestAsk) return null;
    return bestBid.plus(bestAsk).div(2);
  }

  public hasOrder(orderId: string): boolean {
    return this.orderIndex.has(orderId);
  }

  public getOrderCount(): number {
    return this.orderIndex.size;
  }

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

  public getBidLevels(): ReadonlyArray<PriceLevel> {
    return this.bids;
  }

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
  public matchMarketOrder(order: Order, trades: TradeExecution[]): void {
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
   * Handles iceberg slice replenishment atomically on fill.
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

        // ── Iceberg replenishment ──
        // If hidden quantity remains, atomically create a new visible slice
        // and insert at the TAIL of this price level (refreshed FIFO priority)
        if (
          restingOrder.type === OrderType.ICEBERG &&
          restingOrder.hiddenQty &&
          restingOrder.hiddenQty.gt(0)
        ) {
          const sliceSize = restingOrder.displayQty || new Decimal(1);
          const newSliceQty = Decimal.min(sliceSize, restingOrder.hiddenQty);
          const remainingHidden = restingOrder.hiddenQty.minus(newSliceQty);

          const iceSlice: Order = {
            id: `${restingOrder.id}-ice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            userId: restingOrder.userId,
            symbol: restingOrder.symbol,
            side: restingOrder.side,
            type: OrderType.ICEBERG,
            price: restingOrder.price,
            quantity: newSliceQty,
            filledQuantity: new Decimal(0),
            status: OrderStatus.OPEN,
            timestamp: Date.now(),
            displayQty: sliceSize,
            hiddenQty: remainingHidden,
          };

          // Insert at tail of price level (after all existing orders)
          this.insertOrder(iceSlice);
        }
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
    const depthQty = order.quantity.minus(order.filledQuantity);

    let levelIdx = this.findLevelIndex(levels, order.price, order.side);

    if (levelIdx !== -1 && levels[levelIdx].price.eq(order.price)) {
      // Existing level — append to FIFO queue (tail = refreshed priority)
      levels[levelIdx].orders.push(order);
      levels[levelIdx].totalQuantity = levels[levelIdx].totalQuantity.plus(depthQty);
    } else {
      // New level — insert at correct sorted position
      const newLevel: PriceLevel = {
        price: order.price,
        orders: [order],
        totalQuantity: depthQty,
      };
      const insertIdx = this.findInsertIndex(levels, order.price, order.side);
      levels.splice(insertIdx, 0, newLevel);
      levelIdx = insertIdx;
    }

    this.orderIndex.set(order.id, { order, levelIndex: levelIdx, side: order.side });
  }

  // ─── Iceberg Helpers ─────────────────────────────────────────────

  /**
   * Initialize default iceberg fields if not already set.
   * displayQty defaults to 10% of total quantity (minimum 1 unit).
   * hiddenQty defaults to total quantity.
   */
  private initIcebergDefaults(order: Order): void {
    if (order.hiddenQty === undefined) {
      order.hiddenQty = order.quantity;
    }
    if (!order.displayQty || order.displayQty.lte(0)) {
      const tenPercent = order.quantity.div(10);
      order.displayQty = tenPercent.gte(1) ? tenPercent : new Decimal(1);
    }
  }

  // ─── Fill-or-Kill Validation ─────────────────────────────────────

  /**
   * Pre-walk the opposite book to determine if the ENTIRE order quantity
   * can be filled immediately. Does NOT mutate any state.
   * This guarantees zero partial fills on rejection.
   */
  private canFillEntirely(order: Order): boolean {
    const opposite = order.side === Side.BUY ? this.asks : this.bids;
    let available = new Decimal(0);

    for (const level of opposite) {
      available = available.plus(level.totalQuantity);
      if (available.gte(order.quantity)) return true;
    }

    return false;
  }

  // ─── Helpers ─────────────────────────────────────────────────────

  /**
   * Find the index of a price level. Returns -1 if not found.
   */
  private findLevelIndex(levels: PriceLevel[], price: Decimal, side: Side): number {
    for (let i = 0; i < levels.length; i++) {
      if (levels[i].price.eq(price)) return i;
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
