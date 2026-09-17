'use client';

import { useState, useEffect } from 'react';
import Header from '@/components/Header';
import CandlestickChart from '@/components/CandlestickChart';
import OrderBook from '@/components/OrderBook';
import OrderEntry from '@/components/OrderEntry';
import RecentTrades from '@/components/RecentTrades';
import BottomDock from '@/components/BottomDock';
import TradeReplayBar from '@/components/TradeReplayBar';
import { useWebSocket } from '@/stores/useWebSocket';
import { useOrderBookStore } from '@/stores/useOrderBookStore';
import { useTradeStore } from '@/stores/useTradeStore';
import { useUserStore } from '@/stores/useUserStore';
import { OrderBookData, TradeTickData } from '@/types';

interface TradingTerminalClientProps {
  initialOrderBook?: OrderBookData | null;
  initialTrades?: TradeTickData[];
  initialSymbols?: string[];
  initialSymbol?: string;
}

export default function TradingTerminalClient({
  initialOrderBook,
  initialTrades,
  initialSymbol = 'BTC-INR',
}: TradingTerminalClientProps) {

  // Hydrate Zustand stores once on mount with SSR data
  const [initialized] = useState(() => {
    if (initialOrderBook) {
      useOrderBookStore.setState({
        bids: initialOrderBook.bids || [],
        asks: initialOrderBook.asks || [],
        spread: initialOrderBook.spread,
        midPrice: initialOrderBook.midPrice,
        lastUpdate: initialOrderBook.timestamp || 0,
      });
    }

    if (initialTrades && initialTrades.length > 0) {
      useTradeStore.setState({
        recentTrades: initialTrades.slice(0, 50),
        lastPrice: initialTrades[0]?.price || null,
        lastSide: initialTrades[0]?.buyerId ? 'buy' : 'sell',
      });
    }

    if (initialSymbol) {
      useUserStore.setState({ selectedSymbol: initialSymbol });
    }

    return true;
  });

  // Activate WebSocket connection to backend for live real-time updates
  useWebSocket();

  // Price clicked in OrderBook populates OrderEntry
  const [selectedPrice, setSelectedPrice] = useState<string | undefined>(undefined);
  const [showReplay, setShowReplay] = useState(true);

  useEffect(() => {
    // When initialSymbol is provided, ensure user store is synced
    if (initialized && initialSymbol && useUserStore.getState().selectedSymbol !== initialSymbol) {
      useUserStore.getState().setSelectedSymbol(initialSymbol);
    }
  }, [initialSymbol, initialized]);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#0B0E14] text-[#D1D4DC] select-none font-sans">
      {/* Top Header */}
      <Header
        onToggleReplay={() => setShowReplay((v) => !v)}
        isReplayOpen={showReplay}
      />

      {/* Historical Trade Replay & Simulation Ribbon */}
      {showReplay && <TradeReplayBar onClose={() => setShowReplay(false)} />}


      {/* Main Trading Terminal Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Section: Chart & Bottom Dock */}
        <div className="flex-1 flex flex-col min-w-0 border-r border-[#1E222D]">
          {/* Top: 60fps Candlestick & Volume Chart */}
          <div className="flex-[3] min-h-[350px] relative overflow-hidden">
            <CandlestickChart />
          </div>

          {/* Bottom: Tabs for Open Orders, Trades, Portfolio, Ledger */}
          <div className="flex-[2] min-h-[200px] relative overflow-hidden">
            <BottomDock />
          </div>
        </div>

        {/* Right Section: Order Book, Order Entry, and Recent Trades */}
        <div className="w-[620px] shrink-0 flex">
          {/* L2 Depth Order Book */}
          <div className="w-[280px] h-full overflow-hidden">
            <OrderBook onPriceClick={(p) => setSelectedPrice(p)} />
          </div>

          {/* Right Column: Order Entry on top, Recent Trades on bottom */}
          <div className="flex-1 flex flex-col h-full min-w-0 border-l border-[#1E222D]">
            <div className="shrink-0">
              <OrderEntry initialPrice={selectedPrice} />
            </div>
            <div className="flex-1 overflow-hidden border-t border-[#1E222D]">
              <RecentTrades />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
