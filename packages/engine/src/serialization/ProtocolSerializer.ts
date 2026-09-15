import protobuf from 'protobufjs';
import Decimal from 'decimal.js';
import {
  Order,
  TradeExecution,
  OrderBookSnapshot,
  Side,
  OrderType,
  OrderStatus,
} from '../types';

// ─── Engine RPC Command & Result Interfaces ─────────────────────────

export type EngineAction = 'SUBMIT_ORDER' | 'CANCEL_ORDER' | 'GET_SNAPSHOT' | 'GET_STATS';

export interface EngineCommand {
  correlationId: string;
  action: EngineAction;
  symbol: string;
  order?: Order;
  orderId?: string;
  depth?: number;
}

export interface EngineResult {
  correlationId: string;
  success: boolean;
  trades?: TradeExecution[];
  order?: Order;
  snapshot?: OrderBookSnapshot;
  error?: string;
}

// ─── Programmatic Protobuf Definition ───────────────────────────────

const root = new protobuf.Root();

// Order Message
const OrderMessage = new protobuf.Type('OrderMessage')
  .add(new protobuf.Field('id', 1, 'string'))
  .add(new protobuf.Field('userId', 2, 'string'))
  .add(new protobuf.Field('symbol', 3, 'string'))
  .add(new protobuf.Field('side', 4, 'string'))
  .add(new protobuf.Field('type', 5, 'string'))
  .add(new protobuf.Field('price', 6, 'string'))
  .add(new protobuf.Field('quantity', 7, 'string'))
  .add(new protobuf.Field('filledQuantity', 8, 'string'))
  .add(new protobuf.Field('status', 9, 'string'))
  .add(new protobuf.Field('timestamp', 10, 'int64'))
  .add(new protobuf.Field('stopPrice', 11, 'string', 'optional'))
  .add(new protobuf.Field('trailingDelta', 12, 'string', 'optional'))
  .add(new protobuf.Field('displayQty', 13, 'string', 'optional'))
  .add(new protobuf.Field('hiddenQty', 14, 'string', 'optional'));

// Trade Execution Message
const TradeExecutionMessage = new protobuf.Type('TradeExecutionMessage')
  .add(new protobuf.Field('tradeId', 1, 'string'))
  .add(new protobuf.Field('symbol', 2, 'string'))
  .add(new protobuf.Field('buyOrderId', 3, 'string'))
  .add(new protobuf.Field('sellOrderId', 4, 'string'))
  .add(new protobuf.Field('buyerId', 5, 'string'))
  .add(new protobuf.Field('sellerId', 6, 'string'))
  .add(new protobuf.Field('price', 7, 'string'))
  .add(new protobuf.Field('quantity', 8, 'string'))
  .add(new protobuf.Field('timestamp', 9, 'int64'));

// Trade Execution List
const TradeListMessage = new protobuf.Type('TradeListMessage')
  .add(new protobuf.Field('trades', 1, 'TradeExecutionMessage', 'repeated'));

// Price Level Snapshot Message
const PriceLevelSnapshotMessage = new protobuf.Type('PriceLevelSnapshotMessage')
  .add(new protobuf.Field('price', 1, 'string'))
  .add(new protobuf.Field('size', 2, 'string'))
  .add(new protobuf.Field('total', 3, 'string'));

// Order Book Snapshot Message
const OrderBookSnapshotMessage = new protobuf.Type('OrderBookSnapshotMessage')
  .add(new protobuf.Field('symbol', 1, 'string'))
  .add(new protobuf.Field('bids', 2, 'PriceLevelSnapshotMessage', 'repeated'))
  .add(new protobuf.Field('asks', 3, 'PriceLevelSnapshotMessage', 'repeated'))
  .add(new protobuf.Field('spread', 4, 'string', 'optional'))
  .add(new protobuf.Field('midPrice', 5, 'string', 'optional'))
  .add(new protobuf.Field('timestamp', 6, 'int64'));

