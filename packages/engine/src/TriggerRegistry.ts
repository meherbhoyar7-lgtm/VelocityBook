import Decimal from 'decimal.js';
import { Order, OrderType, OrderStatus, Side } from './types';

/**
 * TriggerRegistry — Isolated in-memory registry for conditional orders.
 *
 * Stop-Loss and Trailing-Stop orders are kept OFF the active L2 order book.
 * On each executed trade tick, the engine calls `onTradeTick()` which:
 *   1. Updates high-water marks for trailing stops
 *   2. Evaluates trigger conditions
 *   3. Returns activated orders (promoted to MARKET) for immediate matching
 *
 * This registry is fully isolated from the OrderBook's resting-order state.
 */
export class TriggerRegistry {
  /** Conditional orders indexed by symbol for fast per-symbol evaluation */
  private orders: Map<string, Order[]> = new Map();

  /** High-water mark per symbol (highest price seen for SELL trailing, lowest for BUY trailing) */
  private highWaterBuy: Map<string, Decimal> = new Map();   // lowest price seen
  private highWaterSell: Map<string, Decimal> = new Map();  // highest price seen

  // ─── Registration ────────────────────────────────────────────────

  /**
   * Register a stop-loss or trailing-stop order in the trigger registry.
   * The order is NOT placed on the L2 order book.
   */
  public register(order: Order): void {
    if (order.type !== OrderType.STOP_LOSS && order.type !== OrderType.TRAILING_STOP) {
      throw new Error(`TriggerRegistry only accepts STOP_LOSS and TRAILING_STOP, got: ${order.type}`);
    }
    order.status = OrderStatus.PENDING;

    const list = this.orders.get(order.symbol) || [];
    list.push(order);
    this.orders.set(order.symbol, list);
  }

  /**
   * Cancel a pending conditional order by ID.
   * @returns The cancelled order, or null if not found.
   */
  public cancel(orderId: string): Order | null {
    for (const [symbol, list] of this.orders.entries()) {
      const idx = list.findIndex((o) => o.id === orderId);
      if (idx !== -1) {
        const order = list[idx];
        list.splice(idx, 1);
        order.status = OrderStatus.CANCELLED;
        return order;
      }
    }
    return null;
  }

  // ─── Trade Tick Evaluation ───────────────────────────────────────

  /**
   * Called after each trade execution. Updates trailing-stop high-water
   * marks and evaluates all trigger conditions for the given symbol.
   *
   * @param symbol  The trading pair where the trade occurred
   * @param lastTradePrice  The execution price of the most recent trade
   * @returns  Array of orders whose triggers fired — already promoted to MARKET type
   */
  public onTradeTick(symbol: string, lastTradePrice: Decimal): Order[] {
    const list = this.orders.get(symbol);
    if (!list || list.length === 0) return [];

    // ── Update high-water marks ──
    this.updateHighWaterMarks(symbol, lastTradePrice);

    // ── Update trailing-stop prices ──
    this.updateTrailingStops(symbol, lastTradePrice);

    // ── Evaluate triggers ──
    const activated: Order[] = [];
    const remaining: Order[] = [];

    for (const order of list) {
      if (this.shouldTrigger(order, lastTradePrice)) {
        // Atomically promote to MARKET order
        order.type = OrderType.MARKET;
        order.status = OrderStatus.OPEN;
        activated.push(order);
      } else {
        remaining.push(order);
      }
    }

    this.orders.set(symbol, remaining);
    return activated;
  }

  // ─── Queries ─────────────────────────────────────────────────────

  /** Number of pending conditional orders for a symbol (or all symbols). */
  public getCount(symbol?: string): number {
    if (symbol) {
      return (this.orders.get(symbol) || []).length;
    }
    let total = 0;
    for (const list of this.orders.values()) {
      total += list.length;
    }
    return total;
  }

  /** Check if a specific order ID exists in the registry. */
  public has(orderId: string): boolean {
    for (const list of this.orders.values()) {
      if (list.some((o) => o.id === orderId)) return true;
    }
    return false;
  }

  /** Get the current high-water marks for a symbol (for testing/diagnostics). */
  public getHighWaterMarks(symbol: string): { buyHW: Decimal | null; sellHW: Decimal | null } {
    return {
      buyHW: this.highWaterBuy.get(symbol) || null,
      sellHW: this.highWaterSell.get(symbol) || null,
    };
  }

  // ─── Internals ───────────────────────────────────────────────────

  /**
   * Track high-water marks for trailing stops:
   *  - SELL trailing: track the HIGHEST price seen (user sells when price drops from peak)
   *  - BUY trailing:  track the LOWEST price seen  (user buys when price rises from trough)
   */
  private updateHighWaterMarks(symbol: string, price: Decimal): void {
    const currentHigh = this.highWaterSell.get(symbol);
    if (!currentHigh || price.gt(currentHigh)) {
      this.highWaterSell.set(symbol, price);
    }

    const currentLow = this.highWaterBuy.get(symbol);
    if (!currentLow || price.lt(currentLow)) {
      this.highWaterBuy.set(symbol, price);
    }
  }

  /**
   * Dynamically adjust trailing-stop stopPrices based on high-water marks.
   *
   * SELL trailing-stop: stopPrice = highWaterSell - trailingDelta
   *   As the market makes new highs, the stop ratchets up. It never moves down.
   *
   * BUY trailing-stop: stopPrice = highWaterBuy + trailingDelta
   *   As the market makes new lows, the stop ratchets down. It never moves up.
   */
  private updateTrailingStops(symbol: string, _lastTradePrice: Decimal): void {
    const list = this.orders.get(symbol);
    if (!list) return;

    const highSell = this.highWaterSell.get(symbol);
    const highBuy = this.highWaterBuy.get(symbol);

    for (const order of list) {
      if (order.type !== OrderType.TRAILING_STOP || !order.trailingDelta || !order.stopPrice) {
        continue;
      }

      if (order.side === Side.SELL && highSell) {
        // SELL trailing: stop ratchets UP as price makes new highs
        const candidateStop = highSell.minus(order.trailingDelta);
        if (candidateStop.gt(order.stopPrice)) {
          order.stopPrice = candidateStop;
        }
      } else if (order.side === Side.BUY && highBuy) {
        // BUY trailing: stop ratchets DOWN as price makes new lows
        const candidateStop = highBuy.plus(order.trailingDelta);
        if (candidateStop.lt(order.stopPrice)) {
          order.stopPrice = candidateStop;
        }
      }
    }
  }

  /**
   * Evaluate whether a stop/trailing-stop trigger condition is met.
   *
   * SELL stop-loss: triggers when price drops TO or BELOW stopPrice
   *   (user wants to exit before further losses)
   * BUY stop-loss:  triggers when price rises TO or ABOVE stopPrice
   *   (user wants to enter on breakout confirmation)
   */
  private shouldTrigger(order: Order, lastTradePrice: Decimal): boolean {
    if (!order.stopPrice) return false;

    if (order.side === Side.SELL) {
      // SELL: trigger when price <= stopPrice (price dropped to exit)
      return lastTradePrice.lte(order.stopPrice);
    } else {
      // BUY: trigger when price >= stopPrice (price rose to entry)
      return lastTradePrice.gte(order.stopPrice);
    }
  }
}
