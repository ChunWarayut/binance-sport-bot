import { getBinanceClient } from '../binance/binanceClient';
import { config } from '../../utils/config';
import { getRiskCalculator } from './riskCalculator';

export interface PositionSizeResult {
  quantity: number;
  value: number;
  percentage: number;
}

export class PositionSizer {
  private client = getBinanceClient();
  private riskCalculator = getRiskCalculator();

  /**
   * Calculate position size based on risk percentage
   */
  async calculatePositionSize(
    symbol: string,
    price: number,
    riskPercent: number = config.risk.maxPositionSizePercent
  ): Promise<PositionSizeResult> {
    // Get account balance
    const balance = await this.client.getBalance('USDT');
    if (!balance || balance.free === 0) {
      throw new Error('Insufficient USDT balance');
    }

    // Calculate position value
    const positionValue = (balance.free * riskPercent) / 100;

    // Calculate quantity
    const quantity = positionValue / price;

    // Round down to appropriate precision (8 decimal places for crypto)
    const roundedQuantity = Math.floor(quantity * 100000000) / 100000000;

    return {
      quantity: roundedQuantity,
      value: positionValue,
      percentage: riskPercent,
    };
  }

  /**
   * Calculate position size with risk management limits
   */
  async calculateSafePositionSize(
    userId: string,
    symbol: string,
    price: number,
    requestedPercent?: number
  ): Promise<PositionSizeResult> {
    // Get risk limits
    const limits = await this.riskCalculator.getRiskLimits(userId);

    // Use requested percent or default to max allowed
    const riskPercent = requestedPercent || limits.maxPositionSizePercent;

    // Don't exceed maximum
    const finalRiskPercent = Math.min(riskPercent, limits.maxPositionSizePercent);

    return this.calculatePositionSize(symbol, price, finalRiskPercent);
  }

  /**
   * Calculate quantity from USDT amount
   */
  calculateQuantityFromUSDT(symbol: string, price: number, usdtAmount: number): number {
    const quantity = usdtAmount / price;
    // Round down to appropriate precision
    return Math.floor(quantity * 100000000) / 100000000;
  }

  /**
   * Calculate USDT amount from quantity
   */
  calculateUSDTFromQuantity(symbol: string, price: number, quantity: number): number {
    return quantity * price;
  }
}

// Singleton instance
let positionSizerInstance: PositionSizer | null = null;

export function getPositionSizer(): PositionSizer {
  if (!positionSizerInstance) {
    positionSizerInstance = new PositionSizer();
  }
  return positionSizerInstance;
}
