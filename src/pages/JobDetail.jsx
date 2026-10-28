import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  Ban,
  Eye,
  History,
  ImagePlus,
  Loader2,
  Lock,
  MessageSquareText,
  Pencil,
  RefreshCw,
  Send,
  Trash2,
} from 'lucide-react'
import { useAuth } from '../lib/auth.jsx'
import { getErrorMessage, supabase } from '../lib/supabase.js'
import { JOB_STATUS, OPEN_JOB_STATUSES, formatDate, todayISO, usePageTitle } from '../lib/utils.js'
import {
  Badge,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  JobStatusBadge,
  LoadingState,
  Modal,
  PageHeader,
  PaymentStatusBadge,
  Spinner,
  fieldA11y,
  useToast,
} from '../components/UI.jsx'
import {
  UUID_PATTERN,
  describeJobUpdate,
  deviceLabel,
  formatDetailValue,
  getDetailFields,
  jobTypeLabel,
  unwrap,
  useJobTypes,
  useProfileDirectory,
} from '../components/Forms.jsx'
import { FinancePanel } from '../components/Finance.jsx'

const JOB_SELECT =
  'id, job_number, job_type, other_type_name, customer_id, device_id, title, description, accessories_received, device_condition, details, received_at, appointment_at, due_date, assigned_to, status, public_status_note, cancel_reason, cancelled_at, cancelled_by, completed_at, created_by, created_at, updated_at, customer:customers(id, customer_code, name, phone, email, address), device:devices(id, device_type, brand, model, serial_number, imei)'
const UPDATE_COLUMNS = 'id, update_type, from_status, to_status, message, is_customer_visible, author_id, created_at'
const NOTE_COLUMNS = 'id, visibility, body, author_id, created_at'

const PUBLIC_NOTE_SUGGESTIONS = [
  'กำลังตรวจสอบอุปกรณ์',
  'อยู่ระหว่างรออะไหล่',
  'กำลังดำเนินการซ่อม',
  'ดำเนินการเสร็จสิ้นแล้ว พร้อมรับเครื่อง',
]

const PHOTO_BUCKET = 'job-photos'
const PHOTO_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const PHOTO_MAX_BYTES = 5 * 1024 * 1024
const PHOTO_MAX_FILES = 10

function InfoRow({ label, children, className = '' }) {
  const empty = children === null || children === undefined || children === ''
  return (
    <div className={className}>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="m-0 mt-0.5 break-words">{empty ? '-' : children}</dd>
    </div>
  )
}

function MultilineText({ text }) {
  return text ? <span className="whitespace-pre-wrap">{text}</span> : null
}

/* ================================ เปลี่ยนสถานะ ================================ */

