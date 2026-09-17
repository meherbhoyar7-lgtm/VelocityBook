'use client';

import { useEffect, useState } from 'react';
import { useTradeStore } from '@/stores/useTradeStore';
import { useUserStore } from '@/stores/useUserStore';
import { api } from '@/lib/api';
import { formatPrice, formatQuantity } from '@/lib/utils';
import { TradeTickData } from '@/types';

export default function RecentTrades() {
  const recentTrades = useTradeStore((s) => s.recentTrades);
  const setTrades = useTradeStore((s) => s.setTrades);
  const selectedSymbol = useUserStore((s) => s.selectedSymbol);
  const [loading, setLoading] = useState(true);

  // Fetch recent trades from backend on mount or symbol change
  useEffect(() => {
    let isMounted = true;

    const fetchTrades = async () => {
      try {
        const res = await api.getRecentTrades(selectedSymbol);
        if (isMounted && res.trades) {
          const mapped: TradeTickData[] = res.trades.map((t) => ({
            tradeId: t.tradeId || t.id || '',
            symbol: t.symbol,
            price: t.price,
            quantity: t.quantity,
            buyerId: t.buyerId || t.buyer_id || '',
            sellerId: t.sellerId || t.seller_id || '',
            timestamp: t.timestamp || (t.executed_at ? new Date(t.executed_at).getTime() : Date.now()),
          }));
          setTrades(mapped);

        }
      } catch (err) {
        console.error('[RecentTrades] Failed to fetch trades:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchTrades();

    return () => {
      isMounted = false;
    };
  }, [selectedSymbol, setTrades]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toTimeString().split(' ')[0];
  };

  const quoteCurrency = selectedSymbol.split('-')[1] || 'INR';

  return (
    <div className="flex flex-col h-full bg-[#131722] border-l border-[#1E222D] text-xs font-mono">
      {/* Header */}
      <div className="grid grid-cols-3 px-3 py-2 text-[#787B86] border-b border-[#1E222D] text-[10px] uppercase tracking-wider">
        <span>Price ({quoteCurrency})</span>
        <span className="text-right">Size</span>
        <span className="text-right">Time</span>
      </div>

      {/* Trades List */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#1E222D]/40">
        {loading && recentTrades.length === 0 ? (
          <div className="p-4 text-center text-[#787B86]">Loading trades...</div>
        ) : recentTrades.length === 0 ? (
          <div className="p-4 text-center text-[#787B86]">No recent trades</div>
        ) : (
          recentTrades.map((t, idx) => {
            // Check side based on buyer/seller or price direction
            const isBuy = t.buyerId ? true : idx < recentTrades.length - 1 ? Number(t.price) >= Number(recentTrades[idx + 1].price) : true;
            return (
              <div
                key={t.tradeId || `${t.timestamp}-${idx}`}
                className="grid grid-cols-3 px-3 py-[3px] hover:bg-[#1E222D]/50 transition-colors"
              >
                <span className={isBuy ? 'text-[#089981]' : 'text-[#F23645]'}>
                  {formatPrice(t.price, 2, quoteCurrency)}
                </span>

                <span className="text-right text-[#D1D4DC]">
                  {formatQuantity(t.quantity)}
                </span>
                <span className="text-right text-[#787B86]">
                  {formatTime(t.timestamp)}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
