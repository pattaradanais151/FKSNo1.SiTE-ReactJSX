-- ============================================================================
-- FKSNo1.SiTE | 001_initial_schema.sql
--
-- รันซ้ำได้อย่างปลอดภัย (idempotent):
--   create ... if not exists / create or replace / drop policy|trigger if exists
--   ข้อมูลตั้งต้นใช้ on conflict do nothing
-- หมายเหตุ: ถ้าต้องแก้ Schema ของตารางที่สร้างไปแล้ว ให้เขียนไฟล์ 002_... เพิ่ม
--
-- ลำดับ: 0 Schema/Sequence | 1 ตาราง | 2 ฟังก์ชันช่วยตรวจสิทธิ์ | 3 ฟังก์ชัน Trigger
--        4 การเงิน | 5 RPC | 6 สร้าง Trigger | 7 เปิด RLS | 8 Policies
--        9 Grants | 10 Storage | 11 ข้อมูลตั้งต้น
-- ============================================================================

-- ============================================================================
-- 0. Schema และ Sequence
-- ============================================================================

create schema if not exists private;  -- ฟังก์ชันภายใน ไม่เปิดผ่าน API

create sequence if not exists public.customer_code_seq;
create sequence if not exists public.job_number_seq;

-- ============================================================================
-- 1. ตาราง
-- ============================================================================

-- 1.1 profiles: ข้อมูลผู้ใช้และ Role (is_active เริ่มต้นเป็น false เพื่อความปลอดภัย)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text not null default '',
  phone text,
  avatar_url text,
  role text not null default 'staff' check (role in ('super_admin', 'admin', 'staff')),
  is_active boolean not null default false,
  locale text not null default 'th' check (locale in ('th', 'en')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 1.2 customers
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  customer_code text not null unique,
  customer_type text not null default 'individual' check (customer_type in ('individual', 'company')),
  name text not null check (length(btrim(name)) > 0),
  phone text not null check (phone ~ '^[0-9+() -]{6,25}

---

### ขั้นตอนติดตั้ง

1. **สร้างโปรเจกต์ Supabase** ที่ supabase.com
2. **ปิดการสมัครสมาชิกสาธารณะ** ที่ Authentication > Sign In / Providers แล้วปิด "Allow new users to sign up" ไม่งั้นใครก็สมัครบัญชีเข้ามาได้ (บัญชีใหม่จะไม่ Active และไม่มีสิทธิ์ใดๆ แต่ไม่ควรเปิดไว้)
3. **รัน Migration** ด้วยวิธีใดวิธีหนึ่ง
   - วางไฟล์ลง SQL Editor แล้วกด Run
   - หรือใช้ CLI
     ```bash
     npm i -D supabase
     npx supabase login
     npx supabase link --project-ref <project-ref>
     
    