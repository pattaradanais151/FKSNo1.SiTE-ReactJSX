import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { getErrorMessage, supabase } from '../lib/supabase.js'
import { DEVICE_TYPES, JOB_STATUS, JOB_TYPES, formatDate } from '../lib/utils.js'
import { Field, Modal, fieldA11y, useToast } from './UI.jsx'

/* ================================ ค่าคงที่และตัวช่วย ================================ */

export const CUSTOMER_COLUMNS =
  'id, customer_code, customer_type, name, phone, email, address, notes, created_at, updated_at'
export const DEVICE_COLUMNS =
  'id, customer_id, device_type, brand, model, serial_number, imei, notes, created_at, updated_at'

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PHONE_PATTERN = /^[0-9+() -]{6,25}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const IMEI_PATTERN = /^[0-9]{14,16}$/

// แปลงผลลัพธ์ Supabase: โยน error หรือคืน data
export function unwrap(result) {
  if (result.error) throw result.error
  return result.data
}

// ตัดอักขระที่มีความหมายพิเศษในตัวกรอง or() ของ PostgREST
export function sanitizeSearch(value) {
  return String(value || '')
    .replace(/[%,()*\\"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
}

export function deviceLabel(device) {
  if (!device) return '-'
  const name = [device.brand, device.model].filter(Boolean).join(' ')
  return `${DEVICE_TYPES[device.device_type] ?? device.device_type} · ${name || 'ไม่ระบุรุ่น'}`
}

export function jobTypeLabel(job, labels = JOB_TYPES) {
  const base = labels[job.job_type] ?? JOB_TYPES[job.job_type] ?? job.job_type
  return job.job_type === 'other' && job.other_type_name ? `${base}: ${job.other_type_name}` : base
}

/* ================================ ฟิลด์เฉพาะหมวดงาน (jobs.details) ================================ */
// หมายเหตุ: Staff ที่ได้รับมอบหมายเห็น details ทั้งหมด จึงไม่เก็บตัวเลขการเงิน (เช่น งบประมาณ) ไว้ที่นี่

export const CLAIM_RESULTS = {
  pending: 'รอผลการเคลม',
  repaired: 'ซ่อมให้ตามประกัน',
  replaced: 'เปลี่ยนสินค้าใหม่',
  rejected: 'ปฏิเสธการเคลม',
  returned: 'ส่งคืนโดยไม่ดำเนินการ',
}

export const CONNECTION_TYPES = {
  fiber: 'Fiber (FTTx)',
  vdsl: 'VDSL / ADSL',
  mobile: '4G / 5G',
  leased_line: 'Leased Line',
  wireless: 'Wireless / Point-to-Point',
  other: 'อื่น ๆ',
}

export const JOB_DETAIL_FIELDS = {
  general_repair: [
    { key: 'inspection_result', label: 'ผลการตรวจสอบ', type: 'textarea' },
    { key: 'root_cause', label: 'สาเหตุของปัญหา', type: 'textarea' },
    { key: 'solution', label: 'วิธีแก้ไข', type: 'textarea' },
    { key: 'parts_replaced', label: 'อะไหล่ที่เปลี่ยน / อัปเกรด', type: 'textarea' },
    { key: 'maintenance_notes', label: 'การบำรุงรักษาที่ทำ', type: 'textarea' },
  ],
  warranty_claim: [
    { key: 'purchase_date', label: 'วันที่ซื้อสินค้า', type: 'date' },
    { key: 'warranty_expiry', label: 'วันหมดประกัน', type: 'date' },
    { key: 'warranty_info', label: 'ข้อมูลการรับประกัน', type: 'text', placeholder: 'เช่น ประกันศูนย์ 3 ปี, เลขที่ใบเสร็จ' },
    { key: 'vendor', label: 'ผู้จำหน่าย / ศูนย์บริการ', type: 'text' },
    { key: 'claim_number', label: 'หมายเลขเคลม', type: 'text' },
    { key: 'claim_sent_date', label: 'วันที่ส่งเคลม', type: 'date' },
    { key: 'claim_returned_date', label: 'วันที่ได้รับคืน', type: 'date' },
    { key: 'claim_result', label: 'ผลการเคลม', type: 'select', options: CLAIM_RESULTS },
    { key: 'claim_notes', label: 'รายละเอียดผลการเคลม', type: 'textarea' },
  ],
  website: [
    { key: 'project_name', label: 'ชื่อโปรเจกต์', type: 'text' },
    { key: 'scope', label: 'ขอบเขตงาน', type: 'textarea' },
    { key: 'page_count', label: 'จำนวนหน้า', type: 'number', min: 0, max: 1000, integer: true, unit: 'หน้า' },
    { key: 'requirements', label: 'รายละเอียดความต้องการ', type: 'textarea' },
    { key: 'domain', label: 'Domain', type: 'text', placeholder: 'example.com' },
    { key: 'hosting', label: 'Hosting', type: 'text' },
    { key: 'related_systems', label: 'ระบบที่เกี่ยวข้อง', type: 'textarea', placeholder: 'เช่น CMS, ระบบชำระเงิน, อีเมล' },
    { key: 'start_date', label: 'วันเริ่มงาน', type: 'date' },
    { key: 'duration', label: 'ระยะเวลาดำเนินงาน', type: 'text', placeholder: 'เช่น 6 สัปดาห์' },
    { key: 'progress_percent', label: 'ความคืบหน้า', type: 'number', min: 0, max: 100, integer: true, unit: '%' },
    { key: 'delivered_date', label: 'วันที่ส่งมอบ', type: 'date' },
    { key: 'delivery_notes', label: 'รายละเอียดการส่งมอบ', type: 'textarea' },
  ],
  network: [
    { key: 'isp', label: 'ผู้ให้บริการอินเทอร์เน็ต (ISP)', type: 'text' },
    { key: 'connection_type', label: 'ประเภทการเชื่อมต่อ', type: 'select', options: CONNECTION_TYPES },
    { key: 'package_speed', label: 'แพ็กเกจ / ความเร็ว', type: 'text' },
    { key: 'equipment', label: 'อุปกรณ์ที่ติดตั้ง / เกี่ยวข้อง', type: 'textarea', placeholder: 'Router, Access Point, Switch ...' },
    { key: 'site_address', label: 'สถานที่ติดตั้ง', type: 'textarea' },
    { key: 'site_contact', label: 'ผู้ติดต่อหน้างาน', type: 'text' },
    { key: 'visit_details', label: 'รายละเอียดการเข้าดำเนินงาน', type: 'textarea' },
  ],
  other: [{ key: 'additional_details', label: 'รายละเอียดเพิ่มเติม', type: 'textarea' }],
}

// ประเภทงานใหม่ที่เพิ่มในตาราง job_types ภายหลังจะใช้ฟิลด์ของ "other"
export function getDetailFields(type) {
  return JOB_DETAIL_FIELDS[type] ?? JOB_DETAIL_FIELDS.other
}

export function detailsToForm(details) {
  return Object.fromEntries(
    Object.entries(details || {}).map(([key, value]) => [key, value === null || value === undefined ? '' : String(value)]),
  )
}

export function validateDetails(type, values) {
  const errors = {}
  for (const field of getDetailFields(type)) {
    const text = String(values?.[field.key] ?? '').trim()
    if (!text) continue
    if (field.type === 'number') {
      const n = Number(text)
      const invalid =
        !Number.isFinite(n) ||
        (field.integer && !Number.isInteger(n)) ||
        (field.min !== undefined && n < field.min) ||
        (field.max !== undefined && n > field.max)
      if (invalid) errors[field.key] = `กรุณากรอกจำนวนเต็มระหว่าง ${field.min} ถึง ${field.max}`
    } else if (field.type === 'select' && !field.options[text]) {
      errors[field.key] = 'ตัวเลือกไม่ถูกต้อง'
    } else if (text.length > 5000) {
      errors[field.key] = 'ข้อความยาวเกิน 5,000 ตัวอักษร'
    }
  }
  return errors
}

// เก็บเฉพาะฟิลด์ของประเภทงานนั้นที่มีค่า
export function cleanDetails(type, values) {
  const result = {}
  for (const field of getDetailFields(type)) {
    const text = String(values?.[field.key] ?? '').trim()
    if (!text) continue
    result[field.key] = field.type === 'number' ? Number(text) : text
  }
  return result
}

export function formatDetailValue(field, value) {
  if (value === undefined || value === null || value === '') return null
  if (field.type === 'select') return field.options[value] ?? String(value)
  if (field.type === 'date') return formatDate(value)
  if (field.unit) return `${value} ${field.unit}`
  return String(value)
}

/* ================================ ประวัติงาน ================================ */

export function describeJobUpdate(update) {
  const label = (status) => JOB_STATUS[status]?.label ?? status ?? '-'
  switch (update.update_type) {
    case 'status_change':
      if (!update.from_status) return { title: 'สร้างงาน', body: update.message }
      return { title: `เปลี่ยนสถานะ: ${label(update.from_status)} → ${label(update.to_status)}`, body: update.message }
    case 'progress':
      return { title: 'บันทึกความคืบหน้า', body: update.message }
    case 'public_note':
      return { title: 'อัปเดตข้อความถึงลูกค้า', body: update.message }
    case 'assignment':
      return { title: 'การมอบหมายงาน', body: update.message }
    default:
      return { title: update.update_type, body: update.message }
  }
}

/* ================================ Hooks: ประเภทงาน / รายชื่อพนักงาน ================================ */

let jobTypesPromise = null

function fetchJobTypes() {
  if (!jobTypesPromise) {
    jobTypesPromise = supabase
      .from('job_types')
      .select('code, label_th, label_en, is_active, sort_order')
      .order('sort_order')
      .then((result) => {
        if (result.error) {
          jobTypesPromise = null
          throw result.error
        }
        return result.data ?? []
      })
  }
  return jobTypesPromise
}

export function useJobTypes() {
  const [types, setTypes] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    fetchJobTypes()
      .then((data) => active && setTypes(data))
      .catch((err) => active && setError(getErrorMessage(err, 'โหลดประเภทงานไม่สำเร็จ')))
    return () => {
      active = false
    }
  }, [])

  const labels = useMemo(
    () => ({ ...JOB_TYPES, ...Object.fromEntries(types.map((type) => [type.code, type.label_th])) }),
    [types],
  )
  return { types, labels, error }
}

