# การตั้งค่า Binance API Key

## ปัญหา: Invalid API-key, IP, or permissions for action

Error นี้เกิดจากหลายสาเหตุ ให้ตรวจสอบดังนี้:

## 1. สำหรับ Testnet (แนะนำสำหรับการทดสอบ)

### สร้าง Testnet API Key:
1. ไปที่ https://testnet.binance.vision/
2. สร้าง Testnet account (ใช้ GitHub account)
3. สร้าง API Key จาก Testnet Dashboard
4. ตั้งค่าใน `.env`:
   ```
   BINANCE_TESTNET=true
   BINANCE_API_KEY=your_testnet_api_key
   BINANCE_API_SECRET=your_testnet_api_secret
   ```

### Testnet API Key มีข้อจำกัด:
- ใช้ได้เฉพาะ Testnet เท่านั้น
- ไม่สามารถเชื่อมต่อกับ Production API ได้
- ใช้สำหรับทดสอบเท่านั้น ไม่มีเงินจริง

## 2. สำหรับ Production (เทรดจริง)

### สร้าง Production API Key:
1. ไปที่ https://www.binance.com/en/my/settings/api-management
2. สร้าง API Key ใหม่
3. **สำคัญ:** เปิดสิทธิ์ที่จำเป็น:
   - ✅ Enable Reading
   - ✅ Enable Spot & Margin Trading
   - ⚠️ Enable Withdrawals (ไม่แนะนำ ให้ปิดไว้)
4. **IP Restriction:** 
   - ถ้าเปิด IP restriction ให้เพิ่ม IP address ของ server
   - หรือปิด IP restriction เพื่อใช้งานได้จากทุกที่ (เสี่ยงกว่า)
5. ตั้งค่าใน `.env`:
   ```
   BINANCE_TESTNET=false
   BINANCE_API_KEY=your_production_api_key
   BINANCE_API_SECRET=your_production_api_secret
   ```

## 3. ตรวจสอบปัญหา

### ปัญหาที่พบบ่อย:

**A. API Key ไม่ตรงกับ Testnet/Production:**
- ถ้า `BINANCE_TESTNET=true` ต้องใช้ Testnet API Key
- ถ้า `BINANCE_TESTNET=false` ต้องใช้ Production API Key

**B. API Key ไม่มีสิทธิ์:**
- ต้องเปิด "Enable Reading" เพื่อดูข้อมูล account
- ต้องเปิด "Enable Spot & Margin Trading" เพื่อเทรด

**C. IP Restriction:**
- ถ้าเปิด IP restriction ใน Binance ต้องเพิ่ม IP ของ server
- หรือปิด IP restriction ชั่วคราวเพื่อทดสอบ

**D. API Key หมดอายุหรือถูก revoke:**
- สร้าง API Key ใหม่และอัพเดตใน `.env`

## 4. วิธีทดสอบ API Key

```bash
# ทดสอบว่า API key ใช้งานได้หรือไม่
curl -H "X-MBX-APIKEY: YOUR_API_KEY" \
  "https://api.binance.com/api/v3/ping"
```

## 5. Security Best Practices

1. **อย่าเปิด Enable Withdrawals** - เพื่อป้องกันการถอนเงินโดยไม่ได้รับอนุญาต
2. **ใช้ IP Restriction** - ถ้าเป็นไปได้ จำกัด IP ที่สามารถใช้ API Key ได้
3. **ใช้ Testnet ก่อน** - ทดสอบใน Testnet ให้แน่ใจว่าทุกอย่างทำงานก่อนไป Production
4. **อย่า share API Key** - เก็บ Secret ไว้เป็นความลับ
5. **Review Permissions** - ตรวจสอบสิทธิ์ของ API Key เป็นประจำ

## 6. สำหรับ Development

แนะนำให้ใช้ Testnet สำหรับการพัฒนา:
- ไม่เสี่ยงต่อเงินจริง
- สามารถทดสอบได้เต็มที่
- API เหมือนกับ Production

เมื่อพร้อมเทรดจริงแล้ว ค่อยเปลี่ยนไปใช้ Production API Key

