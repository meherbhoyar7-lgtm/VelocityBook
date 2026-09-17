import express from 'express';
import cors from 'cors';
import http from 'http';
import jwt from 'jsonwebtoken';
import { EngineClusterRouter } from './services/EngineClusterRouter';
import { VelocityWebSocketServer } from './websocket/WebSocketServer';
import { redisPublisher } from './websocket/RedisPublisher';
import { MarketMakerBot } from './services/MarketMakerBot';
import { MetricService } from './services/MetricService';
import authRoutes, { JWT_SECRET } from './routes/auth';
import ordersRoutes, { setEngineRef } from './routes/orders';
import portfolioRoutes from './routes/portfolio';
import tradesRoutes from './routes/trades';
import faucetRoutes from './routes/faucet';
import replayRoutes from './routes/replay';
import reportsRoutes from './routes/reports';
import { ReplayService } from './services/ReplayService';

const PORT = parseInt(process.env.PORT || '3001', 10);

// ─── Initialize Core Systems ──────────────────────────────────────

MetricService.initialize();

const app = express();
const server = http.createServer(app);

// Matching engine cluster router (sharded or local in-process)
const engine = new EngineClusterRouter();


// WebSocket server
const wsServer = new VelocityWebSocketServer(server);

// ─── Middleware ────────────────────────────────────────────────────

app.use(cors({ origin: '*' }));
app.use(express.json());

// Auth middleware — extracts userId from JWT for protected routes
function authMiddleware(req: express.Request, _res: express.Response, next: express.NextFunction): void {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.slice(7);
      const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
      (req as any).userId = decoded.userId;
    } catch {
      // Token invalid — userId remains undefined
    }
  }

  // Also support userId from query param (for demo convenience)
  if (!(req as any).userId && req.query.userId) {
    (req as any).userId = req.query.userId;
  }

  next();
}

app.use(authMiddleware);

// ─── Inject Engine References ──────────────────────────────────────

setEngineRef(engine, wsServer, redisPublisher);
ReplayService.setWebSocketServer(wsServer);

// ─── Routes ────────────────────────────────────────────────────────

app.use('/api/auth', authRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/trades', tradesRoutes);
app.use('/api/faucet', faucetRoutes);
app.use('/api/replay', replayRoutes);
app.use('/api/reports', reportsRoutes);

// GET /api/orderbook?symbol=BTC-USD
app.get('/api/orderbook', (req, res) => {
  try {
    const symbol = (req.query.symbol as string) || 'BTC-INR';
    const depth = parseInt((req.query.depth as string) || '25', 10);
    const snapshot = engine.getOrderBookSnapshot(symbol, depth);

    res.json({
      symbol: snapshot.symbol,
      bids: snapshot.bids,
      asks: snapshot.asks,
      spread: snapshot.spread?.toString() || null,
      midPrice: snapshot.midPrice?.toString() || null,
      timestamp: snapshot.timestamp,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// GET /api/symbols
app.get('/api/symbols', (_req, res) => {
  res.json({ symbols: engine.getSymbols() });
});

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    engine: {
      symbols: engine.getSymbols(),
      totalOrders: engine.getTotalOrderCount(),
      cluster: engine.getClusterHealth(),
    },
    websocket: {
      clients: wsServer.getClientCount(),
    },
    timestamp: new Date().toISOString(),
  });
});

// Prometheus metrics endpoint for Grafana/Prometheus scraping
app.get('/metrics', async (_req, res) => {
  try {
    res.setHeader('Content-Type', MetricService.getContentType());
    res.send(await MetricService.getMetrics());
  } catch (err: any) {
    res.status(500).send(err.message);
  }
});

// ─── Start Server ──────────────────────────────────────────────────

async function start(): Promise<void> {
  try {
    // Initialize engine router (sharded cluster or local)
    try {
      await engine.initialize();
    } catch (err) {
      console.warn('[Server] Engine cluster initialization warning:', (err as Error).message);
    }

    // Connect to Redis
    try {
      await redisPublisher.connect();
    } catch (err) {
      console.warn('[Server] Redis connection failed — running without pub/sub:', (err as Error).message);
    }

    // Start HTTP + WebSocket server
    server.listen(PORT, () => {
      console.log(`\n═══════════════════════════════════════════════════`);
      console.log(`  VelocityBook Backend`);
      console.log(`  REST API:    http://localhost:${PORT}`);
      console.log(`  WebSocket:   ws://localhost:${PORT}/ws`);
      console.log(`  Health:      http://localhost:${PORT}/api/health`);
      console.log(`═══════════════════════════════════════════════════\n`);

      // Start Market Maker Bot after a short delay
      setTimeout(async () => {
        try {
          const bot = new MarketMakerBot(engine, wsServer);
          await bot.start();
        } catch (err) {
          console.warn('[Server] MarketMaker bot failed to start:', (err as Error).message);
        }
      }, 2000);
    });
  } catch (error) {
    console.error('[Server] Fatal startup error:', error);
    process.exit(1);
  }
}

start();

export { app, server, engine, wsServer };
