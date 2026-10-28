import { useEffect } from 'react'

export const APP_NAME = 'FKSNo1.SiTE'

// หน้า Store Settings จะ dispatch event นี้หลังบันทึก เพื่อให้ Sidebar อัปเดตชื่อร้าน/โลโก้
export const STORE_UPDATED_EVENT = 'fksno1:store-updated'

/* ---------------------------------- ค่าคงที่ ---------------------------------- */
// tone ใช้กับ Badge: neutral | info | primary | warning | success | danger

export const JOB_STATUS = {
  pending_review: { label: 'รอตรวจสอบ', tone: 'warning' },
  checking: { label: 'กำลังตรวจเช็ค', tone: 'info' },
  in_progress: { label: 'กำลังดำเนินการ', tone: 'primary' },
  completed: { label: 'เสร็จสิ้น', tone: 'success' },
  cancelled: { label: 'ยกเลิก', tone: 'danger' },
}

export const OPEN_JOB_STATUSES = ['pending_review', 'checking', 'in_progress']

export const PAYMENT_STATUS = {
  unpaid: { label: 'ยังไม่ชำระ', tone: 'neutral' },
  partial: { label: 'ชำระบางส่วน', tone: 'warning' },
  paid: { label: 'ชำระครบแล้ว', tone: 'success' },
  installment: { label: 'ผ่อนชำระ', tone: 'info' },
  refunded: { label: 'ยกเลิก/คืนเงิน', tone: 'danger' },
}

export const PAYMENT_METHODS = {
  cash: 'เงินสด',
  bank_transfer: 'โอนเงิน',
  promptpay: 'พร้อมเพย์',
  card: 'บัตร',
  other: 'อื่น ๆ',
}

// ชื่อสำรอง กรณีโหลดตาราง job_types ไม่ได้ (แหล่งข้อมูลจริงคือตาราง job_types)
export const JOB_TYPES = {
  general_repair: 'งานซ่อมทั่วไป',
  warranty_claim: 'งานเคลมทั่วไป',
  website: 'งานทำเว็บไซต์',
  network: 'งานระบบอินเทอร์เน็ต',
  other: 'งานอื่น ๆ',
}

export const DEVICE_TYPES = {
  mobile: 'Mobile',
  tablet: 'Tablet / iPad',
  laptop: 'Laptop',
  desktop: 'Desktop PC',
  monitor: 'Monitor',
  printer: 'Printer',
  network_device: 'Router / Network Device',
  server: 'Server',
  other: 'Other',
}

export const ROLES = {
  super_admin: { label: 'Super Admin', rank: 3 },
  admin: { label: 'Admin', rank: 2 },
  staff: { label: 'Staff', rank: 1 },
}

// ใช้ซ่อน/แสดง UI เท่านั้น การบังคับสิทธิ์จริงอยู่ที่ RLS และ Edge Functions
export function hasMinRole(role, minRole) {
  return (ROLES[role]?.rank ?? 0) >= (ROLES[minRole]?.rank ?? Infinity)
}

/* ------------------------------ เงิน (หน่วยสตางค์) ------------------------------ */
/*
  ใน JavaScript คำนวณเงินเป็น "จำนวนเต็มสตางค์" เสมอ / ใน Database ใช้ numeric(12,2)
    ยอดรวมก่อนส่วนลด = ค่าบริการ + ค่าอะไหล่ + ค่าใช้จ่ายอื่น
    ยอดสุทธิ         = max(ยอดรวมก่อนส่วนลด - ส่วนลด, 0)
    ยอดต้องชำระ      = ยอดสุทธิ + ดอกเบี้ยผ่อน
    ยอดคงเหลือ       = max(ยอดต้องชำระ - เงินที่ชำระแล้ว, 0)
*/

const MONEY_PATTERN = /^(-?)(\d*)(?:\.(\d{0,2}))?$/

// แปลงข้อความ/ตัวเลขเป็นสตางค์ คืน null เมื่อรูปแบบไม่ถูกต้องหรือมีทศนิยมเกิน 2 ตำแหน่ง
export function parseMoney(value) {
  if (value === null || value === undefined) return null
  const text = String(value).replace(/,/g, '').trim()
  const match = MONEY_PATTERN.exec(text)
  if (!match || (match[2] === '' && (match[3] ?? '') === '')) return null
  const baht = Number(match[2] || '0')
  const satang = Number((match[3] || '').padEnd(2, '0'))
  const total = baht * 100 + satang
  if (!Number.isSafeInteger(total)) return null
  return match[1] === '-' ? -total : total
}

export function toSatang(value) {
  return parseMoney(value) ?? 0
}

