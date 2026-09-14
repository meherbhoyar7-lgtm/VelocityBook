import { EventEmitter } from 'events';
import Decimal from 'decimal.js';
import { OrderBook } from './OrderBook';
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
 * Manages multiple OrderBooks (one per trading pair) and emits events
 * for every trade, order placement, cancellation, and book change.
 *
 * This is a pure in-memory component with zero I/O on the critical path.
 * Settlement, persistence, and broadcasting are handled by downstream
 * listeners subscribed to the event emitter.
 */
export class MatchingEngine extends EventEmitter {
  private books: Map<string, OrderBook> = new Map();
  private supportedSymbols: Set<string>;

  constructor(symbols: string[] = ['BTC-USD', 'ETH-USD']) {
    super();
    this.supportedSymbols = new Set(symbols);
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
   * 2. Attempt to match against the opposite book
   * 3. Rest any unfilled LIMIT quantity on the book
   * 4. Emit trade and order events
   *
   * @returns Array of trades that resulted from matching
   */
  public submitOrder(order: Order): TradeExecution[] {
    this.validateOrder(order);

    const book = this.books.get(order.symbol);
    if (!book) {
      throw new Error(`Unsupported symbol: ${order.symbol}`);
    }

    // Execute matching
    const trades = book.addOrder(order);

    // Emit events
    if (trades.length > 0) {
      for (const trade of trades) {
        this.emit('event', { type: 'trade', data: trade } as EngineEvent);
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
   *
   * @returns The cancelled order, or null if not found on the book
   */
  public cancelOrder(symbol: string, orderId: string): Order | null {
    const book = this.books.get(symbol);
    if (!book) {
      throw new Error(`Unsupported symbol: ${symbol}`);
    }

    const cancelled = book.cancelOrder(orderId);
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

  /**
   * Get the L2 order book snapshot for a symbol.
   */
  public getOrderBookSnapshot(symbol: string, depth: number = 25): OrderBookSnapshot {
    const book = this.books.get(symbol);
    if (!book) {
      throw new Error(`Unsupported symbol: ${symbol}`);
    }
    return book.getSnapshot(depth);
  }

  /**
   * Get the best bid price for a symbol.
   */
  public getBestBid(symbol: string): Decimal | null {
    const book = this.books.get(symbol);
    return book ? book.getBestBid() : null;
  }

  /**
   * Get the best ask price for a symbol.
   */
  public getBestAsk(symbol: string): Decimal | null {
    const book = this.books.get(symbol);
    return book ? book.getBestAsk() : null;
  }

  /**
   * Get the mid-market price for a symbol.
   */
  public getMidPrice(symbol: string): Decimal | null {
    const book = this.books.get(symbol);
    return book ? book.getMidPrice() : null;
  }

  /**
   * Get the spread for a symbol.
   */
  public getSpread(symbol: string): Decimal | null {
    const book = this.books.get(symbol);
    return book ? book.getSpread() : null;
  }

  /**
   * Check if an order exists on any book.
   */
  public hasOrder(symbol: string, orderId: string): boolean {
    const book = this.books.get(symbol);
    return book ? book.hasOrder(orderId) : false;
  }

  /**
   * Get the total number of resting orders across all books.
   */
  public getTotalOrderCount(): number {
    let count = 0;
    for (const book of this.books.values()) {
      count += book.getOrderCount();
    }
    return count;
  }

  /**
   * Get all supported symbols.
   */
  public getSymbols(): string[] {
    return Array.from(this.supportedSymbols);
  }

  /**
   * Get the OrderBook instance for a symbol (for advanced access).
   */
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

    if (![OrderType.LIMIT, OrderType.MARKET].includes(order.type)) {
      throw new Error(`Invalid order type: ${order.type}`);
    }

    if (order.quantity.lte(0)) {
      throw new Error('Order quantity must be positive');
    }

    if (order.type === OrderType.LIMIT && order.price.lte(0)) {
      throw new Error('Limit order must have a positive price');
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
  };
}
