export type StrategyType = 'grid' | 'dca' | 'momentum' | 'mean_reversion';

export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT';
export type OrderStatus = 'NEW' | 'FILLED' | 'PARTIALLY_FILLED' | 'CANCELED' | 'REJECTED';

export interface TradingPair {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  price: number;
  volume24h: number;
  score?: number;
}

export interface Position {
  id: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  strategyId: string;
  openedAt: Date;
}

export interface Trade {
  id: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  price: number;
  fee: number;
  pnl: number;
  pnlPercent: number;
  strategyId: string;
  executedAt: Date;
}

export interface Strategy {
  id: string;
  type: StrategyType;
  name: string;
  symbol?: string;
  isActive: boolean;
  config: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface RiskLimits {
  maxPositionSizePercent: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  dailyLossLimitPercent: number;
  maxConcurrentPositions: number;
}

export interface BacktestResult {
  id: string;
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
  winRate: number;
  totalTrades: number;
  config: Record<string, unknown>;
}
