export interface TradeRecord {
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  entryTime: Date;
  exitTime: Date;
  pnl: number;
  pnlPercent: number;
  fee: number;
}

export interface PerformanceMetrics {
  totalReturn: number;
  totalReturnPercent: number;
  sharpeRatio: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  winRate: number;
  profitFactor: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  averageWin: number;
  averageLoss: number;
  largestWin: number;
  largestLoss: number;
  averageTrade: number;
}

export class PerformanceAnalyzer {
  /**
   * Calculate performance metrics from trades
   */
  calculateMetrics(
    initialBalance: number,
    trades: TradeRecord[]
  ): PerformanceMetrics {
    if (trades.length === 0) {
      return this.getEmptyMetrics();
    }

    // Calculate cumulative balance
    let balance = initialBalance;
    const balances: number[] = [initialBalance];
    
    let totalProfit = 0;
    let totalLoss = 0;
    const winningTrades: TradeRecord[] = [];
    const losingTrades: TradeRecord[] = [];

    for (const trade of trades) {
      const netPnl = trade.pnl - trade.fee;
      balance += netPnl;
      balances.push(balance);

      if (netPnl > 0) {
        totalProfit += netPnl;
        winningTrades.push(trade);
      } else {
        totalLoss += Math.abs(netPnl);
        losingTrades.push(trade);
      }
    }

    const finalBalance = balance;
    const totalReturn = finalBalance - initialBalance;
    const totalReturnPercent = (totalReturn / initialBalance) * 100;

    // Calculate max drawdown
    const { maxDrawdown, maxDrawdownPercent } = this.calculateMaxDrawdown(balances, initialBalance);

    // Calculate Sharpe Ratio
    const sharpeRatio = this.calculateSharpeRatio(trades);

    // Calculate win rate
    const winRate = winningTrades.length / trades.length * 100;

    // Profit factor
    const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? Infinity : 0;

    // Average win/loss
    const averageWin = winningTrades.length > 0
      ? winningTrades.reduce((sum, t) => sum + (t.pnl - t.fee), 0) / winningTrades.length
      : 0;
    
    const averageLoss = losingTrades.length > 0
      ? losingTrades.reduce((sum, t) => sum + Math.abs(t.pnl - t.fee), 0) / losingTrades.length
      : 0;

    // Largest win/loss
    const largestWin = winningTrades.length > 0
      ? Math.max(...winningTrades.map(t => t.pnl - t.fee))
      : 0;
    
    const largestLoss = losingTrades.length > 0
      ? Math.min(...losingTrades.map(t => t.pnl - t.fee))
      : 0;

    const averageTrade = totalReturn / trades.length;

    return {
      totalReturn,
      totalReturnPercent,
      sharpeRatio,
      maxDrawdown,
      maxDrawdownPercent,
      winRate,
      profitFactor,
      totalTrades: trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      averageWin,
      averageLoss,
      largestWin,
      largestLoss,
      averageTrade,
    };
  }

  /**
   * Calculate maximum drawdown
   */
  private calculateMaxDrawdown(balances: number[], initialBalance: number): {
    maxDrawdown: number;
    maxDrawdownPercent: number;
  } {
    if (balances.length === 0) {
      return { maxDrawdown: 0, maxDrawdownPercent: 0 };
    }

    let maxBalance = balances[0];
    let maxDrawdown = 0;
    let maxDrawdownPercent = 0;

    for (const balance of balances) {
      if (balance > maxBalance) {
        maxBalance = balance;
      }

      const drawdown = maxBalance - balance;
      const drawdownPercent = (drawdown / maxBalance) * 100;

      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }

      if (drawdownPercent > maxDrawdownPercent) {
        maxDrawdownPercent = drawdownPercent;
      }
    }

    return { maxDrawdown, maxDrawdownPercent };
  }

  /**
   * Calculate Sharpe Ratio
   */
  private calculateSharpeRatio(trades: TradeRecord[]): number {
    if (trades.length === 0) {
      return 0;
    }

    // Calculate returns
    const returns = trades.map(t => t.pnlPercent);

    // Calculate mean return
    const meanReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;

    // Calculate standard deviation
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    // Sharpe Ratio (assuming risk-free rate = 0 for simplicity)
    if (stdDev === 0) {
      return 0;
    }

    return meanReturn / stdDev;
  }

  /**
   * Get empty metrics
   */
  private getEmptyMetrics(): PerformanceMetrics {
    return {
      totalReturn: 0,
      totalReturnPercent: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      maxDrawdownPercent: 0,
      winRate: 0,
      profitFactor: 0,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      averageWin: 0,
      averageLoss: 0,
      largestWin: 0,
      largestLoss: 0,
      averageTrade: 0,
    };
  }

  /**
   * Generate equity curve
   */
  generateEquityCurve(initialBalance: number, trades: TradeRecord[]): Array<{ date: Date; balance: number }> {
    let balance = initialBalance;
    const equityCurve: Array<{ date: Date; balance: number }> = [
      { date: trades[0]?.entryTime || new Date(), balance: initialBalance },
    ];

    for (const trade of trades) {
      const netPnl = trade.pnl - trade.fee;
      balance += netPnl;
      equityCurve.push({
        date: trade.exitTime,
        balance,
      });
    }

    return equityCurve;
  }
}

// Singleton instance
let performanceAnalyzerInstance: PerformanceAnalyzer | null = null;

export function getPerformanceAnalyzer(): PerformanceAnalyzer {
  if (!performanceAnalyzerInstance) {
    performanceAnalyzerInstance = new PerformanceAnalyzer();
  }
  return performanceAnalyzerInstance;
}
