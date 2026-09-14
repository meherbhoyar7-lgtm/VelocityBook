'use client';

import { useOrderBookStore } from '@/stores/useOrderBookStore';
import { formatPrice, formatQuantity } from '@/lib/utils';
import { useRef, useEffect, useState } from 'react';

interface OrderBookProps {
  onPriceClick?: (price: string) => void;
}

export default function OrderBook({ onPriceClick }: OrderBookProps) {
  const bids = useOrderBookStore((s) => s.bids);
  const asks = useOrderBookStore((s) => s.asks);
  const spread = useOrderBookStore((s) => s.spread);
  const midPrice = useOrderBookStore((s) => s.midPrice);

  // Track which rows changed for flash animation
  const [flashedRows, setFlashedRows] = useState<Set<string>>(new Set());
  const prevPricesRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const newFlashes = new Set<string>();
    const currentPrices = new Map<string, string>();

    [...asks, ...bids].forEach((level) => {
      currentPrices.set(level.price, level.size);
      const prevSize = prevPricesRef.current.get(level.price);
      if (prevSize && prevSize !== level.size) {
        newFlashes.add(level.price);
      }
    });

    if (newFlashes.size > 0) {
      setFlashedRows(newFlashes);
      setTimeout(() => setFlashedRows(new Set()), 300);
    }

    prevPricesRef.current = currentPrices;
  }, [asks, bids]);

  // Calculate max cumulative for depth bars
  const maxAskTotal = asks.length > 0 ? Number(asks[asks.length - 1]?.total || 0) : 1;
  const maxBidTotal = bids.length > 0 ? Number(bids[bids.length - 1]?.total || 0) : 1;

  const displayAsks = [...asks].slice(0, 15).reverse();
  const displayBids = bids.slice(0, 15);

  return (
    <div className="flex flex-col h-full bg-[#131722] border-r border-[#1E222D] text-xs font-mono">
      {/* Header */}
      <div className="grid grid-cols-3 px-3 py-2 text-[#787B86] border-b border-[#1E222D] text-[10px] uppercase tracking-wider">
        <span>Price (USD)</span>
        <span className="text-right">Size</span>
        <span className="text-right">Total</span>
      </div>

      {/* Asks (Red) — reversed so lowest is at bottom */}
      <div className="flex-1 overflow-hidden flex flex-col justify-end">
        {displayAsks.map((level) => {
          const depthPct = (Number(level.total) / maxAskTotal) * 100;
          const isFlashed = flashedRows.has(level.price);
          return (
            <div
              key={`ask-${level.price}`}
              onClick={() => onPriceClick?.(level.price)}
              className={`grid grid-cols-3 px-3 py-[3px] relative cursor-pointer hover:bg-[#F23645]/10 transition-colors ${
                isFlashed ? 'bg-[#F23645]/20' : ''
              }`}
            >
              {/* Depth bar */}
              <div
                className="absolute right-0 top-0 bottom-0 bg-[#F23645]/8"
                style={{ width: `${depthPct}%` }}
              />
              <span className="text-[#F23645] relative z-10">{formatPrice(level.price)}</span>
              <span className="text-right text-[#D1D4DC] relative z-10">{formatQuantity(level.size)}</span>
              <span className="text-right text-[#787B86] relative z-10">{formatQuantity(level.total)}</span>
            </div>
          );
        })}
      </div>

      {/* Spread */}
      <div className="px-3 py-2 border-y border-[#1E222D] bg-[#0B0E14] flex items-center justify-between">
        <span className="text-[#D1D4DC] font-semibold text-sm">
          {midPrice ? `$${formatPrice(midPrice)}` : '—'}
        </span>
        <span className="text-[#787B86] text-[10px]">
          Spread: {spread ? formatPrice(spread) : '—'}
        </span>
      </div>

      {/* Bids (Green) */}
      <div className="flex-1 overflow-hidden">
        {displayBids.map((level) => {
          const depthPct = (Number(level.total) / maxBidTotal) * 100;
          const isFlashed = flashedRows.has(level.price);
          return (
            <div
              key={`bid-${level.price}`}
              onClick={() => onPriceClick?.(level.price)}
              className={`grid grid-cols-3 px-3 py-[3px] relative cursor-pointer hover:bg-[#089981]/10 transition-colors ${
                isFlashed ? 'bg-[#089981]/20' : ''
              }`}
            >
              {/* Depth bar */}
              <div
                className="absolute right-0 top-0 bottom-0 bg-[#089981]/8"
                style={{ width: `${depthPct}%` }}
              />
              <span className="text-[#089981] relative z-10">{formatPrice(level.price)}</span>
              <span className="text-right text-[#D1D4DC] relative z-10">{formatQuantity(level.size)}</span>
              <span className="text-right text-[#787B86] relative z-10">{formatQuantity(level.total)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