// Engine Command Message
const EngineCommandMessage = new protobuf.Type('EngineCommandMessage')
  .add(new protobuf.Field('correlationId', 1, 'string'))
  .add(new protobuf.Field('action', 2, 'string'))
  .add(new protobuf.Field('symbol', 3, 'string'))
  .add(new protobuf.Field('order', 4, 'OrderMessage', 'optional'))
  .add(new protobuf.Field('orderId', 5, 'string', 'optional'))
  .add(new protobuf.Field('depth', 6, 'int32', 'optional'));

// Engine Result Message
const EngineResultMessage = new protobuf.Type('EngineResultMessage')
  .add(new protobuf.Field('correlationId', 1, 'string'))
  .add(new protobuf.Field('success', 2, 'bool'))
  .add(new protobuf.Field('trades', 3, 'TradeExecutionMessage', 'repeated'))
  .add(new protobuf.Field('order', 4, 'OrderMessage', 'optional'))
  .add(new protobuf.Field('snapshot', 5, 'OrderBookSnapshotMessage', 'optional'))
  .add(new protobuf.Field('error', 6, 'string', 'optional'));

root.add(OrderMessage);
root.add(TradeExecutionMessage);
root.add(TradeListMessage);
root.add(PriceLevelSnapshotMessage);
root.add(OrderBookSnapshotMessage);
root.add(EngineCommandMessage);
root.add(EngineResultMessage);

// ─── Protobuf Serializer Implementation ─────────────────────────────

export class ProtocolSerializer {
  /**
   * Encode Order to Protobuf binary Uint8Array.
   */
  static encodeOrder(order: Order): Uint8Array {
    const payload: any = {
      id: order.id,
      userId: order.userId,
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      price: order.price.toString(),
      quantity: order.quantity.toString(),
      filledQuantity: order.filledQuantity.toString(),
      status: order.status,
      timestamp: order.timestamp,
    };
    if (order.stopPrice) payload.stopPrice = order.stopPrice.toString();
    if (order.trailingDelta) payload.trailingDelta = order.trailingDelta.toString();
    if (order.displayQty) payload.displayQty = order.displayQty.toString();
    if (order.hiddenQty) payload.hiddenQty = order.hiddenQty.toString();

    const err = OrderMessage.verify(payload);
    if (err) throw new Error(`Order verification failed: ${err}`);
    return OrderMessage.encode(OrderMessage.create(payload)).finish();
  }

  /**
   * Decode Order from Protobuf binary Uint8Array.
   */
  static decodeOrder(buffer: Uint8Array): Order {
    const decoded: any = OrderMessage.decode(buffer);
    return {
      id: decoded.id,
      userId: decoded.userId,
      symbol: decoded.symbol,
      side: decoded.side as Side,
      type: decoded.type as OrderType,
      price: new Decimal(decoded.price || '0'),
      quantity: new Decimal(decoded.quantity || '0'),
      filledQuantity: new Decimal(decoded.filledQuantity || '0'),
      status: decoded.status as OrderStatus,
      timestamp: typeof decoded.timestamp === 'number' ? decoded.timestamp : decoded.timestamp.toNumber(),
      ...(decoded.stopPrice && { stopPrice: new Decimal(decoded.stopPrice) }),
      ...(decoded.trailingDelta && { trailingDelta: new Decimal(decoded.trailingDelta) }),
      ...(decoded.displayQty && { displayQty: new Decimal(decoded.displayQty) }),
      ...(decoded.hiddenQty && { hiddenQty: new Decimal(decoded.hiddenQty) }),
    };
  }

  /**
   * Encode single TradeExecution to Protobuf binary Uint8Array.
   */
  static encodeTrade(trade: TradeExecution): Uint8Array {
    const payload = {
      tradeId: trade.tradeId,
      symbol: trade.symbol,
      buyOrderId: trade.buyOrderId,
      sellOrderId: trade.sellOrderId,
      buyerId: trade.buyerId,
      sellerId: trade.sellerId,
      price: trade.price.toString(),
      quantity: trade.quantity.toString(),
      timestamp: trade.timestamp,
    };
    return TradeExecutionMessage.encode(TradeExecutionMessage.create(payload)).finish();
  }

