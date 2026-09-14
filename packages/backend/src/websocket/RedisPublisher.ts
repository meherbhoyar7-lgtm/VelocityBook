import Redis from 'ioredis';
import { TradeExecution, OrderBookSnapshot } from '@velocitybook/engine';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

/**
 * RedisPublisher — Pub/Sub bridge between matching engine and WebSocket server.
 *
 * Publishes trade executions and order book updates to Redis channels
 * so the WebSocket server can broadcast to all connected clients.
 */
export class RedisPublisher {
  private pub: Redis;
  private sub: Redis;
  private handlers: Map<string, Set<(data: any) => void>> = new Map();

  constructor() {
    this.pub = new Redis(REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: true });
    this.sub = new Redis(REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: true });
  }

  async connect(): Promise<void> {
    await this.pub.connect();
    await this.sub.connect();

    this.sub.on('message', (channel: string, message: string) => {
      const handlers = this.handlers.get(channel);
      if (handlers) {
        const data = JSON.parse(message);
        for (const handler of handlers) {
          handler(data);
        }
      }
    });

    console.log('[Redis] Connected (pub + sub)');
  }

  /**
   * Publish a trade execution event.
   */
  async publishTrade(trade: TradeExecution): Promise<void> {
    const payload = {
      type: 'trade_ticker',
      data: {
        tradeId: trade.tradeId,
        symbol: trade.symbol,
        price: trade.price.toString(),
        quantity: trade.quantity.toString(),
        buyerId: trade.buyerId,
        sellerId: trade.sellerId,
        buyOrderId: trade.buyOrderId,
        sellOrderId: trade.sellOrderId,
        timestamp: trade.timestamp,
      },
    };

    await this.pub.publish(`trades:${trade.symbol}`, JSON.stringify(payload));
  }

  /**
   * Publish an order book snapshot/delta.
   */
  async publishOrderBook(symbol: string, snapshot: OrderBookSnapshot): Promise<void> {
    const payload = {
      type: 'orderbook_snapshot',
      data: {
        symbol: snapshot.symbol,
        bids: snapshot.bids,
        asks: snapshot.asks,
        spread: snapshot.spread?.toString() || null,
        midPrice: snapshot.midPrice?.toString() || null,
        timestamp: snapshot.timestamp,
      },
    };

    await this.pub.publish(`orderbook:${symbol}`, JSON.stringify(payload));
  }

  /**
   * Publish a private user notification (order update, balance change).
   */
  async publishUserUpdate(userId: string, type: string, data: any): Promise<void> {
    const payload = { type, data };
    await this.pub.publish(`user:${userId}`, JSON.stringify(payload));
  }

  /**
   * Subscribe to a Redis channel.
   */
  async subscribe(channel: string, handler: (data: any) => void): Promise<void> {
    if (!this.handlers.has(channel)) {
      this.handlers.set(channel, new Set());
      await this.sub.subscribe(channel);
    }
    this.handlers.get(channel)!.add(handler);
  }

  /**
   * Unsubscribe a handler from a channel.
   */
  async unsubscribe(channel: string, handler: (data: any) => void): Promise<void> {
    const handlers = this.handlers.get(channel);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.handlers.delete(channel);
        await this.sub.unsubscribe(channel);
      }
    }
  }

  async disconnect(): Promise<void> {
    await this.pub.quit();
    await this.sub.quit();
  }
}

// Singleton instance
export const redisPublisher = new RedisPublisher();
