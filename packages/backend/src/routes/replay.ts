import { Router, Request, Response } from 'express';
import { ReplayService } from '../services/ReplayService';

const router = Router();

// GET /api/replay/status
router.get('/status', (_req: Request, res: Response) => {
  res.json(ReplayService.getStatus());
});

// POST /api/replay/start
router.post('/start', async (req: Request, res: Response) => {
  const { symbol, speed, limit } = req.body;
  const status = await ReplayService.startReplay({
    symbol,
    speed: speed ? Number(speed) : 1,
    limit: limit ? Number(limit) : 300,
  });
  res.json({ message: 'Historical trade replay started', status });
});

// POST /api/replay/pause
router.post('/pause', (_req: Request, res: Response) => {
  const status = ReplayService.pauseReplay();
  res.json({ message: 'Replay paused', status });
});

// POST /api/replay/resume
router.post('/resume', (_req: Request, res: Response) => {
  const status = ReplayService.resumeReplay();
  res.json({ message: 'Replay resumed', status });
});

// POST /api/replay/stop
router.post('/stop', (_req: Request, res: Response) => {
  const status = ReplayService.stopReplay();
  res.json({ message: 'Replay stopped', status });
});

// POST /api/replay/speed
router.post('/speed', (req: Request, res: Response) => {
  const { speed } = req.body;
  if (!speed || isNaN(Number(speed))) {
    return res.status(400).json({ error: 'Valid numeric speed multiplier required' });
  }
  const status = ReplayService.setSpeed(Number(speed));
  res.json({ message: `Replay speed set to ${status.speed}x`, status });
});

export default router;
