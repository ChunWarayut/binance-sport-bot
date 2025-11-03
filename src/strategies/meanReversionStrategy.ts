import { BaseStrategy, StrategyConfig, StrategyResult } from './baseStrategy';
import { StrategyType, TradingPair } from '../types';
import { getBinanceClient } from '../services/binance/binanceClient';
import { getOrderManager } from '../services/binance/orderManager';
import { db } from '../db';
import {
  calculateRSI,
  calculateBollingerBands,
  calculateSMA,
  calculateSupportResistance,
  KlineData,
} from '../services/analysis/technicalIndicators';
import { eq } from 'drizzle-orm';
import { extractExecutedFromResult, resolveExecutedFromExchange } from '../utils/orderUtils';
import { positions } from '../db/schema';

export interface MeanReversionStrategyConfig extends StrategyConfig {
  symbol?: string;
  rsiPeriod: number; // RSI period (default 14)
  rsiOversold: number; // RSI oversold threshold (default 30)
  rsiOverbought: number; // RSI overbought threshold (default 70)
  bollingerPeriod: number; // Bollinger Bands period (default 20)
  bollingerStdDev: number; // Bollinger Bands standard deviation (default 2)
  smaPeriod: number; // SMA period for mean calculation (default 20)
  positionSizePercent: number; // Position size as % of balance (default 5)
  takeProfitPercent: number; // Take profit percentage (revert to mean)
  stopLossPercent: number; // Stop loss percentage
  minRevertDistance: number; // Minimum distance from mean to enter (default 2%)
}

export class MeanReversionStrategy extends BaseStrategy {
  private config: MeanReversionStrategyConfig;
  private client = getBinanceClient();
  private orderManager = getOrderManager();

  constructor(id: string, name: string, config: MeanReversionStrategyConfig) {
    super(id, 'mean_reversion', name, config);
    // Merge defaults with provided config
    const defaults = {
      rsiPeriod: 14,
      rsiOversold: 30,
      rsiOverbought: 70,
      bollingerPeriod: 20,
      bollingerStdDev: 2,
      smaPeriod: 20,
      positionSizePercent: 5,
      takeProfitPercent: 2,
      stopLossPercent: 3,
      minRevertDistance: 1,
    };
    // Merge symbol into config if provided
    this.config = { 
      ...defaults, 
      ...config,
      symbol: config.symbol || (config as any).symbol,
    };
  }
  
  public getConfig(): MeanReversionStrategyConfig {
    return this.config;
  }

  async initialize(): Promise<void> {
    // Initialization complete
  }

  async execute(pair?: TradingPair): Promise<StrategyResult> {
    const symbol = this.config.symbol || pair?.symbol;
    if (!symbol) {
      return { success: false, message: 'No symbol specified' };
    }

    try {
      // Get technical indicators
      const indicators = await this.getTechnicalIndicators(symbol);

      // Check if we have an open position
      const openPositions = await this.getOpenPositions();
      const symbolPosition = openPositions.find(p => p.symbol === symbol);

      if (symbolPosition) {
        // Check exit conditions
        const shouldExit = await this.shouldExit(symbolPosition.id);
        if (shouldExit) {
          return await this.exitPosition(symbolPosition.id);
        }

        return { success: true, message: 'Position held, exit conditions checked' };
      }

      // Check entry conditions (mean reversion: buy when oversold)
      const shouldEnter = await this.shouldEnter(pair || { symbol, baseAsset: '', quoteAsset: 'USDT', price: indicators.currentPrice, volume24h: 0 });
      
      if (shouldEnter) {
        return await this.enterPosition(symbol, indicators);
      }

      return { success: true, message: 'Entry conditions not met' };
    } catch (error) {
      console.error(`Error in Mean Reversion Strategy execution:`, error);
      return { success: false, message: String(error) };
    }
  }

  private async getTechnicalIndicators(symbol: string) {
    // Get kline data
    const klines = await this.client.getKlines(symbol, '1h', 100);
    const klineData: KlineData[] = klines.map(k => ({
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close,
      volume: k.volume,
      timestamp: k.openTime,
    }));

    const prices = klineData.map(k => k.close);
    const currentPrice = prices[prices.length - 1];

    // Calculate indicators
    const rsi = calculateRSI(prices, this.config.rsiPeriod);
    const bollinger = calculateBollingerBands(prices, this.config.bollingerPeriod, this.config.bollingerStdDev);
    const sma = calculateSMA(prices, this.config.smaPeriod);
    const { support, resistance } = calculateSupportResistance(klineData);

    const lastRSI = rsi[rsi.length - 1];
    const lastBBUpper = bollinger.upper[bollinger.upper.length - 1];
    const lastBBMiddle = bollinger.middle[bollinger.middle.length - 1];
    const lastBBLower = bollinger.lower[bollinger.lower.length - 1];
    const lastSMA = sma[sma.length - 1];

    // Calculate distance from mean
    const meanPrice = lastBBMiddle || lastSMA;
    const distanceFromMean = ((currentPrice - meanPrice) / meanPrice) * 100;

    // Calculate position in Bollinger Bands
    const bbWidth = lastBBUpper - lastBBLower;
    const positionInBB = bbWidth > 0 ? ((currentPrice - lastBBLower) / bbWidth) * 100 : 50;

    return {
      currentPrice,
      rsi: lastRSI,
      bollingerUpper: lastBBUpper,
      bollingerMiddle: lastBBMiddle,
      bollingerLower: lastBBLower,
      sma: lastSMA,
      meanPrice,
      distanceFromMean,
      positionInBB,
      support,
      resistance,
      priceBelowLower: currentPrice <= lastBBLower,
      priceBelowMean: currentPrice < meanPrice,
      rsiOversold: lastRSI < this.config.rsiOversold,
    };
  }

