// Edge Function: ส่งการแจ้งเตือนจากคิว notification_logs ไปยัง Discord
// ผู้เรียก: (1) Database ผ่าน pg_net พร้อม header x-notify-secret -> action "process" เท่านั้น
//          (2) Admin ที่ล็อกอิน -> status | test | retry | process
// Deploy: npx supabase functions deploy discord-notify --no-verify-jwt
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const WEBHOOK_URL = (Deno.env.get('DISCORD_WEBHOOK_URL') ?? '').trim()
const NOTIFY_SECRET = Deno.env.get('NOTIFY_WEBHOOK_SECRET') ?? ''
const APP_BASE_URL = (Deno.env.get('APP_BASE_URL') ?? '').trim().replace(/\/+$/, '')
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

const WEBHOOK_RE = /^https:\/\/(?:ptb\.|canary\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/
const ANY_WEBHOOK_RE = /https:\/\/(?:ptb\.|canary\.)?(?:discord|discordapp)\.com\/api\/webhooks\/[^\s"')]+/g
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_ATTEMPTS = 5
const BACKOFF_MINUTES = [1, 2, 5, 15, 30]
const BATCH = 10
const TIME_BUDGET_MS = 20000
const GAP_MS = 400

type Summary = Record<string, unknown>
type Row = {
  id: string
  event_type: string
  entity_type: string
  entity_id: string | null
  attempts: number
  summary: Summary | null
  created_at: string
}
type Outcome = {
  kind: 'sent' | 'retry' | 'permanent' | 'rate_limited'
  httpStatus: number | null
  error: string | null
  retryAfterMs?: number
}

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/* ------------------------------- ข้อความภาษาไทย ------------------------------- */

const EVENT_META: Record<string, { title: string; color: number }> = {
  job_created: { title: 'มีงานใหม่', color: 0x0071e3 },
  job_status_changed: { title: 'เปลี่ยนสถานะงาน', color: 0x5856d6 },
  job_assigned: { title: 'มอบหมายงาน', color: 0x32ade6 },
  price_changed: { title: 'ราคางานมีการเปลี่ยนแปลง', color: 0xff9f0a },
  payment_recorded: { title: 'บันทึกการรับชำระเงิน', color: 0x30d158 },
  payment_refunded: { title: 'บันทึกการคืนเงิน', color: 0xff453a },
  payment_voided: { title: 'ยกเลิกรายการชำระเงิน', color: 0xff453a },
  installment_created: { title: 'สร้างแผนผ่อนชำระ', color: 0x64d2ff },
  installment_paid: { title: 'รับชำระงวดผ่อน', color: 0x30d158 },
  installment_due_soon: { title: 'งวดผ่อนใกล้ครบกำหนด', color: 0xff9f0a },
  installment_overdue: { title: 'งวดผ่อนเลยกำหนด', color: 0xff3b30 },
  employee_created: { title: 'มีบัญชีผู้ใช้ใหม่ในระบบ', color: 0xbf5af2 },
  employee_changed: { title: 'เปลี่ยนบทบาท/สถานะพนักงาน', color: 0xbf5af2 },
  store_changed: { title: 'แก้ไขข้อมูลร้าน', color: 0x8e8e93 },
  test: { title: 'ทดสอบการแจ้งเตือน', color: 0x0071e3 },
}

const JOB_STATUS: Record<string, string> = {
  pending_review: 'รอตรวจสอบ',
  checking: 'กำลังตรวจเช็ค',
  in_progress: 'กำลังดำเนินการ',
  completed: 'เสร็จสิ้น',
  cancelled: 'ยกเลิก',
}
const PAYMENT_STATUS: Record<string, string> = {
  unpaid: 'ยังไม่ชำระ',
  partial: 'ชำระบางส่วน',
  paid: 'ชำระครบแล้ว',
  installment: 'ผ่อนชำระ',
  refunded: 'ยกเลิก/คืนเงิน',
}
const METHODS: Record<string, string> = {
  cash: 'เงินสด',
  bank_transfer: 'โอนเงิน',
  promptpay: 'พร้อมเพย์',
  card: 'บัตร',
  other: 'อื่น ๆ',
}
const ROLES: Record<string, string> = { super_admin: 'Super Admin', admin: 'Admin', staff: 'Staff' }
const INTEREST_MODES: Record<string, string> = { per_month: 'ต่อเดือน', one_time: 'ครั้งเดียว' }
const STORE_FIELDS: Record<string, string> = {
  store_name: 'ชื่อร้าน',
  logo_path: 'โลโก้',
  address: 'ที่อยู่',
  phone: 'เบอร์โทร',
  email: 'อีเมล',
  website: 'เว็บไซต์',
  business_hours: 'เวลาทำการ',
  contact_channels: 'ช่องทางติดต่อ',
  description: 'รายละเอียด',
  tax_id: 'เลขผู้เสียภาษี',
  document_header: 'หัวเอกสาร',
  document_footer: 'ท้ายเอกสาร',
  payment_instructions: 'วิธีชำระเงิน',
}

/* ---------------------------------- ตัวช่วย ---------------------------------- */

function corsHeaders(origin: string | null): Record<string, string> {
  let allow = '*'
  if (ALLOWED_ORIGINS.length > 0) allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-notify-secret',
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function clip(value: string, max: number): string {
  const text = value.trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

// ห้ามให้ Webhook URL หลุดลงฐานข้อมูลผ่านข้อความ Error
function sanitizeError(message: string): string {
  let text = message
  if (WEBHOOK_URL) text = text.split(WEBHOOK_URL).join('[webhook]')
  return clip(text.replace(ANY_WEBHOOK_RE, '[webhook]'), 500)
}

const moneyFormat = new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', minimumFractionDigits: 2 })
function money(value: unknown): string | null {
  const n = Number(value)
  return value === null || value === undefined || !Number.isFinite(n) ? null : moneyFormat.format(n)
}

const dateFormat = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric' })
const dateTimeFormat = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'Asia/Bangkok',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

function thaiDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+07:00` : value)
  return Number.isNaN(date.getTime()) ? null : dateFormat.format(date)
}

function str(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text ? text : null
}

/* ------------------------------- สร้างข้อความ ------------------------------- */

function buildPayload(row: Row, includeAmounts: boolean) {
  const s: Summary = row.summary ?? {}
  const meta = EVENT_META[row.event_type] ?? { title: row.event_type, color: 0x8e8e93 }
  const fields: { name: string; value: string; inline: boolean }[] = []
  const add = (name: string, value: string | null, inline = true) => {
    if (value) fields.push({ name: clip(name, 256), value: clip(value, 1024), inline })
  }
  let url: string | undefined
  let description: string | undefined

  if (s.job_number) {
    add('Job Number', str(s.job_number))
    add('ประเภทงาน', str(s.job_type))
    description = str(s.title) ?? undefined
    if (APP_BASE_URL && s.job_id) url = `${APP_BASE_URL}/jobs/${s.job_id}`
  }

  switch (row.event_type) {
    case 'job_created':
      add('สถานะ', JOB_STATUS[String(s.status)] ?? str(s.status))
      add('ผู้รับผิดชอบ', str(s.assignee) ?? 'ยังไม่มอบหมาย')
      add('กำหนดส่ง', thaiDate(s.due_date))
      break
    case 'job_status_changed':
      add('สถานะ', `${JOB_STATUS[String(s.from_status)] ?? s.from_status} → ${JOB_STATUS[String(s.to_status)] ?? s.to_status}`)
      add('ผู้รับผิดชอบ', str(s.assignee) ?? 'ยังไม่มอบหมาย')
      break
    case 'job_assigned':
      add('ผู้รับผิดชอบ', str(s.assignee) ?? 'ยกเลิกการมอบหมาย')
      add('สถานะ', JOB_STATUS[String(s.status)] ?? str(s.status))
      break
    case 'price_changed':
      if (includeAmounts) {
        add('ยอดสุทธิใหม่', money(s.net_amount))
        add('ยอดที่ต้องชำระ', money(s.payable_amount))
      } else {
        add('รายละเอียด', 'มีการแก้ไขรายการราคาหรือส่วนลด ดูยอดในระบบ', false)
      }
      break
    case 'payment_recorded':
    case 'payment_refunded':
    case 'payment_voided':
    case 'installment_paid':
      if (s.installment_no) add('งวดที่', String(s.installment_no))
      add('วิธีชำระ', METHODS[String(s.method)] ?? str(s.method))
      if (includeAmounts) {
        add('จำนวนเงิน', money(s.amount))
        add('ยอดคงเหลือของงาน', money(s.balance_amount))
      }
      add('สถานะการชำระ', PAYMENT_STATUS[String(s.payment_status)] ?? str(s.payment_status))
      break
    case 'installment_created':
      add('จำนวนงวด', `${s.installment_count} งวด (ทุก ${s.interval_months ?? 1} เดือน)`)
      add('ดอกเบี้ย', `${s.interest_rate_percent}% ${INTEREST_MODES[String(s.interest_mode)] ?? ''}`)
      add('งวดแรกครบกำหนด', thaiDate(s.first_due_date))
      if (includeAmounts) add('ยอดรวมผ่อน', money(s.total_amount))
      if (APP_BASE_URL && s.plan_id) url = `${APP_BASE_URL}/payments/plans/${s.plan_id}`
      break
    case 'installment_due_soon':
    case 'installment_overdue':
      add('งวดที่', str(s.installment_no))
      add('ครบกำหนด', thaiDate(s.installment_due))
      if (row.event_type === 'installment_overdue') add('เลยกำหนด', `${s.days_overdue} วัน`)
      else add('เหลือเวลา', Number(s.days_left) === 0 ? 'ครบกำหนดวันนี้' : `${s.days_left} วัน`)
      if (includeAmounts) add('ยอดค้างของงวด', money(s.outstanding))
      if (APP_BASE_URL && s.plan_id) url = `${APP_BASE_URL}/payments/plans/${s.plan_id}`
      break
    case 'employee_created':
      add('ชื่อ', str(s.name) ?? 'ไม่ระบุชื่อ')
      add('บทบาท', ROLES[String(s.role)] ?? str(s.role))
      add('สถานะ', s.is_active ? 'ใช้งาน' : 'รอเปิดใช้งาน')
      if (APP_BASE_URL) url = `${APP_BASE_URL}/employees`
      break
    case 'employee_changed':
      add('ชื่อ', str(s.name) ?? 'ไม่ระบุชื่อ')
      if (s.old_role !== s.role) add('บทบาท', `${ROLES[String(s.old_role)] ?? s.old_role} → ${ROLES[String(s.role)] ?? s.role}`)
      else add('บทบาท', ROLES[String(s.role)] ?? str(s.role))
      add('สถานะบัญชี', s.is_active ? 'ใช้งาน' : 'ปิดใช้งาน')
      if (APP_BASE_URL) url = `${APP_BASE_URL}/employees`
      break
    case 'store_changed': {
      const list = Array.isArray(s.fields) ? s.fields.map((key) => STORE_FIELDS[String(key)] ?? String(key)) : []
      add('ส่วนที่แก้ไข', list.join(', ') || null, false)
      if (APP_BASE_URL) url = `${APP_BASE_URL}/settings/store`
      break
    }
    case 'test':
      description = 'การเชื่อมต่อระหว่างระบบกับ Discord ทำงานปกติ'
      break
  }

  add('ผู้ดำเนินการ', str(s.actor))

  const created = new Date(row.created_at)
  return {
    username: 'FKSNo1.SiTE',
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: clip(meta.title, 256),
        description: description ? clip(description, 2000) : undefined,
        url,
        color: meta.color,
        fields,
        footer: { text: `FKSNo1.SiTE · ${dateTimeFormat.format(created)}` },
        timestamp: created.toISOString(),
      },
    ],
  }
}

/* --------------------------------- ส่งและบันทึก --------------------------------- */

async function deliver(row: Row, includeAmounts: boolean): Promise<Outcome> {
  let body: string
  try {
    body = JSON.stringify(buildPayload(row, includeAmounts))
  } catch {
    return { kind: 'permanent', httpStatus: null, error: 'สร้างข้อความแจ้งเตือนไม่สำเร็จ' }
  }

  let res: Response
  try {
    res = await fetch(`${WEBHOOK_URL}?wait=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(10000),
    })
  } catch (err) {
    return { kind: 'retry', httpStatus: null, error: sanitizeError(err instanceof Error ? err.message : String(err)) }
  }

  if (res.ok) {
    await res.body?.cancel()
    return { kind: 'sent', httpStatus: res.status, error: null }
  }

  let detail: Record<string, unknown> = {}
  try {
    detail = await res.json()
  } catch {
    // ไม่มี JSON
  }

  if (res.status === 429) {
    const after = Number(detail.retry_after)
    return {
      kind: 'rate_limited',
      httpStatus: 429,
      error: 'Discord จำกัดอัตราการส่ง ระบบจะส่งใหม่อัตโนมัติ',
      retryAfterMs: Number.isFinite(after) ? Math.ceil(after * 1000) + 250 : 5000,
    }
  }
  if (res.status === 400) {
    const message = typeof detail.message === 'string' ? detail.message : ''
    return { kind: 'permanent', httpStatus: 400, error: sanitizeError(`Discord ปฏิเสธข้อความ ${message}`) }
  }
  if ([401, 403, 404].includes(res.status)) {
    return { kind: 'permanent', httpStatus: res.status, error: 'Webhook ไม่ถูกต้องหรือถูกลบ ตรวจสอบ DISCORD_WEBHOOK_URL' }
  }
  return { kind: 'retry', httpStatus: res.status, error: `Discord ตอบกลับสถานะ ${res.status}` }
}