const DIRECTORY_TTL_MS = 5 * 60 * 1000
let directoryCache = { promise: null, at: 0 }

function fetchDirectory() {
  if (!directoryCache.promise || Date.now() - directoryCache.at > DIRECTORY_TTL_MS) {
    const promise = supabase.rpc('profile_directory').then((result) => {
      if (result.error) {
        if (directoryCache.promise === promise) directoryCache = { promise: null, at: 0 }
        throw result.error
      }
      return (result.data ?? []).sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '', 'th'))
    })
    directoryCache = { promise, at: Date.now() }
  }
  return directoryCache.promise
}

// เรียกหลังเพิ่ม/แก้ไขพนักงาน (Phase 6)
export function invalidateProfileDirectory() {
  directoryCache = { promise: null, at: 0 }
}

export function useProfileDirectory() {
  const [list, setList] = useState([])

  useEffect(() => {
    let active = true
    fetchDirectory()
      .then((data) => active && setList(data))
      .catch(() => {
        // รายชื่อพนักงานเป็นข้อมูลประกอบ หากโหลดไม่ได้จะแสดงเป็น "ไม่ทราบชื่อ"
      })
    return () => {
      active = false
    }
  }, [])

  const map = useMemo(() => Object.fromEntries(list.map((person) => [person.id, person])), [list])
  return { list, map }
}

