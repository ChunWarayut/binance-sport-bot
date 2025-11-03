import { config } from '../../utils/config';
import { db } from '../../db';
import { positions, trades, riskLimits } from '../../db/schema';
import { eq, and, gte, lte, sum } from 'drizzle-orm';
import { getBinanceClient } from '../binance/binanceClient';

export interface RiskCheckResult {
  allowed: boolean;
  reason?: string;
  riskLevel: 'low' | 'medium' | 'high';
}

export class RiskCalculator {
  private client = getBinanceClient();

  /**
   * Check if a trade is within risk limits
   */
  async checkTradeRisk(
    userId: string,
    symbol: string,
    quantity: number,
    price: number,
    side: 'BUY' | 'SELL'
  ): Promise<RiskCheckResult> {
    try {
      // Get risk limits for user
      const limits = await this.getRiskLimits(userId);

      // Check position size
      const positionSizeCheck = await this.checkPositionSize(
        userId,
        symbol,
        quantity,
        price,
        limits
      );
      if (!positionSizeCheck.allowed) {
        return positionSizeCheck;
      }

      // Check concurrent positions
      const concurrentCheck = await this.checkConcurrentPositions(userId, limits);
      if (!concurrentCheck.allowed) {
        return concurrentCheck;
      }

      // Check daily loss limit
      const dailyLossCheck = await this.checkDailyLossLimit(userId, limits);
      if (!dailyLossCheck.allowed) {
        return dailyLossCheck;
      }

      // Check correlation (avoid similar positions)
      const correlationCheck = await this.checkCorrelation(userId, symbol);
      if (!correlationCheck.allowed) {
        return correlationCheck;
      }

      return {
        allowed: true,
        riskLevel: 'medium', // Default to medium for approved trades
      };
    } catch (error) {
      console.error('Error checking trade risk:', error);
      return {
        allowed: false,
        reason: String(error),
        riskLevel: 'high',
      };
    }
  }

  /**
   * Check if position size is within limits
   */
  private async checkPositionSize(
    userId: string,
    symbol: string,
    quantity: number,
    price: number,
    limits: any
  ): Promise<RiskCheckResult> {
    const positionValue = quantity * price;

    // Get account balance
    const balance = await this.client.getBalance('USDT');
    if (!balance || balance.total === 0) {
      return {
        allowed: false,
        reason: 'Insufficient balance',
        riskLevel: 'high',
      };
    }

    const positionPercent = (positionValue / balance.total) * 100;

    if (positionPercent > limits.maxPositionSizePercent) {
      return {
        allowed: false,
        reason: `Position size ${positionPercent.toFixed(2)}% exceeds maximum ${limits.maxPositionSizePercent}%`,
        riskLevel: 'high',
      };
    }

    return { allowed: true, riskLevel: 'medium' };
  }

  /**
   * Check concurrent positions limit
   */
  private async checkConcurrentPositions(
    userId: string,
    limits: any
  ): Promise<RiskCheckResult> {
    // Get all open positions for user's strategies
    const openPositions = await db
      .select()
      .from(positions)
      .where(eq(positions.isOpen, true));

    if (openPositions.length >= limits.maxConcurrentPositions) {
      return {
        allowed: false,
        reason: `Maximum concurrent positions (${limits.maxConcurrentPositions}) reached`,
        riskLevel: 'high',
      };
    }

    return { allowed: true, riskLevel: 'medium' };
  }

  /**
   * Check daily loss limit
   */
  private async checkDailyLossLimit(
    userId: string,
    limits: any
  ): Promise<RiskCheckResult> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get today's trades
    const todayTrades = await db
      .select()
      .from(trades)
      .where(gte(trades.executedAt, today));

    // Calculate total PnL for today
    const todayPnL = todayTrades.reduce((sum, trade) => {
      return sum + parseFloat(trade.pnl || '0');
    }, 0);

    // Get account balance
    const balance = await this.client.getBalance('USDT');
    if (!balance || balance.total === 0) {
      return { allowed: true, riskLevel: 'medium' }; // Can't calculate if no balance
    }

    const lossPercent = (Math.abs(Math.min(0, todayPnL)) / balance.total) * 100;

    if (lossPercent >= limits.dailyLossLimitPercent) {
      return {
        allowed: false,
        reason: `Daily loss limit (${limits.dailyLossLimitPercent}%) exceeded: ${lossPercent.toFixed(2)}%`,
        riskLevel: 'high',
      };
    }

    return { allowed: true, riskLevel: 'medium' };
  }

  /**
   * Check correlation (avoid multiple positions in correlated assets)
   */
  private async checkCorrelation(
    userId: string,
    symbol: string
  ): Promise<RiskCheckResult> {
    // Get base asset (e.g., BTC from BTCUSDT)
    const baseAsset = symbol.replace('USDT', '');

    // Get all open positions
    const openPositions = await db
      .select()
      .from(positions)
      .where(eq(positions.isOpen, true));

    // Check if we already have a position in this base asset
    const existingPosition = openPositions.find(
      p => p.symbol === symbol || p.symbol.replace('USDT', '') === baseAsset
    );

    if (existingPosition) {
      // Allow if it's the same symbol (could be adding to position)
      if (existingPosition.symbol === symbol) {
        return { allowed: true, riskLevel: 'medium' };
      }

      // For different symbols but same base asset, consider it correlated
      // For now, we allow but flag as medium risk
      return {
        allowed: true,
        reason: `Position in correlated asset detected`,
        riskLevel: 'medium',
      };
    }

    return { allowed: true, riskLevel: 'low' };
  }

  /**
   * Get risk limits for user
   */
  async getRiskLimits(userId: string) {
    const [limits] = await db
      .select()
      .from(riskLimits)
      .where(eq(riskLimits.userId, userId))
      .limit(1);

    if (!limits) {
      // Return default limits
      return {
        maxPositionSizePercent: config.risk.maxPositionSizePercent,
        stopLossPercent: config.risk.stopLossPercent,
        takeProfitPercent: config.risk.takeProfitPercent,
        dailyLossLimitPercent: config.risk.dailyLossLimitPercent,
        maxConcurrentPositions: config.risk.maxConcurrentPositions,
      };
    }

    return {
      maxPositionSizePercent: parseFloat(limits.maxPositionSizePercent || config.risk.maxPositionSizePercent.toString()),
      stopLossPercent: parseFloat(limits.stopLossPercent || config.risk.stopLossPercent.toString()),
      takeProfitPercent: parseFloat(limits.takeProfitPercent || config.risk.takeProfitPercent.toString()),
      dailyLossLimitPercent: parseFloat(limits.dailyLossLimitPercent || config.risk.dailyLossLimitPercent.toString()),
      maxConcurrentPositions: limits.maxConcurrentPositions || config.risk.maxConcurrentPositions,
    };
  }

  /**
   * Calculate stop loss price
   */
  calculateStopLoss(entryPrice: number, stopLossPercent: number): number {
    return entryPrice * (1 - stopLossPercent / 100);
  }

  /**
   * Calculate take profit price
   */
  calculateTakeProfit(entryPrice: number, takeProfitPercent: number): number {
    return entryPrice * (1 + takeProfitPercent / 100);
  }
}

// Singleton instance
let riskCalculatorInstance: RiskCalculator | null = null;

export function getRiskCalculator(): RiskCalculator {
  if (!riskCalculatorInstance) {
    riskCalculatorInstance = new RiskCalculator();
  }
  return riskCalculatorInstance;
}
