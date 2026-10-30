import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BarChart3, History, ShieldCheck } from 'lucide-react'
import { useAuth } from '../lib/auth.jsx'
import { getErrorMessage, supabase } from '../lib/supabase.js'
import { JOB_STATUS, formatDate, todayISO, usePageTitle } from '../lib/utils.js'
import { Badge, Card, EmptyState, ErrorState, LoadingState, PageHeader, Pagination, TableWrap } from '../components/UI.jsx'
import { describeJobUpdate, unwrap, useJobTypes, useProfileDirectory } from '../components/Forms.jsx'
import { addDaysISO, formatMoney } from '../components/Finance.jsx'

const PAGE_SIZE = 30
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const AUDIT_TABLES = [
  'jobs',
  'job_finance',
  'job_cost_items',
  'payments',
  'installment_plans',
  'installment_items',
  'customers',
  'devices',
  'internal_notes',
  'profiles',
  'auth.users',
  'store_settings',
  'app_settings',
  'policies',
  'job_types',
]
const AUDIT_ACTIONS = ['INSERT', 'UPDATE', 'DELETE', 'CREATE_USER', 'INVITE_USER', 'SET_PASSWORD', 'SEND_PASSWORD_RESET']
const ACTION_TONE = { INSERT: 'success', UPDATE: 'warning', DELETE: 'danger' }
const UPDATE_TYPES = {
  status_change: 'เปลี่ยนสถานะ',
  progress: 'ความคืบหน้า',
  public_note: 'ข้อความถึงลูกค้า',
  assignment: 'การมอบหมาย',
}

function useParamState() {
  const [params, setParams] = useSearchParams()
  const update = useCallback(
    (changes) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          Object.entries(changes).forEach(([key, value]) => {
            if (value === null || value === undefined || value === '') next.delete(key)
            else next.set(key, String(value))
          })
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )
  return [params, update, setParams]
}

function readRange(params) {
  const defaultFrom = `${todayISO().slice(0, 8)}01`
  const from = ISO_DATE.test(params.get('from') || '') ? params.get('from') : defaultFrom
  const to = ISO_DATE.test(params.get('to') || '') ? params.get('to') : todayISO()
  return { from, to, invalid: from > to }
}

function rangeISO(from, to) {
  return { start: `${from}T00:00:00+07:00`, end: `${addDaysISO(to, 1)}T00:00:00+07:00` }
}

function pageOf(params) {
  return Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1)
}

function DateRange({ from, to, invalid, update }) {
  return (
    <>
      <div>
        <label htmlFor="rep-from" className="form-label text-sm">
          ตั้งแต่วันที่
        </label>
        <input id="rep-from" type="date" className="form-control" value={from} onChange={(e) => update({ from: e.target.value, page: null })} />
      </div>
      <div>
        <label htmlFor="rep-to" className="form-label text-sm">
          ถึงวันที่
        </label>
        <input id="rep-to" type="date" className="form-control" value={to} onChange={(e) => update({ to: e.target.value, page: null })} />
      </div>
      {invalid && <div className="text-sm text-danger sm:col-span-2">วันที่เริ่มต้นต้องไม่หลังวันที่สิ้นสุด</div>}
    </>
  )
}

export default function Reports() {
  usePageTitle('รายงานและประวัติ')
  const { isSuperAdmin } = useAuth()
  const [params, update, setParams] = useParamState()
  const { map: people, list: peopleList } = useProfileDirectory()
  const tabRefs = useRef({})

  const tabs = [
    { id: 'summary', label: 'สรุปรายงาน', Icon: BarChart3 },
    { id: 'activity', label: 'ประวัติการดำเนินงาน', Icon: History },
    ...(isSuperAdmin ? [{ id: 'audit', label: 'Audit Logs', Icon: ShieldCheck }] : []),
  ]
  const tabParam = params.get('tab')
  const tab = tabs.some((item) => item.id === tabParam) ? tabParam : 'summary'

  const selectTab = (id) => setParams(id === 'summary' ? new URLSearchParams() : new URLSearchParams({ tab: id }), { replace: true })

  const onTabKeyDown = (event) => {
    const index = tabs.findIndex((item) => item.id === tab)
    let next = null
    if (event.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length]
    else if (event.key === 'ArrowLeft') next = tabs[(index - 1 + tabs.length) % tabs.length]
    if (next) {
      event.preventDefault()
      selectTab(next.id)
      requestAnimationFrame(() => tabRefs.current[next.id]?.focus())
    }
  }

  return (
    <>
      <PageHeader title="รายงานและประวัติ" description="สรุปงานและการเงินตามช่วงเวลา ประวัติการดำเนินงาน และ Audit Logs" />

      <div role="tablist" aria-label="ส่วนของรายงาน" className="mb-4 flex flex-wrap gap-1 rounded-xl bg-fill p-1" onKeyDown={onTabKeyDown}>
        {tabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            ref={(element) => {
              tabRefs.current[id] = element
            }}
            type="button"
            role="tab"
            id={`rtab-${id}`}
            aria-selected={tab === id}
            aria-controls={`rpanel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => selectTab(id)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${
              tab === id ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'
            }`}
          >
            <Icon size={15} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`rpanel-${tab}`} aria-labelledby={`rtab-${tab}`}>
        {tab === 'summary' && <SummaryTab params={params} update={update} people={people} />}
        {tab === 'activity' && <ActivityTab params={params} update={update} people={people} peopleList={peopleList} />}
        {tab === 'audit' && isSuperAdmin && <AuditTab params={params} update={update} people={people} peopleList={peopleList} />}
      </div>
    </>
  )
}

