# FKSNo1.SiTE

ระบบบริหารงานบริการด้านไอทีครบวงจร รองรับงานซ่อม เคลม ทำเว็บไซต์ และระบบอินเทอร์เน็ต พร้อมระบบการเงิน ผ่อนชำระ และแจ้งเตือนผ่าน Discord

## การติดตั้งและใช้งาน (Development)

1. โคลนโปรเจกต์และติดตั้ง Dependencies:
   ```bash
   npm install
   ```
2. สร้างไฟล์ `.env.local` จาก `.env.example` แล้วกรอก `VITE_SUPABASE_URL` และ `VITE_SUPABASE_PUBLISHABLE_KEY` (ใช้เฉพาะ Anon/Publishable Key)
3. รันสคริปต์ Migration `001` ถึง `004` บน Supabase SQL Editor
4. รันโปรแกรมในโหมดพัฒนา:
   ```bash
   npm run dev
   ```

## การ Deploy บน Cloudflare Pages

- **Build Command:** `npm run build`
- **Build Output Directory:** `dist`
- **Environment Variables:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
- ระบบมีไฟล์ `public/_redirects` รองรับ SPA Client-Side Routing เรียบร้อยแล้ว

ดูรายละเอียดข้อกำหนดทางเทคนิคทั้งหมดใน `PROJECT_SPEC.md`