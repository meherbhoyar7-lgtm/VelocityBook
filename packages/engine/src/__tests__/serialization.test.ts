import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import {
  ProtocolSerializer,
  ZeroCopyOrderCodec,
  EngineCommand,
  EngineResult,
} from '../serialization/ProtocolSerializer';
import {
  Order,
  TradeExecution,
  OrderBookSnapshot,
  Side,
  OrderType,
  OrderStatus,
} from '../types';

describe('Zero-Copy & Protobuf Serialization', () => {
  const sampleOrder: Order = {
    id: '11111111-1111-1111-1111-111111111111',
    userId: '22222222-2222-2222-2222-222222222222',
    symbol: 'BTC-USD',
    side: Side.BUY,
    type: OrderType.ICEBERG,
    price: new Decimal('65000.50'),
    quantity: new Decimal('10.00000000'),
    filledQuantity: new Decimal('2.50000000'),
    status: OrderStatus.PARTIALLY_FILLED,
    timestamp: 1726000000000,
    stopPrice: new Decimal('64000.00'),
    trailingDelta: new Decimal('500.00'),
    displayQty: new Decimal('1.00000000'),
    hiddenQty: new Decimal('9.00000000'),
  };

  const sampleTrade: TradeExecution = {
    tradeId: 't-99999999-9999',
    symbol: 'BTC-USD',
    buyOrderId: '11111111-1111-1111-1111-111111111111',
    sellOrderId: '33333333-3333-3333-3333-333333333333',
    buyerId: '22222222-2222-2222-2222-222222222222',
    sellerId: '44444444-4444-4444-4444-444444444444',
    price: new Decimal('65000.50'),
    quantity: new Decimal('0.75000000'),
    timestamp: 1726000000100,
  };

  const sampleSnapshot: OrderBookSnapshot = {
    symbol: 'BTC-USD',
    bids: [
      { price: '65000.00', size: '1.50000000', total: '1.50000000' },
      { price: '64990.00', size: '3.00000000', total: '4.50000000' },
    ],
    asks: [
      { price: '65010.00', size: '2.00000000', total: '2.00000000' },
      { price: '65020.00', size: '5.50000000', total: '7.50000000' },
    ],
    spread: new Decimal('10.00'),
    midPrice: new Decimal('65005.00'),
    timestamp: 1726000000200,
  };

  describe('ProtocolSerializer (Protobuf)', () => {
    it('correctly serializes and deserializes an Order with all fields', () => {
      const encoded = ProtocolSerializer.encodeOrder(sampleOrder);
      expect(encoded).toBeInstanceOf(Uint8Array);
      expect(encoded.length).toBeGreaterThan(0);

      const decoded = ProtocolSerializer.decodeOrder(encoded);
      expect(decoded.id).toBe(sampleOrder.id);
      expect(decoded.userId).toBe(sampleOrder.userId);
      expect(decoded.symbol).toBe(sampleOrder.symbol);
      expect(decoded.side).toBe(sampleOrder.side);
      expect(decoded.type).toBe(sampleOrder.type);
      expect(decoded.price.toString()).toBe(sampleOrder.price.toString());
      expect(decoded.quantity.toString()).toBe(sampleOrder.quantity.toString());
      expect(decoded.filledQuantity.toString()).toBe(sampleOrder.filledQuantity.toString());
      expect(decoded.status).toBe(sampleOrder.status);
      expect(decoded.timestamp).toBe(sampleOrder.timestamp);
      expect(decoded.stopPrice?.toString()).toBe(sampleOrder.stopPrice?.toString());
      expect(decoded.trailingDelta?.toString()).toBe(sampleOrder.trailingDelta?.toString());
      expect(decoded.displayQty?.toString()).toBe(sampleOrder.displayQty?.toString());
      expect(decoded.hiddenQty?.toString()).toBe(sampleOrder.hiddenQty?.toString());
    });

    it('serializes and deserializes a single TradeExecution', () => {
      const encoded = ProtocolSerializer.encodeTrade(sampleTrade);
      const decoded = ProtocolSerializer.decodeTrade(encoded);

      expect(decoded.tradeId).toBe(sampleTrade.tradeId);
      expect(decoded.symbol).toBe(sampleTrade.symbol);
      expect(decoded.price.toString()).toBe(sampleTrade.price.toString());
      expect(decoded.quantity.toString()).toBe(sampleTrade.quantity.toString());
      expect(decoded.timestamp).toBe(sampleTrade.timestamp);
      expect(decoded.buyerId).toBe(sampleTrade.buyerId);
      expect(decoded.sellerId).toBe(sampleTrade.sellerId);
    });

    it('batch encodes and decodes TradeExecutions', () => {
      const trades = [
        sampleTrade,
        { ...sampleTrade, tradeId: 't-2', price: new Decimal('65001.00'), quantity: new Decimal('1.25') },
      ];
      const encoded = ProtocolSerializer.encodeTrades(trades);
      const decoded = ProtocolSerializer.decodeTrades(encoded);

      expect(decoded).toHaveLength(2);
      expect(decoded[0].tradeId).toBe('t-99999999-9999');
      expect(decoded[1].tradeId).toBe('t-2');
      expect(decoded[1].price.toString()).toBe('65001');
      expect(decoded[1].quantity.toString()).toBe('1.25');
    });

    it('serializes and deserializes an OrderBookSnapshot', () => {
      const encoded = ProtocolSerializer.encodeSnapshot(sampleSnapshot);
      const decoded = ProtocolSerializer.decodeSnapshot(encoded);

      expect(decoded.symbol).toBe('BTC-USD');
      expect(decoded.bids).toHaveLength(2);
      expect(decoded.asks).toHaveLength(2);
      expect(decoded.bids[0].price).toBe('65000.00');
      expect(decoded.asks[0].price).toBe('65010.00');
      expect(decoded.spread?.toString()).toBe('10');
      expect(decoded.midPrice?.toString()).toBe('65005');
      expect(decoded.timestamp).toBe(sampleSnapshot.timestamp);
    });

    it('serializes and deserializes EngineCommand and EngineResult RPC envelopes', () => {
      const cmd: EngineCommand = {
        correlationId: 'req-12345',
        action: 'SUBMIT_ORDER',
        symbol: 'BTC-USD',
        order: sampleOrder,
      };

      const cmdEncoded = ProtocolSerializer.encodeCommand(cmd);
      const cmdDecoded = ProtocolSerializer.decodeCommand(cmdEncoded);

      expect(cmdDecoded.correlationId).toBe('req-12345');
      expect(cmdDecoded.action).toBe('SUBMIT_ORDER');
      expect(cmdDecoded.symbol).toBe('BTC-USD');
      expect(cmdDecoded.order?.id).toBe(sampleOrder.id);
      expect(cmdDecoded.order?.price.toString()).toBe(sampleOrder.price.toString());

      const res: EngineResult = {
        correlationId: 'req-12345',
        success: true,
        trades: [sampleTrade],
        snapshot: sampleSnapshot,
      };

      const resEncoded = ProtocolSerializer.encodeResult(res);
      const resDecoded = ProtocolSerializer.decodeResult(resEncoded);

      expect(resDecoded.correlationId).toBe('req-12345');
      expect(resDecoded.success).toBe(true);
      expect(resDecoded.trades).toHaveLength(1);
      expect(resDecoded.trades![0].tradeId).toBe(sampleTrade.tradeId);
      expect(resDecoded.snapshot?.symbol).toBe('BTC-USD');
    });

    it('achieves smaller payload size compared to standard JSON', () => {
      const jsonStr = JSON.stringify(sampleOrder);
      const protoBuf = ProtocolSerializer.encodeOrder(sampleOrder);
      const jsonBytes = Buffer.byteLength(jsonStr, 'utf8');

      expect(protoBuf.length).toBeLessThan(jsonBytes);
    });
  });

  describe('ZeroCopyOrderCodec (Fixed Layout)', () => {
    it('encodes and decodes order within exact 156-byte buffer', () => {
      const buf = ZeroCopyOrderCodec.encode(sampleOrder);
      expect(buf.length).toBe(156);

      const decoded = ZeroCopyOrderCodec.decode(buf);
      expect(decoded.id).toBe(sampleOrder.id);
      expect(decoded.userId).toBe(sampleOrder.userId);
      expect(decoded.symbol).toBe(sampleOrder.symbol);
      expect(decoded.side).toBe(sampleOrder.side);
      expect(decoded.type).toBe(sampleOrder.type);
      expect(decoded.price.toNumber()).toBeCloseTo(sampleOrder.price.toNumber(), 6);
      expect(decoded.quantity.toNumber()).toBeCloseTo(sampleOrder.quantity.toNumber(), 6);
      expect(decoded.filledQuantity.toNumber()).toBeCloseTo(sampleOrder.filledQuantity.toNumber(), 6);
      expect(decoded.status).toBe(sampleOrder.status);
      expect(decoded.timestamp).toBe(sampleOrder.timestamp);
      expect(decoded.stopPrice?.toNumber()).toBeCloseTo(sampleOrder.stopPrice!.toNumber(), 6);
      expect(decoded.trailingDelta?.toNumber()).toBeCloseTo(sampleOrder.trailingDelta!.toNumber(), 6);
      expect(decoded.displayQty?.toNumber()).toBeCloseTo(sampleOrder.displayQty!.toNumber(), 6);
      expect(decoded.hiddenQty?.toNumber()).toBeCloseTo(sampleOrder.hiddenQty!.toNumber(), 6);
    });
  });
});
