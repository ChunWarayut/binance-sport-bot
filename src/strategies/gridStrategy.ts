import { BaseStrategy, StrategyConfig, StrategyResult } from './baseStrategy';
import { StrategyType, TradingPair } from '../types';
import { getBinanceClient } from '../services/binance/binanceClient';
import { getOrderManager } from '../services/binance/orderManager';
import { db } from '../db';
import { eq, and } from 'drizzle-orm';
import { positions } from '../db/schema';

export interface GridStrategyConfig extends StrategyConfig {
  symbol?: string;
  gridLevels: number; // Number of grid levels
  gridSpacing: number; // Percentage spacing between grids (e.g., 1 for 1%)
  upperPrice?: number; // Upper bound (if not set, use recent high)
  lowerPrice?: number; // Lower bound (if not set, use recent low)
  quantityPerGrid: number; // Quantity to trade per grid level
  maxPositions: number; // Maximum number of open positions
}

export class GridStrategy extends BaseStrategy {
  private config: GridStrategyConfig;
  private client = getBinanceClient();
  private orderManager = getOrderManager();
  private gridLevels: { price: number; side: 'BUY' | 'SELL' }[] = [];

  constructor(id: string, name: string, config: GridStrategyConfig) {
    super(id, 'grid', name, config);
    // Ensure symbol is properly set from config
    const symbolValue = config.symbol || (config as any)?.symbol;
    
    this.config = {
      ...config,
      symbol: symbolValue && typeof symbolValue === 'string' ? symbolValue : undefined,
    };
    
    // Debug: log if symbol is still missing
    if (!this.config.symbol) {
      console.warn(`⚠️  GridStrategy ${name}: symbol is missing. config:`, JSON.stringify(config));
    } else {
      console.log(`✅ GridStrategy ${name}: symbol = ${this.config.symbol}`);
    }
  }
  
  public getConfig(): GridStrategyConfig {
    return this.config;
  }

  async initialize(): Promise<void> {
    // Skip initialization if symbol is not set (for auto-select strategies)
    if (!this.config.symbol || typeof this.config.symbol !== 'string') {
      console.warn(`Grid Strategy ${this.name}: Symbol not set (${this.config.symbol}), will be calculated on first execution`);
      return;
    }
    
    try {
      // Calculate grid levels based on price range
      console.log(`🔄 Grid Strategy ${this.name}: Initializing with symbol ${this.config.symbol}`);
      await this.calculateGridLevels();
      console.log(`✅ Grid Strategy ${this.name}: Initialized successfully`);
    } catch (error: any) {
      const errorMsg = error?.message || String(error);
      console.error(`❌ Grid Strategy ${this.name} initialization error:`, errorMsg);
      
      // If symbol error, don't throw - will initialize on first execution
      if (errorMsg.includes('symbol') || errorMsg.includes('Symbol')) {
        console.warn(`⚠️  Grid Strategy ${this.name}: Symbol issue during init, will retry on execution. Symbol: ${this.config.symbol}`);
        return; // Don't throw, let it initialize on first execution
      }
      
      // For other errors, log but don't block strategy loading
      console.warn(`⚠️  Grid Strategy ${this.name}: Initialization failed but continuing...`);
    }
  }

  private async calculateGridLevels(): Promise<void> {
    const symbol = this.config.symbol;
    if (!symbol || typeof symbol !== 'string') {
      // Don't throw error - will calculate when strategy executes with selected pair
      console.warn(`Grid Strategy ${this.name}: Symbol not set (${symbol}), will calculate grid levels on first execution`);
      return;
    }
    
    console.log(`🔍 Grid Strategy ${this.name}: Calculating grid levels for ${symbol}`);

    // Get current price
    const currentPrice = await this.client.getPrice(symbol);

    // Get price range
    let upperPrice = this.config.upperPrice;
    let lowerPrice = this.config.lowerPrice;

    if (!upperPrice || !lowerPrice) {
      // Get recent price data to determine range
      const klines = await this.client.getKlines(symbol, '1d', 30);
      const highs = klines.map(k => k.high);
      const lows = klines.map(k => k.low);
      
      upperPrice = upperPrice || Math.max(...highs) * 1.05; // 5% above recent high
      lowerPrice = lowerPrice || Math.min(...lows) * 0.95; // 5% below recent low
    }

    // Calculate grid levels
    const priceRange = upperPrice - lowerPrice;
    const spacing = priceRange / this.config.gridLevels;
    const spacingPercent = (spacing / currentPrice) * 100;

    this.gridLevels = [];
    
    // Create buy orders below current price
    for (let i = 1; i <= Math.floor(this.config.gridLevels / 2); i++) {
      const buyPrice = currentPrice - (spacing * i);
      if (buyPrice >= lowerPrice) {
        this.gridLevels.push({ price: buyPrice, side: 'BUY' });
      }
    }

    // Create sell orders above current price
    for (let i = 1; i <= Math.floor(this.config.gridLevels / 2); i++) {
      const sellPrice = currentPrice + (spacing * i);
      if (sellPrice <= upperPrice) {
        this.gridLevels.push({ price: sellPrice, side: 'SELL' });
      }
    }

    // Sort by price
    this.gridLevels.sort((a, b) => a.price - b.price);
  }

