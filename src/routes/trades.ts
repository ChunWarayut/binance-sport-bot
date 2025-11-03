import { Elysia } from 'elysia';
import { db } from '../db';
import { trades, strategies } from '../db/schema';
import { eq, desc } from 'drizzle-orm';

export const tradesRoutes = new Elysia({ prefix: '/api/trades' })
  .get('/', async ({ query }) => {
    const strategyId = query.strategyId as string | undefined;
    const symbol = query.symbol as string | undefined;
    const limit = parseInt(query.limit as string || '100', 10);

    let queryBuilder = db.select({
      id: trades.id,
      positionId: trades.positionId,
      strategyId: trades.strategyId,
      strategyName: strategies.name,
      symbol: trades.symbol,
      side: trades.side,
      orderType: trades.orderType,
      quantity: trades.quantity,
      price: trades.price,
      fee: trades.fee,
      feeAsset: trades.feeAsset,
      pnl: trades.pnl,
      pnlPercent: trades.pnlPercent,
      status: trades.status,
      executedAt: trades.executedAt,
      createdAt: trades.createdAt,
    })
      .from(trades)
      .leftJoin(strategies, eq(trades.strategyId, strategies.id))
      .orderBy(desc(trades.executedAt))
      .limit(limit);

    if (strategyId) {
      queryBuilder = queryBuilder.where(eq(trades.strategyId, strategyId));
    }

    if (symbol) {
      queryBuilder = queryBuilder.where(eq(trades.symbol, symbol));
    }

    const allTrades = await queryBuilder;

    return {
      success: true,
      data: allTrades,
      count: allTrades.length,
    };
  })
  .get('/:id', async ({ params }) => {
    const [trade] = await db
      .select({
        id: trades.id,
        positionId: trades.positionId,
        strategyId: trades.strategyId,
        strategyName: strategies.name,
        symbol: trades.symbol,
        side: trades.side,
        orderType: trades.orderType,
        quantity: trades.quantity,
        price: trades.price,
        fee: trades.fee,
        feeAsset: trades.feeAsset,
        pnl: trades.pnl,
        pnlPercent: trades.pnlPercent,
        binanceOrderId: trades.binanceOrderId,
        status: trades.status,
        executedAt: trades.executedAt,
        createdAt: trades.createdAt,
      })
      .from(trades)
      .leftJoin(strategies, eq(trades.strategyId, strategies.id))
      .where(eq(trades.id, params.id))
      .limit(1);

    if (!trade) {
      return {
        success: false,
        error: 'Trade not found',
      };
    }

    return {
      success: true,
      data: trade,
    };
  });
