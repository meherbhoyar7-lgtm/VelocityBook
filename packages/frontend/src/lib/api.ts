const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

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
    return this.request<{ users: any[] }>('/api/auth/demo-users');
  }

  async switchUser(userId: string) {
    const data = await this.request<{ user: any; token: string }>(`/api/auth/switch/${userId}`, {
      method: 'POST',
    });
    this.setUser(data.user.id, data.token);
    return data;
  }

  // Portfolio
  async getPortfolio() {
    return this.request<{ accounts: any[] }>('/api/portfolio');
  }

  // Orders
  async placeOrder(params: { symbol: string; side: string; type: string; price?: string; quantity: string }) {
    return this.request<any>('/api/orders', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async cancelOrder(orderId: string) {
    return this.request<any>(`/api/orders/${orderId}`, { method: 'DELETE' });
  }

  async getOpenOrders() {
    return this.request<{ orders: any[] }>('/api/orders/open');
  }

  async getOrderHistory() {
    return this.request<{ orders: any[] }>('/api/orders/history');
  }

  // Trades
  async getRecentTrades(symbol: string = 'BTC-USD') {
    return this.request<{ trades: any[] }>(`/api/trades/recent?symbol=${symbol}`);
  }

  async getCandles(symbol: string = 'BTC-USD', resolution: string = '1m') {
    return this.request<{ candles: any[] }>(`/api/trades/candles?symbol=${symbol}&resolution=${resolution}`);
  }

  async getUserTrades() {
    return this.request<{ trades: any[] }>('/api/trades/user');
  }

  // Order Book
  async getOrderBook(symbol: string = 'BTC-USD') {
    return this.request<any>(`/api/orderbook?symbol=${symbol}`);
  }

  // Faucet
  async depositFaucet(currency: string, amount: string) {
    return this.request<any>('/api/faucet', {
      method: 'POST',
      body: JSON.stringify({ currency, amount }),
    });
  }

  // Ledger
  async getLedger() {
    return this.request<{ entries: any[] }>('/api/faucet/ledger');
  }

  // Health
  async getHealth() {
    return this.request<any>('/api/health');
  }
}

export const api = new ApiClient();
