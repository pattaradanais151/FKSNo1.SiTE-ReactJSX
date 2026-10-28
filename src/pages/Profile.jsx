import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Eye, EyeOff, ImagePlus, KeyRound, Loader2, Save, Trash2 } from 'lucide-react'
import { useAuth } from '../lib/auth.jsx'
import { getErrorMessage, supabase } from '../lib/supabase.js'
import { ROLES, formatDate, usePageTitle } from '../lib/utils.js'
import { Avatar, Badge, Card, Field, PageHeader, ThemeSwitcher, fieldA11y, useToast } from '../components/UI.jsx'
import { invalidateProfileDirectory } from '../components/Forms.jsx'

const AVATAR_BUCKET = 'avatars'
const AVATAR_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const AVATAR_MAX_BYTES = 2 * 1024 * 1024
const PHONE_PATTERN = /^[0-9+() -]{6,25}$/
const MIN_PASSWORD = 8
const ROLE_TONE = { super_admin: 'danger', admin: 'primary', staff: 'neutral' }

function passwordErrorMessage(error) {
  const message = String(error?.message || '').toLowerCase()
  if (/same|different from the old/.test(message)) return 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม'
  if (/weak|at least|characters/.test(message)) return 'รหัสผ่านไม่ผ่านเงื่อนไขความปลอดภัยของระบบ'
  if (/reauthenticat/.test(message)) return 'ต้องยืนยันตัวตนใหม่ กรุณาออกจากระบบแล้วเข้าสู่ระบบอีกครั้ง'
  return getErrorMessage(error, 'เปลี่ยนรหัสผ่านไม่สำเร็จ')
}

