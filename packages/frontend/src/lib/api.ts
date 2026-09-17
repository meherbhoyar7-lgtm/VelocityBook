import { UserAccount, DemoUser, OpenOrder, TradeHistoryEntry, LedgerEntry, CandleData, ApiTradeRow } from '@/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface SwitchUserResponse {
  user: { id: string; displayName: string };
  token: string;
}

interface PlaceOrderResponse {
  orderId: string;
  status: string;
  trades?: { tradeId: string; price: string; quantity: string }[];
}

interface CancelOrderResponse {
  success: boolean;
}

interface OrderBookResponse {
  symbol: string;
  bids: { price: string; size: string; total: string }[];
  asks: { price: string; size: string; total: string }[];
  spread: string | null;
  midPrice: string | null;
}

interface HealthResponse {
  status: string;
  uptime: number;
}

interface FaucetResponse {
  success: boolean;
  balance: string;
}

class ApiClient {
  private baseUrl: string;
  private userId: string | null = null;
  private token: string | null = null;

  constructor() {
    this.baseUrl = API_URL;
  }

  setUser(userId: string, token?: string) {
    this.userId = userId;
    this.token = token || null;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const url = this.userId && !this.token
      ? `${this.baseUrl}${path}${path.includes('?') ? '&' : '?'}userId=${this.userId}`
      : `${this.baseUrl}${path}`;

    const res = await fetch(url, { ...options, headers });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(error.error || `API Error: ${res.status}`);
    }

    return res.json();
  }

  // Auth
  async getDemoUsers() {
    return this.request<{ users: DemoUser[] }>('/api/auth/demo-users');
  }

  async switchUser(userId: string) {
    const data = await this.request<SwitchUserResponse>(`/api/auth/switch/${userId}`, {
      method: 'POST',
    });
    this.setUser(data.user.id, data.token);
    return data;
  }

  // Portfolio
  async getPortfolio() {
    return this.request<{ accounts: UserAccount[] }>('/api/portfolio');
  }

  // Orders
  async placeOrder(params: { symbol: string; side: string; type: string; price?: string; quantity: string }) {
    return this.request<PlaceOrderResponse>('/api/orders', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async cancelOrder(orderId: string) {
    return this.request<CancelOrderResponse>(`/api/orders/${orderId}`, { method: 'DELETE' });
  }

  async getOpenOrders() {
    return this.request<{ orders: OpenOrder[] }>('/api/orders/open');
  }

  async getOrderHistory() {
    return this.request<{ orders: OpenOrder[] }>('/api/orders/history');
  }

  // Trades
  async getRecentTrades(symbol: string = 'BTC-USD') {
    return this.request<{ trades: ApiTradeRow[] }>(`/api/trades/recent?symbol=${symbol}`);
  }

  async getCandles(symbol: string = 'BTC-USD', resolution: string = '1m') {
    return this.request<{ candles: CandleData[] }>(`/api/trades/candles?symbol=${symbol}&resolution=${resolution}`);
  }

  async getUserTrades() {
    return this.request<{ trades: TradeHistoryEntry[] }>('/api/trades/user');
  }

  // Order Book
  async getOrderBook(symbol: string = 'BTC-USD') {
    return this.request<OrderBookResponse>(`/api/orderbook?symbol=${symbol}`);
  }

  // Faucet
  async depositFaucet(currency: string, amount: string) {
    return this.request<FaucetResponse>('/api/faucet', {
      method: 'POST',
      body: JSON.stringify({ currency, amount }),
    });
  }

  // Ledger
  async getLedger() {
    return this.request<{ entries: LedgerEntry[] }>('/api/faucet/ledger');
  }

  // Health
  async getHealth() {
    return this.request<HealthResponse>('/api/health');
  }
}

export const api = new ApiClient();
