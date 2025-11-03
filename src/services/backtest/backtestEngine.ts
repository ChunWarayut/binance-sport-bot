import { BaseStrategy, StrategyConfig } from '../../strategies/baseStrategy';
import { StrategyType } from '../../types';
import { getDataProvider } from './dataProvider';
import { getPerformanceAnalyzer, TradeRecord, PerformanceMetrics } from './performanceAnalyzer';
import { db } from '../../db';
import { backtestResults } from '../../db/schema';

export interface BacktestConfig {
  strategyType: StrategyType;
  symbol: string;
  startDate: Date;
  endDate: Date;
  initialBalance: number;
  strategyConfig: StrategyConfig;
  interval?: string; // Kline interval (default: '1h')
}

export interface BacktestResult {
  id?: string;
  strategyType: StrategyType;
  symbol: string;
  startDate: Date;
  endDate: Date;
  initialBalance: number;
  finalBalance: number;
  totalReturn: number;
  totalReturnPercent: number;
  sharpeRatio: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  winRate: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  config: StrategyConfig;
  trades: TradeRecord[];
  equityCurve: Array<{ date: Date; balance: number }>;
}

/**
 * Strategy executor interface for backtesting
 */
export interface StrategyExecutor {
  execute(klines: any[], currentIndex: number, balance: number, positions: any[]): {
    action: 'BUY' | 'SELL' | 'HOLD';
    quantity?: number;
    price?: number;
  };
  shouldEnter(klines: any[], currentIndex: number): boolean;
  shouldExit(positions: any[], currentPrice: number): string | null; // Return position ID to exit
}

export class BacktestEngine {
  private dataProvider = getDataProvider();
  private performanceAnalyzer = getPerformanceAnalyzer();

  /**
   * Run a backtest
   */
  async runBacktest(config: BacktestConfig): Promise<BacktestResult> {
    // Validate date range
    const validation = this.dataProvider.validateDateRange(config.startDate, config.endDate);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // Get historical data
    const interval = config.interval || '1h';
    const data = await this.dataProvider.getHistoricalData(
      config.symbol,
      interval,
      config.startDate,
      config.endDate
    );

    // Execute backtest simulation
    const simulationResult = await this.simulateTrading(
      data.klines,
      config.strategyType,
      config.strategyConfig,
      config.initialBalance
    );

    // Calculate performance metrics
    const metrics = this.performanceAnalyzer.calculateMetrics(
      config.initialBalance,
      simulationResult.trades
    );

    // Generate equity curve
    const equityCurve = this.performanceAnalyzer.generateEquityCurve(
      config.initialBalance,
      simulationResult.trades
    );

    const finalBalance = config.initialBalance + metrics.totalReturn;

    const result: BacktestResult = {
      strategyType: config.strategyType,
      symbol: config.symbol,
      startDate: config.startDate,
      endDate: config.endDate,
      initialBalance: config.initialBalance,
      finalBalance,
      totalReturn: metrics.totalReturn,
      totalReturnPercent: metrics.totalReturnPercent,
      sharpeRatio: metrics.sharpeRatio,
      maxDrawdown: metrics.maxDrawdown,
      maxDrawdownPercent: metrics.maxDrawdownPercent,
      winRate: metrics.winRate,
      totalTrades: metrics.totalTrades,
      winningTrades: metrics.winningTrades,
      losingTrades: metrics.losingTrades,
      config: config.strategyConfig,
      trades: simulationResult.trades,
      equityCurve,
    };

    // Save to database
    const savedResult = await this.saveBacktestResult(result);
    result.id = savedResult.id;

    return result;
  }

