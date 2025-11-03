import { BaseStrategy, StrategyConfig } from './baseStrategy';
import { StrategyType } from '../types';
import { db } from '../db';
import { strategies } from '../db/schema';
import { eq } from 'drizzle-orm';
import { EventEmitter } from 'events';

export class StrategyManager extends EventEmitter {
  private activeStrategies: Map<string, BaseStrategy> = new Map();
  private strategyClasses: Map<StrategyType, new (id: string, name: string, config: any) => BaseStrategy> = new Map();
  private executionInterval: NodeJS.Timeout | null = null;
  private executionIntervalMs: number = 60000; // 1 minute default

  /**
   * Register a strategy class
   */
  registerStrategyType(
    type: StrategyType,
    strategyClass: new (id: string, name: string, config: any) => BaseStrategy
  ) {
    this.strategyClasses.set(type, strategyClass);
  }

  /**
   * Create a strategy instance
   */
  private createStrategyInstance(
    id: string,
    type: StrategyType,
    name: string,
    config: StrategyConfig
  ): BaseStrategy | null {
    const StrategyClass = this.strategyClasses.get(type);
    if (!StrategyClass) {
      throw new Error(`Strategy type ${type} is not registered`);
    }
    return new StrategyClass(id, name, config);
  }

  /**
   * Load strategy from database and activate it
   */
  async loadStrategy(strategyId: string): Promise<void> {
    const [strategy] = await db
      .select()
      .from(strategies)
      .where(eq(strategies.id, strategyId))
      .limit(1);

    if (!strategy) {
      throw new Error(`Strategy ${strategyId} not found`);
    }

    if (this.activeStrategies.has(strategyId)) {
      throw new Error(`Strategy ${strategyId} is already loaded`);
    }

    // Merge symbol from database into config if not present
    // symbol can be in strategy.symbol (database column) or strategy.config.symbol (JSON field)
    const dbSymbol = strategy.symbol || null;
    const configSymbol = (strategy.config as any)?.symbol || null;
    const finalSymbol = dbSymbol || configSymbol || undefined;
    
    const mergedConfig = {
      ...strategy.config,
      symbol: finalSymbol,
    } as StrategyConfig;
    
    // Debug: log symbol merge
    if (finalSymbol) {
      console.log(`✅ Loading strategy ${strategy.name}: symbol=${finalSymbol} (from ${dbSymbol ? 'DB column' : 'config'})`);
    } else {
      console.warn(`⚠️  Loading strategy ${strategy.name}: symbol is missing`);
    }

    const strategyInstance = this.createStrategyInstance(
      strategyId,
      strategy.type as StrategyType,
      strategy.name,
      mergedConfig
    );

    if (!strategyInstance) {
      throw new Error(`Failed to create strategy instance for ${strategyId}`);
    }

    this.activeStrategies.set(strategyId, strategyInstance);

    if (strategy.isActive) {
      await strategyInstance.start();
    }

    this.emit('strategy:loaded', { strategyId, type: strategy.type });
  }

  /**
   * Unload a strategy
   */
  async unloadStrategy(strategyId: string): Promise<void> {
    const strategy = this.activeStrategies.get(strategyId);
    if (!strategy) {
      return;
    }

    if (strategy.getIsActive()) {
      await strategy.stop();
    }

    this.activeStrategies.delete(strategyId);
    this.emit('strategy:unloaded', { strategyId });
  }

  /**
   * Start a strategy
   */
  async startStrategy(strategyId: string): Promise<void> {
    const strategy = this.activeStrategies.get(strategyId);
    if (!strategy) {
      await this.loadStrategy(strategyId);
      // Get strategy again after loading
      const loadedStrategy = this.activeStrategies.get(strategyId);
      if (!loadedStrategy) {
        throw new Error(`Failed to load strategy ${strategyId}`);
      }
      await loadedStrategy.start();
      this.emit('strategy:started', { strategyId });
      return;
    }

    if (strategy.getIsActive()) {
      throw new Error(`Strategy ${strategyId} is already active`);
    }

    await strategy.start();
    this.emit('strategy:started', { strategyId });
  }

  /**
   * Stop a strategy
   */
  async stopStrategy(strategyId: string): Promise<void> {
    const strategy = this.activeStrategies.get(strategyId);
    if (!strategy) {
      return;
    }

    await strategy.stop();
    this.emit('strategy:stopped', { strategyId });
  }

  /**
   * Get active strategy
   */
  getStrategy(strategyId: string): BaseStrategy | undefined {
    return this.activeStrategies.get(strategyId);
  }

  /**
   * Get all active strategies
   */
  getAllStrategies(): BaseStrategy[] {
    return Array.from(this.activeStrategies.values());
  }

