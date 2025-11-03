export const config = {
  binance: {
    apiKey: process.env.BINANCE_API_KEY || '',
    apiSecret: process.env.BINANCE_API_SECRET || '',
    testnet: process.env.BINANCE_TESTNET === 'true',
  },
  database: {
    url: process.env.DATABASE_URL || 'postgresql://user:password@localhost:5432/binance_trading_bot',
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
  },
  risk: {
    maxPositionSizePercent: parseFloat(process.env.MAX_POSITION_SIZE_PERCENT || '10'),
    stopLossPercent: parseFloat(process.env.STOP_LOSS_PERCENT || '2.5'),
    takeProfitPercent: parseFloat(process.env.TAKE_PROFIT_PERCENT || '5'),
    dailyLossLimitPercent: parseFloat(process.env.DAILY_LOSS_LIMIT_PERCENT || '5'),
    maxConcurrentPositions: parseInt(process.env.MAX_CONCURRENT_POSITIONS || '5', 10),
  },
  trading: {
    topVolumePairsCount: parseInt(process.env.TOP_VOLUME_PAIRS_COUNT || '30', 10),
    pairScoringUpdateInterval: parseInt(process.env.PAIR_SCORING_UPDATE_INTERVAL || '3600000', 10),
    technicalIndicatorWindow: parseInt(process.env.TECHNICAL_INDICATOR_WINDOW || '100', 10),
  },
};

// Validate required config
if (!config.binance.apiKey || !config.binance.apiSecret) {
  console.warn('⚠️  Binance API credentials not set. Please configure BINANCE_API_KEY and BINANCE_API_SECRET');
}
