import { PoolClient } from 'pg';
import Decimal from 'decimal.js';
import { v4 as uuidv4 } from 'uuid';
import { withTransaction } from '../db/pool';
import { LedgerService } from './LedgerService';
import { TradeExecution } from '@velocitybook/engine';

interface AccountRow {
  id: string;
  user_id: string;
  currency: string;
  available_balance: string;
  locked_balance: string;
}

/**
 * SettlementService — ACID Trade Settlement
 *
 * When the matching engine produces a TradeExecution event, this service
 * executes the full settlement inside a single PostgreSQL transaction:
 *
 * 1. Lock both buyer's and seller's accounts (FOR UPDATE)
 * 2. Debit buyer's locked USD → Credit seller's available USD
 * 3. Debit seller's locked BTC → Credit buyer's available BTC
 * 4. Insert 4 immutable ledger entries with shared transaction_id
 * 5. Insert the trade record
 * 6. Update both orders (filled_quantity, status)
 *
 * If ANY step fails, the entire transaction rolls back. Zero partial state.
 */
export class SettlementService {
  /**
   * Settle a single trade execution atomically.
   */
  static async settleTrade(trade: TradeExecution): Promise<{
    dbTradeId: string;
    transactionId: string;
  }> {
    return withTransaction(async (client) => {
      const [baseCurrency, quoteCurrency] = trade.symbol.split('-');
      const usdAmount = trade.price.times(trade.quantity);

      // ─── Step 1: Lock all 4 accounts ──────────────────────────
      // Buyer's quote currency (USD) account
      const buyerQuoteRows = await client.query<AccountRow>(
        `SELECT id, available_balance, locked_balance
         FROM accounts WHERE user_id = $1 AND currency = $2 FOR UPDATE`,
        [trade.buyerId, quoteCurrency]
      );
      // Seller's quote currency (USD) account
      const sellerQuoteRows = await client.query<AccountRow>(
        `SELECT id, available_balance, locked_balance
         FROM accounts WHERE user_id = $1 AND currency = $2 FOR UPDATE`,
        [trade.sellerId, quoteCurrency]
      );
      // Buyer's base currency (BTC) account
      const buyerBaseRows = await client.query<AccountRow>(
        `SELECT id, available_balance, locked_balance
         FROM accounts WHERE user_id = $1 AND currency = $2 FOR UPDATE`,
        [trade.buyerId, baseCurrency]
      );
      // Seller's base currency (BTC) account
      const sellerBaseRows = await client.query<AccountRow>(
        `SELECT id, available_balance, locked_balance
         FROM accounts WHERE user_id = $1 AND currency = $2 FOR UPDATE`,
        [trade.sellerId, baseCurrency]
      );

      const buyerQuoteAccount = buyerQuoteRows.rows[0];
      const sellerQuoteAccount = sellerQuoteRows.rows[0];
      const buyerBaseAccount = buyerBaseRows.rows[0];
      const sellerBaseAccount = sellerBaseRows.rows[0];

      if (!buyerQuoteAccount || !sellerQuoteAccount || !buyerBaseAccount || !sellerBaseAccount) {
        throw new Error(`Missing accounts for trade settlement: ${trade.tradeId}`);
      }

      // ─── Step 2: Debit buyer's locked USD ────────────────────
      await client.query(
        `UPDATE accounts
         SET locked_balance = locked_balance - $1, updated_at = NOW()
         WHERE id = $2`,
        [usdAmount.toFixed(8), buyerQuoteAccount.id]
      );

      // ─── Step 3: Credit seller's available USD ───────────────
      await client.query(
        `UPDATE accounts
         SET available_balance = available_balance + $1, updated_at = NOW()
         WHERE id = $2`,
        [usdAmount.toFixed(8), sellerQuoteAccount.id]
      );

      // ─── Step 4: Debit seller's locked BTC ───────────────────
      await client.query(
        `UPDATE accounts
         SET locked_balance = locked_balance - $1, updated_at = NOW()
         WHERE id = $2`,
        [trade.quantity.toFixed(8), sellerBaseAccount.id]
      );

      // ─── Step 5: Credit buyer's available BTC ────────────────
      await client.query(
        `UPDATE accounts
         SET available_balance = available_balance + $1, updated_at = NOW()
         WHERE id = $2`,
        [trade.quantity.toFixed(8), buyerBaseAccount.id]
      );

      // ─── Step 6: Record 4 ledger entries ─────────────────────
      const transactionId = await LedgerService.recordTradeSettlement(client, {
        buyerUsdAccountId: buyerQuoteAccount.id,
        sellerUsdAccountId: sellerQuoteAccount.id,
        buyerAssetAccountId: buyerBaseAccount.id,
        sellerAssetAccountId: sellerBaseAccount.id,
        usdAmount,
        assetAmount: trade.quantity,
        symbol: trade.symbol,
        tradeId: trade.tradeId,
      });

      // ─── Step 7: Insert trade record ─────────────────────────
      const dbTradeId = uuidv4();
      await client.query(
        `INSERT INTO trades (id, symbol, price, quantity, buyer_order_id, seller_order_id, buyer_id, seller_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          dbTradeId,
          trade.symbol,
          trade.price.toFixed(8),
          trade.quantity.toFixed(8),
          trade.buyOrderId,
          trade.sellOrderId,
          trade.buyerId,
          trade.sellerId,
        ]
      );

      // ─── Step 8: Update buyer's order ────────────────────────
      await client.query(
        `UPDATE orders
         SET filled_quantity = filled_quantity + $1,
             status = CASE
               WHEN filled_quantity + $1 >= quantity THEN 'FILLED'
               ELSE 'PARTIALLY_FILLED'
             END,
             updated_at = NOW()
         WHERE id = $2`,
        [trade.quantity.toFixed(8), trade.buyOrderId]
      );

      // ─── Step 9: Update seller's order ───────────────────────
      await client.query(
        `UPDATE orders
         SET filled_quantity = filled_quantity + $1,
             status = CASE
               WHEN filled_quantity + $1 >= quantity THEN 'FILLED'
               ELSE 'PARTIALLY_FILLED'
             END,
             updated_at = NOW()
         WHERE id = $2`,
        [trade.quantity.toFixed(8), trade.sellOrderId]
      );

      return { dbTradeId, transactionId };
    });
  }
}