function StatusModal({ open, job, isAdmin, onClose, onSaved }) {
  const toast = useToast()
  const [nextStatus, setNextStatus] = useState(job.status)
  const [updateNote, setUpdateNote] = useState(false)
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setNextStatus(job.status)
    setUpdateNote(false)
    setNote(job.public_status_note || '')
    setReason('')
    setErrors({})
  }, [open, job])

  const options = Object.entries(JOB_STATUS).filter(([value]) => isAdmin || value !== 'cancelled')
  const cancelling = nextStatus === 'cancelled' && job.status !== 'cancelled'
  const reopening = job.status === 'cancelled' && nextStatus !== 'cancelled'

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (saving) return
    const next = {}
    if (nextStatus === job.status && !updateNote) next.status = 'เลือกสถานะใหม่ หรือเลือกอัปเดตข้อความถึงลูกค้า'
    if (cancelling && !reason.trim()) next.reason = 'กรุณาระบุเหตุผลการยกเลิกงาน'
    if (updateNote && note.length > 1000) next.note = 'ข้อความยาวเกิน 1,000 ตัวอักษร'
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setSaving(true)
    const { error } = await supabase.rpc('update_job_status', {
      p_job_id: job.id,
      p_new_status: nextStatus,
      p_public_note: updateNote ? note.trim() : null,
      p_cancel_reason: cancelling ? reason.trim() : null,
    })
    setSaving(false)
    if (error) {
      toast.error(getErrorMessage(error, 'เปลี่ยนสถานะไม่สำเร็จ'))
      return
    }
    toast.success(
      nextStatus === job.status ? 'อัปเดตข้อความถึงลูกค้าแล้ว' : `เปลี่ยนสถานะเป็น "${JOB_STATUS[nextStatus].label}" แล้ว`,
    )
    onSaved()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={saving}
      title="เปลี่ยนสถานะงาน"
      description={`${job.job_number} · สถานะปัจจุบัน: ${JOB_STATUS[job.status]?.label}`}
      footer={
        <>
          <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>
            ยกเลิก
          </button>
          <button
            type="submit"
            form="status-form"
            className={`btn ${cancelling ? 'btn-danger' : 'btn-primary'} inline-flex items-center gap-2`}
            disabled={saving}
          >
            {saving && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
            {cancelling ? 'ยืนยันยกเลิกงาน' : 'บันทึก'}
          </button>
        </>
      }
    >
      <form id="status-form" onSubmit={handleSubmit} noValidate>
        <Field label="สถานะใหม่" htmlFor="status-next" error={errors.status} required>
          <select
            className="form-select"
            value={nextStatus}
            onChange={(e) => setNextStatus(e.target.value)}
            data-autofocus
            {...fieldA11y('status-next', errors.status)}
          >
            {options.map(([value, meta]) => (
              <option key={value} value={value}>
                {meta.label}
                {value === job.status ? ' (ปัจจุบัน)' : ''}
              </option>
            ))}
          </select>
        </Field>

        {cancelling && (
          <Field
            label="เหตุผลการยกเลิก"
            htmlFor="status-reason"
            error={errors.reason}
            hint="ระบบจะบันทึกผู้ยกเลิกและเวลาโดยอัตโนมัติ ประวัติการเงินจะไม่ถูกลบ"
            required
          >
            <textarea
              className="form-control"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={1000}
              {...fieldA11y('status-reason', errors.reason, true)}
            />
          </Field>
        )}

        {reopening && (
          <div className="alert alert-warning py-2 text-sm" role="alert">
            การเปิดงานที่ยกเลิกแล้วอีกครั้งจะล้างเหตุผลการยกเลิกเดิม (ประวัติยังอยู่ใน Timeline)
          </div>
        )}

        <div className="form-check mb-2">
          <input
            id="status-update-note"
            type="checkbox"
            className="form-check-input"
            checked={updateNote}
            onChange={(e) => setUpdateNote(e.target.checked)}
          />
          <label htmlFor="status-update-note" className="form-check-label">
            อัปเดตข้อความที่ลูกค้ามองเห็นด้วย
          </label>
        </div>
        {updateNote && (
          <Field label="ข้อความถึงลูกค้า" htmlFor="status-note" error={errors.note} hint="เว้นว่างเพื่อล้างข้อความ">
            <textarea
              className="form-control"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={1000}
              {...fieldA11y('status-note', errors.note, true)}
            />
          </Field>
        )}
      </form>
    </Modal>
  )
}

/* ================================ ข้อความถึงลูกค้า ================================ */

