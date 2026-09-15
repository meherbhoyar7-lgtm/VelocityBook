import Redis from 'ioredis';
import Decimal from 'decimal.js';
import { v4 as uuidv4 } from 'uuid';
import {
  MatchingEngine,
  ProtocolSerializer,
  Order,
  TradeExecution,
  OrderBookSnapshot,
  EngineCommand,
  EngineResult,
} from '@velocitybook/engine';

export interface WorkerHeartbeat {
  workerId: string;
  symbols: string[];
  ordersProcessed: number;
  totalOrders: number;
  timestamp: number;
}

export interface EngineClusterRouterOptions {
  clustered?: boolean;
  redisUrl?: string;
  symbols?: string[];
  defaultShardMap?: Record<string, string>;
}

/**
 * EngineClusterRouter — Sharding Router & Gateway Coordinator.
 *
 * In Clustered Mode:
 *   - Routes order placement and cancellations to the appropriate worker via Redis.
 *   - Caches order book snapshots locally from Redis pub/sub for sub-millisecond reads.
 *   - Monitors worker health and shard assignments.
 *
 * In Local Mode:
 *   - Delegates directly to an in-process MatchingEngine for zero-overhead development and unit tests.
 */
export class EngineClusterRouter {
  readonly isClustered: boolean;
  private localEngine: MatchingEngine | null = null;
  private redisUrl: string;
  private pub: Redis | null = null;
  private sub: Redis | null = null;

  // Shard routing: symbol -> channel / workerId
  private symbolShardMap: Map<string, string> = new Map();

  // Live order book snapshot cache per symbol (kept fresh via Redis pub/sub)
  private snapshotCache: Map<string, OrderBookSnapshot> = new Map();

  // Active worker registry: workerId -> WorkerHeartbeat
  private activeWorkers: Map<string, WorkerHeartbeat> = new Map();

  // Pending RPC correlation promises: correlationId -> { resolve, reject, timer }
  private pendingRequests: Map<
    string,
    {
      resolve: (res: EngineResult) => void;
      reject: (err: Error) => void;
      timer: NodeJS.Timeout;
    }
  > = new Map();

  constructor(options: EngineClusterRouterOptions = {}) {
    this.isClustered = options.clustered ?? (process.env.CLUSTER_MODE === 'true');
    this.redisUrl = options.redisUrl || process.env.REDIS_URL || 'redis://localhost:6379';

    const defaultSymbols = options.symbols || ['BTC-INR', 'ETH-INR', 'BTC-USD', 'ETH-USD'];

    // Default static shard allocation: Worker 1 (BTC), Worker 2 (ETH)
    const defaultShards: Record<string, string> = options.defaultShardMap || {
      'BTC-USD': 'worker-1',
      'BTC-INR': 'worker-1',
      'ETH-USD': 'worker-2',
      'ETH-INR': 'worker-2',
    };

    for (const [symbol, workerId] of Object.entries(defaultShards)) {
      this.symbolShardMap.set(symbol, workerId);
    }

    if (!this.isClustered) {
      // Local in-process engine mode
      this.localEngine = new MatchingEngine(defaultSymbols);
    }
  }

  /**
   * Connect to Redis and initialize cluster listeners.
   */
  async initialize(): Promise<void> {
    if (!this.isClustered) {
      console.log('[EngineRouter] Running in LOCAL in-process engine mode');
      return;
    }

    console.log('[EngineRouter] Initializing in CLUSTERED sharded mode...');
    this.pub = new Redis(this.redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
    this.sub = new Redis(this.redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });

    await this.pub.connect();
    await this.sub.connect();

    // Subscribe to heartbeats
    await this.sub.subscribe('engine:heartbeats');

    // Subscribe to orderbook snapshots for all symbols to maintain local cache
    for (const symbol of this.symbolShardMap.keys()) {
      await this.sub.subscribe(`orderbook:${symbol}`);
    }

    // Subscribe to pattern for reply channels: engine:replies:*
    await this.sub.psubscribe('engine:replies:*');

    // Handle incoming messages
    this.sub.on('pmessageBuffer', (_pattern: Buffer, channelBuf: Buffer, messageBuf: Buffer) => {
      const channel = channelBuf.toString('utf8');
      if (channel.startsWith('engine:replies:')) {
        const correlationId = channel.slice('engine:replies:'.length);
        this.handleReply(correlationId, messageBuf);
      }
    });

    this.sub.on('message', (channel: string, message: string) => {
      if (channel === 'engine:heartbeats') {
        try {
          const hb: WorkerHeartbeat = JSON.parse(message);
          this.activeWorkers.set(hb.workerId, hb);
          for (const sym of hb.symbols) {
            this.symbolShardMap.set(sym, hb.workerId);
          }
        } catch {}
      } else if (channel.startsWith('orderbook:')) {
        try {
          const parsed = JSON.parse(message);
          if (parsed.data && parsed.data.symbol) {
            this.snapshotCache.set(parsed.data.symbol, {
              symbol: parsed.data.symbol,
              bids: parsed.data.bids || [],
              asks: parsed.data.asks || [],
              spread: parsed.data.spread ? new Decimal(parsed.data.spread) : null,
              midPrice: parsed.data.midPrice ? new Decimal(parsed.data.midPrice) : null,
              timestamp: parsed.data.timestamp || Date.now(),
            });
          }
        } catch {}
      }
    });

    console.log('[EngineRouter] Clustered router initialized');
  }

