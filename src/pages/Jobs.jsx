import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Ban, ClipboardList, Plus, RotateCcw } from 'lucide-react'
import { useAuth } from '../lib/auth.jsx'
import { getErrorMessage, supabase } from '../lib/supabase.js'
import { JOB_STATUS, OPEN_JOB_STATUSES, PAYMENT_STATUS, formatBaht, formatDate, todayISO, usePageTitle } from '../lib/utils.js'
import {
  Card,
  EmptyState,
  ErrorState,
  JobStatusBadge,
  LoadingState,
  PageHeader,
  Pagination,
  PaymentStatusBadge,
  SearchInput,
  TableWrap,
  useDebouncedValue,
} from '../components/UI.jsx'
import { jobTypeLabel, sanitizeSearch, useJobTypes, useProfileDirectory } from '../components/Forms.jsx'

const PAGE_SIZE = 20

const ACTIVE_SORTS = {
  created_desc: { column: 'created_at', ascending: false, label: 'สร้างล่าสุด' },
  due_asc: { column: 'due_date', ascending: true, label: 'กำหนดส่งใกล้สุด' },
  received_desc: { column: 'received_at', ascending: false, label: 'วันที่รับงานล่าสุด' },
  updated_desc: { column: 'updated_at', ascending: false, label: 'อัปเดตล่าสุด' },
}

const CANCELLED_SORTS = {
  cancelled_desc: { column: 'cancelled_at', ascending: false, label: 'ยกเลิกล่าสุด' },
  created_desc: { column: 'created_at', ascending: false, label: 'สร้างล่าสุด' },
}

