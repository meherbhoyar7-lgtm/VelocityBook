import { Router, Request, Response } from 'express';
import { query } from '../db/pool';

const router = Router();

// GET /api/portfolio — Get user's balances
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const accounts = await query(
      `SELECT currency, available_balance, locked_balance,
              (available_balance::numeric + locked_balance::numeric) as total_balance
       FROM accounts
       WHERE user_id = $1
       ORDER BY currency`,
      [userId]
    );

    return res.json({ accounts });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;
