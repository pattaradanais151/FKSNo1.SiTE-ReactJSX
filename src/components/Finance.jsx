import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  Ban,
  CalendarClock,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Receipt,
  RotateCcw,
  Trash2,
  Undo2,
  Wallet,
} from 'lucide-react'
import { useAuth } from '../lib/auth.jsx'
import { getErrorMessage, supabase } from '../lib/supabase.js'
import {
  DEFAULT_INTEREST_MODE,
  DEFAULT_INTEREST_RATE_PERCENT,
  INTEREST_MODES,
  PAYMENT_METHODS,
  addMonthsISO,
  calcInstallmentPlan,
  formatDate,
  formatSatang,
  parseMoney,
  satangToDecimalString,
  todayISO,
} from '../lib/utils.js'
import {
  Badge,
  Card,
  ConfirmDialog,
  ErrorState,
  Field,
  Modal,
  PaymentStatusBadge,
  Spinner,
  TableWrap,
  fieldA11y,
  useToast,
} from './UI.jsx'
import { unwrap, useProfileDirectory } from './Forms.jsx'

/* ================================ ค่าคงที่ ================================ */

export const COST_ITEM_TYPES = {
  service: 'ค่าบริการ',
  part: 'ค่าอะไหล่',
  other: 'ค่าเดินทาง / ค่าใช้จ่ายอื่น',
}

export const PLAN_STATUS = {
  active: { label: 'กำลังผ่อน', tone: 'info' },
  completed: { label: 'ผ่อนครบแล้ว', tone: 'success' },
  cancelled: { label: 'ยกเลิกแผน', tone: 'danger' },
}

export const INSTALLMENT_ITEM_STATUS = {
  pending: { label: 'ยังไม่ชำระ', tone: 'neutral' },
  partial: { label: 'ชำระบางส่วน', tone: 'warning' },
  paid: { label: 'ชำระแล้ว', tone: 'success' },
}

export const PAYMENT_KIND = {
  payment: { label: 'รับชำระ', tone: 'success' },
  refund: { label: 'คืนเงิน', tone: 'danger' },
}

export const FINANCE_COLUMNS =
  'job_id, service_fee, parts_fee, other_fee, gross_amount, discount, net_amount, interest_amount, payable_amount, paid_amount, balance_amount, payment_status, updated_at'
export const COST_ITEM_COLUMNS =
  'id, job_id, item_type, description, quantity, unit_price, line_total, created_by, created_at, updated_at'
export const PAYMENT_COLUMNS =
  'id, job_id, installment_item_id, kind, amount, paid_at, method, reference_no, note, recorded_by, voided_at, voided_by, void_reason, created_at'
export const PLAN_COLUMNS =
  'id, job_id, status, principal_amount, interest_mode, interest_rate_percent, installment_count, interval_months, interest_amount, total_amount, first_due_date, note, created_by, created_at, cancelled_at, cancelled_by, cancel_reason'
export const ITEM_COLUMNS = 'id, plan_id, job_id, installment_no, due_date, amount_due, paid_amount, status, paid_at'

// installment_plans/installment_items เชื่อมกับ jobs ได้หลายเส้นทาง จึงต้องระบุ Foreign Key เมื่อ embed
export const PLAN_JOB_FK = 'installment_plans_job_id_fkey'
export const ITEM_JOB_FK = 'installment_items_job_id_fkey'

const MAX_MONEY_SATANG = 999999999999 // numeric(12,2)
const MAX_QUANTITY = 9999999999 // numeric(10,2) ในหน่วย 1/100
const RATE_PATTERN = /^\d{1,3}(\.\d{1,4})?$/

/* ================================ ตัวช่วย ================================ */

// ค่าจาก numeric ใน Database -> สตางค์ (จำนวนเต็ม)
export function moneyToSatang(value) {
  return parseMoney(value ?? 0) ?? 0
}

export function formatMoney(value) {
  return formatSatang(moneyToSatang(value))
}