async function record(admin: SupabaseClient, row: Row, outcome: Outcome) {
  let update: Record<string, unknown>
  if (outcome.kind === 'sent') {
    update = {
      status: 'sent',
      sent_at: new Date().toISOString(),
      http_status: outcome.httpStatus,
      error_message: null,
      locked_at: null,
      next_attempt_at: null,
    }
  } else if (outcome.kind === 'permanent') {
    update = {
      status: 'failed',
      attempts: MAX_ATTEMPTS,
      http_status: outcome.httpStatus,
      error_message: outcome.error,
      locked_at: null,
      next_attempt_at: null,
    }
  } else if (outcome.kind === 'rate_limited') {
    update = {
      status: 'pending',
      attempts: Math.max(row.attempts - 1, 0),
      http_status: 429,
      error_message: outcome.error,
      locked_at: null,
      next_attempt_at: new Date(Date.now() + (outcome.retryAfterMs ?? 5000)).toISOString(),
    }
  } else {
    const final = row.attempts >= MAX_ATTEMPTS
    const minutes = BACKOFF_MINUTES[Math.min(row.attempts, BACKOFF_MINUTES.length) - 1] ?? 30
    update = {
      status: 'failed',
      http_status: outcome.httpStatus,
      error_message: final ? `${outcome.error} (ครบ ${MAX_ATTEMPTS} ครั้ง หยุดส่งอัตโนมัติ)` : outcome.error,
      locked_at: null,
      next_attempt_at: final ? null : new Date(Date.now() + minutes * 60000).toISOString(),
    }
  }
  const { error } = await admin.from('notification_logs').update(update).eq('id', row.id)
  if (error) console.error('record notification failed:', error.message)
}

