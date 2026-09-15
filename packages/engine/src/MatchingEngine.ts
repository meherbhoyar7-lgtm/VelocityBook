import { EventEmitter } from 'events';
import Decimal from 'decimal.js';
import { OrderBook } from './OrderBook';
import { TriggerRegistry } from './TriggerRegistry';
import {
  Order,
  Side,
  OrderType,
  OrderStatus,
  TradeExecution,
  EngineEvent,
  OrderBookSnapshot,
} from './types';

/**
 * MatchingEngine — the top-level orchestrator.
 *
 * Manages multiple OrderBooks (one per trading pair) and an isolated
 * TriggerRegistry for conditional orders (Stop-Loss, Trailing-Stop).
 *
 * Emits events for every trade, order placement, cancellation, stop
 * trigger, and book change.
 *
 * This is a pure in-memory component with zero I/O on the critical path.
 * Settlement, persistence, and broadcasting are handled by downstream
 * listeners subscribed to the event emitter.
 */
export class MatchingEngine extends EventEmitter {
  private books: Map<string, OrderBook> = new Map();
  private supportedSymbols: Set<string>;

  /** Isolated trigger registry for stop-loss and trailing-stop orders */
  public readonly triggerRegistry: TriggerRegistry;

  constructor(symbols: string[] = ['BTC-USD', 'ETH-USD']) {
    super();
    this.supportedSymbols = new Set(symbols);
    this.triggerRegistry = new TriggerRegistry();

    for (const symbol of symbols) {
      this.books.set(symbol, new OrderBook(symbol));
    }
  }

  // ─── Order Submission ────────────────────────────────────────────

  /**
   * Submit an order to the matching engine.
   *
   * The engine will:
   * 1. Validate the order
   * 2. Route to the correct handler (book or trigger registry)
   * 3. Attempt to match against the opposite book
   * 4. On each trade: evaluate trigger registry for stop activations
   * 5. Emit trade, order, and stop-trigger events
   *
   * @returns Array of all trades that resulted from matching (including stop activations)
   */
  public submitOrder(order: Order): TradeExecution[] {
    this.validateOrder(order);

    const book = this.books.get(order.symbol);
    if (!book) {
      throw new Error(`Unsupported symbol: ${order.symbol}`);
    }

    // ── Route stop/trailing-stop to TriggerRegistry (off-book) ──
    if (order.type === OrderType.STOP_LOSS || order.type === OrderType.TRAILING_STOP) {
      this.triggerRegistry.register(order);
      this.emit('event', { type: 'order_placed', data: order } as EngineEvent);
      return [];
    }

    // ── Execute matching on the book ──
    const trades = book.addOrder(order);

    // Emit trade events
    for (const trade of trades) {
      this.emit('event', { type: 'trade', data: trade } as EngineEvent);
    }

    // ── After trades: evaluate triggers ──
    if (trades.length > 0) {
      const lastTradePrice = trades[trades.length - 1].price;
      const activatedOrders = this.triggerRegistry.onTradeTick(order.symbol, lastTradePrice);

      // Process each activated stop order through the book
      for (const activated of activatedOrders) {
        this.emit('event', { type: 'stop_triggered', data: activated } as EngineEvent);

        const stopTrades: TradeExecution[] = [];
        book.matchMarketOrder(activated, stopTrades);

        if (activated.filledQuantity.gte(activated.quantity)) {
          activated.status = OrderStatus.FILLED;
        } else if (activated.filledQuantity.gt(0)) {
          activated.status = OrderStatus.PARTIALLY_FILLED;
        } else {
          activated.status = OrderStatus.CANCELLED;
        }

        for (const stopTrade of stopTrades) {
          this.emit('event', { type: 'trade', data: stopTrade } as EngineEvent);
        }
        trades.push(...stopTrades);
      }
    }

    this.emit('event', { type: 'order_placed', data: order } as EngineEvent);
    this.emit('event', {
      type: 'orderbook_changed',
      data: { symbol: order.symbol },
    } as EngineEvent);

    return trades;
  }

  // ─── Order Cancellation ──────────────────────────────────────────

  /**
   * Cancel an order by ID and symbol.
   * Checks both the resting order book and the trigger registry.
   *
   * @returns The cancelled order, or null if not found
   */
  public cancelOrder(symbol: string, orderId: string): Order | null {
    const book = this.books.get(symbol);
    if (!book) {
      throw new Error(`Unsupported symbol: ${symbol}`);
    }

    // Try resting book orders first
    let cancelled = book.cancelOrder(orderId);

    // Try trigger registry if not found on book
    if (!cancelled) {
      cancelled = this.triggerRegistry.cancel(orderId);
    }

    if (cancelled) {
      this.emit('event', { type: 'order_cancelled', data: cancelled } as EngineEvent);
      this.emit('event', {
        type: 'orderbook_changed',
        data: { symbol },
      } as EngineEvent);
    }

    return cancelled;
  }

