import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { History, KeyRound, Loader2, Pencil, Power, RefreshCw, UserCog, UserPlus } from 'lucide-react'
import { useAuth } from '../lib/auth.jsx'
import { getErrorMessage, supabase } from '../lib/supabase.js'
import { ROLES, formatDate, usePageTitle } from '../lib/utils.js'
import {
  Avatar,
  Badge,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  Modal,
  PageHeader,
  SearchInput,
  TableWrap,
  fieldA11y,
  useToast,
} from '../components/UI.jsx'
import { describeJobUpdate, invalidateProfileDirectory, unwrap } from '../components/Forms.jsx'

const PROFILE_COLUMNS = 'id, email, full_name, phone, avatar_url, role, is_active, created_at, updated_at'
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_PATTERN = /^[0-9+() -]{6,25}$/
const MIN_PASSWORD = 8
const ROLE_TONE = { super_admin: 'danger', admin: 'primary', staff: 'neutral' }
const ROLE_HINT = {
  staff: 'เห็นเฉพาะงานที่ได้รับมอบหมาย ไม่เห็นข้อมูลการเงิน',
  admin: 'จัดการลูกค้า งาน การเงิน และบัญชี Staff',
  super_admin: 'เข้าถึงทุกส่วน รวมถึงตั้งค่าระบบและ Audit Logs',
}

function setPasswordRedirect() {
  return `${window.location.origin}/profile?set_password=1`
}

// เรียก Edge Function พร้อม Token ของผู้ใช้ (supabase-js แนบให้อัตโนมัติ)
async function callManageEmployee(payload) {
  const { data, error } = await supabase.functions.invoke('manage-employee', { body: payload })
  if (error) {
    let message = ''
    try {
      const body = await error.context?.json()
      message = body?.error || ''
    } catch {
      // ไม่มีเนื้อหา JSON ให้ใช้ข้อความสำรอง
    }
    if (!message && error.name === 'FunctionsFetchError') {
      message = 'เชื่อมต่อ Edge Function ไม่ได้ ตรวจสอบว่า Deploy manage-employee แล้ว'
    }
    throw new Error(message || 'ดำเนินการไม่สำเร็จ')
  }
  return data
}

function canManageTarget(actor, target) {
  if (!actor || !target || actor.id === target.id) return false
  if (actor.role === 'super_admin') return true
  return actor.role === 'admin' && target.role === 'staff'
}

function validatePassword(value) {
  if (!value) return 'กรุณากรอกรหัสผ่าน'
  if (value.length < MIN_PASSWORD) return `รหัสผ่านต้องมีอย่างน้อย ${MIN_PASSWORD} ตัวอักษร`
  if (value.length > 72) return 'รหัสผ่านยาวเกิน 72 ตัวอักษร'
  return ''
}

/* ================================ หน้า ================================ */

