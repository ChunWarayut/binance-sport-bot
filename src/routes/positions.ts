import { Elysia } from 'elysia';
import { db } from '../db';
import { positions, strategies } from '../db/schema';
import { eq } from 'drizzle-orm';

export const positionsRoutes = new Elysia({ prefix: '/api/positions' })
  .get('/', async ({ query }) => {
    const strategyId = query.strategyId as string | undefined;
    const isOpen = query.isOpen === 'true' ? true : query.isOpen === 'false' ? false : undefined;

    let queryBuilder = db.select({
      id: positions.id,
      strategyId: positions.strategyId,
      strategyName: strategies.name,
      symbol: positions.symbol,
      side: positions.side,
      quantity: positions.quantity,
      entryPrice: positions.entryPrice,
      currentPrice: positions.currentPrice,
      stopLoss: positions.stopLoss,
      takeProfit: positions.takeProfit,
      unrealizedPnl: positions.unrealizedPnl,
      unrealizedPnlPercent: positions.unrealizedPnlPercent,
      openedAt: positions.openedAt,
      closedAt: positions.closedAt,
      isOpen: positions.isOpen,
    })
      .from(positions)
      .leftJoin(strategies, eq(positions.strategyId, strategies.id));

    if (strategyId) {
      queryBuilder = queryBuilder.where(eq(positions.strategyId, strategyId));
    }

    if (isOpen !== undefined) {
      queryBuilder = queryBuilder.where(eq(positions.isOpen, isOpen));
    }

    const allPositions = await queryBuilder;

    return {
      success: true,
      data: allPositions,
      count: allPositions.length,
    };
  })
  .get('/open', async () => {
    const openPositions = await db
      .select({
        id: positions.id,
        strategyId: positions.strategyId,
        strategyName: strategies.name,
        symbol: positions.symbol,
        side: positions.side,
        quantity: positions.quantity,
        entryPrice: positions.entryPrice,
        currentPrice: positions.currentPrice,
        stopLoss: positions.stopLoss,
        takeProfit: positions.takeProfit,
        unrealizedPnl: positions.unrealizedPnl,
        unrealizedPnlPercent: positions.unrealizedPnlPercent,
        openedAt: positions.openedAt,
        isOpen: positions.isOpen,
      })
      .from(positions)
      .leftJoin(strategies, eq(positions.strategyId, strategies.id))
      .where(eq(positions.isOpen, true));

    return {
      success: true,
      data: openPositions,
      count: openPositions.length,
    };
  })
  .get('/:id', async ({ params }) => {
    const [position] = await db
      .select({
        id: positions.id,
        strategyId: positions.strategyId,
        strategyName: strategies.name,
        symbol: positions.symbol,
        side: positions.side,
        quantity: positions.quantity,
        entryPrice: positions.entryPrice,
        currentPrice: positions.currentPrice,
        stopLoss: positions.stopLoss,
        takeProfit: positions.takeProfit,
        unrealizedPnl: positions.unrealizedPnl,
        unrealizedPnlPercent: positions.unrealizedPnlPercent,
        openedAt: positions.openedAt,
        closedAt: positions.closedAt,
        isOpen: positions.isOpen,
      })
      .from(positions)
      .leftJoin(strategies, eq(positions.strategyId, strategies.id))
      .where(eq(positions.id, params.id))
      .limit(1);

    if (!position) {
      return {
        success: false,
        error: 'Position not found',
      };
    }

    return {
      success: true,
      data: position,
    };
  });
