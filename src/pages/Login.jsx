import { useRef, useState } from 'react'
import { AlertCircle, Eye, EyeOff, Loader2, LogIn, Wrench } from 'lucide-react'
import { useAuth } from '../lib/auth.jsx'
import { getErrorMessage } from '../lib/supabase.js'
import { APP_NAME, usePageTitle } from '../lib/utils.js'
import { Card, Field, ThemeSwitcher, fieldA11y } from '../components/UI.jsx'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function loginErrorMessage(error) {
  const message = error?.message || ''
  if (error?.status === 429 || /rate limit|too many/i.test(message)) {
    return 'พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่'
  }
  if (/invalid login credentials/i.test(message)) return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'
  if (/email not confirmed/i.test(message)) return 'บัญชีนี้ยังไม่ได้ยืนยันอีเมล กรุณาติดต่อผู้ดูแลระบบ'
  if (/user is banned/i.test(message)) return 'บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ'
  return getErrorMessage(error, 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่')
}

export default function Login() {
  usePageTitle('เข้าสู่ระบบ')
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const emailRef = useRef(null)
  const passwordRef = useRef(null)

  const validate = () => {
    const next = {}
    const trimmed = email.trim()
    if (!trimmed) next.email = 'กรุณากรอกอีเมล'
    else if (!EMAIL_PATTERN.test(trimmed)) next.email = 'รูปแบบอีเมลไม่ถูกต้อง'
    if (!password) next.password = 'กรุณากรอกรหัสผ่าน'
    return next
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (submitting) return

    const next = validate()
    setErrors(next)
    setFormError('')
    if (next.email) {
      emailRef.current?.focus()
      return
    }
    if (next.password) {
      passwordRef.current?.focus()
      return
    }

    setSubmitting(true)
    try {
      // เมื่อสำเร็จ Route Guard จะพาไปหน้าที่ต้องการเอง
      await signIn(email.trim().toLowerCase(), password)
    } catch (error) {
      setFormError(loginErrorMessage(error))
      setPassword('')
      setSubmitting(false)
      passwordRef.current?.focus()
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex justify-end p-4">
        <ThemeSwitcher />
      </div>

      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-sm">
          <div className="mb-6 text-center">
            <span className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-white">
              <Wrench size={26} aria-hidden="true" />
            </span>
            <h1 className="m-0 text-2xl font-semibold tracking-tight">เข้าสู่ระบบ</h1>
            <p className="mt-1 mb-0 text-muted">{APP_NAME} ระบบบริหารงานบริการ</p>
          </div>

          <Card>
            <form onSubmit={handleSubmit} noValidate>
              {formError && (
                <div className="alert alert-danger flex items-start gap-2 py-2" role="alert">
                  <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span>{formError}</span>
                </div>
              )}

              <Field label="อีเมล" htmlFor="login-email" error={errors.email} required>
                <input
                  ref={emailRef}
                  type="email"
                  className="form-control"
                  autoComplete="username"
                  inputMode="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={submitting}
                  {...fieldA11y('login-email', errors.email)}
                />
              </Field>

              <Field label="รหัสผ่าน" htmlFor="login-password" error={errors.password} required>
                <div className="relative">
                  <input
                    ref={passwordRef}
                    type={showPassword ? 'text' : 'password'}
                    className="form-control pr-11"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    disabled={submitting}
                    {...fieldA11y('login-password', errors.password)}
                  />
                  <button
                    type="button"
                    className="absolute top-1/2 right-1.5 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted hover:bg-fill"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
                  </button>
                </div>
              </Field>

              <button
                type="submit"
                className="btn btn-primary mt-2 inline-flex w-full items-center justify-center gap-2 py-2.5"
                disabled={submitting}
              >
                {submitting ? (
                  <Loader2 size={18} className="animate-spin" aria-hidden="true" />
                ) : (
                  <LogIn size={18} aria-hidden="true" />
                )}
                {submitting ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
              </button>
            </form>
          </Card>

          <p className="mt-5 text-center text-sm text-muted">
            บัญชีพนักงานสร้างโดยผู้ดูแลระบบเท่านั้น
            <br />
            หากลืมรหัสผ่าน กรุณาติดต่อผู้ดูแลระบบ
          </p>
        </div>
      </main>
    </div>
  )
}