// คืนรายการที่ดึงมาแต่ยังไม่ได้ส่งกลับเข้าคิว (ไม่นับเป็นความพยายาม)
async function release(admin: SupabaseClient, rows: Row[], delayMs: number) {
  const next = new Date(Date.now() + delayMs).toISOString()
  for (const row of rows) {
    await admin
      .from('notification_logs')
      .update({ status: 'pending', attempts: Math.max(row.attempts - 1, 0), locked_at: null, next_attempt_at: next })
      .eq('id', row.id)
  }
}

async function readIncludeAmounts(admin: SupabaseClient): Promise<boolean> {
  const { data } = await admin.from('app_settings').select('value').eq('key', 'notification_include_amounts').maybeSingle()
  return data?.value === true
}

async function processQueue(admin: SupabaseClient, budgetMs = TIME_BUDGET_MS) {
  if (!WEBHOOK_RE.test(WEBHOOK_URL)) return { configured: false, processed: 0, results: [] as unknown[] }

  const deadline = Date.now() + budgetMs
  const includeAmounts = await readIncludeAmounts(admin)
  const results: { id: string; status: string; error: string | null }[] = []

  outer: while (Date.now() < deadline) {
    const { data, error } = await admin.rpc('claim_notifications', { p_limit: BATCH })
    if (error) {
      console.error('claim_notifications failed:', error.message)
      throw new HttpError(500, 'อ่านคิวการแจ้งเตือนไม่สำเร็จ')
    }
    const rows = (data ?? []) as Row[]
    if (rows.length === 0) break

    for (let i = 0; i < rows.length; i++) {
      if (Date.now() >= deadline) {
        await release(admin, rows.slice(i), 0)
        break outer
      }
      const outcome = await deliver(rows[i], includeAmounts)
      await record(admin, rows[i], outcome)
      results.push({ id: rows[i].id, status: outcome.kind, error: outcome.error })
      if (outcome.kind === 'rate_limited') {
        await release(admin, rows.slice(i + 1), outcome.retryAfterMs ?? 5000)
        break outer
      }
      if (i < rows.length - 1) await sleep(GAP_MS)
    }
  }
  return { configured: true, processed: results.length, results }
}

