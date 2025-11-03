import { Elysia } from 'elysia';
import { strategiesRoutes } from './strategies';
import { tradesRoutes } from './trades';
import { positionsRoutes } from './positions';
import { backtestRoutes } from './backtest';
import { portfolioRoutes } from './portfolio';
import { performanceRoutes } from './performance';

export const routes = new Elysia()
  .use(strategiesRoutes)
  .use(tradesRoutes)
  .use(positionsRoutes)
  .use(backtestRoutes)
  .use(portfolioRoutes)
  .use(performanceRoutes);
