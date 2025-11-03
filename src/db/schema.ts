import { pgTable, uuid, varchar, decimal, integer, boolean, timestamp, jsonb, text } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Users table
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }),
  binanceApiKey: varchar('binance_api_key', { length: 255 }).notNull(),
  binanceApiSecret: varchar('binance_api_secret', { length: 255 }).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Trading pairs table
export const tradingPairs = pgTable('trading_pairs', {
  id: uuid('id').defaultRandom().primaryKey(),
  symbol: varchar('symbol', { length: 50 }).notNull().unique(),
  baseAsset: varchar('base_asset', { length: 20 }).notNull(),
  quoteAsset: varchar('quote_asset', { length: 20 }).notNull(),
  price: decimal('price', { precision: 18, scale: 8 }),
  volume24h: decimal('volume_24h', { precision: 18, scale: 2 }),
  score: decimal('score', { precision: 10, scale: 4 }),
  isActive: boolean('is_active').default(true).notNull(),
  lastUpdated: timestamp('last_updated').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Strategies table
export const strategies = pgTable('strategies', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  type: varchar('type', { length: 50 }).notNull(), // grid, dca, momentum, mean_reversion
  name: varchar('name', { length: 255 }).notNull(),
  symbol: varchar('symbol', { length: 50 }), // null if auto-select
  isActive: boolean('is_active').default(false).notNull(),
  config: jsonb('config').notNull(), // Strategy-specific configuration
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Positions table
export const positions = pgTable('positions', {
  id: uuid('id').defaultRandom().primaryKey(),
  strategyId: uuid('strategy_id').references(() => strategies.id).notNull(),
  symbol: varchar('symbol', { length: 50 }).notNull(),
  side: varchar('side', { length: 10 }).notNull(), // BUY, SELL
  quantity: decimal('quantity', { precision: 18, scale: 8 }).notNull(),
  entryPrice: decimal('entry_price', { precision: 18, scale: 8 }).notNull(),
  currentPrice: decimal('current_price', { precision: 18, scale: 8 }),
  stopLoss: decimal('stop_loss', { precision: 18, scale: 8 }),
  takeProfit: decimal('take_profit', { precision: 18, scale: 8 }),
  unrealizedPnl: decimal('unrealized_pnl', { precision: 18, scale: 8 }).default('0'),
  unrealizedPnlPercent: decimal('unrealized_pnl_percent', { precision: 10, scale: 4 }).default('0'),
  openedAt: timestamp('opened_at').defaultNow().notNull(),
  closedAt: timestamp('closed_at'),
  isOpen: boolean('is_open').default(true).notNull(),
});

// Trades table
export const trades = pgTable('trades', {
  id: uuid('id').defaultRandom().primaryKey(),
  positionId: uuid('position_id').references(() => positions.id),
  strategyId: uuid('strategy_id').references(() => strategies.id).notNull(),
  symbol: varchar('symbol', { length: 50 }).notNull(),
  side: varchar('side', { length: 10 }).notNull(), // BUY, SELL
  orderType: varchar('order_type', { length: 20 }).notNull(), // MARKET, LIMIT
  quantity: decimal('quantity', { precision: 18, scale: 8 }).notNull(),
  price: decimal('price', { precision: 18, scale: 8 }).notNull(),
  fee: decimal('fee', { precision: 18, scale: 8 }).default('0'),
  feeAsset: varchar('fee_asset', { length: 20 }),
  pnl: decimal('pnl', { precision: 18, scale: 8 }).default('0'),
  pnlPercent: decimal('pnl_percent', { precision: 10, scale: 4 }).default('0'),
  binanceOrderId: varchar('binance_order_id', { length: 100 }),
  status: varchar('status', { length: 50 }).notNull(), // NEW, FILLED, PARTIALLY_FILLED, CANCELED, REJECTED
  executedAt: timestamp('executed_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Backtest results table
export const backtestResults = pgTable('backtest_results', {
  id: uuid('id').defaultRandom().primaryKey(),
  strategyType: varchar('strategy_type', { length: 50 }).notNull(),
  symbol: varchar('symbol', { length: 50 }).notNull(),
  startDate: timestamp('start_date').notNull(),
  endDate: timestamp('end_date').notNull(),
  initialBalance: decimal('initial_balance', { precision: 18, scale: 8 }).notNull(),
  finalBalance: decimal('final_balance', { precision: 18, scale: 8 }).notNull(),
  totalReturn: decimal('total_return', { precision: 18, scale: 8 }).notNull(),
  totalReturnPercent: decimal('total_return_percent', { precision: 10, scale: 4 }).notNull(),
  sharpeRatio: decimal('sharpe_ratio', { precision: 10, scale: 4 }),
  maxDrawdown: decimal('max_drawdown', { precision: 10, scale: 4 }),
  maxDrawdownPercent: decimal('max_drawdown_percent', { precision: 10, scale: 4 }),
  winRate: decimal('win_rate', { precision: 5, scale: 2 }),
  totalTrades: integer('total_trades').notNull(),
  winningTrades: integer('winning_trades').default(0),
  losingTrades: integer('losing_trades').default(0),
  config: jsonb('config').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Market data table (สำหรับเก็บ historical data)
export const marketData = pgTable('market_data', {
  id: uuid('id').defaultRandom().primaryKey(),
  symbol: varchar('symbol', { length: 50 }).notNull(),
  openTime: timestamp('open_time').notNull(),
  open: decimal('open', { precision: 18, scale: 8 }).notNull(),
  high: decimal('high', { precision: 18, scale: 8 }).notNull(),
  low: decimal('low', { precision: 18, scale: 8 }).notNull(),
  close: decimal('close', { precision: 18, scale: 8 }).notNull(),
  volume: decimal('volume', { precision: 18, scale: 8 }).notNull(),
  interval: varchar('interval', { length: 20 }).notNull(), // 1m, 5m, 1h, 1d, etc.
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Risk limits table
export const riskLimits = pgTable('risk_limits', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  maxPositionSizePercent: decimal('max_position_size_percent', { precision: 5, scale: 2 }).default('10').notNull(),
  stopLossPercent: decimal('stop_loss_percent', { precision: 5, scale: 2 }).default('2.5').notNull(),
  takeProfitPercent: decimal('take_profit_percent', { precision: 5, scale: 2 }).default('5').notNull(),
  dailyLossLimitPercent: decimal('daily_loss_limit_percent', { precision: 5, scale: 2 }).default('5').notNull(),
  maxConcurrentPositions: integer('max_concurrent_positions').default(5).notNull(),
  dailyLossAmount: decimal('daily_loss_amount', { precision: 18, scale: 8 }).default('0'),
  lastResetDate: timestamp('last_reset_date').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  strategies: many(strategies),
  riskLimits: many(riskLimits),
}));

export const strategiesRelations = relations(strategies, ({ one, many }) => ({
  user: one(users, {
    fields: [strategies.userId],
    references: [users.id],
  }),
  positions: many(positions),
  trades: many(trades),
}));

export const positionsRelations = relations(positions, ({ one, many }) => ({
  strategy: one(strategies, {
    fields: [positions.strategyId],
    references: [strategies.id],
  }),
  trades: many(trades),
}));

export const tradesRelations = relations(trades, ({ one }) => ({
  position: one(positions, {
    fields: [trades.positionId],
    references: [positions.id],
  }),
  strategy: one(strategies, {
    fields: [trades.strategyId],
    references: [strategies.id],
  }),
}));

export const riskLimitsRelations = relations(riskLimits, ({ one }) => ({
  user: one(users, {
    fields: [riskLimits.userId],
    references: [users.id],
  }),
}));
