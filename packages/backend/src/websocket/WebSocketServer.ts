import { WebSocketServer as WSServer, WebSocket } from 'ws';
import { Server } from 'http';
import { redisPublisher } from './RedisPublisher';

interface ConnectedClient {
  ws: WebSocket;
  userId: string | null;
  subscribedSymbols: Set<string>;
}

/**
 * WebSocketServer — Real-time streaming gateway.
 *
 * Subscribes to Redis Pub/Sub channels and broadcasts:
 * - orderbook_snapshot: L2 depth to all clients
 * - trade_ticker: Every executed trade
 * - user_order_update: Private order status changes
 * - user_balance_update: Private balance changes
 */
export class VelocityWebSocketServer {
  private wss: WSServer;
  private clients: Map<string, ConnectedClient> = new Map();
  private clientCounter = 0;

  constructor(server: Server) {
    this.wss = new WSServer({ server, path: '/ws' });
    this.setupConnectionHandler();
  }

  private setupConnectionHandler(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      this.clientCounter++;
      const clientId = `client-${this.clientCounter}`;

      const client: ConnectedClient = {
        ws,
        userId: null,
        subscribedSymbols: new Set(),
      };

      this.clients.set(clientId, client);
      console.log(`[WS] Client connected: ${clientId} (total: ${this.clients.size})`);

      ws.on('message', (raw: Buffer) => {
        try {
          const msg = JSON.parse(raw.toString());
          this.handleClientMessage(clientId, client, msg);
        } catch {
          this.sendToClient(ws, { type: 'error', data: { message: 'Invalid JSON' } });
        }
      });

      ws.on('close', () => {
        this.clients.delete(clientId);
        console.log(`[WS] Client disconnected: ${clientId} (total: ${this.clients.size})`);
      });

      ws.on('error', (err) => {
        console.error(`[WS] Client error ${clientId}:`, err.message);
        this.clients.delete(clientId);
      });

      // Send welcome message
      this.sendToClient(ws, {
        type: 'connected',
        data: { clientId, message: 'Welcome to VelocityBook' },
      });
    });
  }

  /**
   * Handle incoming messages from clients.
   */
  private handleClientMessage(
    clientId: string,
    client: ConnectedClient,
    msg: { type: string; data?: any }
  ): void {
    switch (msg.type) {
      case 'authenticate':
        client.userId = msg.data?.userId || null;
        console.log(`[WS] Client ${clientId} authenticated as user ${client.userId}`);
        this.sendToClient(client.ws, {
          type: 'authenticated',
          data: { userId: client.userId },
        });
        break;

      case 'subscribe':
        if (msg.data?.symbol) {
          client.subscribedSymbols.add(msg.data.symbol);
          console.log(`[WS] Client ${clientId} subscribed to ${msg.data.symbol}`);
        }
        break;

      case 'unsubscribe':
        if (msg.data?.symbol) {
          client.subscribedSymbols.delete(msg.data.symbol);
        }
        break;

      case 'ping':
        this.sendToClient(client.ws, { type: 'pong', data: { timestamp: Date.now() } });
        break;

      default:
        this.sendToClient(client.ws, {
          type: 'error',
          data: { message: `Unknown message type: ${msg.type}` },
        });
    }
  }

  // ─── Broadcasting ────────────────────────────────────────────

  /**
   * Broadcast an order book snapshot to all clients subscribed to the symbol.
   */
  broadcastOrderBook(symbol: string, data: any): void {
    const message = JSON.stringify({ type: 'orderbook_snapshot', data });
    for (const client of this.clients.values()) {
      if (
        client.ws.readyState === WebSocket.OPEN &&
        (client.subscribedSymbols.has(symbol) || client.subscribedSymbols.size === 0)
      ) {
        client.ws.send(message);
      }
    }
  }

  /**
   * Broadcast a trade execution to all clients subscribed to the symbol.
   */
  broadcastTrade(symbol: string, data: any): void {
    const message = JSON.stringify({ type: 'trade_ticker', data });
    for (const client of this.clients.values()) {
      if (
        client.ws.readyState === WebSocket.OPEN &&
        (client.subscribedSymbols.has(symbol) || client.subscribedSymbols.size === 0)
      ) {
        client.ws.send(message);
      }
    }
  }

  /**
   * Send a private message to a specific user.
   */
  sendToUser(userId: string, type: string, data: any): void {
    const message = JSON.stringify({ type, data });
    for (const client of this.clients.values()) {
      if (client.userId === userId && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      }
    }
  }

  /**
   * Send a message to a specific WebSocket connection.
   */
  private sendToClient(ws: WebSocket, payload: any): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  /**
   * Get the number of connected clients.
   */
  getClientCount(): number {
    return this.clients.size;
  }
}
