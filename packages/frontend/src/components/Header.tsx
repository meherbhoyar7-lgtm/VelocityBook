'use client';

import { useEffect } from 'react';
import { Activity, Wifi, WifiOff, ChevronDown, DollarSign } from 'lucide-react';
import { useUserStore } from '@/stores/useUserStore';
import { useTradeStore } from '@/stores/useTradeStore';
import { useOrderBookStore } from '@/stores/useOrderBookStore';
import { api } from '@/lib/api';
import { formatPrice } from '@/lib/utils';

export default function Header() {
  const userId = useUserStore((s) => s.userId);
  const displayName = useUserStore((s) => s.displayName);
  const demoUsers = useUserStore((s) => s.demoUsers);
  const accounts = useUserStore((s) => s.accounts);
  const selectedSymbol = useUserStore((s) => s.selectedSymbol);
  const isConnected = useUserStore((s) => s.isConnected);
  const setUser = useUserStore((s) => s.setUser);
  const setAccounts = useUserStore((s) => s.setAccounts);
  const setDemoUsers = useUserStore((s) => s.setDemoUsers);
  const setSelectedSymbol = useUserStore((s) => s.setSelectedSymbol);
  const lastPrice = useTradeStore((s) => s.lastPrice);
  const midPrice = useOrderBookStore((s) => s.midPrice);
  const spread = useOrderBookStore((s) => s.spread);

  // Load demo users on mount
  useEffect(() => {
    api.getDemoUsers().then((res) => setDemoUsers(res.users)).catch(() => {});
  }, [setDemoUsers]);

  // Auto-login as Alice
  useEffect(() => {
    if (!userId && demoUsers.length > 0) {
      handleSwitchUser(demoUsers[0].id);
    }
  }, [demoUsers, userId]);

  const handleSwitchUser = async (id: string) => {
    try {
      const res = await api.switchUser(id);
      setUser(res.user.id, res.user.displayName, res.token);
      const portfolio = await api.getPortfolio();
      setAccounts(portfolio.accounts);
    } catch (err) {
      console.error('Switch user failed:', err);
    }
  };

  const handleDeposit = async () => {
    try {
      await api.depositFaucet('USD', '10000');
      const portfolio = await api.getPortfolio();
      setAccounts(portfolio.accounts);
    } catch (err) {
      console.error('Deposit failed:', err);
    }
  };

  const usdAccount = accounts.find((a) => a.currency === 'USD');

  return (
    <header className="h-14 border-b border-[#1E222D] bg-[#131722] flex items-center px-4 gap-6 text-sm">
      {/* Logo & Symbol */}
      <div className="flex items-center gap-3">
        <span className="text-[#2962FF] font-bold text-lg tracking-tight">VB</span>
        <select
          value={selectedSymbol}
          onChange={(e) => setSelectedSymbol(e.target.value)}
          className="bg-[#1E222D] text-[#D1D4DC] border border-[#2A2E39] rounded px-3 py-1.5 text-sm font-mono cursor-pointer focus:outline-none focus:border-[#2962FF]"
        >
          <option value="BTC-USD">BTC / USD</option>
          <option value="ETH-USD">ETH / USD</option>
        </select>
      </div>

      {/* Price & Stats */}
      <div className="flex items-center gap-5 font-mono">
        <div>
          <span className="text-[#787B86] text-xs mr-1">Last</span>
          <span className="text-[#D1D4DC] font-semibold text-base">
            ${lastPrice ? formatPrice(lastPrice) : midPrice ? formatPrice(midPrice) : '—'}
          </span>
        </div>
        <div>
          <span className="text-[#787B86] text-xs mr-1">Spread</span>
          <span className="text-[#D1D4DC]">{spread ? formatPrice(spread) : '—'}</span>
        </div>
        <div>
          <span className="text-[#787B86] text-xs mr-1">Mid</span>
          <span className="text-[#D1D4DC]">{midPrice ? formatPrice(midPrice) : '—'}</span>
        </div>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Connection Status */}
      <div className="flex items-center gap-1.5">
        {isConnected ? (
          <>
            <div className="w-2 h-2 rounded-full bg-[#089981] animate-pulse" />
            <Wifi size={14} className="text-[#089981]" />
            <span className="text-[#089981] text-xs">Live</span>
          </>
        ) : (
          <>
            <div className="w-2 h-2 rounded-full bg-[#F23645]" />
            <WifiOff size={14} className="text-[#F23645]" />
            <span className="text-[#F23645] text-xs">Offline</span>
          </>
        )}
      </div>

      {/* Deposit Button */}
      <button
        onClick={handleDeposit}
        className="flex items-center gap-1 px-3 py-1.5 bg-[#2962FF]/10 border border-[#2962FF]/30 text-[#2962FF] rounded hover:bg-[#2962FF]/20 transition-colors text-xs"
      >
        <DollarSign size={12} />
        Deposit
      </button>

      {/* Balance */}
      {usdAccount && (
        <div className="font-mono text-xs">
          <span className="text-[#787B86]">USD: </span>
          <span className="text-[#D1D4DC]">${formatPrice(usdAccount.available_balance)}</span>
        </div>
      )}

      {/* User Switcher */}
      <div className="relative">
        <select
          value={userId || ''}
          onChange={(e) => handleSwitchUser(e.target.value)}
          className="bg-[#1E222D] text-[#D1D4DC] border border-[#2A2E39] rounded px-3 py-1.5 text-xs cursor-pointer focus:outline-none focus:border-[#2962FF] appearance-none pr-6"
        >
          {demoUsers.map((u) => (
            <option key={u.id} value={u.id}>{u.display_name}</option>
          ))}
        </select>
        <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#787B86] pointer-events-none" />
      </div>
    </header>
  );
}
