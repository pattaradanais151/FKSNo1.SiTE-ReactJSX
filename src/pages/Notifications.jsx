import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, BellRing, CheckCircle2, Loader2, RefreshCw, RotateCcw, Save, Send, XCircle } from 'lucide-react'
import { useAuth } from '../lib/auth.jsx'
import { getErrorMessage, supabase } from '../lib/supabase.js'
import { formatDate, usePageTitle } from '../lib/utils.js'
import { Badge, Card, EmptyState, ErrorState, LoadingState, PageHeader, Pagination, TableWrap, useToast } from '../components/UI.jsx'
import { unwrap } from '../components/Forms.jsx'

const PAGE_SIZE = 25

const TOGGLES = [
  { key: 'job_created', label: 'สร้างงานใหม่' },
  { key: 'job_status_changed', label: 'เปลี่ยนสถานะงาน' },
  { key: 'job_assigned', label: 'มอบหมายงานให้พนักงาน' },
  { key: 'price_changed', label: 'ราคางานเปลี่ยน', hint: 'การแก้ไขภายใน 2 นาทีรวมเป็นข้อความเดียว' },
  { key: 'payment_recorded', label: 'รับชำระ / คืนเงิน / ยกเลิกรายการชำระ' },
  { key: 'installment_created', label: 'สร้างแผนผ่อนชำระ' },
  { key: 'installment_paid', label: 'รับชำระงวดผ่อน' },
  { key: 'installment_due_soon', label: 'งวดผ่อนใกล้ครบกำหนด', hint: 'ตรวจทุกวันเวลา 08:00 น. แจ้งครั้งเดียวต่องวด' },
  { key: 'installment_overdue', label: 'งวดผ่อนเลยกำหนด', hint: 'ตรวจทุกวันเวลา 08:00 น. แจ้งครั้งเดียวต่องวด' },
  { key: 'employee_changed', label: 'บัญชีผู้ใช้ใหม่ / เปลี่ยนบทบาทหรือสถานะพนักงาน' },
  { key: 'store_changed', label: 'แก้ไขข้อมูลร้าน' },
]

const EVENT_LABELS = {
  job_created: 'สร้างงานใหม่',
  job_status_changed: 'เปลี่ยนสถานะงาน',
  job_assigned: 'มอบหมายงาน',
  price_changed: 'ราคางานเปลี่ยน',
  payment_recorded: 'รับชำระเงิน',
  payment_refunded: 'คืนเงิน',
  payment_voided: 'ยกเลิกรายการชำระ',
  installment_created: 'สร้างแผนผ่อน',
  installment_paid: 'รับชำระงวดผ่อน',
  installment_due_soon: 'งวดใกล้ครบกำหนด',
  installment_overdue: 'งวดเลยกำหนด',
  employee_created: 'บัญชีผู้ใช้ใหม่',
  employee_changed: 'เปลี่ยนสิทธิ์พนักงาน',
  store_changed: 'แก้ไขข้อมูลร้าน',
  test: 'ทดสอบ',
}

const LOG_STATUS = {
  pending: { label: 'รอส่ง', tone: 'warning' },
  sending: { label: 'กำลังส่ง', tone: 'info' },
  sent: { label: 'ส่งแล้ว', tone: 'success' },
  failed: { label: 'ส่งไม่สำเร็จ', tone: 'danger' },
  skipped: { label: 'ข้าม', tone: 'neutral' },
}

const MAX_ATTEMPTS = 5

async function invokeNotify(payload) {
  const { data, error } = await supabase.functions.invoke('discord-notify', { body: payload })
  if (error) {
    let message = ''
    try {
      const body = await error.context?.json()
      message = body?.error || ''
    } catch {
      // ไม่มีเนื้อหา JSON
    }
    if (!message && error.name === 'FunctionsFetchError') {
      message = 'เชื่อมต่อ Edge Function ไม่ได้ ตรวจสอบว่า Deploy discord-notify แล้ว'
    }
    throw new Error(message || 'ดำเนินการไม่สำเร็จ')
  }
  return data
}

