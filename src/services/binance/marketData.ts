import WebSocket from 'ws';
import { EventEmitter } from 'events';

export interface PriceUpdate {
  symbol: string;
  price: number;
  timestamp: Date;
}

export interface KlineUpdate {
  symbol: string;
  interval: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  openTime: Date;
  closeTime: Date;
}

export class MarketDataStream extends EventEmitter {
  private ws: WebSocket | null = null;
  private baseURL: string;
  private streams: string[] = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;

  constructor(testnet: boolean = false) {
    super();
    this.baseURL = testnet
      ? 'wss://testnet.binance.vision/ws'
      : 'wss://stream.binance.com:9443/ws';
  }

  /**
   * Subscribe to ticker price stream for multiple symbols
   */
  subscribeToTickers(symbols: string[]) {
    const streamNames = symbols.map(s => `${s.toLowerCase()}@ticker`).join('/');
    const streamUrl = `${this.baseURL}/stream?streams=${streamNames}`;
    
    this.connect(streamUrl);
  }

  /**
   * Subscribe to kline/candlestick stream for a symbol
   */
  subscribeToKlines(symbol: string, interval: string = '1m') {
    const streamName = `${symbol.toLowerCase()}@kline_${interval}`;
    const streamUrl = `${this.baseURL}/${streamName}`;
    
    this.connect(streamUrl);
  }

  /**
   * Subscribe to multiple kline streams
   */
  subscribeToMultipleKlines(symbols: string[], interval: string = '1m') {
    const streamNames = symbols.map(s => `${s.toLowerCase()}@kline_${interval}`).join('/');
    const streamUrl = `${this.baseURL}/stream?streams=${streamNames}`;
    
    this.connect(streamUrl);
  }

  private connect(url: string) {
    if (this.ws) {
      this.disconnect();
    }

    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      console.log('✅ WebSocket connected to Binance');
      this.reconnectAttempts = 0;
      this.emit('connected');
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleMessage(message);
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    });

    this.ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      this.emit('error', error);
    });

    this.ws.on('close', () => {
      console.log('WebSocket disconnected');
      this.emit('disconnected');
      this.reconnect(url);
    });
  }

  private handleMessage(message: any) {
    // Handle stream data format
    if (message.stream) {
      const data = message.data;
      if (data.e === '24hrTicker') {
        this.handleTickerUpdate(data);
      } else if (data.e === 'kline') {
        this.handleKlineUpdate(data);
      }
    } else {
      // Handle single stream format
      if (message.e === '24hrTicker') {
        this.handleTickerUpdate(message);
      } else if (message.e === 'kline') {
        this.handleKlineUpdate(message);
      }
    }
  }

  private handleTickerUpdate(data: any) {
    const update: PriceUpdate = {
      symbol: data.s,
      price: parseFloat(data.c), // Last price
      timestamp: new Date(data.E),
    };
    this.emit('ticker', update);
  }

  private handleKlineUpdate(data: any) {
    const kline = data.k;
    if (!kline.x) return; // Only process closed candles

    const update: KlineUpdate = {
      symbol: kline.s,
      interval: kline.i,
      open: parseFloat(kline.o),
      high: parseFloat(kline.h),
      low: parseFloat(kline.l),
      close: parseFloat(kline.c),
      volume: parseFloat(kline.v),
      openTime: new Date(kline.t),
      closeTime: new Date(kline.T),
    };
    this.emit('kline', update);
  }

  private reconnect(url: string) {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      this.emit('maxReconnectAttempts');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff
    
    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    setTimeout(() => {
      this.connect(url);
    }, delay);
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
