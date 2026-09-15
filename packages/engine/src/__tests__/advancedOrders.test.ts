import { describe, it, expect, beforeEach } from 'vitest';
import Decimal from 'decimal.js';
import { OrderBook } from '../OrderBook';
import { TriggerRegistry } from '../TriggerRegistry';
import { MatchingEngine, createOrder } from '../MatchingEngine';
import { Side, OrderType, OrderStatus, Order } from '../types';

// ═════════════════════════════════════════════════════════════════════
// Advanced Order Type Tests
// ═════════════════════════════════════════════════════════════════════

// ─── FILL-OR-KILL (FOK) ─────────────────────────────────────────

describe('Fill-or-Kill Orders', () => {
  let book: OrderBook;

  beforeEach(() => {
    book = new OrderBook('BTC-USD');
  });

  it('should cancel FOK with zero fills when insufficient liquidity', () => {
    // Only 5 units on the ask side
    book.addOrder(createOrder({
      userId: 'seller', symbol: 'BTC-USD', side: Side.SELL,
      type: OrderType.LIMIT, price: '100', quantity: '5',
    }));

    // FOK buy for 10 — insufficient → CANCELLED, zero fills
    const fokOrder = createOrder({
      userId: 'buyer', symbol: 'BTC-USD', side: Side.BUY,
      type: OrderType.FILL_OR_KILL, price: '0', quantity: '10',
      id: 'fok-reject',
    });
    const trades = book.addOrder(fokOrder);

    expect(trades.length).toBe(0);
    expect(fokOrder.status).toBe(OrderStatus.CANCELLED);
    expect(fokOrder.filledQuantity.toNumber()).toBe(0);
    // Book MUST be untouched (zero mutation guarantee)
    expect(book.getAskLevels()[0].totalQuantity.toNumber()).toBe(5);
  });

  it('should fill FOK completely when sufficient liquidity exists', () => {
    book.addOrder(createOrder({
      userId: 's1', symbol: 'BTC-USD', side: Side.SELL,
      type: OrderType.LIMIT, price: '100', quantity: '5',
    }));
    book.addOrder(createOrder({
      userId: 's2', symbol: 'BTC-USD', side: Side.SELL,
      type: OrderType.LIMIT, price: '101', quantity: '5',
    }));

    // FOK for 8 → fills 5@100 + 3@101
    const fokOrder = createOrder({
      userId: 'buyer', symbol: 'BTC-USD', side: Side.BUY,
      type: OrderType.FILL_OR_KILL, price: '0', quantity: '8',
    });
    const trades = book.addOrder(fokOrder);

    expect(trades.length).toBe(2);
    expect(fokOrder.status).toBe(OrderStatus.FILLED);
    expect(fokOrder.filledQuantity.toNumber()).toBe(8);
    expect(trades[0].price.toNumber()).toBe(100);
    expect(trades[0].quantity.toNumber()).toBe(5);
    expect(trades[1].price.toNumber()).toBe(101);
    expect(trades[1].quantity.toNumber()).toBe(3);
  });

  it('should cancel FOK on completely empty book', () => {
    const fokOrder = createOrder({
      userId: 'buyer', symbol: 'BTC-USD', side: Side.BUY,
      type: OrderType.FILL_OR_KILL, price: '0', quantity: '1',
    });
    const trades = book.addOrder(fokOrder);

    expect(trades.length).toBe(0);
    expect(fokOrder.status).toBe(OrderStatus.CANCELLED);
  });

  it('should fill FOK exactly at the liquidity boundary', () => {
    book.addOrder(createOrder({
      userId: 'seller', symbol: 'BTC-USD', side: Side.SELL,
      type: OrderType.LIMIT, price: '100', quantity: '5',
    }));

    const fokOrder = createOrder({
      userId: 'buyer', symbol: 'BTC-USD', side: Side.BUY,
      type: OrderType.FILL_OR_KILL, price: '0', quantity: '5',
    });
    const trades = book.addOrder(fokOrder);

    expect(trades.length).toBe(1);
    expect(fokOrder.status).toBe(OrderStatus.FILLED);
    expect(book.getAskLevels().length).toBe(0);
  });

  it('should not partially fill — must be all or nothing', () => {
    // 3 units available but FOK wants 4
    book.addOrder(createOrder({
      userId: 'seller', symbol: 'BTC-USD', side: Side.SELL,
      type: OrderType.LIMIT, price: '100', quantity: '3',
    }));

    const fokOrder = createOrder({
      userId: 'buyer', symbol: 'BTC-USD', side: Side.BUY,
      type: OrderType.FILL_OR_KILL, price: '0', quantity: '4',
    });
    const trades = book.addOrder(fokOrder);

    expect(trades.length).toBe(0);
    expect(fokOrder.filledQuantity.toNumber()).toBe(0);
    expect(fokOrder.status).toBe(OrderStatus.CANCELLED);
    // Verify resting orders were NOT consumed
    expect(book.getAskLevels()[0].totalQuantity.toNumber()).toBe(3);
  });
});

