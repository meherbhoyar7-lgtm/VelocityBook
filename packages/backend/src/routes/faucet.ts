import { Router, Request, Response } from 'express';
import Decimal from 'decimal.js';
import { RiskService } from '../services/RiskService';
import { LedgerService } from '../services/LedgerService';

const router = Router();

// POST /api/faucet — Deposit virtual funds
router.post('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const { currency, amount } = req.body;

    if (!currency || !amount) {
      return res.status(400).json({ error: 'Currency and amount are required' });
    }

    const validCurrencies = ['INR', 'USD', 'BTC', 'ETH'];
    if (!validCurrencies.includes(currency)) {
      return res.status(400).json({ error: `Invalid currency. Supported: ${validCurrencies.join(', ')}` });
    }

    const depositAmount = new Decimal(amount);
    if (depositAmount.lte(0)) {
      return res.status(400).json({ error: 'Amount must be positive' });
    }

    // Max faucet limits per deposit
    const limits: Record<string, number> = { INR: 10000000, USD: 100000, BTC: 10, ETH: 100 };
    if (depositAmount.gt(limits[currency])) {
      return res.status(400).json({ error: `Maximum deposit: ${limits[currency]} ${currency}` });
    }

    await RiskService.depositFaucet(userId, currency, depositAmount);

    return res.json({
      message: `Deposited ${depositAmount.toFixed(currency === 'INR' || currency === 'USD' ? 2 : 8)} ${currency}`,
      currency,
      amount: depositAmount.toString(),
    });
  } catch (error: any) {
    console.error('[Faucet] Deposit error:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

// GET /api/ledger — Get user's double-entry audit trail
router.get('/ledger', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const entries = await LedgerService.getUserLedger(userId, 200);
    return res.json({ entries });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
