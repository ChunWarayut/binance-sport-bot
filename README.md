# Binance Spot Trading Bot

ระบบเทรด Spot บน Binance ที่รองรับหลายกลยุทธ์ พร้อมระบบจัดการความเสี่ยงและ Backtesting

## Features

- 🔄 **Multiple Trading Strategies**: Grid, DCA, Momentum, Mean Reversion
- 📊 **Auto Pair Selection**: เลือกคู่เงินอัตโนมัติจาก Top volume pairs พร้อม Technical Analysis
- 🛡️ **Risk Management**: ระบบจัดการความเสี่ยงระดับปานกลาง
- 📈 **Backtesting Engine**: ทดสอบกลยุทธ์กับข้อมูลย้อนหลัง
- 🌐 **REST API**: API สำหรับจัดการและติดตามการเทรด
- 📱 **Web Dashboard**: Dashboard สำหรับ monitoring และ control
- 🐳 **Docker Support**: Deploy ด้วย Docker Compose

## Prerequisites

- Node.js 18+ หรือ Bun runtime
- PostgreSQL 16+
- Docker & Docker Compose (optional)

## Setup

1. Clone repository และติดตั้ง dependencies:
```bash
npm install
# หรือ
bun install
```

2. สร้างไฟล์ `.env` จาก `.env.example`:
```bash
cp .env.example .env
```

3. ตั้งค่า environment variables ใน `.env`:
   - Binance API Key และ Secret
   - Database connection string
   - Risk management parameters

4. Setup database:
```bash
bun run db:generate
bun run db:migrate
```

## Running with Docker Compose

```bash
docker-compose up -d
```

## Development

```bash
# Run in development mode
bun run dev

# Run migrations
bun run db:migrate

# Database studio
bun run db:studio
```

## API Documentation

เมื่อรัน server แล้วสามารถเข้าดู API documentation ได้ที่:
- Swagger UI: `http://localhost:3000/swagger`

## Project Structure

```
binance-sport-bot/
├── src/
│   ├── services/
│   │   ├── binance/     # Binance API integration
│   │   ├── analysis/    # Pair selection & Technical Analysis
│   │   ├── risk/        # Risk management
│   │   └── backtest/    # Backtesting engine
│   ├── strategies/      # Trading strategies
│   ├── routes/          # API routes
│   ├── db/              # Database schema & migrations
│   ├── types/           # TypeScript types
│   └── utils/           # Utility functions
├── public/              # Web dashboard
├── migrations/          # Database migrations
└── tests/               # Tests
```

## License

MIT
