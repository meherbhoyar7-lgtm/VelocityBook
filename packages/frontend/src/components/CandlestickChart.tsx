'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, CandlestickSeries, HistogramSeries, ColorType, IChartApi, ISeriesApi } from 'lightweight-charts';
import { useUserStore } from '@/stores/useUserStore';
import { useTradeStore } from '@/stores/useTradeStore';
import { api } from '@/lib/api';
import { formatPrice } from '@/lib/utils';
import { BarChart3, Maximize2 } from 'lucide-react';

interface OHLCV {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export default function CandlestickChart() {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  const selectedSymbol = useUserStore((s) => s.selectedSymbol);
  const lastPrice = useTradeStore((s) => s.lastPrice);

  const [resolution, setResolution] = useState<'1m' | '5m' | '15m' | '1h' | '1d'>('1m');
  const [hoveredData, setHoveredData] = useState<OHLCV | null>(null);
  const [currentBar, setCurrentBar] = useState<OHLCV | null>(null);

  // Generate fallback historical candles if backend has limited history
  const generateFallbackData = useCallback((basePrice: number, count = 80): OHLCV[] => {
    const bars: OHLCV[] = [];
    const now = Math.floor(Date.now() / 1000);
    const intervalSec = resolution === '1m' ? 60 : resolution === '5m' ? 300 : resolution === '15m' ? 900 : resolution === '1h' ? 3600 : 86400;

    let price = basePrice * 0.98;
    for (let i = count; i >= 0; i--) {
      const time = now - i * intervalSec;
      const volatility = basePrice * 0.003;
      const change = (Math.random() - 0.49) * volatility * 2;
      const open = price;
      const close = price + change;
      const high = Math.max(open, close) + Math.random() * volatility;
      const low = Math.min(open, close) - Math.random() * volatility;
      const volume = +(Math.random() * 2.5 + 0.1).toFixed(4);

      bars.push({ time, open, high, low, close, volume });
      price = close;
    }
    return bars;
  }, [resolution]);

  // Initialize and redraw chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const container = chartContainerRef.current;

