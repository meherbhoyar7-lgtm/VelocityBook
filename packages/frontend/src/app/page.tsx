'use client';

import { useState } from 'react';
import Header from '@/components/Header';
import CandlestickChart from '@/components/CandlestickChart';
import OrderBook from '@/components/OrderBook';
import OrderEntry from '@/components/OrderEntry';
import RecentTrades from '@/components/RecentTrades';
import BottomDock from '@/components/BottomDock';
import { useWebSocket } from '@/stores/useWebSocket';

export default function TradingTerminal() {
  // Activate WebSocket connection to backend
  useWebSocket();

  // Price clicked in OrderBook populates OrderEntry
  const [selectedPrice, setSelectedPrice] = useState<string | undefined>(undefined);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#0B0E14] text-[#D1D4DC] select-none font-sans">
      {/* Top Header */}
      <Header />

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
