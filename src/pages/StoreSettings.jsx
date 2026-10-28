import { useCallback, useEffect, useRef, useState } from 'react'
import { ImagePlus, Loader2, Lock, Plus, Save, Store, Trash2 } from 'lucide-react'
import { useAuth } from '../lib/auth.jsx'
import { getErrorMessage, supabase } from '../lib/supabase.js'
import { STORE_UPDATED_EVENT, formatDate, usePageTitle } from '../lib/utils.js'
import { Card, ConfirmDialog, ErrorState, Field, LoadingState, PageHeader, fieldA11y, useToast } from '../components/UI.jsx'
import { unwrap } from '../components/Forms.jsx'

const STORE_COLUMNS =
  'id, store_name, logo_path, address, phone, email, website, business_hours, contact_channels, description, tax_id, document_header, document_footer, payment_instructions, updated_at'
const FLAG_KEYS = ['admin_can_manage_store', 'admin_can_manage_policies']
const LOGO_BUCKET = 'store-assets'
const LOGO_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const LOGO_MAX_BYTES = 2 * 1024 * 1024
const MAX_CHANNELS = 10
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_PATTERN = /^[0-9+() -]{6,25}$/
const CHANNEL_TYPES = {
  line: 'LINE',
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  map: 'แผนที่',
  other: 'อื่น ๆ',
}

const EMPTY_FORM = {
  storeName: '',
  taxId: '',
  phone: '',
  email: '',
  website: '',
  businessHours: '',
  address: '',
  description: '',
  documentHeader: '',
  documentFooter: '',
  paymentInstructions: '',
}

let channelSeq = 0
function withKey(channel) {
  channelSeq += 1
  return { type: 'other', label: '', value: '', ...channel, _key: channelSeq }
}

function isHttpUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function notifyStoreChanged() {
  window.dispatchEvent(new Event(STORE_UPDATED_EVENT))
}

