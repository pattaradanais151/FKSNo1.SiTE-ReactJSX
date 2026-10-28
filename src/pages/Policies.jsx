import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, FileText, History, Loader2, Lock, Pencil, Plus, Trash2 } from 'lucide-react'
import { useAuth } from '../lib/auth.jsx'
import { getErrorMessage, supabase } from '../lib/supabase.js'
import { formatDate, usePageTitle } from '../lib/utils.js'
import {
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
  fieldA11y,
  useToast,
} from '../components/UI.jsx'
import { unwrap, useProfileDirectory } from '../components/Forms.jsx'

const POLICY_TYPES = {
  terms_of_service: 'ข้อกำหนดการให้บริการ (Terms of Service)',
  privacy_policy: 'นโยบายความเป็นส่วนตัว (Privacy Policy)',
  pdpa_notice: 'ประกาศความเป็นส่วนตัว (PDPA / Privacy Notice)',
  service_agreement: 'สัญญาบริการ (Service Agreement)',
  warranty_claim_policy: 'นโยบายรับประกันและเคลม',
  payment_installment_policy: 'นโยบายการชำระเงินและผ่อนชำระ',
  cancellation_refund_policy: 'นโยบายการยกเลิกและคืนเงิน',
  cookie_policy: 'นโยบายคุกกี้ (Cookie Policy)',
  other: 'เอกสารอื่น ๆ',
}

const STATUS_META = {
  draft: { label: 'ฉบับร่าง', tone: 'warning' },
  published: { label: 'เผยแพร่', tone: 'success' },
  archived: { label: 'เก็บถาวร', tone: 'neutral' },
}

const POLICY_COLUMNS =
  'id, policy_type, title, body, version, effective_date, status, legal_reviewed, legal_reviewed_by, legal_reviewed_at, legal_review_note, created_by, updated_by, created_at, updated_at'
const VERSION_PATTERN = /^[0-9A-Za-z._-]{1,30}$/
const EMPTY_FORM = {
  policyType: 'terms_of_service',
  title: '',
  body: '',
  version: '1.0',
  effectiveDate: '',
  status: 'draft',
  legalReviewed: false,
  legalReviewNote: '',
}

