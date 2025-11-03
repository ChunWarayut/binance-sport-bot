import { TradingPair } from '../../types';
import { getVolumeFilter } from './volumeFilter';
import { getPairScorer } from './pairScorer';
import { config } from '../../utils/config';
import { db } from '../../db';
import { tradingPairs } from '../../db/schema';
import { eq } from 'drizzle-orm';

export class PairSelector {
  private volumeFilter = getVolumeFilter();
  private pairScorer = getPairScorer();
  private cachedPairs: TradingPair[] = [];
  private lastUpdate: Date = new Date(0);
  private updateInterval: number;

  constructor() {
    this.updateInterval = config.trading.pairScoringUpdateInterval;
  }

  /**
   * Get best trading pairs (auto-select)
   */
  async getBestPairs(count: number = 10): Promise<TradingPair[]> {
    // Check if cache is still valid
    const now = new Date();
    const timeSinceUpdate = now.getTime() - this.lastUpdate.getTime();

    if (this.cachedPairs.length > 0 && timeSinceUpdate < this.updateInterval) {
      return this.cachedPairs.slice(0, count);
    }

    // Fetch and score pairs
    await this.updatePairs();

    return this.cachedPairs.slice(0, count);
  }

  /**
   * Update and score pairs
   */
  async updatePairs(): Promise<void> {
    try {
      // Get top volume pairs
      const topVolumePairs = await this.volumeFilter.getTopVolumePairs(
        config.trading.topVolumePairsCount
      );

      console.log(`📊 Scoring ${topVolumePairs.length} pairs...`);

      // Score all pairs (with error handling)
      const scoredPairs = await this.pairScorer.scorePairs(topVolumePairs);
      
      console.log(`✅ Successfully scored ${scoredPairs.length} pairs`);

      // Sort by score and update cache
      this.cachedPairs = scoredPairs
        .sort((a, b) => b.score - a.score)
        .map(sp => sp.pair);

      this.lastUpdate = new Date();

      // Save to database
      await this.savePairsToDb(this.cachedPairs);

      console.log(`✅ Updated ${this.cachedPairs.length} trading pairs`);
    } catch (error) {
      console.error('Error updating pairs:', error);
      throw error;
    }
  }

  /**
   * Get pair by symbol
   */
  async getPair(symbol: string): Promise<TradingPair | null> {
    // Check cache first
    const cached = this.cachedPairs.find(p => p.symbol === symbol);
    if (cached) {
      return cached;
    }

    // Check database
    const [pair] = await db
      .select()
      .from(tradingPairs)
      .where(eq(tradingPairs.symbol, symbol))
      .limit(1);

    if (!pair) {
      return null;
    }

    return {
      symbol: pair.symbol,
      baseAsset: pair.baseAsset,
      quoteAsset: pair.quoteAsset,
      price: parseFloat(pair.price || '0'),
      volume24h: parseFloat(pair.volume24h || '0'),
      score: parseFloat(pair.score || '0'),
    };
  }

  /**
   * Get all cached pairs
   */
  getCachedPairs(): TradingPair[] {
    return [...this.cachedPairs];
  }

  /**
   * Force refresh pairs
   */
  async refreshPairs(): Promise<void> {
    this.lastUpdate = new Date(0); // Force update
    await this.updatePairs();
  }

  /**
   * Save pairs to database
   */
  private async savePairsToDb(pairs: TradingPair[]): Promise<void> {
    for (const pair of pairs) {
      try {
        await db
          .insert(tradingPairs)
          .values({
            symbol: pair.symbol,
            baseAsset: pair.baseAsset,
            quoteAsset: pair.quoteAsset,
            price: pair.price.toString(),
            volume24h: pair.volume24h.toString(),
            score: pair.score?.toString() || '0',
          })
          .onConflictDoUpdate({
            target: tradingPairs.symbol,
            set: {
              price: pair.price.toString(),
              volume24h: pair.volume24h.toString(),
              score: pair.score?.toString() || '0',
              lastUpdated: new Date(),
            },
          });
      } catch (error) {
        console.error(`Error saving pair ${pair.symbol} to DB:`, error);
      }
    }
  }

  /**
   * Load pairs from database
   */
  async loadPairsFromDb(): Promise<void> {
    const pairs = await db
      .select()
      .from(tradingPairs)
      .where(eq(tradingPairs.isActive, true))
      .orderBy(tradingPairs.score);

    this.cachedPairs = pairs.map(p => ({
      symbol: p.symbol,
      baseAsset: p.baseAsset,
      quoteAsset: p.quoteAsset,
      price: parseFloat(p.price || '0'),
      volume24h: parseFloat(p.volume24h || '0'),
      score: parseFloat(p.score || '0'),
    }));

    this.lastUpdate = new Date();
  }
}

// Singleton instance
let pairSelectorInstance: PairSelector | null = null;

export function getPairSelector(): PairSelector {
  if (!pairSelectorInstance) {
    pairSelectorInstance = new PairSelector();
  }
  return pairSelectorInstance;
}
