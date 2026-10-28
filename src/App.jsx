import { Suspense, lazy, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Construction, LogOut, RefreshCw, ShieldAlert, ShieldX, UserX } from 'lucide-react'
import Layout from './components/Layout.jsx'
import { Card, EmptyState, FullScreenLoader, PageHeader, ToastProvider } from './components/UI.jsx'
import { AuthProvider, useAuth } from './lib/auth.jsx'
import { supabaseConfigState } from './lib/supabase.js'
import { usePageTitle } from './lib/utils.js'

/*
  Route ทั้งหมดของระบบ
  - min: Role ขั้นต่ำ (staff < admin < super_admin) ตรวจซ้ำที่ RLS/RPC ใน Database เสมอ
  - page: ชื่อไฟล์ใน src/pages/ (โหลดแบบ Lazy อัตโนมัติด้วย import.meta.glob)
  - phase: Phase ที่จะส่งไฟล์หน้านั้น (ใช้แสดงเมื่อไฟล์ยังไม่มี)
*/
const ROUTES = [
  { path: '/', page: 'Dashboard', title: 'ภาพรวม', min: 'staff', phase: 4 },
  { path: '/jobs', page: 'Jobs', title: 'งานบริการ', min: 'staff', phase: 4, props: { view: 'active' } },
  { path: '/jobs/cancelled', page: 'Jobs', title: 'งานที่ยกเลิก', min: 'staff', phase: 4, props: { view: 'cancelled' } },
  { path: '/jobs/new', page: 'JobForm', title: 'สร้างงานใหม่', min: 'admin', phase: 4 },
  { path: '/jobs/:id', page: 'JobDetail', title: 'รายละเอียดงาน', min: 'staff', phase: 4 },
  { path: '/jobs/:id/edit', page: 'JobForm', title: 'แก้ไขงาน', min: 'admin', phase: 4 },
  { path: '/customers', page: 'Customers', title: 'ลูกค้า', min: 'admin', phase: 4 },
  { path: '/customers/:id', page: 'CustomerDetail', title: 'รายละเอียดลูกค้า', min: 'admin', phase: 4 },
  { path: '/payments', page: 'Payments', title: 'การชำระเงิน', min: 'admin', phase: 5 },
  { path: '/payments/plans/:planId', page: 'Payments', title: 'แผนผ่อนชำระ', min: 'admin', phase: 5 },
  { path: '/reports', page: 'Reports', title: 'รายงานและประวัติ', min: 'admin', phase: 6 },
  { path: '/employees', page: 'Employees', title: 'พนักงาน', min: 'admin', phase: 6 },
  { path: '/profile', page: 'Profile', title: 'โปรไฟล์', min: 'staff', phase: 6 },
  { path: '/settings/store', page: 'StoreSettings', title: 'ข้อมูลร้าน', min: 'admin', phase: 6 },
  { path: '/settings/policies', page: 'Policies', title: 'ข้อตกลงและนโยบาย', min: 'admin', phase: 6 },
]

// Lazy Load ทุกหน้า หน้าที่ยังไม่มีไฟล์จะได้ค่า null และแสดง PendingPage แทน
const pageModules = import.meta.glob('./pages/*.jsx')
const PAGE_NAMES = [...new Set([...ROUTES.map((route) => route.page), 'Login', 'NotFound'])]
const PAGES = Object.fromEntries(
  PAGE_NAMES.map((name) => {
    const loader = pageModules[`./pages/${name}.jsx`]
    return [name, loader ? lazy(loader) : null]
  }),
)

/* ================================ Screens ================================ */

function CenteredScreen({ children }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">{children}</div>
    </main>
  )
}

function ConfigErrorScreen({ state }) {
  usePageTitle('ตั้งค่าระบบไม่ครบ')
  const isSecret = state === 'secret_key'
  return (
    <CenteredScreen>
      <Card>
        <div className="flex items-start gap-3">
          <ShieldAlert size={24} className={`mt-1 shrink-0 ${isSecret ? 'text-danger' : 'text-warning'}`} aria-hidden="true" />
          <div>
            <h1 className="m-0 text-xl font-semibold">
              {isSecret ? 'พบ Secret Key ในฝั่ง Frontend' : 'ยังไม่ได้ตั้งค่าการเชื่อมต่อ Supabase'}
            </h1>
            {isSecret ? (
              <p className="mt-2 mb-0 text-muted">
                ค่า VITE_SUPABASE_PUBLISHABLE_KEY เป็น Secret Key หรือ service_role ระบบจึงไม่เชื่อมต่อ
                ให้ลบออกทันที ใช้ Publishable/Anon Key แทน และหมุน (rotate) Secret Key ใน Supabase Dashboard
                เพราะค่าอาจถูก Build ไปแล้ว
              </p>
            ) : (
              <p className="mt-2 mb-0 text-muted">
                สร้างไฟล์ .env.local จาก .env.example แล้วกรอก VITE_SUPABASE_URL และ VITE_SUPABASE_PUBLISHABLE_KEY
                จากนั้นรีสตาร์ท npm run dev (บน Cloudflare Pages ให้ตั้งค่า Environment variables แล้ว Deploy ใหม่)
              </p>
            )}
          </div>
        </div>
      </Card>
    </CenteredScreen>
  )
}