  /**
   * Simulate trading with historical data
   */
  private async simulateTrading(
    klines: any[],
    strategyType: StrategyType,
    strategyConfig: StrategyConfig,
    initialBalance: number
  ): Promise<{ trades: TradeRecord[] }> {
    let balance = initialBalance;
    const trades: TradeRecord[] = [];
    const positions: Array<{ id: string; entryPrice: number; quantity: number; entryTime: Date }> = [];
    let positionIdCounter = 0;

    // Simplified backtesting logic
    // In a real implementation, you would instantiate the actual strategy class
    // and call its methods with simulated data

    for (let i = 20; i < klines.length; i++) {
      const currentKline = klines[i];
      const currentPrice = currentKline.close;
      const currentTime = currentKline.timestamp;

      // Check exit conditions for existing positions
      const positionsToExit: string[] = [];
      for (const position of positions) {
        // Simple exit logic: take profit at 5%, stop loss at 2.5%
        const pnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
        
        if (pnlPercent >= 5 || pnlPercent <= -2.5) {
          positionsToExit.push(position.id);
        }
      }

      // Execute exits
      for (const positionId of positionsToExit) {
        const positionIndex = positions.findIndex(p => p.id === positionId);
        if (positionIndex !== -1) {
          const position = positions[positionIndex];
          const pnl = (currentPrice - position.entryPrice) * position.quantity;
          const pnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
          const fee = (currentPrice * position.quantity) * 0.001; // 0.1% fee

          trades.push({
            entryPrice: position.entryPrice,
            exitPrice: currentPrice,
            quantity: position.quantity,
            entryTime: position.entryTime,
            exitTime: currentTime,
            pnl,
            pnlPercent,
            fee,
          });

          balance += pnl - fee;
          positions.splice(positionIndex, 1);
        }
      }

      // Check entry conditions (simplified)
      if (positions.length === 0) {
        // Simple entry: RSI oversold for mean reversion, or price above EMA for momentum
        // This is a simplified version - real strategies would use actual indicator calculations
        
        const canAfford = balance >= 100; // Minimum trade size
        if (canAfford) {
          // Entry logic would go here based on strategy type
          // For now, we'll use a simple random entry for demonstration
          // In production, instantiate actual strategy and call shouldEnter()
          
          const positionSize = Math.min(balance * 0.1, balance - 10); // 10% of balance
          const quantity = positionSize / currentPrice;
          const entryFee = positionSize * 0.001;

          if (balance >= positionSize + entryFee) {
            const positionId = `pos_${positionIdCounter++}`;
            positions.push({
              id: positionId,
              entryPrice: currentPrice,
              quantity,
              entryTime: currentTime,
            });

            balance -= positionSize + entryFee;
          }
        }
      }
    }

    // Close any remaining positions at the end
    for (const position of positions) {
      const lastKline = klines[klines.length - 1];
      const exitPrice = lastKline.close;
      const pnl = (exitPrice - position.entryPrice) * position.quantity;
      const pnlPercent = ((exitPrice - position.entryPrice) / position.entryPrice) * 100;
      const fee = (exitPrice * position.quantity) * 0.001;

      trades.push({
        entryPrice: position.entryPrice,
        exitPrice,
        quantity: position.quantity,
        entryTime: position.entryTime,
        exitTime: lastKline.timestamp,
        pnl,
        pnlPercent,
        fee,
      });
    }

    return { trades };
  }

  /**
   * Save backtest result to database
   */
  private async saveBacktestResult(result: BacktestResult) {
    const [saved] = await db
      .insert(backtestResults)
      .values({
        strategyType: result.strategyType,
        symbol: result.symbol,
        startDate: result.startDate,
        endDate: result.endDate,
        initialBalance: result.initialBalance.toString(),
        finalBalance: result.finalBalance.toString(),
        totalReturn: result.totalReturn.toString(),
        totalReturnPercent: result.totalReturnPercent.toString(),
        sharpeRatio: result.sharpeRatio.toString(),
        maxDrawdown: result.maxDrawdown.toString(),
        maxDrawdownPercent: result.maxDrawdownPercent.toString(),
        winRate: result.winRate.toString(),
        totalTrades: result.totalTrades,
        winningTrades: result.winningTrades,
        losingTrades: result.losingTrades,
        config: result.config as any,
      })
      .returning();

    return saved;
  }
}

// Singleton instance
let backtestEngineInstance: BacktestEngine | null = null;

export function getBacktestEngine(): BacktestEngine {
  if (!backtestEngineInstance) {
    backtestEngineInstance = new BacktestEngine();
  }
  return backtestEngineInstance;
}
