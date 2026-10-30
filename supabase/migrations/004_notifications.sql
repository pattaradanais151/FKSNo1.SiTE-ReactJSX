-- ============================================================================
-- FKSNo1.SiTE | 004_notifications.sql  (ต้องรัน 001–003 ก่อน, รันซ้ำได้)
-- คิวแจ้งเตือน Discord: Trigger -> notification_logs -> pg_net -> Edge Function
-- การใส่คิวไม่ทำให้ Transaction หลักล้มเหลวในทุกกรณี
-- ต้องตั้งค่า Vault: fksno1_project_url, fksno1_notify_secret
-- ============================================================================

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- ============================================================================
-- 1. ปรับตารางคิว
-- ============================================================================

alter table public.notification_logs add column if not exists next_attempt_at timestamptz;
alter table public.notification_logs add column if not exists locked_at timestamptz;

alter table public.notification_logs drop constraint if exists notification_logs_status_check;
alter table public.notification_logs add constraint notification_logs_status_check
  check (status in ('pending', 'sending', 'sent', 'failed', 'skipped'));

create index if not exists idx_notif_queue
  on public.notification_logs (status, next_attempt_at)
  where status in ('pending', 'sending', 'failed');
create index if not exists idx_notif_event on public.notification_logs (event_type, created_at desc);

-- ============================================================================
-- 2. การตั้งค่า
-- ============================================================================

create or replace function private.app_settings_before_write()
returns trigger language plpgsql security definer set search_path = '' as $
declare
  v_num numeric;
