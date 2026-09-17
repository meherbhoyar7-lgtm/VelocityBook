'use client';

import { useEffect, useState, useCallback } from 'react';
import { useUserStore } from '@/stores/useUserStore';
import { api } from '@/lib/api';
import { OpenOrder } from '@/types';
import { formatPrice, formatQuantity } from '@/lib/utils';
import { Trash2, RefreshCw } from 'lucide-react';

export default function ActiveOrders() {
  const userId = useUserStore((s) => s.userId);
  const setAccounts = useUserStore((s) => s.setAccounts);
  const [orders, setOrders] = useState<OpenOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [fetchTrigger, setFetchTrigger] = useState(0);

  // Fetch on mount, when userId changes, or when manually triggered
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const res = await api.getOpenOrders();
        if (!cancelled) setOrders(res.orders || []);
      } catch (err) {
        console.error('[ActiveOrders] Error fetching:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [userId, fetchTrigger]);

  // Poll every 3 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setFetchTrigger((c) => c + 1);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = useCallback(() => {
    setFetchTrigger((c) => c + 1);
  }, []);

  const handleCancel = async (id: string) => {
    setCancellingId(id);
    try {
      await api.cancelOrder(id);
      setOrders((prev) => prev.filter((o) => o.id !== id));
      // Refresh portfolio balances
      const portfolio = await api.getPortfolio();
      setAccounts(portfolio.accounts);
    } catch (err: unknown) {
      console.error('[ActiveOrders] Cancel failed:', err instanceof Error ? err.message : err);
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#131722] text-xs font-mono">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#1E222D]">
        <span className="text-[#787B86] text-[11px] uppercase tracking-wider">
          Open Orders ({orders.length})
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
              <th className="py-2 px-3">Type</th>
              <th className="py-2 px-3">Side</th>
              <th className="py-2 px-3 text-right">Price</th>
              <th className="py-2 px-3 text-right">Amount</th>
              <th className="py-2 px-3 text-right">Filled</th>
              <th className="py-2 px-3 text-right">Status</th>
              <th className="py-2 px-3 text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1E222D]/40">
            {orders.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-6 text-[#787B86]">
                  {userId ? 'No open orders' : 'Select or switch user to view orders'}
                </td>
              </tr>
            ) : (
              orders.map((order) => {
                const filledPct = Number(order.quantity) > 0
                  ? ((Number(order.filled_quantity) / Number(order.quantity)) * 100).toFixed(1)
                  : '0.0';
                return (
                  <tr key={order.id} className="hover:bg-[#1E222D]/40 transition-colors">
                    <td className="py-2 px-3 text-[#787B86]">
                      {new Date(order.created_at).toLocaleTimeString()}
                    </td>
                    <td className="py-2 px-3 font-semibold text-[#D1D4DC]">{order.symbol}</td>
                    <td className="py-2 px-3 text-[#787B86]">{order.type}</td>
                    <td className="py-2 px-3">
                      <span className={order.side === 'BUY' ? 'text-[#089981]' : 'text-[#F23645]'}>
                        {order.side}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right text-[#D1D4DC]">
                      {order.price ? `$${formatPrice(order.price)}` : 'Market'}
                    </td>
                    <td className="py-2 px-3 text-right text-[#D1D4DC]">
                      {formatQuantity(order.quantity)}
                    </td>
                    <td className="py-2 px-3 text-right text-[#787B86]">
                      {formatQuantity(order.filled_quantity)} ({filledPct}%)
                    </td>
                    <td className="py-2 px-3 text-right">
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-[#1E222D] text-[#2962FF] border border-[#2962FF]/30">
                        {order.status}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-center">
                      <button
                        onClick={() => handleCancel(order.id)}
                        disabled={cancellingId === order.id}
                        className="p-1 text-[#F23645] hover:bg-[#F23645]/20 rounded transition-colors disabled:opacity-50"
                        title="Cancel Order"
                      >
                        <Trash2 size={13} />
                      </button>
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
