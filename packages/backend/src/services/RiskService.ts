import { PoolClient } from 'pg';
import Decimal from 'decimal.js';
import { withTransaction } from '../db/pool';
import { LedgerService } from './LedgerService';

interface AccountRow {
  id: string;
  user_id: string;
  currency: string;
  available_balance: string;
  locked_balance: string;
}

/**
 * RiskService — Pre-Trade Validation & Balance Locking
 *
 * Before any order enters the matching engine, this service:
 * 1. Acquires a row-level lock on the user's account (SELECT ... FOR UPDATE)
 * 2. Validates sufficient available balance
 * 3. Atomically moves funds from available_balance to locked_balance
 *
 * This prevents race conditions where two concurrent orders could
 * overdraw the same account.
 */
export class RiskService {
  /**
   * Lock funds for a new order.
   *
   * For BUY orders: lock (price * quantity) from the quote currency (USD)
   * For SELL orders: lock (quantity) from the base currency (BTC/ETH)
   *
   * Uses SELECT FOR UPDATE to prevent concurrent access.
   *
   * @returns The locked amount and the account ID
   * @throws Error if insufficient balance
   */
  static async lockFundsForOrder(
    client: PoolClient,
    params: {
      userId: string;
      symbol: string;
      side: 'BUY' | 'SELL';
      price: Decimal;
      quantity: Decimal;
    }
  ): Promise<{ lockedAmount: Decimal; accountId: string }> {
    const [baseCurrency, quoteCurrency] = params.symbol.split('-');

    let currency: string;
    let lockAmount: Decimal;

    if (params.side === 'BUY') {
      // Buyer locks quote currency (USD)
      currency = quoteCurrency;
      lockAmount = params.price.times(params.quantity);
    } else {
      // Seller locks base currency (BTC)
      currency = baseCurrency;
      lockAmount = params.quantity;
    }

    // Acquire row-level lock
    const rows = await client.query<AccountRow>(
      `SELECT id, available_balance, locked_balance
       FROM accounts
       WHERE user_id = $1 AND currency = $2
       FOR UPDATE`,
      [params.userId, currency]
    );

    if (rows.rows.length === 0) {
      throw new Error(`No ${currency} account found for user ${params.userId}`);
    }

    const account = rows.rows[0];
    const available = new Decimal(account.available_balance);

    if (available.lt(lockAmount)) {
      throw new Error(
        `Insufficient ${currency} balance. Required: ${lockAmount.toFixed(8)}, Available: ${available.toFixed(8)}`
      );
    }

    // Atomically move from available → locked
    await client.query(
      `UPDATE accounts
       SET available_balance = available_balance - $1,
           locked_balance = locked_balance + $1,
           updated_at = NOW()
       WHERE id = $2`,
      [lockAmount.toFixed(8), account.id]
    );

    return { lockedAmount: lockAmount, accountId: account.id };
  }

  /**
   * Unlock funds when an order is cancelled.
   * Moves the remaining locked amount back to available_balance.
   */
  static async unlockFundsForCancel(
    client: PoolClient,
    params: {
      userId: string;
      symbol: string;
      side: 'BUY' | 'SELL';
      price: Decimal;
      remainingQuantity: Decimal;
    }
  ): Promise<void> {
    const [baseCurrency, quoteCurrency] = params.symbol.split('-');

    let currency: string;
    let unlockAmount: Decimal;

    if (params.side === 'BUY') {
      currency = quoteCurrency;
      unlockAmount = params.price.times(params.remainingQuantity);
    } else {
      currency = baseCurrency;
      unlockAmount = params.remainingQuantity;
    }

    // Acquire lock and update
    await client.query(
      `UPDATE accounts
       SET available_balance = available_balance + $1,
           locked_balance = locked_balance - $1,
           updated_at = NOW()
       WHERE user_id = $2 AND currency = $3`,
      [unlockAmount.toFixed(8), params.userId, currency]
    );
  }

  /**
   * Deposit virtual funds via faucet.
   * Adds to available_balance and records in the ledger.
   */
  static async depositFaucet(
    userId: string,
    currency: string,
    amount: Decimal
  ): Promise<void> {
    await withTransaction(async (client) => {
      // Lock the account row
      const rows = await client.query<AccountRow>(
        `SELECT id FROM accounts
         WHERE user_id = $1 AND currency = $2
         FOR UPDATE`,
        [userId, currency]
      );

      if (rows.rows.length === 0) {
        throw new Error(`No ${currency} account found for user ${userId}`);
      }

      const accountId = rows.rows[0].id;

      // Increase available balance
      await client.query(
        `UPDATE accounts
         SET available_balance = available_balance + $1, updated_at = NOW()
         WHERE id = $2`,
        [amount.toFixed(8), accountId]
      );

      // Record in the ledger
      await LedgerService.recordFaucetDeposit(client, accountId, amount, currency, userId);
    });
  }
}
