-- ============================================================================
-- FKSNo1.SiTE | 002_finance_rules.sql  (ต้องรัน 001 ก่อน, รันซ้ำได้)
-- 1) ห้ามแก้ราคา/ส่วนลดจนยอดที่ต้องชำระต่ำกว่าเงินที่รับไว้แล้ว
-- 2) คำนวณสถานะการชำระใหม่ทุกครั้งที่เปลี่ยนส่วนลด
-- 3) กำหนดอัตรา/รูปแบบดอกเบี้ยเฉพาะแผนได้เฉพาะ Super Admin
-- 4) RPC สรุปยอดรับชำระตามช่วงเวลา
-- ============================================================================

-- 1. ตรวจยอดรับเกิน
create or replace function private.assert_not_overpaid(p_job_id uuid)
returns void language plpgsql security definer set search_path = '' as $
declare
  v_payable numeric;
  v_paid numeric;
begin
  select jf.payable_amount, jf.paid_amount into v_payable, v_paid
    from public.job_finance jf where jf.job_id = p_job_id;
  if v_paid > v_payable then
    raise exception 'ยอดที่ต้องชำระใหม่ (% บาท) ต่ำกว่ายอดที่รับชำระแล้ว (% บาท) ต้องยกเลิกรายการชำระบางรายการก่อน',
      v_payable, v_paid;
  end if;
end;
$;

-- รายการราคาเปลี่ยน -> คำนวณใหม่ + ตรวจยอดรับเกิน (ถ้าเกิน คำสั่งทั้งหมดถูกย้อนกลับ)
create or replace function private.cost_items_after_change()
returns trigger language plpgsql security definer set search_path = '' as $
declare
  v_job uuid := coalesce(new.job_id, old.job_id);
begin
  perform private.recalc_job_finance(v_job);
  perform private.assert_not_overpaid(v_job);
  return null;
end;
$;

-- 2. ส่วนลดเปลี่ยน -> คำนวณสถานะใหม่ + ตรวจยอดรับเกิน
create or replace function private.job_finance_after_discount()
returns trigger language plpgsql security definer set search_path = '' as $
begin
  perform private.recalc_job_finance(new.job_id);
  perform private.assert_not_overpaid(new.job_id);
  return null;
end;
$;

drop trigger if exists trg_job_finance_after_discount on public.job_finance;
create trigger trg_job_finance_after_discount
  after update of discount on public.job_finance
  for each row
  when (old.discount is distinct from new.discount)
  execute function private.job_finance_after_discount();

-- 3. สร้างแผนผ่อน (เพิ่มการจำกัดสิทธิ์กำหนดอัตรา/รูปแบบดอกเบี้ยเฉพาะแผน)
create or replace function public.create_installment_plan(
  p_job_id uuid,
  p_installment_count integer,
  p_first_due_date date,
  p_interval_months integer default 1,
  p_interest_rate_percent numeric default null,
  p_interest_mode text default null,
  p_note text default null
)
returns uuid
language plpgsql security definer set search_path = '' as $
declare
  v_rate numeric;
  v_mode text;
  v_job_status text;
  v_jf public.job_finance;
  v_principal numeric;
  v_interest numeric;
  v_total numeric;
  v_plan_id uuid;