export function addDaysISO(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

// ตรงกับ round(quantity * unit_price, 2) ใน Database (ใช้ BigInt กันความคลาดเคลื่อน)
export function lineTotalSatang(quantityHundredths, priceSatang) {
  const product = BigInt(quantityHundredths) * BigInt(priceSatang)
  const quotient = product / 100n
  const remainder = product % 100n
  return Number(remainder * 2n >= 100n ? quotient + 1n : quotient)
}

export function readMoneyInput(text, { min = 1, max = null, label = 'จำนวนเงิน' } = {}) {
  const raw = String(text ?? '').trim()
  if (!raw) return { error: `กรุณากรอก${label}` }
  const value = parseMoney(raw)
  if (value === null) return { error: 'กรอกเป็นตัวเลข ทศนิยมไม่เกิน 2 ตำแหน่ง' }
  if (value < 0) return { error: `${label}ต้องไม่ติดลบ` }
  if (value < min) return { error: `${label}ต้องมากกว่า 0` }
  if (value > MAX_MONEY_SATANG) return { error: 'จำนวนเงินเกินขอบเขตที่ระบบรองรับ' }
  if (max !== null && value > max) return { error: `${label}ต้องไม่เกิน ${formatSatang(max)}` }
  return { value }
}

export function readQuantity(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return { error: 'กรุณากรอกจำนวน' }
  const value = parseMoney(raw)
  if (value === null) return { error: 'จำนวนเป็นตัวเลข ทศนิยมไม่เกิน 2 ตำแหน่ง' }
  if (value <= 0) return { error: 'จำนวนต้องมากกว่า 0' }
  if (value > MAX_QUANTITY) return { error: 'จำนวนมากเกินไป' }
  return { value }
}

const BANGKOK_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Bangkok',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export function nowBangkokInput() {
  const p = Object.fromEntries(BANGKOK_FORMAT.formatToParts(new Date()).map((part) => [part.type, part.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}

export function bangkokInputToISO(value) {
  if (!value) return null
  return value.length === 16 ? `${value}:00+07:00` : `${value}+07:00`
}

export function interestDescription({ rate, mode, months }) {
  const r = Number(rate)
  if (mode === 'per_month') {
    return `${r}% ต่อเดือน × ${months} เดือน คิดจากเงินต้นคงที่ (เทียบเท่า ${Number((r * 12).toFixed(4))}% ต่อปีแบบ Flat)`
  }
  return `${r}% ครั้งเดียวจากเงินต้น`
}

export function planInterestDescription(plan) {
  return interestDescription({
    rate: plan.interest_rate_percent,
    mode: plan.interest_mode,
    months: plan.installment_count * plan.interval_months,
  })
}

/* ================================ ตั้งค่าผ่อนชำระ ================================ */

const SETTING_KEYS = ['installment_interest_rate_percent', 'installment_interest_mode', 'installment_due_soon_days']

export function useInstallmentSettings() {
  const [state, setState] = useState({
    rate: DEFAULT_INTEREST_RATE_PERCENT,
    mode: DEFAULT_INTEREST_MODE,
    dueSoonDays: 3,
    updatedAt: null,
    loaded: false,
    error: '',
  })
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('app_settings').select('key, value, updated_at').in('key', SETTING_KEYS)
    if (!mounted.current) return
    if (error) {
      setState((current) => ({
        ...current,
        loaded: true,
        error: getErrorMessage(error, 'โหลดการตั้งค่าผ่อนชำระไม่สำเร็จ ระบบแสดงค่าเริ่มต้นแทน'),
      }))
      return
    }
    const map = Object.fromEntries((data ?? []).map((row) => [row.key, row]))
    const rate = Number(map.installment_interest_rate_percent?.value)
    const mode = map.installment_interest_mode?.value
    const days = Number(map.installment_due_soon_days?.value)
    setState({
      rate: Number.isFinite(rate) ? rate : DEFAULT_INTEREST_RATE_PERCENT,
      mode: INTEREST_MODES[mode] ? mode : DEFAULT_INTEREST_MODE,
      dueSoonDays: Number.isFinite(days) ? days : 3,
      updatedAt: map.installment_interest_rate_percent?.updated_at ?? null,
      loaded: true,
      error: '',
    })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return { ...state, reload: load }
}

/* ================================ สรุปยอด ================================ */

function MoneyRow({ label, value, strong = false, divider = false }) {
  return (
    <div className={`flex justify-between gap-3 ${divider ? 'border-t border-line pt-2' : ''} ${strong ? 'font-semibold' : ''}`}>
      <dt className={strong ? '' : 'text-muted'}>{label}</dt>
      <dd className="m-0 tabular-nums">{value}</dd>
    </div>
  )
}

export function FinanceBreakdown({ finance }) {
  const discount = moneyToSatang(finance.discount)
  return (
    <dl className="m-0 space-y-1.5 text-sm">
      <MoneyRow label={COST_ITEM_TYPES.service} value={formatMoney(finance.service_fee)} />
      <MoneyRow label={COST_ITEM_TYPES.part} value={formatMoney(finance.parts_fee)} />
      <MoneyRow label={COST_ITEM_TYPES.other} value={formatMoney(finance.other_fee)} />
      <MoneyRow label="ยอดรวมก่อนส่วนลด" value={formatMoney(finance.gross_amount)} divider />
      <MoneyRow label="ส่วนลด" value={discount > 0 ? `-${formatSatang(discount)}` : formatSatang(0)} />
      <MoneyRow label="ยอดสุทธิ" value={formatMoney(finance.net_amount)} strong />
      <MoneyRow label="ดอกเบี้ยผ่อนชำระ" value={formatMoney(finance.interest_amount)} />
      <MoneyRow label="ยอดที่ต้องชำระ" value={formatMoney(finance.payable_amount)} strong divider />
      <MoneyRow label="ชำระแล้ว (หลังหักคืนเงิน)" value={formatMoney(finance.paid_amount)} />
      <MoneyRow label="ยอดคงเหลือ" value={formatMoney(finance.balance_amount)} strong divider />
    </dl>
  )
}

function MiniStat({ label, value, tone }) {
  const toneClass = tone ? `text-${tone}` : ''
  return (
    <div className="rounded-xl border border-line p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  )
}

/* ================================ รายการราคา ================================ */

const EMPTY_COST_ITEM = { item_type: 'service', description: '', quantity: '1', unit_price: '' }

export function CostItemModal({ open, jobId, item = null, onClose, onSaved }) {
  const toast = useToast()
  const [form, setForm] = useState(EMPTY_COST_ITEM)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setErrors({})
    setForm(
      item
        ? {
            item_type: item.item_type,
            description: item.description || '',
            quantity: satangToDecimalString(moneyToSatang(item.quantity)).replace(/\.00$/, ''),
            unit_price: satangToDecimalString(moneyToSatang(item.unit_price)),
          }
        : EMPTY_COST_ITEM,
    )
  }, [open, item])

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  const quantity = readQuantity(form.quantity)
  const price = readMoneyInput(form.unit_price, { min: 0, label: 'ราคาต่อหน่วย' })
  const preview =
    quantity.value !== undefined && price.value !== undefined ? lineTotalSatang(quantity.value, price.value) : null

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (saving) return
    const description = form.description.trim()
    const next = {}
    if (!COST_ITEM_TYPES[form.item_type]) next.item_type = 'กรุณาเลือกประเภทรายการ'
    if (!description) next.description = 'กรุณากรอกรายละเอียดรายการ'
    else if (description.length > 300) next.description = 'รายละเอียดยาวเกิน 300 ตัวอักษร'
    if (quantity.error) next.quantity = quantity.error
    if (price.error) next.unit_price = price.error
    if (preview !== null && preview > MAX_MONEY_SATANG) next.unit_price = 'ยอดรวมของรายการเกินขอบเขตที่ระบบรองรับ'
    setErrors(next)
    if (Object.keys(next).length > 0) return

    const payload = {
      item_type: form.item_type,
      description,
      quantity: satangToDecimalString(quantity.value),
      unit_price: satangToDecimalString(price.value),
    }

    setSaving(true)
    const query = item
      ? supabase.from('job_cost_items').update(payload).eq('id', item.id)
      : supabase.from('job_cost_items').insert({ ...payload, job_id: jobId })
    const { data, error } = await query.select('id')
    setSaving(false)

    if (error) {
      toast.error(getErrorMessage(error, 'บันทึกรายการราคาไม่สำเร็จ'))
      return
    }
    if (!data || data.length === 0) {
      toast.error('ไม่พบรายการ หรือคุณไม่มีสิทธิ์แก้ไข')
      return
    }
    toast.success(item ? 'แก้ไขรายการราคาแล้ว' : 'เพิ่มรายการราคาแล้ว')
    onSaved?.()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={saving}
      title={item ? 'แก้ไขรายการราคา' : 'เพิ่มรายการราคา'}
      footer={
        <>
          <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>
            ยกเลิก
          </button>
          <button type="submit" form="cost-item-form" className="btn btn-primary inline-flex items-center gap-2" disabled={saving}>
            {saving && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
            บันทึก
          </button>
        </>
      }
    >
      <form id="cost-item-form" onSubmit={handleSubmit} noValidate>
        <Field label="ประเภท" htmlFor="cost-type" error={errors.item_type} required>
          <select className="form-select" value={form.item_type} onChange={set('item_type')} {...fieldA11y('cost-type', errors.item_type)}>
            {Object.entries(COST_ITEM_TYPES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="รายละเอียดรายการ" htmlFor="cost-desc" error={errors.description} required>
          <input
            className="form-control"
            value={form.description}
            onChange={set('description')}
            maxLength={300}
            placeholder="เช่น ค่าตรวจเช็ค, SSD 512GB, ค่าเดินทางนอกสถานที่"
            data-autofocus
            {...fieldA11y('cost-desc', errors.description)}
          />
        </Field>
        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label="จำนวน" htmlFor="cost-qty" error={errors.quantity} required>
            <input
              inputMode="decimal"
              className="form-control"
              value={form.quantity}
              onChange={set('quantity')}
              {...fieldA11y('cost-qty', errors.quantity)}
            />
          </Field>
          <Field label="ราคาต่อหน่วย (บาท)" htmlFor="cost-price" error={errors.unit_price} required>
            <input
              inputMode="decimal"
              className="form-control"
              value={form.unit_price}
              onChange={set('unit_price')}
              placeholder="0.00"
              {...fieldA11y('cost-price', errors.unit_price)}
            />
          </Field>
        </div>
        <p className="m-0 text-sm text-muted">
          ยอดรวมรายการ: <strong className="text-ink tabular-nums">{preview === null ? '-' : formatSatang(preview)}</strong>
        </p>
      </form>
    </Modal>
  )
}

export function DiscountModal({ open, jobId, finance, onClose, onSaved }) {
  const toast = useToast()
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const gross = moneyToSatang(finance?.gross_amount)

  useEffect(() => {
    if (!open) return
    setError('')
    setValue(satangToDecimalString(moneyToSatang(finance?.discount)))
  }, [open, finance])

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (saving) return
    const result = readMoneyInput(value, { min: 0, max: gross, label: 'ส่วนลด' })
    if (result.error) {
      setError(result.error)
      return
    }
    setError('')
    setSaving(true)
    const { data, error: updateError } = await supabase
      .from('job_finance')
      .update({ discount: satangToDecimalString(result.value) })
      .eq('job_id', jobId)
      .select('job_id')
    setSaving(false)
    if (updateError) {
      toast.error(getErrorMessage(updateError, 'บันทึกส่วนลดไม่สำเร็จ'))
      return
    }
    if (!data || data.length === 0) {
      toast.error('ไม่มีสิทธิ์แก้ไขส่วนลด')
      return
    }
    toast.success('บันทึกส่วนลดแล้ว')
    onSaved?.()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={saving}
      size="sm"
      title="แก้ไขส่วนลด"
      description={`ยอดรวมก่อนส่วนลด ${formatSatang(gross)} · ใส่ 0 เพื่อล้างส่วนลด`}
      footer={
        <>
          <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>
            ยกเลิก
          </button>
          <button type="submit" form="discount-form" className="btn btn-primary inline-flex items-center gap-2" disabled={saving}>
            {saving && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
            บันทึก
          </button>
        </>
      }
    >
      <form id="discount-form" onSubmit={handleSubmit} noValidate>
        <Field label="ส่วนลด (บาท)" htmlFor="discount-value" error={error} required>
          <input
            inputMode="decimal"
            className="form-control"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            data-autofocus
            {...fieldA11y('discount-value', error)}
          />
        </Field>
      </form>
    </Modal>
  )
}

/* ================================ รับชำระ / คืนเงิน ================================ */

const EMPTY_PAYMENT = { installment_item_id: '', amount: '', paid_at: '', method: 'cash', reference_no: '', note: '' }

export function RecordPaymentModal({
  open,
  kind = 'payment',
  job,
  finance,
  plan = null,
  items = [],
  presetItemId = null,
  onClose,
  onSaved,
}) {
  const toast = useToast()
  const { user } = useAuth()
  const requestIdRef = useRef(null)
  const [form, setForm] = useState(EMPTY_PAYMENT)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  const isRefund = kind === 'refund'
  const usePlan = !isRefund && plan?.status === 'active'
  const openItems = usePlan ? items.filter((item) => item.plan_id === plan.id && item.status !== 'paid') : []

  useEffect(() => {
    if (!open) return
    // รหัสคำขอใหม่ทุกครั้งที่เปิด ป้องกันการบันทึกซ้ำจากการกดซ้ำหรือ Retry
    requestIdRef.current = crypto.randomUUID()
    const candidates =
      kind !== 'refund' && plan?.status === 'active'
        ? items.filter((item) => item.plan_id === plan.id && item.status !== 'paid')
        : []
    const preset = candidates.find((item) => item.id === presetItemId)
    setForm({ ...EMPTY_PAYMENT, installment_item_id: (preset || candidates[0])?.id || '', paid_at: nowBangkokInput() })
    setErrors({})
  }, [open, kind, plan, items, presetItemId])

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  const selectedItem = openItems.find((item) => item.id === form.installment_item_id) || null

  let maxSatang = 0
  if (isRefund) maxSatang = moneyToSatang(finance?.paid_amount)
  else if (usePlan) {
    maxSatang = selectedItem ? moneyToSatang(selectedItem.amount_due) - moneyToSatang(selectedItem.paid_amount) : 0
  } else maxSatang = moneyToSatang(finance?.balance_amount)

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (saving) return
    const amount = readMoneyInput(form.amount, {
      min: 1,
      max: maxSatang,
      label: isRefund ? 'ยอดคืนเงิน' : 'ยอดรับชำระ',
    })
    const next = {}
    if (usePlan && !selectedItem) next.installment_item_id = 'กรุณาเลือกงวดที่ชำระ'
    if (amount.error) next.amount = amount.error
    if (!form.paid_at) next.paid_at = 'กรุณาระบุวันเวลา'
    else if (form.paid_at.slice(0, 16) > nowBangkokInput()) next.paid_at = 'วันเวลาต้องไม่อยู่ในอนาคต'
    if (!PAYMENT_METHODS[form.method]) next.method = 'กรุณาเลือกวิธีชำระเงิน'
    if (form.reference_no.trim().length > 100) next.reference_no = 'เลขอ้างอิงยาวเกิน 100 ตัวอักษร'
    if (isRefund && !form.note.trim()) next.note = 'กรุณาระบุเหตุผลการคืนเงิน'
    else if (form.note.length > 1000) next.note = 'หมายเหตุยาวเกิน 1,000 ตัวอักษร'
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setSaving(true)
    const { error } = await supabase.from('payments').insert({
      job_id: job.id,
      installment_item_id: usePlan ? selectedItem.id : null,
      kind,
      amount: satangToDecimalString(amount.value),
      paid_at: bangkokInputToISO(form.paid_at),
      method: form.method,
      reference_no: form.reference_no.trim() || null,
      note: form.note.trim() || null,
      recorded_by: user.id,
      client_request_id: requestIdRef.current,
    })
    setSaving(false)

    if (error) {
      if (error.code === '23505') {
        toast.info('รายการนี้ถูกบันทึกไว้แล้ว ระบบไม่บันทึกซ้ำ')
        onSaved?.()
        return
      }
      toast.error(getErrorMessage(error, isRefund ? 'บันทึกการคืนเงินไม่สำเร็จ' : 'บันทึกการรับชำระไม่สำเร็จ'))
      return
    }
    toast.success(isRefund ? 'บันทึกการคืนเงินแล้ว' : 'บันทึกการรับชำระแล้ว')
    onSaved?.()
  }

  const title = isRefund ? 'บันทึกการคืนเงิน' : usePlan ? 'รับชำระงวดผ่อน' : 'บันทึกการรับชำระ'

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={saving}
      title={title}
      description={
        isRefund
          ? `ยอดที่รับไว้ ${formatSatang(maxSatang)} · คืนเงินได้เฉพาะงานที่ยกเลิกแล้ว`
          : `ยอดคงเหลือของงาน ${formatMoney(finance?.balance_amount)}`
      }
      footer={
        <>
          <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>
            ยกเลิก
          </button>
          <button
            type="submit"
            form="payment-form"
            className={`btn ${isRefund ? 'btn-danger' : 'btn-primary'} inline-flex items-center gap-2`}
            disabled={saving || (usePlan && openItems.length === 0)}
          >
            {saving && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
            {isRefund ? 'บันทึกคืนเงิน' : 'บันทึกรับชำระ'}
          </button>
        </>
      }
    >
      <form id="payment-form" onSubmit={handleSubmit} noValidate>
        {usePlan && (
          <Field label="งวดที่ชำระ" htmlFor="pay-item" error={errors.installment_item_id} required>
            <select
              className="form-select"
              value={form.installment_item_id}
              onChange={set('installment_item_id')}
              {...fieldA11y('pay-item', errors.installment_item_id)}
            >
              {openItems.length === 0 && <option value="">ไม่มีงวดค้างชำระ</option>}
              {openItems.map((item) => (
                <option key={item.id} value={item.id}>
                  งวดที่ {item.installment_no} · ครบกำหนด {formatDate(item.due_date)} · ค้าง{' '}
                  {formatSatang(moneyToSatang(item.amount_due) - moneyToSatang(item.paid_amount))}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field
          label={isRefund ? 'ยอดคืนเงิน (บาท)' : 'ยอดรับชำระ (บาท)'}
          htmlFor="pay-amount"
          error={errors.amount}
          hint={`ไม่เกิน ${formatSatang(maxSatang)}`}
          required
        >
          <div className="flex gap-2">
            <input
              inputMode="decimal"
              className="form-control"
              value={form.amount}
              onChange={set('amount')}
              placeholder="0.00"
              data-autofocus
              {...fieldA11y('pay-amount', errors.amount, true)}
            />
            <button
              type="button"
              className="btn btn-outline-secondary whitespace-nowrap"
              onClick={() => setForm((current) => ({ ...current, amount: satangToDecimalString(maxSatang) }))}
              disabled={maxSatang <= 0}
            >
              เต็มจำนวน
            </button>
          </div>
        </Field>

        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label="วันเวลา (เวลาไทย)" htmlFor="pay-at" error={errors.paid_at} required>
            <input
              type="datetime-local"
              className="form-control"
              value={form.paid_at}
              max={nowBangkokInput()}
              onChange={set('paid_at')}
              {...fieldA11y('pay-at', errors.paid_at)}
            />
          </Field>
          <Field label="วิธีชำระเงิน" htmlFor="pay-method" error={errors.method} required>
            <select className="form-select" value={form.method} onChange={set('method')} {...fieldA11y('pay-method', errors.method)}>
              {Object.entries(PAYMENT_METHODS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="เลขอ้างอิง" htmlFor="pay-ref" error={errors.reference_no}>
          <input
            className="form-control"
            value={form.reference_no}
            onChange={set('reference_no')}
            maxLength={100}
            placeholder="เช่น เลขที่สลิปโอนเงิน"
            {...fieldA11y('pay-ref', errors.reference_no)}
          />
        </Field>
        <Field label={isRefund ? 'เหตุผลการคืนเงิน' : 'หมายเหตุ'} htmlFor="pay-note" error={errors.note} required={isRefund}>
          <textarea
            className="form-control"
            rows={2}
            value={form.note}
            onChange={set('note')}
            maxLength={1000}
            {...fieldA11y('pay-note', errors.note)}
          />
        </Field>
        <p className="m-0 text-xs text-muted">
          ระบบบันทึกผู้ทำรายการอัตโนมัติ และคำนวณสถานะการชำระจากยอดที่รับจริงเท่านั้น รายการที่บันทึกแล้วแก้ไขไม่ได้
          หากผิดพลาดให้ยกเลิกรายการแล้วบันทึกใหม่
        </p>
      </form>
    </Modal>
  )
}

export function VoidPaymentDialog({ payment, onClose, onDone }) {
  const toast = useToast()
  const [reason, setReason] = useState('')

  useEffect(() => {
    setReason('')
  }, [payment])

  const confirm = async () => {
    const { error } = await supabase.rpc('void_payment', { p_payment_id: payment.id, p_reason: reason.trim() })
    if (error) {
      toast.error(getErrorMessage(error, 'ยกเลิกรายการไม่สำเร็จ'))
      return
    }
    toast.success('ยกเลิกรายการแล้ว ยอดเงินถูกคำนวณใหม่')
    onDone?.()
  }

  return (
    <ConfirmDialog
      open={Boolean(payment)}
      title="ยกเลิกรายการชำระเงิน"
      message={
        payment
          ? `ยกเลิกรายการ${PAYMENT_KIND[payment.kind]?.label ?? ''} ${formatMoney(payment.amount)} เมื่อ ${formatDate(payment.paid_at, true)} รายการเดิมจะยังอยู่ในประวัติพร้อมเหตุผล`
          : ''
      }
      confirmLabel="ยกเลิกรายการ"
      confirmDisabled={!reason.trim()}
      onConfirm={confirm}
      onCancel={onClose}
    >
      <Field label="เหตุผล" htmlFor="void-reason" required>
        <textarea
          id="void-reason"
          className="form-control"
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          data-autofocus
        />
      </Field>
    </ConfirmDialog>
  )
}

/* ================================ แผนผ่อนชำระ ================================ */

export function CreatePlanModal({ open, job, finance, settings, onClose, onCreated }) {
  const toast = useToast()
  const { isSuperAdmin } = useAuth()
  const [form, setForm] = useState({ count: '3', firstDue: '', interval: '1', rate: '', mode: DEFAULT_INTEREST_MODE, note: '' })
  const [override, setOverride] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setForm({
      count: '3',
      firstDue: addMonthsISO(todayISO(), 1),
      interval: '1',
      rate: String(settings.rate),
      mode: settings.mode,
      note: '',
    })
    setOverride(false)
    setAcknowledged(false)
    setErrors({})
  }, [open, settings.rate, settings.mode])

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  const principal = moneyToSatang(finance?.balance_amount)
  const count = Number(form.count)
  const interval = Number(form.interval)
  const rateText = override ? form.rate.trim() : String(settings.rate)
  const rate = Number(rateText)
  const mode = override ? form.mode : settings.mode

  let preview = null
  let previewError = ''
  if (!RATE_PATTERN.test(rateText) || rate > 100) previewError = 'อัตราดอกเบี้ยต้องเป็นตัวเลข 0–100 ทศนิยมไม่เกิน 4 ตำแหน่ง'
  else if (!INTEREST_MODES[mode]) previewError = 'รูปแบบดอกเบี้ยไม่ถูกต้อง'
  else {
    try {
      preview = calcInstallmentPlan({
        principalSatang: principal,
        ratePercent: rate,
        mode,
        count,
        firstDueDate: form.firstDue,
        intervalMonths: interval,
      })
    } catch (err) {
      previewError = err.message
    }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (saving) return
    const next = {}
    if (previewError) next.preview = previewError
    if (!acknowledged) next.acknowledged = 'กรุณายืนยันว่าแจ้งเงื่อนไขให้ลูกค้าทราบแล้ว'
    if (form.note.length > 1000) next.note = 'หมายเหตุยาวเกิน 1,000 ตัวอักษร'
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setSaving(true)
    const { data, error } = await supabase.rpc('create_installment_plan', {
      p_job_id: job.id,
      p_installment_count: count,
      p_first_due_date: form.firstDue,
      p_interval_months: interval,
      p_interest_rate_percent: override ? rate : null,
      p_interest_mode: override ? mode : null,
      p_note: form.note.trim() || null,
    })
    setSaving(false)
    if (error) {
      toast.error(getErrorMessage(error, 'สร้างแผนผ่อนชำระไม่สำเร็จ'))
      return
    }
    toast.success('สร้างแผนผ่อนชำระแล้ว')
    onCreated?.(data)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={saving}
      size="lg"
      title="สร้างแผนผ่อนชำระ"
      description={`เงินต้น = ยอดคงเหลือของงาน ${formatSatang(principal)} (ระบบใช้ยอดจริง ณ เวลาบันทึก)`}
      footer={
        <>
          <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>
            ยกเลิก
          </button>
          <button
            type="submit"
            form="plan-form"
            className="btn btn-primary inline-flex items-center gap-2"
            disabled={saving || Boolean(previewError)}
          >
            {saving && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
            สร้างแผน
          </button>
        </>
      }
    >
      <form id="plan-form" onSubmit={handleSubmit} noValidate>
        {settings.error && (
          <div className="alert alert-warning py-2 text-sm" role="alert">
            {settings.error}
          </div>
        )}
        <div className="grid gap-x-4 sm:grid-cols-3">
          <Field label="จำนวนงวด" htmlFor="plan-count" required>
            <input
              id="plan-count"
              type="number"
              inputMode="numeric"
              min={1}
              max={60}
              step={1}
              className="form-control"
              value={form.count}
              onChange={set('count')}
              data-autofocus
            />
          </Field>
          <Field label="ชำระทุก ๆ (เดือน)" htmlFor="plan-interval" required>
            <select id="plan-interval" className="form-select" value={form.interval} onChange={set('interval')}>
              {[1, 2, 3, 6, 12].map((n) => (
                <option key={n} value={String(n)}>
                  {n === 1 ? 'ทุกเดือน' : `ทุก ${n} เดือน`}
                </option>
              ))}
            </select>
          </Field>
          <Field label="ครบกำหนดงวดแรก" htmlFor="plan-first" required>
            <input id="plan-first" type="date" className="form-control" value={form.firstDue} onChange={set('firstDue')} />
          </Field>
        </div>

        <div className="mb-4 rounded-xl bg-fill p-3 text-sm">
          <div>
            อัตราดอกเบี้ยตามการตั้งค่าระบบ: <strong>{interestDescription({ rate: settings.rate, mode: settings.mode, months: 1 }).split(' ×')[0]}</strong>{' '}
            ({INTEREST_MODES[settings.mode]})
          </div>
          {isSuperAdmin && (
            <div className="form-check mt-2 mb-0">
              <input
                id="plan-override"
                type="checkbox"
                className="form-check-input"
                checked={override}
                onChange={(e) => setOverride(e.target.checked)}
              />
              <label htmlFor="plan-override" className="form-check-label">
                กำหนดอัตราดอกเบี้ยเฉพาะแผนนี้ (Super Admin)
              </label>
            </div>
          )}
          {override && (
            <div className="mt-3 grid gap-x-4 sm:grid-cols-2">
              <Field label="อัตราดอกเบี้ย (%)" htmlFor="plan-rate" className="mb-0">
                <input id="plan-rate" inputMode="decimal" className="form-control" value={form.rate} onChange={set('rate')} />
              </Field>
              <Field label="รูปแบบดอกเบี้ย" htmlFor="plan-mode" className="mb-0">
                <select id="plan-mode" className="form-select" value={form.mode} onChange={set('mode')}>
                  {Object.entries(INTEREST_MODES).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}
        </div>

        {previewError ? (
          <div className="alert alert-danger py-2 text-sm" role="alert">
            {previewError}
          </div>
        ) : (
          preview && (
            <div className="mb-4 rounded-xl border border-line p-4">
              <dl className="m-0 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                <div>
                  <dt className="text-muted">เงินต้น</dt>
                  <dd className="m-0 font-semibold tabular-nums">{formatSatang(preview.principal)}</dd>
                </div>
                <div>
                  <dt className="text-muted">ดอกเบี้ยรวม</dt>
                  <dd className="m-0 font-semibold tabular-nums">{formatSatang(preview.interest)}</dd>
                </div>
                <div>
                  <dt className="text-muted">ยอดรวมที่ต้องผ่อน</dt>
                  <dd className="m-0 font-semibold tabular-nums">{formatSatang(preview.total)}</dd>
                </div>
                <div>
                  <dt className="text-muted">ต่องวด</dt>
                  <dd className="m-0 font-semibold tabular-nums">{formatSatang(preview.items[0].amount)}</dd>
                </div>
              </dl>
              <p className="mt-3 mb-3 text-xs text-muted">
                ดอกเบี้ย: {interestDescription({ rate, mode, months: count * interval })} · เศษสตางค์บวกให้งวดแรก ๆ
                เพื่อให้ผลรวมทุกงวดเท่ายอดรวมพอดี
              </p>
              <div className="max-h-56 overflow-y-auto rounded-lg border border-line">
                <table className="table table-sm align-middle">
                  <thead>
                    <tr>
                      <th scope="col" className="pl-3">
                        งวด
                      </th>
                      <th scope="col">ครบกำหนด</th>
                      <th scope="col" className="pr-3 text-right">
                        ยอดชำระ
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.items.map((item) => (
                      <tr key={item.installmentNo}>
                        <td className="pl-3">{item.installmentNo}</td>
                        <td>{formatDate(item.dueDate)}</td>
                        <td className="pr-3 text-right tabular-nums">{formatSatang(item.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        )}

        <Field label="หมายเหตุ / เงื่อนไขเพิ่มเติม" htmlFor="plan-note" error={errors.note}>
          <textarea
            className="form-control"
            rows={2}
            value={form.note}
            onChange={set('note')}
            maxLength={1000}
            {...fieldA11y('plan-note', errors.note)}
          />
        </Field>

        <div className="form-check">
          <input
            id="plan-ack"
            type="checkbox"
            className="form-check-input"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            aria-invalid={errors.acknowledged ? true : undefined}
          />
          <label htmlFor="plan-ack" className="form-check-label text-sm">
            แจ้งอัตราดอกเบี้ย ยอดรวม และกำหนดชำระแต่ละงวดให้ลูกค้าทราบและยินยอมแล้ว
          </label>
        </div>
        {errors.acknowledged && <div className="mt-1 text-sm text-danger">{errors.acknowledged}</div>}
        <p className="mt-3 mb-0 text-xs text-muted">
          ผู้ดูแลต้องตรวจสอบเงื่อนไขการผ่อนชำระและอัตราดอกเบี้ยกับข้อกำหนดทางกฎหมายที่เกี่ยวข้องก่อนใช้งานจริง
        </p>
      </form>
    </Modal>
  )
}

export function CancelPlanDialog({ plan, onClose, onDone }) {
  const toast = useToast()
  const [reason, setReason] = useState('')

  useEffect(() => {
    setReason('')
  }, [plan])

  const confirm = async () => {
    const { error } = await supabase.rpc('cancel_installment_plan', { p_plan_id: plan.id, p_reason: reason.trim() })
    if (error) {
      toast.error(getErrorMessage(error, 'ยกเลิกแผนไม่สำเร็จ'))
      return
    }
    toast.success('ยกเลิกแผนผ่อนชำระแล้ว ดอกเบี้ยของแผนถูกนำออกจากยอดที่ต้องชำระ')
    onDone?.()
  }

  return (
    <ConfirmDialog
      open={Boolean(plan)}
      title="ยกเลิกแผนผ่อนชำระ"
      message="ยกเลิกได้เมื่อไม่มีรายการชำระงวดที่ยังใช้งานอยู่ หากมี ให้ยกเลิกรายการชำระงวดเหล่านั้นก่อน"
      confirmLabel="ยกเลิกแผน"
      confirmDisabled={!reason.trim()}
      onConfirm={confirm}
      onCancel={onClose}
    >
      <Field label="เหตุผล" htmlFor="cancel-plan-reason" required>
        <textarea
          id="cancel-plan-reason"
          className="form-control"
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          data-autofocus
        />
      </Field>
    </ConfirmDialog>
  )
}

export function PlanSummary({ plan, items }) {
  const today = todayISO()
  const totalDue = items.reduce((sum, item) => sum + moneyToSatang(item.amount_due), 0)
  const totalPaid = items.reduce((sum, item) => sum + moneyToSatang(item.paid_amount), 0)
  const overdue = items.filter((item) => item.status !== 'paid' && item.due_date < today)
  const stats = [
    ['เงินต้น', formatMoney(plan.principal_amount)],
    ['ดอกเบี้ย', formatMoney(plan.interest_amount)],
    ['ยอดรวมผ่อน', formatMoney(plan.total_amount)],
    ['จำนวนงวด', `${plan.installment_count} งวด (${plan.interval_months === 1 ? 'ทุกเดือน' : `ทุก ${plan.interval_months} เดือน`})`],
    ['ชำระแล้ว', formatSatang(totalPaid)],
    ['คงค้าง', formatSatang(Math.max(totalDue - totalPaid, 0))],
    ['งวดเลยกำหนด', `${overdue.length} งวด`],
    ['งวดแรกครบกำหนด', formatDate(plan.first_due_date)],
  ]
  return (
    <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3 text-sm md:grid-cols-4">
      {stats.map(([label, value]) => (
        <div key={label}>
          <dt className="text-muted">{label}</dt>
          <dd className={`m-0 font-semibold tabular-nums ${label === 'งวดเลยกำหนด' && overdue.length > 0 ? 'text-danger' : ''}`}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function InstallmentItemsTable({ items, dueSoonDays = 3, onPay = null }) {
  const today = todayISO()
  const soon = addDaysISO(today, dueSoonDays)
  const totalDue = items.reduce((sum, item) => sum + moneyToSatang(item.amount_due), 0)
  const totalPaid = items.reduce((sum, item) => sum + moneyToSatang(item.paid_amount), 0)

  return (
    <TableWrap minWidth={720}>
      <table className="table align-middle">
        <thead>
          <tr>
            <th scope="col" className="pl-5">
              งวด
            </th>
            <th scope="col">ครบกำหนด</th>
            <th scope="col" className="text-right">
              ยอดงวด
            </th>
            <th scope="col" className="text-right">
              ชำระแล้ว
            </th>
            <th scope="col" className="text-right">
              คงค้าง
            </th>
            <th scope="col">สถานะ</th>
            {onPay && (
              <th scope="col" className="pr-5">
                <span className="sr-only">การดำเนินการ</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const outstanding = moneyToSatang(item.amount_due) - moneyToSatang(item.paid_amount)
            const meta = INSTALLMENT_ITEM_STATUS[item.status] ?? INSTALLMENT_ITEM_STATUS.pending
            const overdue = item.status !== 'paid' && item.due_date < today
            const dueSoon = item.status !== 'paid' && !overdue && item.due_date <= soon
            return (
              <tr key={item.id}>
                <td className="pl-5 font-medium">{item.installment_no}</td>
                <td className={`whitespace-nowrap ${overdue ? 'font-medium text-danger' : ''}`}>{formatDate(item.due_date)}</td>
                <td className="text-right tabular-nums">{formatMoney(item.amount_due)}</td>
                <td className="text-right tabular-nums">{formatMoney(item.paid_amount)}</td>
                <td className="text-right font-medium tabular-nums">{formatSatang(outstanding)}</td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                    {overdue && (
                      <Badge tone="danger">
                        <AlertTriangle size={12} aria-hidden="true" />
                        เลยกำหนด
                      </Badge>
                    )}
                    {dueSoon && <Badge tone="warning">ใกล้ครบกำหนด</Badge>}
                  </div>
                  {item.paid_at && <div className="mt-0.5 text-xs text-muted">ชำระครบ {formatDate(item.paid_at, true)}</div>}
                </td>
                {onPay && (
                  <td className="pr-5 text-right">
                    {item.status !== 'paid' && (
                      <button type="button" className="btn btn-sm btn-primary whitespace-nowrap" onClick={() => onPay(item.id)}>
                        รับชำระ
                      </button>
                    )}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <td className="pl-5" colSpan={2}>
              รวม
            </td>
            <td className="text-right tabular-nums">{formatSatang(totalDue)}</td>
            <td className="text-right tabular-nums">{formatSatang(totalPaid)}</td>
            <td className="text-right tabular-nums">{formatSatang(Math.max(totalDue - totalPaid, 0))}</td>
            <td colSpan={onPay ? 2 : 1} />
          </tr>
        </tfoot>
      </table>
    </TableWrap>
  )
}

/* ================================ ตารางรายการชำระ ================================ */

export function PaymentsTable({ payments, people, itemNoById = {}, showJob = false, onVoid = null }) {
  return (
    <TableWrap minWidth={showJob ? 1060 : 900}>
      <table className="table align-middle">
        <thead>
          <tr>
            <th scope="col" className="pl-5">
              วันที่
            </th>
            {showJob && <th scope="col">งาน</th>}
            <th scope="col">ประเภท</th>
            <th scope="col">งวด</th>
            <th scope="col" className="text-right">
              จำนวนเงิน
            </th>
            <th scope="col">วิธีชำระ / อ้างอิง</th>
            <th scope="col">ผู้บันทึก</th>
            <th scope="col" className={onVoid ? '' : 'pr-5'}>
              สถานะ
            </th>
            {onVoid && (
              <th scope="col" className="pr-5">
                <span className="sr-only">การดำเนินการ</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {payments.map((payment) => {
            const voided = Boolean(payment.voided_at)
            const kind = PAYMENT_KIND[payment.kind] ?? PAYMENT_KIND.payment
            const installmentNo = payment.item?.installment_no ?? itemNoById[payment.installment_item_id]
            return (
              <tr key={payment.id} className={voided ? 'text-muted' : ''}>
                <td className="pl-5 text-sm whitespace-nowrap">{formatDate(payment.paid_at, true)}</td>
                {showJob && (
                  <td className="max-w-[240px]">
                    {payment.job ? (
                      <>
                        <Link to={`/jobs/${payment.job.id}`} className="font-medium no-underline">
                          {payment.job.job_number}
                        </Link>
                        <div className="truncate text-xs text-muted">{payment.job.customer?.name || payment.job.title}</div>
                      </>
                    ) : (
                      '-'
                    )}
                  </td>
                )}
                <td>
                  <Badge tone={kind.tone}>{kind.label}</Badge>
                </td>
                <td className="text-sm whitespace-nowrap">
                  {payment.installment_item_id ? (installmentNo ? `งวดที่ ${installmentNo}` : 'งวดผ่อน') : '-'}
                </td>
                <td className={`text-right font-medium tabular-nums whitespace-nowrap ${voided ? 'line-through' : ''}`}>
                  {payment.kind === 'refund' ? '-' : ''}
                  {formatMoney(payment.amount)}
                </td>
                <td className="max-w-[240px] text-sm">
                  {PAYMENT_METHODS[payment.method] ?? payment.method}
                  {payment.reference_no && <div className="text-xs text-muted">อ้างอิง: {payment.reference_no}</div>}
                  {payment.note && <div className="text-xs whitespace-pre-wrap text-muted">{payment.note}</div>}
                </td>
                <td className="text-sm">{people[payment.recorded_by]?.full_name || 'ไม่ทราบชื่อ'}</td>
                <td className={`text-sm ${onVoid ? '' : 'pr-5'}`}>
                  {voided ? (
                    <div className="max-w-[220px]">
                      <Badge tone="danger">ยกเลิกแล้ว</Badge>
                      <div className="mt-1 text-xs whitespace-pre-wrap">{payment.void_reason}</div>
                      <div className="text-xs">
                        {people[payment.voided_by]?.full_name || 'ไม่ทราบชื่อ'} · {formatDate(payment.voided_at, true)}
                      </div>
                    </div>
                  ) : (
                    <Badge tone="success">ใช้งาน</Badge>
                  )}
                </td>
                {onVoid && (
                  <td className="pr-5 text-right">
                    {!voided && (
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-danger inline-flex items-center gap-1 whitespace-nowrap"
                        onClick={() => onVoid(payment)}
                      >
                        <Undo2 size={14} aria-hidden="true" />
                        ยกเลิกรายการ
                      </button>
                    )}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </TableWrap>
  )
}

/* ================================ ส่วนการเงินในหน้ารายละเอียดงาน ================================ */

export function FinancePanel({ job, refreshToken = 0, onFinanceChange }) {
  const toast = useToast()
  const { map: people } = useProfileDirectory()
  const settings = useInstallmentSettings()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modal, setModal] = useState(null)
  const [voidTarget, setVoidTarget] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [planToCancel, setPlanToCancel] = useState(null)
  const onChangeRef = useRef(onFinanceChange)
  const jobId = job.id

  useEffect(() => {
    onChangeRef.current = onFinanceChange
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [finance, costItems, payments, plans, allItems] = await Promise.all([
        supabase.from('job_finance').select(FINANCE_COLUMNS).eq('job_id', jobId).maybeSingle().then(unwrap),
        supabase.from('job_cost_items').select(COST_ITEM_COLUMNS).eq('job_id', jobId).order('created_at').then(unwrap),
        supabase
          .from('payments')
          .select(PAYMENT_COLUMNS)
          .eq('job_id', jobId)
          .order('paid_at', { ascending: false })
          .limit(200)
          .then(unwrap),
        supabase
          .from('installment_plans')
          .select(PLAN_COLUMNS)
          .eq('job_id', jobId)
          .order('created_at', { ascending: false })
          .then(unwrap),
        supabase.from('installment_items').select(ITEM_COLUMNS).eq('job_id', jobId).order('installment_no').then(unwrap),
      ])
      const planList = plans ?? []
      const itemList = allItems ?? []
      const currentPlan =
        planList.find((plan) => plan.status === 'active') || planList.find((plan) => plan.status === 'completed') || null
      setData({
        finance,
        costItems: costItems ?? [],
        payments: payments ?? [],
        plans: planList,
        currentPlan,
        allItems: itemList,
        items: currentPlan ? itemList.filter((item) => item.plan_id === currentPlan.id) : [],
      })
      setError('')
      onChangeRef.current?.(finance)
    } catch (err) {
      setError(getErrorMessage(err, 'โหลดข้อมูลการเงินไม่สำเร็จ'))
    } finally {
      setLoading(false)
    }
  }, [jobId])

  useEffect(() => {
    load()
  }, [load, refreshToken])

  const closeAndReload = () => {
    setModal(null)
    load()
  }

  const deleteCostItem = async () => {
    const { data: deleted, error: deleteError } = await supabase
      .from('job_cost_items')
      .delete()
      .eq('id', deleteTarget.id)
      .select('id')
    if (deleteError) {
      toast.error(getErrorMessage(deleteError, 'ลบรายการไม่สำเร็จ'))
      return
    }
    if (!deleted || deleted.length === 0) {
      toast.error('ไม่พบรายการ หรือคุณไม่มีสิทธิ์ลบ')
      return
    }
    toast.success('ลบรายการราคาแล้ว')
    setDeleteTarget(null)
    load()
  }

  if (!data) {
    return (
      <Card>
        {error ? (
          <ErrorState title="โหลดข้อมูลการเงินไม่สำเร็จ" message={error} onRetry={load} />
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Spinner size={16} /> กำลังโหลดข้อมูลการเงิน...
          </div>
        )}
      </Card>
    )
  }

  const { finance, costItems, payments, plans, currentPlan, allItems, items } = data
  if (!finance) {
    return (
      <Card>
        <p className="m-0 text-sm text-muted">ไม่พบข้อมูลการเงินของงานนี้</p>
      </Card>
    )
  }

  const cancelled = job.status === 'cancelled'
  const planLocked = plans.some((plan) => plan.status === 'active' || plan.status === 'completed')
  const activePlan = currentPlan?.status === 'active' ? currentPlan : null
  const balance = moneyToSatang(finance.balance_amount)
  const paid = moneyToSatang(finance.paid_amount)
  const gross = moneyToSatang(finance.gross_amount)
  const canEditPrice = !cancelled && !planLocked
  const canPay = !cancelled && balance > 0
  const canRefund = cancelled && paid > 0
  const canCreatePlan = !cancelled && !activePlan && balance > 0
  const itemNoById = Object.fromEntries(allItems.map((item) => [item.id, item.installment_no]))
  const cancelledPlans = plans.filter((plan) => plan.status === 'cancelled')

  return (
    <section aria-labelledby="finance-title" aria-busy={loading} className={`space-y-4 ${loading ? 'opacity-70' : ''}`}>
      <Card>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="finance-title" className="m-0 inline-flex items-center gap-2 text-base font-semibold">
              <Wallet size={17} className="text-muted" aria-hidden="true" />
              ราคาและการเงิน
            </h2>
            <PaymentStatusBadge status={finance.payment_status} />
          </div>
          <div className="flex flex-wrap gap-2">
            {canCreatePlan && (
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary inline-flex items-center gap-1.5"
                onClick={() => setModal({ type: 'plan' })}
              >
                <CalendarClock size={15} aria-hidden="true" />
                สร้างแผนผ่อนชำระ
              </button>
            )}
            {canRefund && (
              <button
                type="button"
                className="btn btn-sm btn-outline-danger inline-flex items-center gap-1.5"
                onClick={() => setModal({ type: 'refund' })}
              >
                <RotateCcw size={15} aria-hidden="true" />
                บันทึกคืนเงิน
              </button>
            )}
            {canPay && (
              <button
                type="button"
                className="btn btn-sm btn-primary inline-flex items-center gap-1.5"
                onClick={() => setModal({ type: 'payment', itemId: null })}
              >
                <Receipt size={15} aria-hidden="true" />
                บันทึกรับชำระ
              </button>
            )}
          </div>
        </div>

        {cancelled && (
          <div className="alert alert-secondary flex items-start gap-2 py-2 text-sm" role="status">
            <Lock size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            งานถูกยกเลิก: แก้ไขราคาและรับชำระไม่ได้ ประวัติการเงินยังถูกเก็บไว้ และคืนเงินได้ไม่เกินยอดที่รับไว้
          </div>
        )}
        {!cancelled && planLocked && (
          <div className="alert alert-secondary flex items-start gap-2 py-2 text-sm" role="status">
            <Lock size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            งานนี้มีแผนผ่อนชำระ: แก้ไขรายการราคาและส่วนลดไม่ได้จนกว่าจะยกเลิกแผน (ต้องยกเลิกรายการชำระงวดทั้งหมดก่อน)
          </div>
        )}

        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <MiniStat label="ยอดที่ต้องชำระ" value={formatMoney(finance.payable_amount)} />
          <MiniStat label="ชำระแล้ว" value={formatMoney(finance.paid_amount)} tone={paid > 0 ? 'success' : undefined} />
          <MiniStat label="ยอดคงเหลือ" value={formatMoney(finance.balance_amount)} tone={balance > 0 ? 'warning' : undefined} />
        </div>

        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="m-0 text-sm font-semibold">รายการราคา</h3>
          {canEditPrice && (
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary inline-flex items-center gap-1.5"
              onClick={() => setModal({ type: 'cost', item: null })}
            >
              <Plus size={15} aria-hidden="true" />
              เพิ่มรายการ
            </button>
          )}
        </div>
        {costItems.length === 0 ? (
          <p className="m-0 text-sm text-muted">ยังไม่มีรายการราคา เพิ่มค่าบริการ ค่าอะไหล่ หรือค่าเดินทางเพื่อประเมินราคา</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-line">
            <TableWrap minWidth={640}>
              <table className="table align-middle">
                <thead>
                  <tr>
                    <th scope="col" className="pl-4">
                      ประเภท
                    </th>
                    <th scope="col">รายการ</th>
                    <th scope="col" className="text-right">
                      จำนวน
                    </th>
                    <th scope="col" className="text-right">
                      ราคา/หน่วย
                    </th>
                    <th scope="col" className="text-right">
                      รวม
                    </th>
                    {canEditPrice && (
                      <th scope="col" className="pr-4">
                        <span className="sr-only">การดำเนินการ</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {costItems.map((item) => (
                    <tr key={item.id}>
                      <td className="pl-4 text-sm whitespace-nowrap">{COST_ITEM_TYPES[item.item_type] ?? item.item_type}</td>
                      <td className="max-w-[260px] break-words">{item.description}</td>
                      <td className="text-right tabular-nums">
                        {Number(item.quantity).toLocaleString('th-TH', { maximumFractionDigits: 2 })}
                      </td>
                      <td className="text-right tabular-nums">{formatMoney(item.unit_price)}</td>
                      <td className="text-right font-medium tabular-nums">{formatMoney(item.line_total)}</td>
                      {canEditPrice && (
                        <td className="pr-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-secondary mr-1"
                            onClick={() => setModal({ type: 'cost', item })}
                            aria-label={`แก้ไข ${item.description}`}
                          >
                            <Pencil size={14} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-danger"
                            onClick={() => setDeleteTarget(item)}
                            aria-label={`ลบ ${item.description}`}
                          >
                            <Trash2 size={14} aria-hidden="true" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </div>
        )}

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="text-sm text-muted">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span>
                ส่วนลด: <strong className="text-ink tabular-nums">{formatMoney(finance.discount)}</strong>
              </span>
              {canEditPrice && gross > 0 && (
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary inline-flex items-center gap-1"
                  onClick={() => setModal({ type: 'discount' })}
                >
                  <Pencil size={14} aria-hidden="true" />
                  แก้ไขส่วนลด
                </button>
              )}
            </div>
            <p className="m-0 text-xs">
              สูตร: ยอดรวมก่อนส่วนลด = ค่าบริการ + ค่าอะไหล่ + ค่าใช้จ่ายอื่น · ยอดสุทธิ = ยอดรวม − ส่วนลด · ยอดที่ต้องชำระ =
              ยอดสุทธิ + ดอกเบี้ยผ่อน · ยอดคงเหลือ = ยอดที่ต้องชำระ − เงินที่รับจริง
            </p>
          </div>
          <div className="rounded-xl bg-fill p-4">
            <FinanceBreakdown finance={finance} />
          </div>
        </div>
      </Card>

      {currentPlan && (
        <Card flush>
          <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-4">
            <div>
              <h2 className="m-0 inline-flex items-center gap-2 text-base font-semibold">
                <CalendarClock size={17} className="text-muted" aria-hidden="true" />
                แผนผ่อนชำระ
                <Badge tone={PLAN_STATUS[currentPlan.status]?.tone}>{PLAN_STATUS[currentPlan.status]?.label}</Badge>
              </h2>
              <p className="mt-1 mb-0 text-xs text-muted">ดอกเบี้ย: {planInterestDescription(currentPlan)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to={`/payments/plans/${currentPlan.id}`} className="btn btn-sm btn-outline-secondary">
                เปิดหน้าแผนผ่อน
              </Link>
              {activePlan && (
                <button
                  type="button"
                  className="btn btn-sm btn-outline-danger inline-flex items-center gap-1.5"
                  onClick={() => setPlanToCancel(activePlan)}
                >
                  <Ban size={15} aria-hidden="true" />
                  ยกเลิกแผน
                </button>
              )}
            </div>
          </div>
          <div className="px-5 pb-4">
            <PlanSummary plan={currentPlan} items={items} />
          </div>
          <InstallmentItemsTable
            items={items}
            dueSoonDays={settings.dueSoonDays}
            onPay={activePlan && !cancelled ? (itemId) => setModal({ type: 'payment', itemId }) : null}
          />
        </Card>
      )}

      {cancelledPlans.length > 0 && (
        <p className="m-0 text-xs text-muted">
          แผนที่ยกเลิกแล้ว:{' '}
          {cancelledPlans.map((plan, index) => (
            <span key={plan.id}>
              {index > 0 && ', '}
              <Link to={`/payments/plans/${plan.id}`}>สร้างเมื่อ {formatDate(plan.created_at)}</Link>
            </span>
          ))}
        </p>
      )}

      <Card flush>
        <h2 className="m-0 inline-flex items-center gap-2 px-5 pt-5 pb-3 text-base font-semibold">
          <Receipt size={17} className="text-muted" aria-hidden="true" />
          ประวัติการชำระเงิน
        </h2>
        {payments.length === 0 ? (
          <p className="m-0 px-5 pb-5 text-sm text-muted">ยังไม่มีรายการรับชำระหรือคืนเงิน</p>
        ) : (
          <PaymentsTable payments={payments} people={people} itemNoById={itemNoById} onVoid={setVoidTarget} />
        )}
      </Card>

      <CostItemModal
        open={modal?.type === 'cost'}
        jobId={jobId}
        item={modal?.item ?? null}
        onClose={() => setModal(null)}
        onSaved={closeAndReload}
      />
      <DiscountModal
        open={modal?.type === 'discount'}
        jobId={jobId}
        finance={finance}
        onClose={() => setModal(null)}
        onSaved={closeAndReload}
      />
      <RecordPaymentModal
        open={modal?.type === 'payment' || modal?.type === 'refund'}
        kind={modal?.type === 'refund' ? 'refund' : 'payment'}
        job={job}
        finance={finance}
        plan={activePlan}
        items={items}
        presetItemId={modal?.itemId ?? null}
        onClose={() => setModal(null)}
        onSaved={closeAndReload}
      />
      <CreatePlanModal
        open={modal?.type === 'plan'}
        job={job}
        finance={finance}
        settings={settings}
        onClose={() => setModal(null)}
        onCreated={closeAndReload}
      />
      <VoidPaymentDialog
        payment={voidTarget}
        onClose={() => setVoidTarget(null)}
        onDone={() => {
          setVoidTarget(null)
          load()
        }}
      />
      <CancelPlanDialog
        plan={planToCancel}
        onClose={() => setPlanToCancel(null)}
        onDone={() => {
          setPlanToCancel(null)
          load()
        }}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="ลบรายการราคา"
        message={deleteTarget ? `ต้องการลบ "${deleteTarget.description}" (${formatMoney(deleteTarget.line_total)}) หรือไม่` : ''}
        confirmLabel="ลบรายการ"
        onConfirm={deleteCostItem}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  )
}