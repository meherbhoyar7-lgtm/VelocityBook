-- ═══════════════════════════════════════════════════════════════════
-- VelocityBook — Database Schema (DDL)
-- Double-Entry Financial Ledger with ACID Guarantees
-- ═══════════════════════════════════════════════════════════════════

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Users ─────────────────────────────────────────────────────────
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255),
  display_name VARCHAR(100) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Accounts (one per user per currency) ──────────────────────────
-- available_balance = funds ready to trade
-- locked_balance    = funds reserved for open orders
CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency VARCHAR(10) NOT NULL,
  available_balance NUMERIC(28, 8) NOT NULL DEFAULT 0
    CHECK (available_balance >= 0),
  locked_balance NUMERIC(28, 8) NOT NULL DEFAULT 0
    CHECK (locked_balance >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, currency)
);

-- ─── Orders ────────────────────────────────────────────────────────
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  symbol VARCHAR(20) NOT NULL,
  side VARCHAR(4) NOT NULL CHECK (side IN ('BUY', 'SELL')),
  type VARCHAR(20) NOT NULL CHECK (type IN ('LIMIT', 'MARKET', 'STOP_LOSS', 'ICEBERG', 'TRAILING_STOP', 'FILL_OR_KILL')),
  price NUMERIC(28, 8),
  quantity NUMERIC(28, 8) NOT NULL CHECK (quantity > 0),
  filled_quantity NUMERIC(28, 8) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED')),
  -- Advanced order type fields
  stop_price NUMERIC(28, 8),              -- STOP_LOSS / TRAILING_STOP trigger price
  display_qty NUMERIC(28, 8),             -- ICEBERG visible slice size
  hidden_qty NUMERIC(28, 8),              -- ICEBERG remaining hidden quantity
  trailing_delta NUMERIC(28, 8),          -- TRAILING_STOP trail distance
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Trades (executed matches) ─────────────────────────────────────
CREATE TABLE trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol VARCHAR(20) NOT NULL,
  price NUMERIC(28, 8) NOT NULL,
  quantity NUMERIC(28, 8) NOT NULL,
  buyer_order_id UUID REFERENCES orders(id),
  seller_order_id UUID REFERENCES orders(id),
  buyer_id UUID REFERENCES users(id),
  seller_id UUID REFERENCES users(id),
  executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Immutable Double-Entry Ledger ─────────────────────────────────
-- Every trade settlement creates exactly 4 entries (2 debits, 2 credits)
-- grouped by a shared transaction_id.
-- This table is APPEND-ONLY. Never UPDATE or DELETE rows.
CREATE TABLE ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL,
  account_id UUID NOT NULL REFERENCES accounts(id),
  amount NUMERIC(28, 8) NOT NULL,
  entry_type VARCHAR(6) NOT NULL CHECK (entry_type IN ('DEBIT', 'CREDIT')),
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Faucet Deposits Tracking ──────────────────────────────────────
CREATE TABLE faucet_deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  currency VARCHAR(10) NOT NULL,
  amount NUMERIC(28, 8) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════
-- Performance Indexes
-- ═══════════════════════════════════════════════════════════════════

CREATE INDEX idx_accounts_user ON accounts(user_id);
CREATE INDEX idx_orders_user_status ON orders(user_id, status);
CREATE INDEX idx_orders_symbol_status ON orders(symbol, status);
CREATE INDEX idx_orders_symbol_created ON orders(symbol, created_at DESC);
CREATE INDEX idx_trades_symbol ON trades(symbol, executed_at DESC);
CREATE INDEX idx_trades_buyer ON trades(buyer_id, executed_at DESC);
CREATE INDEX idx_trades_seller ON trades(seller_id, executed_at DESC);
CREATE INDEX idx_ledger_transaction ON ledger_entries(transaction_id);
CREATE INDEX idx_ledger_account ON ledger_entries(account_id, created_at DESC);
CREATE INDEX idx_faucet_user ON faucet_deposits(user_id);