/* ---------------------------------- สิทธิ์ ---------------------------------- */

type Caller = { kind: 'system' } | { kind: 'user'; id: string; name: string }

async function authorize(req: Request, admin: SupabaseClient): Promise<Caller> {
  const secret = req.headers.get('x-notify-secret') ?? ''
  if (secret) {
    if (NOTIFY_SECRET && safeEqual(secret, NOTIFY_SECRET)) return { kind: 'system' }
    throw new HttpError(401, 'รหัสลับไม่ถูกต้อง')
  }
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) throw new HttpError(401, 'กรุณาเข้าสู่ระบบ')
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) throw new HttpError(401, 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่')
  const { data: profile } = await admin
    .from('profiles')
    .select('id, full_name, role, is_active')
    .eq('id', data.user.id)
    .maybeSingle()
  if (!profile || !profile.is_active || !['admin', 'super_admin'].includes(profile.role)) {
    throw new HttpError(403, 'ไม่มีสิทธิ์จัดการการแจ้งเตือน')
  }
  return { kind: 'user', id: profile.id, name: profile.full_name }
}

async function queueCounts(admin: SupabaseClient) {
  const pending = await admin
    .from('notification_logs')
    .select('id', { count: 'exact', head: true })
    .in('status', ['pending', 'sending'])
  const failed = await admin.from('notification_logs').select('id', { count: 'exact', head: true }).eq('status', 'failed')
  return { pending: pending.count ?? 0, failed: failed.count ?? 0 }
}

