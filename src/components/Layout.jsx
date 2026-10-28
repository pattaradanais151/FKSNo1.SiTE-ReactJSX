import { Suspense, useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import styled from '@emotion/styled'
import {
  Ban,
  BarChart3,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Store,
  UserCircle,
  UserCog,
  Users,
  Wallet,
  Wrench,
  X,
} from 'lucide-react'
import { useAuth } from '../lib/auth.jsx'
import { getErrorMessage, supabase } from '../lib/supabase.js'
import { APP_NAME, ROLES, STORE_UPDATED_EVENT } from '../lib/utils.js'
import { Avatar, Badge, ErrorBoundary, LoadingState, ThemeSwitcher, getFocusable, trapFocus, useToast } from './UI.jsx'

/* ================================ เมนู ================================ */
// min = Role ขั้นต่ำที่เห็นเมนู (ซ่อน UI เท่านั้น สิทธิ์จริงตรวจที่ Route และ Database)

const NAV_SECTIONS = [
  {
    id: 'main',
    title: null,
    items: [{ to: '/', label: 'ภาพรวม', icon: LayoutDashboard, min: 'staff' }],
  },
  {
    id: 'service',
    title: 'งานบริการ',
    items: [
      {
        to: '/jobs',
        label: 'งานทั้งหมด',
        icon: ClipboardList,
        min: 'staff',
        match: (p) => p === '/jobs' || (p.startsWith('/jobs/') && !p.startsWith('/jobs/cancelled')),
      },
      { to: '/jobs/cancelled', label: 'งานที่ยกเลิก', icon: Ban, min: 'staff' },
      { to: '/customers', label: 'ลูกค้า', icon: Users, min: 'admin' },
    ],
  },
  {
    id: 'finance',
    title: 'การเงินและรายงาน',
    items: [
      { to: '/payments', label: 'การชำระเงิน', icon: Wallet, min: 'admin' },
      { to: '/reports', label: 'รายงานและประวัติ', icon: BarChart3, min: 'admin' },
    ],
  },
  {
    id: 'admin',
    title: 'ผู้ดูแลระบบ',
    items: [
      { to: '/employees', label: 'พนักงาน', icon: UserCog, min: 'admin' },
      { to: '/settings/store', label: 'ข้อมูลร้าน', icon: Store, min: 'admin' },
      { to: '/settings/policies', label: 'ข้อตกลงและนโยบาย', icon: FileText, min: 'admin' },
    ],
  },
]

const ROLE_TONE = { super_admin: 'danger', admin: 'primary', staff: 'neutral' }

function isItemActive(item, pathname) {
  if (item.match) return item.match(pathname)
  if (item.to === '/') return pathname === '/'
  return pathname === item.to || pathname.startsWith(`${item.to}/`)
}

/* ================================ Breadcrumbs ================================ */

function buildCrumbs(pathname) {
  const [section, sub, action] = pathname.split('/').filter(Boolean)
  const home = { label: 'ภาพรวม', to: '/' }
  const jobs = { label: 'งานบริการ', to: '/jobs' }

  switch (section) {
    case undefined:
      return [{ label: 'ภาพรวม' }]
    case 'jobs':
      if (!sub) return [home, { label: 'งานบริการ' }]
      if (sub === 'cancelled') return [home, jobs, { label: 'งานที่ยกเลิก' }]
      if (sub === 'new') return [home, jobs, { label: 'สร้างงานใหม่' }]
      if (action === 'edit') return [home, jobs, { label: 'รายละเอียดงาน', to: `/jobs/${sub}` }, { label: 'แก้ไขงาน' }]
      return [home, jobs, { label: 'รายละเอียดงาน' }]
    case 'customers':
      return sub
        ? [home, { label: 'ลูกค้า', to: '/customers' }, { label: 'รายละเอียดลูกค้า' }]
        : [home, { label: 'ลูกค้า' }]
    case 'payments':
      return sub
        ? [home, { label: 'การชำระเงิน', to: '/payments' }, { label: 'แผนผ่อนชำระ' }]
        : [home, { label: 'การชำระเงิน' }]
    case 'reports':
      return [home, { label: 'รายงานและประวัติ' }]
    case 'employees':
      return [home, { label: 'พนักงาน' }]
    case 'profile':
      return [home, { label: 'โปรไฟล์' }]
    case 'settings':
      if (sub === 'store') return [home, { label: 'ข้อมูลร้าน' }]
      if (sub === 'policies') return [home, { label: 'ข้อตกลงและนโยบาย' }]
      return [home, { label: 'ตั้งค่า' }]
    default:
      return [home, { label: 'ไม่พบหน้า' }]
  }
}

function Breadcrumbs({ items, className = '' }) {
  return (
    <nav aria-label="breadcrumb" className={className}>
      <ol className="m-0 flex list-none flex-wrap items-center gap-1 p-0 text-sm">
        {items.map((item, index) => {
          const last = index === items.length - 1
          return (
            <li key={`${item.label}-${index}`} className="inline-flex items-center gap-1">
              {index > 0 && <ChevronRight size={14} className="text-muted" aria-hidden="true" />}
              {item.to && !last ? (
                <Link to={item.to} className="text-muted no-underline hover:text-ink">
                  {item.label}
                </Link>
              ) : (
                <span className="font-medium text-ink" aria-current={last ? 'page' : undefined}>
                  {item.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/* ================================ ข้อมูลร้าน (ชื่อ/โลโก้) ================================ */

function useStoreBrand() {
  const [brand, setBrand] = useState({ name: APP_NAME, logoUrl: null })

  useEffect(() => {
    let active = true
    const load = async () => {
      const { data, error } = await supabase
        .from('store_settings')
        .select('store_name, logo_path, updated_at')
        .eq('id', 1)
        .maybeSingle()
      if (!active || error || !data) return
      let logoUrl = null
      if (data.logo_path) {
        const { data: file } = supabase.storage.from('store-assets').getPublicUrl(data.logo_path)
        logoUrl = `${file.publicUrl}?v=${encodeURIComponent(data.updated_at || '')}`
      }
      setBrand({ name: data.store_name || APP_NAME, logoUrl })
    }
    load()
    window.addEventListener(STORE_UPDATED_EVENT, load)
    return () => {
      active = false
      window.removeEventListener(STORE_UPDATED_EVENT, load)
    }
  }, [])

  return brand
}

/* ================================ Sidebar ================================ */

const SidebarShell = styled.aside`
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 1010;
  width: var(--sidebar-w);
  background: var(--app-sidebar);
  border-right: 1px solid var(--app-border);
`

const DrawerPanel = styled.div`
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: min(86vw, 300px);
  background: var(--app-sidebar);
  box-shadow: var(--app-shadow-lg);
  outline: none;
`

const NavItem = styled(Link)`
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  border-radius: 10px;
  color: var(--app-text);
  font-size: 0.9375rem;
  font-weight: 500;
  text-decoration: none;

  svg {
    flex-shrink: 0;
    color: var(--app-muted);
  }

  &:hover {
    background: var(--app-fill);
    color: var(--app-text);
  }

  &[data-active='true'] {
    background: var(--app-accent-soft);
    color: var(--app-accent);
  }

  &[data-active='true'] svg {
    color: var(--app-accent);
  }
`

function BrandLink({ brand, onNavigate }) {
  return (
    <Link to="/" onClick={onNavigate} className="flex items-center gap-3 px-5 py-5 text-ink no-underline">
      {brand.logoUrl ? (
        <img src={brand.logoUrl} alt="" className="h-9 w-9 rounded-[10px] object-cover" />
      ) : (
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] bg-brand text-white">
          <Wrench size={18} aria-hidden="true" />
        </span>
      )}
      <span className="min-w-0">
        <span className="block truncate leading-tight font-semibold">{brand.name}</span>
        <span className="block text-xs text-muted">ระบบหลังบ้าน</span>
      </span>
    </Link>
  )
}

function SidebarContent({ brand, onNavigate }) {
  const { hasRole } = useAuth()
  const { pathname } = useLocation()

  return (
    <>
      <BrandLink brand={brand} onNavigate={onNavigate} />
      <nav aria-label="เมนูหลัก" className="flex-1 overflow-y-auto px-3 pb-4">
        {NAV_SECTIONS.map((section) => {
          const items = section.items.filter((item) => hasRole(item.min))
          if (items.length === 0) return null
          return (
            <div key={section.id} className="mt-4 first:mt-1">
              {section.title && (
                <div className="px-3 pb-1 text-xs font-semibold tracking-wide text-muted">{section.title}</div>
              )}
              <ul className="m-0 list-none p-0">
                {items.map((item) => {
                  const active = isItemActive(item, pathname)
                  const Icon = item.icon
                  return (
                    <li key={item.to}>
                      <NavItem
                        to={item.to}
                        onClick={onNavigate}
                        aria-current={active ? 'page' : undefined}
                        data-active={active ? 'true' : 'false'}
                      >
                        <Icon size={18} aria-hidden="true" />
                        <span className="truncate">{item.label}</span>
                      </NavItem>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </nav>
      <div className="border-t border-line px-5 py-3 text-xs text-muted">{APP_NAME}</div>
    </>
  )
}

function MobileDrawer({ open, onClose, brand, returnFocusRef }) {
  const panelRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const panel = panelRef.current
    const returnTarget = returnFocusRef.current
    ;(getFocusable(panel)[0] || panel)?.focus()

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      } else {
        trapFocus(event, panel)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = overflow
      returnTarget?.focus()
    }
  }, [open, onClose, returnFocusRef])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[1040] lg:hidden">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <DrawerPanel ref={panelRef} role="dialog" aria-modal="true" aria-label="เมนูหลัก" tabIndex={-1} className="flex flex-col">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-3 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-fill"
          aria-label="ปิดเมนู"
        >
          <X size={20} aria-hidden="true" />
        </button>
        <SidebarContent brand={brand} onNavigate={onClose} />
      </DrawerPanel>
    </div>
  )
}

/* ================================ Header / User menu ================================ */

const HeaderBar = styled.header`
  position: sticky;
  top: 0;
  z-index: 1020;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  height: 60px;
  padding: 0 1rem;
  background: var(--app-header);
  border-bottom: 1px solid var(--app-border);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);

  @media (min-width: 768px) {
    padding: 0 1.5rem;
  }

  @media (min-width: 1024px) {
    padding: 0 2rem;
  }
`

const MenuPanel = styled.div`
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 1030;
  width: min(300px, calc(100vw - 2rem));
  padding: 0.5rem;
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  border-radius: 14px;
  box-shadow: var(--app-shadow-lg);
`

const MenuAction = styled.button`
  display: flex;
  width: 100%;
  align-items: center;
  gap: 0.625rem;
  padding: 0.5rem 0.625rem;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--app-text);
  font-size: 0.9375rem;
  text-align: left;
  text-decoration: none;
  cursor: pointer;

  svg {
    color: var(--app-muted);
  }

  &:hover {
    background: var(--app-fill);
    color: var(--app-text);
  }

  &:disabled {
    opacity: 0.6;
    cursor: default;
  }
`

function UserMenu() {
  const { profile, user, signOut } = useAuth()
  const toast = useToast()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const rootRef = useRef(null)
  const buttonRef = useRef(null)
  const menuId = useId()

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const handleSignOut = async () => {
    setBusy(true)
    try {
      await signOut()
    } catch (error) {
      toast.error(getErrorMessage(error, 'ออกจากระบบไม่สำเร็จ'))
      setBusy(false)
    }
  }

  const name = profile?.full_name || user?.email || 'ผู้ใช้'
  const roleMeta = ROLES[profile?.role]

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        className="inline-flex items-center gap-2 rounded-full py-1 pr-2 pl-1 hover:bg-fill"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`เมนูผู้ใช้: ${name}`}
        onClick={() => setOpen((value) => !value)}
      >
        <Avatar name={name} url={profile?.avatar_url} size={32} />
        <span className="hidden max-w-[160px] truncate text-sm font-medium md:inline">{name}</span>
        <ChevronDown size={16} className="text-muted" aria-hidden="true" />
      </button>

      {open && (
        <MenuPanel id={menuId}>
          <div className="flex items-center gap-3 px-2 pt-1 pb-3">
            <Avatar name={name} url={profile?.avatar_url} size={40} />
            <div className="min-w-0">
              <div className="truncate font-semibold">{name}</div>
              <div className="truncate text-sm text-muted">{profile?.email || user?.email}</div>
              {roleMeta && (
                <div className="mt-1">
                  <Badge tone={ROLE_TONE[profile.role]}>{roleMeta.label}</Badge>
                </div>
              )}
            </div>
          </div>
          <div className="border-t border-line px-2 py-3">
            <div className="mb-2 text-xs font-semibold text-muted">ธีม</div>
            <ThemeSwitcher showLabels />
          </div>
          <div className="border-t border-line pt-2">
            <MenuAction as={Link} to="/profile">
              <UserCircle size={18} aria-hidden="true" />
              โปรไฟล์ของฉัน
            </MenuAction>
            <MenuAction type="button" onClick={handleSignOut} disabled={busy}>
              <LogOut size={18} aria-hidden="true" />
              {busy ? 'กำลังออกจากระบบ...' : 'ออกจากระบบ'}
            </MenuAction>
          </div>
        </MenuPanel>
      )}
    </div>
  )
}

/* ================================ Layout ================================ */

export default function Layout() {
  const { pathname } = useLocation()
  const brand = useStoreBrand()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const menuButtonRef = useRef(null)
  const closeDrawer = useCallback(() => setDrawerOpen(false), [])
  const crumbs = buildCrumbs(pathname)

  useEffect(() => {
    setDrawerOpen(false)
    window.scrollTo(0, 0)
  }, [pathname])

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const onChange = (event) => {
      if (event.matches) setDrawerOpen(false)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return (
    <div className="min-h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[1100] focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2"
      >
        ข้ามไปเนื้อหาหลัก
      </a>

      <SidebarShell className="hidden lg:flex lg:flex-col">
        <SidebarContent brand={brand} />
      </SidebarShell>

      <MobileDrawer open={drawerOpen} onClose={closeDrawer} brand={brand} returnFocusRef={menuButtonRef} />

      <div className="lg:pl-[var(--sidebar-w)]">
        <HeaderBar>
          <button
            ref={menuButtonRef}
            type="button"
            className="btn btn-outline-secondary inline-flex h-10 w-10 items-center justify-center p-0 lg:hidden"
            aria-label="เปิดเมนู"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
          >
            <Menu size={20} aria-hidden="true" />
          </button>
          <Link to="/" className="min-w-0 truncate font-semibold text-ink no-underline lg:hidden">
            {brand.name}
          </Link>
          {crumbs.length >= 3 && <Breadcrumbs items={crumbs} className="hidden lg:block" />}
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden sm:inline-flex">
              <ThemeSwitcher />
            </span>
            <UserMenu />
          </div>
        </HeaderBar>

        <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1400px] px-4 py-6 outline-none md:px-6 lg:px-8 lg:py-8">
          {crumbs.length >= 3 && <Breadcrumbs items={crumbs} className="mb-4 lg:hidden" />}
          <ErrorBoundary key={pathname}>
            <Suspense fallback={<LoadingState />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  )
}