  /**
   * Decode single TradeExecution from Protobuf binary Uint8Array.
   */
  static decodeTrade(buffer: Uint8Array): TradeExecution {
    const decoded: any = TradeExecutionMessage.decode(buffer);
    return {
      tradeId: decoded.tradeId,
      symbol: decoded.symbol,
      buyOrderId: decoded.buyOrderId,
      sellOrderId: decoded.sellOrderId,
      buyerId: decoded.buyerId,
      sellerId: decoded.sellerId,
      price: new Decimal(decoded.price || '0'),
      quantity: new Decimal(decoded.quantity || '0'),
      timestamp: typeof decoded.timestamp === 'number' ? decoded.timestamp : decoded.timestamp.toNumber(),
    };
  }

  /**
   * Encode multiple TradeExecutions into a single binary buffer.
   */
  static encodeTrades(trades: TradeExecution[]): Uint8Array {
    const payload = {
      trades: trades.map((t) => ({
        tradeId: t.tradeId,
        symbol: t.symbol,
        buyOrderId: t.buyOrderId,
        sellOrderId: t.sellOrderId,
        buyerId: t.buyerId,
        sellerId: t.sellerId,
        price: t.price.toString(),
        quantity: t.quantity.toString(),
        timestamp: t.timestamp,
      })),
    };
    return TradeListMessage.encode(TradeListMessage.create(payload)).finish();
  }

  /**
   * Decode multiple TradeExecutions from binary buffer.
   */
  static decodeTrades(buffer: Uint8Array): TradeExecution[] {
    const decoded: any = TradeListMessage.decode(buffer);
    if (!decoded.trades) return [];
    return decoded.trades.map((t: any) => ({
      tradeId: t.tradeId,
      symbol: t.symbol,
      buyOrderId: t.buyOrderId,
      sellOrderId: t.sellOrderId,
      buyerId: t.buyerId,
      sellerId: t.sellerId,
      price: new Decimal(t.price || '0'),
      quantity: new Decimal(t.quantity || '0'),
      timestamp: typeof t.timestamp === 'number' ? t.timestamp : t.timestamp.toNumber(),
    }));
  }

  /**
   * Encode OrderBookSnapshot to Protobuf binary Uint8Array.
   */
  static encodeSnapshot(snapshot: OrderBookSnapshot): Uint8Array {
    const payload: any = {
      symbol: snapshot.symbol,
      bids: snapshot.bids || [],
      asks: snapshot.asks || [],
      spread: snapshot.spread ? snapshot.spread.toString() : '',
      midPrice: snapshot.midPrice ? snapshot.midPrice.toString() : '',
      timestamp: snapshot.timestamp,
    };
    return OrderBookSnapshotMessage.encode(OrderBookSnapshotMessage.create(payload)).finish();
  }

  /**
   * Decode OrderBookSnapshot from Protobuf binary Uint8Array.
   */
  static decodeSnapshot(buffer: Uint8Array): OrderBookSnapshot {
    const decoded: any = OrderBookSnapshotMessage.decode(buffer);
    return {
      symbol: decoded.symbol,
      bids: (decoded.bids || []).map((b: any) => ({
        price: b.price,
        size: b.size,
        total: b.total,
      })),
      asks: (decoded.asks || []).map((a: any) => ({
        price: a.price,
        size: a.size,
        total: a.total,
      })),
      spread: decoded.spread ? new Decimal(decoded.spread) : null,
      midPrice: decoded.midPrice ? new Decimal(decoded.midPrice) : null,
      timestamp: typeof decoded.timestamp === 'number' ? decoded.timestamp : decoded.timestamp.toNumber(),
    };
  }

