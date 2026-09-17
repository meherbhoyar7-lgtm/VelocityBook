-- ═══════════════════════════════════════════════════════════════════
-- VelocityBook — Seed Data
-- 3 demo users, each funded with $100K USD + 10 BTC + 100 ETH
-- ═══════════════════════════════════════════════════════════════════

-- Demo Users (passwords are bcrypt hash of "password123")
INSERT INTO users (id, email, display_name, password_hash) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'alice@velocitybook.io', 'Alice', '$2a$10$rQEY0tJx5mERG3KCBve0K.FHRx4r0gXe8iV0dONVfT1GhEDdqVpXG'),
  ('b0000000-0000-0000-0000-000000000002', 'bob@velocitybook.io', 'Bob', '$2a$10$rQEY0tJx5mERG3KCBve0K.FHRx4r0gXe8iV0dONVfT1GhEDdqVpXG'),
  ('c0000000-0000-0000-0000-000000000003', 'mm@velocitybook.io', 'Market Maker', '$2a$10$rQEY0tJx5mERG3KCBve0K.FHRx4r0gXe8iV0dONVfT1GhEDdqVpXG');

-- Alice Accounts
INSERT INTO accounts (user_id, currency, available_balance) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'INR', 8500000.00000000),
  ('a0000000-0000-0000-0000-000000000001', 'USD', 100000.00000000),
  ('a0000000-0000-0000-0000-000000000001', 'BTC', 10.00000000),
  ('a0000000-0000-0000-0000-000000000001', 'ETH', 100.00000000);

-- Bob Accounts
INSERT INTO accounts (user_id, currency, available_balance) VALUES
  ('b0000000-0000-0000-0000-000000000002', 'INR', 8500000.00000000),
  ('b0000000-0000-0000-0000-000000000002', 'USD', 100000.00000000),
  ('b0000000-0000-0000-0000-000000000002', 'BTC', 10.00000000),
  ('b0000000-0000-0000-0000-000000000002', 'ETH', 100.00000000);

-- Market Maker Accounts (extra funds for liquidity)
INSERT INTO accounts (user_id, currency, available_balance) VALUES
  ('c0000000-0000-0000-0000-000000000003', 'INR', 85000000.00000000),
  ('c0000000-0000-0000-0000-000000000003', 'USD', 1000000.00000000),
  ('c0000000-0000-0000-0000-000000000003', 'BTC', 100.00000000),
  ('c0000000-0000-0000-0000-000000000003', 'ETH', 1000.00000000);