export default function Profile() {
  usePageTitle('โปรไฟล์')
  const { user, profile, refreshProfile } = useAuth()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const recoveryMode = params.get('set_password') === '1'
  const avatarInputRef = useRef(null)
  const newPasswordRef = useRef(null)

  const [info, setInfo] = useState({ fullName: '', phone: '' })
  const [infoErrors, setInfoErrors] = useState({})
  const [savingInfo, setSavingInfo] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)

  const [pw, setPw] = useState({ current: '', next: '', confirm: '' })
  const [pwErrors, setPwErrors] = useState({})
  const [showPassword, setShowPassword] = useState(false)
  const [savingPw, setSavingPw] = useState(false)

  useEffect(() => {
    if (profile) setInfo({ fullName: profile.full_name || '', phone: profile.phone || '' })
  }, [profile])

  useEffect(() => {
    if (recoveryMode) newPasswordRef.current?.focus()
  }, [recoveryMode])

  const afterProfileChange = () => {
    invalidateProfileDirectory()
    refreshProfile({ silent: true })
  }

  const handleSaveInfo = async (event) => {
    event.preventDefault()
    if (savingInfo) return
    const fullName = info.fullName.trim()
    const phone = info.phone.trim()
    const next = {}
    if (!fullName) next.fullName = 'กรุณากรอกชื่อ-นามสกุล'
    else if (fullName.length > 150) next.fullName = 'ชื่อยาวเกิน 150 ตัวอักษร'
    if (phone && !PHONE_PATTERN.test(phone)) next.phone = 'เบอร์โทรศัพท์ใช้ได้เฉพาะตัวเลข เว้นวรรค + - ( )'
    setInfoErrors(next)
    if (Object.keys(next).length > 0) return

    setSavingInfo(true)
    const { data, error } = await supabase
      .from('profiles')
      .update({ full_name: fullName, phone: phone || null })
      .eq('id', user.id)
      .select('id')
    setSavingInfo(false)
    if (error || !data?.length) {
      toast.error(getErrorMessage(error, 'บันทึกโปรไฟล์ไม่สำเร็จ'))
      return
    }
    toast.success('บันทึกโปรไฟล์แล้ว')
    afterProfileChange()
  }

  // ลบไฟล์รูปเก่าในโฟลเดอร์ของผู้ใช้ (ไม่กระทบการทำงานหากลบไม่สำเร็จ)
  const removeAvatarFiles = async (keepPath = null) => {
    const bucket = supabase.storage.from(AVATAR_BUCKET)
    const { data } = await bucket.list(user.id, { limit: 100 })
    const paths = (data ?? []).map((file) => `${user.id}/${file.name}`).filter((path) => path !== keepPath)
    if (paths.length > 0) await bucket.remove(paths)
  }

  const handleAvatar = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!AVATAR_TYPES[file.type] || file.size > AVATAR_MAX_BYTES) {
      toast.error('รูปโปรไฟล์ต้องเป็น JPG, PNG หรือ WebP ขนาดไม่เกิน 2 MB')
      return
    }
    setAvatarBusy(true)
    try {
      const path = `${user.id}/avatar-${Date.now()}.${AVATAR_TYPES[file.type]}`
      const bucket = supabase.storage.from(AVATAR_BUCKET)
      const { error: uploadError } = await bucket.upload(path, file, { contentType: file.type, upsert: false })
      if (uploadError) throw uploadError
      const { data: fileData } = bucket.getPublicUrl(path)
      const { error: updateError } = await supabase.from('profiles').update({ avatar_url: fileData.publicUrl }).eq('id', user.id)
      if (updateError) throw updateError
      await removeAvatarFiles(path).catch(() => null)
      toast.success('เปลี่ยนรูปโปรไฟล์แล้ว')
      afterProfileChange()
    } catch (err) {
      toast.error(getErrorMessage(err, 'อัปโหลดรูปโปรไฟล์ไม่สำเร็จ'))
    } finally {
      setAvatarBusy(false)
    }
  }

  const handleRemoveAvatar = async () => {
    setAvatarBusy(true)
    try {
      const { error } = await supabase.from('profiles').update({ avatar_url: null }).eq('id', user.id)
      if (error) throw error
      await removeAvatarFiles().catch(() => null)
      toast.success('ลบรูปโปรไฟล์แล้ว')
      afterProfileChange()
    } catch (err) {
      toast.error(getErrorMessage(err, 'ลบรูปโปรไฟล์ไม่สำเร็จ'))
    } finally {
      setAvatarBusy(false)
    }
  }

  const handleSavePassword = async (event) => {
    event.preventDefault()
    if (savingPw) return
    const next = {}
    if (!recoveryMode && !pw.current) next.current = 'กรุณากรอกรหัสผ่านปัจจุบัน'
    if (pw.next.length < MIN_PASSWORD) next.next = `รหัสผ่านใหม่ต้องมีอย่างน้อย ${MIN_PASSWORD} ตัวอักษร`
    else if (pw.next.length > 72) next.next = 'รหัสผ่านยาวเกิน 72 ตัวอักษร'
    else if (!recoveryMode && pw.next === pw.current) next.next = 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านปัจจุบัน'
    if (!next.next && pw.next !== pw.confirm) next.confirm = 'รหัสผ่านไม่ตรงกัน'
    setPwErrors(next)
    if (Object.keys(next).length > 0) return

    setSavingPw(true)
    try {
      if (!recoveryMode) {
        // ยืนยันรหัสผ่านปัจจุบันก่อน (ป้องกันกรณีมีผู้อื่นใช้เครื่องที่ล็อกอินค้างไว้)
        const { error: verifyError } = await supabase.auth.signInWithPassword({ email: user.email, password: pw.current })
        if (verifyError) {
          setPwErrors({ current: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' })
          return
        }
      }
      const { error } = await supabase.auth.updateUser({ password: pw.next })
      if (error) {
        toast.error(passwordErrorMessage(error))
        return
      }
      toast.success(recoveryMode ? 'ตั้งรหัสผ่านเรียบร้อยแล้ว' : 'เปลี่ยนรหัสผ่านแล้ว')
      setPw({ current: '', next: '', confirm: '' })
      if (recoveryMode) setParams(new URLSearchParams(), { replace: true })
    } finally {
      setSavingPw(false)
    }
  }

  const roleMeta = ROLES[profile?.role]
  const displayName = info.fullName || profile?.full_name || user?.email || ''

  return (
    <>
      <PageHeader title="โปรไฟล์ของฉัน" description="ข้อมูลส่วนตัว รูปโปรไฟล์ รหัสผ่าน และการแสดงผล" />

      {recoveryMode && (
        <div className="alert alert-info flex items-start gap-2" role="status">
          <KeyRound size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>กรุณาตั้งรหัสผ่านใหม่ในส่วน "รหัสผ่าน" ด้านล่าง เพื่อใช้เข้าสู่ระบบครั้งถัดไป</span>
        </div>
      )}

      <div className="grid max-w-3xl gap-4">
        <Card>
          <h2 className="mt-0 mb-4 text-base font-semibold">ข้อมูลส่วนตัว</h2>
          <div className="mb-5 flex flex-wrap items-center gap-4">
            <Avatar name={displayName} url={profile?.avatar_url} size={64} />
            <div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary inline-flex items-center gap-1.5"
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={avatarBusy}
                >
                  {avatarBusy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <ImagePlus size={15} aria-hidden="true" />}
                  เปลี่ยนรูปโปรไฟล์
                </button>
                {profile?.avatar_url && (
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-danger inline-flex items-center gap-1.5"
                    onClick={handleRemoveAvatar}
                    disabled={avatarBusy}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                    ลบรูป
                  </button>
                )}
              </div>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleAvatar}
                aria-label="เลือกรูปโปรไฟล์"
              />
              <div className="mt-1 text-xs text-muted">JPG, PNG หรือ WebP ไม่เกิน 2 MB</div>
            </div>
          </div>

          <dl className="m-0 mb-4 grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted">อีเมล</dt>
              <dd className="m-0 break-all">{user?.email}</dd>
            </div>
            <div>
              <dt className="text-muted">บทบาทและสถานะ</dt>
              <dd className="m-0 mt-0.5 flex flex-wrap gap-1">
                {roleMeta && <Badge tone={ROLE_TONE[profile.role]}>{roleMeta.label}</Badge>}
                <Badge tone={profile?.is_active ? 'success' : 'danger'}>{profile?.is_active ? 'ใช้งาน' : 'ปิดใช้งาน'}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-muted">สร้างบัญชีเมื่อ</dt>
              <dd className="m-0">{formatDate(profile?.created_at)}</dd>
            </div>
          </dl>
          <p className="mt-0 mb-4 text-xs text-muted">อีเมล บทบาท และสถานะบัญชีเปลี่ยนได้โดยผู้ดูแลระบบเท่านั้น</p>

          <form onSubmit={handleSaveInfo} noValidate>
            <div className="grid gap-x-4 sm:grid-cols-2">
              <Field label="ชื่อ-นามสกุล" htmlFor="prof-name" error={infoErrors.fullName} required>
                <input
                  className="form-control"
                  value={info.fullName}
                  onChange={(e) => setInfo((c) => ({ ...c, fullName: e.target.value }))}
                  maxLength={150}
                  autoComplete="name"
                  {...fieldA11y('prof-name', infoErrors.fullName)}
                />
              </Field>
              <Field label="เบอร์โทรศัพท์" htmlFor="prof-phone" error={infoErrors.phone}>
                <input
                  type="tel"
                  className="form-control"
                  value={info.phone}
                  onChange={(e) => setInfo((c) => ({ ...c, phone: e.target.value }))}
                  maxLength={25}
                  autoComplete="tel"
                  {...fieldA11y('prof-phone', infoErrors.phone)}
                />
              </Field>
            </div>
            <div className="flex justify-end">
              <button type="submit" className="btn btn-primary inline-flex items-center gap-2" disabled={savingInfo}>
                {savingInfo ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
                บันทึกโปรไฟล์
              </button>
            </div>
          </form>
        </Card>

        <Card>
          <h2 className="mt-0 mb-4 text-base font-semibold">{recoveryMode ? 'ตั้งรหัสผ่านใหม่' : 'รหัสผ่าน'}</h2>
          <form onSubmit={handleSavePassword} noValidate>
            <input type="email" value={user?.email || ''} autoComplete="username" readOnly hidden />
            {!recoveryMode && (
              <Field label="รหัสผ่านปัจจุบัน" htmlFor="pw-current" error={pwErrors.current} required>
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="form-control"
                  value={pw.current}
                  onChange={(e) => setPw((c) => ({ ...c, current: e.target.value }))}
                  autoComplete="current-password"
                  {...fieldA11y('pw-current', pwErrors.current)}
                />
              </Field>
            )}
            <div className="grid gap-x-4 sm:grid-cols-2">
              <Field label="รหัสผ่านใหม่" htmlFor="pw-next" error={pwErrors.next} hint={`อย่างน้อย ${MIN_PASSWORD} ตัวอักษร`} required>
                <input
                  ref={newPasswordRef}
                  type={showPassword ? 'text' : 'password'}
                  className="form-control"
                  value={pw.next}
                  onChange={(e) => setPw((c) => ({ ...c, next: e.target.value }))}
                  autoComplete="new-password"
                  {...fieldA11y('pw-next', pwErrors.next, true)}
                />
              </Field>
              <Field label="ยืนยันรหัสผ่านใหม่" htmlFor="pw-confirm" error={pwErrors.confirm} required>
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="form-control"
                  value={pw.confirm}
                  onChange={(e) => setPw((c) => ({ ...c, confirm: e.target.value }))}
                  autoComplete="new-password"
                  {...fieldA11y('pw-confirm', pwErrors.confirm)}
                />
              </Field>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary inline-flex items-center gap-1.5"
                onClick={() => setShowPassword((v) => !v)}
                aria-pressed={showPassword}
              >
                {showPassword ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
                {showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
              </button>
              <button type="submit" className="btn btn-primary inline-flex items-center gap-2" disabled={savingPw}>
                {savingPw ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <KeyRound size={16} aria-hidden="true" />}
                {recoveryMode ? 'ตั้งรหัสผ่าน' : 'เปลี่ยนรหัสผ่าน'}
              </button>
            </div>
          </form>
        </Card>

        <Card>
          <h2 className="mt-0 mb-3 text-base font-semibold">การแสดงผล</h2>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">ธีม</div>
              <div className="text-xs text-muted">บันทึกไว้ในเบราว์เซอร์นี้</div>
            </div>
            <ThemeSwitcher showLabels />
          </div>
        </Card>
      </div>
    </>
  )
}