export function satangToDecimalString(satang) {
  const s = Math.round(satang)
  const sign = s < 0 ? '-' : ''
  const abs = Math.abs(s)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

const currencyFormatter = new Intl.NumberFormat('th-TH', {
  style: 'currency',
  currency: 'THB',
  minimumFractionDigits: 2,
})

// รับค่าเป็นบาท (ตามที่ได้จาก numeric ใน Database)
export function formatBaht(value) {
  const n = typeof value === 'number' ? value : Number(value)
  return currencyFormatter.format(Number.isFinite(n) ? n : 0)
}

export function formatSatang(satang) {
  return formatBaht(satangToDecimalString(satang))
}

export function calcJobTotals({ serviceFee = 0, parts = 0, other = 0, discount = 0, interest = 0 }) {
  const gross = serviceFee + parts + other
  const appliedDiscount = Math.min(Math.max(discount, 0), gross)
  const net = gross - appliedDiscount
  return { gross, discount: appliedDiscount, net, payable: net + interest }
}

export function calcBalance(payableSatang, paidSatang) {
  return Math.max(payableSatang - paidSatang, 0)
}

/* ------------------------------ ผ่อนชำระและดอกเบี้ย ------------------------------ */
/*
  ตรงกับ public.calc_installment_interest / calc_installment_schedule ใน Database
    per_month : ดอกเบี้ย = เงินต้น x อัตรา% x จำนวนเดือนทั้งหมด (จำนวนงวด x ระยะห่างเดือน)
    one_time  : ดอกเบี้ย = เงินต้น x อัตรา%
  ปัดเศษแบบปัดครึ่งขึ้นที่หน่วยสตางค์ / ใช้ BigInt เพื่อไม่ให้เกิดความคลาดเคลื่อนของ Floating Point
  เศษสตางค์ของงวด: หารเท่ากัน แล้วบวก 1 สตางค์ให้งวดแรก ๆ จนผลรวมเท่ายอดรวมพอดี
*/

export const DEFAULT_INTEREST_RATE_PERCENT = 1.2
export const DEFAULT_INTEREST_MODE = 'per_month'

export const INTEREST_MODES = {
  per_month: 'ต่อเดือน (คิดจากเงินต้นคงที่)',
  one_time: 'ครั้งเดียวจากเงินต้น',
}

export function calcInterestSatang(
  principalSatang,
  ratePercent = DEFAULT_INTEREST_RATE_PERCENT,
  mode = DEFAULT_INTEREST_MODE,
  months = 1,
) {
  const rateMicro = Math.round(Number(ratePercent) * 10000) // 1.2% = 12000
  const periods = mode === 'per_month' ? Math.max(1, Math.trunc(months)) : 1
  const numerator = BigInt(Math.trunc(principalSatang)) * BigInt(rateMicro) * BigInt(periods)
  const divisor = 1000000n
  const quotient = numerator / divisor
  const remainder = numerator % divisor
  return Number(remainder * 2n >= divisor ? quotient + 1n : quotient)
}

export function addMonthsISO(iso, months) {
  const [y, m, d] = iso.split('-').map(Number)
  const target = new Date(Date.UTC(y, m - 1 + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(d, lastDay))
  return target.toISOString().slice(0, 10)
}

export function calcInstallmentPlan({
  principalSatang,
  ratePercent = DEFAULT_INTEREST_RATE_PERCENT,
  mode = DEFAULT_INTEREST_MODE,
  count,
  firstDueDate,
  intervalMonths = 1,
}) {
  if (!Number.isInteger(principalSatang) || principalSatang <= 0) {
    throw new Error('ยอดเงินต้นต้องมากกว่า 0')
  }
  if (!Number.isInteger(count) || count < 1 || count > 60) {
    throw new Error('จำนวนงวดต้องเป็นจำนวนเต็มระหว่าง 1 ถึง 60')
  }
  if (!Number.isInteger(intervalMonths) || intervalMonths < 1 || intervalMonths > 12) {
    throw new Error('ระยะห่างระหว่างงวดต้องอยู่ระหว่าง 1 ถึง 12 เดือน')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(firstDueDate || '')) {
    throw new Error('วันครบกำหนดงวดแรกไม่ถูกต้อง')
  }

  const interest = calcInterestSatang(principalSatang, ratePercent, mode, count * intervalMonths)
  const total = principalSatang + interest
  if (total < count) throw new Error('ยอดรวมน้อยเกินไปสำหรับจำนวนงวดนี้')

  const base = Math.floor(total / count)
  const remainder = total - base * count

  const items = Array.from({ length: count }, (_, i) => ({
    installmentNo: i + 1,
    dueDate: addMonthsISO(firstDueDate, i * intervalMonths),
    amount: base + (i < remainder ? 1 : 0),
  }))

  return { principal: principalSatang, interest, total, ratePercent, mode, intervalMonths, items }
}

/* ---------------------------------- วันที่ ---------------------------------- */
// th-TH แสดงปี พ.ศ. และใช้เขตเวลา Asia/Bangkok

export function formatDate(value, withTime = false) {
  if (!value) return '-'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date)
}

export function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date())
}

/* ---------------------------------- Theme ---------------------------------- */

const THEME_KEY = 'fksno1-theme'
const themeListeners = new Set()

function notifyTheme() {
  themeListeners.forEach((listener) => listener())
}

export function subscribeTheme(listener) {
  themeListeners.add(listener)
  return () => themeListeners.delete(listener)
}

export function getStoredTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

export function resolveTheme(pref) {
  if (pref === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return pref
}

export function applyTheme(pref) {
  const resolved = resolveTheme(pref)
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')
  root.setAttribute('data-bs-theme', resolved)
  root.style.colorScheme = resolved
  return resolved
}

export function setTheme(pref) {
  try {
    if (pref === 'system') localStorage.removeItem(THEME_KEY)
    else localStorage.setItem(THEME_KEY, pref)
  } catch {
    // localStorage ใช้ไม่ได้ (เช่น Private Mode) ให้ใช้ Theme ได้เฉพาะ Session นี้
  }
  const resolved = applyTheme(pref)
  notifyTheme()
  return resolved
}

export function initTheme() {
  applyTheme(getStoredTheme())
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const onSystemChange = () => {
    if (getStoredTheme() === 'system') applyTheme('system')
  }
  // ซิงก์ Theme ข้ามแท็บ
  const onStorage = (event) => {
    if (event.key === THEME_KEY || event.key === null) {
      applyTheme(getStoredTheme())
      notifyTheme()
    }
  }
  mq.addEventListener('change', onSystemChange)
  window.addEventListener('storage', onStorage)
  return () => {
    mq.removeEventListener('change', onSystemChange)
    window.removeEventListener('storage', onStorage)
  }
}

/* -------------------------------- Page Title -------------------------------- */

export function usePageTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · ${APP_NAME}` : APP_NAME
  }, [title])
}