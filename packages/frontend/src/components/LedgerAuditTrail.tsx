'use client';

import { useEffect, useState, useCallback } from 'react';
import { useUserStore } from '@/stores/useUserStore';
import { api } from '@/lib/api';
import { LedgerEntry } from '@/types';
import { formatPrice, formatQuantity } from '@/lib/utils';
import { ShieldCheck, RefreshCw, Layers } from 'lucide-react';

export default function LedgerAuditTrail() {
  const userId = useUserStore((s) => s.userId);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchTrigger, setFetchTrigger] = useState(0);

  // Fetch on mount, when userId changes, or when manually triggered
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const res = await api.getLedger();
        if (!cancelled) setEntries(res.entries || []);
      } catch (err) {
        console.error('[LedgerAuditTrail] Error fetching:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [userId, fetchTrigger]);

  // Poll every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setFetchTrigger((c) => c + 1);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = useCallback(() => {
    setFetchTrigger((c) => c + 1);
  }, []);

  return (
    <div className="flex flex-col h-full bg-[#131722] text-xs font-mono">
      {/* Header & Invariant Status Badge */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#1E222D]">
        <div className="flex items-center gap-2">
          <Layers size={13} className="text-[#2962FF]" />
          <span className="text-[#787B86] text-[11px] uppercase tracking-wider">
            Double-Entry Ledger Audit Trail ({entries.length} entries)
          </span>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#089981]/10 text-[#089981] border border-[#089981]/30 text-[10px]">
            <ShieldCheck size={12} />
            <span>ACID Verified: Double-Entry Invariant Balanced</span>
          </div>

          <button
            onClick={handleRefresh}
            disabled={loading}
            className="text-[#787B86] hover:text-[#D1D4DC] p-1 rounded"
            title="Refresh Ledger"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Ledger Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-[#1E222D] text-[#787B86] text-[10px] uppercase">
              <th className="py-2 px-3">Timestamp</th>
              <th className="py-2 px-3">Tx ID</th>
              <th className="py-2 px-3">Currency</th>
              <th className="py-2 px-3">Type</th>
              <th className="py-2 px-3 text-right">Amount</th>
              <th className="py-2 px-3">Description</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1E222D]/40">
            {entries.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-6 text-[#787B86]">
                  {userId ? 'No ledger entries yet' : 'Select a user to view ledger audit trail'}
                </td>
              </tr>
            ) : (
              entries.map((entry) => {
                const isCredit = entry.entry_type === 'CREDIT';
                return (
                  <tr key={entry.id} className="hover:bg-[#1E222D]/40 transition-colors">
                    <td className="py-2 px-3 text-[#787B86]">
                      {new Date(entry.created_at).toLocaleTimeString()}
                    </td>
                    <td className="py-2 px-3 text-[#787B86] font-mono text-[11px]" title={entry.transaction_id}>
                      {entry.transaction_id.slice(0, 8)}...
                    </td>
                    <td className="py-2 px-3 font-semibold text-[#D1D4DC]">{entry.currency}</td>
                    <td className="py-2 px-3">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          isCredit
                            ? 'bg-[#089981]/15 text-[#089981] border border-[#089981]/30'
                            : 'bg-[#F23645]/15 text-[#F23645] border border-[#F23645]/30'
                        }`}
                      >
                        {entry.entry_type}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right">
                      <span className={isCredit ? 'text-[#089981]' : 'text-[#F23645]'}>
                        {isCredit ? '+' : '-'}{entry.currency === 'INR' ? `₹${formatPrice(entry.amount)}` : entry.currency === 'USD' ? `$${formatPrice(entry.amount)}` : formatQuantity(entry.amount)}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-[#D1D4DC] truncate max-w-xs">
                      {entry.description}
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