function AccountBlockedScreen() {
  usePageTitle('ไม่สามารถใช้งานบัญชีได้')
  const { profile, user, signOut, refreshProfile } = useAuth()
  const [checking, setChecking] = useState(false)

  const recheck = async () => {
    setChecking(true)
    await refreshProfile({ silent: true })
    setChecking(false)
  }

  return (
    <CenteredScreen>
      <Card>
        <div className="text-center">
          <span className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-fill text-warning">
            <UserX size={22} aria-hidden="true" />
          </span>
          <h1 className="m-0 text-xl font-semibold">
            {profile ? 'บัญชียังไม่เปิดใช้งาน' : 'ไม่พบข้อมูลผู้ใช้ในระบบ'}
          </h1>
          <p className="mt-2 text-muted">
            {profile
              ? 'บัญชีนี้ยังไม่ได้รับการเปิดใช้งาน หรือถูกปิดใช้งานแล้ว กรุณาติดต่อผู้ดูแลระบบ'
              : 'บัญชีนี้ไม่มีโปรไฟล์พนักงาน กรุณาติดต่อผู้ดูแลระบบ'}
          </p>
          <p className="text-sm text-muted">{user?.email}</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button type="button" className="btn btn-outline-secondary inline-flex items-center gap-2" onClick={recheck} disabled={checking}>
              <RefreshCw size={16} className={checking ? 'animate-spin' : ''} aria-hidden="true" />
              ตรวจสอบอีกครั้ง
            </button>
            <button type="button" className="btn btn-primary inline-flex items-center gap-2" onClick={signOut}>
              <LogOut size={16} aria-hidden="true" />
              ออกจากระบบ
            </button>
          </div>
        </div>
      </Card>
    </CenteredScreen>
  )
}

function ProfileErrorScreen() {
  usePageTitle('โหลดข้อมูลผู้ใช้ไม่สำเร็จ')
  const { profileError, signOut, refreshProfile } = useAuth()
  return (
    <CenteredScreen>
      <Card>
        <div className="text-center">
          <h1 className="m-0 text-xl font-semibold">โหลดข้อมูลผู้ใช้ไม่สำเร็จ</h1>
          <p className="mt-2 text-muted">{profileError}</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              className="btn btn-primary inline-flex items-center gap-2"
              onClick={() => refreshProfile({ silent: false })}
            >
              <RefreshCw size={16} aria-hidden="true" />
              ลองอีกครั้ง
            </button>
            <button type="button" className="btn btn-outline-secondary inline-flex items-center gap-2" onClick={signOut}>
              <LogOut size={16} aria-hidden="true" />
              ออกจากระบบ
            </button>
          </div>
        </div>
      </Card>
    </CenteredScreen>
  )
}

function ForbiddenPage() {
  usePageTitle('ไม่มีสิทธิ์เข้าถึง')
  return (
    <Card>
      <EmptyState
        icon={ShieldX}
        title="ไม่มีสิทธิ์เข้าถึงหน้านี้"
        description="บทบาทของคุณไม่สามารถใช้งานหน้านี้ได้ หากคิดว่าเป็นข้อผิดพลาด กรุณาติดต่อผู้ดูแลระบบ"
      />
    </Card>
  )
}

function PendingPage({ route }) {
  usePageTitle(route.title)
  return (
    <>
      <PageHeader title={route.title} />
      <Card>
        <EmptyState
          icon={Construction}
          title={`หน้านี้จะติดตั้งใน Phase ${route.phase}`}
          description={`ยังไม่มีไฟล์ src/pages/${route.page}.jsx ในโปรเจกต์ เมื่อเพิ่มไฟล์แล้ว ระบบจะโหลดหน้าจริงให้อัตโนมัติ`}
        />
      </Card>
    </>
  )
}

/* ================================ Guards ================================ */

function RequireAuth() {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <FullScreenLoader label="กำลังตรวจสอบสิทธิ์..." />
  if (status === 'signed_out') return <Navigate to="/login" replace state={{ from: location }} />
  if (status === 'profile_error') return <ProfileErrorScreen />
  if (status === 'inactive') return <AccountBlockedScreen />
  return <Layout />
}

function PublicOnly({ children }) {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <FullScreenLoader />
  if (status !== 'signed_out') {
    const from = location.state?.from
    const target = from?.pathname ? `${from.pathname}${from.search || ''}${from.hash || ''}` : '/'
    return <Navigate to={target} replace />
  }
  return children
}

function RoutePage({ route }) {
  const { hasRole } = useAuth()
  if (!hasRole(route.min)) return <ForbiddenPage />
  const Page = PAGES[route.page]
  if (!Page) return <PendingPage route={route} />
  return <Page {...(route.props || {})} />
}

function NotFoundRoute() {
  const Page = PAGES.NotFound
  return Page ? <Page /> : <ForbiddenPage />
}

/* ================================ App ================================ */

export default function App() {
  if (supabaseConfigState !== 'ready') return <ConfigErrorScreen state={supabaseConfigState} />

  const LoginPage = PAGES.Login

  return (
    <ToastProvider>
      <AuthProvider>
        <BrowserRouter>
          <Suspense fallback={<FullScreenLoader />}>
            <Routes>
              <Route
                path="/login"
                element={
                  <PublicOnly>
                    <LoginPage />
                  </PublicOnly>
                }
              />
              <Route element={<RequireAuth />}>
                {ROUTES.map((route) => (
                  <Route key={route.path} path={route.path} element={<RoutePage key={route.path} route={route} />} />
                ))}
                <Route path="*" element={<NotFoundRoute />} />
              </Route>
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </ToastProvider>
  )
}