  /**
   * Execute all active strategies
   */
  async executeAll(pair?: any): Promise<void> {
    const activeStrategies = this.getAllStrategies().filter(s => s.getIsActive());

    if (activeStrategies.length === 0) {
      console.log('⚠️  No active strategies to execute');
      return;
    }

    console.log(`🔄 Executing ${activeStrategies.length} active strategies...`);

    // Get best pairs for auto-select strategies if needed
    let bestPairs: any[] = [];
    const hasAutoSelect = activeStrategies.some(s => {
      // We'll check during execution - strategies will handle their own symbol/pair logic
      return true;
    });

    if (hasAutoSelect && !pair) {
      try {
        const { getPairSelector } = await import('../services/analysis/pairSelector');
        const pairSelector = getPairSelector();
        bestPairs = await pairSelector.getBestPairs(10); // Get top 10 pairs
        console.log(`📊 Using top ${bestPairs.length} pairs for auto-select strategies`);
      } catch (error) {
        console.warn('⚠️  Could not get best pairs for auto-select strategies:', error);
      }
    }

    // Execute all strategies
    for (const strategy of activeStrategies) {
      try {
        // For strategies without symbol, try to use best pairs
        let executionPair = pair;
        if (!executionPair && bestPairs.length > 0) {
          // Use the best pair for auto-select strategies
          executionPair = bestPairs[0];
        }
        await this.executeStrategy(strategy.getId(), executionPair);
      } catch (error: any) {
        const errorMsg = error?.message || String(error);
        console.error(`❌ Error executing strategy ${strategy.getName()}:`, errorMsg);
        this.emit('strategy:error', {
          strategyId: strategy.getId(),
          error,
        });
      }
    }

    console.log(`✅ Finished executing ${activeStrategies.length} strategies`);
  }

  /**
   * Execute a specific strategy
   */
  async executeStrategy(strategyId: string, pair?: any): Promise<void> {
    const strategy = this.activeStrategies.get(strategyId);
    if (!strategy || !strategy.getIsActive()) {
      return;
    }

    try {
      console.log(`📊 Executing strategy: ${strategy.getName()} (${strategy.getType()})`);
      const result = await strategy.execute(pair);
      
      if (result.success) {
        if (result.positionsOpened && result.positionsOpened > 0) {
          console.log(`✅ ${strategy.getName()}: Opened ${result.positionsOpened} position(s)`);
        }
        if (result.positionsClosed && result.positionsClosed > 0) {
          console.log(`✅ ${strategy.getName()}: Closed ${result.positionsClosed} position(s)`);
        }
        if (result.message && !result.positionsOpened && !result.positionsClosed) {
          console.log(`ℹ️  ${strategy.getName()}: ${result.message}`);
        }
      } else {
        console.log(`ℹ️  ${strategy.getName()}: ${result.message || 'No action taken'}`);
      }
      
      this.emit('strategy:executed', {
        strategyId,
        result,
      });
    } catch (error: any) {
      const errorMsg = error?.message || String(error);
      console.error(`❌ Strategy ${strategy.getName()} execution failed:`, errorMsg);
      this.emit('strategy:error', {
        strategyId,
        error,
      });
      throw error;
    }
  }

  /**
   * Start automatic execution loop
   */
  startExecutionLoop(intervalMs: number = 60000): void {
    if (this.executionInterval) {
      this.stopExecutionLoop();
    }

    this.executionIntervalMs = intervalMs;
    this.executionInterval = setInterval(() => {
      console.log(`⏰ Execution loop triggered at ${new Date().toISOString()}`);
      this.executeAll().catch((error: any) => {
        const errorMsg = error?.message || String(error);
        console.error('❌ Error in execution loop:', errorMsg);
      });
    }, intervalMs);

    console.log(`✅ Strategy execution loop started (interval: ${intervalMs}ms)`);
  }

  /**
   * Stop automatic execution loop
   */
  stopExecutionLoop(): void {
    if (this.executionInterval) {
      clearInterval(this.executionInterval);
      this.executionInterval = null;
      console.log('⏹️  Strategy execution loop stopped');
    }
  }

  /**
   * Load all active strategies from database
   */
  async loadAllStrategiesFromDb(): Promise<void> {
    const allStrategies = await db.select().from(strategies);

    for (const strategy of allStrategies) {
      try {
        await this.loadStrategy(strategy.id);
      } catch (error) {
        console.error(`Failed to load strategy ${strategy.id}:`, error);
      }
    }
  }

  /**
   * Set execution interval
   */
  setExecutionInterval(intervalMs: number): void {
    this.executionIntervalMs = intervalMs;
    if (this.executionInterval) {
      this.stopExecutionLoop();
      this.startExecutionLoop(intervalMs);
    }
  }
}

// Singleton instance
let strategyManagerInstance: StrategyManager | null = null;

export function getStrategyManager(): StrategyManager {
  if (!strategyManagerInstance) {
    strategyManagerInstance = new StrategyManager();
  }
  return strategyManagerInstance;
}
