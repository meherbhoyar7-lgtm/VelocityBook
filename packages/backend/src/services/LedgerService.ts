import { PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import Decimal from 'decimal.js';

/**
 * LedgerService — Double-Entry Accounting
 *
 * Every balance mutation is recorded as a balanced pair of DEBIT and CREDIT entries.
 * Entries are append-only and immutable. For every transaction_id:
 *   SUM(DEBIT amounts) = SUM(CREDIT amounts)
 */
export class LedgerService {
  /**
   * Record a double-entry ledger transaction for a trade settlement.
   *
   * A trade between buyer and seller creates exactly 4 ledger entries:
   * 1. DEBIT  buyer's  USD locked_balance   (buyer pays)
   * 2. CREDIT seller's USD available_balance (seller receives USD)
   * 3. DEBIT  seller's BTC locked_balance   (seller gives BTC)
   * 4. CREDIT buyer's  BTC available_balance (buyer receives BTC)
   *
   * @param client - A PoolClient inside an active transaction
   */
  static async recordTradeSettlement(
    client: PoolClient,
    params: {
      buyerUsdAccountId: string;
      sellerUsdAccountId: string;
      buyerAssetAccountId: string;
      sellerAssetAccountId: string;
      usdAmount: Decimal;      // price * quantity
      assetAmount: Decimal;    // quantity of the asset
      symbol: string;
      tradeId: string;
    }
  ): Promise<string> {
    const transactionId = uuidv4();

    const entries = [
      {
        accountId: params.buyerUsdAccountId,
        amount: params.usdAmount.toFixed(8),
        entryType: 'DEBIT',
        description: `Trade ${params.tradeId}: Buyer pays ${params.usdAmount.toFixed(2)} USD for ${params.symbol}`,
      },
      {
        accountId: params.sellerUsdAccountId,
        amount: params.usdAmount.toFixed(8),
        entryType: 'CREDIT',
        description: `Trade ${params.tradeId}: Seller receives ${params.usdAmount.toFixed(2)} USD from ${params.symbol}`,
      },
      {
        accountId: params.sellerAssetAccountId,
        amount: params.assetAmount.toFixed(8),
        entryType: 'DEBIT',
        description: `Trade ${params.tradeId}: Seller gives ${params.assetAmount.toFixed(8)} ${params.symbol.split('-')[0]}`,
      },
      {
        accountId: params.buyerAssetAccountId,
        amount: params.assetAmount.toFixed(8),
        entryType: 'CREDIT',
        description: `Trade ${params.tradeId}: Buyer receives ${params.assetAmount.toFixed(8)} ${params.symbol.split('-')[0]}`,
      },
    ];

    for (const entry of entries) {
      await client.query(
        `INSERT INTO ledger_entries (transaction_id, account_id, amount, entry_type, description)
         VALUES ($1, $2, $3, $4, $5)`,
        [transactionId, entry.accountId, entry.amount, entry.entryType, entry.description]
      );
    }

    return transactionId;
  }

  /**
   * Record a faucet deposit as a single CREDIT ledger entry.
   */
  static async recordFaucetDeposit(
    client: PoolClient,
    accountId: string,
    amount: Decimal,
    currency: string,
    userId: string
  ): Promise<string> {
    const transactionId = uuidv4();

    await client.query(
      `INSERT INTO ledger_entries (transaction_id, account_id, amount, entry_type, description)
       VALUES ($1, $2, $3, 'CREDIT', $4)`,
      [transactionId, accountId, amount.toFixed(8), `Faucet deposit: ${amount.toFixed(8)} ${currency}`]
    );

    await client.query(
      `INSERT INTO faucet_deposits (user_id, currency, amount) VALUES ($1, $2, $3)`,
      [userId, currency, amount.toFixed(8)]
    );

    return transactionId;
  }

  /**
   * Get ledger entries for a user's accounts (for audit trail display).
   */
  static async getUserLedger(
    userId: string,
    limit: number = 100
  ): Promise<any[]> {
    const { query: dbQuery } = await import('../db/pool');
    const rows = await dbQuery(
      `SELECT le.id, le.transaction_id, le.amount, le.entry_type, le.description, le.created_at,
              a.currency, a.user_id
       FROM ledger_entries le
       JOIN accounts a ON le.account_id = a.id
       WHERE a.user_id = $1
       ORDER BY le.created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    return rows;
  }
}
