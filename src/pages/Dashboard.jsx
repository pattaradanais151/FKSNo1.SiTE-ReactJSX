import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CalendarClock, History, Plus, RefreshCw } from 'lucide-react'
import { useAuth } from '../lib/auth.jsx'
import { getErrorMessage, supabase } from '../lib/supabase.js'
import { JOB_STATUS, OPEN_JOB_STATUSES, formatBaht, formatDate, todayISO, usePageTitle } from '../lib/utils.js'
import { Badge, Card, EmptyState, ErrorState, JobStatusBadge, LoadingState, PageHeader } from '../components/UI.jsx'
import { describeJobUpdate, unwrap, useProfileDirectory } from '../components/Forms.jsx'

const numberFormat = new Intl.NumberFormat('th-TH')
const STATUS_ORDER = ['pending_review', 'checking', 'in_progress', 'completed', 'cancelled']
const DUE_LIST_DAYS = 7

function addDaysISO(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function StatTile({ label, value, hint, to, valueClass = '' }) {
  const body = (
    <>
      <div className="text-sm text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${valueClass}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </>
  )
  const base = 'block h-full rounded-[18px] border border-line bg-surface p-4'
  return to ? (
    <Link to={to} className={`${base} text-ink no-underline transition-colors hover:border-brand`}>
      {body}
    </Link>
  ) : (
    <div className={base}>{body}</div>
  )
}

function SectionTitle({ icon: Icon, children, action }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="m-0 inline-flex items-center gap-2 text-base font-semibold">
        <Icon size={18} className="text-muted" aria-hidden="true" />
        {children}
      </h2>
      {action}
    </div>
  )
}

