    -- ============================================================================
    -- FKSNo1.SiTE | 003_admin.sql  (ต้องรัน 001, 002 ก่อน, รันซ้ำได้)
    -- 1) Audit Log ระบุผู้ดำเนินการได้ แม้คำสั่งมาจาก Edge Function (service role)
    -- 2) admin_manage_profile: เปลี่ยนชื่อ/Role/สถานะบัญชี เรียกได้เฉพาะ service_role
    -- 3) job_report: รายงานงานตามช่วงวันที่
    -- ============================================================================

    -- 1. ผู้ดำเนินการปัจจุบัน: auth.uid() หรือค่า app.actor_id ที่ตั้งภายใน Transaction
    create or replace function private.current_actor()
    returns uuid language plpgsql stable set search_path = '' as $
    declare
    v_text text;
    begin
    if auth.uid() is not null then
        return auth.uid();
    end if;
    v_text := nullif(current_setting('app.actor_id', true), '');
    if v_text is null then
        return null;
    end if;
    return v_text::uuid;
    exception when others then
    return null;
    end;
    $;

    create or replace function private.log_audit()
    returns trigger language plpgsql security definer set search_path = '' as $
    declare
    v_excluded text[] := array['updated_at'] || tg_argv;
    v_old jsonb;
    v_new jsonb;
    v_row jsonb;
    v_changes jsonb := '{}'::jsonb;
    v_key text;
    v_actor uuid := private.current_actor();
    begin
    if tg_op = 'INSERT' then
        v_row := to_jsonb(new);
        v_changes := jsonb_build_object('new', v_row - v_excluded);
    elsif tg_op = 'DELETE' then
        v_row := to_jsonb(old);
        v_changes := jsonb_build_object('old', v_row - v_excluded);
    else
        v_old := to_jsonb(old);
        v_new := to_jsonb(new);
        v_row := v_new;
        for v_key in select jsonb_object_keys(v_new) loop
        if not (v_key = any (v_excluded)) and (v_new -> v_key) is distinct from (v_old -> v_key) then
            v_changes := v_changes || jsonb_build_object(
            v_key, jsonb_build_object('old', v_old -> v_key, 'new', v_new -> v_key));
        end if;
        end loop;
        if v_changes = '{}'::jsonb then
        return null;
        end if;
    end if;

    insert into public.audit_logs (actor_id, actor_role, action, table_name, record_id, changes)
    values (
        v_actor,
        (select p.role from public.profiles p where p.id = v_actor),
        tg_op,
        tg_table_name,
        coalesce(v_row ->> 'id', v_row ->> 'job_id', v_row ->> 'key'),
        v_changes
    );
    return null;
    end;
    $;

    -- 2. จัดการโปรไฟล์พนักงาน (ตรวจสิทธิ์ซ้ำใน Database แม้ Edge Function ตรวจแล้ว)
    --    p_changes: { full_name?, phone?, role?, is_active? }
    create or replace function public.admin_manage_profile(p_actor uuid, p_target uuid, p_changes jsonb)
    returns public.profiles
    language plpgsql security definer set search_path = '' as $
    declare
    v_actor public.profiles;
    v_target public.profiles;
    v_role text;
    v_active boolean;
    v_name text;
    v_phone text;
    v_result public.profiles;
    begin
    if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
        raise exception 'ข้อมูลที่ส่งมาไม่ถูกต้อง';
    end if;

    select * into v_actor from public.profiles where id = p_actor;
    if not found or not v_actor.is_active or v_actor.role not in ('admin', 'super_admin') then
        raise exception 'ไม่มีสิทธิ์จัดการพนักงาน' using errcode = '42501';
    end if;

    select * into v_target from public.profiles where id = p_target for update;
    if not found then
        raise exception 'ไม่พบบัญชีพนักงาน';
    end if;

    v_role := coalesce(nullif(p_changes ->> 'role', ''), v_target.role);
    v_active := coalesce((p_changes ->> 'is_active')::boolean, v_target.is_active);
    v_name := case when p_changes ? 'full_name'
                    then btrim(coalesce(p_changes ->> 'full_name', '')) else v_target.full_name end;
    v_phone := case when p_changes ? 'phone'
                    then nullif(btrim(coalesce(p_changes ->> 'phone', '')), '') else v_target.phone end;

    if v_role not in ('staff', 'admin', 'super_admin') then
        raise exception 'บทบาทไม่ถูกต้อง';
    end if;
    if v_name = '' then
        raise exception 'ต้องระบุชื่อพนักงาน';
    end if;
    if length(v_name) > 150 then
        raise exception 'ชื่อยาวเกิน 150 ตัวอักษร';
    end if;
    if v_phone is not null and v_phone !~ '^[0-9+() -]{6,25}

    ### `supabase/functions/manage-employee/index.ts`

    ```ts
    // Edge Function: จัดการบัญชีพนักงาน (ใช้ service role ฝั่ง Server เท่านั้น)
    // actions: list_auth | create | update | set_password | send_reset
    import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    const PHONE_RE = /^[0-9+() -]{6,25}$/
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const THAI_RE = /[\u0E00-\u0E7F]/
    const ROLES = ['staff', 'admin', 'super_admin']
    const BAN_FOREVER = '876000h'
    const MIN_PASSWORD = 8

    type Profile = { id: string; email: string | null; full_name: string; role: string; is_active: boolean }

    class HttpError extends Error {
    status: number
    constructor(status: number, message: string) {
        super(message)
        this.status = status
    }
    }

    function corsHeaders(origin: string | null): Record<string, string> {
    let allow = '*'
    if (ALLOWED_ORIGINS.length > 0) {
        allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
    }
    return {
        'Access-Control-Allow-Origin': allow,
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        Vary: 'Origin',
    }
    }

    function json(body: unknown, status: number, origin: string | null): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
    })
    }

    // แสดงเฉพาะข้อความภาษาไทยจาก Database ข้อความเทคนิคอื่นไม่ส่งออกไป
    function dbMessage(error: { message?: string } | null, fallback: string): string {
    const message = error?.message ?? ''
    return THAI_RE.test(message) ? message : fallback
    }

    function authMessage(error: { message?: string; status?: number } | null, fallback: string): string {
    const message = (error?.message ?? '').toLowerCase()
    if (/already (been )?registered|already exists/.test(message)) return 'อีเมลนี้มีบัญชีอยู่แล้ว'
    if (error?.status === 429 || /rate limit/.test(message)) return 'ส่งคำขอบ่อยเกินไป กรุณารอสักครู่'
    if (/smtp|error sending|sending.*email/.test(message)) return 'ส่งอีเมลไม่สำเร็จ ตรวจสอบการตั้งค่า SMTP ของ Supabase'
    if (/password/.test(message)) return 'รหัสผ่านไม่ผ่านเงื่อนไขความปลอดภัยของระบบ'
    return fallback
    }

    function requireUuid(value: unknown): string {
    if (typeof value !== 'string' || !UUID_RE.test(value)) throw new HttpError(400, 'รหัสพนักงานไม่ถูกต้อง')
    return value
    }

    function validatePassword(value: unknown): string {
    const password = typeof value === 'string' ? value : ''
    if (password.length < MIN_PASSWORD || password.length > 72) {
        throw new HttpError(400, `รหัสผ่านต้องยาว ${MIN_PASSWORD}–72 ตัวอักษร`)
    }
    return password
    }

    // บังคับปลายทางเป็น /profile?set_password=1 ของโดเมนที่อนุญาตเท่านั้น (กัน Open Redirect)
    function safeRedirect(value: unknown): string | undefined {
    if (typeof value !== 'string' || !value) return undefined
    let url: URL
    try {
        url = new URL(value)
    } catch {
        throw new HttpError(400, 'ลิงก์ปลายทางไม่ถูกต้อง')
    }
    if (!['http:', 'https:'].includes(url.protocol)) throw new HttpError(400, 'ลิงก์ปลายทางไม่ถูกต้อง')
    if (ALLOWED_ORIGINS.length > 0 && !ALLOWED_ORIGINS.includes(url.origin)) {
        throw new HttpError(400, 'โดเมนนี้ไม่ได้รับอนุญาต')
    }
    return `${url.origin}/profile?set_password=1`
    }

    function canManage(actor: Profile, target: Profile): boolean {
    if (actor.id === target.id) return false
    if (actor.role === 'super_admin') return true
    return actor.role === 'admin' && target.role === 'staff'
    }

    async function getProfile(admin: SupabaseClient, id: string): Promise<Profile | null> {
    const { data, error } = await admin
        .from('profiles')
        .select('id, email, full_name, role, is_active')
        .eq('id', id)
        .maybeSingle()
    if (error) throw error
    return data as Profile | null
    }

    async function audit(admin: SupabaseClient, actor: Profile, action: string, recordId: string, changes: Record<string, unknown>) {
    const { error } = await admin.from('audit_logs').insert({
        actor_id: actor.id,
        actor_role: actor.role,
        action,
        table_name: 'auth.users',
        record_id: recordId,
        changes,
    })
    if (error) console.error('audit insert failed:', error.message)
    }

    async function listAuth(admin: SupabaseClient) {
    const users: Record<string, unknown>[] = []
    for (let page = 1; page <= 20; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
        if (error) throw new HttpError(500, 'โหลดข้อมูลการเข้าสู่ระบบไม่สำเร็จ')
        for (const user of data.users) {
        users.push({
            id: user.id,
            last_sign_in_at: user.last_sign_in_at ?? null,
            email_confirmed_at: user.email_confirmed_at ?? null,
            invited_at: user.invited_at ?? null,
            banned_until: (user as { banned_until?: string }).banned_until ?? null,
        })
        }
        if (data.users.length < 200) break
    }
    return { users }
    }

    async function createEmployee(admin: SupabaseClient, actor: Profile, body: Record<string, unknown>) {
    const email = String(body.email ?? '').trim().toLowerCase()
    const fullName = String(body.fullName ?? '').trim()
    const phone = body.phone ? String(body.phone).trim() : ''
    const role = String(body.role ?? 'staff')
    const method = body.method === 'invite' ? 'invite' : 'password'

    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'อีเมลไม่ถูกต้อง')
    if (!fullName || fullName.length > 150) throw new HttpError(400, 'กรุณากรอกชื่อ-นามสกุล (ไม่เกิน 150 ตัวอักษร)')
    if (phone && !PHONE_RE.test(phone)) throw new HttpError(400, 'เบอร์โทรศัพท์ไม่ถูกต้อง')
    if (!ROLES.includes(role)) throw new HttpError(400, 'บทบาทไม่ถูกต้อง')
    if (actor.role !== 'super_admin' && role !== 'staff') throw new HttpError(403, 'Admin สร้างได้เฉพาะบัญชี Staff')

    let userId: string
    if (method === 'invite') {
        const redirectTo = safeRedirect(body.redirectTo)
        const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        data: { full_name: fullName },
        redirectTo,
        })
        if (error || !data.user) throw new HttpError(400, authMessage(error, 'ส่งคำเชิญไม่สำเร็จ'))
        userId = data.user.id
    } else {
        const password = validatePassword(body.password)
        const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
        })
        if (error || !data.user) throw new HttpError(400, authMessage(error, 'สร้างบัญชีไม่สำเร็จ'))
        userId = data.user.id
    }

    // Trigger สร้างโปรไฟล์เป็น staff + ปิดใช้งานไว้ก่อน แล้วค่อยกำหนดค่าผ่าน RPC ที่ตรวจสิทธิ์
    const { error: rpcError } = await admin.rpc('admin_manage_profile', {
        p_actor: actor.id,
        p_target: userId,
        p_changes: { full_name: fullName, phone: phone || null, role, is_active: body.isActive !== false },
    })
    if (rpcError) {
        await admin.auth.admin.deleteUser(userId)
        throw new HttpError(400, dbMessage(rpcError, 'กำหนดข้อมูลพนักงานไม่สำเร็จ'))
    }

    await audit(admin, actor, method === 'invite' ? 'INVITE_USER' : 'CREATE_USER', userId, { email, role })
    return { userId }
    }

    async function updateEmployee(admin: SupabaseClient, actor: Profile, body: Record<string, unknown>) {
    const userId = requireUuid(body.userId)
    const target = await getProfile(admin, userId)
    if (!target) throw new HttpError(404, 'ไม่พบบัญชีพนักงาน')

    const changes: Record<string, unknown> = {}
    if ('fullName' in body) changes.full_name = String(body.fullName ?? '')
    if ('phone' in body) changes.phone = body.phone ? String(body.phone) : null
    if ('role' in body) changes.role = String(body.role ?? '')
    if ('isActive' in body) changes.is_active = Boolean(body.isActive)
    if (Object.keys(changes).length === 0) throw new HttpError(400, 'ไม่มีข้อมูลที่จะเปลี่ยน')

    const { data, error } = await admin.rpc('admin_manage_profile', {
        p_actor: actor.id,
        p_target: userId,
        p_changes: changes,
    })
    if (error) throw new HttpError(error.code === '42501' ? 403 : 400, dbMessage(error, 'บันทึกข้อมูลพนักงานไม่สำเร็จ'))

    let warning: string | null = null
    if ('isActive' in body && Boolean(body.isActive) !== target.is_active) {
        // ระงับ/ยกเลิกการระงับการเข้าสู่ระบบ เพื่อให้ Session ต่ออายุไม่ได้
        const { error: banError } = await admin.auth.admin.updateUserById(userId, {
        ban_duration: body.isActive ? 'none' : BAN_FOREVER,
        })
        if (banError) {
        console.error('ban update failed:', banError.message)
        warning = 'เปลี่ยนสถานะในระบบแล้ว แต่ปรับการระงับการเข้าสู่ระบบไม่สำเร็จ (ระบบยังปฏิเสธการเข้าถึงข้อมูลผ่าน RLS)'
        }
    }
    return { profile: data, warning }
    }

    async function setPassword(admin: SupabaseClient, actor: Profile, body: Record<string, unknown>) {
    const userId = requireUuid(body.userId)
    const target = await getProfile(admin, userId)
    if (!target) throw new HttpError(404, 'ไม่พบบัญชีพนักงาน')
    if (!canManage(actor, target)) throw new HttpError(403, 'ไม่มีสิทธิ์เปลี่ยนรหัสผ่านของบัญชีนี้')
    const password = validatePassword(body.password)
    const { error } = await admin.auth.admin.updateUserById(userId, { password })
    if (error) throw new HttpError(400, authMessage(error, 'ตั้งรหัสผ่านไม่สำเร็จ'))
    await audit(admin, actor, 'SET_PASSWORD', userId, {})
    return { success: true }
    }

    async function sendReset(admin: SupabaseClient, actor: Profile, body: Record<string, unknown>) {
    const userId = requireUuid(body.userId)
    const target = await getProfile(admin, userId)
    if (!target) throw new HttpError(404, 'ไม่พบบัญชีพนักงาน')
    if (!canManage(actor, target)) throw new HttpError(403, 'ไม่มีสิทธิ์ส่งลิงก์ให้บัญชีนี้')
    if (!target.email) throw new HttpError(400, 'บัญชีนี้ไม่มีอีเมล')
    const redirectTo = safeRedirect(body.redirectTo)
    const { error } = await admin.auth.resetPasswordForEmail(target.email, { redirectTo })
    if (error) throw new HttpError(400, authMessage(error, 'ส่งลิงก์ตั้งรหัสผ่านไม่สำเร็จ'))
    await audit(admin, actor, 'SEND_PASSWORD_RESET', userId, {})
    return { success: true }
    }

    Deno.serve(async (req) => {
    const origin = req.headers.get('Origin')
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin)

    try {
        if (!SUPABASE_URL || !SERVICE_KEY) throw new HttpError(500, 'ฟังก์ชันยังตั้งค่าไม่ครบ')

        const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
        if (!token) throw new HttpError(401, 'กรุณาเข้าสู่ระบบ')

        const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
        })

        // ไม่เชื่อ Role จาก Client: ตรวจ Token แล้วอ่าน Role จาก Database เอง
        const { data: userData, error: userError } = await admin.auth.getUser(token)
        if (userError || !userData.user) throw new HttpError(401, 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่')
        const actor = await getProfile(admin, userData.user.id)
        if (!actor || !actor.is_active || !['admin', 'super_admin'].includes(actor.role)) {
        throw new HttpError(403, 'ไม่มีสิทธิ์จัดการพนักงาน')
        }

        let body: Record<string, unknown>
        try {
        body = await req.json()
        } catch {
        throw new HttpError(400, 'ข้อมูลที่ส่งมาไม่ถูกต้อง')
        }

        switch (body?.action) {
        case 'list_auth':
            return json(await listAuth(admin), 200, origin)
        case 'create':
            return json(await createEmployee(admin, actor, body), 200, origin)
        case 'update':
            return json(await updateEmployee(admin, actor, body), 200, origin)
        case 'set_password':
            return json(await setPassword(admin, actor, body), 200, origin)
        case 'send_reset':
            return json(await sendReset(admin, actor, body), 200, origin)
        default:
            throw new HttpError(400, 'ไม่รู้จักคำสั่งนี้')
        }
    } catch (err) {
        if (err instanceof HttpError) return json({ error: err.message }, err.status, origin)
        console.error('manage-employee error:', err)
        return json({ error: 'เกิดข้อผิดพลาดภายในระบบ' }, 500, origin)
    }
    })