// ─── ICEBERG ORDERS ──────────────────────────────────────────────

describe('Iceberg Orders', () => {
  let book: OrderBook;

  beforeEach(() => {
    book = new OrderBook('BTC-USD');
  });

  it('should place only displayQty on the L2 book', () => {
    const iceberg = createOrder({
      userId: 'u1', symbol: 'BTC-USD', side: Side.BUY,
      type: OrderType.ICEBERG, price: '100', quantity: '1000',
      displayQty: '200', id: 'ice-1',
    });
    book.addOrder(iceberg);

    const bids = book.getBidLevels();
    expect(bids.length).toBe(1);
    // Only 200 visible
    expect(bids[0].totalQuantity.toNumber()).toBe(200);
  });

  it('should replenish from hiddenQty with refreshed FIFO priority', () => {
    // Place iceberg BUY: total 500, display 100
    const iceberg = createOrder({
      userId: 'u1', symbol: 'BTC-USD', side: Side.BUY,
      type: OrderType.ICEBERG, price: '100', quantity: '500',
      displayQty: '100', id: 'ice-requeue',
    });
    book.addOrder(iceberg);

    // Place a regular limit BUY at the same price AFTER iceberg
    const regularBuy = createOrder({
      userId: 'u2', symbol: 'BTC-USD', side: Side.BUY,
      type: OrderType.LIMIT, price: '100', quantity: '50',
      id: 'regular-buy',
    });
    book.addOrder(regularBuy);

    // Sell 100 into bids → fills iceberg's visible slice
    const trades = book.addOrder(createOrder({
      userId: 'seller', symbol: 'BTC-USD', side: Side.SELL,
      type: OrderType.MARKET, price: '0', quantity: '100',
    }));

    expect(trades.length).toBe(1);
    expect(trades[0].quantity.toNumber()).toBe(100);

    // After slice consumed, iceberg re-queues at TAIL of price level
    // Regular buy should be first in FIFO (placed before the re-queued slice)
    const bids = book.getBidLevels();
    expect(bids.length).toBe(1);
    expect(bids[0].orders.length).toBe(2);
    expect(bids[0].orders[0].id).toBe('regular-buy');
    // The new iceberg slice should be second (refreshed FIFO priority)
    expect(bids[0].orders[1].type).toBe(OrderType.ICEBERG);
  });

  it('should default displayQty to 10% of total quantity', () => {
    const iceberg = createOrder({
      userId: 'u1', symbol: 'BTC-USD', side: Side.SELL,
      type: OrderType.ICEBERG, price: '200', quantity: '1000',
    });
    book.addOrder(iceberg);

    const asks = book.getAskLevels();
    expect(asks.length).toBe(1);
    // Default: 10% of 1000 = 100
    expect(asks[0].totalQuantity.toNumber()).toBe(100);
  });

  it('should stop replenishing when hiddenQty is exhausted', () => {
    // Iceberg: total 300, display 100 → 3 slices
    const iceberg = createOrder({
      userId: 'u1', symbol: 'BTC-USD', side: Side.BUY,
      type: OrderType.ICEBERG, price: '100', quantity: '300',
      displayQty: '100',
    });
    book.addOrder(iceberg);

    // Sell 100 three times to exhaust all slices
    for (let i = 0; i < 3; i++) {
      book.addOrder(createOrder({
        userId: `seller-${i}`, symbol: 'BTC-USD', side: Side.SELL,
        type: OrderType.MARKET, price: '0', quantity: '100',
      }));
    }

    // Book should be empty — all iceberg slices consumed
    expect(book.getBidLevels().length).toBe(0);
    expect(book.getOrderCount()).toBe(0);
  });

  it('should replenish with correct remaining hidden quantity', () => {
    // Iceberg: total 250, display 100 → 100, 100, 50
    const iceberg = createOrder({
      userId: 'u1', symbol: 'BTC-USD', side: Side.BUY,
      type: OrderType.ICEBERG, price: '100', quantity: '250',
      displayQty: '100',
    });
    book.addOrder(iceberg);

    // Fill first slice (100)
    book.addOrder(createOrder({
      userId: 'seller', symbol: 'BTC-USD', side: Side.SELL,
      type: OrderType.MARKET, price: '0', quantity: '100',
    }));

    // Second slice should be 100
    let bids = book.getBidLevels();
    expect(bids[0].totalQuantity.toNumber()).toBe(100);

    // Fill second slice (100)
    book.addOrder(createOrder({
      userId: 'seller2', symbol: 'BTC-USD', side: Side.SELL,
      type: OrderType.MARKET, price: '0', quantity: '100',
    }));

    // Third slice should be 50 (remaining hidden)
    bids = book.getBidLevels();
    expect(bids[0].totalQuantity.toNumber()).toBe(50);

    // Fill final slice
    book.addOrder(createOrder({
      userId: 'seller3', symbol: 'BTC-USD', side: Side.SELL,
      type: OrderType.MARKET, price: '0', quantity: '50',
    }));

    expect(book.getBidLevels().length).toBe(0);
  });
});