function PublicNoteModal({ open, job, onClose, onSaved }) {
  const toast = useToast()
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setNote(job.public_status_note || '')
  }, [open, job])

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (saving) return
    if ((job.public_status_note || '') === note.trim()) {
      onClose()
      return
    }
    setSaving(true)
    const { error } = await supabase.rpc('update_job_status', {
      p_job_id: job.id,
      p_new_status: job.status,
      p_public_note: note.trim(),
      p_cancel_reason: null,
    })
    setSaving(false)
    if (error) {
      toast.error(getErrorMessage(error, 'บันทึกข้อความไม่สำเร็จ'))
      return
    }
    toast.success(note.trim() ? 'อัปเดตข้อความถึงลูกค้าแล้ว' : 'ล้างข้อความถึงลูกค้าแล้ว')
    onSaved()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={saving}
      title="ข้อความที่ลูกค้ามองเห็น"
      description="ห้ามใส่ต้นทุน ข้อมูลภายใน หรือข้อมูลส่วนบุคคลของผู้อื่น"
      footer={
        <>
          <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>
            ยกเลิก
          </button>
          <button type="submit" form="public-note-form" className="btn btn-primary inline-flex items-center gap-2" disabled={saving}>
            {saving && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
            บันทึก
          </button>
        </>
      }
    >
      <form id="public-note-form" onSubmit={handleSubmit} noValidate>
        <div className="mb-3 flex flex-wrap gap-2">
          {PUBLIC_NOTE_SUGGESTIONS.map((text) => (
            <button key={text} type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setNote(text)}>
              {text}
            </button>
          ))}
        </div>
        <Field label="ข้อความ" htmlFor="public-note" hint="เว้นว่างเพื่อล้างข้อความ">
          <textarea
            className="form-control"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
            data-autofocus
            {...fieldA11y('public-note', null, true)}
          />
        </Field>
      </form>
    </Modal>
  )
}

/* ================================ ความคืบหน้า ================================ */

function ProgressForm({ jobId, userId, onAdded }) {
  const toast = useToast()
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (saving) return
    const message = text.trim()
    if (!message) {
      setError('กรุณากรอกรายละเอียดความคืบหน้า')
      return
    }
    setError('')
    setSaving(true)
    const { error: insertError } = await supabase.from('job_updates').insert({
      job_id: jobId,
      author_id: userId,
      update_type: 'progress',
      message,
      is_customer_visible: false,
    })
    setSaving(false)
    if (insertError) {
      toast.error(getErrorMessage(insertError, 'บันทึกความคืบหน้าไม่สำเร็จ'))
      return
    }
    setText('')
    toast.success('บันทึกความคืบหน้าแล้ว')
    onAdded()
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="mb-4">
      <label htmlFor="progress-text" className="form-label font-medium">
        บันทึกความคืบหน้า <span className="text-sm font-normal text-muted">(ภายในทีม ลูกค้าไม่เห็น)</span>
      </label>
      <textarea
        className="form-control"
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={2000}
        placeholder="เช่น ถอดเครื่องตรวจแล้ว พบแรมเสีย 1 แถว"
        {...fieldA11y('progress-text', error)}
      />
      {error && (
        <div id="progress-text-error" className="mt-1 text-sm text-danger">
          {error}
        </div>
      )}
      <div className="mt-2 flex justify-end">
        <button type="submit" className="btn btn-sm btn-primary inline-flex items-center gap-1.5" disabled={saving}>
          {saving ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Send size={15} aria-hidden="true" />}
          บันทึก
        </button>
      </div>
    </form>
  )
}

/* ================================ บันทึกภายใน ================================ */