function StatusDistribution({ summary }) {
  const segments = STATUS_ORDER.map((status) => ({ status, count: summary[`jobs_${status}`] ?? 0 }))
  const total = segments.reduce((sum, segment) => sum + segment.count, 0)
  if (total === 0) return null
  return (
    <div className="mt-4">
      <div
        className="flex h-2.5 overflow-hidden rounded-full bg-fill"
        role="img"
        aria-label={segments.map((s) => `${JOB_STATUS[s.status].label} ${s.count}`).join(', ')}
      >
        {segments
          .filter((segment) => segment.count > 0)
          .map((segment) => (
            <span
              key={segment.status}
              style={{
                width: `${(segment.count / total) * 100}%`,
                background: `var(--tone-${JOB_STATUS[segment.status].tone}-fg)`,
              }}
            />
          ))}
      </div>
      <ul className="m-0 mt-2 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs text-muted">
        {segments.map((segment) => (
          <li key={segment.status} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: `var(--tone-${JOB_STATUS[segment.status].tone}-fg)` }}
              aria-hidden="true"
            />
            {JOB_STATUS[segment.status].label} {numberFormat.format(segment.count)}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function Dashboard() {
  usePageTitle('ภาพรวม')
  const { isAdmin, profile } = useAuth()
  const { map: people } = useProfileDirectory()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  const load = useCallback(async () => {
    const today = todayISO()
    const [summary, recent, due, activity] = await Promise.all([
      supabase.rpc('dashboard_summary').then(unwrap),
      supabase
        .from('jobs')
        .select('id, job_number, title, status, received_at, customer:customers(name)')
        .order('created_at', { ascending: false })
        .limit(8)
        .then(unwrap),
      supabase
        .from('jobs')
        .select('id, job_number, title, status, due_date, assigned_to')
        .in('status', OPEN_JOB_STATUSES)
        .not('due_date', 'is', null)
        .lte('due_date', addDaysISO(today, DUE_LIST_DAYS))
        .order('due_date', { ascending: true })
        .limit(10)
        .then(unwrap),
      supabase
        .from('job_updates')
        .select('id, update_type, from_status, to_status, message, author_id, created_at, job:jobs(id, job_number, title)')
        .order('created_at', { ascending: false })
        .limit(12)
        .then(unwrap),
    ])
    return { summary, recent, due, activity, today }
  }, [])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    load()
      .then((result) => active && setData(result))
      .catch((err) => active && setError(getErrorMessage(err)))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [load, reloadKey])

  const actions = (
    <>
      <button
        type="button"
        className="btn btn-outline-secondary inline-flex items-center gap-2"
        onClick={() => setReloadKey((key) => key + 1)}
        disabled={loading}
      >
        <RefreshCw size={16} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
        รีเฟรช
      </button>
      {isAdmin && (
        <Link to="/jobs/new" className="btn btn-primary inline-flex items-center gap-2">
          <Plus size={16} aria-hidden="true" />
          สร้างงานใหม่
        </Link>
      )}
    </>
  )

  const header = (
    <PageHeader
      title="ภาพรวม"
      description={
        isAdmin
          ? `สวัสดี ${profile?.full_name || ''} ข้อมูลทั้งหมดในระบบ ณ ขณะนี้`
          : `สวัสดี ${profile?.full_name || ''} ข้อมูลเฉพาะงานที่ได้รับมอบหมายให้คุณ`
      }
      actions={actions}
    />
  )

  if (!data && loading) {
    return (
      <>
        {header}
        <LoadingState />
      </>
    )
  }

  if (!data && error) {
    return (
      <>
        {header}
        <Card>
          <ErrorState message={error} onRetry={() => setReloadKey((key) => key + 1)} />
        </Card>
      </>
    )
  }

  const { summary, recent, due, activity, today } = data
  const finance = summary.finance

  return (
    <>
      {header}

      {error && (
        <div className="alert alert-warning" role="alert">
          รีเฟรชข้อมูลไม่สำเร็จ: {error}
        </div>
      )}

      <section aria-labelledby="jobs-stats" className="mb-6">
        <h2 id="jobs-stats" className="sr-only">
          สถิติงาน
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatTile label="งานทั้งหมด" value={numberFormat.format(summary.jobs_total)} to="/jobs" />
          <StatTile
            label="รอตรวจสอบ"
            value={numberFormat.format(summary.jobs_pending_review)}
            to="/jobs?status=pending_review"
            valueClass="text-warning"
          />
          <StatTile
            label="กำลังตรวจเช็ค"
            value={numberFormat.format(summary.jobs_checking)}
            to="/jobs?status=checking"
            valueClass="text-info"
          />
          <StatTile
            label="กำลังดำเนินการ"
            value={numberFormat.format(summary.jobs_in_progress)}
            to="/jobs?status=in_progress"
            valueClass="text-brand"
          />
          <StatTile
            label="เสร็จสิ้น"
            value={numberFormat.format(summary.jobs_completed)}
            to="/jobs?status=completed"
            valueClass="text-success"
          />
          <StatTile
            label="ยกเลิก"
            value={numberFormat.format(summary.jobs_cancelled)}
            to="/jobs/cancelled"
            valueClass="text-danger"
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
          <StatTile
            label="ใกล้ถึงกำหนดส่ง"
            value={numberFormat.format(summary.jobs_due_soon)}
            hint="งานที่ยังไม่ปิด กำหนดส่งภายใน 3 วัน"
            to="/jobs?sort=due_asc"
          />
          <StatTile
            label="เลยกำหนดส่ง"
            value={numberFormat.format(summary.jobs_overdue)}
            hint="งานที่ยังไม่ปิด และเลยกำหนดส่งแล้ว"
            to="/jobs?sort=due_asc"
            valueClass={summary.jobs_overdue > 0 ? 'text-danger' : ''}
          />
          {isAdmin && summary.customers_total !== null && (
            <StatTile label="ลูกค้าทั้งหมด" value={numberFormat.format(summary.customers_total)} to="/customers" />
          )}
        </div>
        <Card className="mt-3">
          <div className="text-sm font-medium">สัดส่วนงานตามสถานะ</div>
          {summary.jobs_total > 0 ? (
            <StatusDistribution summary={summary} />
          ) : (
            <p className="mt-2 mb-0 text-sm text-muted">ยังไม่มีงานในระบบ</p>
          )}
        </Card>
      </section>

      {isAdmin && finance && (
        <section aria-labelledby="finance-stats" className="mb-6">
          <h2 id="finance-stats" className="mb-3 text-base font-semibold">
            การเงิน
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="ยอดที่คาดว่าจะได้รับ"
              value={formatBaht(finance.expected_total)}
              hint="ยอดสุทธิหลังส่วนลด รวมดอกเบี้ยผ่อน เฉพาะงานที่ไม่ถูกยกเลิก"
            />
            <StatTile
              label="รับชำระจริงแล้ว"
              value={formatBaht(finance.received_total)}
              hint="เงินที่รับจริงหลังหักคืนเงิน ทุกงาน (ไม่รวมรายการที่ถูก void)"
              valueClass="text-success"
            />
            <StatTile
              label="ลูกหนี้คงเหลือ"
              value={formatBaht(finance.outstanding_total)}
              hint="ยอดค้างชำระของงานที่ไม่ถูกยกเลิก"
              valueClass={Number(finance.outstanding_total) > 0 ? 'text-warning' : ''}
            />
            <StatTile
              label="งวดผ่อนเลยกำหนด"
              value={`${numberFormat.format(summary.installments_overdue_count ?? 0)} งวด`}
              hint={`ยอดค้างในงวดที่เลยกำหนด ${formatBaht(summary.installments_overdue_amount ?? 0)}`}
              valueClass={summary.installments_overdue_count > 0 ? 'text-danger' : ''}
            />
          </div>
          <p className="mt-2 mb-0 text-xs text-muted">
            ยอดรวมก่อนส่วนลด {formatBaht(finance.gross_total)} · ส่วนลด {formatBaht(finance.discount_total)} · ยอดสุทธิ{' '}
            {formatBaht(finance.net_total)} · ดอกเบี้ยผ่อน {formatBaht(finance.interest_total)}
          </p>
        </section>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <SectionTitle icon={CalendarClock}>กำหนดส่งภายใน {DUE_LIST_DAYS} วัน และเลยกำหนด</SectionTitle>
          {due.length === 0 ? (
            <p className="m-0 text-sm text-muted">ไม่มีงานที่ใกล้ถึงกำหนดส่ง</p>
          ) : (
            <ul className="m-0 list-none divide-y divide-line p-0">
              {due.map((job) => {
                const overdue = job.due_date < today
                return (
                  <li key={job.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div className="min-w-0">
                      <Link to={`/jobs/${job.id}`} className="font-medium no-underline">
                        {job.job_number}
                      </Link>
                      <span className="ml-2 text-sm">{job.title}</span>
                      <div className="text-xs text-muted">
                        {people[job.assigned_to]?.full_name || 'ยังไม่มอบหมาย'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {overdue && (
                        <Badge tone="danger">
                          <AlertTriangle size={12} aria-hidden="true" />
                          เลยกำหนด
                        </Badge>
                      )}
                      <span className={`text-sm tabular-nums ${overdue ? 'text-danger' : 'text-muted'}`}>
                        {formatDate(job.due_date)}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <Card>
          <SectionTitle
            icon={History}
            action={
              <Link to="/jobs" className="text-sm no-underline">
                ดูงานทั้งหมด
              </Link>
            }
          >
            งานล่าสุด
          </SectionTitle>
          {recent.length === 0 ? (
            <EmptyState
              title="ยังไม่มีงาน"
              description={isAdmin ? 'เริ่มต้นด้วยการสร้างงานบริการแรก' : 'ยังไม่มีงานที่ได้รับมอบหมายให้คุณ'}
            />
          ) : (
            <ul className="m-0 list-none divide-y divide-line p-0">
              {recent.map((job) => (
                <li key={job.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <Link to={`/jobs/${job.id}`} className="font-medium no-underline">
                      {job.job_number}
                    </Link>
                    <span className="ml-2 text-sm">{job.title}</span>
                    <div className="text-xs text-muted">
                      {job.customer?.name || '-'} · รับงาน {formatDate(job.received_at)}
                    </div>
                  </div>
                  <JobStatusBadge status={job.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="xl:col-span-2">
          <SectionTitle icon={History}>ประวัติการดำเนินงานล่าสุด</SectionTitle>
          {activity.length === 0 ? (
            <p className="m-0 text-sm text-muted">ยังไม่มีประวัติการดำเนินงาน</p>
          ) : (
            <ul className="m-0 list-none divide-y divide-line p-0">
              {activity.map((update) => {
                const text = describeJobUpdate(update)
                return (
                  <li key={update.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                    <div className="min-w-0">
                      <div className="text-sm">
                        {update.job && (
                          <Link to={`/jobs/${update.job.id}`} className="mr-2 font-medium no-underline">
                            {update.job.job_number}
                          </Link>
                        )}
                        {text.title}
                      </div>
                      {text.body && <div className="line-clamp-2 text-sm text-muted">{text.body}</div>}
                    </div>
                    <div className="text-right text-xs text-muted">
                      <div>{people[update.author_id]?.full_name || 'ระบบ'}</div>
                      <div>{formatDate(update.created_at, true)}</div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  )
}