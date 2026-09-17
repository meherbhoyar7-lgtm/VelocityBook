import { query } from '../db/pool';
import Decimal from 'decimal.js';

export interface ReplayTrade {
  tradeId: string;
  symbol: string;
  price: string;
  quantity: string;
  buyerId: string;
  sellerId: string;
  timestamp: number;
}

export interface ReplayStatus {
  active: boolean;
  paused: boolean;
  symbol: string;
  speed: number;
  currentIndex: number;
  totalTrades: number;
  currentTrade?: ReplayTrade;
}

/**
 * ReplayService — Historical Market Data & Trade Replay Engine.
 *
 * Allows operators, quants, and demo users to replay historical market sessions
 * at configurable playback speeds (1x, 5x, 10x, 60x) into the real-time WebSocket stream.
 */
export class ReplayService {
  private static active = false;
  private static paused = false;
  private static symbol = 'BTC-USD';
  private static speed = 1;
  private static trades: ReplayTrade[] = [];
  private static currentIndex = 0;
  private static timer: NodeJS.Timeout | null = null;
  private static wsServerRef: any = null;

  public static setWebSocketServer(wsServer: any): void {
    this.wsServerRef = wsServer;
  }

  /**
   * Start historical replay for a symbol.
   */
  public static async startReplay(options: {
    symbol?: string;
    speed?: number;
    limit?: number;
  }): Promise<ReplayStatus> {
    this.stopReplay();

    this.symbol = options.symbol || 'BTC-USD';
    this.speed = options.speed || 1;
    const limit = options.limit || 500;

    // Fetch historical trades from PostgreSQL
    try {
      const rows = await query(
        `SELECT id, symbol, price, quantity, buyer_id, seller_id, executed_at
         FROM trades
         WHERE symbol = $1
         ORDER BY executed_at ASC
         LIMIT $2`,
        [this.symbol, limit]
      );

      if (rows.length >= 5) {
        this.trades = rows.map((r: any) => ({
          tradeId: r.id,
          symbol: r.symbol,
          price: r.price,
          quantity: r.quantity,
          buyerId: r.buyer_id,
          sellerId: r.seller_id,
          timestamp: new Date(r.executed_at).getTime(),
        }));
      } else {
        // Generate a realistic session if DB has few trades
        this.trades = this.generateSyntheticSession(this.symbol, limit);
      }
    } catch {
      this.trades = this.generateSyntheticSession(this.symbol, limit);
    }

    this.active = true;
    this.paused = false;
    this.currentIndex = 0;

    this.scheduleNextTick();
    return this.getStatus();
  }

  /**
   * Pause the active replay.
   */
  public static pauseReplay(): ReplayStatus {
    if (this.active) {
      this.paused = true;
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
    }
    return this.getStatus();
  }

  /**
   * Resume paused replay.
   */
  public static resumeReplay(): ReplayStatus {
    if (this.active && this.paused) {
      this.paused = false;
      this.scheduleNextTick();
    }
    return this.getStatus();
  }

  /**
   * Stop replay and reset session.
   */
  public static stopReplay(): ReplayStatus {
    this.active = false;
    this.paused = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.trades = [];
    this.currentIndex = 0;
    return this.getStatus();
  }

  /**
   * Set playback speed (e.g. 1x, 5x, 10x, 60x).
   */
  public static setSpeed(speed: number): ReplayStatus {
    this.speed = Math.max(1, Math.min(100, speed));
    return this.getStatus();
  }

  /**
   * Step through and broadcast trades at the calibrated speed.
   */
  private static scheduleNextTick(): void {
    if (!this.active || this.paused || this.currentIndex >= this.trades.length) {
      if (this.currentIndex >= this.trades.length) {
        this.active = false;
      }
      return;
    }

    const currentTrade = this.trades[this.currentIndex];
    const nextTrade = this.trades[this.currentIndex + 1];

    let delayMs = 500;
    if (nextTrade) {
      const naturalDelta = nextTrade.timestamp - currentTrade.timestamp;
      // Scale natural timestamp interval by speed multiplier (clamped between 20ms and 2000ms)
      delayMs = Math.max(20, Math.min(2000, Math.round(naturalDelta / this.speed)));
    }

    this.timer = setTimeout(() => {
      this.emitTrade(currentTrade);
      this.currentIndex++;
      this.scheduleNextTick();
    }, delayMs);
  }

  /**
   * Broadcast replay trade over WebSocket.
   */
  private static emitTrade(trade: ReplayTrade): void {
    if (this.wsServerRef) {
      this.wsServerRef.broadcastTrade(trade.symbol, {
        ...trade,
        isReplay: true,
      });
    }
  }

  /**
   * Get current replay status.
   */
  public static getStatus(): ReplayStatus {
    return {
      active: this.active,
      paused: this.paused,
      symbol: this.symbol,
      speed: this.speed,
      currentIndex: this.currentIndex,
      totalTrades: this.trades.length,
      currentTrade: this.trades[this.currentIndex],
    };
  }

  /**
   * Synthetic historical trade generator (for instant demo / dry-run sessions).
   */
  private static generateSyntheticSession(symbol: string, count: number): ReplayTrade[] {
    const trades: ReplayTrade[] = [];
    let price = new Decimal(symbol.startsWith('BTC') ? 60000 : 3200);
    let time = Date.now() - count * 1000;

    for (let i = 0; i < count; i++) {
      const delta = (Math.random() - 0.49) * (symbol.startsWith('BTC') ? 25 : 3);
      price = price.plus(delta).toDecimalPlaces(2);
      time += Math.floor(200 + Math.random() * 800);

      trades.push({
        tradeId: `replay-tr-${i + 1}`,
        symbol,
        price: price.toFixed(2),
        quantity: (0.01 + Math.random() * 0.5).toFixed(4),
        buyerId: 'usr-buyer-replay',
        sellerId: 'usr-seller-replay',
        timestamp: time,
      });
    }

    return trades;
  }
}
