'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useOrderBookStore } from './useOrderBookStore';
import { useTradeStore } from './useTradeStore';
import { useUserStore } from './useUserStore';
import { api } from '@/lib/api';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001';

/**
 * WebSocket hook with auto-reconnect.
 * Connects to the backend WS server and routes incoming messages
 * to the appropriate Zustand stores.
 */
export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const userId = useUserStore((s) => s.userId);
  const selectedSymbol = useUserStore((s) => s.selectedSymbol);
  const setConnected = useUserStore((s) => s.setConnected);
  const setOrderBook = useOrderBookStore((s) => s.setOrderBook);
  const addTrade = useTradeStore((s) => s.addTrade);

  // Store connect fn in a ref so the onclose handler always has the latest version
  const connectRef = useRef<() => void>(() => {});

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(`${WS_URL}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);

      // Authenticate
      if (userId) {
        ws.send(JSON.stringify({ type: 'authenticate', data: { userId } }));
      }

      // Subscribe to symbol
      ws.send(JSON.stringify({ type: 'subscribe', data: { symbol: selectedSymbol } }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case 'orderbook_snapshot':
            setOrderBook({
              bids: msg.data.bids || [],
              asks: msg.data.asks || [],
              spread: msg.data.spread,
              midPrice: msg.data.midPrice,
            });
            break;

          case 'trade_ticker':
            addTrade(msg.data);
            break;

          case 'user_order_update':
            // Trigger a portfolio refresh
            if (userId) {
              api.getPortfolio().then((res) => {
                useUserStore.getState().setAccounts(res.accounts);
              }).catch(() => {});
            }
            break;

          case 'user_balance_update':
            if (userId) {
              api.getPortfolio().then((res) => {
                useUserStore.getState().setAccounts(res.accounts);
              }).catch(() => {});
            }
            break;

          case 'pong':
          case 'connected':
          case 'authenticated':
            break;

          default:
            break;
        }
      } catch {
        // Ignore parse errors
      }
    };

    ws.onclose = () => {
      setConnected(false);
      // Auto-reconnect after 2 seconds
      reconnectTimeoutRef.current = setTimeout(() => {
        connectRef.current();
      }, 2000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [userId, selectedSymbol, setConnected, setOrderBook, addTrade]);

  // Keep connectRef in sync with the latest connect function
  useEffect(() => {
    connectRef.current = connect;
  });

  useEffect(() => {
    connect();

    // Ping every 30 seconds to keep alive
    const pingInterval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);

    return () => {
      clearInterval(pingInterval);
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      wsRef.current?.close();
    };
  }, [connect]);

  // Re-subscribe when symbol changes
  useEffect(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe', data: { symbol: selectedSymbol } }));
    }
  }, [selectedSymbol]);

  return wsRef;
}
