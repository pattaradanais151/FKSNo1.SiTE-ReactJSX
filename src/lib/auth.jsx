import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { getErrorMessage, supabase } from './supabase.js'
import { hasMinRole } from './utils.js'

const PROFILE_COLUMNS = 'id, email, full_name, phone, avatar_url, role, is_active, locale, created_at, updated_at'
const RECHECK_AFTER_MS = 60 * 1000

const AuthContext = createContext(null)

/*
  status:
    config_error  ไม่มีการตั้งค่า Supabase
    loading       กำลังตรวจ Session หรือโหลดโปรไฟล์
    signed_out    ยังไม่ได้เข้าสู่ระบบ
    profile_error โหลดโปรไฟล์ไม่สำเร็จ
    inactive      ไม่มีโปรไฟล์ หรือบัญชียังไม่เปิด/ถูกปิดใช้งาน
    ready         ใช้งานได้
  Role ที่ได้มาจากตาราง profiles (ผ่าน RLS) ใช้ควบคุม UI เท่านั้น
  การบังคับสิทธิ์จริงทำโดย RLS / RPC / Edge Functions
*/
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [sessionReady, setSessionReady] = useState(!supabase)
  const [profile, setProfile] = useState(null)
  const [profileState, setProfileState] = useState('idle')
  const [profileError, setProfileError] = useState('')
  const currentUserId = useRef(null)
  const lastFetchedAt = useRef(0)

  const userId = session?.user?.id ?? null

  useEffect(() => {
    if (!supabase) return undefined
    let mounted = true

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setSession(data.session ?? null)
      setSessionReady(true)
    })

    // ห้ามเรียกคำสั่ง Supabase แบบ await ใน callback นี้ (อาจ deadlock) จึงเก็บแค่ session
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return
      setSession(nextSession ?? null)
      setSessionReady(true)
    })

    return () => {
      mounted = false
      data.subscription.unsubscribe()
    }
  }, [])

  const loadProfile = useCallback(async (id, { silent = false } = {}) => {
    if (!supabase || !id) return
    if (!silent) {
      setProfile(null)
      setProfileState('loading')
    }
    lastFetchedAt.current = Date.now()

    const { data, error } = await supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', id).maybeSingle()
    if (currentUserId.current !== id) return // ผู้ใช้เปลี่ยนระหว่างโหลด

    if (error) {
      if (!silent) {
        setProfileError(getErrorMessage(error, 'โหลดข้อมูลผู้ใช้ไม่สำเร็จ'))
        setProfileState('error')
      }
      return
    }
    setProfile(data ?? null)
    setProfileError('')
    setProfileState('ready')
  }, [])

  useEffect(() => {
    currentUserId.current = userId
    if (!userId) {
      setProfile(null)
      setProfileState('idle')
      setProfileError('')
      return
    }
    loadProfile(userId)
  }, [userId, loadProfile])

  // ตรวจสถานะบัญชีซ้ำเมื่อกลับมาที่แท็บ เผื่อถูกปิดใช้งานหรือเปลี่ยน Role ระหว่างใช้งาน
  useEffect(() => {
    if (!userId) return undefined
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastFetchedAt.current > RECHECK_AFTER_MS) {
        loadProfile(userId, { silent: true })
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [userId, loadProfile])

  const signIn = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }, [])

  const signOut = useCallback(async () => {
    // scope 'local' ลบ Session ในเครื่องนี้เสมอ แม้เครือข่ายมีปัญหา
    await supabase.auth.signOut({ scope: 'local' })
    setSession(null)
  }, [])

  const refreshProfile = useCallback(
    (options = { silent: true }) => (userId ? loadProfile(userId, options) : Promise.resolve()),
    [userId, loadProfile],
  )

  let status
  if (!supabase) status = 'config_error'
  else if (!sessionReady) status = 'loading'
  else if (!session) status = 'signed_out'
  else if (profileState === 'error') status = 'profile_error'
  else if (profileState !== 'ready') status = 'loading'
  else if (!profile || !profile.is_active) status = 'inactive'
  else status = 'ready'

  const value = useMemo(() => {
    const role = status === 'ready' ? profile.role : null
    return {
      status,
      session,
      user: session?.user ?? null,
      profile,
      profileError,
      role,
      isAdmin: hasMinRole(role, 'admin'),
      isSuperAdmin: role === 'super_admin',
      hasRole: (minRole) => hasMinRole(role, minRole),
      signIn,
      signOut,
      refreshProfile,
    }
  }, [status, session, profile, profileError, signIn, signOut, refreshProfile])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth ต้องใช้ภายใน AuthProvider')
  return context
}