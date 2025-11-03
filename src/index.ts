import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { swagger } from '@elysiajs/swagger';
import { routes } from './routes';
import { getStrategyManager } from './strategies/strategyManager';
import { getPairSelector } from './services/analysis/pairSelector';
import { getStopLossManager } from './services/risk/stopLossManager';
import { GridStrategy } from './strategies/gridStrategy';
import { DCAStrategy } from './strategies/dcaStrategy';
import { MomentumStrategy } from './strategies/momentumStrategy';
import { MeanReversionStrategy } from './strategies/meanReversionStrategy';

// Initialize strategy manager and register strategy types
const strategyManager = getStrategyManager();
strategyManager.registerStrategyType('grid', GridStrategy as any);
strategyManager.registerStrategyType('dca', DCAStrategy as any);
strategyManager.registerStrategyType('momentum', MomentumStrategy as any);
strategyManager.registerStrategyType('mean_reversion', MeanReversionStrategy as any);

// Auto-start function
async function autoStart() {
  try {
    console.log('🚀 Initializing trading bot...');
    
    // Load all strategies from database
    await strategyManager.loadAllStrategiesFromDb();
    console.log('✅ Strategies loaded from database');
    
    // Start active strategies
    const allStrategies = strategyManager.getAllStrategies();
    const activeCount = allStrategies.filter(s => s.getIsActive()).length;
    
    if (activeCount > 0) {
      console.log(`✅ Starting ${activeCount} active strategies...`);
      
      // Start execution loop (check every 1 minute by default)
      const executionInterval = parseInt(process.env.EXECUTION_INTERVAL_MS || '60000', 10);
      strategyManager.startExecutionLoop(executionInterval);
      
      // Update pair selection periodically
      const pairSelector = getPairSelector();
      await pairSelector.updatePairs();
      console.log('✅ Pair selection updated');
      
      // Setup periodic pair updates (every hour)
      setInterval(async () => {
        try {
          await pairSelector.updatePairs();
          console.log('✅ Pair selection refreshed');
        } catch (error) {
          console.error('Error updating pairs:', error);
        }
      }, 3600000); // 1 hour

      // Periodic unrealized PnL updates (and SL/TP checks)
      const slManager = getStopLossManager();
      const pnlInterval = parseInt(process.env.UNREALIZED_PNL_UPDATE_INTERVAL_MS || '30000', 10);
      setInterval(async () => {
        try {
          await slManager.checkAndExecuteStopLosses();
        } catch (error) {
          console.error('Error updating unrealized PnL / SL-TP checks:', error);
        }
      }, pnlInterval);

      console.log('✅ Trading bot is running!');
    } else {
      console.log('⚠️  No active strategies found. Create and activate strategies via API or Dashboard.');
      console.log('📖 See API documentation at /swagger');
    }
  } catch (error) {
    console.error('❌ Error during auto-start:', error);
  }
}

const app = new Elysia()
  .use(cors())
  .use(swagger({
    documentation: {
      info: {
        title: 'Binance Spot Trading Bot API',
        version: '1.0.0',
        description: 'API for managing Binance spot trading strategies',
      },
      tags: [
        { name: 'strategies', description: 'Strategy management endpoints' },
        { name: 'trades', description: 'Trade history endpoints' },
        { name: 'positions', description: 'Position management endpoints' },
        { name: 'backtest', description: 'Backtesting endpoints' },
        { name: 'portfolio', description: 'Portfolio endpoints' },
        { name: 'performance', description: 'Performance metrics endpoints' },
      ],
    },
  }))
  .get('/', () => ({
    message: 'Binance Spot Trading Bot API',
    version: '1.0.0',
    endpoints: {
      strategies: '/api/strategies',
      trades: '/api/trades',
      positions: '/api/positions',
      backtest: '/api/backtest',
      portfolio: '/api/portfolio',
      performance: '/api/performance',
    },
    status: {
      strategiesLoaded: strategyManager.getAllStrategies().length,
      activeStrategies: strategyManager.getAllStrategies().filter(s => s.getIsActive()).length,
      executionLoopRunning: strategyManager.getAllStrategies().length > 0,
    },
  }))
  .use(routes)
  .get('/dashboard', async () => {
    try {
      const file = await import('fs/promises');
      const html = await file.readFile('./public/index.html', 'utf-8');
      return new Response(html, {
        headers: { 'Content-Type': 'text/html' },
      });
    } catch {
      return new Response('Dashboard not available', { status: 404 });
    }
  })
  .listen(process.env.PORT || 3000);

console.log(`🦊 Server is running on http://${app.server?.hostname}:${app.server?.port}`);
console.log(`📚 API Documentation: http://${app.server?.hostname}:${app.server?.port}/swagger`);
console.log(`📊 Dashboard: http://${app.server?.hostname}:${app.server?.port}/dashboard`);

// Auto-start after server is ready (use setTimeout to ensure server is fully started)
setTimeout(() => {
  autoStart();
}, 1000);