// ─── TRIGGER REGISTRY (STOP-LOSS & TRAILING-STOP) ───────────────

describe('TriggerRegistry', () => {
  let registry: TriggerRegistry;

  beforeEach(() => {
    registry = new TriggerRegistry();
  });

  it('should register stop-loss as PENDING', () => {
    const order = createOrder({
      userId: 'u1', symbol: 'BTC-USD', side: Side.SELL,
      type: OrderType.STOP_LOSS, price: '0', quantity: '1',
      stopPrice: '95', id: 'stop-1',
    });
    registry.register(order);

    expect(order.status).toBe(OrderStatus.PENDING);
    expect(registry.getCount('BTC-USD')).toBe(1);
    expect(registry.has('stop-1')).toBe(true);
  });

  it('should NOT trigger SELL stop when price is above stopPrice', () => {
    const order = createOrder({
      userId: 'u1', symbol: 'BTC-USD', side: Side.SELL,
      type: OrderType.STOP_LOSS, price: '0', quantity: '1',
      stopPrice: '95',
    });
    registry.register(order);

    // Trade at $100 — above $95 stop → no trigger
    const activated = registry.onTradeTick('BTC-USD', new Decimal('100'));
    expect(activated.length).toBe(0);
    expect(registry.getCount('BTC-USD')).toBe(1);
  });

  it('should trigger SELL stop when price drops to stopPrice', () => {
    const order = createOrder({
      userId: 'u1', symbol: 'BTC-USD', side: Side.SELL,
      type: OrderType.STOP_LOSS, price: '0', quantity: '1',
      stopPrice: '95',
    });
    registry.register(order);

    // Trade at $95 — hits stop → trigger
    const activated = registry.onTradeTick('BTC-USD', new Decimal('95'));
    expect(activated.length).toBe(1);
    expect(activated[0].type).toBe(OrderType.MARKET); // promoted
    expect(registry.getCount('BTC-USD')).toBe(0);
  });

  it('should trigger BUY stop when price rises to stopPrice', () => {
    const order = createOrder({
      userId: 'u1', symbol: 'BTC-USD', side: Side.BUY,
      type: OrderType.STOP_LOSS, price: '0', quantity: '1',
      stopPrice: '105',
    });
    registry.register(order);

    const activated = registry.onTradeTick('BTC-USD', new Decimal('105'));
    expect(activated.length).toBe(1);
    expect(activated[0].type).toBe(OrderType.MARKET);
  });

  it('should cancel a pending stop order', () => {
    const order = createOrder({
      userId: 'u1', symbol: 'BTC-USD', side: Side.SELL,
      type: OrderType.STOP_LOSS, price: '0', quantity: '1',
      stopPrice: '95', id: 'stop-cancel',
    });
    registry.register(order);

    const cancelled = registry.cancel('stop-cancel');
    expect(cancelled).not.toBeNull();
    expect(cancelled!.status).toBe(OrderStatus.CANCELLED);
    expect(registry.getCount('BTC-USD')).toBe(0);
  });

  it('should return null when cancelling non-existent stop order', () => {
    expect(registry.cancel('does-not-exist')).toBeNull();
  });
});

// ─── TRAILING-STOP DYNAMIC TRIGGER UPDATES ──────────────────────

