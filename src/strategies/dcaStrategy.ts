import { BaseStrategy, StrategyConfig, StrategyResult } from './baseStrategy';
import { StrategyType, TradingPair } from '../types';
import { getBinanceClient } from '../services/binance/binanceClient';
import { getOrderManager } from '../services/binance/orderManager';
import { db } from '../db';
import { eq } from 'drizzle-orm';
import { extractExecutedFromResult, resolveExecutedFromExchange } from '../utils/orderUtils';
import { positions } from '../db/schema';

export interface DCAStrategyConfig extends StrategyConfig {
  symbol?: string;
  amountPerPurchase: number; // USDT amount per DCA purchase
  purchaseInterval: number; // Time interval in milliseconds (e.g., 1 hour = 3600000)
  maxPurchases: number; // Maximum number of DCA purchases
  takeProfitPercent: number; // Take profit percentage (e.g., 5 for 5%)
  stopLossPercent?: number; // Optional stop loss percentage
  lastPurchaseTime?: number; // Timestamp of last purchase (internal)
}

export class DCAStrategy extends BaseStrategy {
  private config: DCAStrategyConfig;
  private client = getBinanceClient();
  private orderManager = getOrderManager();

  constructor(id: string, name: string, config: DCAStrategyConfig) {
    super(id, 'dca', name, config);
    // Merge symbol into config if provided
    this.config = {
      ...config,
      symbol: config.symbol || (config as any).symbol,
      lastPurchaseTime: config.lastPurchaseTime || 0,
    };
  }
  
  public getConfig(): DCAStrategyConfig {
    return this.config;
  }

  async initialize(): Promise<void> {
    try {
      // Load last purchase time from database if available
      const strategy = await this.getStrategyFromDb();
      if (strategy) {
        const dbConfig = strategy.config as DCAStrategyConfig;
        this.config.lastPurchaseTime = dbConfig.lastPurchaseTime || 0;
      }
    } catch (error) {
      console.error(`DCA Strategy initialization error:`, error);
      // Don't throw - can proceed without last purchase time
    }
  }

  async execute(pair?: TradingPair): Promise<StrategyResult> {
    const symbol = this.config.symbol || pair?.symbol;
    if (!symbol) {
      return { success: false, message: 'No symbol specified' };
    }

    try {
      // Check if it's time for next purchase
      const now = Date.now();
      const timeSinceLastPurchase = now - (this.config.lastPurchaseTime || 0);

      if (timeSinceLastPurchase < this.config.purchaseInterval) {
        return { success: true, message: 'Waiting for next purchase interval' };
      }

      // Get current positions to count purchases
      const openPositions = await this.getOpenPositions();
      const totalPositions = openPositions.length;

      if (totalPositions >= this.config.maxPurchases) {
        return { success: false, message: 'Maximum purchases reached' };
      }

      // Check if we should take profit on existing positions
      const exitResult = await this.checkAndExitPositions(symbol);
      if (exitResult) {
        return exitResult;
      }

      // Execute DCA purchase
      return await this.executeDCAPurchase(symbol);
    } catch (error) {
      console.error(`Error in DCA Strategy execution:`, error);
      return { success: false, message: String(error) };
    }
  }

  private async executeDCAPurchase(symbol: string): Promise<StrategyResult> {
    try {
      // Place market buy order
      const result = await this.orderManager.marketBuy(symbol, this.config.amountPerPurchase);
      let { price: executedPrice, qty: executedQty } = extractExecutedFromResult(result);
      if (!isFinite(executedPrice) || executedPrice <= 0 || !isFinite(executedQty) || executedQty <= 0) {
        ({ price: executedPrice, qty: executedQty } = await resolveExecutedFromExchange({
          price: executedPrice,
          executedQty,
          orderId: result.orderId,
          symbol,
        }));
      }

      // Calculate fees
      const fee = result.fills.reduce((sum, fill) => sum + fill.commission, 0);
      const feeAsset = result.fills[0]?.commissionAsset || 'USDT';

      // Create position
      const position = await this.createPosition({
        symbol,
        side: 'BUY',
        quantity: executedQty,
        entryPrice: executedPrice,
        takeProfit: this.calculateTakeProfit(executedPrice),
        stopLoss: this.config.stopLossPercent 
          ? this.calculateStopLoss(executedPrice)
          : undefined,
      });

      // Save trade
      await this.saveTrade({
        positionId: position.id,
        symbol,
        side: 'BUY',
        orderType: 'MARKET',
        quantity: executedQty,
        price: executedPrice,
        fee,
        feeAsset,
        binanceOrderId: result.orderId.toString(),
        status: 'FILLED',
      });

      // Update last purchase time
      this.config.lastPurchaseTime = Date.now();
      await this.updateConfig(this.config);

      return {
        success: true,
        message: `DCA purchase executed at ${executedPrice}`,
        orderId: result.orderId,
        positionId: position.id,
      };
    } catch (error) {
      console.error(`Error executing DCA purchase:`, error);
      return { success: false, message: String(error) };
    }
  }

