import { getBinanceClient } from '../binance/binanceClient';
import { TradingPair } from '../../types';
import {
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateSMA,
  calculateEMA,
  calculateSupportResistance,
  getCurrentPrice,
  calculateAverageVolume,
  KlineData,
} from './technicalIndicators';

export interface PairScore {
  pair: TradingPair;
  score: number;
  factors: {
    rsi: number;
    macd: number;
    bollinger: number;
    volume: number;
    momentum: number;
    volatility: number;
  };
}

export class PairScorer {
  private client = getBinanceClient();

  /**
   * Score trading pairs based on multiple technical indicators
   */
  async scorePairs(pairs: TradingPair[]): Promise<PairScore[]> {
    const scores: PairScore[] = [];

    for (const pair of pairs) {
      try {
        const score = await this.scorePair(pair);
        scores.push(score);
      } catch (error: any) {
        // Extract error message properly - handle all cases
        let errorMessage = 'Unknown error';
        
        // Try multiple ways to extract message
        if (error?.response?.data?.msg) {
          errorMessage = `Binance API: ${error.response.data.msg}`;
        } else if (error?.response?.data?.message) {
          errorMessage = `Binance API: ${error.response.data.message}`;
        } else if (error instanceof Error && error.message) {
          errorMessage = error.message;
        } else if (error?.message) {
          errorMessage = error.message;
        } else if (error?.msg) {
          errorMessage = error.msg;
        } else if (typeof error === 'string') {
          errorMessage = error;
        } else {
          // Last resort: try to stringify
          try {
            const str = JSON.stringify(error, (key, value) => {
              // Skip circular references
              if (key === 'request' || key === 'response' || key === 'config') {
                return '[Circular]';
              }
              return value;
            }, 2);
            errorMessage = str.substring(0, 200); // Limit length
          } catch {
            // If stringify fails, try toString
            errorMessage = error?.toString?.() || String(error);
          }
        }
        
        console.warn(`Error scoring pair ${pair.symbol}: ${errorMessage}`);
        // Continue with other pairs - add pair with 0 score
        scores.push({ 
          pair, 
          score: 0,
          factors: {
            rsi: 0,
            macd: 0,
            bollinger: 0,
            volume: 0,
            momentum: 0,
            volatility: 0,
          }
        });
      }
    }

    // Sort by score descending
    return scores.sort((a, b) => b.score - a.score);
  }

  /**
   * Score a single pair
   */
  async scorePair(pair: TradingPair): Promise<PairScore> {
    try {
      // Get kline data (1h candles, last 100)
      const klines = await this.client.getKlines(pair.symbol, '1h', 100);
      
      if (!klines || klines.length === 0) {
        console.warn(`No klines data for ${pair.symbol}`);
        return { 
          pair, 
          score: 0,
          factors: {
            rsi: 0,
            macd: 0,
            bollinger: 0,
            volume: 0,
            momentum: 0,
            volatility: 0,
          }
        };
      }
      
      const klineData: KlineData[] = klines.map((k: any) => ({
        open: k.open,
        high: k.high,
        low: k.low,
        close: k.close,
        volume: k.volume,
        timestamp: k.openTime instanceof Date ? k.openTime : new Date(k.openTime),
      }));

      const prices = klineData.map(k => k.close);
    const currentPrice = getCurrentPrice(klineData);

    // Calculate indicators
    const rsi = calculateRSI(prices, 14);
      const macd = calculateMACD(prices, 12, 26, 9);
      const bollinger = calculateBollingerBands(prices, 20, 2);
      const sma20 = calculateSMA(prices, 20);
      const ema50 = calculateEMA(prices, 50);
      const { support, resistance } = calculateSupportResistance(klineData);
      const avgVolume = calculateAverageVolume(klineData, 20);
      const currentVolume = klineData[klineData.length - 1].volume;

      // Score factors (0-100 each)
      const factors = {
        rsi: this.scoreRSI(rsi[rsi.length - 1]),
        macd: this.scoreMACD(macd),
        bollinger: this.scoreBollinger(currentPrice, bollinger),
        volume: this.scoreVolume(currentVolume, avgVolume),
        momentum: this.scoreMomentum(prices, sma20, ema50),
        volatility: this.scoreVolatility(prices, support, resistance, currentPrice),
      };

      // Weighted average
      const weights = {
      rsi: 0.15,
      macd: 0.20,
      bollinger: 0.15,
      volume: 0.15,
      momentum: 0.20,
      volatility: 0.15,
    };

      const totalScore =
        factors.rsi * weights.rsi +
        factors.macd * weights.macd +
        factors.bollinger * weights.bollinger +
        factors.volume * weights.volume +
        factors.momentum * weights.momentum +
        factors.volatility * weights.volatility;

      return {
        pair: {
          ...pair,
          score: totalScore,
        },
        score: totalScore,
        factors,
      };
    } catch (error: any) {
      // Extract error message properly - handle all cases
      let errorMessage = 'Unknown error';
      
      // Try multiple ways to extract message
      if (error?.response?.data?.msg) {
        errorMessage = `Binance API: ${error.response.data.msg}`;
      } else if (error?.response?.data?.message) {
        errorMessage = `Binance API: ${error.response.data.message}`;
      } else if (error instanceof Error && error.message) {
        errorMessage = error.message;
      } else if (error?.message) {
        errorMessage = error.message;
      } else if (error?.msg) {
        errorMessage = error.msg;
      } else if (typeof error === 'string') {
        errorMessage = error;
      } else {
        // Last resort: try to stringify
        try {
          const str = JSON.stringify(error, (key, value) => {
            // Skip circular references
            if (key === 'request' || key === 'response' || key === 'config') {
              return '[Circular]';
            }
            return value;
          }, 2);
          errorMessage = str.substring(0, 200); // Limit length
        } catch {
          // If stringify fails, try toString
          errorMessage = error?.toString?.() || String(error);
        }
      }
      
      console.warn(`Error scoring pair ${pair.symbol}: ${errorMessage}`);
      // Return pair with 0 score if scoring fails
      return { 
        pair, 
        score: 0,
        factors: {
          rsi: 0,
          macd: 0,
          bollinger: 0,
          volume: 0,
          momentum: 0,
          volatility: 0,
        }
      };
    }
  }