function single(value) {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

export default function Jobs({ view = 'active' }) {
  const cancelledView = view === 'cancelled'
  usePageTitle(cancelledView ? 'งานที่ยกเลิก' : 'งานบริการ')
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  const { types, labels } = useJobTypes()
  const { list: people, map: peopleMap } = useProfileDirectory()
  const [params, setParams] = useSearchParams()

  const sorts = cancelledView ? CANCELLED_SORTS : ACTIVE_SORTS
  const sortParam = params.get('sort')
  const sortKey = sortParam && sorts[sortParam] ? sortParam : Object.keys(sorts)[0]
  const q = params.get('q') || ''
  const statusFilter = cancelledView ? '' : params.get('status') || ''
  const typeFilter = params.get('type') || ''
  const assigneeFilter = isAdmin ? params.get('assignee') || '' : ''
  const payFilter = isAdmin ? params.get('pay') || '' : ''
  const page = Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1)

  const [searchText, setSearchText] = useState(q)
  const debouncedSearch = useDebouncedValue(searchText, 350)
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const updateParams = useCallback(
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

  // ซิงก์ช่องค้นหากับ URL (รองรับปุ่มย้อนกลับของเบราว์เซอร์)
  const qRef = useRef(q)
  const updateRef = useRef(updateParams)
  useEffect(() => {
    qRef.current = q
    updateRef.current = updateParams
  })
  useEffect(() => {
    setSearchText(q)
  }, [q])
  useEffect(() => {
    const next = debouncedSearch.trim()
    if (next !== qRef.current) updateRef.current({ q: next, page: null })
  }, [debouncedSearch])

  useEffect(() => {
    let active = true
    const run = async () => {
      setLoading(true)
      setError('')
      try {
        const financeSelect = isAdmin
          ? `, job_finance${payFilter ? '!inner' : ''}(net_amount, balance_amount, payment_status)`
          : ''
        let query = supabase
          .from('jobs')
          .select(
            `id, job_number, title, job_type, other_type_name, status, received_at, due_date, assigned_to, cancel_reason, cancelled_at, cancelled_by, customer:customers(id, name, phone)${financeSelect}`,
            { count: 'exact' },
          )

        if (cancelledView) query = query.eq('status', 'cancelled')
        else if (statusFilter) query = query.eq('status', statusFilter)
        else query = query.neq('status', 'cancelled')

        if (typeFilter) query = query.eq('job_type', typeFilter)
        if (assigneeFilter === 'none') query = query.is('assigned_to', null)
        else if (assigneeFilter) query = query.eq('assigned_to', assigneeFilter)
        if (payFilter) query = query.eq('job_finance.payment_status', payFilter)

        const term = sanitizeSearch(q)
        if (term) {
          const customers = await supabase
            .from('customers')
            .select('id')
            .or(`name.ilike.%${term}%,phone.ilike.%${term}%,customer_code.ilike.%${term}%`)
            .limit(50)
          if (customers.error) throw customers.error
          const conditions = [`job_number.ilike.%${term}%`, `title.ilike.%${term}%`]
          if (customers.data.length > 0) {
            conditions.push(`customer_id.in.(${customers.data.map((c) => c.id).join(',')})`)
          }
          query = query.or(conditions.join(','))
        }

        const sort = sorts[sortKey]
        const from = (page - 1) * PAGE_SIZE
        query = query
          .order(sort.column, { ascending: sort.ascending, nullsFirst: false })
          .order('created_at', { ascending: false })
          .range(from, from + PAGE_SIZE - 1)

        const { data, count, error: queryError } = await query
        if (!active) return
        if (queryError) {
          // หน้าที่ขอเกินจำนวนข้อมูล (เช่น หลังกรองใหม่) ให้กลับไปหน้าแรก
          if (queryError.code === 'PGRST103' && page > 1) {
            updateParams({ page: null })
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
  }, [cancelledView, statusFilter, typeFilter, assigneeFilter, payFilter, q, sortKey, sorts, page, isAdmin, reloadKey, updateParams])

  const hasFilters = Boolean(q || statusFilter || typeFilter || assigneeFilter || payFilter || sortParam)
  const today = todayISO()

  const resetFilters = () => {
    setSearchText('')
    setParams(new URLSearchParams(), { replace: true })
  }

  const title = cancelledView ? 'งานที่ยกเลิก' : 'งานบริการ'
  let description = 'งานบริการทั้งหมดที่ยังไม่ถูกยกเลิก'
  if (cancelledView) description = 'งานที่ถูกยกเลิก พร้อมเหตุผลและผู้ดำเนินการ (ประวัติการเงินยังถูกเก็บไว้)'
  else if (!isAdmin) description = 'งานที่ได้รับมอบหมายให้คุณ'

  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={
          isAdmin &&
          !cancelledView && (
            <Link to="/jobs/new" className="btn btn-primary inline-flex items-center gap-2">
              <Plus size={16} aria-hidden="true" />
              สร้างงานใหม่
            </Link>
          )
        }
      />

      <Card className="mb-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <SearchInput
            className="md:col-span-2"
            value={searchText}
            onChange={setSearchText}
            placeholder="ค้นหาเลขที่งาน ชื่องาน ชื่อหรือเบอร์ลูกค้า"
            label="ค้นหางาน"
          />
          {!cancelledView && (
            <div>
              <label htmlFor="filter-status" className="sr-only">
                สถานะงาน
              </label>
              <select
                id="filter-status"
                className="form-select"
                value={statusFilter}
                onChange={(e) => updateParams({ status: e.target.value, page: null })}
              >
                <option value="">ทุกสถานะ (ยกเว้นยกเลิก)</option>
                {OPEN_JOB_STATUSES.concat('completed').map((status) => (
                  <option key={status} value={status}>
                    {JOB_STATUS[status].label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="filter-type" className="sr-only">
              ประเภทงาน
            </label>
            <select
              id="filter-type"
              className="form-select"
              value={typeFilter}
              onChange={(e) => updateParams({ type: e.target.value, page: null })}
            >
              <option value="">ทุกประเภทงาน</option>
              {types.map((type) => (
                <option key={type.code} value={type.code}>
                  {type.label_th}
                  {type.is_active ? '' : ' (ปิดใช้งาน)'}
                </option>
              ))}
            </select>
          </div>
          {isAdmin && (
            <div>
              <label htmlFor="filter-assignee" className="sr-only">
                ผู้รับผิดชอบ
              </label>
              <select
                id="filter-assignee"
                className="form-select"
                value={assigneeFilter}
                onChange={(e) => updateParams({ assignee: e.target.value, page: null })}
              >
                <option value="">ผู้รับผิดชอบทั้งหมด</option>
                <option value="none">ยังไม่มอบหมาย</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.full_name || 'ไม่ระบุชื่อ'}
                    {person.is_active ? '' : ' (ปิดใช้งาน)'}
                  </option>
                ))}
              </select>
            </div>
          )}
          {isAdmin && (
            <div>
              <label htmlFor="filter-pay" className="sr-only">
                สถานะการชำระเงิน
              </label>
              <select
                id="filter-pay"
                className="form-select"
                value={payFilter}
                onChange={(e) => updateParams({ pay: e.target.value, page: null })}
              >
                <option value="">ทุกสถานะการชำระ</option>
                {Object.entries(PAYMENT_STATUS).map(([value, meta]) => (
                  <option key={value} value={value}>
                    {meta.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="filter-sort" className="sr-only">
              เรียงลำดับ
            </label>
            <select
              id="filter-sort"
              className="form-select"
              value={sortKey}
              onChange={(e) => updateParams({ sort: e.target.value, page: null })}
            >
              {Object.entries(sorts).map(([value, sort]) => (
                <option key={value} value={value}>
                  เรียง: {sort.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {hasFilters && (
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary mt-3 inline-flex items-center gap-1.5"
            onClick={resetFilters}
          >
            <RotateCcw size={14} aria-hidden="true" />
            ล้างตัวกรอง
          </button>
        )}
      </Card>

      <Card flush>
        {error && !loading ? (
          <ErrorState message={error} onRetry={() => setReloadKey((key) => key + 1)} />
        ) : loading && rows.length === 0 ? (
          <LoadingState />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={cancelledView ? Ban : ClipboardList}
            title={hasFilters ? 'ไม่พบงานตามเงื่อนไข' : cancelledView ? 'ยังไม่มีงานที่ยกเลิก' : 'ยังไม่มีงาน'}
            description={
              hasFilters
                ? 'ลองเปลี่ยนคำค้นหาหรือล้างตัวกรอง'
                : isAdmin
                  ? 'งานที่สร้างจะแสดงที่นี่'
                  : 'เมื่อผู้ดูแลมอบหมายงานให้คุณ งานจะแสดงที่นี่'
            }
            action={
              isAdmin && !cancelledView && !hasFilters ? (
                <Link to="/jobs/new" className="btn btn-primary">
                  สร้างงานแรก
                </Link>
              ) : null
            }
          />
        ) : (
          <div className={loading ? 'opacity-60 transition-opacity' : ''} aria-busy={loading}>
            <TableWrap minWidth={cancelledView ? 900 : isAdmin ? 980 : 760}>
              <table className="table table-hover align-middle">
                <thead>
                  <tr>
                    <th scope="col" className="pl-5">
                      เลขที่งาน
                    </th>
                    <th scope="col">งาน / ลูกค้า</th>
                    <th scope="col">ประเภท</th>
                    {cancelledView ? (
                      <>
                        <th scope="col">เหตุผลการยกเลิก</th>
                        <th scope="col">ยกเลิกเมื่อ</th>
                      </>
                    ) : (
                      <>
                        <th scope="col">สถานะ</th>
                        {isAdmin && <th scope="col">การชำระเงิน</th>}
                        <th scope="col">กำหนดส่ง</th>
                      </>
                    )}
                    <th scope="col" className="pr-5">
                      {cancelledView ? 'ผู้ยกเลิก' : 'ผู้รับผิดชอบ'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((job) => {
                    const finance = single(job.job_finance)
                    const overdue = OPEN_JOB_STATUSES.includes(job.status) && job.due_date && job.due_date < today
                    return (
                      <tr key={job.id} className="cursor-pointer" onClick={() => navigate(`/jobs/${job.id}`)}>
                        <td className="pl-5 font-medium whitespace-nowrap">
                          <Link to={`/jobs/${job.id}`} className="no-underline" onClick={(e) => e.stopPropagation()}>
                            {job.job_number}
                          </Link>
                        </td>
                        <td className="max-w-[320px]">
                          <div className="truncate font-medium">{job.title}</div>
                          <div className="truncate text-sm text-muted">
                            {job.customer?.name || '-'}
                            {job.customer?.phone ? ` · ${job.customer.phone}` : ''}
                          </div>
                        </td>
                        <td className="text-sm">{jobTypeLabel(job, labels)}</td>
                        {cancelledView ? (
                          <>
                            <td className="max-w-[280px] text-sm">
                              <div className="line-clamp-2">{job.cancel_reason || '-'}</div>
                            </td>
                            <td className="text-sm whitespace-nowrap">{formatDate(job.cancelled_at, true)}</td>
                          </>
                        ) : (
                          <>
                            <td>
                              <JobStatusBadge status={job.status} />
                            </td>
                            {isAdmin && (
                              <td>
                                {finance ? (
                                  <div className="flex flex-col items-start gap-0.5">
                                    <PaymentStatusBadge status={finance.payment_status} />
                                    <span className="text-xs text-muted tabular-nums">
                                      คงเหลือ {formatBaht(finance.balance_amount)}
                                    </span>
                                  </div>
                                ) : (
                                  '-'
                                )}
                              </td>
                            )}
                            <td className={`text-sm whitespace-nowrap ${overdue ? 'font-medium text-danger' : ''}`}>
                              {job.due_date ? formatDate(job.due_date) : '-'}
                              {overdue && <span className="sr-only"> (เลยกำหนด)</span>}
                            </td>
                          </>
                        )}
                        <td className="pr-5 text-sm">
                          {cancelledView
                            ? peopleMap[job.cancelled_by]?.full_name || '-'
                            : peopleMap[job.assigned_to]?.full_name || (job.assigned_to ? 'ไม่ทราบชื่อ' : 'ยังไม่มอบหมาย')}
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
              onPageChange={(next) => updateParams({ page: next > 1 ? next : null })}
            />
          </div>
        )}
      </Card>
    </>
  )
}