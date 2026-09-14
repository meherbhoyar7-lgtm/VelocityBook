# VelocityBook — Complete Trade Lifecycle

This document provides an end-to-end trace of a trade's lifecycle in VelocityBook across its 4 operational phases:
1. **Phase 1: Ingestion & Pre-Trade Risk Gate**
2. **Phase 2: In-Memory Matching Engine Execution**
3. **Phase 3: ACID Multi-Account Settlement & Double-Entry Ledger Entry**
4. **Phase 4: Real-Time Event Fanout & WebSocket Broadcast**

---

## Complete Trade Lifecycle Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Trader as Trader / User
    participant Frontend as Next.js Terminal
    participant API as Express Gateway
    participant Risk as RiskService
    participant Engine as In-Memory MatchingEngine
    participant Settle as SettlementService
    participant PG as PostgreSQL 16
    participant Redis as Redis 7 Pub/Sub
    participant WS as WebSocket Server
    actor Counterparty as Counterparty Trader

    Note over Trader,Frontend: Phase 1: Ingestion & Risk Check
    Trader->>Frontend: Click "BUY 0.25 BTC @ $64,000"
    Frontend->>API: POST /api/orders { symbol: "BTC-USD", side: "BUY", type: "LIMIT", price: 64000, quantity: 0.25 }
    API->>Risk: lockFundsForOrder(client, orderParams)
    Risk->>PG: BEGIN TRANSACTION
    Risk->>PG: SELECT * FROM accounts WHERE user_id = $1 AND currency = 'USD' FOR UPDATE
    alt Insufficient Balance
        Risk-->>API: Throw InsufficientFundsException
        API-->>Frontend: 400 Bad Request (Insufficient Balance)
    else Sufficient Balance
        Risk->>PG: UPDATE accounts SET available = available - 16000, locked = locked + 16000
        Risk->>PG: INSERT INTO orders (id, user_id, symbol, side, type, price, quantity, status='OPEN')
        Risk->>PG: COMMIT TRANSACTION
    end

    Note over API,Engine: Phase 2: In-Memory Matching
    API->>Engine: submitOrder(order)
    Engine->>Engine: Scan opposite book (Asks sorted asc)
    alt No Match (Limit price below lowest ask)
        Engine->>Engine: Insert order into Bids FIFO queue at price level $64,000
        Engine-->>API: Returns [] (Resting in book)
    else Match Found (Crosses resting Ask at $63,950)
        Engine->>Engine: Deduct 0.25 BTC from resting Ask
        Engine->>Engine: Emit TradeExecution { price: 63950, quantity: 0.25, buyerId, sellerId }
        Engine-->>API: Returns [TradeExecution]
    end

    Note over API,PG: Phase 3: ACID Settlement & Ledger
    loop For each TradeExecution
        API->>Settle: settleTrade(execution)
        Settle->>PG: BEGIN TRANSACTION
        Settle->>PG: SELECT 4 accounts FOR UPDATE (Buyer USD, Seller USD, Buyer BTC, Seller BTC)
        Settle->>PG: UPDATE buyer USD: locked = locked - 15987.50, available = available + 12.50 (Price Improvement)
        Settle->>PG: UPDATE seller USD: available = available + 15987.50
        Settle->>PG: UPDATE seller BTC: locked = locked - 0.25
        Settle->>PG: UPDATE buyer BTC: available = available + 0.25
        Settle->>PG: INSERT INTO trades (...)
        Settle->>PG: INSERT INTO ledger_entries (4 rows: 2 Debits, 2 Credits)
        Settle->>PG: UPDATE orders SET filled_quantity = filled_quantity + 0.25, status = 'FILLED'
        Settle->>PG: COMMIT TRANSACTION
    end

    Note over API,Counterparty: Phase 4: WebSocket Streaming & Fanout
    API->>Redis: publish('trades', tradeTick)
    API->>Redis: publish('orderbook', depthSnapshot)
    Redis->>WS: Subscriber callback
    par Public Broadcast
        WS->>Frontend: Send "trade_ticker" { price: 63950, qty: 0.25 }
        WS->>Frontend: Send "orderbook_snapshot" { bids, asks, spread, midPrice }
        WS->>Counterparty: Send "trade_ticker"
    and Private Notification
        WS->>Frontend: Send "user_order_update" { orderId, status: 'FILLED' }
        WS->>Frontend: Send "user_balance_update" { accounts }
        WS->>Counterparty: Send "user_order_update" { orderId, status: 'FILLED' }
        WS->>Counterparty: Send "user_balance_update" { accounts }
    end

    Frontend->>Frontend: Update Canvas Chart candle + flash order book row
```

---

## Detailed Phase Breakdown

### Phase 1: Ingestion & Pre-Trade Risk Gate
- Orders arrive via HTTP REST (`POST /api/orders`) with bearer JWT or demo user authentication.
- A PostgreSQL row-level lock (`SELECT ... FOR UPDATE`) guarantees no race conditions on balance verification.
- Quote currency (USD) is locked for BUY orders; Base currency (BTC/ETH) is locked for SELL orders.
- If funds are insufficient, the transaction immediately aborts with zero side-effects.

### Phase 2: In-Memory Matching Engine Execution
- Evaluated entirely in RAM via `@velocitybook/engine`.
- LIMIT orders look up opposite price levels; aggressive orders execute immediately against the best resting price.
- Fills generate `TradeExecution` events containing exact fill price, matched quantity, maker order ID, and taker order ID.
- Unfilled quantities rest in the order book FIFO queue or cancel (for MARKET orders).

### Phase 3: ACID Multi-Account Settlement & Double-Entry Ledger
- Handled atomically inside a PostgreSQL transaction (`withTransaction`).
- Locks all 4 accounts involved in the trade:
  1. Buyer Quote (USD)
  2. Seller Quote (USD)
  3. Buyer Base (BTC)
  4. Seller Base (BTC)
- Executes dual-currency movements and records 4 immutable ledger entries sharing a unique `transaction_id`.
- If an aggressive buyer received a fill below their limit price, the price improvement difference is automatically refunded from `locked` to `available`.

### Phase 4: Real-Time Event Fanout & WebSocket Broadcast
- Trade events and L2 depth delta snapshots are published to Redis Pub/Sub.
- The WebSocket server fans out public market data (`trade_ticker`, `orderbook_snapshot`) to all subscribed clients on that symbol.
- Private authenticated channels push `user_order_update` and `user_balance_update` directly to the buyer and seller.
- The Next.js frontend updates its isolated Zustand stores, triggering 60fps canvas chart updates and order book depth animations.