  /**
   * Encode Engine RPC Command to Protobuf binary Uint8Array.
   */
  static encodeCommand(cmd: EngineCommand): Uint8Array {
    const payload: any = {
      correlationId: cmd.correlationId,
      action: cmd.action,
      symbol: cmd.symbol,
      orderId: cmd.orderId || '',
      depth: cmd.depth || 0,
    };
    if (cmd.order) {
      payload.order = {
        id: cmd.order.id,
        userId: cmd.order.userId,
        symbol: cmd.order.symbol,
        side: cmd.order.side,
        type: cmd.order.type,
        price: cmd.order.price.toString(),
        quantity: cmd.order.quantity.toString(),
        filledQuantity: cmd.order.filledQuantity.toString(),
        status: cmd.order.status,
        timestamp: cmd.order.timestamp,
        ...(cmd.order.stopPrice && { stopPrice: cmd.order.stopPrice.toString() }),
        ...(cmd.order.trailingDelta && { trailingDelta: cmd.order.trailingDelta.toString() }),
        ...(cmd.order.displayQty && { displayQty: cmd.order.displayQty.toString() }),
        ...(cmd.order.hiddenQty && { hiddenQty: cmd.order.hiddenQty.toString() }),
      };
    }
    return EngineCommandMessage.encode(EngineCommandMessage.create(payload)).finish();
  }

  /**
   * Decode Engine RPC Command from Protobuf binary Uint8Array.
   */
  static decodeCommand(buffer: Uint8Array): EngineCommand {
    const decoded: any = EngineCommandMessage.decode(buffer);
    const cmd: EngineCommand = {
      correlationId: decoded.correlationId,
      action: decoded.action as EngineAction,
      symbol: decoded.symbol,
      orderId: decoded.orderId || undefined,
      depth: decoded.depth || undefined,
    };
    if (decoded.order) {
      cmd.order = {
        id: decoded.order.id,
        userId: decoded.order.userId,
        symbol: decoded.order.symbol,
        side: decoded.order.side as Side,
        type: decoded.order.type as OrderType,
        price: new Decimal(decoded.order.price || '0'),
        quantity: new Decimal(decoded.order.quantity || '0'),
        filledQuantity: new Decimal(decoded.order.filledQuantity || '0'),
        status: decoded.order.status as OrderStatus,
        timestamp: typeof decoded.order.timestamp === 'number' ? decoded.order.timestamp : decoded.order.timestamp.toNumber(),
        ...(decoded.order.stopPrice && { stopPrice: new Decimal(decoded.order.stopPrice) }),
        ...(decoded.order.trailingDelta && { trailingDelta: new Decimal(decoded.order.trailingDelta) }),
        ...(decoded.order.displayQty && { displayQty: new Decimal(decoded.order.displayQty) }),
        ...(decoded.order.hiddenQty && { hiddenQty: new Decimal(decoded.order.hiddenQty) }),
      };
    }
    return cmd;
  }

  /**
   * Encode Engine RPC Result to Protobuf binary Uint8Array.
   */
  static encodeResult(res: EngineResult): Uint8Array {
    const payload: any = {
      correlationId: res.correlationId,
      success: res.success,
      error: res.error || '',
      trades: (res.trades || []).map((t) => ({
        tradeId: t.tradeId,
        symbol: t.symbol,
        buyOrderId: t.buyOrderId,
        sellOrderId: t.sellOrderId,
        buyerId: t.buyerId,
        sellerId: t.sellerId,
        price: t.price.toString(),
        quantity: t.quantity.toString(),
        timestamp: t.timestamp,
      })),
    };

    if (res.order) {
      payload.order = {
        id: res.order.id,
        userId: res.order.userId,
        symbol: res.order.symbol,
        side: res.order.side,
        type: res.order.type,
        price: res.order.price.toString(),
        quantity: res.order.quantity.toString(),
        filledQuantity: res.order.filledQuantity.toString(),
        status: res.order.status,
        timestamp: res.order.timestamp,
        ...(res.order.stopPrice && { stopPrice: res.order.stopPrice.toString() }),
        ...(res.order.trailingDelta && { trailingDelta: res.order.trailingDelta.toString() }),
        ...(res.order.displayQty && { displayQty: res.order.displayQty.toString() }),
        ...(res.order.hiddenQty && { hiddenQty: res.order.hiddenQty.toString() }),
      };
    }

    if (res.snapshot) {
      payload.snapshot = {
        symbol: res.snapshot.symbol,
        bids: res.snapshot.bids || [],
        asks: res.snapshot.asks || [],
        spread: res.snapshot.spread ? res.snapshot.spread.toString() : '',
        midPrice: res.snapshot.midPrice ? res.snapshot.midPrice.toString() : '',
        timestamp: res.snapshot.timestamp,
      };
    }

    return EngineResultMessage.encode(EngineResultMessage.create(payload)).finish();
  }

