import Spot from '@binance/connector/types/spot';
import { Spot as BinanceSpot } from '@binance/connector';
import { config } from '../../utils/config';

export class BinanceClient {
  private client: BinanceSpot;

  constructor() {
    if (!config.binance.apiKey || !config.binance.apiSecret) {
      throw new Error('Binance API credentials not configured. Please set BINANCE_API_KEY and BINANCE_API_SECRET in .env');
    }

    // Check if API key looks valid (basic validation)
    if (config.binance.apiKey === 'your_api_key_here' || 
        config.binance.apiKey.length < 10) {
      throw new Error('Invalid Binance API Key. Please set a valid API key in .env');
    }

    const baseURL = config.binance.testnet
      ? 'https://testnet.binance.vision'
      : 'https://api.binance.com';

    this.client = new BinanceSpot(
      config.binance.apiKey,
      config.binance.apiSecret,
      {
        baseURL,
        recvWindow: 60000, // 60 seconds window to handle network latency and clock drift
      }
    );
  }

  /**
   * Get account information
   */
  async getAccountInfo() {
    try {
      const response = await this.client.account({
        recvWindow: 60000, // 60 seconds window
      });
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get balance for a specific asset
   */
  async getBalance(asset: string) {
    try {
      const account = await this.getAccountInfo();
      const balance = account.balances.find((b: { asset: string }) => b.asset === asset);
      return balance ? {
        asset: balance.asset,
        free: parseFloat(balance.free),
        locked: parseFloat(balance.locked),
        total: parseFloat(balance.free) + parseFloat(balance.locked),
      } : null;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get current price for a symbol
   */
  async getPrice(symbol: string): Promise<number> {
    if (!symbol || typeof symbol !== 'string') {
      throw new Error(`Invalid symbol: ${symbol}. Symbol must be a non-empty string.`);
    }
    
    // Ensure symbol is a string and trim whitespace
    const cleanSymbol = String(symbol).trim().toUpperCase();
    
    if (!cleanSymbol) {
      throw new Error(`Invalid symbol: symbol is empty after cleaning`);
    }
    
    try {
      // Binance connector tickerPrice signature: tickerPrice(symbol = '', symbols = [], options = {})
      // It expects symbol as first positional parameter, not in options
      const response = await this.client.tickerPrice(cleanSymbol, [], {});
      
      if (!response?.data?.price) {
        throw new Error(`Invalid response from Binance API: ${JSON.stringify(response?.data)}`);
      }
      
      return parseFloat(response.data.price);
    } catch (error: any) {
      // Enhanced error logging
      const errorMsg = error?.message || String(error);
      console.error(`❌ getPrice error for symbol "${symbol}" (cleaned: "${cleanSymbol}"):`, errorMsg);
      throw this.handleError(error);
    }
  }

  /**
   * Get 24hr ticker statistics
   */
  async get24hrTicker(symbol: string) {
    try {
      const response = await this.client.ticker24hr({ symbol });
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get all trading pairs with USDT quote
   */
  async getUSDTradingPairs() {
    try {
      const response = await this.client.exchangeInfo();
      return response.data.symbols
        .filter((symbol: any) => 
          symbol.quoteAsset === 'USDT' && 
          symbol.status === 'TRADING'
        )
        .map((symbol: any) => ({
          symbol: symbol.symbol,
          baseAsset: symbol.baseAsset,
          quoteAsset: symbol.quoteAsset,
          minQty: parseFloat(symbol.filters.find((f: any) => f.filterType === 'LOT_SIZE')?.minQty || '0'),
          stepSize: parseFloat(symbol.filters.find((f: any) => f.filterType === 'LOT_SIZE')?.stepSize || '0'),
          minNotional: parseFloat(symbol.filters.find((f: any) => f.filterType === 'MIN_NOTIONAL')?.minNotional || '0'),
        }));
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get 24hr ticker for all symbols (sorted by volume)
   */
  async getTopVolumePairs(count: number = 30) {
    try {
      const response = await this.client.ticker24hr();
      const pairs = response.data
        .filter((ticker: any) => ticker.symbol.endsWith('USDT'))
        .map((ticker: any) => ({
          symbol: ticker.symbol,
          price: parseFloat(ticker.lastPrice),
          volume24h: parseFloat(ticker.volume),
          quoteVolume24h: parseFloat(ticker.quoteVolume),
          priceChangePercent: parseFloat(ticker.priceChangePercent),
          highPrice: parseFloat(ticker.highPrice),
          lowPrice: parseFloat(ticker.lowPrice),
        }))
        .sort((a: any, b: any) => b.quoteVolume24h - a.quoteVolume24h)
        .slice(0, count);
      
      return pairs;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get kline/candlestick data
   */
  async getKlines(symbol: string, interval: string = '1h', limit: number = 100) {
    try {
      // Binance connector klines signature: klines(symbol, interval, options)
      // According to Binance API docs: https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints#klinecandlestick-data
      // Required: symbol, interval
      // Optional: limit (default 500, max 1000), startTime, endTime, timeUnit
      
      // Ensure interval is not empty or undefined
      if (!interval || interval.trim() === '') {
        throw new Error('Interval parameter is required');
      }
      
      const response = await this.client.klines(symbol, interval, { limit });
      if (!response?.data || !Array.isArray(response.data)) {
        throw new Error(`Invalid response format for ${symbol}: ${JSON.stringify(response)}`);
      }
      return response.data.map((kline: any) => ({
        openTime: new Date(kline[0]),
        open: parseFloat(kline[1]),
        high: parseFloat(kline[2]),
        low: parseFloat(kline[3]),
        close: parseFloat(kline[4]),
        volume: parseFloat(kline[5]),
        closeTime: new Date(kline[6]),
        quoteVolume: parseFloat(kline[7]),
        trades: parseInt(kline[8], 10),
        takerBuyBaseVolume: parseFloat(kline[9]),
        takerBuyQuoteVolume: parseFloat(kline[10]),
      }));
    } catch (error: any) {
      // Handle error and ensure we throw an Error with a proper message
      let errorMessage = 'Unknown error';
      
      // Extract message first
      if (error?.response?.data?.msg) {
        errorMessage = `Binance API: ${error.response.data.msg}`;
      } else if (error?.response?.data?.message) {
        errorMessage = `Binance API: ${error.response.data.message}`;
      } else if (error instanceof Error) {
        errorMessage = error.message;
      } else if (error?.message) {
        errorMessage = error.message;
      } else if (error?.msg) {
        errorMessage = error.msg;
      } else if (typeof error === 'string') {
        errorMessage = error;
      } else {
        // Try to stringify safely
        try {
          errorMessage = JSON.stringify(error, null, 2).substring(0, 200);
        } catch {
          errorMessage = String(error) || 'Unknown error';
        }
      }
      
      // Always throw a new Error with the message
      throw new Error(`Failed to get klines for ${symbol}: ${errorMessage}`);
    }
  }

  /**
   * Place a new order
   */
  async placeOrder(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    type: 'MARKET' | 'LIMIT';
    quantity?: number;
    quoteOrderQty?: number;
    price?: number;
    timeInForce?: 'GTC' | 'IOC' | 'FOK';
  }) {
    console.log(`🔍 placeOrder called with params:`, JSON.stringify(params, null, 2));
    
    try {
      // Validate required parameters
      if (!params.symbol || !params.side || !params.type) {
        throw new Error(`Missing required parameters: symbol=${params.symbol}, side=${params.side}, type=${params.type}`);
      }
      
      console.log(`✅ Parameters validated: symbol=${params.symbol}, side=${params.side}, type=${params.type}`);

      // Binance connector newOrder signature: newOrder(symbol, side, type, options = {})
      // We need to pass symbol, side, type as positional parameters, then options
      const symbol = String(params.symbol).trim().toUpperCase();
      const side = String(params.side).trim().toUpperCase();
      const type = String(params.type).trim().toUpperCase();
      
      // Build options object
      const options: any = {
        recvWindow: 60000,
      };
      
      if (params.type === 'MARKET') {
        if (params.quantity) {
          options.quantity = String(params.quantity);
        } else if (params.quoteOrderQty !== undefined && params.quoteOrderQty !== null) {
          // Binance requires quoteOrderQty to have at most 8 decimal places
          // For USDT pairs, use 2 decimal places (cents precision) per Binance API docs
          // Reference: https://binance-docs.github.io/apidocs/spot/en/#new-order-trade
          const rawQty = params.quoteOrderQty;
          const qty = typeof rawQty === 'number' ? rawQty : parseFloat(String(rawQty));
          
          if (isNaN(qty) || qty <= 0) {
            throw new Error(`Invalid quoteOrderQty: ${rawQty}`);
          }
          
          // Round to 2 decimal places for USDT (quote currency)
          // Binance accepts quoteOrderQty with precision up to 8 decimals, but USDT uses 2
          const roundedQty = Math.round(qty * 100) / 100;
          
          // Format to string with exactly 2 decimal places
          // Then parse back to remove unnecessary trailing zeros
          options.quoteOrderQty = roundedQty.toFixed(2);
          
          // Validate: ensure we don't have more than 8 decimal places
          const decimalPart = options.quoteOrderQty.split('.')[1] || '';
          if (decimalPart.length > 8) {
            options.quoteOrderQty = roundedQty.toFixed(8);
          }
          
          console.log(`🔢 quoteOrderQty formatting: ${rawQty} → ${qty} → ${roundedQty} → "${options.quoteOrderQty}"`);
        }
      } else if (params.type === 'LIMIT') {
        if (params.quantity) {
          options.quantity = String(params.quantity);
        }
        if (params.price) {
          options.price = String(params.price);
        }
        options.timeInForce = params.timeInForce || 'GTC';
      }
      
      console.log(`📤 Placing order: ${side} ${type} ${symbol}`, JSON.stringify(options, null, 2));
      console.log(`📤 Order params check: symbol="${symbol}" (${typeof symbol}), side="${side}" (${typeof side}), type="${type}" (${typeof type})`);
      
      // Call Binance connector with positional parameters
      // Note: Binance connector validates parameters internally, so ensure they're strings
      const response = await this.client.newOrder(symbol, side, type, options);
      
      console.log(`✅ Order placed successfully:`, response.data);
      // Extract fills data properly
      const fills = (response.data.fills || []).map((fill: any) => ({
        price: parseFloat(fill.price || '0'),
        qty: parseFloat(fill.qty || '0'),
        commission: parseFloat(fill.commission || '0'),
        commissionAsset: fill.commissionAsset || 'USDT',
      }));
      
      // Calculate average price from fills if available (for MARKET orders)
      let avgPrice = 0;
      const executedQty = parseFloat(response.data.executedQty || response.data.origQty || '0');
      
      if (fills.length > 0 && executedQty > 0) {
        const totalValue = fills.reduce((sum: number, fill: any) => sum + (fill.price * fill.qty), 0);
        avgPrice = totalValue / executedQty;
      } else {
        // Fallback: try to get price from response
        avgPrice = params.price ? parseFloat(params.price.toString()) : parseFloat(response.data.price || '0');
      }
      
      // Ensure valid values
      if (!isFinite(avgPrice) || avgPrice <= 0) {
        console.warn(`⚠️  Invalid price from order response, using fallback:`, response.data);
        avgPrice = params.price || 0;
      }
      if (!isFinite(executedQty) || executedQty <= 0) {
        console.warn(`⚠️  Invalid quantity from order response:`, response.data);
      }
      
      return {
        orderId: response.data.orderId,
        symbol: response.data.symbol,
        status: response.data.status,
        side: response.data.side,
        type: response.data.type,
        quantity: executedQty,
        price: avgPrice,
        executedQty: executedQty,
        fills: fills,
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get order status
   */
  async getOrder(symbol: string, orderId: number) {
    try {
      const response = await this.client.getOrder({ 
        symbol, 
        orderId,
        recvWindow: 60000,
      });
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Cancel an order
   */
  async cancelOrder(symbol: string, orderId: number) {
    try {
      const response = await this.client.cancelOrder({ 
        symbol, 
        orderId,
        recvWindow: 60000,
      });
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get all open orders
   */
  async getOpenOrders(symbol?: string) {
    try {
      const params: any = symbol ? { symbol } : {};
      params.recvWindow = 60000;
      const response = await this.client.openOrders(params);
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Get account trade list
   */
  async getMyTrades(symbol: string, limit: number = 100) {
    try {
      const response = await this.client.myTrades({ 
        symbol, 
        limit,
        recvWindow: 60000,
      });
      return response.data.map((trade: any) => ({
        id: trade.id,
        symbol: trade.symbol,
        orderId: trade.orderId,
        price: parseFloat(trade.price),
        qty: parseFloat(trade.qty),
        quoteQty: parseFloat(trade.quoteQty),
        commission: parseFloat(trade.commission),
        commissionAsset: trade.commissionAsset,
        time: new Date(trade.time),
        isBuyer: trade.isBuyer,
        isMaker: trade.isMaker,
      }));
    } catch (error) {
      throw this.handleError(error);
    }
  }

  private handleError(error: any): Error {
        // Extract error message properly
        let errorMsg = 'Unknown error';
        
        if (error?.response?.data?.msg) {
          errorMsg = error.response.data.msg;
        } else if (error?.response?.data?.message) {
          errorMsg = error.response.data.message;
        } else if (error?.response?.data) {
          // Try to stringify if it's an object
          try {
            errorMsg = JSON.stringify(error.response.data);
          } catch {
            errorMsg = String(error.response.data);
          }
        } else if (error instanceof Error && error.message) {
          errorMsg = error.message;
        } else if (error?.message) {
          errorMsg = error.message;
        } else if (typeof error === 'string') {
          errorMsg = error;
        } else {
          // Last resort: try to stringify
          try {
            errorMsg = JSON.stringify(error, null, 2).substring(0, 200);
          } catch {
            errorMsg = String(error);
          }
        }
        
        // Provide helpful error messages
        if (errorMsg.includes('Invalid API-key') || errorMsg.includes('permissions')) {
          const env = config.binance.testnet ? 'Testnet' : 'Production';
          return new Error(
            `Binance ${env} API Error: Invalid API-key or insufficient permissions. ` +
            `Please check:\n` +
            `1. API key matches ${env} environment\n` +
            `2. API key has "Enable Reading" permission\n` +
            `3. IP restriction settings (if enabled)\n` +
            `See BINANCE_API_SETUP.md for details.`
          );
        }
        
        // Handle timestamp errors
        if (errorMsg.includes('Timestamp') || errorMsg.includes('recvWindow')) {
          return new Error(
            `Binance API Error: Timestamp issue. ` +
            `This usually happens when server time is not synchronized with Binance server. ` +
            `Please check your system clock or network latency.`
          );
        }
        
        return new Error(`Binance API Error: ${errorMsg}`);
      }
}

// Singleton instance
let binanceClientInstance: BinanceClient | null = null;

export function getBinanceClient(): BinanceClient {
  if (!binanceClientInstance) {
    binanceClientInstance = new BinanceClient();
  }
  return binanceClientInstance;
}
