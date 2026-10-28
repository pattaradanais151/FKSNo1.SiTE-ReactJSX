import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Loader2, Plus, Save, UserPlus, X } from 'lucide-react'
import { getErrorMessage, supabase } from '../lib/supabase.js'
import { JOB_STATUS, todayISO, usePageTitle } from '../lib/utils.js'
import {
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  PageHeader,
  SearchInput,
  Spinner,
  fieldA11y,
  useDebouncedValue,
  useToast,
} from '../components/UI.jsx'
import {
  CUSTOMER_COLUMNS,
  CustomerFormModal,
  DEVICE_COLUMNS,
  DeviceFormModal,
  UUID_PATTERN,
  cleanDetails,
  detailsToForm,
  deviceLabel,
  getDetailFields,
  sanitizeSearch,
  useJobTypes,
  useProfileDirectory,
  validateDetails,
} from '../components/Forms.jsx'

const EDIT_COLUMNS =
  'id, job_number, job_type, other_type_name, customer_id, device_id, title, description, accessories_received, device_condition, details, received_at, appointment_at, due_date, assigned_to, status, public_status_note'

const DEVICE_FIELD_TYPES = ['general_repair', 'warranty_claim']

function emptyForm() {
  return {
    customer_id: '',
    device_id: '',
    job_type: 'general_repair',
    other_type_name: '',
    title: '',
    description: '',
    accessories_received: '',
    device_condition: '',
    received_at: todayISO(),
    appointment_at: '',
    due_date: '',
    assigned_to: '',
    public_status_note: '',
    details: {},
  }
}

