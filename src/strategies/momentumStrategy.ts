import { BaseStrategy, StrategyConfig, StrategyResult } from './baseStrategy';
import { StrategyType, TradingPair } from '../types';
import { getBinanceClient } from '../services/binance/binanceClient';
import { getOrderManager } from '../services/binance/orderManager';
import { db } from '../db';
import {
  calculateRSI,
  calculateMACD,
  calculateEMA,
  calculateSMA,
  KlineData,
} from '../services/analysis/technicalIndicators';
import { eq } from 'drizzle-orm';
import { extractExecutedFromResult, resolveExecutedFromExchange } from '../utils/orderUtils';
import { positions } from '../db/schema';

export interface MomentumStrategyConfig extends StrategyConfig {
  symbol?: string;
  rsiPeriod: number; // RSI period (default 14)
  rsiOversold: number; // RSI oversold threshold (default 30)
  rsiOverbought: number; // RSI overbought threshold (default 70)
  fastEMA: number; // Fast EMA period (default 12)
  slowEMA: number; // Slow EMA period (default 26)
  volumeSMA: number; // Volume SMA period (default 20)
  minVolumeRatio: number; // Minimum volume ratio vs average (default 1.2)
  positionSizePercent: number; // Position size as % of balance (default 5)
  takeProfitPercent: number; // Take profit percentage
  stopLossPercent: number; // Stop loss percentage
  trailingStopPercent?: number; // Optional trailing stop percentage
}

export class MomentumStrategy extends BaseStrategy {
  private config: MomentumStrategyConfig;
  private client = getBinanceClient();
  private orderManager = getOrderManager();

  constructor(id: string, name: string, config: MomentumStrategyConfig) {
    super(id, 'momentum', name, config);
    // Merge defaults with provided config
    const defaults = {
      rsiPeriod: 14,
      rsiOversold: 30,
      rsiOverbought: 70,
      fastEMA: 12,
      slowEMA: 26,
      volumeSMA: 20,
      minVolumeRatio: 1.2,
      positionSizePercent: 5,
      takeProfitPercent: 5,
      stopLossPercent: 2.5,
    };
    // Merge symbol into config if provided
    this.config = { 
      ...defaults, 
      ...config,
      symbol: config.symbol || (config as any).symbol,
    };
  }
  
  public getConfig(): MomentumStrategyConfig {
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

        // Update trailing stop if enabled
        if (this.config.trailingStopPercent) {
          await this.updateTrailingStop(symbolPosition.id, indicators.currentPrice);
        }

        return { success: true, message: 'Position held, exit conditions checked' };
      }

      // Check entry conditions
      const shouldEnter = await this.shouldEnter(pair || { symbol, baseAsset: '', quoteAsset: 'USDT', price: indicators.currentPrice, volume24h: 0 });
      
      if (shouldEnter) {
        return await this.enterPosition(symbol, indicators.currentPrice);
      }

