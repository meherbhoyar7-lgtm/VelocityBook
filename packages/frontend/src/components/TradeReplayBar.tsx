'use client';

import { useState, useEffect } from 'react';
import { Play, Pause, Square, FastForward, Clock, History, X } from 'lucide-react';
import { useUserStore } from '@/stores/useUserStore';

interface ReplayStatus {
  active: boolean;
  paused: boolean;
  symbol: string;
  speed: number;
  currentIndex: number;
  totalTrades: number;
}

interface TradeReplayBarProps {
  onClose?: () => void;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export default function TradeReplayBar({ onClose }: TradeReplayBarProps = {}) {

  const selectedSymbol = useUserStore((s) => s.selectedSymbol);
  const [status, setStatus] = useState<ReplayStatus>({
    active: false,
    paused: false,
    symbol: selectedSymbol,
    speed: 5,
    currentIndex: 0,
    totalTrades: 0,
  });
  const [loading, setLoading] = useState(false);

  // Poll status when replay is active
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (status.active && !status.paused) {
      interval = setInterval(async () => {
        try {
          const res = await fetch(`${API_URL}/api/replay/status`);
          if (res.ok) {
            const data = await res.json();
            setStatus(data);
          }
        } catch {}
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [status.active, status.paused]);

  const handleStart = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/replay/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: selectedSymbol, speed: status.speed, limit: 300 }),
      });
      if (res.ok) {
        const data = await res.json();
        setStatus(data.status);
      }
    } catch (err) {
      console.error('Failed to start replay:', err);
    } finally {
      setLoading(false);
    }
  };

  const handlePause = async () => {
    try {
      const res = await fetch(`${API_URL}/api/replay/pause`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setStatus(data.status);
      }
    } catch {}
  };

  const handleResume = async () => {
    try {
      const res = await fetch(`${API_URL}/api/replay/resume`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setStatus(data.status);
      }
    } catch {}
  };

  const handleStop = async () => {
    try {
      const res = await fetch(`${API_URL}/api/replay/stop`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setStatus(data.status);
      }
    } catch {}
  };

  const handleSpeedChange = async (speed: number) => {
    setStatus((prev) => ({ ...prev, speed }));
    if (status.active) {
      try {
        await fetch(`${API_URL}/api/replay/speed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ speed }),
        });
      } catch {}
    }
  };

  const progressPercent = status.totalTrades > 0
    ? Math.min(100, Math.round((status.currentIndex / status.totalTrades) * 100))
    : 0;

  return (
    <div className="flex items-center justify-between px-3 py-1 bg-[#131722] border-b border-[#1E222D] text-xs font-sans select-none">
      {/* Left: Replay Status Indicator */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#1E222D] text-[#D1D4DC]">
          <History size={13} className="text-[#2962FF]" />
          <span className="font-semibold uppercase tracking-wider text-[10px]">Trade Replay</span>
        </div>

        {status.active ? (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
            <span>{status.paused ? 'PAUSED' : 'REPLAYING'}</span>
            <span className="text-[#787B86]">({status.currentIndex}/{status.totalTrades})</span>
          </div>
        ) : (
          <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>LIVE STREAM</span>
          </div>
        )}
      </div>

      {/* Center: Playback Controls */}
      <div className="flex items-center gap-2">
        {!status.active ? (
          <button
            onClick={handleStart}
            disabled={loading}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#2962FF] hover:bg-[#1E4BD8] text-white font-medium transition-colors"
          >
            <Play size={12} fill="currentColor" />
            <span>Start Session Replay</span>
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            {status.paused ? (
              <button
                onClick={handleResume}
                className="p-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
                title="Resume Replay"
              >
                <Play size={13} fill="currentColor" />
              </button>
            ) : (
              <button
                onClick={handlePause}
                className="p-1 rounded bg-yellow-600 hover:bg-yellow-500 text-white transition-colors"
                title="Pause Replay"
              >
                <Pause size={13} fill="currentColor" />
              </button>
            )}

            <button
              onClick={handleStop}
              className="p-1 rounded bg-rose-600 hover:bg-rose-500 text-white transition-colors"
              title="Stop Replay"
            >
              <Square size={13} fill="currentColor" />
            </button>

            {/* Progress Bar */}
            <div className="w-32 bg-[#1E222D] h-1.5 rounded overflow-hidden">
              <div
                className="bg-[#2962FF] h-full transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Speed Selector */}
        <div className="flex items-center gap-1 bg-[#1E222D] p-0.5 rounded ml-2">
          <FastForward size={11} className="text-[#787B86] ml-1" />
          {[1, 5, 10, 60].map((s) => (
            <button
              key={s}
              onClick={() => handleSpeedChange(s)}
              className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                status.speed === s ? 'bg-[#2962FF] text-white' : 'text-[#787B86] hover:text-[#D1D4DC]'
              }`}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>

      {/* Right: Quick Link to Grafana Metrics */}
      <div className="flex items-center gap-2 text-[#787B86]">
        <Clock size={12} />
        <span className="text-[11px]">{selectedSymbol} Session</span>
        <a
          href="http://localhost:3002"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#2962FF] hover:underline text-[11px] ml-1 font-medium"
        >
          Open Grafana ↗
        </a>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 text-[#787B86] hover:text-[#D1D4DC] rounded hover:bg-[#1E222D] ml-1 transition-colors"
            title="Hide Replay Bar"
          >
            <X size={12} />
          </button>
        )}
      </div>

    </div>
  );
}
