import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ClipboardList, HardDrive, Pencil, Plus, Trash2 } from 'lucide-react'
import { getErrorMessage, supabase } from '../lib/supabase.js'
import { OPEN_JOB_STATUSES, formatDate, formatSatang, parseMoney, usePageTitle } from '../lib/utils.js'
import {
  Badge,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  JobStatusBadge,
  LoadingState,
  PageHeader,
  PaymentStatusBadge,
  TableWrap,
  useToast,
} from '../components/UI.jsx'
import {
  CUSTOMER_COLUMNS,
  CustomerFormModal,
  DEVICE_COLUMNS,
  DeviceFormModal,
  UUID_PATTERN,
  deviceLabel,
  jobTypeLabel,
  unwrap,
  useJobTypes,
} from '../components/Forms.jsx'

function single(value) {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

function InfoRow({ label, children }) {
  const empty = children === null || children === undefined || children === ''
  return (
    <div>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="m-0 mt-0.5 break-words whitespace-pre-wrap">{empty ? '-' : children}</dd>
    </div>
  )
}

export default function CustomerDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { labels } = useJobTypes()
  const [state, setState] = useState({ status: 'loading', error: '' })
  const [customer, setCustomer] = useState(null)
  const [devices, setDevices] = useState([])
  const [jobs, setJobs] = useState([])
  const [reloadKey, setReloadKey] = useState(0)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deviceModal, setDeviceModal] = useState({ open: false, device: null })
  const [deviceToDelete, setDeviceToDelete] = useState(null)
  usePageTitle(customer ? customer.name : 'รายละเอียดลูกค้า')

  const fetchDevices = useCallback(
    () =>
      supabase
        .from('devices')
        .select(DEVICE_COLUMNS)
        .eq('customer_id', id)
        .order('created_at', { ascending: false })
        .then(unwrap),
    [id],
  )

  useEffect(() => {
    if (!UUID_PATTERN.test(id)) {
      setState({ status: 'notfound', error: '' })
      return undefined
    }
    let active = true
    setState({ status: 'loading', error: '' })
    Promise.all([
      supabase.from('customers').select(CUSTOMER_COLUMNS).eq('id', id).maybeSingle().then(unwrap),
      fetchDevices(),
      supabase
        .from('jobs')
        .select(
          'id, job_number, title, job_type, other_type_name, status, received_at, device_id, job_finance(net_amount, balance_amount, payment_status)',
        )
        .eq('customer_id', id)
        .order('created_at', { ascending: false })
        .limit(100)
        .then(unwrap),
    ])
      .then(([customerData, deviceData, jobData]) => {
        if (!active) return
        if (!customerData) {
          setState({ status: 'notfound', error: '' })
          return
        }
        setCustomer(customerData)
        setDevices(deviceData ?? [])
        setJobs(jobData ?? [])
        setState({ status: 'ready', error: '' })
      })
      .catch((err) => active && setState({ status: 'error', error: getErrorMessage(err) }))
    return () => {
      active = false
    }
  }, [id, fetchDevices, reloadKey])

  const refreshDevices = async () => {
    try {
      setDevices((await fetchDevices()) ?? [])
    } catch (err) {
      toast.error(getErrorMessage(err))
    }
  }

  const deleteCustomer = async () => {
    const { error } = await supabase.from('customers').delete().eq('id', id)
    if (error) {
      toast.error(
        error.code === '23503'
          ? 'ลูกค้ารายนี้มีงานบริการอยู่ จึงลบไม่ได้ (ประวัติงานและการเงินต้องถูกเก็บไว้)'
          : getErrorMessage(error, 'ลบลูกค้าไม่สำเร็จ'),
      )
      return
    }
    toast.success('ลบข้อมูลลูกค้าแล้ว')
    navigate('/customers', { replace: true })
  }

  const deleteDevice = async () => {
    const { error } = await supabase.from('devices').delete().eq('id', deviceToDelete.id)
    if (error) {
      toast.error(
        error.code === '23503'
          ? 'อุปกรณ์นี้ถูกใช้ในงานบริการแล้ว จึงลบไม่ได้'
          : getErrorMessage(error, 'ลบอุปกรณ์ไม่สำเร็จ'),
      )
      return
    }
    toast.success('ลบอุปกรณ์แล้ว')
    setDeviceToDelete(null)
    refreshDevices()
  }

  if (state.status === 'loading') return <LoadingState />
  if (state.status === 'notfound') {
    return (
      <Card>
        <EmptyState
          title="ไม่พบลูกค้า"
          action={
            <Link to="/customers" className="btn btn-primary">
              กลับไปรายการลูกค้า
            </Link>
          }
        />
      </Card>
    )
  }
  if (state.status === 'error') {
    return (
      <Card>
        <ErrorState message={state.error} onRetry={() => setReloadKey((key) => key + 1)} />
      </Card>
    )
  }

  const openJobs = jobs.filter((job) => OPEN_JOB_STATUSES.includes(job.status)).length
  const outstandingSatang = jobs
    .filter((job) => job.status !== 'cancelled')
    .reduce((sum, job) => sum + (parseMoney(single(job.job_finance)?.balance_amount ?? 0) ?? 0), 0)
  const deviceById = Object.fromEntries(devices.map((device) => [device.id, device]))

  return (
    <>
      <PageHeader
        title={customer.name}
        description={`${customer.customer_code} · ${customer.customer_type === 'company' ? 'บริษัท / องค์กร' : 'บุคคลทั่วไป'}`}
        actions={
          <>
            <button type="button" className="btn btn-outline-secondary inline-flex items-center gap-2" onClick={() => setEditOpen(true)}>
              <Pencil size={16} aria-hidden="true" />
              แก้ไข
            </button>
            <button
              type="button"
              className="btn btn-outline-danger inline-flex items-center gap-2"
              onClick={() => setDeleteOpen(true)}
              disabled={jobs.length > 0}
              title={jobs.length > 0 ? 'ลูกค้าที่มีงานบริการลบไม่ได้' : undefined}
            >
              <Trash2 size={16} aria-hidden="true" />
              ลบ
            </button>
            <Link to={`/jobs/new?customer=${customer.id}`} className="btn btn-primary inline-flex items-center gap-2">
              <Plus size={16} aria-hidden="true" />
              สร้างงานให้ลูกค้านี้
            </Link>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <div className="text-sm text-muted">งานทั้งหมด</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{jobs.length}</div>
        </Card>
        <Card>
          <div className="text-sm text-muted">งานที่ยังไม่ปิด</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{openJobs}</div>
        </Card>
        <Card>
          <div className="text-sm text-muted">ยอดค้างชำระ (ไม่รวมงานที่ยกเลิก)</div>
          <div className={`mt-1 text-2xl font-semibold tabular-nums ${outstandingSatang > 0 ? 'text-warning' : ''}`}>
            {formatSatang(outstandingSatang)}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <h2 className="mt-0 mb-4 text-base font-semibold">ข้อมูลติดต่อ</h2>
          <dl className="m-0 space-y-3">
            <InfoRow label="เบอร์โทรศัพท์">
              <a href={`tel:${customer.phone.replace(/[^0-9+]/g, '')}`}>{customer.phone}</a>
            </InfoRow>
            <InfoRow label="อีเมล">{customer.email && <a href={`mailto:${customer.email}`}>{customer.email}</a>}</InfoRow>
            <InfoRow label="ที่อยู่">{customer.address}</InfoRow>
            <InfoRow label="หมายเหตุทั่วไป">{customer.notes}</InfoRow>
            <InfoRow label="สร้างเมื่อ">{formatDate(customer.created_at, true)}</InfoRow>
            <InfoRow label="แก้ไขล่าสุด">{formatDate(customer.updated_at, true)}</InfoRow>
          </dl>
        </Card>

        <Card className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="m-0 inline-flex items-center gap-2 text-base font-semibold">
              <HardDrive size={17} className="text-muted" aria-hidden="true" />
              อุปกรณ์ ({devices.length})
            </h2>
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary inline-flex items-center gap-1.5"
              onClick={() => setDeviceModal({ open: true, device: null })}
            >
              <Plus size={15} aria-hidden="true" />
              เพิ่มอุปกรณ์
            </button>
          </div>
          {devices.length === 0 ? (
            <p className="m-0 text-sm text-muted">ยังไม่มีอุปกรณ์ที่บันทึกไว้</p>
          ) : (
            <ul className="m-0 list-none divide-y divide-line p-0">
              {devices.map((device) => (
                <li key={device.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <div className="font-medium">{deviceLabel(device)}</div>
                    <div className="text-sm text-muted">
                      {[device.serial_number && `SN: ${device.serial_number}`, device.imei && `IMEI: ${device.imei}`]
                        .filter(Boolean)
                        .join(' · ') || 'ไม่มี Serial / IMEI'}
                    </div>
                    {device.notes && <div className="text-sm whitespace-pre-wrap">{device.notes}</div>}
                  </div>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-secondary"
                      onClick={() => setDeviceModal({ open: true, device })}
                      aria-label={`แก้ไข ${deviceLabel(device)}`}
                    >
                      <Pencil size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-danger"
                      onClick={() => setDeviceToDelete(device)}
                      aria-label={`ลบ ${deviceLabel(device)}`}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card flush className="lg:col-span-3">
          <h2 className="m-0 inline-flex items-center gap-2 px-5 pt-5 pb-3 text-base font-semibold">
            <ClipboardList size={17} className="text-muted" aria-hidden="true" />
            งานบริการของลูกค้า
          </h2>
          {jobs.length === 0 ? (
            <EmptyState
              title="ยังไม่มีงานบริการ"
              action={
                <Link to={`/jobs/new?customer=${customer.id}`} className="btn btn-primary">
                  สร้างงานแรก
                </Link>
              }
            />
          ) : (
            <TableWrap minWidth={820}>
              <table className="table table-hover align-middle">
                <thead>
                  <tr>
                    <th scope="col" className="pl-5">
                      เลขที่งาน
                    </th>
                    <th scope="col">ชื่องาน</th>
                    <th scope="col">ประเภท</th>
                    <th scope="col">อุปกรณ์</th>
                    <th scope="col">สถานะ</th>
                    <th scope="col" className="pr-5">
                      การชำระเงิน
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => {
                    const finance = single(job.job_finance)
                    return (
                      <tr key={job.id} className="cursor-pointer" onClick={() => navigate(`/jobs/${job.id}`)}>
                        <td className="pl-5 whitespace-nowrap">
                          <Link to={`/jobs/${job.id}`} className="no-underline" onClick={(e) => e.stopPropagation()}>
                            {job.job_number}
                          </Link>
                          <div className="text-xs text-muted">{formatDate(job.received_at)}</div>
                        </td>
                        <td className="max-w-[260px] truncate">{job.title}</td>
                        <td className="text-sm">{jobTypeLabel(job, labels)}</td>
                        <td className="text-sm">{job.device_id ? deviceLabel(deviceById[job.device_id]) : '-'}</td>
                        <td>
                          <JobStatusBadge status={job.status} />
                        </td>
                        <td className="pr-5">
                          {finance ? (
                            <div className="flex flex-col items-start gap-0.5">
                              <PaymentStatusBadge status={finance.payment_status} />
                              <span className="text-xs text-muted tabular-nums">
                                คงเหลือ {formatSatang(parseMoney(finance.balance_amount) ?? 0)}
                              </span>
                            </div>
                          ) : (
                            <Badge>-</Badge>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      </div>

      <CustomerFormModal
        open={editOpen}
        customer={customer}
        onClose={() => setEditOpen(false)}
        onSaved={(saved) => {
          setEditOpen(false)
          setCustomer(saved)
        }}
      />
      <DeviceFormModal
        open={deviceModal.open}
        customerId={customer.id}
        device={deviceModal.device}
        onClose={() => setDeviceModal({ open: false, device: null })}
        onSaved={() => {
          setDeviceModal({ open: false, device: null })
          refreshDevices()
        }}
      />
      <ConfirmDialog
        open={deleteOpen}
        title="ลบลูกค้า"
        message={`ต้องการลบ "${customer.name}" และอุปกรณ์ทั้งหมดของลูกค้ารายนี้หรือไม่ การลบไม่สามารถย้อนกลับได้`}
        confirmLabel="ลบลูกค้า"
        onConfirm={deleteCustomer}
        onCancel={() => setDeleteOpen(false)}
      />
      <ConfirmDialog
        open={Boolean(deviceToDelete)}
        title="ลบอุปกรณ์"
        message={deviceToDelete ? `ต้องการลบ "${deviceLabel(deviceToDelete)}" หรือไม่` : ''}
        confirmLabel="ลบอุปกรณ์"
        onConfirm={deleteDevice}
        onCancel={() => setDeviceToDelete(null)}
      />
    </>
  )
}