// timestamptz -> ค่า datetime-local ตามเวลาไทย
function toBangkokInput(iso) {
  if (!iso) return ''
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(iso))
      .map((part) => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

function fromBangkokInput(value) {
  return value ? `${value}:00+07:00` : null
}

function jobToForm(job) {
  return {
    customer_id: job.customer_id,
    device_id: job.device_id || '',
    job_type: job.job_type,
    other_type_name: job.other_type_name || '',
    title: job.title || '',
    description: job.description || '',
    accessories_received: job.accessories_received || '',
    device_condition: job.device_condition || '',
    received_at: job.received_at || todayISO(),
    appointment_at: toBangkokInput(job.appointment_at),
    due_date: job.due_date || '',
    assigned_to: job.assigned_to || '',
    public_status_note: job.public_status_note || '',
    details: detailsToForm(job.details),
  }
}

/* ================================ เลือกลูกค้า ================================ */

function CustomerPicker({ customer, onSelect, onCreate, error }) {
  const [term, setTerm] = useState('')
  const debounced = useDebouncedValue(term, 300)
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [searchError, setSearchError] = useState('')

  useEffect(() => {
    if (customer) return undefined
    let active = true
    setLoading(true)
    let query = supabase.from('customers').select(CUSTOMER_COLUMNS).order('updated_at', { ascending: false }).limit(8)
    const clean = sanitizeSearch(debounced)
    if (clean) query = query.or(`name.ilike.%${clean}%,phone.ilike.%${clean}%,customer_code.ilike.%${clean}%`)
    query.then(({ data, error: queryError }) => {
      if (!active) return
      setLoading(false)
      if (queryError) setSearchError(getErrorMessage(queryError, 'ค้นหาลูกค้าไม่สำเร็จ'))
      else {
        setSearchError('')
        setResults(data ?? [])
      }
    })
    return () => {
      active = false
    }
  }, [debounced, customer])

  if (customer) {
    return (
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-line bg-fill p-3">
        <div className="min-w-0">
          <div className="font-semibold">{customer.name}</div>
          <div className="text-sm text-muted">
            {customer.customer_code} · {customer.phone}
            {customer.email ? ` · ${customer.email}` : ''}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary inline-flex items-center gap-1"
          onClick={() => onSelect(null)}
        >
          <X size={14} aria-hidden="true" />
          เปลี่ยนลูกค้า
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <SearchInput
          className="flex-1"
          value={term}
          onChange={setTerm}
          placeholder="ค้นหาชื่อ เบอร์โทร หรือรหัสลูกค้า"
          label="ค้นหาลูกค้า"
        />
        <button type="button" className="btn btn-outline-secondary inline-flex items-center justify-center gap-2" onClick={onCreate}>
          <UserPlus size={16} aria-hidden="true" />
          เพิ่มลูกค้าใหม่
        </button>
      </div>
      <div
        id="job-customer"
        tabIndex={-1}
        aria-invalid={error ? true : undefined}
        className={`mt-2 rounded-xl border ${error ? 'border-danger' : 'border-line'}`}
      >
        {loading ? (
          <div className="flex items-center gap-2 p-3 text-sm text-muted">
            <Spinner size={16} /> กำลังค้นหา...
          </div>
        ) : searchError ? (
          <div className="p-3 text-sm text-danger">{searchError}</div>
        ) : results.length === 0 ? (
          <div className="p-3 text-sm text-muted">ไม่พบลูกค้า กด "เพิ่มลูกค้าใหม่" เพื่อสร้างรายการ</div>
        ) : (
          <ul className="m-0 max-h-64 list-none divide-y divide-line overflow-y-auto p-0">
            {results.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-fill"
                  onClick={() => onSelect(item)}
                >
                  <span className="font-medium">{item.name}</span>
                  <span className="text-sm text-muted">
                    {item.customer_code} · {item.phone}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && <div className="mt-1 text-sm text-danger">{error}</div>}
    </div>
  )
}

/* ================================ ฟิลด์เฉพาะหมวด ================================ */

function DetailFields({ type, values, errors, onChange }) {
  const fields = getDetailFields(type)
  return (
    <div className="grid gap-x-4 md:grid-cols-2">
      {fields.map((field) => {
        const id = `detail-${field.key}`
        const value = values[field.key] ?? ''
        const error = errors?.[field.key]
        const set = (event) => onChange(field.key, event.target.value)
        return (
          <Field
            key={field.key}
            label={field.label}
            htmlFor={id}
            error={error}
            className={field.type === 'textarea' ? 'md:col-span-2' : ''}
          >
            {field.type === 'textarea' ? (
              <textarea
                className="form-control"
                rows={3}
                value={value}
                onChange={set}
                placeholder={field.placeholder}
                maxLength={5000}
                {...fieldA11y(id, error)}
              />
            ) : field.type === 'select' ? (
              <select className="form-select" value={value} onChange={set} {...fieldA11y(id, error)}>
                <option value="">- ไม่ระบุ -</option>
                {Object.entries(field.options).map(([optionValue, label]) => (
                  <option key={optionValue} value={optionValue}>
                    {label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                inputMode={field.type === 'number' ? 'numeric' : undefined}
                min={field.min}
                max={field.max}
                step={field.integer ? 1 : undefined}
                className="form-control"
                value={value}
                onChange={set}
                placeholder={field.placeholder}
                maxLength={field.type === 'text' ? 300 : undefined}
                {...fieldA11y(id, error)}
              />
            )}
          </Field>
        )
      })}
    </div>
  )
}

/* ================================ หน้า ================================ */

export default function JobForm() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  usePageTitle(isEdit ? 'แก้ไขงาน' : 'สร้างงานใหม่')
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const presetCustomerId = isEdit ? null : searchParams.get('customer')
  const toast = useToast()
  const { types, labels, error: typesError } = useJobTypes()
  const { list: people } = useProfileDirectory()

  const [form, setForm] = useState(emptyForm)
  const [original, setOriginal] = useState(null)
  const [customer, setCustomer] = useState(null)
  const [loadState, setLoadState] = useState(isEdit || presetCustomerId ? 'loading' : 'ready')
  const [loadError, setLoadError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [devices, setDevices] = useState([])
  const [devicesLoading, setDevicesLoading] = useState(false)
  const [customerModal, setCustomerModal] = useState(false)
  const [deviceModal, setDeviceModal] = useState(false)

  // โหลดงานเดิม (แก้ไข) หรือลูกค้าที่ส่งมาทาง ?customer= (สร้างใหม่)
  useEffect(() => {
    let active = true
    const run = async () => {
      try {
        if (isEdit) {
          if (!UUID_PATTERN.test(id)) {
            setLoadState('notfound')
            return
          }
          setLoadState('loading')
          const { data, error } = await supabase
            .from('jobs')
            .select(`${EDIT_COLUMNS}, customer:customers(${CUSTOMER_COLUMNS})`)
            .eq('id', id)
            .maybeSingle()
          if (error) throw error
          if (!active) return
          if (!data) {
            setLoadState('notfound')
            return
          }
          setOriginal(data)
          setCustomer(data.customer)
          setForm(jobToForm(data))
          setLoadState('ready')
        } else if (presetCustomerId) {
          if (UUID_PATTERN.test(presetCustomerId)) {
            const { data, error } = await supabase
              .from('customers')
              .select(CUSTOMER_COLUMNS)
              .eq('id', presetCustomerId)
              .maybeSingle()
            if (error) throw error
            if (active && data) {
              setCustomer(data)
              setForm((current) => ({ ...current, customer_id: data.id }))
            }
          }
          if (active) setLoadState('ready')
        }
      } catch (err) {
        if (active) {
          setLoadError(getErrorMessage(err))
          setLoadState('error')
        }
      }
    }
    run()
    return () => {
      active = false
    }
  }, [id, isEdit, presetCustomerId, reloadKey])

  // โหลดอุปกรณ์ของลูกค้าที่เลือก
  useEffect(() => {
    if (!form.customer_id) {
      setDevices([])
      return undefined
    }
    let active = true
    setDevicesLoading(true)
    supabase
      .from('devices')
      .select(DEVICE_COLUMNS)
      .eq('customer_id', form.customer_id)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!active) return
        setDevicesLoading(false)
        if (error) toast.error(getErrorMessage(error, 'โหลดรายการอุปกรณ์ไม่สำเร็จ'))
        else setDevices(data ?? [])
      })
    return () => {
      active = false
    }
  }, [form.customer_id, toast])

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  const setDetail = (key, value) => setForm((current) => ({ ...current, details: { ...current.details, [key]: value } }))

  const selectCustomer = (next) => {
    setCustomer(next)
    setForm((current) => ({ ...current, customer_id: next?.id || '', device_id: '' }))
    setErrors((current) => ({ ...current, customer_id: undefined }))
  }

  const validate = () => {
    const next = {}
    if (!form.customer_id) next.customer_id = 'กรุณาเลือกลูกค้า'
    if (!form.job_type) next.job_type = 'กรุณาเลือกประเภทงาน'
    if (form.job_type === 'other' && !form.other_type_name.trim()) next.other_type_name = 'กรุณาระบุชื่อประเภทงาน'
    if (!form.title.trim()) next.title = 'กรุณากรอกชื่องาน'
    else if (form.title.trim().length > 200) next.title = 'ชื่องานยาวเกิน 200 ตัวอักษร'
    if (!form.received_at) next.received_at = 'กรุณาระบุวันที่รับงาน'
    if (form.due_date && form.received_at && form.due_date < form.received_at) {
      next.due_date = 'กำหนดส่งต้องไม่ก่อนวันที่รับงาน'
    }
    const detailErrors = validateDetails(form.job_type, form.details)
    if (Object.keys(detailErrors).length > 0) next.details = detailErrors
    return next
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (saving) return

    const next = validate()
    setErrors(next)
    if (Object.keys(next).length > 0) {
      toast.error('กรุณาตรวจสอบข้อมูลที่ไฮไลต์')
      requestAnimationFrame(() => document.querySelector('[aria-invalid="true"]')?.focus())
      return
    }

    const payload = {
      customer_id: form.customer_id,
      device_id: form.device_id || null,
      job_type: form.job_type,
      other_type_name: form.job_type === 'other' ? form.other_type_name.trim() : null,
      title: form.title.trim(),
      description: form.description.trim() || null,
      accessories_received: form.accessories_received.trim() || null,
      device_condition: form.device_condition.trim() || null,
      details: cleanDetails(form.job_type, form.details),
      received_at: form.received_at,
      appointment_at: fromBangkokInput(form.appointment_at),
      due_date: form.due_date || null,
      assigned_to: form.assigned_to || null,
      public_status_note: form.public_status_note.trim() || null,
    }

    setSaving(true)
    const query = isEdit
      ? supabase.from('jobs').update(payload).eq('id', id)
      : supabase.from('jobs').insert(payload)
    const { data, error } = await query.select('id, job_number').single()
    setSaving(false)

    if (error) {
      toast.error(getErrorMessage(error, 'บันทึกงานไม่สำเร็จ'))
      return
    }
    toast.success(isEdit ? `บันทึกการแก้ไข ${data.job_number} แล้ว` : `สร้างงาน ${data.job_number} แล้ว`)
    navigate(`/jobs/${data.id}`, { replace: !isEdit })
  }

  const pageTitle = isEdit ? `แก้ไขงาน ${original?.job_number || ''}` : 'สร้างงานใหม่'

  if (loadState === 'loading') {
    return (
      <>
        <PageHeader title={pageTitle} />
        <LoadingState />
      </>
    )
  }
  if (loadState === 'notfound') {
    return (
      <Card>
        <EmptyState
          title="ไม่พบงานที่ต้องการแก้ไข"
          action={
            <Link to="/jobs" className="btn btn-primary">
              กลับไปรายการงาน
            </Link>
          }
        />
      </Card>
    )
  }
  if (loadState === 'error') {
    return (
      <Card>
        <ErrorState message={loadError} onRetry={() => setReloadKey((key) => key + 1)} />
      </Card>
    )
  }

  const typeOptions = types.filter((type) => type.is_active || type.code === original?.job_type)
  const assigneeOptions = people.filter((person) => person.is_active || person.id === original?.assigned_to)
  const showDeviceFields = Boolean(form.device_id) || DEVICE_FIELD_TYPES.includes(form.job_type)
  const typeName = labels[form.job_type] || form.job_type

  return (
    <>
      <PageHeader
        title={pageTitle}
        description={
          isEdit
            ? 'สถานะงานเปลี่ยนได้ที่หน้ารายละเอียดงาน ส่วนราคาจัดการในส่วนการเงิน'
            : 'เลขที่งานจะถูกสร้างอัตโนมัติเมื่อบันทึก สถานะเริ่มต้นคือ "รอตรวจสอบ"'
        }
      />

      {isEdit && original?.status === 'cancelled' && (
        <div className="alert alert-warning" role="alert">
          งานนี้อยู่ในสถานะ "{JOB_STATUS.cancelled.label}" การแก้ไขข้อมูลจะไม่เปลี่ยนสถานะงาน
        </div>
      )}
      {typesError && (
        <div className="alert alert-danger" role="alert">
          {typesError}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <Card>
          <h2 className="mt-0 mb-4 text-base font-semibold">ลูกค้าและอุปกรณ์</h2>
          <div className="mb-4">
            <div className="form-label font-medium">
              ลูกค้า <span className="text-danger" aria-hidden="true">*</span>
            </div>
            <CustomerPicker
              customer={customer}
              onSelect={selectCustomer}
              onCreate={() => setCustomerModal(true)}
              error={errors.customer_id}
            />
          </div>

          <Field
            label="อุปกรณ์ที่เกี่ยวข้อง"
            htmlFor="job-device"
            hint="ไม่บังคับ เช่น งานทำเว็บไซต์ไม่จำเป็นต้องระบุอุปกรณ์"
          >
            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                className="form-select flex-1"
                value={form.device_id}
                onChange={set('device_id')}
                disabled={!form.customer_id || devicesLoading}
                {...fieldA11y('job-device', null, true)}
              >
                <option value="">{devicesLoading ? 'กำลังโหลด...' : '- ไม่ระบุอุปกรณ์ -'}</option>
                {devices.map((device) => (
                  <option key={device.id} value={device.id}>
                    {deviceLabel(device)}
                    {device.serial_number ? ` (SN: ${device.serial_number})` : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-outline-secondary inline-flex items-center justify-center gap-2"
                onClick={() => setDeviceModal(true)}
                disabled={!form.customer_id}
              >
                <Plus size={16} aria-hidden="true" />
                เพิ่มอุปกรณ์
              </button>
            </div>
          </Field>

          {showDeviceFields && (
            <div className="grid gap-x-4 md:grid-cols-2">
              <Field label="อุปกรณ์เสริมที่รับมาด้วย" htmlFor="job-accessories">
                <textarea
                  id="job-accessories"
                  className="form-control"
                  rows={2}
                  value={form.accessories_received}
                  onChange={set('accessories_received')}
                  placeholder="เช่น สายชาร์จ, กระเป๋า, เมาส์"
                  maxLength={2000}
                />
              </Field>
              <Field label="สภาพอุปกรณ์ ณ เวลารับงาน" htmlFor="job-condition">
                <textarea
                  id="job-condition"
                  className="form-control"
                  rows={2}
                  value={form.device_condition}
                  onChange={set('device_condition')}
                  placeholder="เช่น มีรอยขีดข่วนที่ฝาหลัง, จอไม่มีรอยแตก"
                  maxLength={2000}
                />
              </Field>
            </div>
          )}
        </Card>

        <Card>
          <h2 className="mt-0 mb-4 text-base font-semibold">ข้อมูลงาน</h2>
          <div className="grid gap-x-4 md:grid-cols-2">
            <Field label="ประเภทงาน" htmlFor="job-type" error={errors.job_type} required>
              <select className="form-select" value={form.job_type} onChange={set('job_type')} {...fieldA11y('job-type', errors.job_type)}>
                {typeOptions.length === 0 && <option value={form.job_type}>{typeName}</option>}
                {typeOptions.map((type) => (
                  <option key={type.code} value={type.code}>
                    {type.label_th}
                    {type.is_active ? '' : ' (ปิดใช้งาน)'}
                  </option>
                ))}
              </select>
            </Field>
            {form.job_type === 'other' && (
              <Field label="ชื่อประเภทงาน" htmlFor="job-other-type" error={errors.other_type_name} required>
                <input
                  className="form-control"
                  value={form.other_type_name}
                  onChange={set('other_type_name')}
                  maxLength={100}
                  placeholder="เช่น ติดตั้งกล้องวงจรปิด"
                  {...fieldA11y('job-other-type', errors.other_type_name)}
                />
              </Field>
            )}
          </div>
          <Field label="ชื่องาน" htmlFor="job-title" error={errors.title} required>
            <input
              className="form-control"
              value={form.title}
              onChange={set('title')}
              maxLength={200}
              placeholder="เช่น โน้ตบุ๊กเปิดไม่ติด"
              {...fieldA11y('job-title', errors.title)}
            />
          </Field>
          <Field label="รายละเอียดปัญหา / ขอบเขตงาน" htmlFor="job-description">
            <textarea
              id="job-description"
              className="form-control"
              rows={4}
              value={form.description}
              onChange={set('description')}
              maxLength={5000}
            />
          </Field>
        </Card>

        <Card>
          <h2 className="mt-0 mb-1 text-base font-semibold">รายละเอียดเฉพาะ: {typeName}</h2>
          <p className="mt-0 mb-4 text-sm text-muted">ไม่บังคับกรอก ข้อมูลส่วนนี้พนักงานที่ได้รับมอบหมายจะเห็นด้วย</p>
          <DetailFields type={form.job_type} values={form.details} errors={errors.details} onChange={setDetail} />
        </Card>

        <Card>
          <h2 className="mt-0 mb-4 text-base font-semibold">กำหนดการและผู้รับผิดชอบ</h2>
          <div className="grid gap-x-4 md:grid-cols-2 xl:grid-cols-4">
            <Field label="วันที่รับงาน" htmlFor="job-received" error={errors.received_at} required>
              <input
                type="date"
                className="form-control"
                value={form.received_at}
                onChange={set('received_at')}
                {...fieldA11y('job-received', errors.received_at)}
              />
            </Field>
            <Field label="วันนัดหมาย (เวลาไทย)" htmlFor="job-appointment">
              <input
                id="job-appointment"
                type="datetime-local"
                className="form-control"
                value={form.appointment_at}
                onChange={set('appointment_at')}
              />
            </Field>
            <Field label="กำหนดส่ง" htmlFor="job-due" error={errors.due_date}>
              <input
                type="date"
                className="form-control"
                value={form.due_date}
                min={form.received_at || undefined}
                onChange={set('due_date')}
                {...fieldA11y('job-due', errors.due_date)}
              />
            </Field>
            <Field label="พนักงานผู้รับผิดชอบ" htmlFor="job-assignee">
              <select id="job-assignee" className="form-select" value={form.assigned_to} onChange={set('assigned_to')}>
                <option value="">- ยังไม่มอบหมาย -</option>
                {assigneeOptions.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.full_name || 'ไม่ระบุชื่อ'}
                    {person.is_active ? '' : ' (ปิดใช้งาน)'}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </Card>

        <Card>
          <h2 className="mt-0 mb-1 text-base font-semibold">ข้อความที่ลูกค้ามองเห็น</h2>
          <p className="mt-0 mb-4 text-sm text-muted">
            ข้อความนี้แยกจากบันทึกภายใน ใช้แจ้งความคืบหน้าแก่ลูกค้า ห้ามใส่ต้นทุนหรือข้อมูลภายใน
          </p>
          <Field label="ข้อความสถานะ (Public Status Note)" htmlFor="job-public-note">
            <textarea
              id="job-public-note"
              className="form-control"
              rows={2}
              value={form.public_status_note}
              onChange={set('public_status_note')}
              maxLength={1000}
              placeholder="เช่น กำลังตรวจสอบอุปกรณ์"
            />
          </Field>
        </Card>

        <div className="flex flex-wrap justify-end gap-2 pb-4">
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={() => navigate(isEdit ? `/jobs/${id}` : '/jobs')}
            disabled={saving}
          >
            ยกเลิก
          </button>
          <button type="submit" className="btn btn-primary inline-flex items-center gap-2" disabled={saving}>
            {saving ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
            {isEdit ? 'บันทึกการแก้ไข' : 'สร้างงาน'}
          </button>
        </div>
      </form>

      <CustomerFormModal
        open={customerModal}
        onClose={() => setCustomerModal(false)}
        onSaved={(created) => {
          setCustomerModal(false)
          selectCustomer(created)
        }}
      />
      <DeviceFormModal
        open={deviceModal}
        customerId={form.customer_id}
        onClose={() => setDeviceModal(false)}
        onSaved={(created) => {
          setDeviceModal(false)
          setDevices((list) => [created, ...list])
          setForm((current) => ({ ...current, device_id: created.id }))
        }}
      />
    </>
  )
}