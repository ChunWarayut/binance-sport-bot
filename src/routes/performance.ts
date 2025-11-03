import { Elysia } from 'elysia';
import { db } from '../db';
import { trades, positions, strategies } from '../db/schema';
import { eq, desc, and, gte } from 'drizzle-orm';

export const performanceRoutes = new Elysia({ prefix: '/api/performance' })
  .get('/', async ({ query }) => {
    const strategyId = query.strategyId as string | undefined;
    const days = parseInt(query.days as string || '30', 10);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    let tradesQuery = db
      .select()
      .from(trades)
      .where(gte(trades.executedAt, startDate))
      .orderBy(desc(trades.executedAt));

    if (strategyId) {
      tradesQuery = tradesQuery.where(eq(trades.strategyId, strategyId));
    }

    const allTrades = await tradesQuery;

    // Calculate metrics
    const totalPnL = allTrades.reduce((sum, trade) => {
      return sum + parseFloat(trade.pnl || '0');
    }, 0);

    const winningTrades = allTrades.filter(t => parseFloat(t.pnl || '0') > 0);
    const losingTrades = allTrades.filter(t => parseFloat(t.pnl || '0') < 0);

    const winRate = allTrades.length > 0
      ? (winningTrades.length / allTrades.length) * 100
      : 0;

    const avgWin = winningTrades.length > 0
      ? winningTrades.reduce((sum, t) => sum + parseFloat(t.pnl || '0'), 0) / winningTrades.length
      : 0;

    const avgLoss = losingTrades.length > 0
      ? losingTrades.reduce((sum, t) => sum + parseFloat(t.pnl || '0'), 0) / losingTrades.length
      : 0;

    // Get open positions
    let positionsQuery = db
      .select()
      .from(positions)
      .where(eq(positions.isOpen, true));

    if (strategyId) {
      positionsQuery = positionsQuery.where(eq(positions.strategyId, strategyId));
    }

    const openPositions = await positionsQuery;
    const unrealizedPnL = openPositions.reduce((sum, pos) => {
      return sum + parseFloat(pos.unrealizedPnl || '0');
    }, 0);

    return {
      success: true,
      data: {
        period: `${days} days`,
        totalTrades: allTrades.length,
        winningTrades: winningTrades.length,
        losingTrades: losingTrades.length,
        winRate: winRate.toFixed(2),
        totalPnL: totalPnL.toFixed(2),
        unrealizedPnL: unrealizedPnL.toFixed(2),
        averageWin: avgWin.toFixed(2),
        averageLoss: avgLoss.toFixed(2),
        profitFactor: avgLoss !== 0 ? (avgWin / Math.abs(avgLoss)).toFixed(2) : 'N/A',
      },
    };
  })
  .get('/strategies', async () => {
    // Get performance by strategy
    const allStrategies = await db.select().from(strategies);

    const strategyPerformance = await Promise.all(
      allStrategies.map(async (strategy) => {
        const strategyTrades = await db
          .select()
          .from(trades)
          .where(eq(trades.strategyId, strategy.id));

        const totalPnL = strategyTrades.reduce((sum, trade) => {
          return sum + parseFloat(trade.pnl || '0');
        }, 0);

        const winningTrades = strategyTrades.filter(t => parseFloat(t.pnl || '0') > 0);
        const winRate = strategyTrades.length > 0
          ? (winningTrades.length / strategyTrades.length) * 100
          : 0;

        return {
          strategyId: strategy.id,
          strategyName: strategy.name,
          strategyType: strategy.type,
          totalTrades: strategyTrades.length,
          winningTrades: winningTrades.length,
          winRate: winRate.toFixed(2),
          totalPnL: totalPnL.toFixed(2),
        };
      })
    );

    return {
      success: true,
      data: strategyPerformance,
    };
  });
