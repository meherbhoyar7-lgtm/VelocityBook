'use client';

import { useEffect, useState, useCallback } from 'react';
import { useUserStore } from '@/stores/useUserStore';
import { api } from '@/lib/api';
import { TradeHistoryEntry } from '@/types';
import { formatPrice, formatQuantity } from '@/lib/utils';
import { RefreshCw } from 'lucide-react';

export default function TradeHistory() {
  const userId = useUserStore((s) => s.userId);
  const [trades, setTrades] = useState<TradeHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchTrigger, setFetchTrigger] = useState(0);

  // Fetch on mount, when userId changes, or when manually triggered
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const res = await api.getUserTrades();
        if (!cancelled) setTrades(res.trades || []);
      } catch (err) {
        console.error('[TradeHistory] Error fetching:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [userId, fetchTrigger]);

  // Poll every 4 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setFetchTrigger((c) => c + 1);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = useCallback(() => {
    setFetchTrigger((c) => c + 1);
  }, []);

  return (
    <div className="flex flex-col h-full bg-[#131722] text-xs font-mono">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#1E222D]">
        <span className="text-[#787B86] text-[11px] uppercase tracking-wider">
          User Trade Executions ({trades.length})
        </span>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="text-[#787B86] hover:text-[#D1D4DC] p-1 rounded"
          title="Refresh"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-[#1E222D] text-[#787B86] text-[10px] uppercase">
              <th className="py-2 px-3">Time</th>
              <th className="py-2 px-3">Symbol</th>
              <th className="py-2 px-3">Side</th>
              <th className="py-2 px-3 text-right">Price</th>
              <th className="py-2 px-3 text-right">Executed Quantity</th>
              <th className="py-2 px-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1E222D]/40">
            {trades.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-6 text-[#787B86]">
                  {userId ? 'No trade executions yet' : 'Select a user to view trade history'}
                </td>
              </tr>
            ) : (
              trades.map((trade) => {
                const total = (Number(trade.price) * Number(trade.quantity)).toFixed(2);
                const sym = trade.symbol?.includes('USD') ? '$' : '₹';
                return (
                  <tr key={trade.id} className="hover:bg-[#1E222D]/40 transition-colors">
                    <td className="py-2 px-3 text-[#787B86]">
                      {new Date(trade.executed_at).toLocaleString()}
                    </td>
                    <td className="py-2 px-3 font-semibold text-[#D1D4DC]">{trade.symbol}</td>
                    <td className="py-2 px-3">
                      <span className={trade.side === 'BUY' ? 'text-[#089981]' : 'text-[#F23645]'}>
                        {trade.side}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right text-[#D1D4DC]">
                      {sym}{formatPrice(trade.price)}
                    </td>
                    <td className="py-2 px-3 text-right text-[#D1D4DC]">
                      {formatQuantity(trade.quantity)}
                    </td>
                    <td className="py-2 px-3 text-right text-[#787B86]">
                      {sym}{formatPrice(total)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
