# FKSNo1.SiTE: Project Spec

ระบบบริหารงานบริการด้านไอที (หลังบ้านสำหรับผู้ดูแลและพนักงานเท่านั้น ยังไม่มีหน้าลูกค้า)

## ข้อกำหนดหลัก
- Frontend: React + Vite, JavaScript/JSX เท่านั้น
- Backend: Supabase (Auth, PostgreSQL, Storage, RLS, Edge Functions)
- Edge Functions เขียนด้วย TypeScript (ข้อจำกัดของ Supabase/Deno Runtime)
- ห้ามมี Secret ใน Frontend; Discord Webhook อยู่ใน Edge Function Secrets เท่านั้น
- ห้ามใช้ข้อมูลจำลองแสดงแทนข้อมูลจริง
- การบังคับสิทธิ์ทำที่ RLS / RPC / Edge Functions; UI ซ่อนเมนูเพื่อความสะดวกเท่านั้น
- anon ไม่มีสิทธิ์เข้าถึงตารางใดเลย

## บทบาท (RBAC)
| ความสามารถ | Staff | Admin | Super Admin |
|---|---|---|---|
| เห็นงาน | เฉพาะที่ได้รับมอบหมาย | ทั้งหมด | ทั้งหมด |
| เปลี่ยนสถานะงาน | ผ่าน RPC, ยกเลิกไม่ได้ | ได้ | ได้ |
| ลูกค้า/อุปกรณ์ | เห็นเฉพาะของงานที่ได้รับมอบหมาย | จัดการได้ | จัดการได้ |
| การเงิน | ไม่เห็น | จัดการได้ | จัดการได้ |
| Internal Note | เฉพาะ visibility = team ของงานตัวเอง | ทั้งหมด | ทั้งหมด |
| ข้อมูลร้าน/นโยบาย | อ่าน | เมื่อเปิดสิทธิ์ใน app_settings | ได้ |
| ตั้งค่าระบบ/Audit Log | ไม่ได้ | ไม่ได้ | ได้ |
| Role/เปิด-ปิดบัญชี | ไม่ได้ | ผ่าน Edge Function (เฉพาะ Staff) | ผ่าน Edge Function |

## Database (สรุปการตัดสินใจ Phase 2)
- ตัวเลขเงินอยู่ที่ job_finance แยกจาก jobs (RLS กรองได้แค่ระดับแถว)
- ผู้รับผิดชอบงานคนเดียว: jobs.assigned_to (ไม่มีตาราง job_assignments; ประวัติอยู่ใน job_updates)
- อาการ/อุปกรณ์เสริม/สภาพ/รูปภาพ เก็บที่ jobs (เครื่องเดียวเข้าซ่อมได้หลายครั้ง)
- ประเภทงานในตาราง job_types; ฟิลด์เฉพาะหมวดเก็บใน jobs.details (jsonb)
- ตารางเพิ่ม: app_settings, policy_versions
- ลบงานไม่ได้ (ใช้การยกเลิก + เหตุผล); การชำระเงินแก้ไม่ได้ (void + เหตุผล)
- คืนเงินได้เฉพาะงานที่ยกเลิก
- ประวัติ (job_updates, internal_notes, audit_logs) แก้ไข/ลบไม่ได้

## Styling
- ลำดับ CSS Layer: theme, base, bootstrap, components, utilities
- Bootstrap คอมไพล์จาก src/bootstrap.scss เฉพาะ Components (ไม่มี Utilities API เพราะใช้ !important และชนกับ Tailwind)
- Tailwind: layout/spacing/สี | Bootstrap: btn, form-control, form-select, table, alert, spinner | Emotion: Component เฉพาะตัว
- CSS ที่ไม่อยู่ใน layer (Emotion) ชนะทุก layer: อย่าตั้ง display/padding ใน Emotion บน element ที่ใช้ Tailwind class ควบคุมค่าเดียวกัน
- ห้ามใช้คลาส Bootstrap utilities (d-flex, p-3, text-success ฯลฯ) เพราะไม่ได้คอมไพล์ไว้; ใช้ Tailwind แทน
- สีสถานะใช้ tokens --tone-{neutral|info|primary|warning|success|danger}-{bg|fg}
- ไม่ใช้ Bootstrap JS; Modal/Drawer/Menu ควบคุมด้วย React

## Frontend โครงสร้าง
- src/lib/auth.jsx: Session + Profile + RBAC (useAuth)
- src/components/UI.jsx: Card, PageHeader, States, Badges, Field, Modal, ConfirmDialog, Toast, Pagination, ThemeSwitcher, ErrorBoundary
- src/components/Layout.jsx: Sidebar, Mobile Drawer, Header, Breadcrumbs, User Menu
- src/App.jsx: ตาราง ROUTES (min role, page, phase); หน้าโหลดแบบ Lazy ด้วย import.meta.glob
- หน้า Store Settings ต้อง dispatch STORE_UPDATED_EVENT หลังบันทึก

## สูตรการเงิน (JS ใช้จำนวนเต็มสตางค์ / DB ใช้ numeric(12,2))
- ยอดรวมก่อนส่วนลด = ค่าบริการ + ค่าอะไหล่ + ค่าใช้จ่ายอื่น
- ยอดสุทธิ = max(ยอดรวมก่อนส่วนลด - ส่วนลด, 0)
- ยอดต้องชำระ = ยอดสุทธิ + ดอกเบี้ยผ่อน
- ยอดคงเหลือ = max(ยอดต้องชำระ - เงินที่ชำระแล้ว, 0)
- เงินต้นของแผนผ่อน = ยอดคงเหลือ ณ เวลาสร้างแผน
- ดอกเบี้ย (ค่าเริ่มต้น per_month) = เงินต้น x 1.2% x จำนวนเดือนทั้งหมด
  ตัวอย่าง 10,000 บาท 12 งวด: ดอกเบี้ย 1,440 รวม 11,440
- โหมด one_time = เงินต้น x 1.2% (10,000 -> 10,120)
- อัตราและโหมดตั้งค่าได้ที่ app_settings; แต่ละแผนบันทึกอัตรา/โหมดที่ใช้จริง
- เศษสตางค์: หารเท่ากัน แล้วบวก 0.01 ให้งวดแรก ๆ จนผลรวมเท่ายอดรวม
- "ชำระครบ" ตัดสินจากยอดชำระจริงใน payments เท่านั้น
- สถานะงานแยกจากสถานะการชำระเงิน

## ข้อควรระวังทางกฎหมาย
อัตราดอกเบี้ยผ่อนชำระและเอกสารนโยบายต้องได้รับการตรวจสอบโดยผู้เชี่ยวชาญก่อนใช้งานจริง
ระบบเตรียมโครงสร้างให้กรอกเนื้อหาเท่านั้น และบังคับให้ยืนยัน legal_reviewed ก่อนเผยแพร่

## แผนงาน
1 Setup | 2 Database & Security | 3 Auth & Layout | 4 Core | 5 Finance | 6 Admin | 7 Discord | 8 Test & Deploy