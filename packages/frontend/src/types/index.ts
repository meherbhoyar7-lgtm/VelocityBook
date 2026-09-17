// Frontend shared types

export interface PriceLevelData {
  price: string;
  size: string;
  total: string;
}

export interface OrderBookData {
  symbol: string;
  bids: PriceLevelData[];
  asks: PriceLevelData[];
  spread: string | null;
  midPrice: string | null;
  timestamp: number;
}

export interface TradeTickData {
  tradeId: string;
  symbol: string;
  price: string;
  quantity: string;
  buyerId: string;
  sellerId: string;
  timestamp: number;
}

export interface ApiTradeRow {
  id?: string;
  tradeId?: string;
  symbol: string;
  price: string;
  quantity: string;
  buyer_id?: string;
  buyerId?: string;
  seller_id?: string;
  sellerId?: string;
  executed_at?: string;
  timestamp?: number;
}


export interface UserAccount {
  currency: string;
  available_balance: string;
  locked_balance: string;
  total_balance: string;
}

export interface DemoUser {
  id: string;
  email: string;
  display_name: string;
  accounts: UserAccount[];
}

export interface OpenOrder {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'LIMIT' | 'MARKET';
  price: string | null;
  quantity: string;
  filled_quantity: string;
  status: string;
  created_at: string;
}

export interface TradeHistoryEntry {
  id: string;
  symbol: string;
  price: string;
  quantity: string;
  side: string;
  executed_at: string;
}

export interface LedgerEntry {
  id: string;
  transaction_id: string;
  amount: string;
  entry_type: 'DEBIT' | 'CREDIT';
  description: string;
  currency: string;
  created_at: string;
}

export interface CandleData {
  time: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}
