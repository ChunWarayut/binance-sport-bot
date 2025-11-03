import { getBinanceClient } from './binanceClient';
import { OrderSide, OrderType } from '../../types';

export interface OrderRequest {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity?: number;
  quoteOrderQty?: number;
  price?: number;
  timeInForce?: 'GTC' | 'IOC' | 'FOK';
}

export interface OrderResult {
  orderId: number;
  symbol: string;
  status: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  price: number;
  executedQty: number;
  fills: Array<{
    price: number;
    qty: number;
    commission: number;
    commissionAsset: string;
  }>;
}

export class OrderManager {
  private client = getBinanceClient();

  /**
   * Place a market buy order
   */
  async marketBuy(symbol: string, quoteOrderQty: number): Promise<OrderResult> {
    return this.client.placeOrder({
      symbol,
      side: 'BUY',
      type: 'MARKET',
      quoteOrderQty,
    });
  }

  /**
   * Place a market sell order
   */
  async marketSell(symbol: string, quantity: number): Promise<OrderResult> {
    return this.client.placeOrder({
      symbol,
      side: 'SELL',
      type: 'MARKET',
      quantity,
    });
  }

  /**
   * Place a limit buy order
   */
  async limitBuy(symbol: string, quantity: number, price: number): Promise<OrderResult> {
    return this.client.placeOrder({
      symbol,
      side: 'BUY',
      type: 'LIMIT',
      quantity,
      price,
      timeInForce: 'GTC',
    });
  }

  /**
   * Place a limit sell order
   */
  async limitSell(symbol: string, quantity: number, price: number): Promise<OrderResult> {
    return this.client.placeOrder({
      symbol,
      side: 'SELL',
      type: 'LIMIT',
      quantity,
      price,
      timeInForce: 'GTC',
    });
  }

  /**
   * Place a custom order
   */
  async placeOrder(request: OrderRequest): Promise<OrderResult> {
    return this.client.placeOrder(request);
  }

  /**
   * Get order status
   */
  async getOrderStatus(symbol: string, orderId: number) {
    return this.client.getOrder(symbol, orderId);
  }

  /**
   * Cancel an order
   */
  async cancelOrder(symbol: string, orderId: number) {
    return this.client.cancelOrder(symbol, orderId);
  }

  /**
   * Get all open orders for a symbol
   */
  async getOpenOrders(symbol?: string) {
    return this.client.getOpenOrders(symbol);
  }

  /**
   * Calculate order quantity based on percentage of balance
   */
  async calculateQuantityFromPercent(symbol: string, percent: number): Promise<number> {
    const balance = await this.client.getBalance('USDT');
    if (!balance || balance.free === 0) {
      throw new Error('Insufficient USDT balance');
    }

    const price = await this.client.getPrice(symbol);
    const orderValue = (balance.free * percent) / 100;
    const quantity = orderValue / price;

    // Round down to appropriate precision
    return Math.floor(quantity * 100000000) / 100000000;
  }
}

// Singleton instance
let orderManagerInstance: OrderManager | null = null;

export function getOrderManager(): OrderManager {
  if (!orderManagerInstance) {
    orderManagerInstance = new OrderManager();
  }
  return orderManagerInstance;
}