  async shouldEnter(pair: TradingPair): Promise<boolean> {
    try {
      const symbol = this.config.symbol || pair.symbol;
      const indicators = await this.getTechnicalIndicators(symbol);

      // Mean reversion entry conditions:
      // 1. Price below mean (oversold)
      // 2. RSI oversold
      // 3. Price near or below lower Bollinger Band
      // 4. Sufficient distance from mean to expect reversion

      const conditions = [
        indicators.priceBelowMean, // Price below mean
        indicators.rsiOversold, // RSI oversold
        indicators.priceBelowLower || indicators.positionInBB < 10, // Near lower BB
        Math.abs(indicators.distanceFromMean) >= this.config.minRevertDistance, // Sufficient deviation
      ];

      // All conditions should be met for mean reversion entry
      return conditions.every(Boolean);
    } catch (error) {
      console.error(`Error checking entry condition:`, error);
      return false;
    }
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

      // Check take profit (revert to mean)
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

      // Check mean reversion exit signals
      const indicators = await this.getTechnicalIndicators(position.symbol);

      // Exit if:
      // 1. Price reverted to mean or above
      // 2. RSI becomes neutral or overbought
      // 3. Price touches upper Bollinger Band (extreme overbought)

      const exitConditions = [
        currentPrice >= indicators.meanPrice, // Reverted to mean
        indicators.rsi >= this.config.rsiOverbought, // Overbought
        currentPrice >= indicators.bollingerUpper, // Upper BB
        indicators.positionInBB > 90, // Near upper BB
      ];

      return exitConditions.some(Boolean);
    } catch (error) {
      console.error(`Error checking exit condition:`, error);
      return false;
    }
  }

  private async enterPosition(symbol: string, indicators: any): Promise<StrategyResult> {
    try {
      // Calculate position size
      const balance = await this.client.getBalance('USDT');
      if (!balance || balance.free === 0) {
        return { success: false, message: 'Insufficient USDT balance' };
      }

      const orderValue = (balance.free * this.config.positionSizePercent) / 100;

      // Place market buy order (buying the dip for mean reversion)
      const result = await this.orderManager.marketBuy(symbol, orderValue);
      let { price: executedPrice, qty: executedQty } = extractExecutedFromResult(result);
      if (!isFinite(executedPrice) || executedPrice <= 0 || !isFinite(executedQty) || executedQty <= 0) {
        ({ price: executedPrice, qty: executedQty } = await resolveExecutedFromExchange({
          price: executedPrice,
          executedQty,
          orderId: result.orderId,
          symbol,
        }));
        if (!isFinite(executedPrice) || executedPrice <= 0) executedPrice = indicators.currentPrice;
      }

      // Calculate fees
      const fee = result.fills.reduce((sum, fill) => sum + fill.commission, 0);
      const feeAsset = result.fills[0]?.commissionAsset || 'USDT';

      // Calculate stop loss and take profit (target mean price)
      const stopLoss = executedPrice * (1 - this.config.stopLossPercent / 100);
      const takeProfit = indicators.meanPrice; // Target mean reversion

      // If mean is too close, use percentage-based take profit
      const takeProfitPercentBased = executedPrice * (1 + this.config.takeProfitPercent / 100);
      const finalTakeProfit = takeProfit > takeProfitPercentBased ? takeProfit : takeProfitPercentBased;

      // Create position
      const position = await this.createPosition({
        symbol,
        side: 'BUY',
        quantity: executedQty,
        entryPrice: executedPrice,
        stopLoss,
        takeProfit: finalTakeProfit,
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

      return {
        success: true,
        message: `Mean reversion entry at ${executedPrice} (targeting mean: ${finalTakeProfit.toFixed(2)})`,
        orderId: result.orderId,
        positionId: position.id,
      };
    } catch (error) {
      console.error(`Error entering position:`, error);
      return { success: false, message: String(error) };
    }
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
        message: `Position closed with ${pnlPercent.toFixed(2)}% PnL (mean reversion)`,
        orderId: result.orderId,
        positionId,
      };
    } catch (error) {
      console.error(`Error exiting position:`, error);
      return { success: false, message: String(error) };
    }
  }
}
