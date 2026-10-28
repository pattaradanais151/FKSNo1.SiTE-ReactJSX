import {
  Component,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { createPortal } from 'react-dom'
import styled from '@emotion/styled'
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Info,
  Loader2,
  Monitor,
  Moon,
  RefreshCw,
  Search,
  Sun,
  X,
} from 'lucide-react'
import { JOB_STATUS, PAYMENT_STATUS, getStoredTheme, setTheme, subscribeTheme } from '../lib/utils.js'

/* =============================== Focus helpers =============================== */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function getFocusable(node) {
  if (!node) return []
  return Array.from(node.querySelectorAll(FOCUSABLE)).filter((el) => el.getClientRects().length > 0)
}

// เก็บโฟกัสไว้ใน Dialog/Drawer เมื่อกด Tab
export function trapFocus(event, node) {
  if (event.key !== 'Tab' || !node) return
  const items = getFocusable(node)
  if (items.length === 0) {
    event.preventDefault()
    node.focus()
    return
  }
  const first = items[0]
  const last = items[items.length - 1]
  const active = document.activeElement
  if (event.shiftKey && (active === first || !node.contains(active))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (active === last || !node.contains(active))) {
    event.preventDefault()
    first.focus()
  }
}

/* ================================ Layout pieces ================================ */

export const Card = styled.section`
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius-lg);
  padding: ${(p) => (p.flush ? '0' : '1.25rem')};
  overflow: ${(p) => (p.flush ? 'hidden' : 'visible')};

  @media (min-width: 768px) {
    padding: ${(p) => (p.flush ? '0' : '1.5rem')};
  }
`

export function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="m-0 text-2xl font-semibold tracking-tight md:text-[1.75rem]">{title}</h1>
        {description && <p className="mt-1 mb-0 text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function TableWrap({ children, minWidth = 640 }) {
  return (
    <div className="w-full overflow-x-auto" tabIndex={0} role="region" aria-label="ตารางข้อมูล (เลื่อนแนวนอนได้)">
      <div style={{ minWidth }}>{children}</div>
    </div>
  )
}

/* ================================ States ================================ */

export function Spinner({ size = 18, label = 'กำลังโหลด', className = '' }) {
  return (
    <span role="status" className={`inline-flex items-center ${className}`}>
      <Loader2 size={size} className="animate-spin" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  )
}

export function LoadingState({ label = 'กำลังโหลดข้อมูล...' }) {
  return (
    <div role="status" className="flex flex-col items-center justify-center gap-3 py-16 text-muted">
      <Loader2 size={28} className="animate-spin" aria-hidden="true" />
      <span className="text-sm">{label}</span>
    </div>
  )
}

export function FullScreenLoader({ label = 'กำลังโหลด...' }) {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <LoadingState label={label} />
    </div>
  )
}

export function EmptyState({ icon: Icon = Inbox, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-14 text-center">
      <span className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-fill text-muted">
        <Icon size={22} aria-hidden="true" />
      </span>
      <h2 className="m-0 text-base font-semibold">{title}</h2>
      {description && <p className="mt-1 mb-0 max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorState({ title = 'โหลดข้อมูลไม่สำเร็จ', message, onRetry, retryLabel = 'ลองอีกครั้ง' }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center px-4 py-14 text-center">
      <span className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-fill text-danger">
        <AlertCircle size={22} aria-hidden="true" />
      </span>
      <h2 className="m-0 text-base font-semibold">{title}</h2>
      {message && <p className="mt-1 mb-0 max-w-md text-sm text-muted">{message}</p>}
      {onRetry && (
        <button type="button" className="btn btn-outline-secondary btn-sm mt-4 inline-flex items-center gap-2" onClick={onRetry}>
          <RefreshCw size={15} aria-hidden="true" />
          {retryLabel}
        </button>
      )}
    </div>
  )
}

/* ================================ Badges ================================ */

const BadgeBase = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.125rem 0.625rem;
  border-radius: 999px;
  font-size: 0.8125rem;
  font-weight: 500;
  line-height: 1.5;
  white-space: nowrap;
  background: var(--tone-${(p) => p.tone || 'neutral'}-bg);
  color: var(--tone-${(p) => p.tone || 'neutral'}-fg);

  &[data-dot]::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }
