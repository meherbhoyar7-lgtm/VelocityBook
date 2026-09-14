import { Router, Request, Response } from 'express';
import { query } from '../db/pool';

const router = Router();

// GET /api/trades/recent?symbol=BTC-USD
router.get('/recent', async (req: Request, res: Response) => {
  try {
    const symbol = (req.query.symbol as string) || 'BTC-USD';

    const trades = await query(
      `SELECT id, symbol, price, quantity, buyer_id, seller_id, executed_at
       FROM trades
       WHERE symbol = $1
       ORDER BY executed_at DESC
       LIMIT 50`,
      [symbol]
    );

    return res.json({ trades });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// GET /api/trades/candles?symbol=BTC-USD&resolution=1m
router.get('/candles', async (req: Request, res: Response) => {
  try {
    const symbol = (req.query.symbol as string) || 'BTC-USD';
    const resolution = (req.query.resolution as string) || '1m';

    // Map resolution to PostgreSQL interval
    const intervalMap: Record<string, string> = {
      '1m': '1 minute',
      '5m': '5 minutes',
      '15m': '15 minutes',
      '1h': '1 hour',
      '4h': '4 hours',
      '1d': '1 day',
    };

    const interval = intervalMap[resolution] || '1 minute';

    const candles = await query(
      `SELECT
         date_trunc('${interval === '1 minute' ? 'minute' : interval === '5 minutes' ? 'minute' : 'hour'}', executed_at) as time,
         MIN(price::numeric) as low,
         MAX(price::numeric) as high,
         (array_agg(price::numeric ORDER BY executed_at ASC))[1] as open,
         (array_agg(price::numeric ORDER BY executed_at DESC))[1] as close,
         SUM(quantity::numeric) as volume
       FROM trades
       WHERE symbol = $1
         AND executed_at > NOW() - INTERVAL '24 hours'
       GROUP BY time
       ORDER BY time ASC`,
      [symbol]
    );

    return res.json({ candles });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// GET /api/trades/user — Get authenticated user's trade fills
router.get('/user', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const trades = await query(
      `SELECT id, symbol, price, quantity, buyer_id, seller_id, executed_at,
              CASE WHEN buyer_id = $1 THEN 'BUY' ELSE 'SELL' END as side
       FROM trades
       WHERE buyer_id = $1 OR seller_id = $1
       ORDER BY executed_at DESC
       LIMIT 100`,
      [userId]
    );

    return res.json({ trades });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
