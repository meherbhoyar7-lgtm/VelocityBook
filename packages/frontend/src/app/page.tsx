import { Metadata } from 'next';
import TradingTerminalClient from '@/components/TradingTerminalClient';
import { OrderBookData, TradeTickData } from '@/types';

const API_URL =
  process.env.INTERNAL_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:3001';

interface PageProps {
  searchParams: Promise<{ symbol?: string }>;
}

/**
 * Dynamic SSR Metadata for SEO & Social Previews.
 */
export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const params = await searchParams;
  const symbol = params?.symbol || 'BTC-INR';


  return {
    title: `${symbol} Order Book & Trading Terminal | VelocityBook`,
    description: `Trade ${symbol} with real-time L2 order book depth, sub-millisecond matching engine execution, and ACID double-entry settlement.`,
    openGraph: {
      title: `${symbol} Live Order Book | VelocityBook Exchange`,
      description: `Real-time trading terminal for ${symbol} with microsecond order execution`,
      type: 'website',
    },
  };
}

/**
 * Server-Side Data Fetching for Initial Hydration.
 */
async function getInitialData(symbol: string): Promise<{
  orderBook: OrderBookData | null;
  trades: TradeTickData[];
  symbols: string[];
}> {
  let orderBook: OrderBookData | null = null;
  let trades: TradeTickData[] = [];
  let symbols: string[] = ['BTC-USD', 'BTC-INR', 'ETH-USD', 'ETH-INR'];

  try {
    const [bookRes, tradesRes, symbolsRes] = await Promise.allSettled([
      fetch(`${API_URL}/api/orderbook?symbol=${symbol}`, { cache: 'no-store' }),
      fetch(`${API_URL}/api/trades/recent?symbol=${symbol}`, { cache: 'no-store' }),
      fetch(`${API_URL}/api/symbols`, { next: { revalidate: 30 } }),
    ]);

    if (bookRes.status === 'fulfilled' && bookRes.value.ok) {
      orderBook = await bookRes.value.json();
    }

    if (tradesRes.status === 'fulfilled' && tradesRes.value.ok) {
      const data = await tradesRes.value.json();
      trades = (data.trades || []).map((t: { id?: string; tradeId?: string; symbol: string; price: string; quantity: string; buyer_id?: string; buyerId?: string; seller_id?: string; sellerId?: string; executed_at?: string; timestamp?: number }) => ({
        tradeId: t.id || t.tradeId || '',
        symbol: t.symbol,
        price: t.price,
        quantity: t.quantity,
        buyerId: t.buyer_id || t.buyerId || '',
        sellerId: t.seller_id || t.sellerId || '',
        timestamp: new Date(t.executed_at || t.timestamp || 0).getTime(),
      }));
    }

    if (symbolsRes.status === 'fulfilled' && symbolsRes.value.ok) {
      const data = await symbolsRes.value.json();
      if (Array.isArray(data.symbols) && data.symbols.length > 0) {
        symbols = data.symbols;
      }
    }
  } catch {
    // If backend is offline or during static compilation, fallback gracefully
  }

  return { orderBook, trades, symbols };
}

/**
 * Next.js Server Component — Server-Side Rendered Trading Terminal.
 */
export default async function TradingTerminalPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const symbol = params?.symbol || 'BTC-INR';


  const { orderBook, trades, symbols } = await getInitialData(symbol);

  return (
    <TradingTerminalClient
      initialOrderBook={orderBook}
      initialTrades={trades}
      initialSymbols={symbols}
      initialSymbol={symbol}
    />
  );
}
