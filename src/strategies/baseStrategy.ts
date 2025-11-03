import { StrategyType, TradingPair } from '../types';
import { getOrderManager } from '../services/binance/orderManager';
import { db } from '../db';
import { strategies, positions, trades } from '../db/schema';
import { eq } from 'drizzle-orm';

export interface StrategyConfig {
  symbol?: string; // undefined means auto-select
  [key: string]: unknown;
}

export interface StrategyResult {
  success: boolean;
  message?: string;
  orderId?: number;
  positionId?: string;
}

export abstract class BaseStrategy {
  protected strategyId: string;
  protected type: StrategyType;
  protected name: string;
  protected config: StrategyConfig;
  protected isActive: boolean;
  protected orderManager = getOrderManager();

  constructor(strategyId: string, type: StrategyType, name: string, config: StrategyConfig) {
    this.strategyId = strategyId;
    this.type = type;
    this.name = name;
    this.config = config;
    this.isActive = false;
  }

  /**
   * Initialize the strategy
   */
  abstract initialize(): Promise<void>;

  /**
   * Execute the strategy logic
   */
  abstract execute(pair?: TradingPair): Promise<StrategyResult>;

  /**
   * Check if strategy should enter a position
   */
  abstract shouldEnter(pair: TradingPair): Promise<boolean>;

  /**
   * Check if strategy should exit a position
   */
  abstract shouldExit(positionId: string): Promise<boolean>;

  /**
   * Handle position opened
   */
  async onPositionOpened(positionId: string): Promise<void> {
    // Override in subclass if needed
  }

  /**
   * Handle position closed
   */
  async onPositionClosed(positionId: string): Promise<void> {
    // Override in subclass if needed
  }

  /**
   * Start the strategy
   */
  async start(): Promise<void> {
    if (this.isActive) {
      throw new Error('Strategy is already active');
    }

    try {
      await this.initialize();
      this.isActive = true;
      await this.updateStrategyStatus(true);
    } catch (error) {
      console.error(`Error initializing strategy ${this.strategyId}:`, error);
      throw error;
    }
  }

  /**
   * Stop the strategy
   */
  async stop(): Promise<void> {
    this.isActive = false;
    await this.updateStrategyStatus(false);
  }

  /**
   * Update strategy configuration
   */
  async updateConfig(newConfig: StrategyConfig): Promise<void> {
    this.config = { ...this.config, ...newConfig };
    await db
      .update(strategies)
      .set({
        config: this.config as any,
        updatedAt: new Date(),
      })
      .where(eq(strategies.id, this.strategyId));
  }

  /**
   * Get current positions for this strategy
   */
  async getPositions() {
    return db
      .select()
      .from(positions)
      .where(eq(positions.strategyId, this.strategyId));
  }

  /**
   * Get open positions for this strategy
   */
  async getOpenPositions() {
    return db
      .select()
      .from(positions)
      .where(eq(positions.strategyId, this.strategyId))
      .then(results => results.filter(p => p.isOpen));
  }

  /**
   * Get strategy from database
   */
  async getStrategyFromDb() {
    const result = await db
      .select()
      .from(strategies)
      .where(eq(strategies.id, this.strategyId))
      .limit(1);
    
    return result[0] || null;
  }

