import { db } from '../../db';
import { positions, trades } from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import { getBinanceClient } from '../binance/binanceClient';
import { getOrderManager } from '../binance/orderManager';
import { getRiskCalculator } from './riskCalculator';
import { extractExecutedFromResult, resolveExecutedFromExchange } from '../../utils/orderUtils';

export class StopLossManager {
  private client = getBinanceClient();
  private orderManager = getOrderManager();
  private riskCalculator = getRiskCalculator();

  /**
   * Update stop loss and take profit for a position
   */
  async updateStopLossTakeProfit(
    positionId: string,
    stopLossPercent?: number,
    takeProfitPercent?: number
  ): Promise<void> {
    const [position] = await db
      .select()
      .from(positions)
      .where(eq(positions.id, positionId))
      .limit(1);

    if (!position || !position.isOpen) {
      throw new Error('Position not found or not open');
    }

    const entryPrice = parseFloat(position.entryPrice);
    const updates: any = {};

    if (stopLossPercent !== undefined) {
      const stopLoss = this.riskCalculator.calculateStopLoss(entryPrice, stopLossPercent);
      updates.stopLoss = stopLoss.toString();
    }

    if (takeProfitPercent !== undefined) {
      const takeProfit = this.riskCalculator.calculateTakeProfit(entryPrice, takeProfitPercent);
      updates.takeProfit = takeProfit.toString();
    }

    if (Object.keys(updates).length > 0) {
      await db
        .update(positions)
        .set(updates)
        .where(eq(positions.id, positionId));
    }
  }

  /**
   * Check and execute stop loss/take profit orders
   */
  async checkAndExecuteStopLosses(): Promise<void> {
    // Get all open positions
    const openPositions = await db
      .select()
      .from(positions)
      .where(eq(positions.isOpen, true));

    for (const position of openPositions) {
      try {
        const currentPrice = await this.client.getPrice(position.symbol);
        const entryPrice = parseFloat(position.entryPrice);

        // Check stop loss
        if (position.stopLoss) {
          const stopLossPrice = parseFloat(position.stopLoss);
          if (currentPrice <= stopLossPrice) {
            await this.executeStopLoss(position.id);
            continue;
          }
        }

        // Check take profit
        if (position.takeProfit) {
          const takeProfitPrice = parseFloat(position.takeProfit);
          if (currentPrice >= takeProfitPrice) {
            await this.executeTakeProfit(position.id);
            continue;
          }
        }

        // Update current price and unrealized PnL
        const pnl = (currentPrice - entryPrice) * parseFloat(position.quantity);
        const pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100;

        await db
          .update(positions)
          .set({
            currentPrice: currentPrice.toString(),
            unrealizedPnl: pnl.toString(),
            unrealizedPnlPercent: pnlPercent.toString(),
          })
          .where(eq(positions.id, position.id));
      } catch (error) {
        console.error(`Error checking stop loss for position ${position.id}:`, error);
      }
    }
  }

  /**
   * Execute stop loss
   */
  private async executeStopLoss(positionId: string): Promise<void> {
    const [position] = await db
      .select()
      .from(positions)
      .where(eq(positions.id, positionId))
      .limit(1);

    if (!position || !position.isOpen) {
      return;
    }

    try {
      const quantity = parseFloat(position.quantity);

      // Place market sell order
      const result = await this.orderManager.marketSell(position.symbol, quantity);
      let { price: executedPrice } = extractExecutedFromResult(result);
      if (!isFinite(executedPrice) || executedPrice <= 0) {
        ({ price: executedPrice } = await resolveExecutedFromExchange({
          price: executedPrice,
          orderId: result.orderId,
          symbol: position.symbol,
        }));
      }
      const entryPrice = parseFloat(position.entryPrice);
      const pnl = (executedPrice - entryPrice) * quantity;
      const pnlPercent = ((executedPrice - entryPrice) / entryPrice) * 100;

      // Calculate fees
      const fee = result.fills.reduce((sum, fill) => sum + fill.commission, 0);
      const feeAsset = result.fills[0]?.commissionAsset || position.symbol.replace('USDT', '');

      // Save trade
      // Note: This should be done by the strategy, but we'll do it here for safety
      await db.insert(trades).values({
        positionId: position.id,
        strategyId: position.strategyId,
        symbol: position.symbol,
        side: 'SELL',
        orderType: 'MARKET',
        quantity: quantity.toString(),
        price: executedPrice.toString(),
        fee: fee.toString(),
        feeAsset,
        pnl: (pnl - fee).toString(),
        pnlPercent: pnlPercent.toString(),
        binanceOrderId: result.orderId.toString(),
        status: 'FILLED',
      });

      // Close position
      await db
        .update(positions)
        .set({
          isOpen: false,
          closedAt: new Date(),
          currentPrice: executedPrice.toString(),
          unrealizedPnl: '0',
          unrealizedPnlPercent: '0',
        })
        .where(eq(positions.id, positionId));

      console.log(`Stop loss executed for position ${positionId} at ${executedPrice}`);
    } catch (error) {
      console.error(`Error executing stop loss for position ${positionId}:`, error);
      throw error;
    }
  }

  /**
   * Execute take profit
   */
  private async executeTakeProfit(positionId: string): Promise<void> {
    const [position] = await db
      .select()
      .from(positions)
      .where(eq(positions.id, positionId))
      .limit(1);

    if (!position || !position.isOpen) {
      return;
    }

    try {
      const quantity = parseFloat(position.quantity);

      // Place market sell order
      const result = await this.orderManager.marketSell(position.symbol, quantity);
      let { price: executedPrice } = extractExecutedFromResult(result);
      if (!isFinite(executedPrice) || executedPrice <= 0) {
        ({ price: executedPrice } = await resolveExecutedFromExchange({
          price: executedPrice,
          orderId: result.orderId,
          symbol: position.symbol,
        }));
      }
      const entryPrice = parseFloat(position.entryPrice);
      const pnl = (executedPrice - entryPrice) * quantity;
      const pnlPercent = ((executedPrice - entryPrice) / entryPrice) * 100;

      // Calculate fees
      const fee = result.fills.reduce((sum, fill) => sum + fill.commission, 0);
      const feeAsset = result.fills[0]?.commissionAsset || position.symbol.replace('USDT', '');

      // Close position
      await db
        .update(positions)
        .set({
          isOpen: false,
          closedAt: new Date(),
          currentPrice: executedPrice.toString(),
          unrealizedPnl: '0',
          unrealizedPnlPercent: '0',
        })
        .where(eq(positions.id, positionId));

      console.log(`Take profit executed for position ${positionId} at ${executedPrice} (${pnlPercent.toFixed(2)}%)`);
    } catch (error) {
      console.error(`Error executing take profit for position ${positionId}:`, error);
      throw error;
    }
  }
}

// Singleton instance
let stopLossManagerInstance: StopLossManager | null = null;

export function getStopLossManager(): StopLossManager {
  if (!stopLossManagerInstance) {
    stopLossManagerInstance = new StopLossManager();
  }
  return stopLossManagerInstance;
}