export default function Policies() {
  usePageTitle('ข้อตกลงและนโยบาย')
  const { isAdmin, isSuperAdmin } = useAuth()
  const toast = useToast()
  const { map: people } = useProfileDirectory()
  const [rows, setRows] = useState([])
  const [flag, setFlag] = useState(false)
  const [state, setState] = useState({ loading: true, error: '' })
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [modal, setModal] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)

  const canEdit = isSuperAdmin || (isAdmin && flag)

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }))
    try {
      const [policyRows, flagRow] = await Promise.all([
        supabase.from('policies').select(POLICY_COLUMNS).order('policy_type').order('updated_at', { ascending: false }).then(unwrap),
        supabase.from('app_settings').select('value').eq('key', 'admin_can_manage_policies').maybeSingle().then(unwrap),
      ])
      setRows(policyRows ?? [])
      setFlag(flagRow?.value === true)
      setState({ loading: false, error: '' })
    } catch (err) {
      setState({ loading: false, error: getErrorMessage(err, 'โหลดเอกสารไม่สำเร็จ') })
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return rows.filter(
      (row) =>
        (!typeFilter || row.policy_type === typeFilter) &&
        (!statusFilter || row.status === statusFilter) &&
        (!term || row.title.toLowerCase().includes(term)),
    )
  }, [rows, search, typeFilter, statusFilter])

  const confirmDelete = async () => {
    const { data, error } = await supabase
      .from('policies')
      .delete()
      .eq('id', deleteTarget.id)
      .eq('status', 'draft')
      .select('id')
    if (error || !data?.length) {
      toast.error(getErrorMessage(error, 'ลบไม่สำเร็จ ลบได้เฉพาะฉบับร่าง'))
      return
    }
    toast.success('ลบฉบับร่างแล้ว')
    setDeleteTarget(null)
    load()
  }

  return (
    <>
      <PageHeader
        title="ข้อตกลงและนโยบาย"
        description="จัดเก็บเอกสาร เวอร์ชัน วันที่มีผล และสถานะการเผยแพร่"
        actions={
          canEdit && (
            <button
              type="button"
              className="btn btn-primary inline-flex items-center gap-2"
              onClick={() => setModal({ type: 'edit', policy: null })}
            >
              <Plus size={16} aria-hidden="true" />
              สร้างเอกสาร
            </button>
          )
        }
      />

      <div className="alert alert-warning flex items-start gap-2 text-sm" role="note">
        <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>
          ระบบไม่ได้สร้างหรือรับรองเนื้อหาทางกฎหมาย เอกสารทุกฉบับต้องให้ผู้เชี่ยวชาญตรวจสอบก่อนเผยแพร่ และระบบจะไม่ยอมให้เผยแพร่
          จนกว่าจะยืนยันว่าตรวจสอบแล้ว
        </span>
      </div>

      {!canEdit && (
        <div className="alert alert-secondary flex items-start gap-2 text-sm" role="status">
          <Lock size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          คุณดูเอกสารได้อย่างเดียว Super Admin ต้องเปิดสิทธิ์ "Admin สร้างและแก้ไขข้อตกลงและนโยบาย" ในหน้าข้อมูลร้าน
        </div>
      )}

      <Card className="mb-4">
        <div className="grid gap-3 md:grid-cols-4">
          <SearchInput className="md:col-span-2" value={search} onChange={setSearch} placeholder="ค้นหาชื่อเอกสาร" label="ค้นหาเอกสาร" />
          <div>
            <label htmlFor="pol-type-filter" className="sr-only">
              ประเภทเอกสาร
            </label>
            <select id="pol-type-filter" className="form-select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">ทุกประเภท</option>
              {Object.entries(POLICY_TYPES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="pol-status-filter" className="sr-only">
              สถานะ
            </label>
            <select id="pol-status-filter" className="form-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">ทุกสถานะ</option>
              {Object.entries(STATUS_META).map(([value, meta]) => (
                <option key={value} value={value}>
                  {meta.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      <Card flush>
        {state.error && !state.loading ? (
          <ErrorState message={state.error} onRetry={load} />
        ) : state.loading && rows.length === 0 ? (
          <LoadingState />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={rows.length === 0 ? 'ยังไม่มีเอกสาร' : 'ไม่พบเอกสารตามเงื่อนไข'}
            description={rows.length === 0 ? 'สร้างโครงเอกสาร แล้วนำเนื้อหาที่ผ่านการตรวจสอบมากรอก' : undefined}
          />
        ) : (
          <ul className="m-0 list-none divide-y divide-line p-0">
            {filtered.map((row) => {
              const status = STATUS_META[row.status] ?? STATUS_META.draft
              return (
                <li key={row.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="m-0 text-base font-semibold">{row.title}</h2>
                      <Badge tone={status.tone}>{status.label}</Badge>
                      <Badge>v{row.version}</Badge>
                      <Badge tone={row.legal_reviewed ? 'success' : 'danger'}>
                        {row.legal_reviewed ? 'ยืนยันการตรวจสอบกฎหมายแล้ว' : 'ยังไม่ตรวจสอบทางกฎหมาย'}
                      </Badge>
                    </div>
                    <div className="mt-1 text-sm text-muted">
                      {POLICY_TYPES[row.policy_type] ?? row.policy_type}
                      {row.effective_date ? ` · มีผล ${formatDate(row.effective_date)}` : ''}
                    </div>
                    <div className="text-xs text-muted">
                      แก้ไขล่าสุดโดย {people[row.updated_by]?.full_name || 'ไม่ทราบชื่อ'} · {formatDate(row.updated_at, true)}
                      {row.legal_reviewed &&
                        ` · ยืนยันการตรวจสอบโดย ${people[row.legal_reviewed_by]?.full_name || 'ไม่ทราบชื่อ'} ${formatDate(row.legal_reviewed_at)}`}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-secondary inline-flex items-center gap-1"
                      onClick={() => setModal({ type: 'history', policy: row })}
                    >
                      <History size={14} aria-hidden="true" />
                      ประวัติเวอร์ชัน
                    </button>
                    {canEdit && (
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-secondary inline-flex items-center gap-1"
                        onClick={() => setModal({ type: 'edit', policy: row })}
                      >
                        <Pencil size={14} aria-hidden="true" />
                        แก้ไข
                      </button>
                    )}
                    {canEdit && row.status === 'draft' && (
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-danger"
                        onClick={() => setDeleteTarget(row)}
                        aria-label={`ลบฉบับร่าง ${row.title}`}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <PolicyFormModal
        open={modal?.type === 'edit'}
        policy={modal?.policy ?? null}
        onClose={() => setModal(null)}
        onSaved={() => {
          setModal(null)
          load()
        }}
      />
      <HistoryModal open={modal?.type === 'history'} policy={modal?.policy ?? null} people={people} onClose={() => setModal(null)} />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="ลบฉบับร่าง"
        message={deleteTarget ? `ลบ "${deleteTarget.title}" และประวัติของฉบับร่างนี้ การลบย้อนกลับไม่ได้` : ''}
        confirmLabel="ลบ"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  )
}

/* ================================ สร้าง / แก้ไข ================================ */

function PolicyFormModal({ open, policy, onClose, onSaved }) {
  const toast = useToast()
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setErrors({})
    setForm(
      policy
        ? {
            policyType: policy.policy_type,
            title: policy.title,
            body: policy.body || '',
            version: policy.version,
            effectiveDate: policy.effective_date || '',
            status: policy.status,
            legalReviewed: Boolean(policy.legal_reviewed),
            legalReviewNote: policy.legal_review_note || '',
          }
        : EMPTY_FORM,
    )
  }, [open, policy])

  const set = (key) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value
    setForm((current) => {
      const next = { ...current, [key]: value }
      // เนื้อหาเปลี่ยนจากฉบับที่ยืนยันไว้ ต้องยืนยันการตรวจสอบใหม่
      if (key === 'body' && policy?.legal_reviewed && value !== policy.body) next.legalReviewed = false
      return next
    })
  }

  const bodyChanged = Boolean(policy) && form.body !== (policy.body || '')
  const versionUnchanged = Boolean(policy) && form.version.trim() === policy.version

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (saving) return
    const next = {}
    if (!form.title.trim()) next.title = 'กรุณากรอกชื่อเอกสาร'
    else if (form.title.trim().length > 200) next.title = 'ชื่อยาวเกิน 200 ตัวอักษร'
    if (!VERSION_PATTERN.test(form.version.trim())) next.version = 'ใช้ตัวเลข ตัวอักษร จุด ขีด ได้ไม่เกิน 30 ตัว'
    if (form.body.length > 100000) next.body = 'เนื้อหายาวเกิน 100,000 ตัวอักษร'
    if (form.status === 'published' && !form.legalReviewed) next.legalReviewed = 'ต้องยืนยันการตรวจสอบทางกฎหมายก่อนเผยแพร่'
    if (form.status === 'published' && !form.body.trim()) next.body = 'เอกสารที่เผยแพร่ต้องมีเนื้อหา'
    setErrors(next)
    if (Object.keys(next).length > 0) return

    const payload = {
      policy_type: form.policyType,
      title: form.title.trim(),
      body: form.body,
      version: form.version.trim(),
      effective_date: form.effectiveDate || null,
      status: form.status,
      legal_reviewed: form.legalReviewed,
      legal_review_note: form.legalReviewNote.trim() || null,
    }
    setSaving(true)
    const query = policy ? supabase.from('policies').update(payload).eq('id', policy.id) : supabase.from('policies').insert(payload)
    const { data, error } = await query.select('id')
    setSaving(false)
    if (error || !data?.length) {
      toast.error(getErrorMessage(error, 'บันทึกไม่สำเร็จ หรือคุณไม่มีสิทธิ์แก้ไขเอกสาร'))
      return
    }
    toast.success(policy ? 'บันทึกเอกสารแล้ว' : 'สร้างเอกสารแล้ว')
    onSaved?.()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={saving}
      size="xl"
      title={policy ? 'แก้ไขเอกสาร' : 'สร้างเอกสาร'}
      description="ทุกครั้งที่บันทึกการเปลี่ยนชื่อ เนื้อหา เวอร์ชัน วันที่มีผล หรือสถานะ ระบบจะเก็บประวัติเวอร์ชันไว้"
      footer={
        <>
          <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>
            ยกเลิก
          </button>
          <button type="submit" form="policy-form" className="btn btn-primary inline-flex items-center gap-2" disabled={saving}>
            {saving && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
            บันทึก
          </button>
        </>
      }
    >
      <form id="policy-form" onSubmit={handleSubmit} noValidate>
        <div className="grid gap-x-4 md:grid-cols-2">
          <Field label="ประเภทเอกสาร" htmlFor="pol-type" required>
            <select id="pol-type" className="form-select" value={form.policyType} onChange={set('policyType')}>
              {Object.entries(POLICY_TYPES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="ชื่อเอกสาร" htmlFor="pol-title" error={errors.title} required>
            <input
              className="form-control"
              value={form.title}
              onChange={set('title')}
              maxLength={200}
              data-autofocus
              {...fieldA11y('pol-title', errors.title)}
            />
          </Field>
          <Field
            label="เวอร์ชัน"
            htmlFor="pol-version"
            error={errors.version}
            hint={bodyChanged && versionUnchanged ? 'เนื้อหาเปลี่ยน ควรปรับเลขเวอร์ชันด้วย' : undefined}
            required
          >
            <input
              className="form-control"
              value={form.version}
              onChange={set('version')}
              maxLength={30}
              {...fieldA11y('pol-version', errors.version, bodyChanged && versionUnchanged)}
            />
          </Field>
          <Field label="วันที่มีผลบังคับใช้" htmlFor="pol-effective">
            <input id="pol-effective" type="date" className="form-control" value={form.effectiveDate} onChange={set('effectiveDate')} />
          </Field>
          <Field label="สถานะ" htmlFor="pol-status" required>
            <select id="pol-status" className="form-select" value={form.status} onChange={set('status')}>
              {Object.entries(STATUS_META).map(([value, meta]) => (
                <option key={value} value={value}>
                  {meta.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="เนื้อหา" htmlFor="pol-body" error={errors.body} hint="กรอกเนื้อหาที่ผ่านการตรวจสอบแล้ว รองรับข้อความธรรมดาหรือ Markdown">
          <textarea
            className="form-control font-mono text-sm"
            rows={14}
            value={form.body}
            onChange={set('body')}
            {...fieldA11y('pol-body', errors.body, true)}
          />
        </Field>

        <div className="rounded-xl border border-line p-3">
          <div className="form-check mb-2">
            <input
              id="pol-reviewed"
              type="checkbox"
              className="form-check-input"
              checked={form.legalReviewed}
              onChange={set('legalReviewed')}
              aria-invalid={errors.legalReviewed ? true : undefined}
            />
            <label htmlFor="pol-reviewed" className="form-check-label font-medium">
              ยืนยันว่าเนื้อหาฉบับนี้ผ่านการตรวจสอบทางกฎหมายโดยผู้เชี่ยวชาญแล้ว
            </label>
          </div>
          {errors.legalReviewed && <div className="mb-2 text-sm text-danger">{errors.legalReviewed}</div>}
          {policy?.legal_reviewed && bodyChanged && (
            <p className="mt-0 mb-2 text-xs text-warning">เนื้อหาเปลี่ยนจากฉบับที่ยืนยันไว้ ระบบจึงล้างการยืนยัน ต้องตรวจสอบใหม่</p>
          )}
          <Field label="บันทึกการตรวจสอบ" htmlFor="pol-review-note" className="mb-0">
            <input
              id="pol-review-note"
              className="form-control"
              value={form.legalReviewNote}
              onChange={set('legalReviewNote')}
              maxLength={500}
              placeholder="เช่น ผู้ตรวจสอบ วันที่ เลขที่หนังสือ"
            />
          </Field>
        </div>
      </form>
    </Modal>
  )
}

/* ================================ ประวัติเวอร์ชัน ================================ */

function HistoryModal({ open, policy, people, onClose }) {
  const [versions, setVersions] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || !policy) return undefined
    let active = true
    setVersions(null)
    setError('')
    supabase
      .from('policy_versions')
      .select('id, version, title, body, effective_date, status, legal_reviewed, saved_by, saved_at')
      .eq('policy_id', policy.id)
      .order('saved_at', { ascending: false })
      .limit(50)
      .then(({ data, error: queryError }) => {
        if (!active) return
        if (queryError) setError(getErrorMessage(queryError, 'โหลดประวัติไม่สำเร็จ'))
        else setVersions(data ?? [])
      })
    return () => {
      active = false
    }
  }, [open, policy])

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={`ประวัติเวอร์ชัน: ${policy?.title || ''}`}
      description="50 รายการล่าสุด แก้ไขหรือลบไม่ได้"
      footer={
        <button type="button" className="btn btn-outline-secondary" onClick={onClose}>
          ปิด
        </button>
      }
    >
      {error ? (
        <ErrorState message={error} />
      ) : !versions ? (
        <LoadingState />
      ) : versions.length === 0 ? (
        <p className="m-0 text-sm text-muted">ยังไม่มีประวัติ</p>
      ) : (
        <ul className="m-0 list-none space-y-2 p-0">
          {versions.map((version) => (
            <li key={version.id} className="rounded-xl border border-line">
              <details>
                <summary className="cursor-pointer px-3 py-2">
                  <span className="inline-flex flex-wrap items-center gap-2 align-middle">
                    <span className="font-medium">v{version.version}</span>
                    <Badge tone={STATUS_META[version.status]?.tone}>{STATUS_META[version.status]?.label ?? version.status}</Badge>
                    {version.legal_reviewed && <Badge tone="success">ยืนยันการตรวจสอบ</Badge>}
                    <span className="text-xs text-muted">
                      {people[version.saved_by]?.full_name || 'ไม่ทราบชื่อ'} · {formatDate(version.saved_at, true)}
                    </span>
                  </span>
                </summary>
                <div className="border-t border-line px-3 py-2">
                  <div className="mb-1 text-sm font-medium">{version.title}</div>
                  {version.effective_date && <div className="mb-2 text-xs text-muted">มีผล {formatDate(version.effective_date)}</div>}
                  <pre className="m-0 max-h-72 overflow-auto rounded-lg bg-fill p-3 text-xs whitespace-pre-wrap">
                    {version.body || '(ไม่มีเนื้อหา)'}
                  </pre>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}