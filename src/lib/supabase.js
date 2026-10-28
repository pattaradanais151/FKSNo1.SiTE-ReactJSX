import { createClient } from '@supabase/supabase-js'

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
export const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

// ป้องกันความผิดพลาด: ถ้าเผลอใส่ Secret Key / service_role ใน Frontend จะไม่สร้าง Client
function isSecretKey(value) {
  if (!value) return false
  if (value.startsWith('sb_secret_')) return true
  const parts = value.split('.')
  if (parts.length !== 3) return false
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload.role === 'service_role'
  } catch {
    return false
  }
}

function getConfigState() {
  if (!supabaseUrl || !supabaseKey) return 'missing'
  if (isSecretKey(supabaseKey)) return 'secret_key'
  return 'ready'
}

// 'missing' | 'secret_key' | 'ready'
export const supabaseConfigState = getConfigState()

if (supabaseConfigState === 'secret_key') {
  console.error('พบ Secret Key ใน VITE_SUPABASE_PUBLISHABLE_KEY ห้ามใช้ service_role หรือ sb_secret_ ใน Frontend')
}

export const supabase =
  supabaseConfigState === 'ready'
    ? createClient(supabaseUrl, supabaseKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: 'fksno1-auth',
        },
      })
    : null

/* --------------------------- แปลข้อผิดพลาดเป็นภาษาไทย --------------------------- */

const ERROR_BY_CODE = {
  23505: 'ข้อมูลนี้มีอยู่แล้วในระบบ',
  23503: 'ข้อมูลนี้ถูกอ้างอิงโดยรายการอื่น จึงลบหรือเปลี่ยนไม่ได้',
  23514: 'ข้อมูลไม่ถูกต้องตามเงื่อนไขของระบบ',
  23502: 'กรอกข้อมูลที่จำเป็นไม่ครบ',
  '22P02': 'รูปแบบข้อมูลไม่ถูกต้อง',
  22003: 'ตัวเลขมีค่าเกินขอบเขตที่ระบบรองรับ',
  42501: 'คุณไม่มีสิทธิ์ดำเนินการนี้',
  PGRST116: 'ไม่พบข้อมูล',
  PGRST301: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
}

const THAI_CHAR = /[\u0E00-\u0E7F]/

/**
 * คืนข้อความภาษาไทยที่ปลอดภัยสำหรับแสดงผู้ใช้
 * - ข้อความภาษาไทยจาก raise exception ใน Database แสดงได้ตรง ๆ
 * - ข้อความเทคนิคอื่นจะไม่แสดงออกไป (ป้องกันการเปิดเผยรายละเอียดภายใน)
 */
export function getErrorMessage(error, fallback = 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง') {
  if (!error) return fallback
  if (import.meta.env.DEV) console.error(error)

  const message = typeof error === 'string' ? error : String(error.message || '')
  if (THAI_CHAR.test(message)) return message

  const code = typeof error === 'object' ? error.code : undefined
  if (code && ERROR_BY_CODE[code]) return ERROR_BY_CODE[code]
  if (/permission denied|row-level security|not authorized/i.test(message)) return ERROR_BY_CODE[42501]
  if (/jwt expired|invalid jwt|refresh token/i.test(message)) return ERROR_BY_CODE.PGRST301
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(message)) {
    return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต'
  }
  return fallback
}