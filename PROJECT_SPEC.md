# FKSNo1.SiTE: Project Spec (ฉบับสมบูรณ์)

ระบบบริหารงานบริการด้านไอที (หลังบ้านสำหรับผู้ดูแลและพนักงาน)

## Tech Stack
- Frontend: React + Vite, JavaScript/JSX เท่านั้น, Emotion, Tailwind CSS v4, Bootstrap (Components), Lucide Icons
- Backend & DB: Supabase (PostgreSQL, Auth, Storage, RLS, Edge Functions, pg_net, pg_cron)
- Deployment: Cloudflare Pages

## บทบาท (RBAC)
- **Super Admin:** เข้าถึงทุกส่วน จัดการพนักงาน ตั้งค่าระบบ ข้อมูลร้าน นโยบาย และ Audit Logs
- **Admin:** จัดการลูกค้า งานบริการ การเงิน ประเมินราคา และพนักงานระดับ Staff
- **Staff:** ดูและอัปเดตสถานะงานเฉพาะที่ได้รับมอบหมาย บันทึกความคืบหน้าและโน้ตทีม ไม่เห็นข้อมูลการเงิน

## สูตรการเงิน (JS ใช้จำนวนเต็มสตางค์ / DB ใช้ numeric(12,2))
- ยอดรวมก่อนส่วนลด = ค่าบริการ + ค่าอะไหล่ + ค่าใช้จ่ายอื่น
- ยอดสุทธิ = max(ยอดรวมก่อนส่วนลด - ส่วนลด, 0)
- ยอดต้องชำระ = ยอดสุทธิ + ดอกเบี้ยผ่อน
- ยอดคงเหลือ = max(ยอดต้องชำระ - เงินที่ชำระแล้ว, 0)
- เงินต้นแผนผ่อน = ยอดคงเหลือ ณ เวลาสร้างแผน
- ดอกเบี้ย (ค่าเริ่มต้น per_month): เงินต้น x 1.2% x จำนวนเดือนทั้งหมด (รองรับโหมด one_time ด้วย)
- เศษสตางค์: หารเท่ากัน แล้วบวก 0.01 ให้งวดแรก ๆ จนผลรวมเท่ายอดรวมพอดี

## Discord Notifications
- ส่งผ่าน Edge Function `discord-notify` และคิว `notification_logs`
- ป้องกันการส่งซ้ำด้วย `dedupe_key` และมีระบบ Retry อัตโนมัติสูงสุด 5 ครั้ง
- ตรวจสอบความปลอดภัยด้วย Secret และ Vault