export interface KlineData {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: Date;
}

/**
 * Calculate Simple Moving Average (SMA)
 */
export function calculateSMA(prices: number[], period: number): number[] {
  const sma: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      sma.push(NaN);
    } else {
      const sum = prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      sma.push(sum / period);
    }
  }
  return sma;
}

/**
 * Calculate Exponential Moving Average (EMA)
 */
export function calculateEMA(prices: number[], period: number): number[] {
  const ema: number[] = [];
  const multiplier = 2 / (period + 1);

  for (let i = 0; i < prices.length; i++) {
    if (i === 0) {
      ema.push(prices[i]);
    } else if (i < period) {
      // Use SMA for initial values
      const sum = prices.slice(0, i + 1).reduce((a, b) => a + b, 0);
      ema.push(sum / (i + 1));
    } else {
      ema.push((prices[i] - ema[i - 1]) * multiplier + ema[i - 1]);
    }
  }
  return ema;
}

/**
 * Calculate RSI (Relative Strength Index)
 */
export function calculateRSI(prices: number[], period: number = 14): number[] {
  const rsi: number[] = [];
  const changes: number[] = [];

  // Calculate price changes
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }

  for (let i = 0; i < prices.length; i++) {
    if (i < period) {
      rsi.push(NaN);
    } else {
      const relevantChanges = changes.slice(i - period, i);
      const gains = relevantChanges.filter(c => c > 0);
      const losses = relevantChanges.filter(c => c < 0).map(c => Math.abs(c));

      const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / period : 0;
      const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / period : 0;

      if (avgLoss === 0) {
        rsi.push(100);
      } else {
        const rs = avgGain / avgLoss;
        rsi.push(100 - (100 / (1 + rs)));
      }
    }
  }

  return rsi;
}

/**
 * Calculate MACD (Moving Average Convergence Divergence)
 */
export function calculateMACD(
  prices: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): { macd: number[]; signal: number[]; histogram: number[] } {
  const fastEMA = calculateEMA(prices, fastPeriod);
  const slowEMA = calculateEMA(prices, slowPeriod);

  const macd: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (isNaN(fastEMA[i]) || isNaN(slowEMA[i])) {
      macd.push(NaN);
    } else {
      macd.push(fastEMA[i] - slowEMA[i]);
    }
  }

  const signal = calculateEMA(macd.filter(v => !isNaN(v)), signalPeriod);
  
  // Pad signal array to match macd length
  const paddedSignal: number[] = [];
  const nanCount = macd.length - macd.filter(v => !isNaN(v)).length;
  for (let i = 0; i < nanCount; i++) {
    paddedSignal.push(NaN);
  }
  paddedSignal.push(...signal);

  const histogram: number[] = [];
  for (let i = 0; i < macd.length; i++) {
    if (isNaN(macd[i]) || isNaN(paddedSignal[i])) {
      histogram.push(NaN);
    } else {
      histogram.push(macd[i] - paddedSignal[i]);
    }
  }

  return { macd, signal: paddedSignal, histogram };
}

/**
 * Calculate Bollinger Bands
 */
export function calculateBollingerBands(
  prices: number[],
  period: number = 20,
  stdDev: number = 2
): { upper: number[]; middle: number[]; lower: number[] } {
  const sma = calculateSMA(prices, period);
  const upper: number[] = [];
  const middle: number[] = [];
  const lower: number[] = [];

  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      upper.push(NaN);
      middle.push(NaN);
      lower.push(NaN);
    } else {
      const slice = prices.slice(i - period + 1, i + 1);
      const mean = sma[i];
      const variance = slice.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / period;
      const standardDeviation = Math.sqrt(variance);

      middle.push(mean);
      upper.push(mean + (standardDeviation * stdDev));
      lower.push(mean - (standardDeviation * stdDev));
    }
  }

  return { upper, middle, lower };
}

/**
 * Calculate support and resistance levels
 */
export function calculateSupportResistance(klines: KlineData[]): { support: number; resistance: number } {
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);

  // Simple approach: find local maxima and minima
  const window = Math.floor(klines.length / 10); // 10% window

  let resistance = highs[0];
  let support = lows[0];

  for (let i = window; i < highs.length - window; i++) {
    const isLocalMax = highs.slice(i - window, i + window + 1).every((h, idx) => {
      if (idx === window) return true;
      return h <= highs[i];
    });

    const isLocalMin = lows.slice(i - window, i + window + 1).every((l, idx) => {
      if (idx === window) return true;
      return l >= lows[i];
    });

    if (isLocalMax && highs[i] > resistance) {
      resistance = highs[i];
    }

    if (isLocalMin && lows[i] < support) {
      support = lows[i];
    }
  }

  return { support, resistance };
}

/**
 * Get current price from latest kline
 */
export function getCurrentPrice(klines: KlineData[]): number {
  return klines[klines.length - 1].close;
}

/**
 * Calculate average volume
 */
export function calculateAverageVolume(klines: KlineData[], period: number = 20): number {
  if (klines.length === 0) return 0;
  
  const recent = klines.slice(-period);
  const sum = recent.reduce((acc, k) => acc + k.volume, 0);
  return sum / recent.length;
}
