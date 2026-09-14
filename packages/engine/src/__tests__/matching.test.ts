import { describe, it, expect, beforeEach } from 'vitest';
import Decimal from 'decimal.js';
import { OrderBook } from '../OrderBook';
import { MatchingEngine, createOrder } from '../MatchingEngine';
import { Side, OrderType, OrderStatus, TradeExecution, Order } from '../types';

// ═════════════════════════════════════════════════════════════════════
// OrderBook Unit Tests
// ═════════════════════════════════════════════════════════════════════

describe('OrderBook', () => {
  let book: OrderBook;

  beforeEach(() => {
    book = new OrderBook('BTC-USD');
  });

  // ─── Sorting Tests ─────────────────────────────────────────────

  describe('Price Level Sorting', () => {
    it('should sort bids highest to lowest', () => {
      const orders = [
        createOrder({ userId: 'u1', symbol: 'BTC-USD', side: Side.BUY, type: OrderType.LIMIT, price: '100', quantity: '1' }),
        createOrder({ userId: 'u2', symbol: 'BTC-USD', side: Side.BUY, type: OrderType.LIMIT, price: '102', quantity: '1' }),
        createOrder({ userId: 'u3', symbol: 'BTC-USD', side: Side.BUY, type: OrderType.LIMIT, price: '101', quantity: '1' }),
      ];

      for (const order of orders) {
        book.addOrder(order);
      }

      const levels = book.getBidLevels();
      expect(levels.length).toBe(3);
      expect(levels[0].price.toNumber()).toBe(102);
      expect(levels[1].price.toNumber()).toBe(101);
      expect(levels[2].price.toNumber()).toBe(100);
    });

    it('should sort asks lowest to highest', () => {
      const orders = [
        createOrder({ userId: 'u1', symbol: 'BTC-USD', side: Side.SELL, type: OrderType.LIMIT, price: '200', quantity: '1' }),
        createOrder({ userId: 'u2', symbol: 'BTC-USD', side: Side.SELL, type: OrderType.LIMIT, price: '198', quantity: '1' }),
        createOrder({ userId: 'u3', symbol: 'BTC-USD', side: Side.SELL, type: OrderType.LIMIT, price: '199', quantity: '1' }),
      ];

      for (const order of orders) {
        book.addOrder(order);
      }

      const levels = book.getAskLevels();
      expect(levels.length).toBe(3);
      expect(levels[0].price.toNumber()).toBe(198);
      expect(levels[1].price.toNumber()).toBe(199);
      expect(levels[2].price.toNumber()).toBe(200);
    });
  });

  // ─── FIFO (Price-Time Priority) Tests ──────────────────────────

  describe('Price-Time Priority (FIFO)', () => {
    it('should fill the earliest order first at the same price', () => {
      // Two sell orders at the same price
      const sell1 = createOrder({ userId: 'seller1', symbol: 'BTC-USD', side: Side.SELL, type: OrderType.LIMIT, price: '100', quantity: '1', id: 'sell-1' });
      const sell2 = createOrder({ userId: 'seller2', symbol: 'BTC-USD', side: Side.SELL, type: OrderType.LIMIT, price: '100', quantity: '1', id: 'sell-2' });

      book.addOrder(sell1);
      book.addOrder(sell2);

      // Buy order that can only fill 1 unit
      const buy = createOrder({ userId: 'buyer1', symbol: 'BTC-USD', side: Side.BUY, type: OrderType.LIMIT, price: '100', quantity: '1', id: 'buy-1' });
      const trades = book.addOrder(buy);

      expect(trades.length).toBe(1);
      // Should match against sell1 (first in queue)
      expect(trades[0].sellOrderId).toBe('sell-1');
      expect(trades[0].buyOrderId).toBe('buy-1');

      // sell2 should still be on the book
      expect(book.hasOrder('sell-2')).toBe(true);
      expect(book.hasOrder('sell-1')).toBe(false); // filled and removed
    });
  });

  // ─── Partial Fill Tests ────────────────────────────────────────

  describe('Partial Fills', () => {
    it('should partially fill a limit order and rest the remainder', () => {
      // Sell 0.5 BTC at $100
      const sell = createOrder({ userId: 'seller', symbol: 'BTC-USD', side: Side.SELL, type: OrderType.LIMIT, price: '100', quantity: '0.5' });
      book.addOrder(sell);

      // Buy 1 BTC at $100 — should match 0.5 and rest 0.5
      const buy = createOrder({ userId: 'buyer', symbol: 'BTC-USD', side: Side.BUY, type: OrderType.LIMIT, price: '100', quantity: '1' });
      const trades = book.addOrder(buy);

      expect(trades.length).toBe(1);
      expect(trades[0].quantity.toNumber()).toBe(0.5);

      // Buy order should rest on the book with 0.5 remaining
      expect(buy.filledQuantity.toNumber()).toBe(0.5);
      expect(buy.status).toBe(OrderStatus.PARTIALLY_FILLED);
      expect(book.hasOrder(buy.id)).toBe(true);

      // Sell order should be fully filled
      expect(sell.status).toBe(OrderStatus.FILLED);
    });

    it('should fill against multiple resting orders at different prices', () => {
      // Sells at different prices
      book.addOrder(createOrder({ userId: 's1', symbol: 'BTC-USD', side: Side.SELL, type: OrderType.LIMIT, price: '100', quantity: '0.3' }));
      book.addOrder(createOrder({ userId: 's2', symbol: 'BTC-USD', side: Side.SELL, type: OrderType.LIMIT, price: '101', quantity: '0.3' }));
      book.addOrder(createOrder({ userId: 's3', symbol: 'BTC-USD', side: Side.SELL, type: OrderType.LIMIT, price: '102', quantity: '0.3' }));

      // Buy 0.7 BTC at $101 — should match 0.3 at $100 + 0.3 at $101, then rest 0.1 on bid book
      const buy = createOrder({ userId: 'buyer', symbol: 'BTC-USD', side: Side.BUY, type: OrderType.LIMIT, price: '101', quantity: '0.7' });
      const trades = book.addOrder(buy);

      expect(trades.length).toBe(2);
      // First trade at $100 (best ask, fully consumed)
      expect(trades[0].price.toNumber()).toBe(100);
      expect(trades[0].quantity.toNumber()).toBe(0.3);
      // Second trade at $101 (fully consumed the 0.3 sell at $101)
      expect(trades[1].price.toNumber()).toBe(101);
      expect(trades[1].quantity.toNumber()).toBe(0.3);

      // Buy is partially filled (0.6 of 0.7), 0.1 remains resting on bid book
      expect(buy.filledQuantity.toNumber()).toBe(0.6);
      expect(buy.status).toBe(OrderStatus.PARTIALLY_FILLED);

      // The $102 sell should remain untouched (price > buy limit)
      expect(book.getAskLevels().length).toBe(1);
      expect(book.getAskLevels()[0].price.toNumber()).toBe(102);
    });
  });

  // ─── Market Order Tests ────────────────────────────────────────

  describe('Market Orders', () => {
    it('should sweep multiple price levels', () => {
      book.addOrder(createOrder({ userId: 's1', symbol: 'BTC-USD', side: Side.SELL, type: OrderType.LIMIT, price: '100', quantity: '1' }));
      book.addOrder(createOrder({ userId: 's2', symbol: 'BTC-USD', side: Side.SELL, type: OrderType.LIMIT, price: '101', quantity: '1' }));
      book.addOrder(createOrder({ userId: 's3', symbol: 'BTC-USD', side: Side.SELL, type: OrderType.LIMIT, price: '102', quantity: '1' }));

      const marketBuy = createOrder({ userId: 'buyer', symbol: 'BTC-USD', side: Side.BUY, type: OrderType.MARKET, price: '0', quantity: '2.5' });
      const trades = book.addOrder(marketBuy);

      expect(trades.length).toBe(3);
      expect(trades[0].price.toNumber()).toBe(100);
      expect(trades[0].quantity.toNumber()).toBe(1);
      expect(trades[1].price.toNumber()).toBe(101);
      expect(trades[1].quantity.toNumber()).toBe(1);
      expect(trades[2].price.toNumber()).toBe(102);
      expect(trades[2].quantity.toNumber()).toBe(0.5);

      // $102 level should have 0.5 remaining
      expect(book.getAskLevels().length).toBe(1);
      expect(book.getAskLevels()[0].totalQuantity.toNumber()).toBe(0.5);
    });

    it('should cancel unfilled portion of market order on empty book', () => {
      book.addOrder(createOrder({ userId: 's1', symbol: 'BTC-USD', side: Side.SELL, type: OrderType.LIMIT, price: '100', quantity: '1' }));

      const marketBuy = createOrder({ userId: 'buyer', symbol: 'BTC-USD', side: Side.BUY, type: OrderType.MARKET, price: '0', quantity: '5' });
      const trades = book.addOrder(marketBuy);

      expect(trades.length).toBe(1);
      expect(marketBuy.filledQuantity.toNumber()).toBe(1);
      expect(marketBuy.status).toBe(OrderStatus.CANCELLED);
    });

    it('should handle market order on completely empty book', () => {
      const marketBuy = createOrder({ userId: 'buyer', symbol: 'BTC-USD', side: Side.BUY, type: OrderType.MARKET, price: '0', quantity: '1' });
      const trades = book.addOrder(marketBuy);

      expect(trades.length).toBe(0);
      expect(marketBuy.status).toBe(OrderStatus.CANCELLED);
    });
  });

  // ─── Cancellation Tests ────────────────────────────────────────

  describe('Order Cancellation', () => {
    it('should cancel an order by ID in O(1) lookup', () => {
      const order = createOrder({ userId: 'u1', symbol: 'BTC-USD', side: Side.BUY, type: OrderType.LIMIT, price: '100', quantity: '1', id: 'cancel-me' });
      book.addOrder(order);

      expect(book.hasOrder('cancel-me')).toBe(true);

      const cancelled = book.cancelOrder('cancel-me');
      expect(cancelled).not.toBeNull();
      expect(cancelled!.id).toBe('cancel-me');
      expect(cancelled!.status).toBe(OrderStatus.CANCELLED);
      expect(book.hasOrder('cancel-me')).toBe(false);
    });

    it('should return null when cancelling non-existent order', () => {
      const result = book.cancelOrder('does-not-exist');
      expect(result).toBeNull();
    });

    it('should remove empty price level after cancellation', () => {
      const order = createOrder({ userId: 'u1', symbol: 'BTC-USD', side: Side.BUY, type: OrderType.LIMIT, price: '100', quantity: '1', id: 'only-at-level' });
      book.addOrder(order);

      expect(book.getBidLevels().length).toBe(1);

      book.cancelOrder('only-at-level');

      expect(book.getBidLevels().length).toBe(0);
    });
  });

  // ─── Spread & Mid Price Tests ──────────────────────────────────

  describe('Spread & Mid Price', () => {
    it('should calculate spread correctly', () => {
      book.addOrder(createOrder({ userId: 'u1', symbol: 'BTC-USD', side: Side.BUY, type: OrderType.LIMIT, price: '99', quantity: '1' }));
      book.addOrder(createOrder({ userId: 'u2', symbol: 'BTC-USD', side: Side.SELL, type: OrderType.LIMIT, price: '101', quantity: '1' }));

      expect(book.getSpread()!.toNumber()).toBe(2);
      expect(book.getMidPrice()!.toNumber()).toBe(100);
    });

    it('should return null spread when one side is empty', () => {
      book.addOrder(createOrder({ userId: 'u1', symbol: 'BTC-USD', side: Side.BUY, type: OrderType.LIMIT, price: '100', quantity: '1' }));

      expect(book.getSpread()).toBeNull();
      expect(book.getMidPrice()).toBeNull();
    });
  });

  // ─── Snapshot Tests ────────────────────────────────────────────

  describe('Snapshots', () => {
    it('should return correct L2 snapshot with cumulative depth', () => {
      book.addOrder(createOrder({ userId: 'u1', symbol: 'BTC-USD', side: Side.BUY, type: OrderType.LIMIT, price: '100', quantity: '2' }));
      book.addOrder(createOrder({ userId: 'u2', symbol: 'BTC-USD', side: Side.BUY, type: OrderType.LIMIT, price: '99', quantity: '3' }));
      book.addOrder(createOrder({ userId: 'u3', symbol: 'BTC-USD', side: Side.SELL, type: OrderType.LIMIT, price: '101', quantity: '1.5' }));

      const snapshot = book.getSnapshot();

      expect(snapshot.symbol).toBe('BTC-USD');
      expect(snapshot.bids.length).toBe(2);
      expect(snapshot.asks.length).toBe(1);

      // Bid cumulative: 2 at 100, then 2+3=5 at 99
      expect(snapshot.bids[0].price).toBe('100.00');
      expect(snapshot.bids[0].total).toBe('2.00000000');
      expect(snapshot.bids[1].total).toBe('5.00000000');
    });
  });
});

