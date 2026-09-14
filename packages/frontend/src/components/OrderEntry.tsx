'use client';

import { useState, useEffect } from 'react';
import { useUserStore } from '@/stores/useUserStore';
import { api } from '@/lib/api';
import { formatPrice } from '@/lib/utils';

interface OrderEntryProps {
  initialPrice?: string;
}

/**
 * Order Entry Form — Uses local useState for inputs,
 * completely decoupled from WebSocket-driven stores.
 * This prevents typing lag when the order book updates 50+ times/sec.
 */
export default function OrderEntry({ initialPrice }: OrderEntryProps) {
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [orderType, setOrderType] = useState<'LIMIT' | 'MARKET'>('LIMIT');
  const [price, setPrice] = useState(initialPrice || '');
  const [quantity, setQuantity] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const accounts = useUserStore((s) => s.accounts);
  const selectedSymbol = useUserStore((s) => s.selectedSymbol);
  const userId = useUserStore((s) => s.userId);
  const setAccounts = useUserStore((s) => s.setAccounts);

  const [baseCurrency, quoteCurrency] = selectedSymbol.split('-');
  const quoteAccount = accounts.find((a) => a.currency === quoteCurrency);
  const baseAccount = accounts.find((a) => a.currency === baseCurrency);

  const availableBalance = side === 'BUY'
    ? Number(quoteAccount?.available_balance || 0)
    : Number(baseAccount?.available_balance || 0);

  const estimatedTotal = orderType === 'LIMIT' && price && quantity
    ? (Number(price) * Number(quantity))
    : 0;

  const isValid = quantity && Number(quantity) > 0 &&
    (orderType === 'MARKET' || (price && Number(price) > 0)) &&
    (side === 'BUY' ? estimatedTotal <= availableBalance || orderType === 'MARKET' : Number(quantity) <= availableBalance);

  const handlePercentage = (pct: number) => {
    if (side === 'BUY' && price && Number(price) > 0) {
      const maxQty = (availableBalance * pct) / Number(price);
      setQuantity(maxQty.toFixed(8));
    } else if (side === 'SELL') {
      const maxQty = availableBalance * pct;
      setQuantity(maxQty.toFixed(8));
    }
  };

  const handleSubmit = async () => {
    if (!userId || !isValid) return;
    setLoading(true);
    setMessage(null);

    try {
      const params: any = {
        symbol: selectedSymbol,
        side,
        type: orderType,
        quantity,
      };
      if (orderType === 'LIMIT') {
        params.price = price;
      }

      const res = await api.placeOrder(params);
      setMessage({
        type: 'success',
        text: `${side} ${quantity} ${baseCurrency} — ${res.trades?.length || 0} fills`,
      });
      setQuantity('');

      // Refresh balances
      const portfolio = await api.getPortfolio();
      setAccounts(portfolio.accounts);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  // Update price when clicked from order book
  useEffect(() => {
    if (initialPrice) {
      setPrice(initialPrice);
    }
  }, [initialPrice]);

  return (
    <div className="bg-[#131722] border-l border-[#1E222D] flex flex-col p-4 gap-3 text-sm">
      {/* Buy / Sell Toggle */}
      <div className="grid grid-cols-2 gap-1 p-1 bg-[#0B0E14] rounded">
        <button
          onClick={() => setSide('BUY')}
          className={`py-2 rounded font-semibold transition-all ${
            side === 'BUY'
              ? 'bg-[#089981] text-white shadow-lg shadow-[#089981]/20'
              : 'text-[#787B86] hover:text-[#D1D4DC]'
          }`}
        >
          BUY
        </button>
        <button
          onClick={() => setSide('SELL')}
          className={`py-2 rounded font-semibold transition-all ${
            side === 'SELL'
              ? 'bg-[#F23645] text-white shadow-lg shadow-[#F23645]/20'
              : 'text-[#787B86] hover:text-[#D1D4DC]'
          }`}
        >
          SELL
        </button>
      </div>

      {/* Order Type */}
      <div className="flex gap-1 p-1 bg-[#0B0E14] rounded text-xs">
        <button
          onClick={() => setOrderType('LIMIT')}
          className={`flex-1 py-1.5 rounded transition-all ${
            orderType === 'LIMIT' ? 'bg-[#1E222D] text-[#D1D4DC]' : 'text-[#787B86]'
          }`}
        >
          Limit
        </button>
        <button
          onClick={() => setOrderType('MARKET')}
          className={`flex-1 py-1.5 rounded transition-all ${
            orderType === 'MARKET' ? 'bg-[#1E222D] text-[#D1D4DC]' : 'text-[#787B86]'
          }`}
        >
          Market
        </button>
      </div>

      {/* Price Input (Limit only) */}
      {orderType === 'LIMIT' && (
        <div>
          <label className="text-[#787B86] text-xs mb-1 block">Price ({quoteCurrency})</label>
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="0.00"
            step="0.01"
            className="w-full bg-[#0B0E14] border border-[#2A2E39] rounded px-3 py-2 font-mono text-[#D1D4DC] focus:outline-none focus:border-[#2962FF] placeholder-[#363A45]"
          />
        </div>
      )}

      {/* Quantity Input */}
      <div>
        <label className="text-[#787B86] text-xs mb-1 block">Quantity ({baseCurrency})</label>
        <input
          type="number"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="0.00000000"
          step="0.001"
          className="w-full bg-[#0B0E14] border border-[#2A2E39] rounded px-3 py-2 font-mono text-[#D1D4DC] focus:outline-none focus:border-[#2962FF] placeholder-[#363A45]"
        />
      </div>

      {/* Percentage Buttons */}
      <div className="grid grid-cols-4 gap-1">
        {[0.25, 0.5, 0.75, 1.0].map((pct) => (
          <button
            key={pct}
            onClick={() => handlePercentage(pct)}
            className="py-1 bg-[#1E222D] text-[#787B86] rounded text-xs hover:bg-[#2A2E39] hover:text-[#D1D4DC] transition-colors"
          >
            {pct * 100}%
          </button>
        ))}
      </div>

      {/* Summary */}
      <div className="space-y-1 text-xs font-mono border-t border-[#1E222D] pt-2">
        <div className="flex justify-between">
          <span className="text-[#787B86]">Available</span>
          <span className="text-[#D1D4DC]">
            {side === 'BUY'
              ? `${formatPrice(availableBalance)} ${quoteCurrency}`
              : `${Number(availableBalance).toFixed(8)} ${baseCurrency}`}
          </span>
        </div>
        {orderType === 'LIMIT' && estimatedTotal > 0 && (
          <div className="flex justify-between">
            <span className="text-[#787B86]">Total</span>
            <span className="text-[#D1D4DC]">${formatPrice(estimatedTotal)}</span>
          </div>
        )}
      </div>

      {/* Submit Button */}
      <button
        onClick={handleSubmit}
        disabled={loading || !isValid || !userId}
        className={`w-full py-3 rounded font-semibold transition-all ${
          side === 'BUY'
            ? 'bg-[#089981] hover:bg-[#089981]/80 disabled:bg-[#089981]/30'
            : 'bg-[#F23645] hover:bg-[#F23645]/80 disabled:bg-[#F23645]/30'
        } text-white disabled:cursor-not-allowed`}
      >
        {loading ? 'Placing...' : `${side} ${baseCurrency}`}
      </button>

      {/* Status Message */}
      {message && (
        <div
          className={`px-3 py-2 rounded text-xs ${
            message.type === 'success'
              ? 'bg-[#089981]/10 text-[#089981] border border-[#089981]/20'
              : 'bg-[#F23645]/10 text-[#F23645] border border-[#F23645]/20'
          }`}
        >
          {message.text}
        </div>
      )}
    </div>
  );
}
