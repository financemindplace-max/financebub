'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import {
  createUserWithEmailAndPassword,
  deleteUser as firebaseDeleteUser,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
  type User as FirebaseUser,
} from 'firebase/auth'
import { get, ref, remove, set, update } from 'firebase/database'
import { auth, db } from '@/lib/firebase'
import type { AppUser, AuthContextType, UserRole, UserStatus } from '@/types/auth'

let loginFlowInProgress = false

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  signIn: async () => {},
  signUp: async () => {},
  signOut: async () => {},
})

type RawUserAccess = {
  uid?: string
  email?: string
  name?: string
  role?: string
  status?: string
  createdAt?: number
  updatedAt?: number
  requestedAt?: number
  lastLoginAt?: number | null
  [key: string]: unknown
}

type UserAccessResult = {
  uid: string
  data: RawUserAccess
  refPath: string
}

function normalizeRole(value: unknown): UserRole {
  const role = String(value || '').toLowerCase()
  if (role === 'admin') return 'admin'
  if (role === 'viewer') return 'viewer'
  return 'user'
}

function normalizeStatus(value: unknown): UserStatus {
  const status = String(value || '').toLowerCase()
  if (status === 'active') return 'active'
  if (status === 'inactive') return 'inactive'
  return 'pending'
}

function buildFallbackName(email: string) {
  const rawName = email.split('@')[0] || 'User'
  return rawName
    .split(/[._\-\s]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'User'
}

function authAccessError(
  code:
    | 'pending'
    | 'inactive'
    | 'otp-required'
    | 'otp-expired'
    | 'otp-invalid'
    | 'otp-used'
    | 'otp-locked'
    | 'otp-service-unavailable'
    | 'not-team'
    | 'registration-otp-required'
    | 'registration-otp-expired'
    | 'registration-otp-invalid'
    | 'registration-otp-used',
) {
  const messageMap = {
    pending: 'auth/pending-approval',
    inactive: 'auth/account-inactive',
    'otp-required': 'auth/otp-required',
    'otp-expired': 'auth/otp-expired',
    'otp-invalid': 'auth/otp-invalid',
    'otp-used': 'auth/otp-used',
    'otp-locked': 'auth/otp-locked',
    'otp-service-unavailable': 'auth/otp-service-unavailable',
    'not-team': 'auth/not-team',
    'registration-otp-required': 'auth/registration-otp-required',
    'registration-otp-expired': 'auth/registration-otp-expired',
    'registration-otp-invalid': 'auth/registration-otp-invalid',
    'registration-otp-used': 'auth/registration-otp-used',
  } as const
  const err = new Error(messageMap[code]) as Error & { code?: string }
  err.code = messageMap[code]
  return err
}

function normalizeOtp(value: string) {
  return String(value || '').replace(/\D/g, '').slice(0, 6)
}

function normalizeEmail(value: string) {
  return String(value || '').trim().toLowerCase()
}

function otpStorageKey(uid: string) {
  return `financebub_otp_verified_${uid}`
}

const SESSION_DURATION_MS = 9 * 60 * 60 * 1000 // 9 jam

function rememberOtpVerified(uid: string) {
  if (typeof window === 'undefined') return
  const value = String(Date.now())

  // sessionStorage: otomatis hapus saat browser/tab ditutup
  try { window.sessionStorage.setItem(otpStorageKey(uid), value) } catch {}

  // localStorage: untuk sync antar tab, tapi dengan expiry 9 jam
  try { window.localStorage.setItem(otpStorageKey(uid), value) } catch {}
}

function clearOtpVerified(uid?: string) {
  if (typeof window === 'undefined') return

  const clearFromStorage = (storage: Storage) => {
    if (uid) {
      storage.removeItem(otpStorageKey(uid))
      return
    }
    Object.keys(storage)
      .filter(key => key.startsWith('financebub_otp_verified_'))
      .forEach(key => storage.removeItem(key))
  }

  try { clearFromStorage(window.localStorage) } catch {}
  try { clearFromStorage(window.sessionStorage) } catch {}
}

function hasOtpVerified(uid: string) {
  if (typeof window === 'undefined') return false
  const key = otpStorageKey(uid)
  const now = Date.now()

  // Cek sessionStorage dulu — kalau browser ditutup, ini sudah hilang otomatis
  try {
    const sessionVal = window.sessionStorage.getItem(key)
    if (sessionVal) {
      const ts = Number(sessionVal)
      if (now - ts < SESSION_DURATION_MS) return true
      // Expired — hapus
      window.sessionStorage.removeItem(key)
    }
  } catch {}

  // Cek localStorage — untuk sync antar tab, tapi tetap cek 9 jam
  try {
    const localVal = window.localStorage.getItem(key)
    if (localVal) {
      const ts = Number(localVal)
      if (now - ts < SESSION_DURATION_MS) {
        // Masih valid — tulis ulang ke sessionStorage supaya tab ini ikut terverifikasi
        try { window.sessionStorage.setItem(key, localVal) } catch {}
        return true
      }
      // Expired — hapus dari kedua storage
      window.localStorage.removeItem(key)
      try { window.sessionStorage.removeItem(key) } catch {}
    }
  } catch {}

  return false
}

async function createPendingAccess(uid: string, email: string, name: string) {
  await set(ref(db, `users_list/${uid}`), {
    uid,
    email,
    name,
    role: 'user',
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    requestedAt: Date.now(),
    lastLoginAt: null,
  })
}

async function findAccessByUidOrEmail(uid: string, email: string): Promise<UserAccessResult | null> {
  const directPath = `users_list/${uid}`
  const directSnap = await get(ref(db, directPath))
  const directData = directSnap.val() as RawUserAccess | null
  if (directData) {
    return { uid, data: { ...directData, uid: directData.uid || uid }, refPath: directPath }
  }

  const cleanEmail = normalizeEmail(email)
  if (!cleanEmail) return null

  const allSnap = await get(ref(db, 'users_list'))
  const allUsers = (allSnap.val() || {}) as Record<string, RawUserAccess>
  const foundEntry = Object.entries(allUsers).find(([, value]) => normalizeEmail(value?.email || '') === cleanEmail)

  if (!foundEntry) return null

  const [oldUid, oldData] = foundEntry
  const migratedData: RawUserAccess = {
    ...oldData,
    uid,
    email: oldData.email || cleanEmail,
    migratedFromUid: oldUid !== uid ? oldUid : undefined,
    migratedAt: oldUid !== uid ? Date.now() : undefined,
    updatedAt: Date.now(),
  }

  await set(ref(db, directPath), migratedData)
  if (oldUid !== uid) {
    await remove(ref(db, `users_list/${oldUid}`)).catch(() => {})
    await remove(ref(db, `login_otps/${oldUid}`)).catch(() => {})
  }

  return { uid, data: migratedData, refPath: directPath }
}

async function verifyLoginOtp(firebaseUser: FirebaseUser, otpCode: string) {
  const cleanCode = normalizeOtp(otpCode)
  if (cleanCode.length !== 6) throw authAccessError('otp-required')

  const idToken = await firebaseUser.getIdToken(true)
  const response = await fetch('/api/auth/verify-otp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ otpCode: cleanCode }),
    cache: 'no-store',
  })

  if (response.ok) return

  const payload = await response.json().catch(() => ({})) as { code?: string }
  const code = String(payload.code || '')
  if (code === 'otp-required') throw authAccessError('otp-required')
  if (code === 'otp-expired') throw authAccessError('otp-expired')
  if (code === 'otp-invalid') throw authAccessError('otp-invalid')
  if (code === 'otp-used') throw authAccessError('otp-used')
  if (code === 'otp-locked') throw authAccessError('otp-locked')
  throw authAccessError('otp-service-unavailable')
}

