import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Ban, CalendarClock, Loader2, Receipt, RefreshCw, Save } from 'lucide-react'
import { useAuth } from '../lib/auth.jsx'
import { getErrorMessage, supabase } from '../lib/supabase.js'
import {
  INTEREST_MODES,
  PAYMENT_METHODS,
  calcInterestSatang,
  formatDate,
  formatSatang,
  todayISO,
  usePageTitle,
} from '../lib/utils.js'
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  PageHeader,
  Pagination,
  SearchInput,
  TableWrap,
  fieldA11y,
  useDebouncedValue,
  useToast,
} from '../components/UI.jsx'
import { UUID_PATTERN, sanitizeSearch, unwrap, useProfileDirectory } from '../components/Forms.jsx'
import {
  CancelPlanDialog,
  FINANCE_COLUMNS,
  INSTALLMENT_ITEM_STATUS,
  ITEM_COLUMNS,
  ITEM_JOB_FK,
  InstallmentItemsTable,
  PAYMENT_COLUMNS,
  PAYMENT_KIND,
  PLAN_COLUMNS,
  PLAN_JOB_FK,
  PLAN_STATUS,
  PaymentsTable,
  PlanSummary,
  RecordPaymentModal,
  VoidPaymentDialog,
  addDaysISO,
  formatMoney,
  moneyToSatang,
  planInterestDescription,
  useInstallmentSettings,
} from '../components/Finance.jsx'

const PAGE_SIZE = 25
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const RATE_PATTERN = /^\d{1,3}(\.\d{1,4})?$/

const TABS = [
  { id: 'payments', label: 'รายการรับชำระ' },
  { id: 'due', label: 'งวดค้าง / ใกล้ครบกำหนด' },
  { id: 'plans', label: 'แผนผ่อนชำระ' },
  { id: 'settings', label: 'ตั้งค่าผ่อนชำระ' },
]

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

function pageFromParams(params) {
  return Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1)
}

function daysBetween(fromISO, toISO) {
  return Math.round((Date.parse(`${toISO}T00:00:00Z`) - Date.parse(`${fromISO}T00:00:00Z`)) / 86400000)
}

export default function Payments() {
  const { planId } = useParams()
  return planId ? <PlanDetail planId={planId} /> : <PaymentsOverview />
}

/* ================================ ภาพรวม (แท็บ) ================================ */

