# FKSNo1.SiTE

ระบบบริหารงานบริการด้านไอที (React + Vite + Supabase)

## เริ่มใช้งาน (Development)

1. ติดตั้ง Node.js 20 ขึ้นไป
2. `npm install`
3. `cp .env.example .env.local` แล้วกรอก `VITE_SUPABASE_URL` และ `VITE_SUPABASE_PUBLISHABLE_KEY`
   (Supabase Dashboard > Project Settings > API Keys; ใช้เฉพาะ Publishable/Anon Key)
4. `npm run dev` แล้วเปิด http://localhost:5173

## คำสั่ง
- `npm run dev`: เปิดโหมดพัฒนา
- `npm run build`: Build สำหรับ Production (โฟลเดอร์ `dist`)
- `npm run preview`: ดูผล Build
- `npm run lint`: ตรวจโค้ด

## Deploy (Cloudflare Pages)
- Build command: `npm run build`
- Build output directory: `dist`
- Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`

ดู `PROJECT_SPEC.md` สำหรับข้อกำหนดและสูตรการเงิน