import Redis from 'ioredis';
import {
  MatchingEngine,
  ProtocolSerializer,
  EngineCommand,
  EngineResult,
  TradeExecution,
  OrderBookSnapshot,
} from '@velocitybook/engine';

export interface EngineWorkerOptions {
  workerId?: string;
  symbols?: string[];
  redisUrl?: string;
  heartbeatIntervalMs?: number;
}

/**
 * EngineWorker — Sharded Matching Engine Worker Daemon.
 *
 * Each worker instance runs in its own process/container, manages isolated
 * order books for a distinct subset of trading pairs, and coordinates via Redis.
 */
export class EngineWorker {
  readonly workerId: string;
  readonly symbols: string[];
  private redisUrl: string;
  private heartbeatIntervalMs: number;

  private engine: MatchingEngine;
  private pub: Redis | null = null;
  private sub: Redis | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private running = false;
  private ordersProcessed = 0;

  constructor(options: EngineWorkerOptions = {}) {
    this.workerId = options.workerId || process.env.WORKER_ID || `worker-${process.pid}`;
    
    const envSymbols = process.env.ASSIGNED_SYMBOLS
      ? process.env.ASSIGNED_SYMBOLS.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;
    this.symbols = options.symbols || envSymbols || ['BTC-USD', 'BTC-INR'];

    this.redisUrl = options.redisUrl || process.env.REDIS_URL || 'redis://localhost:6379';
    this.heartbeatIntervalMs = options.heartbeatIntervalMs || 2000;

    // Isolated matching engine for this worker's partition of symbols
    this.engine = new MatchingEngine(this.symbols);
  }

  /**
   * Start the worker daemon: connect to Redis, subscribe to symbol commands, start heartbeats.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    console.log(`[EngineWorker:${this.workerId}] Starting for symbols: [${this.symbols.join(', ')}]`);

    this.pub = new Redis(this.redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
    this.sub = new Redis(this.redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });

    await this.pub.connect();
    await this.sub.connect();

    // Subscribe to symbol command channels and worker-specific channel
    const channels = [
      ...this.symbols.map((sym) => `engine:commands:${sym}`),
      `engine:commands:${this.workerId}`,
    ];

    for (const channel of channels) {
      await this.sub.subscribe(channel);
      console.log(`[EngineWorker:${this.workerId}] Subscribed to ${channel}`);
    }

    // Set buffer mode on message listener for binary protobuf decoding
    this.sub.on('messageBuffer', (channelBuf: Buffer, messageBuf: Buffer) => {
      this.handleCommandMessage(channelBuf.toString('utf8'), messageBuf);
    });

    // Start periodic heartbeats
    this.startHeartbeat();

    console.log(`[EngineWorker:${this.workerId}] Ready and listening on Redis`);
  }

  /**
   * Handle incoming command from API gateway.
   */
  private async handleCommandMessage(_channel: string, messageBuf: Buffer): Promise<void> {
    let command: EngineCommand;
    try {
      // First try Protobuf binary decoding, fallback to JSON
      try {
        command = ProtocolSerializer.decodeCommand(messageBuf);
      } catch {
        command = JSON.parse(messageBuf.toString('utf8'));
      }
    } catch (err: any) {
      console.error(`[EngineWorker:${this.workerId}] Failed to decode command:`, err.message);
      return;
    }

    const { correlationId, action, symbol } = command;
    let result: EngineResult;

    try {
      switch (action) {
        case 'SUBMIT_ORDER': {
          if (!command.order) {
            throw new Error('SUBMIT_ORDER missing order payload');
          }
          const order = command.order;
          this.ordersProcessed++;

          // Execute in isolated in-memory matching engine
          const trades = this.engine.submitOrder(order);

          // Publish trades to Redis pub/sub
          for (const trade of trades) {
            await this.publishTrade(trade);
          }

          // Publish updated order book snapshot
          const snapshot = this.engine.getOrderBookSnapshot(symbol);
          await this.publishOrderBook(symbol, snapshot);

          result = {
            correlationId,
            success: true,
            trades,
            order,
          };
          break;
        }

        case 'CANCEL_ORDER': {
          if (!command.orderId) {
            throw new Error('CANCEL_ORDER missing orderId');
          }
          const cancelledOrder = this.engine.cancelOrder(symbol, command.orderId);
          const cancelled = cancelledOrder !== null;
          if (cancelled) {
            const snapshot = this.engine.getOrderBookSnapshot(symbol);
            await this.publishOrderBook(symbol, snapshot);
          }
          result = {
            correlationId,
            success: cancelled,
          };
          break;
        }

        case 'GET_SNAPSHOT': {
          const snapshot = this.engine.getOrderBookSnapshot(symbol, command.depth || 25);
          result = {
            correlationId,
            success: true,
            snapshot,
          };
          break;
        }

        case 'GET_STATS': {
          result = {
            correlationId,
            success: true,
          };
          break;
        }

        default:
          throw new Error(`Unknown action: ${action}`);
      }
    } catch (err: any) {
      result = {
        correlationId,
        success: false,
        error: err.message,
      };
    }

    // Publish result back to gateway reply channel
    await this.sendResult(correlationId, result);
  }

  /**
   * Publish execution result to correlation reply channel.
   */
  private async sendResult(correlationId: string, result: EngineResult): Promise<void> {
    if (!this.pub) return;
    try {
      const encoded = ProtocolSerializer.encodeResult(result);
      await this.pub.publish(Buffer.from(`engine:replies:${correlationId}`), Buffer.from(encoded));
    } catch {
      // Fallback to JSON
      await this.pub.publish(`engine:replies:${correlationId}`, JSON.stringify(result));
    }
  }

  /**
   * Publish trade execution event to Redis pub/sub.
   */
  private async publishTrade(trade: TradeExecution): Promise<void> {
    if (!this.pub) return;
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
   * Publish order book snapshot to Redis pub/sub.
   */
  private async publishOrderBook(symbol: string, snapshot: OrderBookSnapshot): Promise<void> {
    if (!this.pub) return;
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
   * Start periodic heartbeats announcing worker liveness and shard ownership.
   */
  private startHeartbeat(): void {
    const sendPulse = async () => {
      if (!this.pub || !this.running) return;
      const heartbeat = {
        workerId: this.workerId,
        symbols: this.symbols,
        ordersProcessed: this.ordersProcessed,
        totalOrders: this.engine.getTotalOrderCount(),
        timestamp: Date.now(),
      };
      await this.pub.publish('engine:heartbeats', JSON.stringify(heartbeat));
      await this.pub.setex(`engine:worker:${this.workerId}`, 5, JSON.stringify(heartbeat));
    };

    sendPulse().catch(() => {});
    this.heartbeatTimer = setInterval(() => {
      sendPulse().catch(() => {});
    }, this.heartbeatIntervalMs);
  }

  /**
   * Stop the worker gracefully.
   */
  async stop(): Promise<void> {
    this.running = false;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.sub) {
      await this.sub.quit();
      this.sub = null;
    }
    if (this.pub) {
      await this.pub.del(`engine:worker:${this.workerId}`);
      await this.pub.quit();
      this.pub = null;
    }
    console.log(`[EngineWorker:${this.workerId}] Stopped`);
  }

  getEngine(): MatchingEngine {
    return this.engine;
  }
}

// CLI entry point if executed directly
if (require.main === module) {
  const worker = new EngineWorker();
  worker.start().catch((err) => {
    console.error('[EngineWorker] Fatal startup failure:', err);
    process.exit(1);
  });

  const shutdown = async () => {
    console.log('\n[EngineWorker] Shutting down...');
    await worker.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