  /**
   * Decode Engine RPC Result from Protobuf binary Uint8Array.
   */
  static decodeResult(buffer: Uint8Array): EngineResult {
    const decoded: any = EngineResultMessage.decode(buffer);
    const result: EngineResult = {
      correlationId: decoded.correlationId,
      success: decoded.success,
      error: decoded.error || undefined,
      trades: (decoded.trades || []).map((t: any) => ({
        tradeId: t.tradeId,
        symbol: t.symbol,
        buyOrderId: t.buyOrderId,
        sellOrderId: t.sellOrderId,
        buyerId: t.buyerId,
        sellerId: t.sellerId,
        price: new Decimal(t.price || '0'),
        quantity: new Decimal(t.quantity || '0'),
        timestamp: typeof t.timestamp === 'number' ? t.timestamp : t.timestamp.toNumber(),
      })),
    };

    if (decoded.order) {
      result.order = {
        id: decoded.order.id,
        userId: decoded.order.userId,
        symbol: decoded.order.symbol,
        side: decoded.order.side as Side,
        type: decoded.order.type as OrderType,
        price: new Decimal(decoded.order.price || '0'),
        quantity: new Decimal(decoded.order.quantity || '0'),
        filledQuantity: new Decimal(decoded.order.filledQuantity || '0'),
        status: decoded.order.status as OrderStatus,
        timestamp: typeof decoded.order.timestamp === 'number' ? decoded.order.timestamp : decoded.order.timestamp.toNumber(),
        ...(decoded.order.stopPrice && { stopPrice: new Decimal(decoded.order.stopPrice) }),
        ...(decoded.order.trailingDelta && { trailingDelta: new Decimal(decoded.order.trailingDelta) }),
        ...(decoded.order.displayQty && { displayQty: new Decimal(decoded.order.displayQty) }),
        ...(decoded.order.hiddenQty && { hiddenQty: new Decimal(decoded.order.hiddenQty) }),
      };
    }

    if (decoded.snapshot) {
      result.snapshot = {
        symbol: decoded.snapshot.symbol,
        bids: (decoded.snapshot.bids || []).map((b: any) => ({
          price: b.price,
          size: b.size,
          total: b.total,
        })),
        asks: (decoded.snapshot.asks || []).map((a: any) => ({
          price: a.price,
          size: a.size,
          total: a.total,
        })),
        spread: decoded.snapshot.spread ? new Decimal(decoded.snapshot.spread) : null,
        midPrice: decoded.snapshot.midPrice ? new Decimal(decoded.snapshot.midPrice) : null,
        timestamp: typeof decoded.snapshot.timestamp === 'number' ? decoded.snapshot.timestamp : decoded.snapshot.timestamp.toNumber(),
      };
    }

    return result;
  }
}

// ─── Ultra-Fast Zero-Copy Fixed-Layout Binary Codec ──────────────────

/**
 * ZeroCopyOrderCodec — Direct byte packing for microsecond order transmission.
 * Uses a fixed layout for maximum throughput with zero object allocation overhead.
 */
export class ZeroCopyOrderCodec {
  static readonly BUFFER_SIZE = 156;