export default function Employees() {
  usePageTitle('พนักงาน')
  const { profile, isSuperAdmin } = useAuth()
  const toast = useToast()
  const [rows, setRows] = useState([])
  const [authInfo, setAuthInfo] = useState({})
  const [authInfoError, setAuthInfoError] = useState('')
  const [state, setState] = useState({ loading: true, error: '' })
  const [reloadKey, setReloadKey] = useState(0)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [modal, setModal] = useState(null)
  const [toggleTarget, setToggleTarget] = useState(null)

  const reload = () => setReloadKey((key) => key + 1)

  useEffect(() => {
    let active = true
    setState((current) => ({ ...current, loading: true, error: '' }))
    supabase
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .order('full_name')
      .then(({ data, error }) => {
        if (!active) return
        if (error) setState({ loading: false, error: getErrorMessage(error, 'โหลดรายชื่อพนักงานไม่สำเร็จ') })
        else {
          setRows(data ?? [])
          setState({ loading: false, error: '' })
        }
      })
    callManageEmployee({ action: 'list_auth' })
      .then((data) => {
        if (!active) return
        setAuthInfo(Object.fromEntries((data?.users ?? []).map((user) => [user.id, user])))
        setAuthInfoError('')
      })
      .catch((err) => active && setAuthInfoError(err.message))
    return () => {
      active = false
    }
  }, [reloadKey])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return rows
      .filter((row) => !roleFilter || row.role === roleFilter)
      .filter((row) => !statusFilter || (statusFilter === 'active' ? row.is_active : !row.is_active))
      .filter(
        (row) =>
          !term ||
          (row.full_name || '').toLowerCase().includes(term) ||
          (row.email || '').toLowerCase().includes(term) ||
          (row.phone || '').includes(term),
      )
      .sort((a, b) => {
        const rank = (ROLES[b.role]?.rank ?? 0) - (ROLES[a.role]?.rank ?? 0)
        return rank !== 0 ? rank : (a.full_name || '').localeCompare(b.full_name || '', 'th')
      })
  }, [rows, search, roleFilter, statusFilter])

  const afterChange = () => {
    setModal(null)
    invalidateProfileDirectory()
    reload()
  }

  const confirmToggle = async () => {
    const next = !toggleTarget.is_active
    try {
      const data = await callManageEmployee({ action: 'update', userId: toggleTarget.id, isActive: next })
      toast.success(next ? 'เปิดใช้งานบัญชีแล้ว' : 'ปิดใช้งานบัญชีแล้ว ผู้ใช้จะเข้าสู่ระบบไม่ได้')
      if (data?.warning) toast.info(data.warning)
      setToggleTarget(null)
      afterChange()
    } catch (err) {
      toast.error(getErrorMessage(err, 'เปลี่ยนสถานะบัญชีไม่สำเร็จ'))
    }
  }

  return (
    <>
      <PageHeader
        title="พนักงาน"
        description={
          isSuperAdmin
            ? 'จัดการบัญชี บทบาท และการเปิด/ปิดใช้งานของทุกบัญชี'
            : 'Admin จัดการได้เฉพาะบัญชี Staff'
        }
        actions={
          <>
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={reload}
              disabled={state.loading}
              aria-label="โหลดข้อมูลล่าสุด"
            >
              <RefreshCw size={16} className={state.loading ? 'animate-spin' : ''} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="btn btn-primary inline-flex items-center gap-2"
              onClick={() => setModal({ type: 'create', employee: null })}
            >
              <UserPlus size={16} aria-hidden="true" />
              เพิ่มพนักงาน
            </button>
          </>
        }
      />

      <Card className="mb-4">
        <div className="grid gap-3 md:grid-cols-4">
          <SearchInput
            className="md:col-span-2"
            value={search}
            onChange={setSearch}
            placeholder="ค้นหาชื่อ อีเมล หรือเบอร์โทร"
            label="ค้นหาพนักงาน"
          />
          <div>
            <label htmlFor="emp-role-filter" className="sr-only">
              บทบาท
            </label>
            <select id="emp-role-filter" className="form-select" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
              <option value="">ทุกบทบาท</option>
              {Object.entries(ROLES).map(([value, meta]) => (
                <option key={value} value={value}>
                  {meta.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="emp-status-filter" className="sr-only">
              สถานะบัญชี
            </label>
            <select
              id="emp-status-filter"
              className="form-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">ทุกสถานะ</option>
              <option value="active">ใช้งาน</option>
              <option value="inactive">ปิดใช้งาน</option>
            </select>
          </div>
        </div>
        {authInfoError && <p className="mt-3 mb-0 text-xs text-warning">ไม่สามารถโหลดเวลาเข้าสู่ระบบล่าสุด: {authInfoError}</p>}
      </Card>

      <Card flush>
        {state.error && !state.loading ? (
          <ErrorState message={state.error} onRetry={reload} />
        ) : state.loading && rows.length === 0 ? (
          <LoadingState />
        ) : filtered.length === 0 ? (
          <EmptyState icon={UserCog} title="ไม่พบพนักงานตามเงื่อนไข" />
        ) : (
          <div className={state.loading ? 'opacity-60' : ''} aria-busy={state.loading}>
            <TableWrap minWidth={940}>
              <table className="table align-middle">
                <thead>
                  <tr>
                    <th scope="col" className="pl-5">
                      พนักงาน
                    </th>
                    <th scope="col">เบอร์โทรศัพท์</th>
                    <th scope="col">บทบาท</th>
                    <th scope="col">สถานะ</th>
                    <th scope="col">เข้าสู่ระบบล่าสุด</th>
                    <th scope="col" className="pr-5 text-right">
                      <span className="sr-only">การดำเนินการ</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => {
                    const isSelf = row.id === profile?.id
                    const manageable = canManageTarget(profile, row)
                    const info = authInfo[row.id]
                    const pendingInvite = info?.invited_at && !info?.last_sign_in_at
                    const name = row.full_name || 'ไม่ระบุชื่อ'
                    return (
                      <tr key={row.id}>
                        <td className="pl-5">
                          <div className="flex items-center gap-3">
                            <Avatar name={row.full_name || row.email} url={row.avatar_url} size={36} />
                            <div className="min-w-0">
                              <div className="truncate font-medium">
                                {name}
                                {isSelf && <span className="text-sm font-normal text-muted"> (คุณ)</span>}
                              </div>
                              <div className="truncate text-sm text-muted">{row.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="text-sm">{row.phone || '-'}</td>
                        <td>
                          <Badge tone={ROLE_TONE[row.role]}>{ROLES[row.role]?.label || row.role}</Badge>
                        </td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            <Badge tone={row.is_active ? 'success' : 'danger'} dot>
                              {row.is_active ? 'ใช้งาน' : 'ปิดใช้งาน'}
                            </Badge>
                            {pendingInvite && <Badge tone="warning">รอตอบรับคำเชิญ</Badge>}
                          </div>
                        </td>
                        <td className="text-sm whitespace-nowrap">
                          {info?.last_sign_in_at ? formatDate(info.last_sign_in_at, true) : '-'}
                        </td>
                        <td className="pr-5 text-right whitespace-nowrap">
                          <div className="inline-flex gap-1">
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-secondary"
                              onClick={() => setModal({ type: 'activity', employee: row })}
                              aria-label={`ประวัติการใช้งานของ ${name}`}
                              title="ประวัติการใช้งาน"
                            >
                              <History size={14} aria-hidden="true" />
                            </button>
                            {manageable && (
                              <>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline-secondary"
                                  onClick={() => setModal({ type: 'edit', employee: row })}
                                  aria-label={`แก้ไข ${name}`}
                                  title="แก้ไข"
                                >
                                  <Pencil size={14} aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline-secondary"
                                  onClick={() => setModal({ type: 'password', employee: row })}
                                  aria-label={`รหัสผ่านของ ${name}`}
                                  title="รหัสผ่าน"
                                >
                                  <KeyRound size={14} aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  className={`btn btn-sm ${row.is_active ? 'btn-outline-danger' : 'btn-outline-secondary'}`}
                                  onClick={() => setToggleTarget(row)}
                                  aria-label={`${row.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'} ${name}`}
                                  title={row.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                                >
                                  <Power size={14} aria-hidden="true" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </TableWrap>
          </div>
        )}
      </Card>

      <p className="mt-3 mb-0 text-xs text-muted">
        การลบบัญชีไม่ได้เปิดให้ทำในระบบ เพื่อรักษาความเชื่อมโยงกับงานและประวัติการเงิน ใช้การปิดใช้งานแทน
      </p>

      <EmployeeFormModal
        open={modal?.type === 'create' || modal?.type === 'edit'}
        mode={modal?.type}
        employee={modal?.employee ?? null}
        actor={profile}
        onClose={() => setModal(null)}
        onSaved={afterChange}
      />
      <PasswordModal open={modal?.type === 'password'} employee={modal?.employee ?? null} onClose={() => setModal(null)} />
      <ActivityModal
        open={modal?.type === 'activity'}
        employee={modal?.employee ?? null}
        isSuperAdmin={isSuperAdmin}
        onClose={() => setModal(null)}
      />
      <ConfirmDialog
        open={Boolean(toggleTarget)}
        tone={toggleTarget?.is_active ? 'danger' : 'primary'}
        title={toggleTarget?.is_active ? 'ปิดใช้งานบัญชี' : 'เปิดใช้งานบัญชี'}
        message={
          toggleTarget
            ? toggleTarget.is_active
              ? `${toggleTarget.full_name || toggleTarget.email} จะเข้าสู่ระบบและเข้าถึงข้อมูลไม่ได้ทันที งานและประวัติเดิมยังอยู่ครบ`
              : `${toggleTarget.full_name || toggleTarget.email} จะกลับมาใช้งานระบบได้ตามบทบาทเดิม`
            : ''
        }
        confirmLabel={toggleTarget?.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
        onConfirm={confirmToggle}
        onCancel={() => setToggleTarget(null)}
      />
    </>
  )
}

/* ================================ เพิ่ม / แก้ไขพนักงาน ================================ */

const EMPTY_FORM = { method: 'password', email: '', fullName: '', phone: '', role: 'staff', password: '', confirm: '', isActive: true }

function EmployeeFormModal({ open, mode, employee, actor, onClose, onSaved }) {
  const toast = useToast()
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const isCreate = mode === 'create'
  const roleOptions = actor?.role === 'super_admin' ? Object.keys(ROLES) : ['staff']

  useEffect(() => {
    if (!open) return
    setErrors({})
    setForm(
      !isCreate && employee
        ? { ...EMPTY_FORM, fullName: employee.full_name || '', phone: employee.phone || '', role: employee.role }
        : EMPTY_FORM,
    )
  }, [open, isCreate, employee])

  const set = (key) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value
    setForm((current) => ({ ...current, [key]: value }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (saving) return
    const next = {}
    const fullName = form.fullName.trim()
    const phone = form.phone.trim()
    if (!fullName) next.fullName = 'กรุณากรอกชื่อ-นามสกุล'
    else if (fullName.length > 150) next.fullName = 'ชื่อยาวเกิน 150 ตัวอักษร'
    if (phone && !PHONE_PATTERN.test(phone)) next.phone = 'เบอร์โทรศัพท์ใช้ได้เฉพาะตัวเลข เว้นวรรค + - ( )'
    if (!roleOptions.includes(form.role)) next.role = 'บทบาทไม่ถูกต้อง'
    if (isCreate) {
      if (!EMAIL_PATTERN.test(form.email.trim())) next.email = 'กรุณากรอกอีเมลให้ถูกต้อง'
      if (form.method === 'password') {
        const passwordError = validatePassword(form.password)
        if (passwordError) next.password = passwordError
        else if (form.password !== form.confirm) next.confirm = 'รหัสผ่านไม่ตรงกัน'
      }
    }
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setSaving(true)
    try {
      if (isCreate) {
        await callManageEmployee({
          action: 'create',
          method: form.method,
          email: form.email.trim().toLowerCase(),
          password: form.method === 'password' ? form.password : undefined,
          redirectTo: form.method === 'invite' ? setPasswordRedirect() : undefined,
          fullName,
          phone: phone || null,
          role: form.role,
          isActive: form.isActive,
        })
        toast.success(form.method === 'invite' ? 'ส่งคำเชิญทางอีเมลแล้ว' : 'สร้างบัญชีพนักงานแล้ว')
      } else {
        const payload = { action: 'update', userId: employee.id, fullName, phone: phone || null }
        if (form.role !== employee.role) payload.role = form.role
        await callManageEmployee(payload)
        toast.success('บันทึกข้อมูลพนักงานแล้ว')
      }
      onSaved?.()
    } catch (err) {
      toast.error(getErrorMessage(err, 'ดำเนินการไม่สำเร็จ'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={saving}
      title={isCreate ? 'เพิ่มพนักงาน' : `แก้ไข: ${employee?.full_name || employee?.email || ''}`}
      description={isCreate ? 'บัญชีถูกสร้างผ่าน Backend ที่ตรวจสิทธิ์แล้ว ผู้ใช้กำหนดบทบาทเองไม่ได้' : employee?.email}
      footer={
        <>
          <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>
            ยกเลิก
          </button>
          <button type="submit" form="employee-form" className="btn btn-primary inline-flex items-center gap-2" disabled={saving}>
            {saving && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
            {isCreate ? (form.method === 'invite' ? 'ส่งคำเชิญ' : 'สร้างบัญชี') : 'บันทึก'}
          </button>
        </>
      }
    >
      <form id="employee-form" onSubmit={handleSubmit} noValidate>
        {isCreate && (
          <fieldset className="mb-4">
            <legend className="form-label font-medium">วิธีสร้างบัญชี</legend>
            <div className="form-check">
              <input
                id="emp-method-password"
                type="radio"
                name="emp-method"
                className="form-check-input"
                value="password"
                checked={form.method === 'password'}
                onChange={set('method')}
              />
              <label htmlFor="emp-method-password" className="form-check-label">
                กำหนดรหัสผ่านเริ่มต้น แล้วแจ้งพนักงานเอง
              </label>
            </div>
            <div className="form-check">
              <input
                id="emp-method-invite"
                type="radio"
                name="emp-method"
                className="form-check-input"
                value="invite"
                checked={form.method === 'invite'}
                onChange={set('method')}
              />
              <label htmlFor="emp-method-invite" className="form-check-label">
                ส่งคำเชิญทางอีเมล ให้พนักงานตั้งรหัสผ่านเอง (ต้องตั้งค่า SMTP)
              </label>
            </div>
          </fieldset>
        )}

        {isCreate && (
          <Field label="อีเมล" htmlFor="emp-email" error={errors.email} required>
            <input
              type="email"
              inputMode="email"
              className="form-control"
              value={form.email}
              onChange={set('email')}
              autoComplete="off"
              data-autofocus
              {...fieldA11y('emp-email', errors.email)}
            />
          </Field>
        )}

        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label="ชื่อ-นามสกุล" htmlFor="emp-name" error={errors.fullName} required>
            <input
              className="form-control"
              value={form.fullName}
              onChange={set('fullName')}
              maxLength={150}
              data-autofocus={isCreate ? undefined : true}
              {...fieldA11y('emp-name', errors.fullName)}
            />
          </Field>
          <Field label="เบอร์โทรศัพท์" htmlFor="emp-phone" error={errors.phone}>
            <input
              type="tel"
              className="form-control"
              value={form.phone}
              onChange={set('phone')}
              maxLength={25}
              {...fieldA11y('emp-phone', errors.phone)}
            />
          </Field>
        </div>

        <Field label="บทบาท" htmlFor="emp-role" error={errors.role} hint={ROLE_HINT[form.role]} required>
          <select
            className="form-select"
            value={form.role}
            onChange={set('role')}
            disabled={roleOptions.length === 1}
            {...fieldA11y('emp-role', errors.role, true)}
          >
            {roleOptions.map((value) => (
              <option key={value} value={value}>
                {ROLES[value].label}
              </option>
            ))}
          </select>
        </Field>

        {isCreate && form.method === 'password' && (
          <div className="grid gap-x-4 sm:grid-cols-2">
            <Field label="รหัสผ่านเริ่มต้น" htmlFor="emp-password" error={errors.password} required>
              <input
                type="password"
                className="form-control"
                value={form.password}
                onChange={set('password')}
                autoComplete="new-password"
                {...fieldA11y('emp-password', errors.password)}
              />
            </Field>
            <Field label="ยืนยันรหัสผ่าน" htmlFor="emp-confirm" error={errors.confirm} required>
              <input
                type="password"
                className="form-control"
                value={form.confirm}
                onChange={set('confirm')}
                autoComplete="new-password"
                {...fieldA11y('emp-confirm', errors.confirm)}
              />
            </Field>
          </div>
        )}

        {isCreate && (
          <div className="form-check mb-0">
            <input id="emp-active" type="checkbox" className="form-check-input" checked={form.isActive} onChange={set('isActive')} />
            <label htmlFor="emp-active" className="form-check-label">
              เปิดใช้งานบัญชีทันที
            </label>
          </div>
        )}
        {!isCreate && (
          <p className="m-0 text-xs text-muted">เปิด/ปิดใช้งานบัญชีใช้ปุ่ม Power ในตาราง ส่วนรหัสผ่านใช้ปุ่มกุญแจ</p>
        )}
      </form>
    </Modal>
  )
}

/* ================================ รหัสผ่าน ================================ */

function PasswordModal({ open, employee, onClose }) {
  const toast = useToast()
  const [method, setMethod] = useState('send')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setMethod('send')
    setPassword('')
    setConfirm('')
    setErrors({})
  }, [open])

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (saving || !employee) return
    const next = {}
    if (method === 'set') {
      const passwordError = validatePassword(password)
      if (passwordError) next.password = passwordError
      else if (password !== confirm) next.confirm = 'รหัสผ่านไม่ตรงกัน'
    }
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setSaving(true)
    try {
      if (method === 'set') {
        await callManageEmployee({ action: 'set_password', userId: employee.id, password })
        toast.success('ตั้งรหัสผ่านใหม่แล้ว กรุณาแจ้งพนักงานผ่านช่องทางที่ปลอดภัย')
      } else {
        await callManageEmployee({ action: 'send_reset', userId: employee.id, redirectTo: setPasswordRedirect() })
        toast.success(`ส่งลิงก์ตั้งรหัสผ่านไปที่ ${employee.email} แล้ว`)
      }
      onClose()
    } catch (err) {
      toast.error(getErrorMessage(err, 'ดำเนินการไม่สำเร็จ'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={saving}
      title="รหัสผ่านของพนักงาน"
      description={employee ? `${employee.full_name || ''} · ${employee.email}` : undefined}
      footer={
        <>
          <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>
            ยกเลิก
          </button>
          <button type="submit" form="password-form" className="btn btn-primary inline-flex items-center gap-2" disabled={saving}>
            {saving && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
            {method === 'set' ? 'ตั้งรหัสผ่าน' : 'ส่งลิงก์'}
          </button>
        </>
      }
    >
      <form id="password-form" onSubmit={handleSubmit} noValidate>
        <fieldset className="mb-4">
          <legend className="sr-only">วิธีเปลี่ยนรหัสผ่าน</legend>
          <div className="form-check">
            <input
              id="pw-send"
              type="radio"
              name="pw-method"
              className="form-check-input"
              checked={method === 'send'}
              onChange={() => setMethod('send')}
            />
            <label htmlFor="pw-send" className="form-check-label">
              ส่งลิงก์ตั้งรหัสผ่านทางอีเมล (แนะนำ ต้องตั้งค่า SMTP)
            </label>
          </div>
          <div className="form-check">
            <input
              id="pw-set"
              type="radio"
              name="pw-method"
              className="form-check-input"
              checked={method === 'set'}
              onChange={() => setMethod('set')}
            />
            <label htmlFor="pw-set" className="form-check-label">
              กำหนดรหัสผ่านใหม่ให้ทันที
            </label>
          </div>
        </fieldset>
        {method === 'set' && (
          <div className="grid gap-x-4 sm:grid-cols-2">
            <Field label="รหัสผ่านใหม่" htmlFor="pw-new" error={errors.password} required>
              <input
                type="password"
                className="form-control"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                {...fieldA11y('pw-new', errors.password)}
              />
            </Field>
            <Field label="ยืนยันรหัสผ่าน" htmlFor="pw-confirm" error={errors.confirm} required>
              <input
                type="password"
                className="form-control"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                {...fieldA11y('pw-confirm', errors.confirm)}
              />
            </Field>
          </div>
        )}
        <p className="m-0 text-xs text-muted">ทุกการดำเนินการถูกบันทึกใน Audit Log พร้อมชื่อผู้ดำเนินการ</p>
      </form>
    </Modal>
  )
}

/* ================================ ประวัติการใช้งาน ================================ */

function ActivityModal({ open, employee, isSuperAdmin, onClose }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || !employee) return undefined
    let active = true
    setData(null)
    setError('')
    Promise.all([
      supabase
        .from('job_updates')
        .select('id, update_type, from_status, to_status, message, created_at, job:jobs(id, job_number)')
        .eq('author_id', employee.id)
        .order('created_at', { ascending: false })
        .limit(30)
        .then(unwrap),
      isSuperAdmin
        ? supabase
            .from('audit_logs')
            .select('id, created_at, action, table_name, record_id')
            .eq('actor_id', employee.id)
            .order('created_at', { ascending: false })
            .limit(30)
            .then(unwrap)
        : Promise.resolve(null),
    ])
      .then(([updates, audits]) => active && setData({ updates: updates ?? [], audits }))
      .catch((err) => active && setError(getErrorMessage(err, 'โหลดประวัติไม่สำเร็จ')))
    return () => {
      active = false
    }
  }, [open, employee, isSuperAdmin])

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={`ประวัติการใช้งาน: ${employee?.full_name || employee?.email || ''}`}
      footer={
        <button type="button" className="btn btn-outline-secondary" onClick={onClose}>
          ปิด
        </button>
      }
    >
      {error ? (
        <ErrorState message={error} />
      ) : !data ? (
        <LoadingState />
      ) : (
        <div className="space-y-5">
          <section>
            <h3 className="mt-0 mb-2 text-sm font-semibold">การดำเนินงานในงานบริการ (30 รายการล่าสุด)</h3>
            {data.updates.length === 0 ? (
              <p className="m-0 text-sm text-muted">ยังไม่มีประวัติ</p>
            ) : (
              <ul className="m-0 list-none divide-y divide-line p-0">
                {data.updates.map((update) => {
                  const text = describeJobUpdate(update)
                  return (
                    <li key={update.id} className="py-2 text-sm">
                      <div className="flex flex-wrap justify-between gap-2">
                        <span>
                          {update.job && (
                            <Link to={`/jobs/${update.job.id}`} className="mr-2 font-medium no-underline">
                              {update.job.job_number}
                            </Link>
                          )}
                          {text.title}
                        </span>
                        <span className="text-xs text-muted">{formatDate(update.created_at, true)}</span>
                      </div>
                      {text.body && <div className="line-clamp-2 text-muted">{text.body}</div>}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {data.audits && (
            <section>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="m-0 text-sm font-semibold">Audit Log (30 รายการล่าสุด)</h3>
                <Link to={`/reports?tab=audit&actor=${employee.id}`} className="text-sm no-underline">
                  ดูทั้งหมด
                </Link>
              </div>
              {data.audits.length === 0 ? (
                <p className="m-0 text-sm text-muted">ยังไม่มีประวัติ</p>
              ) : (
                <ul className="m-0 list-none divide-y divide-line p-0">
                  {data.audits.map((log) => (
                    <li key={log.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                      <span>
                        <Badge tone="neutral">{log.action}</Badge> <span className="ml-1 font-medium">{log.table_name}</span>
                      </span>
                      <span className="text-xs text-muted">{formatDate(log.created_at, true)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      )}
    </Modal>
  )
}