`

export function Badge({ tone = 'neutral', dot = false, children }) {
  return (
    <BadgeBase tone={tone} data-dot={dot || undefined}>
      {children}
    </BadgeBase>
  )
}

export function JobStatusBadge({ status }) {
  const meta = JOB_STATUS[status] ?? { label: status || '-', tone: 'neutral' }
  return (
    <Badge tone={meta.tone} dot>
      {meta.label}
    </Badge>
  )
}

export function PaymentStatusBadge({ status }) {
  const meta = PAYMENT_STATUS[status] ?? { label: status || '-', tone: 'neutral' }
  return <Badge tone={meta.tone}>{meta.label}</Badge>
}

/* ================================ Forms ================================ */

export function Field({ label, htmlFor, error, hint, required = false, children, className = '' }) {
  return (
    <div className={`mb-4 ${className}`}>
      {label && (
        <label htmlFor={htmlFor} className="form-label font-medium">
          {label}
          {required && (
            <span className="text-danger" aria-hidden="true">
              {' '}
              *
            </span>
          )}
        </label>
      )}
      {children}
      {hint && !error && (
        <div id={htmlFor ? `${htmlFor}-hint` : undefined} className="form-text">
          {hint}
        </div>
      )}
      {error && (
        <div id={htmlFor ? `${htmlFor}-error` : undefined} className="mt-1 text-sm text-danger">
          {error}
        </div>
      )}
    </div>
  )
}

// ใช้กับ input ภายใน Field: <input {...fieldA11y('email', errors.email)} />
export function fieldA11y(id, error, hint) {
  let describedBy
  if (error) describedBy = `${id}-error`
  else if (hint) describedBy = `${id}-hint`
  return { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy }
}

export function SearchInput({ value, onChange, placeholder = 'ค้นหา...', label = 'ค้นหา', className = '' }) {
  const id = useId()
  return (
    <div className={`relative ${className}`}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search
        size={16}
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
        aria-hidden="true"
      />
      <input
        id={id}
        type="search"
        className="form-control pr-9 pl-9"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
      />
      {value && (
        <button
          type="button"
          className="absolute top-1/2 right-2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted hover:bg-fill"
          onClick={() => onChange('')}
          aria-label="ล้างคำค้นหา"
        >
          <X size={15} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

export function useDebouncedValue(value, delay = 300) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

/* ================================ Pagination ================================ */

const numberFormatter = new Intl.NumberFormat('th-TH')

export function Pagination({ page, pageSize, total, onPageChange, disabled = false }) {
  if (!total) return null
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)

  return (
    <nav aria-label="เปลี่ยนหน้า" className="flex flex-wrap items-center justify-between gap-3 pt-4">
      <p className="m-0 text-sm text-muted">
        แสดง {numberFormatter.format(from)}–{numberFormatter.format(to)} จาก {numberFormatter.format(total)} รายการ
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary inline-flex items-center gap-1"
          disabled={disabled || page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft size={16} aria-hidden="true" />
          ก่อนหน้า
        </button>
        <span className="px-1 text-sm">
          หน้า {page} / {pageCount}
        </span>
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary inline-flex items-center gap-1"
          disabled={disabled || page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          ถัดไป
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
    </nav>
  )
}

/* ================================ Avatar ================================ */

const AvatarBase = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
  border-radius: 50%;
  background: var(--tone-primary-bg);
  color: var(--tone-primary-fg);
  font-weight: 600;
  user-select: none;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`

// เลือกพยัญชนะไทยหรือตัวอักษรอังกฤษตัวแรก (ข้ามสระนำ เช่น เ แ โ)
function initialOf(name) {
  const match = /[A-Za-z0-9\u0E01-\u0E2E]/.exec(name || '')
  return match ? match[0].toUpperCase() : '?'
}

export function Avatar({ name = '', url, size = 32 }) {
  const [failedUrl, setFailedUrl] = useState(null)
  const showImage = Boolean(url) && failedUrl !== url
  return (
    <AvatarBase style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }} aria-hidden="true">
      {showImage ? <img src={url} alt="" onError={() => setFailedUrl(url)} /> : initialOf(name)}
    </AvatarBase>
  )
}