  async execute(pair?: TradingPair): Promise<StrategyResult> {
    const symbol = this.config.symbol || pair?.symbol;
    if (!symbol) {
      return { success: false, message: 'No symbol specified' };
    }

    try {
      // Get current price
      const currentPrice = await this.client.getPrice(symbol);

      // Get open positions
      const openPositions = await this.getOpenPositions();
      
      if (openPositions.length >= this.config.maxPositions) {
        return { success: false, message: 'Maximum positions reached' };
      }

      // Check if any grid level should trigger
      for (const gridLevel of this.gridLevels) {
        // Check if price crossed a grid level
        const shouldTrigger = 
          (gridLevel.side === 'BUY' && currentPrice <= gridLevel.price * 1.001) || // Within 0.1% of buy level
          (gridLevel.side === 'SELL' && currentPrice >= gridLevel.price * 0.999); // Within 0.1% of sell level

        if (shouldTrigger) {
          // Check if we already have a position/order at this level
          const existingPosition = openPositions.find(
            p => p.symbol === symbol && 
            Math.abs(parseFloat(p.entryPrice) - gridLevel.price) < gridLevel.price * 0.01
          );

          if (!existingPosition) {
            return await this.executeGridOrder(symbol, gridLevel);
          }
        }
      }

      return { success: true, message: 'No grid levels triggered' };
    } catch (error) {
      console.error(`Error in Grid Strategy execution:`, error);
      return { success: false, message: String(error) };
    }
  }

  private async executeGridOrder(
    symbol: string,
    gridLevel: { price: number; side: 'BUY' | 'SELL' }
  ): Promise<StrategyResult> {
    try {
      if (gridLevel.side === 'BUY') {
        // Place limit buy order
        const result = await this.orderManager.limitBuy(
          symbol,
          this.config.quantityPerGrid,
          gridLevel.price
        );

        // Create position record
        const position = await this.createPosition({
          symbol,
          side: 'BUY',
          quantity: this.config.quantityPerGrid,
          entryPrice: gridLevel.price,
        });

        return {
          success: true,
          message: `Grid buy order placed at ${gridLevel.price}`,
          orderId: result.orderId,
          positionId: position.id,
        };
      } else {
        // For sell orders, we need to have the asset first
        // In grid strategy, sell orders are placed when we have inventory
        const balance = await this.client.getBalance(
          symbol.replace('USDT', '')
        );

        if (balance && balance.free >= this.config.quantityPerGrid) {
          const result = await this.orderManager.limitSell(
            symbol,
            this.config.quantityPerGrid,
            gridLevel.price
          );

          return {
            success: true,
            message: `Grid sell order placed at ${gridLevel.price}`,
            orderId: result.orderId,
          };
        }

        return { success: false, message: 'Insufficient balance for sell order' };
      }
    } catch (error) {
      console.error(`Error executing grid order:`, error);
      return { success: false, message: String(error) };
    }
  }

  async shouldEnter(pair: TradingPair): Promise<boolean> {
    // Grid strategy doesn't use traditional entry signals
    // It relies on price hitting grid levels
    return true;
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

      // Check if we hit a take profit grid level (sell when price goes up for buy positions)
      if (position.side === 'BUY') {
        const profitPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
        
        // Exit if we hit take profit or if price crosses a sell grid level
        if (position.takeProfit) {
          const takeProfitPrice = parseFloat(position.takeProfit);
          if (currentPrice >= takeProfitPrice) {
            return true;
          }
        }

        // Check grid sell levels
        const sellGrids = this.gridLevels.filter(g => g.side === 'SELL' && g.price > entryPrice);
        const nearestSellGrid = sellGrids[0];
        
        if (nearestSellGrid && currentPrice >= nearestSellGrid.price * 0.999) {
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

      return false;
    } catch (error) {
      console.error(`Error checking exit condition:`, error);
      return false;
    }
  }

  async onPositionOpened(positionId: string): Promise<void> {
    // When a buy position is opened, place a corresponding sell order at the next grid level
    const [position] = await db
      .select()
      .from(positions)
      .where(eq(positions.id, positionId))
      .limit(1);

    if (!position || position.side !== 'BUY') {
      return;
    }

    const entryPrice = parseFloat(position.entryPrice);
    const sellGrids = this.gridLevels
      .filter(g => g.side === 'SELL' && g.price > entryPrice)
      .sort((a, b) => a.price - b.price);

    if (sellGrids.length > 0) {
      const nextSellGrid = sellGrids[0];
      
      // Set take profit at next grid level
      await db
        .update(positions)
        .set({
          takeProfit: nextSellGrid.price.toString(),
        })
        .where(eq(positions.id, positionId));
    }
  }
}