  /**
   * Score RSI (prefer oversold for entry, but not extreme)
   */
  private scoreRSI(rsi: number): number {
    if (isNaN(rsi)) return 50;
    
    // RSI between 30-70 is good (neutral zone)
    // RSI < 30: oversold (potential buy), score based on how oversold
    // RSI > 70: overbought (potential sell), lower score
    if (rsi < 30) {
      return 30 + ((30 - rsi) / 30) * 40; // 30-70 range
    } else if (rsi > 70) {
      return 70 - ((rsi - 70) / 30) * 40; // 30-70 range
    } else {
      return 60; // Neutral zone
    }
  }

  /**
   * Score MACD (bullish crossover = good)
   */
  private scoreMACD(macd: { macd: number[]; signal: number[]; histogram: number[] }): number {
    const lastMacd = macd.macd[macd.macd.length - 1];
    const lastSignal = macd.signal[macd.signal.length - 1];
    const lastHistogram = macd.histogram[macd.histogram.length - 1];
    const prevHistogram = macd.histogram[macd.histogram.length - 2];

    if (isNaN(lastMacd) || isNaN(lastSignal)) return 50;

    // Bullish: MACD > Signal and histogram increasing
    if (lastMacd > lastSignal && lastHistogram > (prevHistogram || 0)) {
      return 80;
    }
    // Bearish: MACD < Signal
    else if (lastMacd < lastSignal) {
      return 30;
    }
    // Neutral
    else {
      return 50;
    }
  }

  /**
   * Score Bollinger Bands (price near lower band = potential buy)
   */
  private scoreBollinger(price: number, bands: { upper: number[]; middle: number[]; lower: number[] }): number {
    const lastUpper = bands.upper[bands.upper.length - 1];
    const lastMiddle = bands.middle[bands.middle.length - 1];
    const lastLower = bands.lower[bands.lower.length - 1];

    if (isNaN(lastUpper) || isNaN(lastLower)) return 50;

    const bandWidth = lastUpper - lastLower;
    if (bandWidth === 0) return 50;

    // Distance from lower band (0-1)
    const distanceFromLower = (price - lastLower) / bandWidth;

    // Near lower band = higher score (potential buy)
    if (distanceFromLower < 0.2) {
      return 80 - distanceFromLower * 100;
    }
    // Near upper band = lower score
    else if (distanceFromLower > 0.8) {
      return 20 + (1 - distanceFromLower) * 30;
    }
    // Middle zone
    else {
      return 50;
    }
  }

  /**
   * Score volume (higher volume relative to average = better)
   */
  private scoreVolume(currentVolume: number, avgVolume: number): number {
    if (avgVolume === 0) return 50;
    
    const ratio = currentVolume / avgVolume;
    
    // Above average volume is good (up to 2x = 100)
    if (ratio >= 2) {
      return 100;
    } else if (ratio >= 1.5) {
      return 80;
    } else if (ratio >= 1) {
      return 60;
    } else if (ratio >= 0.5) {
      return 40;
    } else {
      return 20;
    }
  }

  /**
   * Score momentum (price above moving averages = bullish)
   */
  private scoreMomentum(prices: number[], sma20: number[], ema50: number[]): number {
    const currentPrice = prices[prices.length - 1];
    const lastSma20 = sma20[sma20.length - 1];
    const lastEma50 = ema50[ema50.length - 1];

    if (isNaN(lastSma20) || isNaN(lastEma50)) return 50;

    let score = 50;

    // Price above SMAs = bullish
    if (currentPrice > lastSma20) score += 20;
    if (currentPrice > lastEma50) score += 20;

    // SMA above EMA = uptrend
    if (lastSma20 > lastEma50) score += 10;

    return Math.min(100, score);
  }

  /**
   * Score volatility (good volatility for trading, but not extreme)
   */
  private scoreVolatility(prices: number[], support: number, resistance: number, currentPrice: number): number {
    if (resistance === support) return 50;

    const range = resistance - support;
    const distanceFromSupport = currentPrice - support;
    const positionInRange = distanceFromSupport / range;

    // Prefer mid-range or near support (not extreme highs)
    if (positionInRange < 0.3) {
      return 70; // Near support
    } else if (positionInRange > 0.7) {
      return 30; // Near resistance
    } else {
      return 60; // Mid-range
    }
  }
}

// Singleton instance
let pairScorerInstance: PairScorer | null = null;

export function getPairScorer(): PairScorer {
  if (!pairScorerInstance) {
    pairScorerInstance = new PairScorer();
  }
  return pairScorerInstance;
}