/* ---------------------------------- Handler ---------------------------------- */

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin)

  try {
    if (!SUPABASE_URL || !SERVICE_KEY) throw new HttpError(500, 'ฟังก์ชันยังตั้งค่าไม่ครบ')
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    const caller = await authorize(req, admin)

    let body: Record<string, unknown> = {}
    try {
      body = await req.json()
    } catch {
      body = {}
    }
    const action = String(body.action ?? 'process')

    if (caller.kind === 'system' && action !== 'process') throw new HttpError(403, 'ไม่อนุญาต')

    switch (action) {
      case 'process':
        return json(await processQueue(admin), 200, origin)

      case 'status':
        return json(
          {
            webhookConfigured: WEBHOOK_RE.test(WEBHOOK_URL),
            secretConfigured: NOTIFY_SECRET.length >= 16,
            appBaseUrlConfigured: Boolean(APP_BASE_URL),
            queue: await queueCounts(admin),
          },
          200,
          origin,
        )

      case 'test': {
        if (!WEBHOOK_RE.test(WEBHOOK_URL)) throw new HttpError(400, 'ยังไม่ได้ตั้งค่า DISCORD_WEBHOOK_URL หรือรูปแบบไม่ถูกต้อง')
        const id = crypto.randomUUID()
        const { error } = await admin.from('notification_logs').insert({
          id,
          event_type: 'test',
          entity_type: 'system',
          entity_id: null,
          dedupe_key: `test:${id}`,
          status: 'pending',
          summary: { actor: caller.kind === 'user' ? caller.name : null },
          triggered_by: caller.kind === 'user' ? caller.id : null,
        })
        if (error) throw new HttpError(500, 'สร้างรายการทดสอบไม่สำเร็จ')
        const result = await processQueue(admin)
        const mine = (result.results as { id: string; status: string; error: string | null }[]).find((r) => r.id === id)
        return json(
          { status: mine?.status === 'sent' ? 'sent' : (mine?.status ?? 'pending'), error: mine?.error ?? null },
          200,
          origin,
        )
      }

      case 'retry': {
        const id = String(body.id ?? '')
        if (!UUID_RE.test(id)) throw new HttpError(400, 'รหัสรายการไม่ถูกต้อง')
        const { data, error } = await admin
          .from('notification_logs')
          .update({ status: 'pending', attempts: 0, next_attempt_at: null, locked_at: null, error_message: null })
          .eq('id', id)
          .eq('status', 'failed')
          .select('id')
        if (error) throw new HttpError(500, 'ตั้งค่าส่งใหม่ไม่สำเร็จ')
        if (!data?.length) throw new HttpError(400, 'ส่งใหม่ได้เฉพาะรายการที่ส่งไม่สำเร็จ')
        const result = await processQueue(admin)
        const mine = (result.results as { id: string; status: string; error: string | null }[]).find((r) => r.id === id)
        return json({ configured: result.configured, status: mine?.status ?? 'pending', error: mine?.error ?? null }, 200, origin)
      }

      default:
        throw new HttpError(400, 'ไม่รู้จักคำสั่งนี้')
    }
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status, origin)
    console.error('discord-notify error:', err instanceof Error ? sanitizeError(err.message) : 'unknown')
    return json({ error: 'เกิดข้อผิดพลาดภายในระบบ' }, 500, origin)
  }
})