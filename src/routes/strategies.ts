import { Elysia } from 'elysia';
import { z } from 'zod';
import { db } from '../db';
import { strategies } from '../db/schema';
import { eq } from 'drizzle-orm';
import { getStrategyManager } from '../strategies/strategyManager';
import { GridStrategy } from '../strategies/gridStrategy';
import { DCAStrategy } from '../strategies/dcaStrategy';
import { MomentumStrategy } from '../strategies/momentumStrategy';
import { MeanReversionStrategy } from '../strategies/meanReversionStrategy';

const strategyManager = getStrategyManager();

// Register strategy types
strategyManager.registerStrategyType('grid', GridStrategy);
strategyManager.registerStrategyType('dca', DCAStrategy);
strategyManager.registerStrategyType('momentum', MomentumStrategy);
strategyManager.registerStrategyType('mean_reversion', MeanReversionStrategy);

const createStrategySchema = z.object({
  type: z.enum(['grid', 'dca', 'momentum', 'mean_reversion']),
  name: z.string().min(1),
  symbol: z.string().optional(),
  config: z.record(z.unknown()),
  userId: z.string().uuid(),
});

const updateStrategySchema = z.object({
  name: z.string().min(1).optional(),
  config: z.record(z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

export const strategiesRoutes = new Elysia({ prefix: '/api/strategies' })
  .get('/', async () => {
    const allStrategies = await db.select().from(strategies);
    return {
      success: true,
      data: allStrategies,
    };
  })
  .get('/:id', async ({ params }) => {
    const [strategy] = await db
      .select()
      .from(strategies)
      .where(eq(strategies.id, params.id))
      .limit(1);

    if (!strategy) {
      return {
        success: false,
        error: 'Strategy not found',
      };
    }

    return {
      success: true,
      data: strategy,
    };
  })
  .post('/', async ({ body }) => {
    const validated = createStrategySchema.parse(body);

    const [strategy] = await db
      .insert(strategies)
      .values({
        userId: validated.userId,
        type: validated.type,
        name: validated.name,
        symbol: validated.symbol,
        config: validated.config as any,
        isActive: false,
      })
      .returning();

    // Load strategy into manager
    await strategyManager.loadStrategy(strategy.id);

    return {
      success: true,
      data: strategy,
    };
  })
  .put('/:id', async ({ params, body }) => {
    const validated = updateStrategySchema.parse(body);

    const [strategy] = await db
      .update(strategies)
      .set({
        ...validated,
        updatedAt: new Date(),
      })
      .where(eq(strategies.id, params.id))
      .returning();

    if (!strategy) {
      return {
        success: false,
        error: 'Strategy not found',
      };
    }

    // Update strategy instance if loaded
    const loadedStrategy = strategyManager.getStrategy(strategy.id);
    if (loadedStrategy) {
      if (validated.config) {
        await loadedStrategy.updateConfig(validated.config);
      }
      if (validated.isActive !== undefined) {
        if (validated.isActive) {
          await strategyManager.startStrategy(strategy.id);
        } else {
          await strategyManager.stopStrategy(strategy.id);
        }
      }
    }

    return {
      success: true,
      data: strategy,
    };
  })
  .delete('/:id', async ({ params }) => {
    // Stop strategy first
    await strategyManager.stopStrategy(params.id);
    await strategyManager.unloadStrategy(params.id);

    await db.delete(strategies).where(eq(strategies.id, params.id));

    return {
      success: true,
      message: 'Strategy deleted',
    };
  })
  .post('/:id/start', async ({ params }) => {
    try {
      // Ensure strategy is loaded first
      const loadedStrategy = strategyManager.getStrategy(params.id);
      if (!loadedStrategy) {
        await strategyManager.loadStrategy(params.id);
      }
      
      await strategyManager.startStrategy(params.id);
      
      // Update database
      await db
        .update(strategies)
        .set({
          isActive: true,
          updatedAt: new Date(),
        })
        .where(eq(strategies.id, params.id));

      return {
        success: true,
        message: 'Strategy started',
      };
    } catch (error: any) {
      console.error(`Error starting strategy ${params.id}:`, error);
      return {
        success: false,
        error: error.message || String(error),
      };
    }
  })
  .post('/:id/stop', async ({ params }) => {
    try {
      await strategyManager.stopStrategy(params.id);
      
      // Update database
      await db
        .update(strategies)
        .set({
          isActive: false,
          updatedAt: new Date(),
        })
        .where(eq(strategies.id, params.id));

      return {
        success: true,
        message: 'Strategy stopped',
      };
    } catch (error: any) {
      console.error(`Error stopping strategy ${params.id}:`, error);
      return {
        success: false,
        error: error.message || String(error),
      };
    }
  });
