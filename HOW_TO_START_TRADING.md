# วิธีเริ่มใช้งานระบบเทรด

## ระบบจะเริ่มเทรดอัตโนมัติเมื่อ:

1. ✅ **Server เริ่มทำงาน** - เมื่อรัน `bun run dev` หรือ `docker-compose up`
2. ✅ **มี Active Strategies** - ต้องมีอย่างน้อย 1 strategy ที่ `isActive = true`
3. ✅ **Strategy Execution Loop รันอยู่** - ระบบจะตรวจสอบทุก 1 นาที (default)

## ขั้นตอนการเริ่มเทรด:

### วิธีที่ 1: สร้าง Strategy ผ่าน Dashboard

1. เปิด Dashboard: `http://localhost:3000/dashboard`
2. ไปที่แท็บ **Strategies**
3. คลิก **Add Strategy** (ถ้ามี) หรือใช้ API

### วิธีที่ 2: สร้าง Strategy ผ่าน API

#### สร้าง DCA Strategy:
```bash
curl -X POST http://localhost:3000/api/strategies \
  -H "Content-Type: application/json" \
  -d '{
    "type": "dca",
    "name": "DCA BTC/USDT",
    "symbol": "BTCUSDT",
    "userId": "your-user-id",
    "config": {
      "amountPerPurchase": 50,
      "purchaseInterval": 3600000,
      "maxPurchases": 5,
      "takeProfitPercent": 5,
      "stopLossPercent": 2.5
    }
  }'
```

#### สร้าง Grid Strategy:
```bash
curl -X POST http://localhost:3000/api/strategies \
  -H "Content-Type: application/json" \
  -d '{
    "type": "grid",
    "name": "Grid BTC/USDT",
    "symbol": "BTCUSDT",
    "userId": "your-user-id",
    "config": {
      "gridLevels": 10,
      "gridSpacing": 1,
      "quantityPerGrid": 0.001,
      "maxPositions": 5
    }
  }'
```

#### สร้าง Momentum Strategy (Auto-select pairs):
```bash
curl -X POST http://localhost:3000/api/strategies \
  -H "Content-Type: application/json" \
  -d '{
    "type": "momentum",
    "name": "Momentum Auto",
    "userId": "your-user-id",
    "config": {
      "positionSizePercent": 5,
      "takeProfitPercent": 5,
      "stopLossPercent": 2.5,
      "rsiPeriod": 14,
      "fastEMA": 12,
      "slowEMA": 26
    }
  }'
```

#### สร้าง Mean Reversion Strategy (Auto-select pairs):
```bash
curl -X POST http://localhost:3000/api/strategies \
  -H "Content-Type: application/json" \
  -d '{
    "type": "mean_reversion",
    "name": "Mean Reversion Auto",
    "userId": "your-user-id",
    "config": {
      "positionSizePercent": 5,
      "takeProfitPercent": 2,
      "stopLossPercent": 3,
      "rsiPeriod": 14,
      "minRevertDistance": 2
    }
  }'
```

### วิธีที่ 3: Start Strategy ที่มีอยู่แล้ว

```bash
# ดู strategies ทั้งหมด
curl http://localhost:3000/api/strategies

# Start strategy (ใช้ strategy ID)
curl -X POST http://localhost:3000/api/strategies/{strategy-id}/start
```

## Execution Loop

ระบบจะตรวจสอบและ execute strategies **ทุก 1 นาที** (default)

สามารถปรับ interval ได้โดยตั้งค่า environment variable:
```bash
EXECUTION_INTERVAL_MS=30000  # 30 seconds
```

## Pair Selection (Auto-select)

สำหรับ strategies ที่ไม่กำหนด `symbol`:
- ระบบจะเลือกคู่เงินอัตโนมัติจาก **Top 30 volume pairs**
- ใช้ **Technical Analysis** เพื่อให้คะแนนและเลือกคู่ที่ดีที่สุด
- อัพเดทคะแนนทุก **1 ชั่วโมง** (default)

## การตรวจสอบสถานะ

### ดู Active Strategies:
```bash
curl http://localhost:3000/api/strategies | jq '.data[] | select(.isActive == true)'
```

### ดู Open Positions:
```bash
curl http://localhost:3000/api/positions/open
```

### ดู Recent Trades:
```bash
curl http://localhost:3000/api/trades?limit=10
```

### ดู Performance:
```bash
curl http://localhost:3000/api/performance
```

## สิ่งที่ต้องตรวจสอบก่อนเทรด:

1. ✅ **API Key ตั้งค่าถูกต้อง** - ดู `BINANCE_API_SETUP.md`
2. ✅ **Database migrations รันแล้ว** - `bun run db:migrate`
3. ✅ **มี Balance พอ** - ตรวจสอบผ่าน Dashboard
4. ✅ **Risk Limits ตั้งค่าถูกต้อง** - ดูใน `.env`
5. ✅ **ใช้ Testnet ก่อน** - ตั้ง `BINANCE_TESTNET=true` สำหรับทดสอบ

## หมายเหตุสำคัญ:

⚠️ **ระบบจะเทรดจริงเมื่อ:**
- มี Active Strategy
- Strategy Execution Loop กำลังรัน
- มีเงินในบัญชีพอ

⚠️ **สำหรับ Production:**
- ตรวจสอบ API key และ permissions
- ตั้ง `BINANCE_TESTNET=false`
- Review risk management settings
- เริ่มด้วยเงินจำนวนน้อย

⚠️ **ระบบจะไม่เทรดถ้า:**
- ไม่มี Active Strategies
- Strategy Execution Loop ไม่ได้เริ่ม
- Risk limits ถูก exceeded
- ไม่มี Balance พอ