/* ================================ Theme Switcher ================================ */

const Segmented = styled.div`
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: 10px;
  background: var(--app-fill);

  button {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    border: 0;
    border-radius: 8px;
    padding: 0.375rem 0.625rem;
    background: transparent;
    color: var(--app-muted);
    font-size: 0.8125rem;
    cursor: pointer;
  }

  button:hover {
    color: var(--app-text);
  }

  button[aria-pressed='true'] {
    background: var(--app-surface);
    color: var(--app-text);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
  }
`

const THEME_OPTIONS = [
  { value: 'light', label: 'สว่าง', Icon: Sun },
  { value: 'dark', label: 'มืด', Icon: Moon },
  { value: 'system', label: 'ตามระบบ', Icon: Monitor },
]

// ถ้าต้องซ่อนตามขนาดจอ ให้ห่อด้วย element ที่ใส่ Tailwind class (Emotion display จะชนะ class บน element เดียวกัน)
export function ThemeSwitcher({ showLabels = false }) {
  const pref = useSyncExternalStore(subscribeTheme, getStoredTheme, () => 'system')
  return (
    <Segmented role="group" aria-label="เลือกธีม">
      {THEME_OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={pref === value}
          aria-label={showLabels ? undefined : label}
          title={label}
          onClick={() => setTheme(value)}
        >
          <Icon size={15} aria-hidden="true" />
          {showLabels && <span>{label}</span>}
        </button>
      ))}
    </Segmented>
  )
}

/* ================================ Modal ================================ */

const MODAL_WIDTHS = { sm: '420px', md: '560px', lg: '760px', xl: '960px' }

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 1050;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.45);

  @media (max-width: 575.98px) {
    align-items: flex-end;
    padding: 0;
  }
`

const DialogBox = styled.div`
  width: 100%;
  max-width: var(--modal-w, 560px);
  max-height: calc(100vh - 2rem);
  display: flex;
  flex-direction: column;
  background: var(--app-surface);
  color: var(--app-text);
  border: 1px solid var(--app-border);
  border-radius: 18px;
  box-shadow: var(--app-shadow-lg);
  outline: none;

  @media (max-width: 575.98px) {
    max-width: none;
    max-height: 92vh;
    border-radius: 18px 18px 0 0;
  }
`

export function Modal({ open, onClose, title, description, children, footer, size = 'md', busy = false }) {
  const dialogRef = useRef(null)
  const titleId = useId()
  const descriptionId = useId()
  const onCloseRef = useRef(onClose)
  const busyRef = useRef(busy)

  useEffect(() => {
    onCloseRef.current = onClose
    busyRef.current = busy
  })

  useEffect(() => {
    if (!open) return undefined
    const node = dialogRef.current
    const previous = document.activeElement
    const body = node.querySelector('[data-modal-body]')
    const target = node.querySelector('[data-autofocus]') || getFocusable(body)[0] || getFocusable(node)[0] || node
    target.focus()

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (!busyRef.current) onCloseRef.current?.()
      } else {
        trapFocus(event, node)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = overflow
      if (previous && typeof previous.focus === 'function') previous.focus()
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <Backdrop
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose?.()
      }}
    >
      <DialogBox
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        style={{ '--modal-w': MODAL_WIDTHS[size] || MODAL_WIDTHS.md }}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="m-0 text-lg font-semibold">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-1 mb-0 text-sm text-muted">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-fill disabled:opacity-50"
            onClick={() => onClose?.()}
            disabled={busy}
            aria-label="ปิดหน้าต่าง"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div data-modal-body className="overflow-y-auto px-5 py-4">
          {children}
        </div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-4">{footer}</div>}
      </DialogBox>
    </Backdrop>,
    document.body,
  )
}

/*
  ConfirmDialog: onConfirm เป็น async ได้ และควรจัดการแจ้งข้อผิดพลาด (Toast) เอง
  ผู้เรียกปิด Dialog เองเมื่อสำเร็จ
*/
export function ConfirmDialog({
  open,
  title,
  message,
  children,
  confirmLabel = 'ยืนยัน',
  cancelLabel = 'ยกเลิก',
  tone = 'danger',
  confirmDisabled = false,
  onConfirm,
  onCancel,
}) {
  const [busy, setBusy] = useState(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const handleConfirm = async () => {
    if (busy) return
    setBusy(true)
    try {
      await onConfirm?.()
    } catch {
      // ผู้เรียกเป็นผู้แจ้งข้อผิดพลาด
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      busy={busy}
      footer={
        <>
          <button type="button" className="btn btn-outline-secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'} inline-flex items-center gap-2`}
            onClick={handleConfirm}
            disabled={busy || confirmDisabled}
          >
            {busy && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
            {confirmLabel}
          </button>
        </>
      }
    >
      {message && <p className="m-0 text-muted">{message}</p>}
      {children && <div className={message ? 'mt-4' : ''}>{children}</div>}
    </Modal>
  )
}