export default function Notifications() {
  usePageTitle('การแจ้งเตือน Discord')
  const { isSuperAdmin } = useAuth()
  const [logsKey, setLogsKey] = useState(0)
  const refreshLogs = useCallback(() => setLogsKey((key) => key + 1), [])

  return (
    <>
      <PageHeader
        title="การแจ้งเตือน Discord"
        description="สถานะการเชื่อมต่อ การเปิด/ปิดแต่ละประเภท และประวัติการส่ง"
      />
      <div className="space-y-4">
        <HealthCard onActivity={refreshLogs} />
        <SettingsCard canEdit={isSuperAdmin} />
        <LogsCard reloadKey={logsKey} onActivity={refreshLogs} />
      </div>
    </>
  )
}

/* ================================ สถานะระบบ ================================ */

function CheckRow({ ok, label, detail, optional = false }) {
  let Icon = CheckCircle2
  let tone = 'text-success'
  if (!ok) {
    Icon = optional ? AlertTriangle : XCircle
    tone = optional ? 'text-warning' : 'text-danger'
  }
  return (
    <li className="flex items-start gap-3 py-2.5">
      <Icon size={18} className={`mt-0.5 shrink-0 ${tone}`} aria-hidden="true" />
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted">{detail}</div>
      </div>
    </li>
  )
}