  /**
   * Save a trade to database
   */
  protected async saveTrade(tradeData: {
    positionId?: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    orderType: 'MARKET' | 'LIMIT';
    quantity: number;
    price: number;
    fee: number;
    feeAsset: string;
    pnl?: number;
    pnlPercent?: number;
    binanceOrderId?: string;
    status: string;
  }) {
    // Helper function to safely format numbers for database
    const formatNumber = (num: number | undefined): string => {
      if (num === undefined || num === null || isNaN(num)) return '0';
      
      // Ensure it's a valid number
      const validNum = Number(num);
      if (!isFinite(validNum)) return '0';
      
      // Format to 8 decimal places max
      const rounded = Math.round(validNum * 100000000) / 100000000;
      
      // Convert to fixed decimal format first to avoid scientific notation
      let formatted = rounded.toFixed(8);
      
      // Remove trailing zeros after decimal point
      if (formatted.includes('.')) {
        formatted = formatted.replace(/0+$/, '');
        // Remove decimal point if no digits after it
        if (formatted.endsWith('.')) {
          formatted = formatted.slice(0, -1);
        }
      }
      
      // Final validation - ensure it's a valid numeric string
      // Check for invalid patterns like leading zeros on integers
      if (formatted.match(/^0+\d/) && !formatted.startsWith('0.')) {
        // Remove leading zeros for integers
        formatted = parseFloat(formatted).toString();
      }
      
      if (!/^-?\d+(\.\d+)?$/.test(formatted)) {
        console.error(`⚠️  Invalid formatted number: ${num} → ${formatted}, using safe fallback`);
        // Return a safe default
        const safe = validNum.toFixed(8);
        return safe.replace(/0+$/, '').replace(/\.$/, '');
      }
      
      return formatted;
    };
    
        // Do not save invalid trades (price must be > 0)
        if (!tradeData.price || !isFinite(tradeData.price) || tradeData.price <= 0) {
          throw new Error(`Refuse to save trade with non-positive price: ${tradeData.price}`);
        }

        await db.insert(trades).values({
      positionId: tradeData.positionId,
      strategyId: this.strategyId,
      symbol: tradeData.symbol,
      side: tradeData.side,
      orderType: tradeData.orderType,
      quantity: formatNumber(tradeData.quantity),
      price: formatNumber(tradeData.price),
      fee: formatNumber(tradeData.fee),
      feeAsset: tradeData.feeAsset,
      pnl: formatNumber(tradeData.pnl),
      pnlPercent: formatNumber(tradeData.pnlPercent),
      binanceOrderId: tradeData.binanceOrderId,
      status: tradeData.status,
    });
  }

  /**
   * Create a new position
   */
  protected async createPosition(positionData: {
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    entryPrice: number;
    stopLoss?: number;
    takeProfit?: number;
  }) {
    // Helper function to safely format numbers for database
    const formatNumber = (num: number | undefined): string | undefined => {
      if (num === undefined || num === null || isNaN(num)) return undefined;
      
      // Ensure it's a valid number
      const validNum = Number(num);
      if (!isFinite(validNum)) return undefined;
      
      // Format to 8 decimal places max
      // Use Number() to avoid floating point issues
      const rounded = Math.round(validNum * 100000000) / 100000000;
      
      // Convert to fixed decimal format first to avoid scientific notation
      let formatted = rounded.toFixed(8);
      
      // Remove trailing zeros after decimal point
      if (formatted.includes('.')) {
        formatted = formatted.replace(/0+$/, '');
        // Remove decimal point if no digits after it
        if (formatted.endsWith('.')) {
          formatted = formatted.slice(0, -1);
        }
      }
      
      // Final validation - ensure it's a valid numeric string
      // Check for invalid patterns like leading zeros on integers
      if (formatted.match(/^0+\d/) && !formatted.startsWith('0.')) {
        // Remove leading zeros for integers
        formatted = parseFloat(formatted).toString();
      }
      
      if (!/^-?\d+(\.\d+)?$/.test(formatted)) {
        console.error(`⚠️  Invalid formatted number: ${num} → ${formatted}, using safe fallback`);
        // Return a safe default
        const safe = validNum.toFixed(8);
        return safe.replace(/0+$/, '').replace(/\.$/, '');
      }
      
      return formatted;
    };
    
    const [position] = await db
      .insert(positions)
      .values({
        strategyId: this.strategyId,
        symbol: positionData.symbol,
        side: positionData.side,
        quantity: formatNumber(positionData.quantity) || '0',
        entryPrice: formatNumber(positionData.entryPrice) || '0',
        stopLoss: formatNumber(positionData.stopLoss),
        takeProfit: formatNumber(positionData.takeProfit),
        currentPrice: formatNumber(positionData.entryPrice) || '0',
      })
      .returning();

    if (position) {
      await this.onPositionOpened(position.id);
    }

    return position;
  }

  /**
   * Close a position
   */
  protected async closePosition(positionId: string, closePrice: number) {
    const [position] = await db
      .update(positions)
      .set({
        isOpen: false,
        closedAt: new Date(),
        currentPrice: closePrice.toString(),
      })
      .where(eq(positions.id, positionId))
      .returning();

    if (position) {
      await this.onPositionClosed(positionId);
    }

    return position;
  }

  private async updateStrategyStatus(isActive: boolean): Promise<void> {
    await db
      .update(strategies)
      .set({
        isActive,
        updatedAt: new Date(),
      })
      .where(eq(strategies.id, this.strategyId));
  }

  // Getters
  getId(): string {
    return this.strategyId;
  }

  getType(): StrategyType {
    return this.type;
  }

  getName(): string {
    return this.name;
  }

  getConfig(): StrategyConfig {
    return { ...this.config };
  }

  getIsActive(): boolean {
    return this.isActive;
  }
}