    // Create chart
    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: '#131722' },
        textColor: '#787B86',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#1E222D' },
        horzLines: { color: '#1E222D' },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: '#2962FF', width: 1, style: 3, labelBackgroundColor: '#2962FF' },
        horzLine: { color: '#2962FF', width: 1, style: 3, labelBackgroundColor: '#2962FF' },
      },
      rightPriceScale: {
        borderColor: '#1E222D',
        scaleMargins: { top: 0.1, bottom: 0.2 },
      },
      timeScale: {
        borderColor: '#1E222D',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    chartRef.current = chart;

    // Add Candlestick series
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#089981',
      downColor: '#F23645',
      borderUpColor: '#089981',
      borderDownColor: '#F23645',
      wickUpColor: '#089981',
      wickDownColor: '#F23645',
    });
    candleSeriesRef.current = candleSeries;

    // Add Volume series
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });
    volumeSeriesRef.current = volumeSeries;

    // Fetch or populate data
    const basePrice = selectedSymbol.startsWith('BTC') ? 64000 : 3400;

    api.getCandles(selectedSymbol, resolution)
      .then((res) => {
        let bars: OHLCV[] = [];
        if (res.candles && res.candles.length > 5) {
          bars = res.candles.map((c: any) => ({
            time: Math.floor(new Date(c.time).getTime() / 1000),
            open: Number(c.open),
            high: Number(c.high),
            low: Number(c.low),
            close: Number(c.close),
            volume: Number(c.volume || 0),
          }));
        } else {
          bars = generateFallbackData(basePrice, 100);
        }

        const candleData = bars.map((b) => ({
          time: b.time as any,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
        }));

        const volumeData = bars.map((b) => ({
          time: b.time as any,
          value: b.volume,
          color: b.close >= b.open ? 'rgba(8, 153, 129, 0.4)' : 'rgba(242, 54, 69, 0.4)',
        }));

        candleSeries.setData(candleData);
        volumeSeries.setData(volumeData);

        const lastBar = bars[bars.length - 1];
        if (lastBar) setCurrentBar(lastBar);
        chart.timeScale().fitContent();
      })
      .catch(() => {
        const bars = generateFallbackData(basePrice, 100);
        candleSeries.setData(bars.map((b) => ({ time: b.time as any, open: b.open, high: b.high, low: b.low, close: b.close })));
        volumeSeries.setData(bars.map((b) => ({ time: b.time as any, value: b.volume, color: b.close >= b.open ? 'rgba(8, 153, 129, 0.4)' : 'rgba(242, 54, 69, 0.4)' })));
        const lastBar = bars[bars.length - 1];
        if (lastBar) setCurrentBar(lastBar);
        chart.timeScale().fitContent();
      });

    // Crosshair move handler
    chart.subscribeCrosshairMove((param) => {
      if (!param || !param.time || !param.seriesData) {
        setHoveredData(null);
        return;
      }
      const data = param.seriesData.get(candleSeries) as any;
      const volData = param.seriesData.get(volumeSeries) as any;
      if (data) {
        setHoveredData({
          time: Number(param.time),
          open: data.open,
          high: data.high,
          low: data.low,
          close: data.close,
          volume: volData ? volData.value : 0,
        });
      }
    });

    // Handle container resize
    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0) return;
      const { width, height } = entries[0].contentRect;
      chart.applyOptions({ width, height });
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [selectedSymbol, resolution, generateFallbackData]);

  // Update latest bar on real-time price tick
  useEffect(() => {
    if (!lastPrice || !candleSeriesRef.current || !currentBar) return;
    const priceNum = parseFloat(lastPrice);
    if (isNaN(priceNum)) return;

    const now = Math.floor(Date.now() / 1000);
    const intervalSec = resolution === '1m' ? 60 : resolution === '5m' ? 300 : resolution === '15m' ? 900 : 3600;
    const currentBarTime = Math.floor(now / intervalSec) * intervalSec;

    let updatedBar: OHLCV;
    if (currentBar.time === currentBarTime) {
      updatedBar = {
        ...currentBar,
        high: Math.max(currentBar.high, priceNum),
        low: Math.min(currentBar.low, priceNum),
        close: priceNum,
        volume: currentBar.volume + 0.05,
      };
    } else {
      updatedBar = {
        time: currentBarTime,
        open: priceNum,
        high: priceNum,
        low: priceNum,
        close: priceNum,
        volume: 0.05,
      };
    }

    candleSeriesRef.current.update({
      time: updatedBar.time as any,
      open: updatedBar.open,
      high: updatedBar.high,
      low: updatedBar.low,
      close: updatedBar.close,
    });

    if (volumeSeriesRef.current) {
      volumeSeriesRef.current.update({
        time: updatedBar.time as any,
        value: updatedBar.volume,
        color: updatedBar.close >= updatedBar.open ? 'rgba(8, 153, 129, 0.4)' : 'rgba(242, 54, 69, 0.4)',
      });
    }

    setCurrentBar(updatedBar);
  }, [lastPrice, resolution, currentBar]);

  const activeDisplay = hoveredData || currentBar;
  const isUp = activeDisplay ? activeDisplay.close >= activeDisplay.open : true;
  const changePct = activeDisplay && activeDisplay.open > 0
    ? (((activeDisplay.close - activeDisplay.open) / activeDisplay.open) * 100).toFixed(2)
    : '0.00';

  return (
    <div className="flex flex-col h-full bg-[#131722] border-b border-[#1E222D]">
      {/* Top Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#1E222D] text-xs">
        {/* Timeframes */}
        <div className="flex items-center gap-1">
          <BarChart3 size={14} className="text-[#2962FF] mr-2" />
          <span className="text-[#D1D4DC] font-semibold mr-3">{selectedSymbol}</span>
          {(['1m', '5m', '15m', '1h', '1d'] as const).map((tf) => (
            <button
              key={tf}
              onClick={() => setResolution(tf)}
              className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${
                resolution === tf
                  ? 'bg-[#2962FF] text-white font-semibold'
                  : 'text-[#787B86] hover:text-[#D1D4DC] hover:bg-[#1E222D]'
              }`}
            >
              {tf.toUpperCase()}
            </button>
          ))}
        </div>

        {/* OHLCV Legend */}
        {activeDisplay && (
          <div className="hidden lg:flex items-center gap-3 font-mono text-[11px]">
            <div>
              <span className="text-[#787B86]">O: </span>
              <span className={isUp ? 'text-[#089981]' : 'text-[#F23645]'}>{formatPrice(activeDisplay.open)}</span>
            </div>
            <div>
              <span className="text-[#787B86]">H: </span>
              <span className={isUp ? 'text-[#089981]' : 'text-[#F23645]'}>{formatPrice(activeDisplay.high)}</span>
            </div>
            <div>
              <span className="text-[#787B86]">L: </span>
              <span className={isUp ? 'text-[#089981]' : 'text-[#F23645]'}>{formatPrice(activeDisplay.low)}</span>
            </div>
            <div>
              <span className="text-[#787B86]">C: </span>
              <span className={isUp ? 'text-[#089981]' : 'text-[#F23645]'}>{formatPrice(activeDisplay.close)}</span>
            </div>
            <div>
              <span className="text-[#787B86]">Chg: </span>
              <span className={isUp ? 'text-[#089981]' : 'text-[#F23645]'}>
                {isUp ? '+' : ''}{changePct}%
              </span>
            </div>
            <div>
              <span className="text-[#787B86]">Vol: </span>
              <span className="text-[#D1D4DC]">{activeDisplay.volume.toFixed(2)}</span>
            </div>
          </div>
        )}

        <button
          onClick={() => chartRef.current?.timeScale().fitContent()}
          title="Reset Zoom"
          className="text-[#787B86] hover:text-[#D1D4DC] p-1 rounded hover:bg-[#1E222D]"
        >
          <Maximize2 size={13} />
        </button>
      </div>

      {/* Chart Canvas Area */}
      <div ref={chartContainerRef} className="flex-1 w-full relative min-h-[300px]" />
    </div>
  );
}