/* ================================ สรุปรายงาน ================================ */

function Stat({ label, value, hint, tone }) {
  return (
    <Card>
      <div className="text-sm text-muted">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${tone ? `text-${tone}` : ''}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </Card>
  )
}

function SummaryTab({ params, update, people }) {
  const { from, to, invalid } = readRange(params)
  const { labels } = useJobTypes()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (invalid) {
      setLoading(false)
      return undefined
    }
    let active = true
    setLoading(true)
    setError('')
    const { start, end } = rangeISO(from, to)
    Promise.all([
      supabase.rpc('job_report', { p_from: from, p_to: to }).then(unwrap),
      supabase.rpc('payment_summary', { p_from: start, p_to: end }).then(unwrap),
    ])
      .then(([report, payments]) => active && setData({ report, payments }))
      .catch((err) => active && setError(getErrorMessage(err, 'โหลดรายงานไม่สำเร็จ')))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [from, to, invalid, reloadKey])

  const number = new Intl.NumberFormat('th-TH')
  // รองรับกรณี RPC คืนค่าไม่ครบ (เช่น ฐานข้อมูลยังไม่ได้รัน Migration ล่าสุด) ไม่ให้หน้าล้ม
  const report = data?.report && typeof data.report === 'object' ? data.report : null
  const paymentTotals = data?.payments && typeof data.payments === 'object' ? data.payments : {}
  const finance = report?.finance ?? null
  const byType = Array.isArray(report?.by_type) ? report.by_type : []
  const byAssignee = Array.isArray(report?.by_assignee) ? report.by_assignee : []
  const maxType = Math.max(1, ...byType.map((row) => Number(row.count) || 0))

  return (
    <>
      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DateRange from={from} to={to} invalid={invalid} update={update} />
        </div>
      </Card>

      {error ? (
        <Card>
          <ErrorState message={error} onRetry={() => setReloadKey((key) => key + 1)} />
        </Card>
      ) : loading && !data ? (
        <LoadingState />
      ) : !report ? (
        <Card>
          <ErrorState message="ไม่พบข้อมูลรายงาน กรุณาตรวจสอบว่ารัน Migration 003 ในฐานข้อมูลแล้ว" onRetry={() => setReloadKey((key) => key + 1)} />
        </Card>
      ) : (
        <div className={`space-y-4 ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="งานที่รับเข้า" value={number.format(report.jobs_received ?? 0)} hint="ตามวันที่รับงาน" />
            <Stat label="ยกเลิก (จากงานที่รับเข้า)" value={number.format(report.by_status?.cancelled ?? 0)} tone="danger" />
            <Stat label="ปิดงานสำเร็จในช่วงนี้" value={number.format(report.completed_in_range ?? 0)} hint="ตามวันที่เสร็จสิ้น" tone="success" />
            <Stat
              label="เวลาเฉลี่ยจนเสร็จ"
              value={report.avg_completion_days === null || report.avg_completion_days === undefined ? '-' : `${report.avg_completion_days} วัน`}
              hint="จากวันที่รับงานถึงเวลาเสร็จสิ้น"
            />
          </div>

          {finance && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="ยอดสุทธิของงานที่รับเข้า" value={formatMoney(finance.net_total ?? 0)} hint="หลังส่วนลด ไม่รวมดอกเบี้ย ไม่รวมงานยกเลิก" />
              <Stat label="ยอดคงค้างของงานที่รับเข้า" value={formatMoney(finance.balance_total ?? 0)} hint="ไม่รวมงานยกเลิก" tone="warning" />
              <Stat
                label="เงินรับจริงในช่วงนี้"
                value={formatMoney(paymentTotals.net_total ?? 0)}
                hint={`ตามวันที่รับเงิน หักคืนเงินแล้ว (${paymentTotals.payment_count ?? 0} รายการ)`}
                tone="success"
              />
              <Stat label="คืนเงินในช่วงนี้" value={formatMoney(paymentTotals.refund_total ?? 0)} tone="danger" />
            </div>
          )}

          <Card>
            <h2 className="mt-0 mb-3 text-base font-semibold">สถานะของงานที่รับเข้า</h2>
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
              {Object.entries(JOB_STATUS).map(([status, meta]) => (
                <li key={status}>
                  <Badge tone={meta.tone} dot>
                    {meta.label} {number.format(report.by_status?.[status] ?? 0)}
                  </Badge>
                </li>
              ))}
            </ul>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card flush>
              <h2 className="m-0 px-5 pt-5 pb-3 text-base font-semibold">แยกตามประเภทงาน</h2>
              {byType.length === 0 ? (
                <p className="m-0 px-5 pb-5 text-sm text-muted">ไม่มีงานในช่วงนี้</p>
              ) : (
                <TableWrap minWidth={520}>
                  <table className="table align-middle">
                    <thead>
                      <tr>
                        <th scope="col" className="pl-5">
                          ประเภท
                        </th>
                        <th scope="col" className="text-right">
                          จำนวน
                        </th>
                        <th scope="col" className="text-right">
                          ยกเลิก
                        </th>
                        {finance && (
                          <th scope="col" className="pr-5 text-right">
                            ยอดสุทธิ
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {byType.map((row) => (
                        <tr key={row.job_type}>
                          <td className="pl-5">
                            <div className="text-sm">{labels[row.job_type] || row.job_type}</div>
                            <div className="mt-1 h-1.5 rounded-full bg-fill" aria-hidden="true">
                              <div className="h-1.5 rounded-full bg-brand" style={{ width: `${((Number(row.count) || 0) / maxType) * 100}%` }} />
                            </div>
                          </td>
                          <td className="text-right tabular-nums">{number.format(row.count ?? 0)}</td>
                          <td className="text-right tabular-nums">{number.format(row.cancelled ?? 0)}</td>
                          {finance && <td className="pr-5 text-right tabular-nums">{formatMoney(row.net_total ?? 0)}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              )}
            </Card>

            <Card flush>
              <h2 className="m-0 px-5 pt-5 pb-3 text-base font-semibold">แยกตามผู้รับผิดชอบ</h2>
              {byAssignee.length === 0 ? (
                <p className="m-0 px-5 pb-5 text-sm text-muted">ไม่มีงานในช่วงนี้</p>
              ) : (
                <TableWrap minWidth={520}>
                  <table className="table align-middle">
                    <thead>
                      <tr>
                        <th scope="col" className="pl-5">
                          พนักงาน
                        </th>
                        <th scope="col" className="text-right">
                          ทั้งหมด
                        </th>
                        <th scope="col" className="text-right">
                          ยังไม่ปิด
                        </th>
                        <th scope="col" className="text-right">
                          เสร็จสิ้น
                        </th>
                        <th scope="col" className="pr-5 text-right">
                          ยกเลิก
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {byAssignee.map((row) => (
                        <tr key={row.assigned_to || 'none'}>
                          <td className="pl-5 text-sm">
                            {row.assigned_to ? people[row.assigned_to]?.full_name || 'ไม่ทราบชื่อ' : 'ยังไม่มอบหมาย'}
                          </td>
                          <td className="text-right tabular-nums">{number.format(row.total ?? 0)}</td>
                          <td className="text-right tabular-nums">{number.format(row.open ?? 0)}</td>
                          <td className="text-right tabular-nums">{number.format(row.completed ?? 0)}</td>
                          <td className="pr-5 text-right tabular-nums">{number.format(row.cancelled ?? 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              )}
            </Card>
          </div>

          <p className="m-0 text-xs text-muted">
            เกณฑ์: "งานที่รับเข้า" นับตามวันที่รับงาน · "ปิดงานสำเร็จ" นับตามเวลาที่เปลี่ยนเป็นเสร็จสิ้น · "เงินรับจริง"
            นับตามวันที่รับเงินของทุกงานและไม่รวมรายการที่ถูกยกเลิก (void) · ยอดคาดว่าจะได้รับไม่รวมงานที่ยกเลิก · ใช้เวลาไทย
          </p>
        </div>
      )}
    </>
  )
}

/* ================================ ประวัติการดำเนินงาน ================================ */

function ActivityTab({ params, update, people, peopleList }) {
  const { from, to, invalid } = readRange(params)
  const type = UPDATE_TYPES[params.get('type')] ? params.get('type') : ''
  const author = params.get('author') || ''
  const page = pageOf(params)
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (invalid) {
      setRows([])
      setTotal(0)
      setLoading(false)
      return undefined
    }
    let active = true
    const run = async () => {
      setLoading(true)
      setError('')
      const { start, end } = rangeISO(from, to)
      let query = supabase
        .from('job_updates')
        .select(
          'id, update_type, from_status, to_status, message, is_customer_visible, author_id, created_at, job:jobs(id, job_number, title)',
          { count: 'exact' },
        )
        .gte('created_at', start)
        .lt('created_at', end)
      if (type) query = query.eq('update_type', type)
      if (author) query = query.eq('author_id', author)
      const offset = (page - 1) * PAGE_SIZE
      const { data, count, error: queryError } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1)
      if (!active) return
      if (queryError) {
        if (queryError.code === 'PGRST103' && page > 1) update({ page: null })
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
  }, [from, to, invalid, type, author, page, reloadKey, update])

  return (
    <>
      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DateRange from={from} to={to} invalid={invalid} update={update} />
          <div>
            <label htmlFor="act-type" className="form-label text-sm">
              ประเภท
            </label>
            <select id="act-type" className="form-select" value={type} onChange={(e) => update({ type: e.target.value, page: null })}>
              <option value="">ทั้งหมด</option>
              {Object.entries(UPDATE_TYPES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="act-author" className="form-label text-sm">
              ผู้ดำเนินการ
            </label>
            <select id="act-author" className="form-select" value={author} onChange={(e) => update({ author: e.target.value, page: null })}>
              <option value="">ทุกคน</option>
              {peopleList.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.full_name || 'ไม่ระบุชื่อ'}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      <Card flush>
        {error && !loading ? (
          <ErrorState message={error} onRetry={() => setReloadKey((key) => key + 1)} />
        ) : loading && rows.length === 0 ? (
          <LoadingState />
        ) : rows.length === 0 ? (
          <EmptyState icon={History} title="ไม่มีประวัติในช่วงนี้" />
        ) : (
          <ul className={`m-0 list-none divide-y divide-line p-0 ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
            {rows.map((row) => {
              const text = describeJobUpdate(row)
              return (
                <li key={row.id} className="flex flex-wrap items-start justify-between gap-2 px-5 py-3">
                  <div className="min-w-0">
                    <div className="text-sm">
                      {row.job && (
                        <Link to={`/jobs/${row.job.id}`} className="mr-2 font-medium no-underline">
                          {row.job.job_number}
                        </Link>
                      )}
                      {text.title}
                      {row.is_customer_visible && (
                        <span className="ml-2">
                          <Badge tone="info">ลูกค้าเห็น</Badge>
                        </span>
                      )}
                    </div>
                    {text.body && <div className="line-clamp-2 text-sm text-muted">{text.body}</div>}
                  </div>
                  <div className="text-right text-xs text-muted">
                    <div>{row.author_id ? people[row.author_id]?.full_name || 'ไม่ทราบชื่อ' : 'ระบบ'}</div>
                    <div>{formatDate(row.created_at, true)}</div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        {rows.length > 0 && (
          <div className="border-t border-line px-5 pb-4">
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={total}
              disabled={loading}
              onPageChange={(next) => update({ page: next > 1 ? next : null })}
            />
          </div>
        )}
      </Card>
    </>
  )
}

/* ================================ Audit Logs ================================ */

function shortJson(value) {
  if (value === undefined) return '-'
  const text = JSON.stringify(value)
  return text.length > 300 ? `${text.slice(0, 300)}…` : text
}

function AuditChanges({ action, changes }) {
  if (action === 'UPDATE' && changes && !changes.new && !changes.old) {
    return (
      <table className="table table-sm m-0 align-top text-xs">
        <thead>
          <tr>
            <th scope="col">ฟิลด์</th>
            <th scope="col">ค่าเดิม</th>
            <th scope="col">ค่าใหม่</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(changes).map(([key, diff]) => (
            <tr key={key}>
              <td className="font-mono">{key}</td>
              <td className="font-mono break-all">{shortJson(diff?.old)}</td>
              <td className="font-mono break-all">{shortJson(diff?.new)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }
  return (
    <pre className="m-0 max-h-64 overflow-auto rounded-lg bg-fill p-3 text-xs whitespace-pre-wrap">
      {JSON.stringify(changes?.new ?? changes?.old ?? changes, null, 2)}
    </pre>
  )
}

function AuditTab({ params, update, people, peopleList }) {
  const { from, to, invalid } = readRange(params)
  const table = AUDIT_TABLES.includes(params.get('table')) ? params.get('table') : ''
  const action = AUDIT_ACTIONS.includes(params.get('action')) ? params.get('action') : ''
  const actor = params.get('actor') || ''
  const page = pageOf(params)
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (invalid) {
      setRows([])
      setTotal(0)
      setLoading(false)
      return undefined
    }
    let active = true
    const run = async () => {
      setLoading(true)
      setError('')
      const { start, end } = rangeISO(from, to)
      let query = supabase
        .from('audit_logs')
        .select('id, created_at, actor_id, actor_role, action, table_name, record_id, changes', { count: 'exact' })
        .gte('created_at', start)
        .lt('created_at', end)
      if (table) query = query.eq('table_name', table)
      if (action) query = query.eq('action', action)
      if (actor === 'system') query = query.is('actor_id', null)
      else if (actor) query = query.eq('actor_id', actor)
      const offset = (page - 1) * PAGE_SIZE
      const { data, count, error: queryError } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1)
      if (!active) return
      if (queryError) {
        if (queryError.code === 'PGRST103' && page > 1) update({ page: null })
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
  }, [from, to, invalid, table, action, actor, page, reloadKey, update])

  return (
    <>
      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <DateRange from={from} to={to} invalid={invalid} update={update} />
          <div>
            <label htmlFor="aud-table" className="form-label text-sm">
              ตาราง
            </label>
            <select id="aud-table" className="form-select" value={table} onChange={(e) => update({ table: e.target.value, page: null })}>
              <option value="">ทุกตาราง</option>
              {AUDIT_TABLES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="aud-action" className="form-label text-sm">
              การกระทำ
            </label>
            <select id="aud-action" className="form-select" value={action} onChange={(e) => update({ action: e.target.value, page: null })}>
              <option value="">ทั้งหมด</option>
              {AUDIT_ACTIONS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="aud-actor" className="form-label text-sm">
              ผู้ดำเนินการ
            </label>
            <select id="aud-actor" className="form-select" value={actor} onChange={(e) => update({ actor: e.target.value, page: null })}>
              <option value="">ทุกคน</option>
              <option value="system">ระบบ / ไม่ทราบ</option>
              {peopleList.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.full_name || 'ไม่ระบุชื่อ'}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      <Card flush>
        {error && !loading ? (
          <ErrorState message={error} onRetry={() => setReloadKey((key) => key + 1)} />
        ) : loading && rows.length === 0 ? (
          <LoadingState />
        ) : rows.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="ไม่มี Audit Log ตามเงื่อนไข" />
        ) : (
          <ul className={`m-0 list-none divide-y divide-line p-0 ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
            {rows.map((row) => (
              <li key={row.id}>
                <details className="px-5 py-3">
                  <summary className="cursor-pointer">
                    <span className="inline-flex flex-wrap items-center gap-2 align-middle text-sm">
                      <Badge tone={ACTION_TONE[row.action] || 'info'}>{row.action}</Badge>
                      <span className="font-medium">{row.table_name}</span>
                      <span className="font-mono text-xs text-muted">{row.record_id || '-'}</span>
                      <span className="text-xs text-muted">
                        {row.actor_id ? people[row.actor_id]?.full_name || 'ไม่ทราบชื่อ' : 'ระบบ'}
                        {row.actor_role ? ` (${row.actor_role})` : ''} · {formatDate(row.created_at, true)}
                      </span>
                    </span>
                  </summary>
                  <div className="mt-3 overflow-x-auto">
                    <AuditChanges action={row.action} changes={row.changes} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
        {rows.length > 0 && (
          <div className="border-t border-line px-5 pb-4">
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={total}
              disabled={loading}
              onPageChange={(next) => update({ page: next > 1 ? next : null })}
            />
          </div>
        )}
      </Card>
      <p className="mt-3 mb-0 text-xs text-muted">Audit Log แก้ไขหรือลบไม่ได้ (บังคับที่ Database) เนื้อหาบันทึกภายในและนโยบายไม่ถูกเก็บซ้ำใน Log</p>
    </>
  )
} 