/* ================================ Toasts ================================ */

const ToastContext = createContext(null)
let toastSequence = 0

const TOAST_ICONS = { success: CheckCircle2, danger: AlertCircle, info: Info }

const ToastRegion = styled.div`
  position: fixed;
  right: 1rem;
  bottom: 1rem;
  z-index: 1080;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: min(380px, calc(100vw - 2rem));
  pointer-events: none;
`

const ToastItem = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.75rem 0.875rem;
  border-radius: 14px;
  border: 1px solid var(--app-border);
  background: var(--app-surface);
  color: var(--app-text);
  box-shadow: var(--app-shadow-lg);
  font-size: 0.9375rem;
  pointer-events: auto;

  .toast-icon {
    flex-shrink: 0;
    margin-top: 2px;
    color: var(--tone-${(p) => p.tone}-fg);
  }
`

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timers = useRef(new Map())

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((toast) => toast.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const push = useCallback(
    (tone, message) => {
      if (!message) return
      toastSequence += 1
      const id = toastSequence
      setToasts((list) => [...list.slice(-3), { id, tone, message: String(message) }])
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), tone === 'danger' ? 7000 : 4000),
      )
    },
    [dismiss],
  )

  useEffect(() => {
    const map = timers.current
    return () => {
      map.forEach((timer) => clearTimeout(timer))
      map.clear()
    }
  }, [])

  const api = useMemo(
    () => ({
      success: (message) => push('success', message),
      error: (message) => push('danger', message),
      info: (message) => push('info', message),
      dismiss,
    }),
    [push, dismiss],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <ToastRegion aria-live="polite" aria-relevant="additions">
          {toasts.map((toast) => {
            const Icon = TOAST_ICONS[toast.tone] ?? Info
            return (
              <ToastItem key={toast.id} tone={toast.tone} role={toast.tone === 'danger' ? 'alert' : 'status'}>
                <Icon size={18} className="toast-icon" aria-hidden="true" />
                <div className="min-w-0 flex-1">{toast.message}</div>
                <button
                  type="button"
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted hover:bg-fill"
                  onClick={() => dismiss(toast.id)}
                  aria-label="ปิดการแจ้งเตือน"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </ToastItem>
            )
          })}
        </ToastRegion>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast ต้องใช้ภายใน ToastProvider')
  return context
}

/* ================================ Error Boundary ================================ */

const CHUNK_ERROR = /dynamically imported module|Loading chunk|Importing a module script failed|error loading dynamically/i

export class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    if (import.meta.env.DEV) console.error(error, info)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    // หลัง Deploy ใหม่ ไฟล์ chunk เดิมอาจหายไป ต้องโหลดหน้าใหม่
    const isChunkError = CHUNK_ERROR.test(String(error?.message || ''))
    return (
      <ErrorState
        title={isChunkError ? 'ระบบมีการอัปเดต' : 'เกิดข้อผิดพลาดในการแสดงผล'}
        message={isChunkError ? 'กรุณาโหลดหน้าใหม่เพื่อใช้เวอร์ชันล่าสุด' : 'ลองอีกครั้ง หากยังพบปัญหาให้แจ้งผู้ดูแลระบบ'}
        retryLabel={isChunkError ? 'โหลดหน้าใหม่' : 'ลองอีกครั้ง'}
        onRetry={() => (isChunkError ? window.location.reload() : this.setState({ error: null }))}
      />
    )
  }
}