const ADMIN_PIN_FALLBACK = '122891'

async function getStoredAdminPin(): Promise<string> {
  try {
    const snap = await get(ref(db, 'admin_pin/code'))
    const raw = snap.val()
    const code = normalizeOtp(String(raw ?? ''))
    return code.length === 6 ? code : ADMIN_PIN_FALLBACK
  } catch {
    return ADMIN_PIN_FALLBACK
  }
}

async function verifyAdminPin(inputPin: string) {
  const clean = normalizeOtp(inputPin)
  const stored = await getStoredAdminPin()
  if (clean.length !== 6 || clean !== stored) {
    throw authAccessError('not-team')
  }
}

export async function changeAdminPin(newPin: string) {
  const clean = normalizeOtp(newPin)
  if (clean.length !== 6) throw new Error('PIN harus 6 digit angka')
  await set(ref(db, 'admin_pin/code'), clean)
}

export async function getAdminPinMasked(): Promise<string> {
  const pin = await getStoredAdminPin()
  return pin.slice(0, 2) + '••••'
}

async function readValidRegistrationOtp(registrationOtp: string) {
  const cleanCode = normalizeOtp(registrationOtp)
  if (cleanCode.length !== 6) throw authAccessError('registration-otp-required')

  const otpRef = ref(db, 'registration_otps/current')
  const snap = await get(otpRef)
  const data = snap.val() as null | {
    code?: string | number
    expiresAt?: number
    usedAt?: number | null
  }

  if (!data?.code) throw authAccessError('registration-otp-required')
  if (data.usedAt) throw authAccessError('registration-otp-used')
  if (!data.expiresAt || Date.now() > Number(data.expiresAt)) throw authAccessError('registration-otp-expired')
  if (String(data.code) !== cleanCode) throw authAccessError('registration-otp-invalid')

  return otpRef
}