/* ================================ ฟอร์มลูกค้า ================================ */

const EMPTY_CUSTOMER = { customer_type: 'individual', name: '', phone: '', email: '', address: '', notes: '' }

export function CustomerFormModal({ open, customer = null, onClose, onSaved }) {
  const toast = useToast()
  const [form, setForm] = useState(EMPTY_CUSTOMER)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setErrors({})
    setForm(
      customer
        ? {
            customer_type: customer.customer_type || 'individual',
            name: customer.name || '',
            phone: customer.phone || '',
            email: customer.email || '',
            address: customer.address || '',
            notes: customer.notes || '',
          }
        : EMPTY_CUSTOMER,
    )
  }, [open, customer])

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (saving) return

    const name = form.name.trim()
    const phone = form.phone.trim()
    const email = form.email.trim()
    const next = {}
    if (!name) next.name = 'กรุณากรอกชื่อลูกค้าหรือชื่อบริษัท'
    else if (name.length > 200) next.name = 'ชื่อยาวเกิน 200 ตัวอักษร'
    if (!phone) next.phone = 'กรุณากรอกเบอร์โทรศัพท์'
    else if (!PHONE_PATTERN.test(phone)) next.phone = 'เบอร์โทรศัพท์ใช้ได้เฉพาะตัวเลข เว้นวรรค + - ( ) ยาว 6–25 ตัว'
    if (email && !EMAIL_PATTERN.test(email)) next.email = 'รูปแบบอีเมลไม่ถูกต้อง'
    setErrors(next)
    if (Object.keys(next).length > 0) return

    const payload = {
      customer_type: form.customer_type,
      name,
      phone,
      email: email || null,
      address: form.address.trim() || null,
      notes: form.notes.trim() || null,
    }

    setSaving(true)
    const query = customer
      ? supabase.from('customers').update(payload).eq('id', customer.id)
      : supabase.from('customers').insert(payload)
    const { data, error } = await query.select(CUSTOMER_COLUMNS).single()
    setSaving(false)

    if (error) {
      toast.error(getErrorMessage(error, 'บันทึกข้อมูลลูกค้าไม่สำเร็จ'))
      return
    }
    toast.success(customer ? 'บันทึกการแก้ไขข้อมูลลูกค้าแล้ว' : `เพิ่มลูกค้า ${data.customer_code} แล้ว`)
    onSaved?.(data)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={saving}
      size="lg"
      title={customer ? 'แก้ไขข้อมูลลูกค้า' : 'เพิ่มลูกค้าใหม่'}
      description="ช่องที่มีเครื่องหมาย * จำเป็นต้องกรอก"
      footer={
        <>
          <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>
            ยกเลิก
          </button>
          <button type="submit" form="customer-form" className="btn btn-primary inline-flex items-center gap-2" disabled={saving}>
            {saving && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
            บันทึก
          </button>
        </>
      }
    >
      <form id="customer-form" onSubmit={handleSubmit} noValidate>
        <div className="grid gap-x-4 md:grid-cols-2">
          <Field label="ประเภทลูกค้า" htmlFor="cust-type">
            <select id="cust-type" className="form-select" value={form.customer_type} onChange={set('customer_type')}>
              <option value="individual">บุคคลทั่วไป</option>
              <option value="company">บริษัท / องค์กร</option>
            </select>
          </Field>
          <Field
            label={form.customer_type === 'company' ? 'ชื่อบริษัท' : 'ชื่อ-นามสกุล'}
            htmlFor="cust-name"
            error={errors.name}
            required
          >
            <input
              className="form-control"
              value={form.name}
              onChange={set('name')}
              maxLength={200}
              autoComplete="off"
              data-autofocus
              {...fieldA11y('cust-name', errors.name)}
            />
          </Field>
          <Field label="เบอร์โทรศัพท์" htmlFor="cust-phone" error={errors.phone} required>
            <input
              type="tel"
              inputMode="tel"
              className="form-control"
              value={form.phone}
              onChange={set('phone')}
              maxLength={25}
              autoComplete="off"
              {...fieldA11y('cust-phone', errors.phone)}
            />
          </Field>
          <Field label="อีเมล" htmlFor="cust-email" error={errors.email}>
            <input
              type="email"
              inputMode="email"
              className="form-control"
              value={form.email}
              onChange={set('email')}
              maxLength={200}
              autoComplete="off"
              {...fieldA11y('cust-email', errors.email)}
            />
          </Field>
        </div>
        <Field label="ที่อยู่" htmlFor="cust-address">
          <textarea id="cust-address" className="form-control" rows={2} value={form.address} onChange={set('address')} maxLength={1000} />
        </Field>
        <Field
          label="หมายเหตุทั่วไป"
          htmlFor="cust-notes"
          hint="พนักงานที่ได้รับมอบหมายงานของลูกค้ารายนี้จะเห็นหมายเหตุนี้ด้วย ห้ามใส่ข้อมูลลับ"
        >
          <textarea
            className="form-control"
            rows={2}
            value={form.notes}
            onChange={set('notes')}
            maxLength={2000}
            {...fieldA11y('cust-notes', null, true)}
          />
        </Field>
      </form>
    </Modal>
  )
}

