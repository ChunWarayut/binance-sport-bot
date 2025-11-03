import { getBinanceClient } from '../binance/binanceClient';
import { TradingPair } from '../../types';

export class VolumeFilter {
  private client = getBinanceClient();

  /**
   * Get top volume pairs sorted by 24h quote volume
   */
  async getTopVolumePairs(count: number = 30): Promise<TradingPair[]> {
    try {
      const pairs = await this.client.getTopVolumePairs(count);

      return pairs.map((pair: any) => ({
        symbol: pair.symbol,
        baseAsset: pair.symbol.replace('USDT', ''),
        quoteAsset: 'USDT',
        price: pair.price,
        volume24h: pair.quoteVolume24h,
        score: undefined, // Will be set by pairScorer
      }));
    } catch (error) {
      console.error('Error fetching top volume pairs:', error);
      throw error;
    }
  }

  /**
   * Filter pairs by minimum volume threshold
   */
  async filterByMinVolume(pairs: TradingPair[], minVolume24h: number): Promise<TradingPair[]> {
    return pairs.filter(pair => pair.volume24h >= minVolume24h);
  }

  /**
   * Get base asset from symbol
   */
  extractBaseAsset(symbol: string): string {
    if (symbol.endsWith('USDT')) {
      return symbol.replace('USDT', '');
    }
    return symbol;
  }

  /**
   * Check if pair is valid USDT pair
   */
  isValidUSDTPair(symbol: string): boolean {
    return symbol.endsWith('USDT') && symbol.length > 4;
  }
}

// Singleton instance
let volumeFilterInstance: VolumeFilter | null = null;

export function getVolumeFilter(): VolumeFilter {
  if (!volumeFilterInstance) {
    volumeFilterInstance = new VolumeFilter();
  }
  return volumeFilterInstance;
}