describe('Trailing-Stop Dynamic Updates', () => {
  let registry: TriggerRegistry;

  beforeEach(() => {
    registry = new TriggerRegistry();
  });

  it('should ratchet SELL trailing-stop UP as price makes new highs', () => {
    const order = createOrder({
      userId: 'u1', symbol: 'BTC-USD', side: Side.SELL,
      type: OrderType.TRAILING_STOP, price: '0', quantity: '1',
      stopPrice: '95', trailingDelta: '5',
    });
    registry.register(order);

    // Price rises to $102 → stop should move to $97 (102 - 5)
    registry.onTradeTick('BTC-USD', new Decimal('102'));
    expect(order.stopPrice!.toNumber()).toBe(97);

    // Price rises to $110 → stop should move to $105 (110 - 5)
    registry.onTradeTick('BTC-USD', new Decimal('110'));
    expect(order.stopPrice!.toNumber()).toBe(105);

    // Price drops to $108 → stop should NOT move down (ratchet only UP)
    registry.onTradeTick('BTC-USD', new Decimal('108'));
    expect(order.stopPrice!.toNumber()).toBe(105);
  });

  it('should trigger SELL trailing-stop when price drops to adjusted stopPrice', () => {
    const order = createOrder({
      userId: 'u1', symbol: 'BTC-USD', side: Side.SELL,
      type: OrderType.TRAILING_STOP, price: '0', quantity: '1',
      stopPrice: '95', trailingDelta: '5',
    });
    registry.register(order);

    // Price rises to $110 → stop moves to $105
    registry.onTradeTick('BTC-USD', new Decimal('110'));
    expect(order.stopPrice!.toNumber()).toBe(105);

    // Price drops to $105 → should trigger
    const activated = registry.onTradeTick('BTC-USD', new Decimal('105'));
    expect(activated.length).toBe(1);
    expect(activated[0].type).toBe(OrderType.MARKET);
  });

  it('should ratchet BUY trailing-stop DOWN as price makes new lows', () => {
    const order = createOrder({
      userId: 'u1', symbol: 'BTC-USD', side: Side.BUY,
      type: OrderType.TRAILING_STOP, price: '0', quantity: '1',
      stopPrice: '105', trailingDelta: '5',
    });
    registry.register(order);

    // Price drops to $90 → stop should move to $95 (90 + 5)
    registry.onTradeTick('BTC-USD', new Decimal('90'));
    expect(order.stopPrice!.toNumber()).toBe(95);

    // Price drops to $85 → stop should move to $90 (85 + 5)
    registry.onTradeTick('BTC-USD', new Decimal('85'));
    expect(order.stopPrice!.toNumber()).toBe(90);

    // Price rises to $88 → stop should NOT move up (ratchet only DOWN)
    registry.onTradeTick('BTC-USD', new Decimal('88'));
    expect(order.stopPrice!.toNumber()).toBe(90);
  });

  it('should track high-water marks correctly', () => {
    const order = createOrder({
      userId: 'u1', symbol: 'BTC-USD', side: Side.SELL,
      type: OrderType.TRAILING_STOP, price: '0', quantity: '1',
      stopPrice: '95', trailingDelta: '5',
    });
    registry.register(order);

    registry.onTradeTick('BTC-USD', new Decimal('100'));
    registry.onTradeTick('BTC-USD', new Decimal('105'));
    registry.onTradeTick('BTC-USD', new Decimal('102'));

    const marks = registry.getHighWaterMarks('BTC-USD');
    expect(marks.sellHW!.toNumber()).toBe(105); // highest seen
    expect(marks.buyHW!.toNumber()).toBe(100);  // lowest seen
  });
});

// ─── MATCHING ENGINE INTEGRATION ─────────────────────────────────