  static encode(order: Order): Buffer {
    const buf = Buffer.allocUnsafe(this.BUFFER_SIZE);
    buf.fill(0);

    buf.writeBigInt64LE(BigInt(order.timestamp), 0);
    buf.writeUInt8(order.side === Side.BUY ? 0 : 1, 8);

    const typeMap: Record<OrderType, number> = {
      [OrderType.LIMIT]: 0,
      [OrderType.MARKET]: 1,
      [OrderType.STOP_LOSS]: 2,
      [OrderType.ICEBERG]: 3,
      [OrderType.TRAILING_STOP]: 4,
      [OrderType.FILL_OR_KILL]: 5,
    };
    buf.writeUInt8(typeMap[order.type] ?? 0, 9);

    const statusMap: Record<OrderStatus, number> = {
      [OrderStatus.PENDING]: 0,
      [OrderStatus.OPEN]: 1,
      [OrderStatus.PARTIALLY_FILLED]: 2,
      [OrderStatus.FILLED]: 3,
      [OrderStatus.CANCELLED]: 4,
    };
    buf.writeUInt8(statusMap[order.status] ?? 0, 10);

    let flags = 0;
    if (order.stopPrice) flags |= 1;
    if (order.displayQty) flags |= 2;
    if (order.hiddenQty) flags |= 4;
    if (order.trailingDelta) flags |= 8;
    buf.writeUInt8(flags, 11);

    buf.writeDoubleLE(order.price.toNumber(), 12);
    buf.writeDoubleLE(order.quantity.toNumber(), 20);
    buf.writeDoubleLE(order.filledQuantity.toNumber(), 28);
    buf.writeDoubleLE(order.stopPrice ? order.stopPrice.toNumber() : 0, 36);
    buf.writeDoubleLE(order.displayQty ? order.displayQty.toNumber() : 0, 44);
    buf.writeDoubleLE(order.hiddenQty ? order.hiddenQty.toNumber() : 0, 52);
    buf.writeDoubleLE(order.trailingDelta ? order.trailingDelta.toNumber() : 0, 60);

    buf.write(order.symbol.slice(0, 15), 68, 'utf8');
    buf.write(order.id.slice(0, 36), 84, 'utf8');
    buf.write(order.userId.slice(0, 36), 120, 'utf8');

    return buf;
  }

  static decode(buf: Buffer): Order {
    const timestamp = Number(buf.readBigInt64LE(0));
    const side = buf.readUInt8(8) === 0 ? Side.BUY : Side.SELL;
    const typeEnum = [
      OrderType.LIMIT,
      OrderType.MARKET,
      OrderType.STOP_LOSS,
      OrderType.ICEBERG,
      OrderType.TRAILING_STOP,
      OrderType.FILL_OR_KILL,
    ][buf.readUInt8(9)] || OrderType.LIMIT;

    const statusEnum = [
      OrderStatus.PENDING,
      OrderStatus.OPEN,
      OrderStatus.PARTIALLY_FILLED,
      OrderStatus.FILLED,
      OrderStatus.CANCELLED,
    ][buf.readUInt8(10)] || OrderStatus.OPEN;

    const flags = buf.readUInt8(11);
    const price = new Decimal(buf.readDoubleLE(12));
    const quantity = new Decimal(buf.readDoubleLE(20));
    const filledQuantity = new Decimal(buf.readDoubleLE(28));
    const stopPriceVal = buf.readDoubleLE(36);
    const displayQtyVal = buf.readDoubleLE(44);
    const hiddenQtyVal = buf.readDoubleLE(52);
    const trailingDeltaVal = buf.readDoubleLE(60);

    // Read null-terminated / trimmed strings
    const symbol = buf.toString('utf8', 68, 84).replace(/\0+$/, '');
    const id = buf.toString('utf8', 84, 120).replace(/\0+$/, '');
    const userId = buf.toString('utf8', 120, 156).replace(/\0+$/, '');

    return {
      id,
      userId,
      symbol,
      side,
      type: typeEnum,
      price,
      quantity,
      filledQuantity,
      status: statusEnum,
      timestamp,
      ...((flags & 1) && { stopPrice: new Decimal(stopPriceVal) }),
      ...((flags & 2) && { displayQty: new Decimal(displayQtyVal) }),
      ...((flags & 4) && { hiddenQty: new Decimal(hiddenQtyVal) }),
      ...((flags & 8) && { trailingDelta: new Decimal(trailingDeltaVal) }),
    };
  }
}