  /**
   * Submit an order to the matching engine (routed to responsible shard).
   */
  async submitOrder(order: Order, timeoutMs = 4000): Promise<TradeExecution[]> {
    if (!this.isClustered || !this.pub) {
      if (!this.localEngine) {
        throw new Error('Local engine not initialized');
      }
      return this.localEngine.submitOrder(order);
    }

    const correlationId = uuidv4();
    const command: EngineCommand = {
      correlationId,
      action: 'SUBMIT_ORDER',
      symbol: order.symbol,
      order,
    };

    const targetChannel = `engine:commands:${order.symbol}`;

    const replyPromise = new Promise<EngineResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(correlationId);
        reject(new Error(`Timeout waiting for engine worker response on ${order.symbol}`));
      }, timeoutMs);

      this.pendingRequests.set(correlationId, { resolve, reject, timer });
    });

    // Send binary protobuf command
    try {
      const encoded = ProtocolSerializer.encodeCommand(command);
      await this.pub.publish(Buffer.from(targetChannel), Buffer.from(encoded));
    } catch {
      await this.pub.publish(targetChannel, JSON.stringify(command));
    }

    const result = await replyPromise;
    if (!result.success) {
      throw new Error(result.error || 'Failed to process order in engine worker');
    }

    // Update order object in-place to reflect matches / fills
    if (result.order) {
      order.status = result.order.status;
      order.filledQuantity = result.order.filledQuantity;
    }

    return result.trades || [];
  }

  /**
   * Cancel an order in the matching engine.
   */
  async cancelOrder(symbol: string, orderId: string, timeoutMs = 3000): Promise<boolean> {
    if (!this.isClustered || !this.pub) {
      if (!this.localEngine) return false;
      return this.localEngine.cancelOrder(symbol, orderId) !== null;
    }

    const correlationId = uuidv4();
    const command: EngineCommand = {
      correlationId,
      action: 'CANCEL_ORDER',
      symbol,
      orderId,
    };

    const targetChannel = `engine:commands:${symbol}`;

    const replyPromise = new Promise<EngineResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(correlationId);
        reject(new Error(`Timeout waiting for engine cancel response on ${symbol}`));
      }, timeoutMs);

      this.pendingRequests.set(correlationId, { resolve, reject, timer });
    });

    try {
      const encoded = ProtocolSerializer.encodeCommand(command);
      await this.pub.publish(Buffer.from(targetChannel), Buffer.from(encoded));
    } catch {
      await this.pub.publish(targetChannel, JSON.stringify(command));
    }

    const result = await replyPromise;
    return result.success;
  }

  /**
   * Get an order book snapshot.
   */
  getOrderBookSnapshot(symbol: string, depth = 25): OrderBookSnapshot {
    if (!this.isClustered || !this.pub) {
      if (this.localEngine) {
        return this.localEngine.getOrderBookSnapshot(symbol, depth);
      }
    }

    // Serve from real-time local cache
    const cached = this.snapshotCache.get(symbol);
    if (cached) {
      return {
        ...cached,
        bids: cached.bids.slice(0, depth),
        asks: cached.asks.slice(0, depth),
      };
    }

    // Fallback if cache is not populated yet
    return {
      symbol,
      bids: [],
      asks: [],
      spread: null,
      midPrice: null,
      timestamp: Date.now(),
    };
  }

  /**
   * Handle incoming correlation reply from worker.
   */
  private handleReply(correlationId: string, messageBuf: Buffer): void {
    const pending = this.pendingRequests.get(correlationId);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pendingRequests.delete(correlationId);

    try {
      let result: EngineResult;
      try {
        result = ProtocolSerializer.decodeResult(messageBuf);
      } catch {
        result = JSON.parse(messageBuf.toString('utf8'));
      }
      pending.resolve(result);
    } catch (err: any) {
      pending.reject(err);
    }
  }

  getBestAsk(symbol: string): Decimal | null {
    if (!this.isClustered && this.localEngine) {
      return this.localEngine.getBestAsk(symbol);
    }
    const snap = this.snapshotCache.get(symbol);
    if (snap && snap.asks.length > 0) {
      return new Decimal(snap.asks[0].price);
    }
    return null;
  }

  getBestBid(symbol: string): Decimal | null {
    if (!this.isClustered && this.localEngine) {
      return this.localEngine.getBestBid(symbol);
    }
    const snap = this.snapshotCache.get(symbol);
    if (snap && snap.bids.length > 0) {
      return new Decimal(snap.bids[0].price);
    }
    return null;
  }

  getSymbols(): string[] {
    if (!this.isClustered && this.localEngine) {
      return this.localEngine.getSymbols();
    }
    return Array.from(this.symbolShardMap.keys());
  }

  getTotalOrderCount(): number {
    if (!this.isClustered && this.localEngine) {
      return this.localEngine.getTotalOrderCount();
    }
    let sum = 0;
    for (const w of this.activeWorkers.values()) {
      sum += w.totalOrders;
    }
    return sum;
  }

  /**
   * Get full cluster health status.
   */
  getClusterHealth(): {
    clustered: boolean;
    workers: Record<string, WorkerHeartbeat>;
    shards: Record<string, string>;
  } {
    const shards: Record<string, string> = {};
    for (const [sym, worker] of this.symbolShardMap.entries()) {
      shards[sym] = worker;
    }

    const workers: Record<string, WorkerHeartbeat> = {};
    const now = Date.now();
    for (const [id, info] of this.activeWorkers.entries()) {
      if (now - info.timestamp < 10000) {
        workers[id] = info;
      }
    }

    return {
      clustered: this.isClustered,
      workers,
      shards,
    };
  }

  async shutdown(): Promise<void> {
    for (const p of this.pendingRequests.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('EngineRouter shutting down'));
    }
    this.pendingRequests.clear();

    if (this.sub) {
      await this.sub.quit();
      this.sub = null;
    }
    if (this.pub) {
      await this.pub.quit();
      this.pub = null;
    }
  }

  getLocalEngine(): MatchingEngine | null {
    return this.localEngine;
  }
}
