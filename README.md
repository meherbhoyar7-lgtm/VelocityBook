# VelocityBook

> **Production-Grade In-Memory Matching Engine & ACID Double-Entry Ledger Exchange Platform**

![VelocityBook Architecture](https://img.shields.io/badge/Architecture-Price--Time%20Priority%20FIFO-blue)
![Throughput](https://img.shields.io/badge/Throughput-20%2C000%2B%20orders%2Fsec-success)
![Accounting](https://img.shields.io/badge/Ledger-ACID%20Double--Entry-purple)
![Frontend](https://img.shields.io/badge/Terminal-Next.js%2016%20%7C%20TradingView-cyan)
![Tests](https://img.shields.io/badge/Tests-Vitest%20%7C%2010K%20Stress%20Test%20Passing-brightgreen)

VelocityBook is a full-stack, institutional-grade cryptocurrency/equity trading exchange platform built from the ground up to demonstrate low-latency concurrency, deterministic state machines, and high-frequency streaming architecture.

---

## Key Highlights

- ⚡ **In-Memory Matching Engine**: Deterministic **Price-Time Priority (FIFO)** matching engine running in RAM at **20,492 orders/second** with $O(1)$ cancellations and $O(\log P)$ limit insertions.
- 🏛️ **ACID Double-Entry Financial Ledger**: Institutional immutable audit trail recording 4 ledger entries per fill (2 debits, 2 credits) inside atomic PostgreSQL transactions.
- 🛡️ **Pre-Trade Risk Engine**: Prevents balance overdrafts using PostgreSQL row-level locks (`SELECT ... FOR UPDATE`) and available/locked fund state transitions.
- 📡 **Real-Time WebSocket Streaming**: Redis Pub/Sub gateway broadcasting L2 order book depth snapshots, trade tickers, and private balance/order updates.
- 📈 **Bloomberg-Pro Trading Terminal**: Dark high-contrast interface featuring TradingView `lightweight-charts` (60fps Canvas OHLCV), depth heatmaps, flash animations, and double-entry ledger audit trail.
- 🤖 **Autonomous Market Maker Bot**: Built-in liquidity provider maintaining 20 bid and 20 ask levels with realistic random walk price drift and spread crossing.
- 🧪 **Comprehensive Verification**: 21 unit tests covering partial fills, market sweeps, and edge cases, plus an automated **10,000-order concurrency stress test** verifying the 4 core financial invariants.

---

## Quick Start

### Option 1: Docker Compose (Recommended)

Start all services (PostgreSQL 16, Redis 7, Backend API, and Frontend Terminal) in one command:

```bash
docker-compose up --build
```

- **Trading Terminal UI**: [http://localhost:3000](http://localhost:3000)
- **REST API Gateway**: [http://localhost:3001](http://localhost:3001)
- **WebSocket Feed**: `ws://localhost:3001/ws`
- **Health Check**: [http://localhost:3001/api/health](http://localhost:3001/api/health)

---

### Option 2: Local Development

#### Prerequisites
- Node.js >= 18.0.0
- PostgreSQL 16
- Redis 7

```bash
# 1. Install root & workspace dependencies
npm install

# 2. Build the matching engine package
cd packages/engine && npm run build && cd ../..

# 3. Setup database (PostgreSQL)
psql -U postgres -d postgres -f packages/backend/src/db/schema.sql
psql -U postgres -d velocitybook -f packages/backend/src/db/seed.sql

# 4. Start Backend (in terminal 1)
npm run dev:backend

# 5. Start Frontend (in terminal 2)
npm run dev:frontend
```

---

## Automated Tests & Verification

### Matching Engine Unit Tests (Vitest)
Executes 21 unit tests validating bid/ask sorting, FIFO order priority, partial fill logic, market order book sweeps, and cancellations:

```bash
npm test
```

### 10,000-Order High-Concurrency Stress Test
Simulates 10 concurrent automated trading bots (5 buyers, 5 sellers) placing 10,000 orders across asynchronous event loop tasks while asserting the **4 core financial invariants**:

```bash
npm run stress-test
```

#### Stress Test Results
| Metric | Benchmark Result |
| :--- | :--- |
| **Total Orders Processed** | 10,000 |
| **Throughput** | **20,492 orders/sec** |
| **Latency (P50)** | **0 ms** |
| **Latency (P95)** | **1 ms** |
| **Latency (P99)** | **1 ms** |
| **Invariant 1: Zero Negative Balances** | **PASS** ($\forall \text{ accounts } \ge 0$) |
| **Invariant 2: Double-Entry Equality** | **PASS** ($\sum \text{Debits} \equiv \sum \text{Credits}$) |
| **Invariant 3: Conservation of Value** | **PASS** ($\Delta \text{System Assets} = 0$) |
| **Invariant 4: No Orphaned Locks** | **PASS** ($\text{Locked Funds} \equiv \text{Resting Commitments}$) |

---

## System Architecture & Flow

```
[ Next.js Trading Terminal ] ◄──── WebSocket ────► [ Express / WS Gateway ]
         │                                                    │
         ▼ HTTP POST /orders                                  ▼
[ RiskService (Row Locks) ] ───► [ In-Memory Engine ] ───► [ Redis Pub/Sub ]
         │                                │
         ▼                                ▼
[ PostgreSQL 16 ACID ] ◄─── [ Settlement & Double-Entry Ledger ]
```

- For detailed algorithmic deep-dives, see **[Architecture Documentation](docs/ARCHITECTURE.md)**.
- For the full 4-phase transaction sequence diagram, see **[Trade Lifecycle Documentation](docs/TRADE_LIFECYCLE.md)**.

---

## Workspace Monorepo Structure

```
engine/
├── packages/
│   ├── engine/                  # Core in-memory Price-Time Priority matching engine
│   │   ├── src/
│   │   │   ├── OrderBook.ts     # L2 price level FIFO queues & O(1) order hash index
│   │   │   ├── MatchingEngine.ts# Multi-symbol engine router & execution generator
│   │   │   ├── types.ts         # Enums (Side, OrderType) & interfaces
│   │   │   └── __tests__/       # 21 Vitest unit test suites
│   │   └── package.json
│   │
│   ├── backend/                 # API, settlement, and financial services
│   │   ├── src/
│   │   │   ├── db/              # PostgreSQL pool, schema.sql, and seed.sql
│   │   │   ├── services/
│   │   │   │   ├── LedgerService.ts     # Double-entry 4-legged audit trail
│   │   │   │   ├── RiskService.ts       # Row-level balance locking (FOR UPDATE)
│   │   │   │   ├── SettlementService.ts # Single-transaction atomic settlement
│   │   │   │   └── MarketMakerBot.ts    # Autonomous liquidity provider bot
│   │   │   ├── websocket/       # Redis Pub/Sub publisher & WS server
│   │   │   ├── routes/          # REST endpoints (auth, orders, portfolio, trades, faucet)
│   │   │   └── server.ts        # Express entry point
│   │   └── package.json
│   │
│   └── frontend/                # Next.js 16 + React 19 trading dashboard
│       ├── src/
│       │   ├── app/             # App Router layout & trading terminal page
│       │   ├── components/      # CandlestickChart, OrderBook, OrderEntry, RecentTrades, BottomDock
│       │   ├── stores/          # Isolated Zustand stores (OrderBook, Trade, User, WebSocket)
│       │   └── lib/             # API client & utility formatters
│       └── package.json
│
├── scripts/
│   ├── stress-test.ts           # 10,000-order concurrency & invariant verification script
│   └── seed-market.ts           # Initial liquidity seeding script (20 bids / 20 asks)
├── docs/
│   ├── ARCHITECTURE.md          # Technical design & algorithmic specifications
│   └── TRADE_LIFECYCLE.md       # Sequence diagram & transaction lifecycle breakdown
├── docker-compose.yml           # Multi-container orchestration (PG, Redis, Backend, Frontend)
└── package.json                 # Workspace root config
```

---

## Demo Accounts

The database comes pre-seeded with 3 demo accounts equipped with virtual funds:

| User | Email | Initial Balance | Role |
| :--- | :--- | :--- | :--- |
| **Alice Smith** | `alice@velocitybook.io` | ₹8,500,000 INR, 10 BTC, 100 ETH | Active Retail Trader |
| **Bob Jones** | `bob@velocitybook.io` | ₹8,500,000 INR, 10 BTC, 100 ETH | Counterparty Trader |
| **Market Maker Bot** | `marketmaker@velocitybook.io` | ₹85,000,000 INR, 100 BTC, 1,000 ETH | Automated Liquidity Provider |

You can switch between users instantly in the header navigation or deposit additional virtual funds via the faucet button.

---

## License

MIT