function HealthCard({ onActivity }) {
  const toast = useToast()
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setStatus(await invokeNotify({ action: 'status' }))
    } catch (err) {
      setError(getErrorMessage(err, 'ตรวจสถานะไม่สำเร็จ'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const run = async (action) => {
    setBusy(action)
    try {
      const data = await invokeNotify({ action })
      if (action === 'test') {
        if (data?.status === 'sent') toast.success('ส่งข้อความทดสอบไปที่ Discord แล้ว')
        else toast.error(data?.error || 'ส่งข้อความทดสอบยังไม่สำเร็จ ดูรายละเอียดในประวัติด้านล่าง')
      } else if (data?.configured === false) {
        toast.error('ยังไม่ได้ตั้งค่า DISCORD_WEBHOOK_URL รายการยังรออยู่ในคิว')
      } else {
        toast.success(`ประมวลผลคิวแล้ว ${data?.processed ?? 0} รายการ`)
      }
    } catch (err) {
      toast.error(getErrorMessage(err, 'ดำเนินการไม่สำเร็จ'))
    } finally {
      setBusy('')
      onActivity()
      load()
    }
  }

  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 inline-flex items-center gap-2 text-base font-semibold">
          <BellRing size={17} className="text-muted" aria-hidden="true" />
          สถานะการเชื่อมต่อ
        </h2>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={load} disabled={loading} aria-label="ตรวจสถานะอีกครั้ง">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary inline-flex items-center gap-1.5"
            onClick={() => run('process')}
            disabled={Boolean(busy) || !status}
          >
            {busy === 'process' ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <RotateCcw size={15} aria-hidden="true" />}
            ส่งรายการค้างตอนนี้
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary inline-flex items-center gap-1.5"
            onClick={() => run('test')}
            disabled={Boolean(busy) || !status?.webhookConfigured}
          >
            {busy === 'test' ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Send size={15} aria-hidden="true" />}
            ส่งข้อความทดสอบ
          </button>
        </div>
      </div>

      {error ? (
        <ErrorState title="ตรวจสถานะไม่สำเร็จ" message={error} onRetry={load} />
      ) : !status ? (
        <LoadingState label="กำลังตรวจสถานะ..." />
      ) : (
        <>
          <ul className="m-0 list-none divide-y divide-line p-0">
            <CheckRow
              ok={status.webhookConfigured}
              label="Discord Webhook"
              detail={
                status.webhookConfigured
                  ? 'ตั้งค่า DISCORD_WEBHOOK_URL แล้ว (เก็บใน Edge Function Secrets ไม่แสดงค่า)'
                  : 'ยังไม่ได้ตั้งค่า DISCORD_WEBHOOK_URL หรือรูปแบบไม่ถูกต้อง'
              }
            />
            <CheckRow
              ok={status.secretConfigured}
              label="รหัสลับสำหรับ Database"
              detail={
                status.secretConfigured
                  ? 'ตั้งค่า NOTIFY_WEBHOOK_SECRET แล้ว ต้องตรงกับ fksno1_notify_secret ใน Vault'
                  : 'ยังไม่ได้ตั้งค่า NOTIFY_WEBHOOK_SECRET (อย่างน้อย 16 ตัวอักษร) ระบบจะส่งได้เฉพาะเมื่อกดเอง'
              }
            />
            <CheckRow
              ok={status.appBaseUrlConfigured}
              optional
              label="ลิงก์เปิดหน้าในระบบ"
              detail={status.appBaseUrlConfigured ? 'ตั้งค่า APP_BASE_URL แล้ว' : 'ไม่ได้ตั้งค่า APP_BASE_URL ข้อความจะไม่มีลิงก์'}
            />
          </ul>
          <p className="mt-3 mb-0 text-sm">
            คิว: รอส่ง <strong className="tabular-nums">{status.queue?.pending ?? 0}</strong> รายการ · ส่งไม่สำเร็จ{' '}
            <strong className={`tabular-nums ${status.queue?.failed ? 'text-danger' : ''}`}>{status.queue?.failed ?? 0}</strong> รายการ
          </p>
          <p className="mt-1 mb-0 text-xs text-muted">
            หากมีรายการรอส่งค้างเกิน 2–3 นาที ให้ตรวจค่าใน Vault (fksno1_project_url, fksno1_notify_secret) และ Cron fksno1-notify-sweep
          </p>
        </>
      )}
    </Card>
  )
}

/* ================================ ตั้งค่า ================================ */

function SettingsCard({ canEdit }) {
  const toast = useToast()
  const [events, setEvents] = useState(null)
  const [includeAmounts, setIncludeAmounts] = useState(false)
  const [original, setOriginal] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setError('')
    try {
      const rows = await supabase
        .from('app_settings')
        .select('key, value')
        .in('key', ['notification_events', 'notification_include_amounts'])
        .then(unwrap)
      const map = Object.fromEntries((rows ?? []).map((row) => [row.key, row.value]))
      const nextEvents = Object.fromEntries(TOGGLES.map(({ key }) => [key, map.notification_events?.[key] !== false]))
      const nextAmounts = map.notification_include_amounts === true
      setEvents(nextEvents)
      setIncludeAmounts(nextAmounts)
      setOriginal(JSON.stringify({ e: nextEvents, a: nextAmounts }))
    } catch (err) {
      setError(getErrorMessage(err, 'โหลดการตั้งค่าไม่สำเร็จ'))
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const dirty = events && original !== JSON.stringify({ e: events, a: includeAmounts })

  const save = async () => {
    if (!canEdit || saving) return
    setSaving(true)
    try {
      const updates = [
        ['notification_events', events],
        ['notification_include_amounts', includeAmounts],
      ]
      for (const [key, value] of updates) {
        const data = await supabase.from('app_settings').update({ value }).eq('key', key).select('key').then(unwrap)
        if (!data?.length) throw new Error('ไม่พบการตั้งค่า หรือคุณไม่มีสิทธิ์แก้ไข')
      }
      setOriginal(JSON.stringify({ e: events, a: includeAmounts }))
      toast.success('บันทึกการตั้งค่าการแจ้งเตือนแล้ว มีผลกับเหตุการณ์ถัดไป')
    } catch (err) {
      toast.error(getErrorMessage(err, 'บันทึกไม่สำเร็จ'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-base font-semibold">ประเภทการแจ้งเตือน</h2>
        {canEdit && events && (
          <button type="button" className="btn btn-sm btn-primary inline-flex items-center gap-1.5" onClick={save} disabled={!dirty || saving}>
            {saving ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}
            บันทึก
          </button>
        )}
      </div>
      <p className="mt-0 mb-4 text-sm text-muted">
        {canEdit ? 'เปิด/ปิดได้ทีละประเภท มีผลกับเหตุการณ์ที่เกิดหลังบันทึก' : 'เฉพาะ Super Admin เท่านั้นที่แก้ไขการตั้งค่านี้ได้'}
      </p>

      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : !events ? (
        <LoadingState />
      ) : (
        <fieldset disabled={!canEdit || saving}>
          <legend className="sr-only">ประเภทการแจ้งเตือน</legend>
          <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
            {TOGGLES.map(({ key, label, hint }) => (
              <div key={key} className="form-check form-switch mb-0">
                <input
                  id={`ntf-${key}`}
                  type="checkbox"
                  role="switch"
                  className="form-check-input"
                  checked={events[key]}
                  onChange={(e) => setEvents((current) => ({ ...current, [key]: e.target.checked }))}
                />
                <label htmlFor={`ntf-${key}`} className="form-check-label text-sm">
                  {label}
                  {hint && <span className="block text-xs text-muted">{hint}</span>}
                </label>
              </div>
            ))}
          </div>

          <div className="mt-5 rounded-xl border border-line p-3">
            <div className="form-check form-switch mb-0">
              <input
                id="ntf-amounts"
                type="checkbox"
                role="switch"
                className="form-check-input"
                checked={includeAmounts}
                onChange={(e) => setIncludeAmounts(e.target.checked)}
              />
              <label htmlFor="ntf-amounts" className="form-check-label text-sm font-medium">
                แสดงจำนวนเงินในข้อความ Discord
                <span className="block text-xs font-normal text-muted">
                  ปิดไว้เป็นค่าเริ่มต้น ทุกคนในช่อง Discord จะเห็นยอดเงินถ้าเปิด ข้อความจะไม่มีชื่อ เบอร์โทร ที่อยู่ลูกค้า
                  บันทึกภายใน และเหตุผลการยกเลิกในทุกกรณี
                </span>
              </label>
            </div>
          </div>
        </fieldset>
      )}
    </Card>
  )
}

/* ================================ ประวัติการส่ง ================================ */

function LogsCard({ reloadKey, onActivity }) {
  const toast = useToast()
  const [status, setStatus] = useState('')
  const [event, setEvent] = useState('')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [localKey, setLocalKey] = useState(0)
  const [retrying, setRetrying] = useState('')

  useEffect(() => {
    let active = true
    const run = async () => {
      setLoading(true)
      setError('')
      let query = supabase
        .from('notification_logs')
        .select('id, event_type, entity_type, status, attempts, http_status, error_message, summary, created_at, sent_at, next_attempt_at', {
          count: 'exact',
        })
      if (status) query = query.eq('status', status)
      if (event) query = query.eq('event_type', event)
      const offset = (page - 1) * PAGE_SIZE
      const { data, count, error: queryError } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1)
      if (!active) return
      if (queryError) {
        if (queryError.code === 'PGRST103' && page > 1) setPage(1)
        else setError(getErrorMessage(queryError))
      } else {
        setRows(data ?? [])
        setTotal(count ?? 0)
      }
      setLoading(false)
    }
    run()
    return () => {
      active = false
    }
  }, [status, event, page, reloadKey, localKey])

  const retry = async (row) => {
    setRetrying(row.id)
    try {
      const data = await invokeNotify({ action: 'retry', id: row.id })
      if (data?.status === 'sent') toast.success('ส่งใหม่สำเร็จ')
      else if (data?.configured === false) toast.error('ยังไม่ได้ตั้งค่า DISCORD_WEBHOOK_URL')
      else toast.info(data?.error || 'นำกลับเข้าคิวแล้ว ระบบจะส่งอีกครั้ง')
    } catch (err) {
      toast.error(getErrorMessage(err, 'ส่งใหม่ไม่สำเร็จ'))
    } finally {
      setRetrying('')
      onActivity()
      setLocalKey((key) => key + 1)
    }
  }

  return (
    <Card flush>
      <div className="flex flex-wrap items-end justify-between gap-3 px-5 pt-5 pb-3">
        <h2 className="m-0 text-base font-semibold">ประวัติการส่ง</h2>
        <div className="flex flex-wrap gap-2">
          <div>
            <label htmlFor="log-status" className="sr-only">
              สถานะ
            </label>
            <select
              id="log-status"
              className="form-select form-select-sm"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value)
                setPage(1)
              }}
            >
              <option value="">ทุกสถานะ</option>
              {Object.entries(LOG_STATUS).map(([value, meta]) => (
                <option key={value} value={value}>
                  {meta.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="log-event" className="sr-only">
              ประเภทเหตุการณ์
            </label>
            <select
              id="log-event"
              className="form-select form-select-sm"
              value={event}
              onChange={(e) => {
                setEvent(e.target.value)
                setPage(1)
              }}
            >
              <option value="">ทุกเหตุการณ์</option>
              {Object.entries(EVENT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            onClick={() => setLocalKey((key) => key + 1)}
            disabled={loading}
            aria-label="โหลดประวัติล่าสุด"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
          </button>
        </div>
      </div>

      {error && !loading ? (
        <ErrorState message={error} onRetry={() => setLocalKey((key) => key + 1)} />
      ) : loading && rows.length === 0 ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <EmptyState icon={BellRing} title="ยังไม่มีประวัติการแจ้งเตือน" description="เมื่อเกิดเหตุการณ์ในระบบ รายการจะปรากฏที่นี่" />
      ) : (
        <div className={loading ? 'opacity-60' : ''} aria-busy={loading}>
          <TableWrap minWidth={900}>
            <table className="table align-middle">
              <thead>
                <tr>
                  <th scope="col" className="pl-5">
                    เวลา
                  </th>
                  <th scope="col">เหตุการณ์</th>
                  <th scope="col">อ้างอิง</th>
                  <th scope="col">สถานะ</th>
                  <th scope="col" className="text-right">
                    ครั้งที่ส่ง
                  </th>
                  <th scope="col">รายละเอียด</th>
                  <th scope="col" className="pr-5">
                    <span className="sr-only">การดำเนินการ</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const meta = LOG_STATUS[row.status] ?? LOG_STATUS.pending
                  const reference = row.summary?.job_number || row.summary?.name || '-'
                  let detail = '-'
                  if (row.error_message) detail = row.error_message
                  else if (row.status === 'sent') detail = `ส่งเมื่อ ${formatDate(row.sent_at, true)}`
                  else if (row.next_attempt_at) detail = `ส่งครั้งถัดไป ${formatDate(row.next_attempt_at, true)}`
                  return (
                    <tr key={row.id}>
                      <td className="pl-5 text-sm whitespace-nowrap">{formatDate(row.created_at, true)}</td>
                      <td className="text-sm">{EVENT_LABELS[row.event_type] ?? row.event_type}</td>
                      <td className="text-sm font-medium">{reference}</td>
                      <td>
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                        {row.http_status && <div className="mt-0.5 text-xs text-muted">HTTP {row.http_status}</div>}
                      </td>
                      <td className="text-right text-sm tabular-nums">
                        {row.attempts}/{MAX_ATTEMPTS}
                      </td>
                      <td className={`max-w-[320px] text-xs ${row.error_message ? 'text-danger' : 'text-muted'}`}>
                        <div className="line-clamp-2 break-words">{detail}</div>
                      </td>
                      <td className="pr-5 text-right">
                        {row.status === 'failed' && (
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-secondary inline-flex items-center gap-1 whitespace-nowrap"
                            onClick={() => retry(row)}
                            disabled={Boolean(retrying)}
                          >
                            {retrying === row.id ? (
                              <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                            ) : (
                              <RotateCcw size={14} aria-hidden="true" />
                            )}
                            ส่งใหม่
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </TableWrap>
        </div>
      )}
      {rows.length > 0 && (
        <div className="border-t border-line px-5 pb-4">
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} disabled={loading} onPageChange={setPage} />
        </div>
      )}
      <p className="m-0 px-5 pb-4 text-xs text-muted">
        ส่งใหม่อัตโนมัติสูงสุด {MAX_ATTEMPTS} ครั้ง · รายการที่ส่งแล้วถูกลบอัตโนมัติเมื่อเก่ากว่า 90 วัน
      </p>
    </Card>
  )
}