  // ─── Queries ─────────────────────────────────────────────────────

  public getOrderBookSnapshot(symbol: string, depth: number = 25): OrderBookSnapshot {
    const book = this.books.get(symbol);
    if (!book) {
      throw new Error(`Unsupported symbol: ${symbol}`);
    }
    return book.getSnapshot(depth);
  }

  public getBestBid(symbol: string): Decimal | null {
    const book = this.books.get(symbol);
    return book ? book.getBestBid() : null;
  }

  public getBestAsk(symbol: string): Decimal | null {
    const book = this.books.get(symbol);
    return book ? book.getBestAsk() : null;
  }

  public getMidPrice(symbol: string): Decimal | null {
    const book = this.books.get(symbol);
    return book ? book.getMidPrice() : null;
  }

  public getSpread(symbol: string): Decimal | null {
    const book = this.books.get(symbol);
    return book ? book.getSpread() : null;
  }

  public hasOrder(symbol: string, orderId: string): boolean {
    const book = this.books.get(symbol);
    if (book && book.hasOrder(orderId)) return true;
    return this.triggerRegistry.has(orderId);
  }

  public getTotalOrderCount(): number {
    let count = 0;
    for (const book of this.books.values()) {
      count += book.getOrderCount();
    }
    return count;
  }

  public getSymbols(): string[] {
    return Array.from(this.supportedSymbols);
  }

  public getBook(symbol: string): OrderBook | undefined {
    return this.books.get(symbol);
  }

  // ─── Validation ──────────────────────────────────────────────────

  private validateOrder(order: Order): void {
    if (!order.id || order.id.trim().length === 0) {
      throw new Error('Order must have a valid ID');
    }

    if (!order.userId || order.userId.trim().length === 0) {
      throw new Error('Order must have a valid userId');
    }

    if (!this.supportedSymbols.has(order.symbol)) {
      throw new Error(`Unsupported symbol: ${order.symbol}. Supported: ${Array.from(this.supportedSymbols).join(', ')}`);
    }

    if (![Side.BUY, Side.SELL].includes(order.side)) {
      throw new Error(`Invalid side: ${order.side}`);
    }

    const validTypes = [
      OrderType.LIMIT, OrderType.MARKET,
      OrderType.STOP_LOSS, OrderType.ICEBERG,
      OrderType.TRAILING_STOP, OrderType.FILL_OR_KILL,
    ];
    if (!validTypes.includes(order.type)) {
      throw new Error(`Invalid order type: ${order.type}`);
    }

    if (order.quantity.lte(0)) {
      throw new Error('Order quantity must be positive');
    }

    if (order.type === OrderType.LIMIT && order.price.lte(0)) {
      throw new Error('Limit order must have a positive price');
    }

    // Stop orders require a stopPrice
    if (
      (order.type === OrderType.STOP_LOSS || order.type === OrderType.TRAILING_STOP) &&
      (!order.stopPrice || order.stopPrice.lte(0))
    ) {
      throw new Error('Stop orders must have a positive stopPrice');
    }

    // Iceberg orders require a positive price (they rest on the book)
    if (order.type === OrderType.ICEBERG && order.price.lte(0)) {
      throw new Error('Iceberg order must have a positive price');
    }
  }
}

// ─── Helper: Create an Order object ────────────────────────────────

let orderCounter = 0;

export function createOrder(params: {
  userId: string;
  symbol: string;
  side: Side;
  type: OrderType;
  price: number | string;
  quantity: number | string;
  id?: string;
  stopPrice?: number | string;
  trailingDelta?: number | string;
  displayQty?: number | string;
}): Order {
  orderCounter++;
  return {
    id: params.id || `ORD-${orderCounter}-${Date.now()}`,
    userId: params.userId,
    symbol: params.symbol,
    side: params.side,
    type: params.type,
    price: new Decimal(params.price),
    quantity: new Decimal(params.quantity),
    filledQuantity: new Decimal(0),
    status: OrderStatus.PENDING,
    timestamp: Date.now(),
    ...(params.stopPrice !== undefined && { stopPrice: new Decimal(params.stopPrice) }),
    ...(params.trailingDelta !== undefined && { trailingDelta: new Decimal(params.trailingDelta) }),
    ...(params.displayQty !== undefined && { displayQty: new Decimal(params.displayQty) }),
  };
}
