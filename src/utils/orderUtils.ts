import { OrderResult } from '../services/binance/orderManager';
import { getBinanceClient } from '../services/binance/binanceClient';

/**
 * Safely extract executed price from an order result.
 * Priority: weighted avg from fills -> explicit price -> 0 (caller must validate > 0)
 */
export function extractExecutedPrice(order: OrderResult): number {
  try {
    const fills = order.fills || [];
    const executedQty = Number(order.executedQty || 0);

    if (fills.length > 0 && executedQty > 0) {
      const totalValue = fills.reduce((sum, f) => sum + Number(f.price) * Number(f.qty), 0);
      const avg = totalValue / executedQty;
      if (isFinite(avg) && avg > 0) return avg;
    }

    const price = Number(order.price || 0);
    if (isFinite(price) && price > 0) return price;
  } catch {
    // ignore, fall through
  }
  return 0;
}

/**
 * Extract executed price and qty in a single call (used by strategies)
 */
export function extractExecutedFromResult(order: OrderResult): { price: number; qty: number } {
  const price = extractExecutedPrice(order);
  const qty = Number(order.executedQty || order.quantity || 0);
  return { price, qty: isFinite(qty) ? qty : 0 };
}

/**
 * Resolve executed price/qty by querying Binance (fallback if local data invalid)
 */
export async function resolveExecutedFromExchange(params: {
  orderId: number;
  symbol: string;
  price?: number;
  executedQty?: number;
}): Promise<{ price: number; qty: number }> {
  const client = getBinanceClient();
  try {
    const data = await client.getOrder(params.symbol, params.orderId);
    const executedQty = Number(data.executedQty || 0);
    let price = Number(data.price || 0);

    // If price not present, derive average from cummulativeQuoteQty / executedQty
    if ((!isFinite(price) || price <= 0) && executedQty > 0) {
      const cq = Number(data.cummulativeQuoteQty || 0);
      if (isFinite(cq) && cq > 0) {
        price = cq / executedQty;
      }
    }

    return {
      price: isFinite(price) && price > 0 ? price : (params.price || 0),
      qty: isFinite(executedQty) && executedQty > 0 ? executedQty : (params.executedQty || 0),
    };
  } catch {
    return {
      price: params.price || 0,
      qty: params.executedQty || 0,
    };
  }
}

/**
 * Ensure numeric to fixed string up to 8 decimals (no trailing zeros).
 */
export function toDbNumberString(value: number): string {
  if (!isFinite(value)) return '0';
  const rounded = Math.round(value * 1e8) / 1e8;
  let s = rounded.toFixed(8);
  if (s.includes('.')) {
    s = s.replace(/0+$/, '').replace(/\.$/, '');
  }
  return s;
}

import { getOrderManager } from '../services/binance/orderManager';

type Fill = { price: number; qty: number; commission: number; commissionAsset: string };

export interface ExecutedLike {
  price?: number | string;
  executedQty?: number | string;
  fills?: Fill[];
  orderId?: number;
  symbol?: string;
}

/**
 * Safely extract executed average price and quantity from an order-like result.
 * Prefers weighted average from fills; falls back to explicit price when needed.
 */
export function extractExecutedFromResult(result: ExecutedLike): { price: number; qty: number } {
  let qty = 0;
  let price = 0;

  if (Array.isArray(result.fills) && result.fills.length > 0) {
    const totalValue = result.fills.reduce((sum, f) => sum + (Number(f.price) * Number(f.qty)), 0);
    const totalQty = result.fills.reduce((sum, f) => sum + Number(f.qty), 0);
    if (totalQty > 0) {
      qty = totalQty;
      price = totalValue / totalQty;
    }
  }

  if ((!isFinite(price) || price <= 0) && result.price !== undefined) {
    const p = Number(result.price);
    if (isFinite(p) && p > 0) price = p;
  }

  if ((!isFinite(qty) || qty <= 0) && result.executedQty !== undefined) {
    const q = Number(result.executedQty);
    if (isFinite(q) && q > 0) qty = q;
  }

  return { price, qty };
}

/**
 * Best-effort retrieval of executed price by querying the exchange if needed.
 * Requires symbol and orderId to be present.
 */
export async function resolveExecutedFromExchange(result: ExecutedLike): Promise<{ price: number; qty: number }> {
  const { price, qty } = extractExecutedFromResult(result);
  if (isFinite(price) && price > 0 && isFinite(qty) && qty > 0) return { price, qty };

  if (!result.symbol || !result.orderId) return { price: price || 0, qty: qty || 0 };

  try {
    const orderManager = getOrderManager();
    const order = await orderManager.getOrderStatus(result.symbol, result.orderId);
    // Binance order structure: fills might not be present; try cummulativeQuoteQty and executedQty
    const executedQty = Number(order.executedQty || 0);
    let executedPrice = 0;
    if (executedQty > 0) {
      const cqq = Number(order.cummulativeQuoteQty || 0);
      if (isFinite(cqq) && cqq > 0) executedPrice = cqq / executedQty;
    }
    return { price: executedPrice || price || 0, qty: executedQty || qty || 0 };
  } catch {
    return { price: price || 0, qty: qty || 0 };
  }
}

/**
 * Recalculate PnL given entry and executed values. Returns { pnl, pnlPercent }.
 */
export function calculatePnl(entryPrice: number, exitPrice: number, quantity: number): { pnl: number; pnlPercent: number } {
  const pnl = (exitPrice - entryPrice) * quantity;
  const pnlPercent = entryPrice > 0 ? ((exitPrice - entryPrice) / entryPrice) * 100 : 0;
  return { pnl, pnlPercent };
}