/* ================================ ฟอร์มอุปกรณ์ ================================ */

const EMPTY_DEVICE = { device_type: 'laptop', brand: '', model: '', serial_number: '', imei: '', notes: '' }
const IMEI_TYPES = ['mobile', 'tablet']

export function DeviceFormModal({ open, customerId, device = null, onClose, onSaved }) {
  const toast = useToast()
  const [form, setForm] = useState(EMPTY_DEVICE)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setErrors({})
    setForm(
      device
        ? {
            device_type: device.device_type,
            brand: device.brand || '',
            model: device.model || '',
            serial_number: device.serial_number || '',
            imei: device.imei || '',
            notes: device.notes || '',
          }
        : EMPTY_DEVICE,
    )
  }, [open, device])

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  const showImei = IMEI_TYPES.includes(form.device_type)

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (saving) return

    const imei = showImei ? form.imei.replace(/\s/g, '') : ''
    const next = {}
    if (!DEVICE_TYPES[form.device_type]) next.device_type = 'กรุณาเลือกประเภทอุปกรณ์'
    if (imei && !IMEI_PATTERN.test(imei)) next.imei = 'IMEI ต้องเป็นตัวเลข 14–16 หลัก'
    if (!device && !customerId) next.device_type = 'ไม่พบลูกค้าที่จะผูกอุปกรณ์'
    setErrors(next)
    if (Object.keys(next).length > 0) return

    const payload = {
      device_type: form.device_type,
      brand: form.brand.trim() || null,
      model: form.model.trim() || null,
      serial_number: form.serial_number.trim() || null,
      imei: imei || null,
      notes: form.notes.trim() || null,
    }

    setSaving(true)
    const query = device
      ? supabase.from('devices').update(payload).eq('id', device.id)
      : supabase.from('devices').insert({ ...payload, customer_id: customerId })
    const { data, error } = await query.select(DEVICE_COLUMNS).single()
    setSaving(false)

    if (error) {
      toast.error(getErrorMessage(error, 'บันทึกข้อมูลอุปกรณ์ไม่สำเร็จ'))
      return
    }
    toast.success(device ? 'บันทึกการแก้ไขอุปกรณ์แล้ว' : 'เพิ่มอุปกรณ์แล้ว')
    onSaved?.(data)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={saving}
      title={device ? 'แก้ไขอุปกรณ์' : 'เพิ่มอุปกรณ์'}
      footer={
        <>
          <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>
            ยกเลิก
          </button>
          <button type="submit" form="device-form" className="btn btn-primary inline-flex items-center gap-2" disabled={saving}>
            {saving && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
            บันทึก
          </button>
        </>
      }
    >
      <form id="device-form" onSubmit={handleSubmit} noValidate>
        <Field label="ประเภทอุปกรณ์" htmlFor="dev-type" error={errors.device_type} required>
          <select
            className="form-select"
            value={form.device_type}
            onChange={set('device_type')}
            {...fieldA11y('dev-type', errors.device_type)}
          >
            {Object.entries(DEVICE_TYPES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid gap-x-4 md:grid-cols-2">
          <Field label="ยี่ห้อ" htmlFor="dev-brand">
            <input id="dev-brand" className="form-control" value={form.brand} onChange={set('brand')} maxLength={100} />
          </Field>
          <Field label="รุ่น" htmlFor="dev-model">
            <input id="dev-model" className="form-control" value={form.model} onChange={set('model')} maxLength={150} />
          </Field>
          <Field label="Serial Number" htmlFor="dev-serial">
            <input
              id="dev-serial"
              className="form-control"
              value={form.serial_number}
              onChange={set('serial_number')}
              maxLength={100}
              autoComplete="off"
            />
          </Field>
          {showImei && (
            <Field label="IMEI" htmlFor="dev-imei" error={errors.imei}>
              <input
                inputMode="numeric"
                className="form-control"
                value={form.imei}
                onChange={set('imei')}
                maxLength={20}
                autoComplete="off"
                {...fieldA11y('dev-imei', errors.imei)}
              />
            </Field>
          )}
        </div>
        <Field label="หมายเหตุ" htmlFor="dev-notes">
          <textarea id="dev-notes" className="form-control" rows={2} value={form.notes} onChange={set('notes')} maxLength={2000} />
        </Field>
      </form>
    </Modal>
  )
}