function InternalNotes({ jobId, userId, isAdmin, notes, people, onAdded }) {
  const toast = useToast()
  const [body, setBody] = useState('')
  const [visibility, setVisibility] = useState('team')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (saving) return
    const text = body.trim()
    if (!text) {
      setError('กรุณากรอกข้อความ')
      return
    }
    setError('')
    setSaving(true)
    const { error: insertError } = await supabase.from('internal_notes').insert({
      job_id: jobId,
      author_id: userId,
      visibility: isAdmin ? visibility : 'team',
      body: text,
    })
    setSaving(false)
    if (insertError) {
      toast.error(getErrorMessage(insertError, 'บันทึกไม่สำเร็จ'))
      return
    }
    setBody('')
    toast.success('เพิ่มบันทึกภายในแล้ว')
    onAdded()
  }

  return (
    <Card>
      <h2 className="mt-0 mb-1 inline-flex items-center gap-2 text-base font-semibold">
        <Lock size={17} className="text-muted" aria-hidden="true" />
        บันทึกภายใน
      </h2>
      <p className="mt-0 mb-3 text-sm text-muted">สำหรับทีมงานเท่านั้น ไม่แสดงต่อลูกค้า แก้ไขหรือลบไม่ได้หลังบันทึก</p>

      <form onSubmit={handleSubmit} noValidate className="mb-4">
        <label htmlFor="note-body" className="sr-only">
          ข้อความบันทึกภายใน
        </label>
        <textarea
          className="form-control"
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={5000}
          placeholder="บันทึกปัญหา การประสานงาน หรือข้อมูลสำหรับทีม"
          {...fieldA11y('note-body', error)}
        />
        {error && (
          <div id="note-body-error" className="mt-1 text-sm text-danger">
            {error}
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          {isAdmin ? (
            <div>
              <label htmlFor="note-visibility" className="sr-only">
                ผู้ที่มองเห็น
              </label>
              <select
                id="note-visibility"
                className="form-select form-select-sm"
                value={visibility}
                onChange={(e) => setVisibility(e.target.value)}
              >
                <option value="team">ทีมงาน (รวมพนักงานผู้รับผิดชอบ)</option>
                <option value="admin_only">เฉพาะผู้ดูแล</option>
              </select>
            </div>
          ) : (
            <span className="text-xs text-muted">ผู้ดูแลและพนักงานผู้รับผิดชอบมองเห็น</span>
          )}
          <button type="submit" className="btn btn-sm btn-primary inline-flex items-center gap-1.5" disabled={saving}>
            {saving ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Send size={15} aria-hidden="true" />}
            บันทึก
          </button>
        </div>
      </form>

      {notes.length === 0 ? (
        <p className="m-0 text-sm text-muted">ยังไม่มีบันทึกภายใน</p>
      ) : (
        <ul className="m-0 list-none space-y-3 p-0">
          {notes.map((note) => (
            <li key={note.id} className="rounded-xl border border-line p-3">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                <span className="font-medium text-ink">{people[note.author_id]?.full_name || 'ไม่ทราบชื่อ'}</span>
                <span>{formatDate(note.created_at, true)}</span>
              </div>
              {note.visibility === 'admin_only' && (
                <div className="mb-1">
                  <Badge tone="danger">เฉพาะผู้ดูแล</Badge>
                </div>
              )}
              <div className="text-sm whitespace-pre-wrap">{note.body}</div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/* ================================ รูปภาพ ================================ */

function PhotoSection({ jobId, isAdmin }) {
  const toast = useToast()
  const inputRef = useRef(null)
  const [photos, setPhotos] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [toDelete, setToDelete] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const bucket = supabase.storage.from(PHOTO_BUCKET)
      const { data, error: listError } = await bucket.list(jobId, {
        limit: 100,
        sortBy: { column: 'created_at', order: 'desc' },
      })
      if (listError) throw listError
      const files = (data ?? []).filter((file) => file.id && !file.name.startsWith('.'))
      if (files.length === 0) {
        setPhotos([])
        return
      }
      const paths = files.map((file) => `${jobId}/${file.name}`)
      const { data: signed, error: signError } = await bucket.createSignedUrls(paths, 3600)
      if (signError) throw signError
      setPhotos(paths.map((path, index) => ({ path, url: signed?.[index]?.signedUrl || null })))
    } catch (err) {
      setError(getErrorMessage(err, 'โหลดรูปภาพไม่สำเร็จ'))
    } finally {
      setLoading(false)
    }
  }, [jobId])

  useEffect(() => {
    load()
  }, [load])

  const handleFiles = async (event) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (files.length === 0) return
    if (files.length > PHOTO_MAX_FILES) {
      toast.error(`อัปโหลดได้ครั้งละไม่เกิน ${PHOTO_MAX_FILES} รูป`)
      return
    }
    const invalid = files.find((file) => !PHOTO_TYPES[file.type] || file.size > PHOTO_MAX_BYTES)
    if (invalid) {
      toast.error(`ไฟล์ ${invalid.name} ไม่รองรับ ต้องเป็น JPG, PNG หรือ WebP ขนาดไม่เกิน 5 MB`)
      return
    }

    setUploading(true)
    let uploaded = 0
    for (const file of files) {
      const path = `${jobId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${PHOTO_TYPES[file.type]}`
      const { error: uploadError } = await supabase.storage
        .from(PHOTO_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false })
      if (uploadError) {
        toast.error(getErrorMessage(uploadError, `อัปโหลด ${file.name} ไม่สำเร็จ`))
        break
      }
      uploaded += 1
    }
    setUploading(false)
    if (uploaded > 0) {
      toast.success(`อัปโหลดรูปภาพ ${uploaded} รูปแล้ว`)
      load()
    }
  }

  const confirmDelete = async () => {
    const { error: removeError } = await supabase.storage.from(PHOTO_BUCKET).remove([toDelete])
    if (removeError) {
      toast.error(getErrorMessage(removeError, 'ลบรูปภาพไม่สำเร็จ'))
      return
    }
    toast.success('ลบรูปภาพแล้ว')
    setToDelete(null)
    load()
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="m-0 text-base font-semibold">รูปภาพประกอบ</h2>
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary inline-flex items-center gap-1.5"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <ImagePlus size={15} aria-hidden="true" />}
          {uploading ? 'กำลังอัปโหลด...' : 'เพิ่มรูป'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={handleFiles}
          aria-label="เลือกรูปภาพ"
        />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Spinner size={16} /> กำลังโหลดรูปภาพ...
        </div>
      ) : error ? (
        <div className="text-sm text-danger">
          {error}{' '}
          <button type="button" className="btn btn-link btn-sm p-0" onClick={load}>
            ลองอีกครั้ง
          </button>
        </div>
      ) : photos.length === 0 ? (
        <p className="m-0 text-sm text-muted">ยังไม่มีรูปภาพ (JPG, PNG, WebP ไม่เกิน 5 MB ต่อรูป)</p>
      ) : (
        <ul className="m-0 grid list-none grid-cols-3 gap-2 p-0">
          {photos.map((photo, index) => (
            <li key={photo.path} className="group relative aspect-square overflow-hidden rounded-lg border border-line bg-fill">
              {photo.url ? (
                <a href={photo.url} target="_blank" rel="noreferrer" aria-label={`เปิดรูปที่ ${index + 1} ในแท็บใหม่`}>
                  <img src={photo.url} alt={`รูปประกอบงาน ${index + 1}`} loading="lazy" className="h-full w-full object-cover" />
                </a>
              ) : (
                <span className="flex h-full items-center justify-center text-xs text-muted">โหลดไม่ได้</span>
              )}
              {isAdmin && (
                <button
                  type="button"
                  className="absolute top-1 right-1 inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white"
                  onClick={() => setToDelete(photo.path)}
                  aria-label={`ลบรูปที่ ${index + 1}`}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={Boolean(toDelete)}
        title="ลบรูปภาพ"
        message="รูปภาพจะถูกลบถาวร ไม่สามารถกู้คืนได้"
        confirmLabel="ลบรูปภาพ"
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </Card>
  )
}

/* ================================ หน้า ================================ */

export default function JobDetail() {
  const { id } = useParams()
  const { isAdmin, user } = useAuth()
  const toast = useToast()
  const { labels } = useJobTypes()
  const { map: people } = useProfileDirectory()
  const [pageState, setPageState] = useState({ status: 'loading', error: '' })
  const [job, setJob] = useState(null)
  const [updates, setUpdates] = useState([])
  const [notes, setNotes] = useState([])
  const [finance, setFinance] = useState(null)
  const [financeToken, setFinanceToken] = useState(0)
  const [modal, setModal] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  usePageTitle(job ? `${job.job_number} ${job.title}` : 'รายละเอียดงาน')

  const fetchJob = useCallback(
    () => supabase.from('jobs').select(JOB_SELECT).eq('id', id).maybeSingle().then(unwrap),
    [id],
  )
  const fetchUpdates = useCallback(
    () =>
      supabase
        .from('job_updates')
        .select(UPDATE_COLUMNS)
        .eq('job_id', id)
        .order('created_at', { ascending: false })
        .limit(200)
        .then(unwrap),
    [id],
  )
  const fetchNotes = useCallback(
    () =>
      supabase
        .from('internal_notes')
        .select(NOTE_COLUMNS)
        .eq('job_id', id)
        .order('created_at', { ascending: false })
        .limit(200)
        .then(unwrap),
    [id],
  )

  useEffect(() => {
    if (!UUID_PATTERN.test(id)) {
      setPageState({ status: 'notfound', error: '' })
      return undefined
    }
    let active = true
    setPageState({ status: 'loading', error: '' })
    Promise.all([fetchJob(), fetchUpdates(), fetchNotes()])
      .then(([jobData, updateData, noteData]) => {
        if (!active) return
        if (!jobData) {
          setPageState({ status: 'notfound', error: '' })
          return
        }
        setJob(jobData)
        setUpdates(updateData ?? [])
        setNotes(noteData ?? [])
        setPageState({ status: 'ready', error: '' })
      })
      .catch((err) => active && setPageState({ status: 'error', error: getErrorMessage(err) }))
    return () => {
      active = false
    }
  }, [id, fetchJob, fetchUpdates, fetchNotes, reloadKey])

  const refreshJob = useCallback(async () => {
    try {
      const [jobData, updateData] = await Promise.all([fetchJob(), fetchUpdates()])
      if (jobData) setJob(jobData)
      setUpdates(updateData ?? [])
      setFinanceToken((token) => token + 1)
    } catch (err) {
      toast.error(getErrorMessage(err, 'โหลดข้อมูลล่าสุดไม่สำเร็จ'))
    }
  }, [fetchJob, fetchUpdates, toast])

  const refreshUpdates = useCallback(async () => {
    try {
      setUpdates((await fetchUpdates()) ?? [])
    } catch (err) {
      toast.error(getErrorMessage(err))
    }
  }, [fetchUpdates, toast])

  const refreshNotes = useCallback(async () => {
    try {
      setNotes((await fetchNotes()) ?? [])
    } catch (err) {
      toast.error(getErrorMessage(err))
    }
  }, [fetchNotes, toast])

  if (pageState.status === 'loading') return <LoadingState />
  if (pageState.status === 'notfound') {
    return (
      <Card>
        <EmptyState
          title="ไม่พบงาน"
          description="งานนี้อาจไม่มีอยู่ หรือคุณไม่มีสิทธิ์เข้าถึง (พนักงานเห็นเฉพาะงานที่ได้รับมอบหมาย)"
          action={
            <Link to="/jobs" className="btn btn-primary">
              กลับไปรายการงาน
            </Link>
          }
        />
      </Card>
    )
  }
  if (pageState.status === 'error') {
    return (
      <Card>
        <ErrorState message={pageState.error} onRetry={() => setReloadKey((key) => key + 1)} />
      </Card>
    )
  }

  const isOpen = OPEN_JOB_STATUSES.includes(job.status)
  const canChangeStatus = isAdmin || isOpen
  const overdue = isOpen && job.due_date && job.due_date < todayISO()
  const detailFields = getDetailFields(job.job_type).filter((field) => formatDetailValue(field, job.details?.[field.key]))
  const personName = (personId, fallback = '-') => (personId ? people[personId]?.full_name || 'ไม่ทราบชื่อ' : fallback)

  return (
    <>
      <PageHeader
        title={job.title}
        description={`${job.job_number} · ${jobTypeLabel(job, labels)}`}
        actions={
          <>
            <button
              type="button"
              className="btn btn-outline-secondary inline-flex items-center gap-2"
              onClick={refreshJob}
              aria-label="โหลดข้อมูลล่าสุด"
            >
              <RefreshCw size={16} aria-hidden="true" />
            </button>
            {isAdmin && (
              <Link to={`/jobs/${job.id}/edit`} className="btn btn-outline-secondary inline-flex items-center gap-2">
                <Pencil size={16} aria-hidden="true" />
                แก้ไขงาน
              </Link>
            )}
            {canChangeStatus && (
              <button type="button" className="btn btn-primary" onClick={() => setModal('status')}>
                เปลี่ยนสถานะ
              </button>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <JobStatusBadge status={job.status} />
        {isAdmin && finance && <PaymentStatusBadge status={finance.payment_status} />}
        {overdue && (
          <Badge tone="danger">
            <AlertTriangle size={12} aria-hidden="true" />
            เลยกำหนดส่ง
          </Badge>
        )}
      </div>

      {job.status === 'cancelled' && (
        <div className="alert alert-danger flex items-start gap-2" role="alert">
          <Ban size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <div className="font-semibold">งานนี้ถูกยกเลิก</div>
            <div className="whitespace-pre-wrap">เหตุผล: {job.cancel_reason}</div>
            <div className="text-sm">
              โดย {personName(job.cancelled_by)} เมื่อ {formatDate(job.cancelled_at, true)}
            </div>
          </div>
        </div>
      )}
      {!isAdmin && !isOpen && (
        <div className="alert alert-secondary text-sm" role="status">
          งานนี้ปิดแล้ว หากต้องเปลี่ยนสถานะ กรุณาติดต่อผู้ดูแล
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card aria-labelledby="public-note-title" style={{ background: 'var(--tone-info-bg)', borderColor: 'transparent' }}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 id="public-note-title" className="m-0 inline-flex items-center gap-2 text-sm font-semibold text-info">
                  <Eye size={16} aria-hidden="true" />
                  ข้อความที่ลูกค้ามองเห็น
                </h2>
                <p className="mt-1 mb-0 whitespace-pre-wrap">
                  {job.public_status_note || <span className="text-muted">ยังไม่มีข้อความ</span>}
                </p>
              </div>
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setModal('public')}>
                แก้ไขข้อความ
              </button>
            </div>
          </Card>

          <Card>
            <h2 className="mt-0 mb-4 text-base font-semibold">ข้อมูลงาน</h2>
            <dl className="m-0 grid gap-4 sm:grid-cols-2">
              <InfoRow label="ลูกค้า">
                {job.customer && (
                  <>
                    {isAdmin ? (
                      <Link to={`/customers/${job.customer.id}`} className="font-medium no-underline">
                        {job.customer.name}
                      </Link>
                    ) : (
                      <span className="font-medium">{job.customer.name}</span>
                    )}
                    <span className="text-sm text-muted"> · {job.customer.customer_code}</span>
                    <div className="text-sm">
                      <a href={`tel:${job.customer.phone.replace(/[^0-9+]/g, '')}`}>{job.customer.phone}</a>
                      {job.customer.email ? ` · ${job.customer.email}` : ''}
                    </div>
                  </>
                )}
              </InfoRow>
              <InfoRow label="ที่อยู่ลูกค้า">
                <MultilineText text={job.customer?.address} />
              </InfoRow>
              <InfoRow label="อุปกรณ์">
                {job.device ? (
                  <>
                    {deviceLabel(job.device)}
                    {(job.device.serial_number || job.device.imei) && (
                      <div className="text-sm text-muted">
                        {job.device.serial_number ? `SN: ${job.device.serial_number}` : ''}
                        {job.device.serial_number && job.device.imei ? ' · ' : ''}
                        {job.device.imei ? `IMEI: ${job.device.imei}` : ''}
                      </div>
                    )}
                  </>
                ) : (
                  <span className="text-muted">ไม่มีอุปกรณ์</span>
                )}
              </InfoRow>
              <InfoRow label="พนักงานผู้รับผิดชอบ">{personName(job.assigned_to, 'ยังไม่มอบหมาย')}</InfoRow>
              <InfoRow label="วันที่รับงาน">{formatDate(job.received_at)}</InfoRow>
              <InfoRow label="วันนัดหมาย">{job.appointment_at ? formatDate(job.appointment_at, true) : null}</InfoRow>
              <InfoRow label="กำหนดส่ง">
                {job.due_date ? (
                  <span className={overdue ? 'font-medium text-danger' : ''}>{formatDate(job.due_date)}</span>
                ) : null}
              </InfoRow>
              <InfoRow label={job.status === 'completed' ? 'เสร็จสิ้นเมื่อ' : 'สร้างเมื่อ'}>
                {job.status === 'completed'
                  ? formatDate(job.completed_at, true)
                  : `${formatDate(job.created_at, true)} โดย ${personName(job.created_by)}`}
              </InfoRow>
              <InfoRow label="รายละเอียดปัญหา / ขอบเขตงาน" className="sm:col-span-2">
                <MultilineText text={job.description} />
              </InfoRow>
              {(job.accessories_received || job.device_condition) && (
                <>
                  <InfoRow label="อุปกรณ์เสริมที่รับมาด้วย">
                    <MultilineText text={job.accessories_received} />
                  </InfoRow>
                  <InfoRow label="สภาพอุปกรณ์ ณ เวลารับงาน">
                    <MultilineText text={job.device_condition} />
                  </InfoRow>
                </>
              )}
            </dl>
          </Card>

          {detailFields.length > 0 && (
            <Card>
              <h2 className="mt-0 mb-4 text-base font-semibold">รายละเอียดเฉพาะ: {labels[job.job_type] || job.job_type}</h2>
              <dl className="m-0 grid gap-4 sm:grid-cols-2">
                {detailFields.map((field) => (
                  <InfoRow key={field.key} label={field.label} className={field.type === 'textarea' ? 'sm:col-span-2' : ''}>
                    <MultilineText text={formatDetailValue(field, job.details[field.key])} />
                  </InfoRow>
                ))}
              </dl>
            </Card>
          )}

          {isAdmin && <FinancePanel job={job} refreshToken={financeToken} onFinanceChange={setFinance} />}

          <Card>
            <h2 className="mt-0 mb-4 inline-flex items-center gap-2 text-base font-semibold">
              <History size={17} className="text-muted" aria-hidden="true" />
              ความคืบหน้าและประวัติ
            </h2>
            <ProgressForm jobId={job.id} userId={user.id} onAdded={refreshUpdates} />
            {updates.length === 0 ? (
              <p className="m-0 text-sm text-muted">ยังไม่มีประวัติ</p>
            ) : (
              <ol className="m-0 list-none border-l border-line p-0 pl-5">
                {updates.map((update) => {
                  const text = describeJobUpdate(update)
                  return (
                    <li key={update.id} className="relative pb-4 last:pb-0">
                      <span
                        className="absolute top-2 -left-[25px] h-2.5 w-2.5 rounded-full border-2 border-surface"
                        style={{
                          background:
                            update.update_type === 'status_change'
                              ? `var(--tone-${JOB_STATUS[update.to_status]?.tone || 'neutral'}-fg)`
                              : 'var(--app-muted)',
                        }}
                        aria-hidden="true"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{text.title}</span>
                        {update.is_customer_visible && <Badge tone="info">ลูกค้าเห็น</Badge>}
                      </div>
                      {text.body && <div className="text-sm whitespace-pre-wrap">{text.body}</div>}
                      <div className="text-xs text-muted">
                        {personName(update.author_id, 'ระบบ')} · {formatDate(update.created_at, true)}
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <InternalNotes
            jobId={job.id}
            userId={user.id}
            isAdmin={isAdmin}
            notes={notes}
            people={people}
            onAdded={refreshNotes}
          />

          <PhotoSection jobId={job.id} isAdmin={isAdmin} />

          {!isAdmin && (
            <p className="m-0 inline-flex items-start gap-2 text-xs text-muted">
              <MessageSquareText size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              ข้อมูลราคาและการชำระเงินแสดงเฉพาะผู้ดูแล
            </p>
          )}
        </div>
      </div>

      <StatusModal
        open={modal === 'status'}
        job={job}
        isAdmin={isAdmin}
        onClose={() => setModal(null)}
        onSaved={() => {
          setModal(null)
          refreshJob()
        }}
      />
      <PublicNoteModal
        open={modal === 'public'}
        job={job}
        onClose={() => setModal(null)}
        onSaved={() => {
          setModal(null)
          refreshJob()
        }}
      />
    </>
  )
}