      return { success: true, message: 'Entry conditions not met' };
    } catch (error) {
      console.error(`Error in Momentum Strategy execution:`, error);
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
    const volumes = klineData.map(k => k.volume);
    const currentPrice = prices[prices.length - 1];

    // Calculate indicators
    const rsi = calculateRSI(prices, this.config.rsiPeriod);
    const macd = calculateMACD(prices, this.config.fastEMA, this.config.slowEMA, 9);
    const fastEMA = calculateEMA(prices, this.config.fastEMA);
    const slowEMA = calculateEMA(prices, this.config.slowEMA);
    const volumeSMA = calculateSMA(volumes, this.config.volumeSMA);

    const lastRSI = rsi[rsi.length - 1];
    const lastMACD = macd.macd[macd.macd.length - 1];
    const lastSignal = macd.signal[macd.signal.length - 1];
    const lastHistogram = macd.histogram[macd.histogram.length - 1];
    const lastFastEMA = fastEMA[fastEMA.length - 1];
    const lastSlowEMA = slowEMA[slowEMA.length - 1];
    const lastVolumeSMA = volumeSMA[volumeSMA.length - 1];
    const currentVolume = volumes[volumes.length - 1];

    return {
      currentPrice,
      rsi: lastRSI,
      macd: lastMACD,
      signal: lastSignal,
      histogram: lastHistogram,
      fastEMA: lastFastEMA,
      slowEMA: lastSlowEMA,
      volumeRatio: currentVolume / lastVolumeSMA,
      priceAboveFastEMA: currentPrice > lastFastEMA,
      priceAboveSlowEMA: currentPrice > lastSlowEMA,
      fastEMAAboveSlowEMA: lastFastEMA > lastSlowEMA,
      macdBullish: lastMACD > lastSignal && lastHistogram > 0,
    };
  }

  async shouldEnter(pair: TradingPair): Promise<boolean> {
    try {
      const symbol = this.config.symbol || pair.symbol;
      const indicators = await this.getTechnicalIndicators(symbol);

      // Entry conditions for momentum/trend following:
      // 1. Price above both EMAs (uptrend)
      // 2. Fast EMA above Slow EMA (momentum)
      // 3. MACD bullish (MACD > Signal, histogram positive)
      // 4. RSI not overbought (allows room to run)
      // 5. Volume above average (confirmation)

      const conditions = [
        indicators.priceAboveFastEMA,
        indicators.priceAboveSlowEMA,
        indicators.fastEMAAboveSlowEMA,
        indicators.macdBullish,
        indicators.rsi < this.config.rsiOverbought,
        indicators.rsi > this.config.rsiOversold, // Not oversold (we're following trend, not buying dips)
        indicators.volumeRatio >= this.config.minVolumeRatio,
      ];

      const metConditions = conditions.filter(Boolean).length;
      const requiredConditions = 6; // Most conditions must be met

      return metConditions >= requiredConditions;
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

      // Check momentum reversal signals
      const indicators = await this.getTechnicalIndicators(position.symbol);

      // Exit if:
      // 1. Price falls below slow EMA (trend reversal)
      // 2. MACD bearish crossover
      // 3. RSI becomes overbought (profit taking opportunity)

      const exitConditions = [
        !indicators.priceAboveSlowEMA, // Trend reversal
        indicators.macd < indicators.signal, // MACD bearish
        indicators.rsi > this.config.rsiOverbought, // Overbought
      ];

      return exitConditions.some(Boolean);
    } catch (error) {
      console.error(`Error checking exit condition:`, error);
      return false;
    }
  }

  private async enterPosition(symbol: string, currentPrice: number): Promise<StrategyResult> {
    try {
      // Calculate position size
      const balance = await this.client.getBalance('USDT');
      if (!balance || balance.free === 0) {
        return { success: false, message: 'Insufficient USDT balance' };
      }

      const orderValue = (balance.free * this.config.positionSizePercent) / 100;

      // Place market buy order
      const result = await this.orderManager.marketBuy(symbol, orderValue);

      // Get executed price and quantity from order result
      // For market orders, use average fill price from fills array
      let executedPrice = currentPrice;
      let executedQty = result.executedQty || 0;
      
      if (result.fills && result.fills.length > 0) {
        // Calculate weighted average price from fills
        const totalValue = result.fills.reduce((sum, fill) => sum + (fill.price * fill.qty), 0);
        const totalQty = result.fills.reduce((sum, fill) => sum + fill.qty, 0);
        if (totalQty > 0) {
          executedPrice = totalValue / totalQty;
          executedQty = totalQty;
        }
      } else if (result.price && result.price > 0) {
        executedPrice = result.price;
      }
      
      // Ensure executedQty is a valid number (not a string)
      if (typeof executedQty === 'string') {
        executedQty = parseFloat(executedQty);
      }
      if (typeof executedPrice === 'string') {
        executedPrice = parseFloat(executedPrice);
      }
      
      console.log(`💰 Order execution: price=${executedPrice}, qty=${executedQty}, fills=${result.fills?.length || 0}`);
      
      // Validate values before using
      if (!isFinite(executedPrice) || executedPrice <= 0) {
        throw new Error(`Invalid executed price: ${executedPrice}`);
      }
      if (!isFinite(executedQty) || executedQty <= 0) {
        throw new Error(`Invalid executed quantity: ${executedQty}`);
      }

      // Calculate fees
      const fee = result.fills.reduce((sum, fill) => sum + fill.commission, 0);
      const feeAsset = result.fills[0]?.commissionAsset || 'USDT';

      // Calculate stop loss and take profit
      const stopLoss = executedPrice * (1 - this.config.stopLossPercent / 100);
      const takeProfit = executedPrice * (1 + this.config.takeProfitPercent / 100);

      // Create position
      const position = await this.createPosition({
        symbol,
        side: 'BUY',
        quantity: executedQty,
        entryPrice: executedPrice,
        stopLoss,
        takeProfit,
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
        message: `Momentum entry at ${executedPrice}`,
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
        message: `Position closed with ${pnlPercent.toFixed(2)}% PnL`,
        orderId: result.orderId,
        positionId,
      };
    } catch (error) {
      console.error(`Error exiting position:`, error);
      return { success: false, message: String(error) };
    }
  }

  private async updateTrailingStop(positionId: string, currentPrice: number): Promise<void> {
    const [position] = await db
      .select()
      .from(positions)
      .where(eq(positions.id, positionId))
      .limit(1);

    if (!position || !position.isOpen || !this.config.trailingStopPercent) {
      return;
    }

    const entryPrice = parseFloat(position.entryPrice);
    const profitPercent = ((currentPrice - entryPrice) / entryPrice) * 100;

    // Only update trailing stop if we're in profit
    if (profitPercent > 0) {
      const trailingStopPrice = currentPrice * (1 - this.config.trailingStopPercent / 100);
      const currentStopLoss = position.stopLoss ? parseFloat(position.stopLoss) : 0;

      // Only move stop loss up, never down
      if (trailingStopPrice > currentStopLoss) {
        await db
          .update(positions)
          .set({
            stopLoss: trailingStopPrice.toString(),
          })
          .where(eq(positions.id, positionId));
      }
    }
  }
}
