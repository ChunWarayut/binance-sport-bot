import { db } from './index';
import { users, strategies, riskLimits } from './schema';
import { eq } from 'drizzle-orm';

async function seed() {
  console.log('🌱 Seeding database...');

  try {
    // Create default user
    const [defaultUser] = await db
      .insert(users)
      .values({
        email: 'trader@example.com',
        name: 'Default Trader',
        binanceApiKey: process.env.BINANCE_API_KEY || 'your_api_key_here',
        binanceApiSecret: process.env.BINANCE_API_SECRET || 'your_api_secret_here',
        isActive: true,
      })
      .onConflictDoNothing()
      .returning();

    if (!defaultUser) {
      // User already exists, get it
      const [existingUser] = await db
        .select()
        .from(users)
        .where(eq(users.email, 'trader@example.com'))
        .limit(1);
      
      if (!existingUser) {
        throw new Error('Failed to create or find default user');
      }
      
      const userId = existingUser.id;
      
      // Create risk limits for user
      await db
        .insert(riskLimits)
        .values({
          userId,
          maxPositionSizePercent: '10',
          stopLossPercent: '2.5',
          takeProfitPercent: '5',
          dailyLossLimitPercent: '5',
          maxConcurrentPositions: 5,
        })
        .onConflictDoNothing();

      // Seed strategies
      await seedStrategies(userId);
    } else {
      // Create risk limits for new user
      await db.insert(riskLimits).values({
        userId: defaultUser.id,
        maxPositionSizePercent: '10',
        stopLossPercent: '2.5',
        takeProfitPercent: '5',
        dailyLossLimitPercent: '5',
        maxConcurrentPositions: 5,
      });

      // Seed strategies
      await seedStrategies(defaultUser.id);
    }

    console.log('✅ Database seeded successfully!');
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    throw error;
  }
}

async function seedStrategies(userId: string) {
  // Check if strategies already exist
  const existingStrategies = await db.select().from(strategies).where(eq(strategies.userId, userId));
  
  if (existingStrategies.length > 0) {
    console.log(`⚠️  Strategies already exist for user. Skipping seed.`);
    console.log(`   Found ${existingStrategies.length} existing strategies.`);
    return;
  }

  // Grid Strategy - BTC/USDT
  await db.insert(strategies).values({
    userId,
    type: 'grid',
    name: 'Grid Trading - BTC/USDT',
    symbol: 'BTCUSDT',
    isActive: false,
    config: {
      gridLevels: 10,
      gridSpacing: 1,
      quantityPerGrid: 0.001,
      maxPositions: 5,
    },
  });

  // Grid Strategy - ETH/USDT
  await db.insert(strategies).values({
    userId,
    type: 'grid',
    name: 'Grid Trading - ETH/USDT',
    symbol: 'ETHUSDT',
    isActive: false,
    config: {
      gridLevels: 8,
      gridSpacing: 1.5,
      quantityPerGrid: 0.01,
      maxPositions: 3,
    },
  });

  // DCA Strategy - BTC/USDT
  await db.insert(strategies).values({
    userId,
    type: 'dca',
    name: 'DCA Strategy - BTC/USDT',
    symbol: 'BTCUSDT',
    isActive: false,
    config: {
      amountPerPurchase: 50,
      purchaseInterval: 3600000, // 1 hour
      maxPurchases: 5,
      takeProfitPercent: 5,
      stopLossPercent: 2.5,
    },
  });

  // DCA Strategy - ETH/USDT
  await db.insert(strategies).values({
    userId,
    type: 'dca',
    name: 'DCA Strategy - ETH/USDT',
    symbol: 'ETHUSDT',
    isActive: false,
    config: {
      amountPerPurchase: 30,
      purchaseInterval: 7200000, // 2 hours
      maxPurchases: 4,
      takeProfitPercent: 6,
      stopLossPercent: 3,
    },
  });

  // Momentum Strategy - Auto-select pairs
  await db.insert(strategies).values({
    userId,
    type: 'momentum',
    name: 'Momentum Trading - Auto Select',
    symbol: null, // Auto-select
    isActive: false,
    config: {
      positionSizePercent: 5,
      takeProfitPercent: 5,
      stopLossPercent: 2.5,
      trailingStopPercent: 1.5,
      rsiPeriod: 14,
      rsiOversold: 30,
      rsiOverbought: 70,
      fastEMA: 12,
      slowEMA: 26,
      volumeSMA: 20,
      minVolumeRatio: 1.2,
    },
  });

  // Momentum Strategy - BTC/USDT
  await db.insert(strategies).values({
    userId,
    type: 'momentum',
    name: 'Momentum Trading - BTC/USDT',
    symbol: 'BTCUSDT',
    isActive: false,
    config: {
      positionSizePercent: 8,
      takeProfitPercent: 6,
      stopLossPercent: 3,
      rsiPeriod: 14,
      fastEMA: 12,
      slowEMA: 26,
    },
  });

  // Mean Reversion Strategy - Auto-select pairs
  await db.insert(strategies).values({
    userId,
    type: 'mean_reversion',
    name: 'Mean Reversion - Auto Select',
    symbol: null, // Auto-select
    isActive: false,
    config: {
      positionSizePercent: 5,
      takeProfitPercent: 2,
      stopLossPercent: 3,
      rsiPeriod: 14,
      rsiOversold: 30,
      rsiOverbought: 70,
      bollingerPeriod: 20,
      bollingerStdDev: 2,
      smaPeriod: 20,
      minRevertDistance: 2,
    },
  });

  // Mean Reversion Strategy - BTC/USDT
  await db.insert(strategies).values({
    userId,
    type: 'mean_reversion',
    name: 'Mean Reversion - BTC/USDT',
    symbol: 'BTCUSDT',
    isActive: false,
    config: {
      positionSizePercent: 7,
      takeProfitPercent: 2.5,
      stopLossPercent: 3.5,
      rsiPeriod: 14,
      bollingerPeriod: 20,
      minRevertDistance: 2,
    },
  });

  console.log('✅ Strategies seeded:');
  console.log('  - 2 Grid Strategies (BTC/USDT, ETH/USDT)');
  console.log('  - 2 DCA Strategies (BTC/USDT, ETH/USDT)');
  console.log('  - 2 Momentum Strategies (Auto-select, BTC/USDT)');
  console.log('  - 2 Mean Reversion Strategies (Auto-select, BTC/USDT)');
  console.log('  All strategies are inactive by default. Activate them via API or Dashboard.');
}

// Run seed if called directly
if (import.meta.main || process.argv[1]?.includes('seed.ts')) {
  seed()
    .then(() => {
      console.log('✅ Seed completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Seed failed:', error);
      process.exit(1);
    });
}

export { seed };
