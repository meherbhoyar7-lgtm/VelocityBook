import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../db/pool';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'velocitybook-dev-secret-key';

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, displayName } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const users = await query(
      `INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id, email, display_name`,
      [email, passwordHash, displayName || email.split('@')[0]]
    );

    const user = users[0];

    // Create default accounts (USD, BTC, ETH)
    for (const currency of ['USD', 'BTC', 'ETH']) {
      await query(
        `INSERT INTO accounts (user_id, currency, available_balance) VALUES ($1, $2, 0)`,
        [user.id, currency]
      );
    }

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '24h' });

    return res.status(201).json({ user, token });
  } catch (error: any) {
    console.error('[Auth] Register error:', error.message);
    return res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const users = await query(
      'SELECT id, email, password_hash, display_name FROM users WHERE email = $1',
      [email]
    );

    if (users.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = users[0];
    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '24h' });

    return res.json({
      user: { id: user.id, email: user.email, displayName: user.display_name },
      token,
    });
  } catch (error: any) {
    console.error('[Auth] Login error:', error.message);
    return res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/auth/demo-users
router.get('/demo-users', async (_req: Request, res: Response) => {
  try {
    const users = await query(
      `SELECT u.id, u.email, u.display_name,
              json_agg(json_build_object('currency', a.currency, 'available', a.available_balance, 'locked', a.locked_balance)) as accounts
       FROM users u
       JOIN accounts a ON u.id = a.user_id
       GROUP BY u.id, u.email, u.display_name
       ORDER BY u.display_name`
    );

    return res.json({ users });
  } catch (error: any) {
    console.error('[Auth] Demo users error:', error.message);
    return res.status(500).json({ error: 'Failed to fetch demo users' });
  }
});

// POST /api/auth/switch/:userId — Quick switch for demo
router.post('/switch/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    const users = await query(
      'SELECT id, email, display_name FROM users WHERE id = $1',
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '24h' });

    return res.json({
      user: { id: user.id, email: user.email, displayName: user.display_name },
      token,
    });
  } catch (error: any) {
    console.error('[Auth] Switch error:', error.message);
    return res.status(500).json({ error: 'User switch failed' });
  }
});

export default router;
export { JWT_SECRET };
