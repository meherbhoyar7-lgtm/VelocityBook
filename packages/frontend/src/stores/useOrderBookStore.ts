import { create } from 'zustand';
import { PriceLevelData } from '@/types';

interface OrderBookState {
  bids: PriceLevelData[];
  asks: PriceLevelData[];
  spread: string | null;
  midPrice: string | null;
  lastUpdate: number;
  setOrderBook: (data: {
    bids: PriceLevelData[];
    asks: PriceLevelData[];
    spread: string | null;
    midPrice: string | null;
  }) => void;
}

/**
 * Isolated Zustand store for order book data.
 * Components subscribe via granular selectors to prevent re-render cascades.
 */
export const useOrderBookStore = create<OrderBookState>((set) => ({
  bids: [],
  asks: [],
  spread: null,
  midPrice: null,
  lastUpdate: 0,
  setOrderBook: (data) =>
    set({
      bids: data.bids,
      asks: data.asks,
      spread: data.spread,
      midPrice: data.midPrice,
      lastUpdate: Date.now(),
    }),
}));
