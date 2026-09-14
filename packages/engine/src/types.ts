import Decimal from 'decimal.js';

// ─── Enums ───────────────────────────────────────────────────────────

export enum Side {
  BUY = 'BUY',
  SELL = 'SELL',
}

export enum OrderType {
  LIMIT = 'LIMIT',
  MARKET = 'MARKET',
}

export enum OrderStatus {
  PENDING = 'PENDING',
  OPEN = 'OPEN',
  PARTIALLY_FILLED = 'PARTIALLY_FILLED',
  FILLED = 'FILLED',
  CANCELLED = 'CANCELLED',
}

// ─── Core Interfaces ─────────────────────────────────────────────────

export interface Order {
  id: string;
  userId: string;
  symbol: string;
  side: Side;
  type: OrderType;
  price: Decimal;          // For MARKET orders this is Decimal(0)
  quantity: Decimal;
  filledQuantity: Decimal;
  status: OrderStatus;
  timestamp: number;       // Unix ms — used for FIFO tiebreaking
}

export interface TradeExecution {
  tradeId: string;
  symbol: string;
  buyOrderId: string;
  sellOrderId: string;
  buyerId: string;
  sellerId: string;
  price: Decimal;          // Always the resting order's price
  quantity: Decimal;       // Quantity matched in this fill
  timestamp: number;
}

export interface PriceLevel {
  price: Decimal;
  orders: Order[];         // FIFO queue — head is oldest
  totalQuantity: Decimal;  // Sum of remaining qty at this level
}

export interface OrderBookSnapshot {
  symbol: string;
  bids: PriceLevelSnapshot[];  // Sorted highest → lowest
  asks: PriceLevelSnapshot[];  // Sorted lowest → highest
  spread: Decimal | null;
  midPrice: Decimal | null;
  timestamp: number;
}

export interface PriceLevelSnapshot {
  price: string;
  size: string;
  total: string;          // Cumulative depth
}

// ─── Engine Events ───────────────────────────────────────────────────

export type EngineEvent =
  | { type: 'trade'; data: TradeExecution }
  | { type: 'order_placed'; data: Order }
  | { type: 'order_cancelled'; data: Order }
  | { type: 'order_updated'; data: Order }
  | { type: 'orderbook_changed'; data: { symbol: string } };