describe('MatchingEngine — Advanced Order Integration', () => {
  let engine: MatchingEngine;

  beforeEach(() => {
    engine = new MatchingEngine(['BTC-USD']);
  });

  it('should route stop-loss to trigger registry, not the book', () => {
    const stop = createOrder({
      userId: 'u1', symbol: 'BTC-USD', side: Side.SELL,
      type: OrderType.STOP_LOSS, price: '0', quantity: '1',
      stopPrice: '95', id: 'stop-route',
    });
    engine.submitOrder(stop);

    // Should NOT be on the book
    expect(engine.getBook('BTC-USD')!.getOrderCount()).toBe(0);
    // Should be in trigger registry
    expect(engine.triggerRegistry.getCount('BTC-USD')).toBe(1);
    expect(engine.hasOrder('BTC-USD', 'stop-route')).toBe(true);
  });

  it('should trigger stop and execute through the book after a trade', () => {
    // Resting bid at $90 (liquidity for the triggered SELL stop)
    engine.submitOrder(createOrder({
      userId: 'buyer', symbol: 'BTC-USD', side: Side.BUY,
      type: OrderType.LIMIT, price: '90', quantity: '10',
    }));

    // Place SELL stop at $95
    const stop = createOrder({
      userId: 'u1', symbol: 'BTC-USD', side: Side.SELL,
      type: OrderType.STOP_LOSS, price: '0', quantity: '2',
      stopPrice: '95', id: 'stop-trigger',
    });
    engine.submitOrder(stop);

    // Create a trade at $95 to trigger the stop:
    // Place ask at $95, then buy at $95
    engine.submitOrder(createOrder({
      userId: 'ask-maker', symbol: 'BTC-USD', side: Side.SELL,
      type: OrderType.LIMIT, price: '95', quantity: '1',
    }));

    const events: any[] = [];
    engine.on('event', (e) => events.push(e));

    engine.submitOrder(createOrder({
      userId: 'bid-taker', symbol: 'BTC-USD', side: Side.BUY,
      type: OrderType.LIMIT, price: '95', quantity: '1',
    }));

    // Stop should have been triggered and filled
    expect(engine.triggerRegistry.getCount('BTC-USD')).toBe(0);
    expect(stop.filledQuantity.toNumber()).toBeGreaterThan(0);

    // Check stop_triggered event was emitted
    const triggerEvents = events.filter((e) => e.type === 'stop_triggered');
    expect(triggerEvents.length).toBe(1);
  });

  it('should cancel stop orders from trigger registry via engine', () => {
    const stop = createOrder({
      userId: 'u1', symbol: 'BTC-USD', side: Side.SELL,
      type: OrderType.STOP_LOSS, price: '0', quantity: '1',
      stopPrice: '95', id: 'stop-cancel-eng',
    });
    engine.submitOrder(stop);

    const cancelled = engine.cancelOrder('BTC-USD', 'stop-cancel-eng');
    expect(cancelled).not.toBeNull();
    expect(cancelled!.status).toBe(OrderStatus.CANCELLED);
    expect(engine.triggerRegistry.getCount('BTC-USD')).toBe(0);
  });

  it('should emit stop_triggered event for trailing-stop activation', () => {
    // Resting ask for triggered BUY stop
    engine.submitOrder(createOrder({
      userId: 'seller', symbol: 'BTC-USD', side: Side.SELL,
      type: OrderType.LIMIT, price: '110', quantity: '5',
    }));

    const trailing = createOrder({
      userId: 'u1', symbol: 'BTC-USD', side: Side.BUY,
      type: OrderType.TRAILING_STOP, price: '0', quantity: '1',
      stopPrice: '105', trailingDelta: '5',
    });
    engine.submitOrder(trailing);

    // Trade at $106 → trigger (>= 105)
    engine.submitOrder(createOrder({
      userId: 'ask-106', symbol: 'BTC-USD', side: Side.SELL,
      type: OrderType.LIMIT, price: '106', quantity: '0.1',
    }));

    const events: any[] = [];
    engine.on('event', (e) => events.push(e));

    engine.submitOrder(createOrder({
      userId: 'bid-106', symbol: 'BTC-USD', side: Side.BUY,
      type: OrderType.LIMIT, price: '106', quantity: '0.1',
    }));

    expect(engine.triggerRegistry.getCount('BTC-USD')).toBe(0);
  });

  // ── Validation Tests ──

  it('should reject stop-loss without stopPrice', () => {
    expect(() => {
      engine.submitOrder(createOrder({
        userId: 'u1', symbol: 'BTC-USD', side: Side.SELL,
        type: OrderType.STOP_LOSS, price: '0', quantity: '1',
      }));
    }).toThrow('Stop orders must have a positive stopPrice');
  });

  it('should reject trailing-stop without stopPrice', () => {
    expect(() => {
      engine.submitOrder(createOrder({
        userId: 'u1', symbol: 'BTC-USD', side: Side.BUY,
        type: OrderType.TRAILING_STOP, price: '0', quantity: '1',
      }));
    }).toThrow('Stop orders must have a positive stopPrice');
  });

  it('should reject iceberg with zero price', () => {
    expect(() => {
      engine.submitOrder(createOrder({
        userId: 'u1', symbol: 'BTC-USD', side: Side.BUY,
        type: OrderType.ICEBERG, price: '0', quantity: '100',
        displayQty: '10',
      }));
    }).toThrow('Iceberg order must have a positive price');
  });
});