// ═════════════════════════════════════════════════════════════════════
// MatchingEngine Integration Tests
// ═════════════════════════════════════════════════════════════════════

describe('MatchingEngine', () => {
  let engine: MatchingEngine;

  beforeEach(() => {
    engine = new MatchingEngine(['BTC-USD', 'ETH-USD']);
  });

  it('should emit trade events on match', () => {
    const events: any[] = [];
    engine.on('event', (e) => events.push(e));

    engine.submitOrder(createOrder({ userId: 's1', symbol: 'BTC-USD', side: Side.SELL, type: OrderType.LIMIT, price: '100', quantity: '1' }));
    engine.submitOrder(createOrder({ userId: 'b1', symbol: 'BTC-USD', side: Side.BUY, type: OrderType.LIMIT, price: '100', quantity: '1' }));

    const tradeEvents = events.filter((e) => e.type === 'trade');
    expect(tradeEvents.length).toBe(1);
    expect(tradeEvents[0].data.price.toNumber()).toBe(100);
    expect(tradeEvents[0].data.quantity.toNumber()).toBe(1);
  });

  it('should reject orders for unsupported symbols', () => {
    expect(() => {
      engine.submitOrder(createOrder({ userId: 'u1', symbol: 'DOGE-USD', side: Side.BUY, type: OrderType.LIMIT, price: '1', quantity: '100' }));
    }).toThrow('Unsupported symbol');
  });

  it('should reject orders with zero quantity', () => {
    expect(() => {
      engine.submitOrder(createOrder({ userId: 'u1', symbol: 'BTC-USD', side: Side.BUY, type: OrderType.LIMIT, price: '100', quantity: '0' }));
    }).toThrow('Order quantity must be positive');
  });

  it('should track order count across submissions and matches', () => {
    engine.submitOrder(createOrder({ userId: 's1', symbol: 'BTC-USD', side: Side.SELL, type: OrderType.LIMIT, price: '100', quantity: '1' }));
    engine.submitOrder(createOrder({ userId: 's2', symbol: 'BTC-USD', side: Side.SELL, type: OrderType.LIMIT, price: '101', quantity: '1' }));
    expect(engine.getTotalOrderCount()).toBe(2);

    // This buy matches the sell at 100, leaving only the 101 sell
    engine.submitOrder(createOrder({ userId: 'b1', symbol: 'BTC-USD', side: Side.BUY, type: OrderType.LIMIT, price: '100', quantity: '1' }));
    expect(engine.getTotalOrderCount()).toBe(1);
  });

  it('should cancel orders and emit events', () => {
    const events: any[] = [];
    engine.on('event', (e) => events.push(e));

    const order = createOrder({ userId: 'u1', symbol: 'BTC-USD', side: Side.BUY, type: OrderType.LIMIT, price: '100', quantity: '1', id: 'to-cancel' });
    engine.submitOrder(order);

    const cancelled = engine.cancelOrder('BTC-USD', 'to-cancel');
    expect(cancelled).not.toBeNull();
    expect(cancelled!.status).toBe(OrderStatus.CANCELLED);

    const cancelEvents = events.filter((e) => e.type === 'order_cancelled');
    expect(cancelEvents.length).toBe(1);
  });

  it('should handle concurrent trading across multiple symbols', () => {
    engine.submitOrder(createOrder({ userId: 's1', symbol: 'BTC-USD', side: Side.SELL, type: OrderType.LIMIT, price: '50000', quantity: '1' }));
    engine.submitOrder(createOrder({ userId: 's2', symbol: 'ETH-USD', side: Side.SELL, type: OrderType.LIMIT, price: '3000', quantity: '10' }));

    const btcTrades = engine.submitOrder(createOrder({ userId: 'b1', symbol: 'BTC-USD', side: Side.BUY, type: OrderType.LIMIT, price: '50000', quantity: '1' }));
    const ethTrades = engine.submitOrder(createOrder({ userId: 'b2', symbol: 'ETH-USD', side: Side.BUY, type: OrderType.LIMIT, price: '3000', quantity: '5' }));

    expect(btcTrades.length).toBe(1);
    expect(ethTrades.length).toBe(1);
    expect(ethTrades[0].quantity.toNumber()).toBe(5);

    // ETH book should have 5 remaining
    const ethBook = engine.getBook('ETH-USD')!;
    expect(ethBook.getAskLevels()[0].totalQuantity.toNumber()).toBe(5);
  });

  it('should return correct snapshots', () => {
    engine.submitOrder(createOrder({ userId: 'u1', symbol: 'BTC-USD', side: Side.BUY, type: OrderType.LIMIT, price: '49000', quantity: '2' }));
    engine.submitOrder(createOrder({ userId: 'u2', symbol: 'BTC-USD', side: Side.SELL, type: OrderType.LIMIT, price: '51000', quantity: '1' }));

    const snapshot = engine.getOrderBookSnapshot('BTC-USD');
    expect(snapshot.bids.length).toBe(1);
    expect(snapshot.asks.length).toBe(1);
    expect(snapshot.spread!.toNumber()).toBe(2000);
    expect(snapshot.midPrice!.toNumber()).toBe(50000);
  });
});
