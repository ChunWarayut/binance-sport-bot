import { Elysia } from 'elysia';
import { getBinanceClient } from '../services/binance/binanceClient';
import { db } from '../db';
import { positions, trades } from '../db/schema';
import { eq } from 'drizzle-orm';

export const portfolioRoutes = new Elysia({ prefix: '/api/portfolio' })
  .get('/', async () => {
    try {
      let balances: any[] = [];
      let totalValue = 0;
      
      // Try to get account balance, but don't fail if API key is invalid
      try {
        const client = getBinanceClient();
        const account = await client.getAccountInfo();
        balances = account.balances
          .map((b: any) => ({
            asset: b.asset,
            free: parseFloat(b.free),
            locked: parseFloat(b.locked),
            total: parseFloat(b.free) + parseFloat(b.locked),
          }))
          .filter((b: any) => b.total > 0);

        const usdtBalance = balances.find((b: any) => b.asset === 'USDT');
        totalValue += usdtBalance ? usdtBalance.total : 0;
      } catch (apiError: any) {
        // If API key is invalid, just return empty balances
        console.warn('Binance API error (portfolio):', apiError.message);
        balances = [];
      }

      // Get open positions from database
      const openPositions = await db
        .select()
        .from(positions)
        .where(eq(positions.isOpen, true));

      // Calculate value from positions
      for (const position of openPositions) {
        const currentPrice = parseFloat(position.currentPrice || position.entryPrice || '0');
        const quantity = parseFloat(position.quantity);
        totalValue += currentPrice * quantity;
      }

      // Get recent trades summary
      const recentTrades = await db
        .select()
        .from(trades)
        .orderBy(trades.executedAt)
        .limit(10);

      return {
        success: true,
        data: {
          balances,
          openPositions: openPositions.length,
          totalValue,
          recentTrades: recentTrades.length,
        },
      };
    } catch (error) {
      console.error('Portfolio error:', error);
      return {
        success: false,
        error: String(error),
        data: {
          balances: [],
          openPositions: 0,
          totalValue: 0,
          recentTrades: 0,
        },
      };
    }
  })
  .get('/summary', async () => {
    try {
      // Get all closed positions with PnL
      const closedPositions = await db
        .select()
        .from(positions)
        .where(eq(positions.isOpen, false));

      const totalPnL = closedPositions.reduce((sum, pos) => {
        return sum + parseFloat(pos.unrealizedPnl || '0');
      }, 0);

      // Get all trades
      const allTrades = await db.select().from(trades);
      const totalTradeValue = allTrades.reduce((sum, trade) => {
        const value = parseFloat(trade.price) * parseFloat(trade.quantity);
        return sum + value;
      }, 0);

      return {
        success: true,
        data: {
          totalClosedPositions: closedPositions.length,
          totalPnL,
          totalTrades: allTrades.length,
          totalTradeValue,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: String(error),
      };
    }
  });