begin
  if not private.is_admin() then
    raise exception 'ไม่มีสิทธิ์สร้างแผนผ่อนชำระ' using errcode = '42501';
  end if;
  if (p_interest_rate_percent is not null or p_interest_mode is not null) and not private.is_super_admin() then
    raise exception 'เฉพาะ Super Admin เท่านั้นที่กำหนดอัตราหรือรูปแบบดอกเบี้ยเฉพาะแผนได้' using errcode = '42501';
  end if;
  if p_installment_count is null or p_installment_count < 1 or p_installment_count > 60 then
    raise exception 'จำนวนงวดต้องอยู่ระหว่าง 1 ถึง 60';
  end if;
  if p_interval_months is null or p_interval_months < 1 or p_interval_months > 12 then
    raise exception 'ระยะห่างระหว่างงวดต้องอยู่ระหว่าง 1 ถึง 12 เดือน';
  end if;
  if p_first_due_date is null then
    raise exception 'ต้องระบุวันครบกำหนดงวดแรก';
  end if;

  v_rate := coalesce(p_interest_rate_percent,
    (select (s.value #>> '{}')::numeric from public.app_settings s
      where s.key = 'installment_interest_rate_percent'), 1.2);
  v_mode := coalesce(p_interest_mode,
    (select s.value #>> '{}' from public.app_settings s
      where s.key = 'installment_interest_mode'), 'per_month');
  if v_rate < 0 or v_rate > 100 then
    raise exception 'อัตราดอกเบี้ยต้องอยู่ระหว่าง 0 ถึง 100';
  end if;
  if v_mode not in ('one_time', 'per_month') then
    raise exception 'โหมดดอกเบี้ยไม่ถูกต้อง';
  end if;

  select j.status into v_job_status from public.jobs j where j.id = p_job_id;
  if not found then
    raise exception 'ไม่พบงาน';
  end if;
  if v_job_status = 'cancelled' then
    raise exception 'งานที่ยกเลิกแล้วไม่สามารถสร้างแผนผ่อนชำระได้';
  end if;

  select * into v_jf from public.job_finance where job_id = p_job_id for update;
  if exists (select 1 from public.installment_plans p where p.job_id = p_job_id and p.status = 'active') then
    raise exception 'งานนี้มีแผนผ่อนชำระที่ใช้งานอยู่แล้ว';
  end if;

  v_principal := v_jf.balance_amount;
  if v_principal <= 0 then
    raise exception 'ไม่มียอดคงเหลือสำหรับผ่อนชำระ';
  end if;

  v_interest := public.calc_installment_interest(v_principal, v_rate, v_mode,
                                                 p_installment_count, p_interval_months);
  v_total := v_principal + v_interest;
  if round(v_total * 100) < p_installment_count then
    raise exception 'ยอดรวมน้อยเกินไปสำหรับจำนวนงวดนี้';
  end if;

  insert into public.installment_plans
    (job_id, principal_amount, interest_mode, interest_rate_percent, installment_count,
     interval_months, interest_amount, total_amount, first_due_date, note, created_by)
  values
    (p_job_id, v_principal, v_mode, v_rate, p_installment_count,
     p_interval_months, v_interest, v_total, p_first_due_date,
     nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_plan_id;

  insert into public.installment_items (plan_id, job_id, installment_no, due_date, amount_due)
  select v_plan_id, p_job_id, s.installment_no, s.due_date, s.amount
    from public.calc_installment_schedule(v_principal, v_rate, v_mode, p_installment_count,
                                          p_first_due_date, p_interval_months) s;

  update public.job_finance set interest_amount = v_interest where job_id = p_job_id;
  perform private.recalc_job_finance(p_job_id);
  return v_plan_id;
end;
$;

-- 4. สรุปยอดรับชำระตามช่วงเวลา (security invoker: RLS ให้เฉพาะ Admin เห็นข้อมูล)
--    ไม่นับรายการที่ถูก void / ช่วงเวลา [p_from, p_to)
create or replace function public.payment_summary(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql stable security invoker set search_path = '' as $
  with rows as (
    select p.kind, p.method, p.amount
      from public.payments p
     where p.voided_at is null
       and (p_from is null or p.paid_at >= p_from)
       and (p_to is null or p.paid_at < p_to)
  )
  select jsonb_build_object(
    'payment_total', coalesce((select sum(amount) from rows where kind = 'payment'), 0),
    'payment_count', (select count(*) from rows where kind = 'payment'),
    'refund_total', coalesce((select sum(amount) from rows where kind = 'refund'), 0),
    'refund_count', (select count(*) from rows where kind = 'refund'),
    'net_total', coalesce((select sum(case when kind = 'payment' then amount else -amount end) from rows), 0),
    'by_method', coalesce((
      select jsonb_object_agg(m.method, m.total)
        from (select method, sum(case when kind = 'payment' then amount else -amount end) as total
                from rows group by method) m
    ), '{}'::jsonb)
  )
$;

revoke all on function private.assert_not_overpaid(uuid) from public, anon, authenticated;
revoke all on function private.job_finance_after_discount() from public, anon, authenticated;
revoke all on function public.payment_summary(timestamptz, timestamptz) from public, anon;
revoke all on function public.create_installment_plan(uuid, integer, date, integer, numeric, text, text) from public, anon;
grant execute on function public.payment_summary(timestamptz, timestamptz) to authenticated;
grant execute on function public.create_installment_plan(uuid, integer, date, integer, numeric, text, text) to authenticated;