export default function StoreSettings() {
  usePageTitle('ข้อมูลร้าน')
  const { isAdmin, isSuperAdmin } = useAuth()
  const toast = useToast()
  const logoInputRef = useRef(null)

  const [store, setStore] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [channels, setChannels] = useState([])
  const [flags, setFlags] = useState({ admin_can_manage_store: false, admin_can_manage_policies: false })
  const [state, setState] = useState({ loading: true, error: '' })
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [logoBusy, setLogoBusy] = useState(false)
  const [removeLogoOpen, setRemoveLogoOpen] = useState(false)
  const [flagBusy, setFlagBusy] = useState('')

  const canEdit = isSuperAdmin || (isAdmin && flags.admin_can_manage_store)

  const applyStore = (data) => {
    setStore(data)
    setForm({
      storeName: data.store_name || '',
      taxId: data.tax_id || '',
      phone: data.phone || '',
      email: data.email || '',
      website: data.website || '',
      businessHours: data.business_hours || '',
      address: data.address || '',
      description: data.description || '',
      documentHeader: data.document_header || '',
      documentFooter: data.document_footer || '',
      paymentInstructions: data.payment_instructions || '',
    })
    setChannels((Array.isArray(data.contact_channels) ? data.contact_channels : []).map(withKey))
  }

  const load = useCallback(async () => {
    setState({ loading: true, error: '' })
    try {
      const [storeData, settingRows] = await Promise.all([
        supabase.from('store_settings').select(STORE_COLUMNS).eq('id', 1).maybeSingle().then(unwrap),
        supabase.from('app_settings').select('key, value').in('key', FLAG_KEYS).then(unwrap),
      ])
      if (!storeData) throw new Error('ไม่พบข้อมูลร้าน กรุณาตรวจสอบว่ารัน Migration 001 แล้ว')
      applyStore(storeData)
      const map = Object.fromEntries((settingRows ?? []).map((row) => [row.key, row.value === true]))
      setFlags({
        admin_can_manage_store: Boolean(map.admin_can_manage_store),
        admin_can_manage_policies: Boolean(map.admin_can_manage_policies),
      })
      setState({ loading: false, error: '' })
    } catch (err) {
      setState({ loading: false, error: getErrorMessage(err, 'โหลดข้อมูลร้านไม่สำเร็จ') })
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))

  const logoUrl = store?.logo_path
    ? `${supabase.storage.from(LOGO_BUCKET).getPublicUrl(store.logo_path).data.publicUrl}?v=${encodeURIComponent(store.updated_at || '')}`
    : null

  const handleLogo = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!LOGO_TYPES[file.type] || file.size > LOGO_MAX_BYTES) {
      toast.error('โลโก้ต้องเป็น JPG, PNG หรือ WebP ขนาดไม่เกิน 2 MB')
      return
    }
    setLogoBusy(true)
    const oldPath = store?.logo_path
    try {
      const path = `logo-${Date.now()}.${LOGO_TYPES[file.type]}`
      const { error: uploadError } = await supabase.storage
        .from(LOGO_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false })
      if (uploadError) throw uploadError
      const data = await supabase
        .from('store_settings')
        .update({ logo_path: path })
        .eq('id', 1)
        .select(STORE_COLUMNS)
        .maybeSingle()
        .then(unwrap)
      if (!data) {
        await supabase.storage.from(LOGO_BUCKET).remove([path])
        throw new Error('คุณไม่มีสิทธิ์แก้ไขข้อมูลร้าน')
      }
      if (oldPath) await supabase.storage.from(LOGO_BUCKET).remove([oldPath])
      setStore(data)
      toast.success('เปลี่ยนโลโก้ร้านแล้ว')
      notifyStoreChanged()
    } catch (err) {
      toast.error(getErrorMessage(err, 'อัปโหลดโลโก้ไม่สำเร็จ'))
    } finally {
      setLogoBusy(false)
    }
  }

  const removeLogo = async () => {
    const oldPath = store?.logo_path
    const { data, error } = await supabase
      .from('store_settings')
      .update({ logo_path: null })
      .eq('id', 1)
      .select(STORE_COLUMNS)
      .maybeSingle()
    if (error || !data) {
      toast.error(getErrorMessage(error, 'ลบโลโก้ไม่สำเร็จ'))
      return
    }
    if (oldPath) await supabase.storage.from(LOGO_BUCKET).remove([oldPath])
    setStore(data)
    setRemoveLogoOpen(false)
    toast.success('ลบโลโก้แล้ว')
    notifyStoreChanged()
  }

  const updateChannel = (key, field, value) =>
    setChannels((list) => list.map((item) => (item._key === key ? { ...item, [field]: value } : item)))

  const validate = () => {
    const next = {}
    if (!form.storeName.trim()) next.storeName = 'กรุณากรอกชื่อร้าน'
    else if (form.storeName.trim().length > 150) next.storeName = 'ชื่อร้านยาวเกิน 150 ตัวอักษร'
    if (form.phone.trim() && !PHONE_PATTERN.test(form.phone.trim())) next.phone = 'เบอร์โทรศัพท์ไม่ถูกต้อง'
    if (form.email.trim() && !EMAIL_PATTERN.test(form.email.trim())) next.email = 'รูปแบบอีเมลไม่ถูกต้อง'
    if (form.website.trim() && !isHttpUrl(form.website.trim())) next.website = 'ต้องขึ้นต้นด้วย https:// หรือ http://'
    channels.forEach((channel) => {
      if (!channel.value.trim()) return
      if (channel.label.length > 50 || channel.value.length > 300) {
        next[`channel-${channel._key}`] = 'ป้ายกำกับไม่เกิน 50 และข้อมูลติดต่อไม่เกิน 300 ตัวอักษร'
      }
    })
    return next
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!canEdit || saving) return
    const next = validate()
    setErrors(next)
    if (Object.keys(next).length > 0) {
      toast.error('กรุณาตรวจสอบข้อมูลที่ไฮไลต์')
      return
    }
    const payload = {
      store_name: form.storeName.trim(),
      tax_id: form.taxId.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      website: form.website.trim() || null,
      business_hours: form.businessHours.trim() || null,
      address: form.address.trim() || null,
      description: form.description.trim() || null,
      document_header: form.documentHeader.trim() || null,
      document_footer: form.documentFooter.trim() || null,
      payment_instructions: form.paymentInstructions.trim() || null,
      contact_channels: channels
        .filter((channel) => channel.value.trim())
        .map((channel) => ({
          type: CHANNEL_TYPES[channel.type] ? channel.type : 'other',
          label: channel.label.trim() || CHANNEL_TYPES[channel.type] || 'อื่น ๆ',
          value: channel.value.trim(),
        })),
    }
    setSaving(true)
    const { data, error } = await supabase.from('store_settings').update(payload).eq('id', 1).select(STORE_COLUMNS).maybeSingle()
    setSaving(false)
    if (error || !data) {
      toast.error(getErrorMessage(error, 'บันทึกไม่สำเร็จ หรือคุณไม่มีสิทธิ์แก้ไขข้อมูลร้าน'))
      return
    }
    applyStore(data)
    toast.success('บันทึกข้อมูลร้านแล้ว')
    notifyStoreChanged()
  }

  const toggleFlag = async (key, value) => {
    setFlagBusy(key)
    const { data, error } = await supabase.from('app_settings').update({ value }).eq('key', key).select('key')
    setFlagBusy('')
    if (error || !data?.length) {
      toast.error(getErrorMessage(error, 'บันทึกสิทธิ์ไม่สำเร็จ'))
      return
    }
    setFlags((current) => ({ ...current, [key]: value }))
    toast.success('บันทึกสิทธิ์ของ Admin แล้ว')
  }

  if (state.loading) {
    return (
      <>
        <PageHeader title="ข้อมูลร้าน" />
        <LoadingState />
      </>
    )
  }
  if (state.error) {
    return (
      <Card>
        <ErrorState message={state.error} onRetry={load} />
      </Card>
    )
  }

  return (
    <>
      <PageHeader
        title="ข้อมูลร้าน"
        description="ใช้แสดงในระบบ ใบเสนอราคา และเอกสารการชำระเงิน แก้ไขที่นี่ที่เดียว"
        actions={
          canEdit && (
            <button type="submit" form="store-form" className="btn btn-primary inline-flex items-center gap-2" disabled={saving}>
              {saving ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
              บันทึก
            </button>
          )
        }
      />

      {!canEdit && (
        <div className="alert alert-secondary flex items-start gap-2 text-sm" role="status">
          <Lock size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          คุณดูข้อมูลได้อย่างเดียว Super Admin ต้องเปิดสิทธิ์ "Admin จัดการข้อมูลร้าน" ก่อนจึงจะแก้ไขได้
        </div>
      )}

      <div className="space-y-4">
        <Card>
          <h2 className="mt-0 mb-4 text-base font-semibold">โลโก้ร้าน</h2>
          <div className="flex flex-wrap items-center gap-4">
            {logoUrl ? (
              <img src={logoUrl} alt="โลโก้ร้านปัจจุบัน" className="h-16 w-16 rounded-xl border border-line object-cover" />
            ) : (
              <span className="flex h-16 w-16 items-center justify-center rounded-xl bg-fill text-muted">
                <Store size={24} aria-hidden="true" />
              </span>
            )}
            {canEdit && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary inline-flex items-center gap-1.5"
                  onClick={() => logoInputRef.current?.click()}
                  disabled={logoBusy}
                >
                  {logoBusy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <ImagePlus size={15} aria-hidden="true" />}
                  เปลี่ยนโลโก้
                </button>
                {store?.logo_path && (
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-danger inline-flex items-center gap-1.5"
                    onClick={() => setRemoveLogoOpen(true)}
                    disabled={logoBusy}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                    ลบโลโก้
                  </button>
                )}
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handleLogo}
                  aria-label="เลือกไฟล์โลโก้"
                />
              </div>
            )}
          </div>
          <p className="mt-2 mb-0 text-xs text-muted">JPG, PNG หรือ WebP ไม่เกิน 2 MB แนะนำภาพสี่เหลี่ยมจัตุรัส</p>
        </Card>

        <form id="store-form" onSubmit={handleSubmit} noValidate>
          <fieldset disabled={!canEdit || saving} className="space-y-4">
            <Card>
              <h2 className="mt-0 mb-4 text-base font-semibold">ข้อมูลทั่วไป</h2>
              <div className="grid gap-x-4 md:grid-cols-2">
                <Field label="ชื่อร้าน" htmlFor="store-name" error={errors.storeName} required>
                  <input
                    className="form-control"
                    value={form.storeName}
                    onChange={set('storeName')}
                    maxLength={150}
                    {...fieldA11y('store-name', errors.storeName)}
                  />
                </Field>
                <Field label="เลขประจำตัวผู้เสียภาษี" htmlFor="store-tax">
                  <input id="store-tax" className="form-control" value={form.taxId} onChange={set('taxId')} maxLength={30} />
                </Field>
                <Field label="เบอร์โทรศัพท์" htmlFor="store-phone" error={errors.phone}>
                  <input
                    type="tel"
                    className="form-control"
                    value={form.phone}
                    onChange={set('phone')}
                    maxLength={25}
                    {...fieldA11y('store-phone', errors.phone)}
                  />
                </Field>
                <Field label="อีเมล" htmlFor="store-email" error={errors.email}>
                  <input
                    type="email"
                    className="form-control"
                    value={form.email}
                    onChange={set('email')}
                    maxLength={200}
                    {...fieldA11y('store-email', errors.email)}
                  />
                </Field>
                <Field label="เว็บไซต์" htmlFor="store-website" error={errors.website}>
                  <input
                    type="url"
                    className="form-control"
                    value={form.website}
                    onChange={set('website')}
                    maxLength={200}
                    placeholder="https://"
                    {...fieldA11y('store-website', errors.website)}
                  />
                </Field>
                <Field label="เวลาทำการ" htmlFor="store-hours">
                  <input
                    id="store-hours"
                    className="form-control"
                    value={form.businessHours}
                    onChange={set('businessHours')}
                    maxLength={200}
                    placeholder="เช่น จันทร์–เสาร์ 09:00–18:00"
                  />
                </Field>
              </div>
              <Field label="ที่อยู่ร้าน" htmlFor="store-address">
                <textarea id="store-address" className="form-control" rows={3} value={form.address} onChange={set('address')} maxLength={1000} />
              </Field>
              <Field label="รายละเอียดเพิ่มเติม" htmlFor="store-description">
                <textarea
                  id="store-description"
                  className="form-control"
                  rows={2}
                  value={form.description}
                  onChange={set('description')}
                  maxLength={1000}
                />
              </Field>
            </Card>

            <Card>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="m-0 text-base font-semibold">ช่องทางติดต่อ</h2>
                {canEdit && channels.length < MAX_CHANNELS && (
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary inline-flex items-center gap-1.5"
                    onClick={() => setChannels((list) => [...list, withKey({ type: 'line' })])}
                  >
                    <Plus size={15} aria-hidden="true" />
                    เพิ่มช่องทาง
                  </button>
                )}
              </div>
              {channels.length === 0 ? (
                <p className="m-0 text-sm text-muted">ยังไม่มีช่องทางติดต่อเพิ่มเติม เช่น LINE, Facebook หรือลิงก์แผนที่</p>
              ) : (
                <ul className="m-0 list-none space-y-3 p-0">
                  {channels.map((channel, index) => {
                    const error = errors[`channel-${channel._key}`]
                    return (
                      <li key={channel._key}>
                        <div className="grid gap-2 sm:grid-cols-[150px_180px_1fr_auto]">
                          <label htmlFor={`ch-type-${channel._key}`} className="sr-only">
                            ประเภทช่องทางที่ {index + 1}
                          </label>
                          <select
                            id={`ch-type-${channel._key}`}
                            className="form-select"
                            value={channel.type}
                            onChange={(e) => updateChannel(channel._key, 'type', e.target.value)}
                          >
                            {Object.entries(CHANNEL_TYPES).map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                          <label htmlFor={`ch-label-${channel._key}`} className="sr-only">
                            ป้ายกำกับช่องทางที่ {index + 1}
                          </label>
                          <input
                            id={`ch-label-${channel._key}`}
                            className="form-control"
                            value={channel.label}
                            onChange={(e) => updateChannel(channel._key, 'label', e.target.value)}
                            placeholder="ป้ายกำกับ"
                            maxLength={50}
                          />
                          <label htmlFor={`ch-value-${channel._key}`} className="sr-only">
                            ข้อมูลติดต่อช่องทางที่ {index + 1}
                          </label>
                          <input
                            id={`ch-value-${channel._key}`}
                            className="form-control"
                            value={channel.value}
                            onChange={(e) => updateChannel(channel._key, 'value', e.target.value)}
                            placeholder="ลิงก์หรือ ID"
                            maxLength={300}
                            aria-invalid={error ? true : undefined}
                          />
                          {canEdit && (
                            <button
                              type="button"
                              className="btn btn-outline-danger"
                              onClick={() => setChannels((list) => list.filter((item) => item._key !== channel._key))}
                              aria-label={`ลบช่องทางที่ ${index + 1}`}
                            >
                              <Trash2 size={16} aria-hidden="true" />
                            </button>
                          )}
                        </div>
                        {error && <div className="mt-1 text-sm text-danger">{error}</div>}
                      </li>
                    )
                  })}
                </ul>
              )}
              <p className="mt-3 mb-0 text-xs text-muted">ช่องทางที่ไม่ได้กรอกข้อมูลติดต่อจะไม่ถูกบันทึก</p>
            </Card>

            <Card>
              <h2 className="mt-0 mb-4 text-base font-semibold">ข้อความบนใบเสนอราคาและเอกสารการชำระเงิน</h2>
              <div className="grid gap-x-4 md:grid-cols-2">
                <Field label="ข้อความส่วนหัว" htmlFor="doc-header">
                  <textarea
                    id="doc-header"
                    className="form-control"
                    rows={2}
                    value={form.documentHeader}
                    onChange={set('documentHeader')}
                    maxLength={500}
                  />
                </Field>
                <Field label="ข้อความส่วนท้าย" htmlFor="doc-footer">
                  <textarea
                    id="doc-footer"
                    className="form-control"
                    rows={2}
                    value={form.documentFooter}
                    onChange={set('documentFooter')}
                    maxLength={500}
                  />
                </Field>
              </div>
              <Field label="วิธีชำระเงิน / บัญชีรับโอน" htmlFor="doc-payment">
                <textarea
                  id="doc-payment"
                  className="form-control"
                  rows={3}
                  value={form.paymentInstructions}
                  onChange={set('paymentInstructions')}
                  maxLength={1000}
                  placeholder="เช่น ธนาคาร ชื่อบัญชี เลขที่บัญชี หรือพร้อมเพย์"
                />
              </Field>
            </Card>
          </fieldset>
        </form>

        <p className="m-0 text-xs text-muted">แก้ไขล่าสุด {formatDate(store?.updated_at, true)}</p>

        {isSuperAdmin && (
          <Card>
            <h2 className="mt-0 mb-1 text-base font-semibold">สิทธิ์ของ Admin (Super Admin เท่านั้น)</h2>
            <p className="mt-0 mb-4 text-sm text-muted">บันทึกทันทีเมื่อกด และมีผลกับ Admin ทุกคน (ตรวจสอบที่ Database)</p>
            <div className="space-y-3">
              {[
                ['admin_can_manage_store', 'Admin จัดการข้อมูลร้านและโลโก้ได้'],
                ['admin_can_manage_policies', 'Admin สร้างและแก้ไขข้อตกลงและนโยบายได้'],
              ].map(([key, label]) => (
                <div key={key} className="form-check form-switch">
                  <input
                    id={`flag-${key}`}
                    type="checkbox"
                    role="switch"
                    className="form-check-input"
                    checked={flags[key]}
                    disabled={flagBusy === key}
                    onChange={(e) => toggleFlag(key, e.target.checked)}
                  />
                  <label htmlFor={`flag-${key}`} className="form-check-label">
                    {label}
                  </label>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      <ConfirmDialog
        open={removeLogoOpen}
        title="ลบโลโก้ร้าน"
        message="ระบบจะกลับไปใช้ไอคอนเริ่มต้น และลบไฟล์โลโก้เดิมออกจาก Storage"
        confirmLabel="ลบโลโก้"
        onConfirm={removeLogo}
        onCancel={() => setRemoveLogoOpen(false)}
      />
    </>
  )
}