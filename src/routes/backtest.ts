import { Elysia } from 'elysia';
import { z } from 'zod';
import { getBacktestEngine } from '../services/backtest/backtestEngine';
import { db } from '../db';
import { backtestResults } from '../db/schema';
import { eq } from 'drizzle-orm';

const runBacktestSchema = z.object({
  strategyType: z.enum(['grid', 'dca', 'momentum', 'mean_reversion']),
  symbol: z.string(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  initialBalance: z.number().positive(),
  strategyConfig: z.record(z.unknown()),
  interval: z.string().optional().default('1h'),
});

export const backtestRoutes = new Elysia({ prefix: '/api/backtest' })
  .post('/', async ({ body }) => {
    const validated = runBacktestSchema.parse(body);

    const engine = getBacktestEngine();

    const result = await engine.runBacktest({
      strategyType: validated.strategyType,
      symbol: validated.symbol,
      startDate: new Date(validated.startDate),
      endDate: new Date(validated.endDate),
      initialBalance: validated.initialBalance,
      strategyConfig: validated.strategyConfig,
      interval: validated.interval,
    });

    return {
      success: true,
      data: {
        id: result.id,
        strategyType: result.strategyType,
        symbol: result.symbol,
        startDate: result.startDate,
        endDate: result.endDate,
        initialBalance: result.initialBalance,
        finalBalance: result.finalBalance,
        totalReturn: result.totalReturn,
        totalReturnPercent: result.totalReturnPercent,
        sharpeRatio: result.sharpeRatio,
        maxDrawdown: result.maxDrawdown,
        maxDrawdownPercent: result.maxDrawdownPercent,
        winRate: result.winRate,
        totalTrades: result.totalTrades,
        winningTrades: result.winningTrades,
        losingTrades: result.losingTrades,
        equityCurve: result.equityCurve,
      },
    };
  })
  .get('/', async () => {
    const allResults = await db.select().from(backtestResults).orderBy(backtestResults.createdAt);
    return {
      success: true,
      data: allResults,
    };
  })
  .get('/:id', async ({ params }) => {
    const [result] = await db
      .select()
      .from(backtestResults)
      .where(eq(backtestResults.id, params.id))
      .limit(1);

    if (!result) {
      return {
        success: false,
        error: 'Backtest result not found',
      };
    }

    return {
      success: true,
      data: result,
    };
  });
