import { create } from 'zustand';
import { TradeTickData } from '@/types';

interface TradeState {
  recentTrades: TradeTickData[];
  lastPrice: string | null;
  lastSide: 'buy' | 'sell' | null;
  addTrade: (trade: TradeTickData) => void;
  setTrades: (trades: TradeTickData[]) => void;
}

export const useTradeStore = create<TradeState>((set) => ({
  recentTrades: [],
  lastPrice: null,
  lastSide: null,
  addTrade: (trade) =>
    set((state) => ({
      recentTrades: [trade, ...state.recentTrades].slice(0, 50),
      lastPrice: trade.price,
      lastSide: trade.buyerId ? 'buy' : 'sell',
    })),
  setTrades: (trades) =>
    set({
      recentTrades: trades.slice(0, 50),
      lastPrice: trades.length > 0 ? trades[0].price : null,
    }),
}));
