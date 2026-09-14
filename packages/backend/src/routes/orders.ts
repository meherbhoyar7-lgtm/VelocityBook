import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import Decimal from 'decimal.js';
import { Side, OrderType, OrderStatus, createOrder } from '@velocitybook/engine';
import { withTransaction } from '../db/pool';
import { query } from '../db/pool';
import { RiskService } from '../services/RiskService';
import { SettlementService } from '../services/SettlementService';

// These will be injected by the server
let matchingEngine: any;
let wsServer: any;
let redisPublisherInstance: any;

export function setEngineRef(engine: any, ws: any, redis: any) {
  matchingEngine = engine;
  wsServer = ws;
  redisPublisherInstance = redis;
}

const router = Router();

// POST /api/orders — Place a new order
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const { symbol, side, type, price, quantity } = req.body;

    // Input validation
    if (!symbol || !side || !type || !quantity) {
      return res.status(400).json({ error: 'Missing required fields: symbol, side, type, quantity' });
    }

    if (!['BUY', 'SELL'].includes(side)) {
      return res.status(400).json({ error: 'Side must be BUY or SELL' });
    }

    if (!['LIMIT', 'MARKET'].includes(type)) {
      return res.status(400).json({ error: 'Type must be LIMIT or MARKET' });
    }

    const qty = new Decimal(quantity);
    if (qty.lte(0)) {
      return res.status(400).json({ error: 'Quantity must be positive' });
    }

    let orderPrice: Decimal;
    if (type === 'LIMIT') {
      if (!price) return res.status(400).json({ error: 'Limit orders require a price' });
      orderPrice = new Decimal(price);
      if (orderPrice.lte(0)) return res.status(400).json({ error: 'Price must be positive' });
    } else {
      // Market order — use a very high/low price for locking estimation
      const bestAsk = matchingEngine.getBestAsk(symbol);
      const bestBid = matchingEngine.getBestBid(symbol);
      if (side === 'BUY') {
        orderPrice = bestAsk ? bestAsk.times(1.1) : new Decimal(100000); // Estimate
      } else {
        orderPrice = bestBid ? bestBid.times(0.9) : new Decimal(1);
      }
    }

    const orderId = uuidv4();

    // Pre-trade risk check + balance locking (inside transaction)
    await withTransaction(async (client) => {
      await RiskService.lockFundsForOrder(client, {
        userId,
        symbol,
        side,
        price: orderPrice,
        quantity: qty,
      });

      // Insert order record into database
      await client.query(
        `INSERT INTO orders (id, user_id, symbol, side, type, price, quantity, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'OPEN')`,
        [orderId, userId, symbol, side, type, type === 'LIMIT' ? orderPrice.toFixed(8) : null, qty.toFixed(8)]
      );
    });

    // Submit to matching engine
    const order = createOrder({
      id: orderId,
      userId,
      symbol,
      side: side as Side,
      type: type as OrderType,
      price: orderPrice.toString(),
      quantity: qty.toString(),
    });

    const trades = matchingEngine.submitOrder(order);

    // Settle each trade
    for (const trade of trades) {
      try {
        await SettlementService.settleTrade(trade);

        // Broadcast trade via WebSocket
        if (wsServer) {
          wsServer.broadcastTrade(symbol, {
            tradeId: trade.tradeId,
            symbol: trade.symbol,
            price: trade.price.toString(),
            quantity: trade.quantity.toString(),
            buyerId: trade.buyerId,
            sellerId: trade.sellerId,
            timestamp: trade.timestamp,
          });

          // Private notifications to buyer and seller
          wsServer.sendToUser(trade.buyerId, 'user_order_update', {
            orderId: trade.buyOrderId,
            status: 'fill',
            filledQty: trade.quantity.toString(),
            price: trade.price.toString(),
          });
          wsServer.sendToUser(trade.sellerId, 'user_order_update', {
            orderId: trade.sellOrderId,
            status: 'fill',
            filledQty: trade.quantity.toString(),
            price: trade.price.toString(),
          });
        }
      } catch (settleErr: any) {
        console.error(`[Orders] Settlement error for trade ${trade.tradeId}:`, settleErr.message);
      }
    }

    // Broadcast updated order book
    if (wsServer) {
      const snapshot = matchingEngine.getOrderBookSnapshot(symbol);
      wsServer.broadcastOrderBook(symbol, {
        symbol: snapshot.symbol,
        bids: snapshot.bids,
        asks: snapshot.asks,
        spread: snapshot.spread?.toString() || null,
        midPrice: snapshot.midPrice?.toString() || null,
        timestamp: snapshot.timestamp,
      });
    }

    // If the order was cancelled by the engine (unfilled market), update DB
    if (order.status === OrderStatus.CANCELLED) {
      await query(
        `UPDATE orders SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1`,
        [orderId]
      );
      // Unlock remaining funds
      await withTransaction(async (client) => {
        const remaining = order.quantity.minus(order.filledQuantity);
        if (remaining.gt(0)) {
          await RiskService.unlockFundsForCancel(client, {
            userId,
            symbol,
            side,
            price: orderPrice,
            remainingQuantity: remaining,
          });
        }
      });
    }

    return res.status(201).json({
      order: {
        id: orderId,
        symbol,
        side,
        type,
        price: type === 'LIMIT' ? orderPrice.toString() : null,
        quantity: qty.toString(),
        filledQuantity: order.filledQuantity.toString(),
        status: order.status,
      },
      trades: trades.map((t: any) => ({
        tradeId: t.tradeId,
        price: t.price.toString(),
        quantity: t.quantity.toString(),
        timestamp: t.timestamp,
      })),
    });
  } catch (error: any) {
    console.error('[Orders] Place error:', error.message);
    return res.status(400).json({ error: error.message });
  }
});

