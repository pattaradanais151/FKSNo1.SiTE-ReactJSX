import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { UserPlus, Users } from 'lucide-react'
import { getErrorMessage, supabase } from '../lib/supabase.js'
import { formatDate, usePageTitle } from '../lib/utils.js'
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Pagination,
  SearchInput,
  TableWrap,
  useDebouncedValue,
} from '../components/UI.jsx'
import { CustomerFormModal, sanitizeSearch } from '../components/Forms.jsx'

const PAGE_SIZE = 20
const SORTS = {
  updated_desc: { column: 'updated_at', ascending: false, label: 'แก้ไขล่าสุด' },
  created_desc: { column: 'created_at', ascending: false, label: 'เพิ่มล่าสุด' },
  name_asc: { column: 'name', ascending: true, label: 'ชื่อ (ก–ฮ, A–Z)' },
  code_asc: { column: 'customer_code', ascending: true, label: 'รหัสลูกค้า' },
}

export default function Customers() {
  usePageTitle('ลูกค้า')
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const q = params.get('q') || ''
  const sortParam = params.get('sort')
  const sortKey = sortParam && SORTS[sortParam] ? sortParam : 'updated_desc'
  const page = Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1)

  const [searchText, setSearchText] = useState(q)
  const debouncedSearch = useDebouncedValue(searchText, 350)
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [createOpen, setCreateOpen] = useState(false)

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
        let query = supabase
          .from('customers')
          .select('id, customer_code, customer_type, name, phone, email, updated_at, jobs(count)', { count: 'exact' })
        const term = sanitizeSearch(q)
        if (term) {
          query = query.or(
            `name.ilike.%${term}%,phone.ilike.%${term}%,customer_code.ilike.%${term}%,email.ilike.%${term}%`,
          )
        }
        const sort = SORTS[sortKey]
        const from = (page - 1) * PAGE_SIZE
        const { data, count, error: queryError } = await query
          .order(sort.column, { ascending: sort.ascending })
          .order('id')
          .range(from, from + PAGE_SIZE - 1)
        if (!active) return
        if (queryError) {
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
  }, [q, sortKey, page, reloadKey, updateParams])

  return (
    <>
      <PageHeader
        title="ลูกค้า"
        description="ข้อมูลลูกค้า อุปกรณ์ และประวัติงานบริการ"
        actions={
          <button type="button" className="btn btn-primary inline-flex items-center gap-2" onClick={() => setCreateOpen(true)}>
            <UserPlus size={16} aria-hidden="true" />
            เพิ่มลูกค้า
          </button>
        }
      />

      <Card className="mb-4">
        <div className="grid gap-3 md:grid-cols-3">
          <SearchInput
            className="md:col-span-2"
            value={searchText}
            onChange={setSearchText}
            placeholder="ค้นหาชื่อ เบอร์โทร อีเมล หรือรหัสลูกค้า"
            label="ค้นหาลูกค้า"
          />
          <div>
            <label htmlFor="customer-sort" className="sr-only">
              เรียงลำดับ
            </label>
            <select
              id="customer-sort"
              className="form-select"
              value={sortKey}
              onChange={(e) => updateParams({ sort: e.target.value, page: null })}
            >
              {Object.entries(SORTS).map(([value, sort]) => (
                <option key={value} value={value}>
                  เรียง: {sort.label}
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
          <EmptyState
            icon={Users}
            title={q ? 'ไม่พบลูกค้าตามคำค้นหา' : 'ยังไม่มีลูกค้า'}
            description={q ? 'ลองเปลี่ยนคำค้นหา' : 'เพิ่มลูกค้ารายแรกเพื่อเริ่มเปิดงานบริการ'}
            action={
              !q && (
                <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
                  เพิ่มลูกค้า
                </button>
              )
            }
          />
        ) : (
          <div className={loading ? 'opacity-60 transition-opacity' : ''} aria-busy={loading}>
            <TableWrap minWidth={760}>
              <table className="table table-hover align-middle">
                <thead>
                  <tr>
                    <th scope="col" className="pl-5">
                      รหัส
                    </th>
                    <th scope="col">ชื่อ</th>
                    <th scope="col">เบอร์โทรศัพท์</th>
                    <th scope="col">อีเมล</th>
                    <th scope="col" className="text-right">
                      จำนวนงาน
                    </th>
                    <th scope="col" className="pr-5">
                      แก้ไขล่าสุด
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((customer) => (
                    <tr key={customer.id} className="cursor-pointer" onClick={() => navigate(`/customers/${customer.id}`)}>
                      <td className="pl-5 whitespace-nowrap">
                        <Link to={`/customers/${customer.id}`} className="no-underline" onClick={(e) => e.stopPropagation()}>
                          {customer.customer_code}
                        </Link>
                      </td>
                      <td className="max-w-[280px]">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium">{customer.name}</span>
                          {customer.customer_type === 'company' && <Badge tone="primary">บริษัท</Badge>}
                        </div>
                      </td>
                      <td className="whitespace-nowrap">{customer.phone}</td>
                      <td className="max-w-[220px] truncate text-sm">{customer.email || '-'}</td>
                      <td className="text-right tabular-nums">{customer.jobs?.[0]?.count ?? 0}</td>
                      <td className="pr-5 text-sm whitespace-nowrap">{formatDate(customer.updated_at)}</td>
                    </tr>
                  ))}
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

      <CustomerFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={(created) => {
          setCreateOpen(false)
          navigate(`/customers/${created.id}`)
        }}
      />
    </>
  )
}