begin
  if new.key = 'installment_interest_rate_percent' then
    if jsonb_typeof(new.value) <> 'number' then
      raise exception 'อัตราดอกเบี้ยต้องเป็นตัวเลข';
    end if;
    v_num := (new.value #>> '{}')::numeric;
    if v_num < 0 or v_num > 100 then
      raise exception 'อัตราดอกเบี้ยต้องอยู่ระหว่าง 0 ถึง 100';
    end if;
  elsif new.key = 'installment_interest_mode' then
    if jsonb_typeof(new.value) <> 'string' or (new.value #>> '{}') not in ('one_time', 'per_month') then
      raise exception 'โหมดดอกเบี้ยต้องเป็น one_time หรือ per_month';
    end if;
  elsif new.key in ('admin_can_manage_store', 'admin_can_manage_policies', 'notification_include_amounts') then
    if jsonb_typeof(new.value) <> 'boolean' then
      raise exception 'ค่าต้องเป็น true หรือ false';
    end if;
  elsif new.key = 'notification_events' then
    if jsonb_typeof(new.value) <> 'object' then
      raise exception 'การตั้งค่าแจ้งเตือนต้องเป็น object';
    end if;
    if exists (select 1 from jsonb_each(new.value) e where jsonb_typeof(e.value) <> 'boolean') then
      raise exception 'ค่าการเปิด/ปิดแจ้งเตือนต้องเป็น true หรือ false';
    end if;
  elsif new.key = 'installment_due_soon_days' then
    if jsonb_typeof(new.value) <> 'number' or (new.value #>> '{}')::numeric not between 0 and 60 then
      raise exception 'จำนวนวันแจ้งเตือนต้องอยู่ระหว่าง 0 ถึง 60';
    end if;
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end;
$;

insert into public.app_settings (key, value) values ('notification_include_amounts', 'false'::jsonb)
on conflict (key) do nothing;

-- เติม Key ที่อาจขาด โดยไม่ทับค่าที่ผู้ใช้ตั้งไว้
update public.app_settings
   set value = jsonb_build_object(
         'job_created', true, 'job_status_changed', true, 'job_assigned', true, 'price_changed', true,
         'payment_recorded', true, 'installment_created', true, 'installment_paid', true,
         'installment_due_soon', true, 'installment_overdue', true, 'employee_changed', true,
         'store_changed', true) || value
 where key = 'notification_events';

-- ============================================================================
-- 3. ฟังก์ชันคิว
-- ============================================================================

-- เรียก Edge Function (Async ผ่าน pg_net ส่งจริงหลัง Commit เท่านั้น)
-- p_force = false: เรียกครั้งเดียวต่อ Transaction / true: ใช้กับ Cron เรียกเมื่อมีรายการพร้อมส่ง
create or replace function private.kick_notifier(p_force boolean default false)
returns void language plpgsql security definer set search_path = '' as $
declare
  v_url text;
  v_secret text;
begin
  if p_force then
    if not exists (
      select 1 from public.notification_logs q
       where q.attempts < 5
         and ((q.status in ('pending', 'failed') and coalesce(q.next_attempt_at, q.created_at) <= now())
              or (q.status = 'sending' and q.locked_at < now() - interval '5 minutes'))
    ) then
      return;
    end if;
  else
    if current_setting('app.notify_kicked', true) = '1' then
      return;
    end if;
    perform set_config('app.notify_kicked', '1', true);
  end if;

  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'fksno1_project_url';
  select s.decrypted_secret into v_secret from vault.decrypted_secrets s where s.name = 'fksno1_notify_secret';
  if v_url is null or v_secret is null then
    return; -- ยังไม่ตั้งค่า Vault: รายการรออยู่ในคิว
  end if;

  perform net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/discord-notify',
    body := jsonb_build_object('action', 'process'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', v_secret),
    timeout_milliseconds := 30000
  );
exception when others then
  raise warning 'kick_notifier: %', sqlerrm;
end;
$;

-- ใส่คิว: ตรวจการเปิด/ปิดประเภท, กันซ้ำด้วย dedupe_key, ไม่โยน Error ออกไป
create or replace function private.enqueue_notification(
  p_event text,
  p_toggle text,
  p_entity_type text,
  p_entity_id text,
  p_dedupe text,
  p_summary jsonb,
  p_delay interval default null
)
returns void language plpgsql security definer set search_path = '' as $
declare
  v_enabled boolean;
begin
  select (s.value ->> p_toggle)::boolean into v_enabled
    from public.app_settings s where s.key = 'notification_events';
  if v_enabled is false then
    return;
  end if;

  insert into public.notification_logs
    (event_type, entity_type, entity_id, dedupe_key, status, summary, triggered_by, next_attempt_at)
  values
    (p_event, p_entity_type, p_entity_id, p_dedupe, 'pending', coalesce(p_summary, '{}'::jsonb),
     private.current_actor(), case when p_delay is null then null else now() + p_delay end)
  on conflict (dedupe_key) do nothing;

  perform private.kick_notifier(false);
exception when others then
  raise warning 'enqueue_notification(%): %', p_event, sqlerrm;
end;
$;

-- ข้อมูลงานที่ใช้ในข้อความ (ไม่มีข้อมูลติดต่อลูกค้า)
create or replace function private.job_notify_context(p_job_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $
  select jsonb_build_object(
    'job_id', j.id,
    'job_number', j.job_number,
    'job_type', case when j.job_type = 'other' and j.other_type_name is not null
                     then coalesce(t.label_th, j.job_type) || ': ' || j.other_type_name
                     else coalesce(t.label_th, j.job_type) end,
    'title', j.title,
    'status', j.status,
    'assignee', (select p.full_name from public.profiles p where p.id = j.assigned_to),
    'due_date', j.due_date)
    from public.jobs j
    left join public.job_types t on t.code = j.job_type
   where j.id = p_job_id
$;

create or replace function private.actor_name()
returns text language sql stable security definer set search_path = '' as $
  select p.full_name from public.profiles p where p.id = private.current_actor()
$;

-- ============================================================================
-- 4. Trigger แจ้งเตือน
-- ============================================================================

create or replace function private.notify_job_created()
returns trigger language plpgsql security definer set search_path = '' as $
begin
  perform private.enqueue_notification(
    'job_created', 'job_created', 'job', new.id::text, 'job_created:' || new.id,
    coalesce(private.job_notify_context(new.id), '{}'::jsonb) || jsonb_build_object('actor', private.actor_name()));
  return null;
end;
$;

create or replace function private.notify_job_update()
returns trigger language plpgsql security definer set search_path = '' as $
declare
  v_actor text := (select p.full_name from public.profiles p where p.id = new.author_id);
begin
  if new.update_type = 'status_change' and new.from_status is not null then
    perform private.enqueue_notification(
      'job_status_changed', 'job_status_changed', 'job', new.job_id::text, 'job_status:' || new.id,
      coalesce(private.job_notify_context(new.job_id), '{}'::jsonb)
        || jsonb_build_object('from_status', new.from_status, 'to_status', new.to_status, 'actor', v_actor));
  elsif new.update_type = 'assignment' then
    perform private.enqueue_notification(
      'job_assigned', 'job_assigned', 'job', new.job_id::text, 'job_assigned:' || new.id,
      coalesce(private.job_notify_context(new.job_id), '{}'::jsonb) || jsonb_build_object('actor', v_actor));
  end if;
  return null;
end;
$;

-- ราคาเปลี่ยน: รวมการแก้ไขภายใน 2 นาทีเป็นข้อความเดียว (debounce)
create or replace function private.notify_price_changed()
returns trigger language plpgsql security definer set search_path = '' as $
declare
  v_summary jsonb;
begin
  v_summary := coalesce(private.job_notify_context(new.job_id), '{}'::jsonb)
    || jsonb_build_object('net_amount', new.net_amount, 'payable_amount', new.payable_amount,
                          'actor', private.actor_name());
  update public.notification_logs
     set summary = v_summary, next_attempt_at = now() + interval '2 minutes'
   where event_type = 'price_changed' and entity_id = new.job_id::text and status = 'pending';
  if not found then
    perform private.enqueue_notification(
      'price_changed', 'price_changed', 'job', new.job_id::text,
      'price:' || new.job_id || ':' || gen_random_uuid(), v_summary, interval '2 minutes');
  end if;
  return null;
exception when others then
  raise warning 'notify_price_changed: %', sqlerrm;
  return null;
end;
$;

create or replace function private.notify_payment()
returns trigger language plpgsql security definer set search_path = '' as $
declare
  v_event text;
  v_toggle text := 'payment_recorded';
  v_key text;
  v_status text;
  v_balance numeric;
  v_no integer;
  v_plan uuid;
begin
  if tg_op = 'INSERT' then
    if new.kind = 'refund' then
      v_event := 'payment_refunded';
    elsif new.installment_item_id is not null then
      v_event := 'installment_paid';
      v_toggle := 'installment_paid';
    else
      v_event := 'payment_recorded';
    end if;
    v_key := 'payment:' || new.id;
  elsif new.voided_at is not null and old.voided_at is null then
    v_event := 'payment_voided';
    v_key := 'payment_void:' || new.id;
  else
    return null;
  end if;

  select jf.payment_status, jf.balance_amount into v_status, v_balance
    from public.job_finance jf where jf.job_id = new.job_id;
  select i.installment_no, i.plan_id into v_no, v_plan
    from public.installment_items i where i.id = new.installment_item_id;

  perform private.enqueue_notification(
    v_event, v_toggle, 'payment', new.id::text, v_key,
    coalesce(private.job_notify_context(new.job_id), '{}'::jsonb) || jsonb_build_object(
      'kind', new.kind, 'amount', new.amount, 'method', new.method,
      'payment_status', v_status, 'balance_amount', v_balance,
      'installment_no', v_no, 'plan_id', v_plan, 'actor', private.actor_name()));
  return null;
exception when others then
  raise warning 'notify_payment: %', sqlerrm;
  return null;
end;
$;

create or replace function private.notify_installment_plan()
returns trigger language plpgsql security definer set search_path = '' as $
begin
  perform private.enqueue_notification(
    'installment_created', 'installment_created', 'installment_plan', new.id::text, 'plan_created:' || new.id,
    coalesce(private.job_notify_context(new.job_id), '{}'::jsonb) || jsonb_build_object(
      'plan_id', new.id, 'installment_count', new.installment_count, 'interval_months', new.interval_months,
      'principal_amount', new.principal_amount, 'interest_amount', new.interest_amount,
      'total_amount', new.total_amount, 'interest_rate_percent', new.interest_rate_percent,
      'interest_mode', new.interest_mode, 'first_due_date', new.first_due_date,
      'actor', private.actor_name()));
  return null;
end;
$;

create or replace function private.notify_profile()
returns trigger language plpgsql security definer set search_path = '' as $
begin
  if tg_op = 'INSERT' then
    perform private.enqueue_notification(
      'employee_created', 'employee_changed', 'profile', new.id::text, 'employee_created:' || new.id,
      jsonb_build_object('name', new.full_name, 'role', new.role, 'is_active', new.is_active,
                         'actor', private.actor_name()));
  elsif new.role is distinct from old.role or new.is_active is distinct from old.is_active then
    perform private.enqueue_notification(
      'employee_changed', 'employee_changed', 'profile', new.id::text,
      'employee:' || new.id || ':' || txid_current(),
      jsonb_build_object('name', new.full_name, 'old_role', old.role, 'role', new.role,
                         'old_active', old.is_active, 'is_active', new.is_active,
                         'actor', private.actor_name()));
  end if;
  return null;
end;
$;

create or replace function private.notify_store()
returns trigger language plpgsql security definer set search_path = '' as $
declare
  v_fields jsonb;
begin
  select coalesce(jsonb_agg(k order by k), '[]'::jsonb) into v_fields
    from jsonb_object_keys(to_jsonb(new)) as k
   where k not in ('updated_at', 'updated_by')
     and (to_jsonb(new) -> k) is distinct from (to_jsonb(old) -> k);
  if jsonb_array_length(v_fields) = 0 then
    return null;
  end if;
  perform private.enqueue_notification(
    'store_changed', 'store_changed', 'store', '1', 'store:' || txid_current(),
    jsonb_build_object('fields', v_fields, 'actor', private.actor_name()));
  return null;
exception when others then
  raise warning 'notify_store: %', sqlerrm;
  return null;
end;
$;

-- งวดผ่อนใกล้ครบกำหนด / เลยกำหนด (เรียกจาก Cron วันละครั้ง)
-- ใกล้ครบกำหนด: แจ้งครั้งเดียวต่องวด / เลยกำหนด: แจ้งครั้งเดียวต่องวด
create or replace function private.enqueue_installment_reminders()
returns integer language plpgsql security definer set search_path = '' as $
declare
  v_today date := private.today_th();
  v_days integer;
  v_count integer := 0;
  r record;
begin
  select (s.value #>> '{}')::integer into v_days from public.app_settings s where s.key = 'installment_due_soon_days';
  v_days := coalesce(v_days, 3);

  for r in
    select i.id, i.plan_id, i.job_id, i.installment_no, i.due_date, i.amount_due - i.paid_amount as outstanding
      from public.installment_items i
      join public.installment_plans p on p.id = i.plan_id
      join public.jobs j on j.id = i.job_id
     where p.status = 'active' and i.status <> 'paid' and j.status <> 'cancelled'
       and i.due_date <= v_today + v_days
  loop
    if r.due_date < v_today then
      perform private.enqueue_notification(
        'installment_overdue', 'installment_overdue', 'installment_item', r.id::text,
        'inst_overdue:' || r.id || ':' || r.due_date,
        coalesce(private.job_notify_context(r.job_id), '{}'::jsonb) || jsonb_build_object(
          'plan_id', r.plan_id, 'installment_no', r.installment_no, 'installment_due', r.due_date,
          'outstanding', r.outstanding, 'days_overdue', v_today - r.due_date));
    else
      perform private.enqueue_notification(
        'installment_due_soon', 'installment_due_soon', 'installment_item', r.id::text,
        'inst_due:' || r.id || ':' || r.due_date,
        coalesce(private.job_notify_context(r.job_id), '{}'::jsonb) || jsonb_build_object(
          'plan_id', r.plan_id, 'installment_no', r.installment_no, 'installment_due', r.due_date,
          'outstanding', r.outstanding, 'days_left', r.due_date - v_today));
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$;

-- ============================================================================
-- 5. สร้าง Trigger (ชื่อเรียงตามตัวอักษร: notify ทำงานหลัง Trigger คำนวณเงิน)
-- ============================================================================

drop trigger if exists trg_jobs_notify on public.jobs;
create trigger trg_jobs_notify after insert on public.jobs
  for each row execute function private.notify_job_created();

drop trigger if exists trg_job_updates_notify on public.job_updates;
create trigger trg_job_updates_notify after insert on public.job_updates
  for each row execute function private.notify_job_update();

drop trigger if exists trg_job_finance_notify on public.job_finance;
create trigger trg_job_finance_notify after update on public.job_finance
  for each row when (old.net_amount is distinct from new.net_amount)
  execute function private.notify_price_changed();

drop trigger if exists trg_payments_notify on public.payments;
create trigger trg_payments_notify after insert or update on public.payments
  for each row execute function private.notify_payment();

drop trigger if exists trg_plans_notify on public.installment_plans;
create trigger trg_plans_notify after insert on public.installment_plans
  for each row execute function private.notify_installment_plan();

drop trigger if exists trg_profiles_notify on public.profiles;
create trigger trg_profiles_notify after insert or update on public.profiles
  for each row execute function private.notify_profile();

drop trigger if exists trg_store_notify on public.store_settings;
create trigger trg_store_notify after update on public.store_settings
  for each row execute function private.notify_store();

-- ============================================================================
-- 6. RPC สำหรับ Edge Function: ดึงคิวแบบล็อก (กันส่งซ้ำเมื่อเรียกพร้อมกัน)
-- ============================================================================

create or replace function public.claim_notifications(p_limit integer default 10)
returns setof public.notification_logs
language plpgsql security definer set search_path = '' as $
begin
  update public.notification_logs
     set status = 'failed', locked_at = null,
         error_message = coalesce(error_message, 'หมดเวลาระหว่างส่ง')
   where status = 'sending' and locked_at < now() - interval '5 minutes' and attempts >= 5;

  return query
  update public.notification_logs n
     set status = 'sending', locked_at = now(), attempts = n.attempts + 1
   where n.id in (
     select q.id from public.notification_logs q
      where q.attempts < 5
        and ((q.status in ('pending', 'failed') and coalesce(q.next_attempt_at, q.created_at) <= now())
             or (q.status = 'sending' and q.locked_at < now() - interval '5 minutes'))
      order by q.created_at
      limit greatest(1, least(coalesce(p_limit, 10), 50))
      for update skip locked)
  returning n.*;
end;
$;

-- ============================================================================
-- 7. Cron
-- ============================================================================

select cron.schedule('fksno1-notify-sweep', '* * * * *', $select private.kick_notifier(true)$);
select cron.schedule('fksno1-installment-reminders', '0 1 * * *', $select private.enqueue_installment_reminders()$);
select cron.schedule('fksno1-notify-cleanup', '30 19 * * *',
  $delete from public.notification_logs where status in ('sent', 'skipped') and created_at < now() - interval '90 days'$);

-- ============================================================================
-- 8. สิทธิ์
-- ============================================================================

revoke all on function private.kick_notifier(boolean) from public, anon, authenticated;
revoke all on function private.enqueue_notification(text, text, text, text, text, jsonb, interval) from public, anon, authenticated;
revoke all on function private.job_notify_context(uuid) from public, anon, authenticated;
revoke all on function private.actor_name() from public, anon, authenticated;
revoke all on function private.notify_job_created() from public, anon, authenticated;
revoke all on function private.notify_job_update() from public, anon, authenticated;
revoke all on function private.notify_price_changed() from public, anon, authenticated;
revoke all on function private.notify_payment() from public, anon, authenticated;
revoke all on function private.notify_installment_plan() from public, anon, authenticated;
revoke all on function private.notify_profile() from public, anon, authenticated;
revoke all on function private.notify_store() from public, anon, authenticated;
revoke all on function private.enqueue_installment_reminders() from public, anon, authenticated;
revoke all on function public.claim_notifications(integer) from public, anon, authenticated;
grant execute on function public.claim_notifications(integer) to service_role;