async function safeSignOut() {
  try {
    await firebaseSignOut(auth)
  } catch {
    // ignore
  }
}

async function safeDeleteCurrentUser() {
  const current = auth.currentUser
  if (!current) return
  try {
    await firebaseDeleteUser(current)
  } catch {
    // ignore
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        if (loginFlowInProgress) {
          setLoading(false)
          return
        }

        const fallbackEmail = firebaseUser.email ?? ''
        const fallbackName = firebaseUser.displayName || buildFallbackName(fallbackEmail)

        try {
          const access = await findAccessByUidOrEmail(firebaseUser.uid, fallbackEmail)
          const data = access?.data

          if (!access || !data) {
            clearOtpVerified(firebaseUser.uid)
            await safeSignOut()
            setUser(null)
          } else {
            const userRef = ref(db, access.refPath)
            const status = normalizeStatus(data.status)

            if (status !== 'active') {
              await update(userRef, {
                email: data.email || fallbackEmail,
                name: data.name || fallbackName,
                status,
                updatedAt: Date.now(),
              })
              clearOtpVerified(firebaseUser.uid)
              await safeSignOut()
              setUser(null)
            } else {
              const role = normalizeRole(data.role)
              const adminBypassOtp = role === 'admin'

              if (!adminBypassOtp && !hasOtpVerified(firebaseUser.uid)) {
                // Jangan safeSignOut() di sini — itu akan sign out semua tab sekaligus.
                // Cukup set user = null untuk tab ini saja. Tab lain yang sudah
                // terverifikasi OTP tetap bisa jalan.
                setUser(null)
              } else {
                await update(userRef, {
                  email: data.email || fallbackEmail,
                  name: data.name || fallbackName,
                  status: 'active',
                  lastSeenAt: Date.now(),
                  updatedAt: Date.now(),
                })
                setUser({
                  uid: firebaseUser.uid,
                  email: String(data.email || fallbackEmail),
                  name: String(data.name || fallbackName),
                  role,
                  status: 'active',
                })
              }
            }
          }
        } catch {
          clearOtpVerified(firebaseUser.uid)
          await safeSignOut()
          setUser(null)
        }
      } else {
        setUser(null)
      }
      setLoading(false)
    })

    return () => unsub()
  }, [])

  const signIn = async (email: string, password: string, otpCode: string) => {
    const cleanEmail = email.trim()
    loginFlowInProgress = true

    try {
      const credential = await signInWithEmailAndPassword(auth, cleanEmail, password)
      const firebaseUser = credential.user
      const fallbackEmail = firebaseUser.email ?? cleanEmail
      const fallbackName = firebaseUser.displayName || buildFallbackName(fallbackEmail)
      const access = await findAccessByUidOrEmail(firebaseUser.uid, fallbackEmail)
      const data = access?.data

      if (!access || !data) {
        clearOtpVerified(firebaseUser.uid)
        await safeSignOut()
        setUser(null)
        throw authAccessError('not-team')
      }

      const userRef = ref(db, access.refPath)
      const status = normalizeStatus(data.status)
      if (status === 'pending') {
        clearOtpVerified(firebaseUser.uid)
        await safeSignOut()
        setUser(null)
        throw authAccessError('pending')
      }

      if (status === 'inactive') {
        clearOtpVerified(firebaseUser.uid)
        await safeSignOut()
        setUser(null)
        throw authAccessError('inactive')
      }

      const role = normalizeRole(data.role)

      if (role === 'admin') {
        await verifyAdminPin(otpCode)
        clearOtpVerified(firebaseUser.uid)
      } else {
        await verifyLoginOtp(firebaseUser, otpCode)
        rememberOtpVerified(firebaseUser.uid)
      }

      await update(userRef, {
        email: data.email || fallbackEmail,
        name: data.name || fallbackName,
        uid: firebaseUser.uid,
        status: 'active',
        lastLoginAt: Date.now(),
        updatedAt: Date.now(),
      })

      setUser({
        uid: firebaseUser.uid,
        email: String(data.email || fallbackEmail),
        name: String(data.name || fallbackName),
        role,
        status: 'active',
      })
    } catch (error) {
      if (auth.currentUser) clearOtpVerified(auth.currentUser.uid)
      if (auth.currentUser) await safeSignOut()
      setUser(null)
      throw error
    } finally {
      loginFlowInProgress = false
    }
  }

  const signUpExistingAuthAccount = async (
    name: string,
    email: string,
    password: string,
    registrationOtpRef: ReturnType<typeof ref>,
  ) => {
    const cleanName = name.trim()
    const cleanEmail = email.trim()

    let credential
    try {
      credential = await signInWithEmailAndPassword(auth, cleanEmail, password)
    } catch (signInError) {
      const code = typeof signInError === 'object' && signInError && 'code' in signInError
        ? String((signInError as { code?: string }).code)
        : ''
      if (code.includes('invalid-credential') || code.includes('wrong-password')) {
        const err = new Error('auth/registration-wrong-password') as Error & { code?: string }
        err.code = 'auth/registration-wrong-password'
        throw err
      }
      throw signInError
    }
    const firebaseUser = credential.user

    await createPendingAccess(
      firebaseUser.uid,
      cleanEmail,
      cleanName || firebaseUser.displayName || buildFallbackName(cleanEmail),
    )

    if (cleanName && firebaseUser.displayName !== cleanName) {
      await updateProfile(firebaseUser, { displayName: cleanName }).catch(() => {})
    }

    await update(registrationOtpRef, {
      usedAt: Date.now(),
      usedBy: firebaseUser.uid,
      usedByEmail: cleanEmail,
    })

    clearOtpVerified(firebaseUser.uid)
    await safeSignOut()
    setUser(null)
  }

  const signUp = async (name: string, email: string, password: string, registrationOtp: string) => {
    const cleanName = name.trim()
    const cleanEmail = email.trim()

    loginFlowInProgress = true
    try {
      const registrationOtpRef = await readValidRegistrationOtp(registrationOtp)

      let credential
      try {
        credential = await createUserWithEmailAndPassword(auth, cleanEmail, password)
      } catch (error) {
        const code = typeof error === 'object' && error && 'code' in error
          ? String((error as { code?: string }).code)
          : ''

        if (code.includes('email-already-in-use')) {
          await signUpExistingAuthAccount(cleanName, cleanEmail, password, registrationOtpRef)
          return
        }

        throw error
      }

      try {
        if (cleanName) {
          await updateProfile(credential.user, { displayName: cleanName })
        }

        await createPendingAccess(
          credential.user.uid,
          cleanEmail,
          cleanName || buildFallbackName(cleanEmail),
        )

        await update(registrationOtpRef, {
          usedAt: Date.now(),
          usedBy: credential.user.uid,
          usedByEmail: cleanEmail,
        })

        clearOtpVerified(credential.user.uid)
        await safeSignOut()
        setUser(null)
      } catch (error) {
        await safeDeleteCurrentUser()
        await safeSignOut()
        setUser(null)
        throw error
      }
    } finally {
      loginFlowInProgress = false
    }
  }

  const signOut = async () => {
    clearOtpVerified(auth.currentUser?.uid)
    await safeSignOut()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
