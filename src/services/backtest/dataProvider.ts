import { getBinanceClient } from '../binance/binanceClient';
import { KlineData } from '../analysis/technicalIndicators';

export interface BacktestData {
  symbol: string;
  interval: string;
  klines: KlineData[];
  startDate: Date;
  endDate: Date;
}

export class DataProvider {
  private client = getBinanceClient();

  /**
   * Fetch historical kline data for backtesting
   */
  async getHistoricalData(
    symbol: string,
    interval: string,
    startDate: Date,
    endDate: Date
  ): Promise<BacktestData> {
    // Calculate number of candles needed
    const intervals: Record<string, number> = {
      '1m': 60000,
      '5m': 300000,
      '15m': 900000,
      '1h': 3600000,
      '4h': 14400000,
      '1d': 86400000,
    };

    const intervalMs = intervals[interval] || 3600000; // Default to 1h
    const totalMs = endDate.getTime() - startDate.getTime();
    const estimatedCandles = Math.ceil(totalMs / intervalMs);

    // Binance API limits to 1000 candles per request
    const maxCandlesPerRequest = 1000;
    const allKlines: any[] = [];

    let currentStart = startDate;

    while (currentStart < endDate) {
      const batchSize = Math.min(maxCandlesPerRequest, estimatedCandles - allKlines.length);
      
      try {
        const klines = await this.client.getKlines(symbol, interval, batchSize);
        
        if (klines.length === 0) {
          break;
        }

        // Filter klines within date range
        const filteredKlines = klines.filter(
          k => k.openTime >= currentStart && k.openTime <= endDate
        );

        allKlines.push(...filteredKlines);

        // Move to next batch
        if (klines.length < batchSize) {
          break; // No more data available
        }

        currentStart = new Date(klines[klines.length - 1].closeTime.getTime() + 1);
      } catch (error) {
        console.error(`Error fetching historical data:`, error);
        throw error;
      }

      // Add delay to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Convert to KlineData format
    const klineData: KlineData[] = allKlines.map(k => ({
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close,
      volume: k.volume,
      timestamp: k.openTime,
    }));

    // Sort by timestamp
    klineData.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    return {
      symbol,
      interval,
      klines: klineData,
      startDate,
      endDate,
    };
  }

  /**
   * Get available symbols for backtesting
   */
  async getAvailableSymbols(): Promise<string[]> {
    const pairs = await this.client.getUSDTradingPairs();
    return pairs.map(p => p.symbol);
  }

  /**
   * Validate date range for backtesting
   */
  validateDateRange(startDate: Date, endDate: Date): { valid: boolean; error?: string } {
    if (startDate >= endDate) {
      return {
        valid: false,
        error: 'Start date must be before end date',
      };
    }

    const maxRangeDays = 365; // Limit to 1 year
    const daysDiff = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);

    if (daysDiff > maxRangeDays) {
      return {
        valid: false,
        error: `Date range cannot exceed ${maxRangeDays} days`,
      };
    }

    if (endDate > new Date()) {
      return {
        valid: false,
        error: 'End date cannot be in the future',
      };
    }

    return { valid: true };
  }
}

// Singleton instance
let dataProviderInstance: DataProvider | null = null;

export function getDataProvider(): DataProvider {
  if (!dataProviderInstance) {
    dataProviderInstance = new DataProvider();
  }
  return dataProviderInstance;
}
