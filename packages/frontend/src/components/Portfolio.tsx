'use client';

import { useState } from 'react';
import { useUserStore } from '@/stores/useUserStore';
import { useTradeStore } from '@/stores/useTradeStore';
import { useOrderBookStore } from '@/stores/useOrderBookStore';
import { api } from '@/lib/api';
import { formatPrice, formatQuantity } from '@/lib/utils';
import { Wallet, PlusCircle, RefreshCw } from 'lucide-react';

export default function Portfolio() {
  const userId = useUserStore((s) => s.userId);
  const accounts = useUserStore((s) => s.accounts);
  const setAccounts = useUserStore((s) => s.setAccounts);
  const lastPrice = useTradeStore((s) => s.lastPrice);
  const midPrice = useOrderBookStore((s) => s.midPrice);

  const [depositing, setDepositing] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const btcPrice = Number(lastPrice || midPrice || 5000000);
  const ethPrice = 280000; // Reference price in INR

  const refreshBalances = async () => {
    setRefreshing(true);
    try {
      const res = await api.getPortfolio();
      setAccounts(res.accounts || []);
    } catch (err) {
      console.error('[Portfolio] Failed to refresh:', err);
    } finally {
      setRefreshing(false);
    }
  };

  const handleDeposit = async (currency: string, amount: string) => {
    setDepositing(currency);
    try {
      await api.depositFaucet(currency, amount);
      await refreshBalances();
    } catch (err) {
      console.error('[Portfolio] Faucet deposit error:', err);
    } finally {
      setDepositing(null);
    }
  };

  // Calculate estimated total INR value
  let totalEstINR = 0;
  accounts.forEach((acc) => {
    const total = Number(acc.total_balance || 0);
    if (acc.currency === 'INR') totalEstINR += total;
    else if (acc.currency === 'USD') totalEstINR += total * 85;
    else if (acc.currency === 'BTC') totalEstINR += total * btcPrice;
    else if (acc.currency === 'ETH') totalEstINR += total * ethPrice;
  });

  return (
    <div className="flex flex-col h-full bg-[#131722] text-xs font-mono">
      {/* Summary Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#1E222D]">
        <div className="flex items-center gap-3">
          <Wallet size={15} className="text-[#2962FF]" />
          <span className="text-[#787B86] text-[11px] uppercase tracking-wider">
            Total Account Value:
          </span>
          <span className="text-[#D1D4DC] font-bold text-sm">
            ₹{formatPrice(totalEstINR)}
          </span>
        </div>
        <button
          onClick={refreshBalances}
          disabled={refreshing}
          className="text-[#787B86] hover:text-[#D1D4DC] p-1 rounded"
          title="Refresh Balances"
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Asset Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-[#1E222D] text-[#787B86] text-[10px] uppercase">
              <th className="py-2 px-3">Asset</th>
              <th className="py-2 px-3 text-right">Available</th>
              <th className="py-2 px-3 text-right">In Orders (Locked)</th>
              <th className="py-2 px-3 text-right">Total Balance</th>
              <th className="py-2 px-3 text-right">Est. Value (₹)</th>
              <th className="py-2 px-3 text-center">Faucet Deposit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1E222D]/40">
            {accounts.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-6 text-[#787B86]">
                  {userId ? 'No balances found' : 'Select user to view balances'}
                </td>
              </tr>
            ) : (
              accounts.map((acc) => {
                const total = Number(acc.total_balance || 0);
                const estValue = acc.currency === 'INR'
                  ? total
                  : acc.currency === 'USD'
                  ? total * 85
                  : acc.currency === 'BTC'
                  ? total * btcPrice
                  : total * ethPrice;

                return (
                  <tr key={acc.currency} className="hover:bg-[#1E222D]/40 transition-colors">
                    <td className="py-2 px-3 font-semibold text-[#D1D4DC]">
                      {acc.currency}
                    </td>
                    <td className="py-2 px-3 text-right text-[#089981]">
                      {acc.currency === 'INR' ? `₹${formatPrice(acc.available_balance)}` : acc.currency === 'USD' ? `$${formatPrice(acc.available_balance)}` : formatQuantity(acc.available_balance)}
                    </td>
                    <td className="py-2 px-3 text-right text-[#F23645]">
                      {acc.currency === 'INR' ? `₹${formatPrice(acc.locked_balance)}` : acc.currency === 'USD' ? `$${formatPrice(acc.locked_balance)}` : formatQuantity(acc.locked_balance)}
                    </td>
                    <td className="py-2 px-3 text-right text-[#D1D4DC] font-medium">
                      {acc.currency === 'INR' ? `₹${formatPrice(acc.total_balance)}` : acc.currency === 'USD' ? `$${formatPrice(acc.total_balance)}` : formatQuantity(acc.total_balance)}
                    </td>
                    <td className="py-2 px-3 text-right text-[#787B86]">
                      ₹{formatPrice(estValue)}
                    </td>
                    <td className="py-2 px-3 text-center">
                      <button
                        onClick={() => handleDeposit(acc.currency, acc.currency === 'INR' ? '100000' : acc.currency === 'USD' ? '10000' : '1')}
                        disabled={depositing === acc.currency}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-[#2962FF]/10 text-[#2962FF] hover:bg-[#2962FF]/20 border border-[#2962FF]/30 transition-colors disabled:opacity-50"
                      >
                        <PlusCircle size={10} />
                        +{acc.currency === 'INR' ? '₹1 Lakh' : acc.currency === 'USD' ? '$10K' : `1 ${acc.currency}`}
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