// DELETE /api/orders/:id — Cancel an open order
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const { id } = req.params;

    // Fetch the order from DB
    const orders = await query(
      `SELECT id, user_id, symbol, side, type, price, quantity, filled_quantity, status
       FROM orders WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (orders.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const dbOrder = orders[0];
    if (dbOrder.status === 'FILLED' || dbOrder.status === 'CANCELLED') {
      return res.status(400).json({ error: `Cannot cancel order with status: ${dbOrder.status}` });
    }

    // Cancel in matching engine
    matchingEngine.cancelOrder(dbOrder.symbol, id);

    // Unlock funds
    const remaining = new Decimal(dbOrder.quantity).minus(new Decimal(dbOrder.filled_quantity));
    if (remaining.gt(0)) {
      await withTransaction(async (client) => {
        await RiskService.unlockFundsForCancel(client, {
          userId,
          symbol: dbOrder.symbol,
          side: dbOrder.side,
          price: new Decimal(dbOrder.price || '0'),
          remainingQuantity: remaining,
        });
      });
    }

    // Update DB
    await query(
      `UPDATE orders SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1`,
      [id]
    );

    // Broadcast updated order book
    if (wsServer) {
      const snapshot = matchingEngine.getOrderBookSnapshot(dbOrder.symbol);
      wsServer.broadcastOrderBook(dbOrder.symbol, {
        symbol: snapshot.symbol,
        bids: snapshot.bids,
        asks: snapshot.asks,
        spread: snapshot.spread?.toString() || null,
        midPrice: snapshot.midPrice?.toString() || null,
        timestamp: snapshot.timestamp,
      });

      wsServer.sendToUser(userId, 'user_order_update', {
        orderId: id,
        status: 'CANCELLED',
      });
    }

    return res.json({ message: 'Order cancelled', orderId: id });
  } catch (error: any) {
    console.error('[Orders] Cancel error:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

// GET /api/orders/open — Get user's open orders
router.get('/open', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const orders = await query(
      `SELECT id, symbol, side, type, price, quantity, filled_quantity, status, created_at
       FROM orders
       WHERE user_id = $1 AND status IN ('OPEN', 'PARTIALLY_FILLED', 'PENDING')
       ORDER BY created_at DESC`,
      [userId]
    );

    return res.json({ orders });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// GET /api/orders/history — Get user's historical orders
router.get('/history', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const orders = await query(
      `SELECT id, symbol, side, type, price, quantity, filled_quantity, status, created_at, updated_at
       FROM orders
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [userId]
    );

    return res.json({ orders });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
