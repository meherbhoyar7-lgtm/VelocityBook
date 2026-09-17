import { Router, Request, Response } from 'express';
import { query } from '../db/pool';

const router = Router();

function convertToCSV(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const headerLine = headers.map((h) => `"${h}"`).join(',');
  const rowLines = rows.map((row) =>
    row
      .map((val) => {
        if (val === null || val === undefined) return '""';
        const str = String(val).replace(/"/g, '""');
        return `"${str}"`;
      })
      .join(',')
  );
  return [headerLine, ...rowLines].join('\r\n');
}

// ─── 1. Trades Report ───────────────────────────────────────────────

router.get('/trades', async (req: Request, res: Response) => {
  try {
    const symbol = (req.query.symbol as string) || 'BTC-USD';
    const format = ((req.query.format as string) || 'csv').toLowerCase();
    const limit = Math.min(Number(req.query.limit) || 1000, 5000);

    const rows = await query(
      `SELECT id, symbol, price, quantity, buyer_id, seller_id, executed_at
       FROM trades
       WHERE ($1 = 'ALL' OR symbol = $1)
       ORDER BY executed_at DESC
       LIMIT $2`,
      [symbol, limit]
    );

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="trades-${symbol}-${Date.now()}.json"`);
      return res.json({ symbol, count: rows.length, trades: rows });
    }

    const headers = ['Trade ID', 'Symbol', 'Price', 'Quantity', 'Buyer ID', 'Seller ID', 'Executed At'];
    const csvRows = rows.map((r: any) => [
      r.id,
      r.symbol,
      r.price,
      r.quantity,
      r.buyer_id,
      r.seller_id,
      new Date(r.executed_at).toISOString(),
    ]);

    const csvContent = convertToCSV(headers, csvRows);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="trades-${symbol}-${Date.now()}.csv"`);
    return res.send(csvContent);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── 2. Ledger Audit Journal Report ─────────────────────────────────

router.get('/ledger', async (req: Request, res: Response) => {
  try {
    const currency = (req.query.currency as string) || 'ALL';
    const userId = req.query.userId as string;
    const format = ((req.query.format as string) || 'csv').toLowerCase();
    const limit = Math.min(Number(req.query.limit) || 1000, 5000);

    let sql = `
      SELECT id, transaction_id, user_id, account_id, currency, type, amount, description, created_at
      FROM ledger_entries
      WHERE ($1 = 'ALL' OR currency = $1)
    `;
    const params: any[] = [currency];

    if (userId) {
      params.push(userId);
      sql += ` AND user_id = $${params.length}`;
    }

    params.push(limit);
    sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;

    const rows = await query(sql, params);

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="ledger-audit-${currency}-${Date.now()}.json"`);
      return res.json({ currency, count: rows.length, entries: rows });
    }

    const headers = [
      'Entry ID',
      'Transaction ID',
      'User ID',
      'Account ID',
      'Currency',
      'Entry Type',
      'Amount',
      'Description',
      'Timestamp',
    ];
    const csvRows = rows.map((r: any) => [
      r.id,
      r.transaction_id,
      r.user_id,
      r.account_id,
      r.currency,
      r.type,
      r.amount,
      r.description,
      new Date(r.created_at).toISOString(),
    ]);

    const csvContent = convertToCSV(headers, csvRows);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="ledger-audit-${currency}-${Date.now()}.csv"`);
    return res.send(csvContent);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── 3. Risk Exposure Report ────────────────────────────────────────

router.get('/risk', async (req: Request, res: Response) => {
  try {
    const format = ((req.query.format as string) || 'csv').toLowerCase();

    // Compute balance commitments and locked funds
    const balances = await query(
      `SELECT currency,
              COUNT(DISTINCT user_id) as active_traders,
              SUM(available_balance::numeric) as total_available,
              SUM(locked_balance::numeric) as total_locked,
              SUM(available_balance::numeric + locked_balance::numeric) as total_supply
       FROM accounts
       GROUP BY currency`
    );

    // Compute order status statistics
    const orderStats = await query(
      `SELECT status, COUNT(*) as count
       FROM orders
       GROUP BY status`
    );

    const reportData = {
      timestamp: new Date().toISOString(),
      balanceCommitments: balances,
      orderDistribution: orderStats,
    };

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="risk-report-${Date.now()}.json"`);
      return res.json(reportData);
    }

    const headers = ['Category', 'Item / Currency', 'Value', 'Unit'];
    const csvRows: any[][] = [];

    for (const b of balances) {
      csvRows.push(['Capital Commitment', `${b.currency} Available`, b.total_available, b.currency]);
      csvRows.push(['Capital Commitment', `${b.currency} Locked in Orders`, b.total_locked, b.currency]);
      csvRows.push(['Capital Commitment', `${b.currency} Total Equity`, b.total_supply, b.currency]);
      csvRows.push(['Traders Count', `${b.currency} Active Wallets`, b.active_traders, 'Accounts']);
    }

    for (const o of orderStats) {
      csvRows.push(['Order Lifecycle', `Orders ${o.status}`, o.count, 'Orders']);
    }

    const csvContent = convertToCSV(headers, csvRows);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="risk-report-${Date.now()}.csv"`);
    return res.send(csvContent);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