function PaymentsOverview() {
  usePageTitle('การชำระเงิน')
  const [params, update, setParams] = useParamState()
  const settings = useInstallmentSettings()
  const { map: people } = useProfileDirectory()
  const tabRefs = useRef({})
  const tabParam = params.get('tab')
  const tab = TABS.some((item) => item.id === tabParam) ? tabParam : 'payments'

  const selectTab = (id) => {
    setParams(id === 'payments' ? new URLSearchParams() : new URLSearchParams({ tab: id }), { replace: true })
  }

  const onTabKeyDown = (event) => {
    const index = TABS.findIndex((item) => item.id === tab)
    let next = null
    if (event.key === 'ArrowRight') next = TABS[(index + 1) % TABS.length]
    else if (event.key === 'ArrowLeft') next = TABS[(index - 1 + TABS.length) % TABS.length]
    else if (event.key === 'Home') next = TABS[0]
    else if (event.key === 'End') next = TABS[TABS.length - 1]
    if (next) {
      event.preventDefault()
      selectTab(next.id)
      requestAnimationFrame(() => tabRefs.current[next.id]?.focus())
    }
  }

  return (
    <>
      <PageHeader title="การชำระเงิน" description="รายการรับชำระ คืนเงิน แผนผ่อนชำระ และงวดที่ต้องติดตาม" />

      <div
        role="tablist"
        aria-label="ส่วนของการชำระเงิน"
        className="mb-4 flex flex-wrap gap-1 rounded-xl bg-fill p-1"
        onKeyDown={onTabKeyDown}
      >
        {TABS.map((item) => (
          <button
            key={item.id}
            ref={(element) => {
              tabRefs.current[item.id] = element
            }}
            type="button"
            role="tab"
            id={`tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls={`panel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => selectTab(item.id)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              tab === item.id ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'payments' && <PaymentsTab params={params} update={update} people={people} />}
        {tab === 'due' && <DueTab params={params} update={update} settings={settings} />}
        {tab === 'plans' && <PlansTab params={params} update={update} />}
        {tab === 'settings' && <SettingsTab settings={settings} />}
      </div>
    </>
  )
}

/* ================================ แท็บ: รายการรับชำระ ================================ */

function PaymentsTab({ params, update, people }) {
  const defaultFrom = `${todayISO().slice(0, 8)}01`
  const from = ISO_DATE.test(params.get('from') || '') ? params.get('from') : defaultFrom
  const to = ISO_DATE.test(params.get('to') || '') ? params.get('to') : todayISO()
  const method = PAYMENT_METHODS[params.get('method')] ? params.get('method') : ''
  const kind = PAYMENT_KIND[params.get('kind')] ? params.get('kind') : ''
  const showVoided = params.get('voided') === '1'
  const q = params.get('q') || ''
  const page = pageFromParams(params)
  const rangeInvalid = from > to

  const [searchText, setSearchText] = useState(q)
  const debouncedSearch = useDebouncedValue(searchText, 350)
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [voidTarget, setVoidTarget] = useState(null)

  const qRef = useRef(q)
  const updateRef = useRef(update)
  useEffect(() => {
    qRef.current = q
    updateRef.current = update
  })
  useEffect(() => {
    setSearchText(q)
  }, [q])
  useEffect(() => {
    const next = debouncedSearch.trim()
    if (next !== qRef.current) updateRef.current({ q: next, page: null })
  }, [debouncedSearch])

  useEffect(() => {
    if (rangeInvalid) {
      setRows([])
      setTotal(0)
      setSummary(null)
      setLoading(false)
      return undefined
    }
    let active = true
    const run = async () => {
      setLoading(true)
      setError('')
      try {
        const startISO = `${from}T00:00:00+07:00`
        const endISO = `${addDaysISO(to, 1)}T00:00:00+07:00`
        let query = supabase
          .from('payments')
          .select(
            `${PAYMENT_COLUMNS}, job:jobs!inner(id, job_number, title, customer:customers(name)), item:installment_items(installment_no)`,
            { count: 'exact' },
          )
          .gte('paid_at', startISO)
          .lt('paid_at', endISO)
        if (method) query = query.eq('method', method)
        if (kind) query = query.eq('kind', kind)
        if (!showVoided) query = query.is('voided_at', null)
        const term = sanitizeSearch(q)
        if (term) query = query.ilike('job.job_number', `%${term}%`)
        const offset = (page - 1) * PAGE_SIZE
        query = query
          .order('paid_at', { ascending: false })
          .order('created_at', { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1)

        const [summaryData, listResult] = await Promise.all([
          supabase.rpc('payment_summary', { p_from: startISO, p_to: endISO }).then(unwrap),
          query,
        ])
        if (!active) return
        if (listResult.error) {
          if (listResult.error.code === 'PGRST103' && page > 1) {
            update({ page: null })
            return
          }
          throw listResult.error
        }
        setSummary(summaryData)
        setRows(listResult.data ?? [])
        setTotal(listResult.count ?? 0)
      } catch (err) {
        if (active) setError(getErrorMessage(err))
      } finally {
        if (active) setLoading(false)
      }
    }
    run()
    return () => {
      active = false
    }
  }, [from, to, method, kind, showVoided, q, page, rangeInvalid, reloadKey, update])

  const byMethod = Object.entries(summary?.by_method ?? {})

  return (
    <>
      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div>
            <label htmlFor="pay-from" className="form-label text-sm">
              ตั้งแต่วันที่
            </label>
            <input
              id="pay-from"
              type="date"
              className="form-control"
              value={from}
              onChange={(e) => update({ from: e.target.value, page: null })}
            />
          </div>
          <div>
            <label htmlFor="pay-to" className="form-label text-sm">
              ถึงวันที่
            </label>
            <input
              id="pay-to"
              type="date"
              className="form-control"
              value={to}
              onChange={(e) => update({ to: e.target.value, page: null })}
            />
          </div>
          <div>
            <label htmlFor="pay-method-filter" className="form-label text-sm">
              วิธีชำระ
            </label>
            <select
              id="pay-method-filter"
              className="form-select"
              value={method}
              onChange={(e) => update({ method: e.target.value, page: null })}
            >
              <option value="">ทุกวิธี</option>
              {Object.entries(PAYMENT_METHODS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="pay-kind-filter" className="form-label text-sm">
              ประเภท
            </label>
            <select
              id="pay-kind-filter"
              className="form-select"
              value={kind}
              onChange={(e) => update({ kind: e.target.value, page: null })}
            >
              <option value="">ทั้งหมด</option>
              {Object.entries(PAYMENT_KIND).map(([value, meta]) => (
                <option key={value} value={value}>
                  {meta.label}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <span className="form-label block text-sm">ค้นหาเลขที่งาน</span>
            <SearchInput value={searchText} onChange={setSearchText} placeholder="เช่น JOB-000012" label="ค้นหาเลขที่งาน" />
          </div>
        </div>
        <div className="form-check mt-3 mb-0">
          <input
            id="pay-show-voided"
            type="checkbox"
            className="form-check-input"
            checked={showVoided}
            onChange={(e) => update({ voided: e.target.checked ? '1' : null, page: null })}
          />
          <label htmlFor="pay-show-voided" className="form-check-label text-sm">
            แสดงรายการที่ถูกยกเลิก (void)
          </label>
        </div>
        {rangeInvalid && <div className="mt-2 text-sm text-danger">วันที่เริ่มต้นต้องไม่หลังวันที่สิ้นสุด</div>}
      </Card>

      {summary && (
        <section aria-label="สรุปยอดตามช่วงวันที่" className="mb-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Card>
              <div className="text-sm text-muted">รับชำระ ({summary.payment_count} รายการ)</div>
              <div className="mt-1 text-xl font-semibold text-success tabular-nums">{formatMoney(summary.payment_total)}</div>
            </Card>
            <Card>
              <div className="text-sm text-muted">คืนเงิน ({summary.refund_count} รายการ)</div>
              <div className="mt-1 text-xl font-semibold text-danger tabular-nums">{formatMoney(summary.refund_total)}</div>
            </Card>
            <Card>
              <div className="text-sm text-muted">รับสุทธิ</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">{formatMoney(summary.net_total)}</div>
            </Card>
          </div>
          <p className="mt-2 mb-0 text-xs text-muted">
            สรุปตามช่วงวันที่ (เวลาไทย) ไม่ขึ้นกับตัวกรองอื่น และไม่รวมรายการที่ถูกยกเลิก
            {byMethod.length > 0 &&
              ` · แยกตามวิธี: ${byMethod.map(([key, value]) => `${PAYMENT_METHODS[key] ?? key} ${formatMoney(value)}`).join(', ')}`}
          </p>
        </section>
      )}

      <Card flush>
        {error && !loading ? (
          <ErrorState message={error} onRetry={() => setReloadKey((key) => key + 1)} />
        ) : loading && rows.length === 0 ? (
          <LoadingState />
        ) : rows.length === 0 ? (
          <EmptyState icon={Receipt} title="ไม่พบรายการ" description="ไม่มีรายการรับชำระหรือคืนเงินตามเงื่อนไขที่เลือก" />
        ) : (
          <div className={loading ? 'opacity-60' : ''} aria-busy={loading}>
            <PaymentsTable payments={rows} people={people} showJob onVoid={setVoidTarget} />
          </div>
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

      <VoidPaymentDialog
        payment={voidTarget}
        onClose={() => setVoidTarget(null)}
        onDone={() => {
          setVoidTarget(null)
          setReloadKey((key) => key + 1)
        }}
      />
    </>
  )
}

/* ================================ แท็บ: งวดค้าง / ใกล้ครบกำหนด ================================ */

function DueTab({ params, update, settings }) {
  const scopeParam = params.get('scope')
  const scope = scopeParam === 'overdue' || scopeParam === 'soon' ? scopeParam : 'all'
  const page = pageFromParams(params)
  const dueSoonDays = settings.dueSoonDays
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const today = todayISO()

  useEffect(() => {
    let active = true
    const run = async () => {
      setLoading(true)
      setError('')
      try {
        const now = todayISO()
        const limit = addDaysISO(now, dueSoonDays)
        let query = supabase
          .from('installment_items')
          .select(
            `${ITEM_COLUMNS}, plan:installment_plans!inner(id, status), job:jobs!${ITEM_JOB_FK}!inner(id, job_number, title, status, customer:customers(name, phone))`,
            { count: 'exact' },
          )
          .neq('status', 'paid')
          .eq('plan.status', 'active')
          .neq('job.status', 'cancelled')
        if (scope === 'overdue') query = query.lt('due_date', now)
        else if (scope === 'soon') query = query.gte('due_date', now).lte('due_date', limit)
        else query = query.lte('due_date', limit)
        const offset = (page - 1) * PAGE_SIZE
        const { data, count, error: queryError } = await query
          .order('due_date', { ascending: true })
          .order('installment_no', { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1)
        if (!active) return
        if (queryError) {
          if (queryError.code === 'PGRST103' && page > 1) {
            update({ page: null })
            return
          }
          throw queryError
        }
        setRows(data ?? [])
        setTotal(count ?? 0)
      } catch (err) {
        if (active) setError(getErrorMessage(err))
      } finally {
        if (active) setLoading(false)
      }
    }
    run()
    return () => {
      active = false
    }
  }, [scope, page, dueSoonDays, reloadKey, update])

  return (
    <>
      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="due-scope" className="form-label text-sm">
              แสดง
            </label>
            <select
              id="due-scope"
              className="form-select"
              value={scope}
              onChange={(e) => update({ scope: e.target.value === 'all' ? null : e.target.value, page: null })}
            >
              <option value="all">เลยกำหนด + ใกล้ครบกำหนดภายใน {dueSoonDays} วัน</option>
              <option value="overdue">เฉพาะงวดที่เลยกำหนด</option>
              <option value="soon">เฉพาะงวดที่ใกล้ครบกำหนด</option>
            </select>
          </div>
          <p className="m-0 pb-2 text-xs text-muted">ไม่รวมงานที่ยกเลิกและแผนที่ยกเลิก · จำนวนวันตั้งค่าได้ที่แท็บ "ตั้งค่าผ่อนชำระ"</p>
        </div>
      </Card>

      <Card flush>
        {error && !loading ? (
          <ErrorState message={error} onRetry={() => setReloadKey((key) => key + 1)} />
        ) : loading && rows.length === 0 ? (
          <LoadingState />
        ) : rows.length === 0 ? (
          <EmptyState icon={CalendarClock} title="ไม่มีงวดที่ต้องติดตาม" description="ไม่มีงวดผ่อนที่เลยกำหนดหรือใกล้ครบกำหนดในขณะนี้" />
        ) : (
          <div className={loading ? 'opacity-60' : ''} aria-busy={loading}>
            <TableWrap minWidth={860}>
              <table className="table align-middle">
                <thead>
                  <tr>
                    <th scope="col" className="pl-5">
                      งาน / ลูกค้า
                    </th>
                    <th scope="col">งวด</th>
                    <th scope="col">ครบกำหนด</th>
                    <th scope="col" className="text-right">
                      คงค้าง
                    </th>
                    <th scope="col">สถานะ</th>
                    <th scope="col" className="pr-5">
                      <span className="sr-only">การดำเนินการ</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((item) => {
                    const overdueDays = daysBetween(item.due_date, today)
                    const meta = INSTALLMENT_ITEM_STATUS[item.status] ?? INSTALLMENT_ITEM_STATUS.pending
                    return (
                      <tr key={item.id}>
                        <td className="max-w-[300px] pl-5">
                          <Link to={`/jobs/${item.job.id}`} className="font-medium no-underline">
                            {item.job.job_number}
                          </Link>
                          <div className="truncate text-sm text-muted">
                            {item.job.customer?.name || '-'}
                            {item.job.customer?.phone ? ` · ${item.job.customer.phone}` : ''}
                          </div>
                        </td>
                        <td>งวดที่ {item.installment_no}</td>
                        <td className="whitespace-nowrap">
                          <div className={overdueDays > 0 ? 'font-medium text-danger' : ''}>{formatDate(item.due_date)}</div>
                          <div className="text-xs text-muted">
                            {overdueDays > 0
                              ? `เลยกำหนด ${overdueDays} วัน`
                              : overdueDays === 0
                                ? 'ครบกำหนดวันนี้'
                                : `อีก ${-overdueDays} วัน`}
                          </div>
                        </td>
                        <td className="text-right font-medium tabular-nums">
                          {formatSatang(moneyToSatang(item.amount_due) - moneyToSatang(item.paid_amount))}
                        </td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            <Badge tone={meta.tone}>{meta.label}</Badge>
                            {overdueDays > 0 && (
                              <Badge tone="danger">
                                <AlertTriangle size={12} aria-hidden="true" />
                                เลยกำหนด
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="pr-5 text-right">
                          <Link to={`/payments/plans/${item.plan.id}`} className="btn btn-sm btn-outline-secondary whitespace-nowrap">
                            เปิดแผน / รับชำระ
                          </Link>
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

/* ================================ แท็บ: แผนผ่อนชำระ ================================ */

function PlansTab({ params, update }) {
  const navigate = useNavigate()
  const statusParam = params.get('status')
  const status = statusParam === 'all' || PLAN_STATUS[statusParam] ? statusParam : 'active'
  const page = pageFromParams(params)
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const today = todayISO()

  useEffect(() => {
    let active = true
    const run = async () => {
      setLoading(true)
      setError('')
      try {
        let query = supabase
          .from('installment_plans')
          .select(
            `${PLAN_COLUMNS}, job:jobs!${PLAN_JOB_FK}(id, job_number, title, status, customer:customers(name)), installment_items(due_date, amount_due, paid_amount, status)`,
            { count: 'exact' },
          )
        if (status !== 'all') query = query.eq('status', status)
        const offset = (page - 1) * PAGE_SIZE
        const { data, count, error: queryError } = await query
          .order('created_at', { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1)
        if (!active) return
        if (queryError) {
          if (queryError.code === 'PGRST103' && page > 1) {
            update({ page: null })
            return
          }
          throw queryError
        }
        setRows(data ?? [])
        setTotal(count ?? 0)
      } catch (err) {
        if (active) setError(getErrorMessage(err))
      } finally {
        if (active) setLoading(false)
      }
    }
    run()
    return () => {
      active = false
    }
  }, [status, page, reloadKey, update])

  return (
    <>
      <Card className="mb-4">
        <label htmlFor="plan-status-filter" className="form-label text-sm">
          สถานะแผน
        </label>
        <select
          id="plan-status-filter"
          className="form-select max-w-xs"
          value={status}
          onChange={(e) => update({ status: e.target.value === 'active' ? null : e.target.value, page: null })}
        >
          <option value="active">{PLAN_STATUS.active.label}</option>
          <option value="completed">{PLAN_STATUS.completed.label}</option>
          <option value="cancelled">{PLAN_STATUS.cancelled.label}</option>
          <option value="all">ทั้งหมด</option>
        </select>
      </Card>

      <Card flush>
        {error && !loading ? (
          <ErrorState message={error} onRetry={() => setReloadKey((key) => key + 1)} />
        ) : loading && rows.length === 0 ? (
          <LoadingState />
        ) : rows.length === 0 ? (
          <EmptyState icon={CalendarClock} title="ไม่มีแผนผ่อนชำระ" description="สร้างแผนผ่อนได้จากหน้ารายละเอียดงาน ส่วนราคาและการเงิน" />
        ) : (
          <div className={loading ? 'opacity-60' : ''} aria-busy={loading}>
            <TableWrap minWidth={1000}>
              <table className="table table-hover align-middle">
                <thead>
                  <tr>
                    <th scope="col" className="pl-5">
                      งาน / ลูกค้า
                    </th>
                    <th scope="col" className="text-right">
                      ยอดรวมผ่อน
                    </th>
                    <th scope="col" className="text-right">
                      ชำระแล้ว
                    </th>
                    <th scope="col" className="text-right">
                      คงค้าง
                    </th>
                    <th scope="col">งวดถัดไป</th>
                    <th scope="col">ดอกเบี้ย</th>
                    <th scope="col" className="pr-5">
                      สถานะ
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((plan) => {
                    const items = plan.installment_items ?? []
                    const paid = items.reduce((sum, item) => sum + moneyToSatang(item.paid_amount), 0)
                    const due = items.reduce((sum, item) => sum + moneyToSatang(item.amount_due), 0)
                    const unpaid = items
                      .filter((item) => item.status !== 'paid')
                      .sort((a, b) => a.due_date.localeCompare(b.due_date))
                    const next = unpaid[0]
                    const overdueCount = unpaid.filter((item) => item.due_date < today).length
                    return (
                      <tr key={plan.id} className="cursor-pointer" onClick={() => navigate(`/payments/plans/${plan.id}`)}>
                        <td className="max-w-[280px] pl-5">
                          <Link
                            to={`/payments/plans/${plan.id}`}
                            className="font-medium no-underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {plan.job?.job_number || '-'}
                          </Link>
                          <div className="truncate text-sm text-muted">{plan.job?.customer?.name || plan.job?.title || '-'}</div>
                        </td>
                        <td className="text-right tabular-nums">{formatMoney(plan.total_amount)}</td>
                        <td className="text-right tabular-nums">{formatSatang(paid)}</td>
                        <td className="text-right font-medium tabular-nums">{formatSatang(Math.max(due - paid, 0))}</td>
                        <td className="text-sm whitespace-nowrap">
                          {plan.status === 'active' && next ? (
                            <span className={next.due_date < today ? 'font-medium text-danger' : ''}>
                              {formatDate(next.due_date)}
                              {overdueCount > 0 && ` (เลยกำหนด ${overdueCount} งวด)`}
                            </span>
                          ) : (
                            '-'
                          )}
                        </td>
                        <td className="max-w-[220px] text-xs text-muted">{planInterestDescription(plan)}</td>
                        <td className="pr-5">
                          <div className="flex flex-wrap gap-1">
                            <Badge tone={PLAN_STATUS[plan.status]?.tone}>{PLAN_STATUS[plan.status]?.label}</Badge>
                            {plan.job?.status === 'cancelled' && <Badge tone="danger">งานถูกยกเลิก</Badge>}
                          </div>
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

/* ================================ แท็บ: ตั้งค่าผ่อนชำระ ================================ */

function SettingsTab({ settings }) {
  const { isSuperAdmin } = useAuth()
  const toast = useToast()
  const [form, setForm] = useState({ rate: '', mode: 'per_month', dueSoonDays: '' })
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!settings.loaded) return
    setForm({ rate: String(settings.rate), mode: settings.mode, dueSoonDays: String(settings.dueSoonDays) })
  }, [settings.loaded, settings.rate, settings.mode, settings.dueSoonDays])

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  const rateText = form.rate.trim()
  const rateValid = RATE_PATTERN.test(rateText) && Number(rateText) <= 100
  const exampleInterest = rateValid && INTEREST_MODES[form.mode] ? calcInterestSatang(1000000, Number(rateText), form.mode, 12) : null

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!isSuperAdmin || saving) return
    const days = form.dueSoonDays.trim()
    const next = {}
    if (!rateValid) next.rate = 'อัตราดอกเบี้ยต้องเป็นตัวเลข 0–100 ทศนิยมไม่เกิน 4 ตำแหน่ง'
    if (!INTEREST_MODES[form.mode]) next.mode = 'กรุณาเลือกรูปแบบดอกเบี้ย'
    if (!/^\d{1,2}$/.test(days) || Number(days) > 60) next.dueSoonDays = 'ต้องเป็นจำนวนเต็ม 0–60'
    setErrors(next)
    if (Object.keys(next).length > 0) return

    const changes = []
    if (Number(rateText) !== settings.rate) changes.push(['installment_interest_rate_percent', Number(rateText)])
    if (form.mode !== settings.mode) changes.push(['installment_interest_mode', form.mode])
    if (Number(days) !== settings.dueSoonDays) changes.push(['installment_due_soon_days', Number(days)])
    if (changes.length === 0) {
      toast.info('ไม่มีการเปลี่ยนแปลง')
      return
    }

    setSaving(true)
    try {
      for (const [key, value] of changes) {
        const { data, error } = await supabase.from('app_settings').update({ value }).eq('key', key).select('key')
        if (error) throw error
        if (!data || data.length === 0) throw new Error('ไม่พบการตั้งค่า หรือคุณไม่มีสิทธิ์แก้ไข')
      }
      toast.success('บันทึกการตั้งค่าแล้ว แผนที่สร้างไว้ก่อนหน้าจะไม่เปลี่ยนแปลง')
      await settings.reload()
    } catch (err) {
      toast.error(getErrorMessage(err, 'บันทึกการตั้งค่าไม่สำเร็จ'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="max-w-2xl">
      <h2 className="mt-0 mb-1 text-base font-semibold">ตั้งค่าผ่อนชำระ</h2>
      <p className="mt-0 mb-4 text-sm text-muted">
        {isSuperAdmin
          ? 'ค่าที่ตั้งจะใช้กับแผนที่สร้างใหม่เท่านั้น แต่ละแผนบันทึกอัตราและรูปแบบที่ใช้จริงไว้แล้ว'
          : 'เฉพาะ Super Admin เท่านั้นที่แก้ไขการตั้งค่านี้ได้'}
      </p>
      {settings.error && (
        <div className="alert alert-warning py-2 text-sm" role="alert">
          {settings.error}
        </div>
      )}
      <form onSubmit={handleSubmit} noValidate>
        <fieldset disabled={!isSuperAdmin || saving || !settings.loaded}>
          <div className="grid gap-x-4 sm:grid-cols-2">
            <Field label="อัตราดอกเบี้ย (%)" htmlFor="set-rate" error={errors.rate} required>
              <input
                inputMode="decimal"
                className="form-control"
                value={form.rate}
                onChange={set('rate')}
                {...fieldA11y('set-rate', errors.rate)}
              />
            </Field>
            <Field label="รูปแบบดอกเบี้ย" htmlFor="set-mode" error={errors.mode} required>
              <select className="form-select" value={form.mode} onChange={set('mode')} {...fieldA11y('set-mode', errors.mode)}>
                {Object.entries(INTEREST_MODES).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="แจ้งเตือนงวดใกล้ครบกำหนดล่วงหน้า (วัน)"
              htmlFor="set-days"
              error={errors.dueSoonDays}
              hint="ใช้กับรายการงวดใกล้ครบกำหนด และการแจ้งเตือน Discord ใน Phase 7"
              required
            >
              <input
                inputMode="numeric"
                className="form-control"
                value={form.dueSoonDays}
                onChange={set('dueSoonDays')}
                {...fieldA11y('set-days', errors.dueSoonDays, true)}
              />
            </Field>
          </div>
        </fieldset>
        <div className="mb-4 rounded-xl bg-fill p-3 text-sm">
          ตัวอย่าง: เงินต้น {formatSatang(1000000)} ผ่อน 12 งวดรายเดือน →{' '}
          {exampleInterest === null ? (
            'กรอกอัตราให้ถูกต้องเพื่อดูตัวอย่าง'
          ) : (
            <>
              ดอกเบี้ย <strong>{formatSatang(exampleInterest)}</strong> · ยอดรวม{' '}
              <strong>{formatSatang(1000000 + exampleInterest)}</strong>
            </>
          )}
        </div>
        {isSuperAdmin && (
          <div className="flex justify-end">
            <button type="submit" className="btn btn-primary inline-flex items-center gap-2" disabled={saving || !settings.loaded}>
              {saving ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
              บันทึกการตั้งค่า
            </button>
          </div>
        )}
      </form>
      <p className="mt-4 mb-0 text-xs text-muted">
        อัตราดอกเบี้ยและเงื่อนไขการผ่อนชำระต้องได้รับการตรวจสอบตามกฎหมายที่เกี่ยวข้องก่อนนำไปใช้กับลูกค้าจริง
      </p>
    </Card>
  )
}

/* ================================ รายละเอียดแผนผ่อน ================================ */

function PlanDetail({ planId }) {
  const toast = useToast()
  const { map: people } = useProfileDirectory()
  const settings = useInstallmentSettings()
  const [state, setState] = useState({ status: 'loading', error: '' })
  const [data, setData] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [payItemId, setPayItemId] = useState(null)
  const [voidTarget, setVoidTarget] = useState(null)
  const [cancelTarget, setCancelTarget] = useState(null)
  const hasData = useRef(false)
  usePageTitle(data ? `แผนผ่อน ${data.plan.job?.job_number || ''}` : 'แผนผ่อนชำระ')

  const load = useCallback(async () => {
    const plan = await supabase
      .from('installment_plans')
      .select(`${PLAN_COLUMNS}, job:jobs!${PLAN_JOB_FK}(id, job_number, title, status, customer:customers(id, name, phone))`)
      .eq('id', planId)
      .maybeSingle()
      .then(unwrap)
    if (!plan) return null
    const [items, finance, jobPayments] = await Promise.all([
      supabase.from('installment_items').select(ITEM_COLUMNS).eq('plan_id', planId).order('installment_no').then(unwrap),
      supabase.from('job_finance').select(FINANCE_COLUMNS).eq('job_id', plan.job_id).maybeSingle().then(unwrap),
      supabase
        .from('payments')
        .select(PAYMENT_COLUMNS)
        .eq('job_id', plan.job_id)
        .not('installment_item_id', 'is', null)
        .order('paid_at', { ascending: false })
        .then(unwrap),
    ])
    const itemList = items ?? []
    const itemIds = new Set(itemList.map((item) => item.id))
    return {
      plan,
      items: itemList,
      finance,
      payments: (jobPayments ?? []).filter((payment) => itemIds.has(payment.installment_item_id)),
    }
  }, [planId])

  useEffect(() => {
    if (!UUID_PATTERN.test(planId)) {
      setState({ status: 'notfound', error: '' })
      return undefined
    }
    let active = true
    if (!hasData.current) setState({ status: 'loading', error: '' })
    load()
      .then((result) => {
        if (!active) return
        if (!result) {
          setState({ status: 'notfound', error: '' })
          return
        }
        hasData.current = true
        setData(result)
        setState({ status: 'ready', error: '' })
      })
      .catch((err) => {
        if (!active) return
        if (hasData.current) toast.error(getErrorMessage(err, 'โหลดข้อมูลล่าสุดไม่สำเร็จ'))
        else setState({ status: 'error', error: getErrorMessage(err) })
      })
    return () => {
      active = false
    }
  }, [planId, load, reloadKey, toast])

  const reload = () => setReloadKey((key) => key + 1)

  if (state.status === 'loading') return <LoadingState />
  if (state.status === 'notfound') {
    return (
      <Card>
        <EmptyState
          title="ไม่พบแผนผ่อนชำระ"
          action={
            <Link to="/payments?tab=plans" className="btn btn-primary">
              กลับไปรายการแผน
            </Link>
          }
        />
      </Card>
    )
  }
  if (state.status === 'error') {
    return (
      <Card>
        <ErrorState message={state.error} onRetry={reload} />
      </Card>
    )
  }

  const { plan, items, finance, payments } = data
  const job = plan.job
  const canPay = plan.status === 'active' && job?.status !== 'cancelled'
  const itemNoById = Object.fromEntries(items.map((item) => [item.id, item.installment_no]))

  return (
    <>
      <PageHeader
        title={`แผนผ่อนชำระ ${job?.job_number || ''}`}
        description={job ? `${job.title} · ${job.customer?.name || '-'}` : undefined}
        actions={
          <>
            {job && (
              <Link to={`/jobs/${job.id}`} className="btn btn-outline-secondary inline-flex items-center gap-2">
                <ArrowLeft size={16} aria-hidden="true" />
                ไปที่งาน
              </Link>
            )}
            <button type="button" className="btn btn-outline-secondary" onClick={reload} aria-label="โหลดข้อมูลล่าสุด">
              <RefreshCw size={16} aria-hidden="true" />
            </button>
            {plan.status === 'active' && (
              <button
                type="button"
                className="btn btn-outline-danger inline-flex items-center gap-2"
                onClick={() => setCancelTarget(plan)}
              >
                <Ban size={16} aria-hidden="true" />
                ยกเลิกแผน
              </button>
            )}
          </>
        }
      />

      <Card className="mb-4">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge tone={PLAN_STATUS[plan.status]?.tone}>{PLAN_STATUS[plan.status]?.label}</Badge>
          {job?.status === 'cancelled' && <Badge tone="danger">งานถูกยกเลิก</Badge>}
        </div>
        <PlanSummary plan={plan} items={items} />
        <div className="mt-4 space-y-1 text-xs text-muted">
          <div>ดอกเบี้ย: {planInterestDescription(plan)} · อัตราที่บันทึก ณ เวลาสร้างแผน</div>
          <div>
            สร้างโดย {people[plan.created_by]?.full_name || 'ไม่ทราบชื่อ'} เมื่อ {formatDate(plan.created_at, true)}
          </div>
          {plan.note && <div className="whitespace-pre-wrap">หมายเหตุ: {plan.note}</div>}
        </div>
        {plan.status === 'cancelled' && (
          <div className="alert alert-danger mt-4 mb-0 py-2 text-sm" role="status">
            ยกเลิกแผนโดย {people[plan.cancelled_by]?.full_name || 'ไม่ทราบชื่อ'} เมื่อ {formatDate(plan.cancelled_at, true)} ·
            เหตุผล: {plan.cancel_reason}
          </div>
        )}
      </Card>

      <Card flush className="mb-4">
        <h2 className="m-0 px-5 pt-5 pb-3 text-base font-semibold">ตารางงวดผ่อน</h2>
        <InstallmentItemsTable items={items} dueSoonDays={settings.dueSoonDays} onPay={canPay ? setPayItemId : null} />
      </Card>

      <Card flush>
        <h2 className="m-0 px-5 pt-5 pb-3 text-base font-semibold">ประวัติการชำระงวด</h2>
        {payments.length === 0 ? (
          <p className="m-0 px-5 pb-5 text-sm text-muted">ยังไม่มีการชำระงวด</p>
        ) : (
          <PaymentsTable payments={payments} people={people} itemNoById={itemNoById} onVoid={setVoidTarget} />
        )}
      </Card>

      <p className="mt-4 mb-0 text-xs text-muted">
        เงื่อนไขการผ่อนชำระและอัตราดอกเบี้ยต้องได้รับการตรวจสอบตามกฎหมายที่เกี่ยวข้องก่อนใช้งานจริง
      </p>

      {job && (
        <RecordPaymentModal
          open={Boolean(payItemId)}
          kind="payment"
          job={job}
          finance={finance}
          plan={plan}
          items={items}
          presetItemId={payItemId}
          onClose={() => setPayItemId(null)}
          onSaved={() => {
            setPayItemId(null)
            reload()
          }}
        />
      )}
      <VoidPaymentDialog
        payment={voidTarget}
        onClose={() => setVoidTarget(null)}
        onDone={() => {
          setVoidTarget(null)
          reload()
        }}
      />
      <CancelPlanDialog
        plan={cancelTarget}
        onClose={() => setCancelTarget(null)}
        onDone={() => {
          setCancelTarget(null)
          reload()
        }}
      />
    </>
  )
}