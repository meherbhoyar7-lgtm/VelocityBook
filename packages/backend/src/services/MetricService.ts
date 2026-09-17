import client from 'prom-client';

/**
 * MetricService — Prometheus Observability & Metrics Registry.
 *
 * Exposes core exchange performance metrics:
 * - Orders submitted, executed, cancelled
 * - Trades matched
 * - Matching latency histograms
 * - Order book depth and spread gauges
 * - Active WebSocket clients
 * - Cluster worker status
 */
export class MetricService {
  private static registry = new client.Registry();
  private static initialized = false;

  // ── Counters ──
  public static ordersTotal: client.Counter;
  public static tradesTotal: client.Counter;

  // ── Histograms ──
  public static orderLatency: client.Histogram;

  // ── Gauges ──
  public static orderBookSpread: client.Gauge;
  public static orderBookDepth: client.Gauge;
  public static activeWsClients: client.Gauge;
  public static clusterWorkers: client.Gauge;
  public static marketMakerTicks: client.Counter;

  public static initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    // Collect default Node.js runtime metrics (CPU, memory, event loop lag)
    client.collectDefaultMetrics({ register: this.registry, prefix: 'velocitybook_' });

    this.ordersTotal = new client.Counter({
      name: 'velocitybook_orders_total',
      help: 'Total number of orders submitted to the exchange',
      labelNames: ['symbol', 'side', 'type', 'status'],
      registers: [this.registry],
    });

    this.tradesTotal = new client.Counter({
      name: 'velocitybook_trades_total',
      help: 'Total number of trades executed on the exchange',
      labelNames: ['symbol'],
      registers: [this.registry],
    });

    this.orderLatency = new client.Histogram({
      name: 'velocitybook_order_execution_duration_seconds',
      help: 'Duration of order submission to match execution in seconds',
      labelNames: ['symbol', 'type'],
      buckets: [0.0001, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.025, 0.05, 0.1, 0.5, 1],
      registers: [this.registry],
    });

    this.orderBookSpread = new client.Gauge({
      name: 'velocitybook_order_book_spread',
      help: 'Current top of book bid-ask spread',
      labelNames: ['symbol'],
      registers: [this.registry],
    });

    this.orderBookDepth = new client.Gauge({
      name: 'velocitybook_order_book_depth_levels',
      help: 'Number of resting price levels in the order book',
      labelNames: ['symbol', 'side'],
      registers: [this.registry],
    });

    this.activeWsClients = new client.Gauge({
      name: 'velocitybook_active_ws_clients',
      help: 'Number of currently connected WebSocket clients',
      registers: [this.registry],
    });

    this.clusterWorkers = new client.Gauge({
      name: 'velocitybook_cluster_workers_active',
      help: 'Number of active sharded matching engine workers',
      registers: [this.registry],
    });

    this.marketMakerTicks = new client.Counter({
      name: 'velocitybook_market_maker_ticks_total',
      help: 'Total market maker bot quotation ticks',
      registers: [this.registry],
    });
  }

  /**
   * Return formatted Prometheus metrics for /metrics scraping endpoint.
   */
  public static async getMetrics(): Promise<string> {
    this.initialize();
    return this.registry.metrics();
  }

  public static getContentType(): string {
    return this.registry.contentType;
  }
}