  private async checkAndExitPositions(symbol: string): Promise<StrategyResult | null> {
    const openPositions = await this.getOpenPositions();
    const symbolPositions = openPositions.filter(p => p.symbol === symbol);

    for (const position of symbolPositions) {
      const shouldExit = await this.shouldExit(position.id);
      
      if (shouldExit) {
        return await this.exitPosition(position.id);
      }
    }

    return null;
  }

  private async exitPosition(positionId: string): Promise<StrategyResult> {
    try {
      const [position] = await db
        .select()
        .from(positions)
        .where(eq(positions.id, positionId))
        .limit(1);

      if (!position || !position.isOpen) {
        return { success: false, message: 'Position not found or already closed' };
      }

      const quantity = parseFloat(position.quantity);

      // Place market sell order
      const result = await this.orderManager.marketSell(position.symbol, quantity);
      let { price: executedPrice, qty: executedQty } = extractExecutedFromResult(result);
      if (!isFinite(executedPrice) || executedPrice <= 0 || !isFinite(executedQty) || executedQty <= 0) {
        ({ price: executedPrice, qty: executedQty } = await resolveExecutedFromExchange({
          price: executedPrice,
          executedQty,
          orderId: result.orderId,
          symbol: position.symbol,
        }));
      }

      // Calculate PnL
      const entryPrice = parseFloat(position.entryPrice);
      const pnl = (executedPrice - entryPrice) * executedQty;
      const pnlPercent = ((executedPrice - entryPrice) / entryPrice) * 100;

      // Calculate fees
      const fee = result.fills.reduce((sum, fill) => sum + fill.commission, 0);
      const feeAsset = result.fills[0]?.commissionAsset || position.symbol.replace('USDT', '');

      // Save trade
      await this.saveTrade({
        positionId: position.id,
        symbol: position.symbol,
        side: 'SELL',
        orderType: 'MARKET',
        quantity: executedQty,
        price: executedPrice,
        fee,
        feeAsset,
        pnl: pnl - fee,
        pnlPercent,
        binanceOrderId: result.orderId.toString(),
        status: 'FILLED',
      });

      // Close position
      await this.closePosition(positionId, executedPrice);

      return {
        success: true,
        message: `Position closed with ${pnlPercent.toFixed(2)}% PnL`,
        orderId: result.orderId,
        positionId,
      };
    } catch (error) {
      console.error(`Error exiting position:`, error);
      return { success: false, message: String(error) };
    }
  }

  private calculateTakeProfit(entryPrice: number): number {
    return entryPrice * (1 + this.config.takeProfitPercent / 100);
  }

  private calculateStopLoss(entryPrice: number): number {
    if (!this.config.stopLossPercent) return entryPrice;
    return entryPrice * (1 - this.config.stopLossPercent / 100);
  }

  async shouldEnter(pair: TradingPair): Promise<boolean> {
    // DCA enters on schedule, not based on signals
    const now = Date.now();
    const timeSinceLastPurchase = now - (this.config.lastPurchaseTime || 0);
    return timeSinceLastPurchase >= this.config.purchaseInterval;
  }

  async shouldExit(positionId: string): Promise<boolean> {
    try {
      const [position] = await db
        .select()
        .from(positions)
        .where(eq(positions.id, positionId))
        .limit(1);

      if (!position || !position.isOpen) {
        return false;
      }

      const currentPrice = await this.client.getPrice(position.symbol);
      const entryPrice = parseFloat(position.entryPrice);

      // Check take profit
      if (position.takeProfit) {
        const takeProfitPrice = parseFloat(position.takeProfit);
        if (currentPrice >= takeProfitPrice) {
          return true;
        }
      }

      // Check stop loss
      if (position.stopLoss) {
        const stopLossPrice = parseFloat(position.stopLoss);
        if (currentPrice <= stopLossPrice) {
          return true;
        }
      }

      // Check if average entry price across all positions has hit take profit
      const allPositions = await this.getOpenPositions();
      const symbolPositions = allPositions.filter(p => p.symbol === position.symbol);
      
      if (symbolPositions.length > 0) {
        let totalValue = 0;
        let totalQuantity = 0;

        for (const pos of symbolPositions) {
          const qty = parseFloat(pos.quantity);
          const entry = parseFloat(pos.entryPrice);
          totalValue += entry * qty;
          totalQuantity += qty;
        }

        const averageEntryPrice = totalValue / totalQuantity;
        const profitPercent = ((currentPrice - averageEntryPrice) / averageEntryPrice) * 100;

        // Exit all positions if average profit hits target
        if (profitPercent >= this.config.takeProfitPercent) {
          return true;
        }
      }

      return false;
    } catch (error) {
      console.error(`Error checking exit condition:`, error);
      return false;
    }
  }
}
