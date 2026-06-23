import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'

export type AccessRecord = {
  uid: string
  email: string
  name: string
  role: 'admin' | 'user' | 'viewer'
  status: 'active' | 'pending' | 'inactive'
  refPath: string
}

export type LoginOtpRecord = {
  uid?: string
  email?: string
  hash?: string
  code?: string | number
  version?: number
  channel?: string
  createdAt?: number
  lastSentAt?: number
  resendAvailableAt?: number
  expiresAt?: number
  usedAt?: number | null
  usedBy?: string | null
  attempts?: number
  sendCount?: number
  rateWindowStart?: number
}

export class OtpApiError extends Error {
  status: number
  code: string
  retryAfter?: number

  constructor(status: number, code: string, message?: string, retryAfter?: number) {
    super(message || code)
    this.name = 'OtpApiError'
    this.status = status
    this.code = code
    this.retryAfter = retryAfter
  }
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new OtpApiError(500, 'otp-service-unavailable', `Environment variable ${name} belum diatur.`)
  return value
}

function firebaseApiKey() {
  return requiredEnv('NEXT_PUBLIC_FIREBASE_API_KEY')
}

function firebaseDatabaseUrl() {
  return requiredEnv('NEXT_PUBLIC_FIREBASE_DATABASE_URL').replace(/\/$/, '')
}

function otpHashSecret() {
  return requiredEnv('OTP_HASH_SECRET')
}

export function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase()
}

export function normalizeOtp(value: unknown) {
  return String(value || '').replace(/\D/g, '').slice(0, 6)
}

export function emailKey(value: string) {
  return normalizeEmail(value).replace(/[.#$\[\]/]/g, '_')
}

function normalizeRole(value: unknown): AccessRecord['role'] {
  const role = String(value || '').toLowerCase()
  if (role === 'admin') return 'admin'
  if (role === 'viewer') return 'viewer'
  return 'user'
}

function normalizeStatus(value: unknown): AccessRecord['status'] {
  const status = String(value || '').toLowerCase()
  if (status === 'active') return 'active'
  if (status === 'inactive') return 'inactive'
  return 'pending'
}

async function readErrorBody(response: Response) {
  const text = await response.text()
  if (!text) return ''
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } }
    return parsed.error?.message || text
  } catch {
    return text
  }
}

export async function authenticateWithPassword(email: string, password: string) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(firebaseApiKey())}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
      cache: 'no-store',
    },
  )

  if (!response.ok) {
    await readErrorBody(response)
    throw new OtpApiError(401, 'invalid-credential', 'Email atau password salah.')
  }

  const data = await response.json() as {
    localId?: string
    email?: string
    displayName?: string
    idToken?: string
  }

  if (!data.localId || !data.idToken) {
    throw new OtpApiError(401, 'invalid-credential', 'Email atau password salah.')
  }

  return {
    uid: data.localId,
    email: normalizeEmail(data.email || email),
    name: String(data.displayName || '').trim(),
    idToken: data.idToken,
  }
}

export async function lookupFirebaseIdToken(idToken: string) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseApiKey())}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
      cache: 'no-store',
    },
  )

  if (!response.ok) {
    await readErrorBody(response)
    throw new OtpApiError(401, 'invalid-session', 'Sesi login tidak valid.')
  }

  const data = await response.json() as {
    users?: Array<{ localId?: string; email?: string; displayName?: string }>
  }
  const user = data.users?.[0]
  if (!user?.localId) throw new OtpApiError(401, 'invalid-session', 'Sesi login tidak valid.')

  return {
    uid: user.localId,
    email: normalizeEmail(user.email || ''),
    name: String(user.displayName || '').trim(),
  }
}

function databaseEndpoint(path: string, idToken: string) {
  return `${firebaseDatabaseUrl()}/${path}.json?auth=${encodeURIComponent(idToken)}`
}

export async function databaseGet<T>(path: string, idToken: string): Promise<T | null> {
  const response = await fetch(databaseEndpoint(path, idToken), { cache: 'no-store' })
  if (!response.ok) {
    throw new OtpApiError(502, 'firebase-read-failed', await readErrorBody(response))
  }
  return await response.json() as T | null
}

export async function databasePut(path: string, value: unknown, idToken: string) {
  const response = await fetch(databaseEndpoint(path, idToken), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
    cache: 'no-store',
  })
  if (!response.ok) throw new OtpApiError(502, 'firebase-write-failed', await readErrorBody(response))
}

export async function databasePatch(path: string, value: unknown, idToken: string) {
  const response = await fetch(databaseEndpoint(path, idToken), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
    cache: 'no-store',
  })
  if (!response.ok) throw new OtpApiError(502, 'firebase-write-failed', await readErrorBody(response))
}

export async function databaseDelete(path: string, idToken: string) {
  const response = await fetch(databaseEndpoint(path, idToken), {
    method: 'DELETE',
    cache: 'no-store',
  })
  if (!response.ok) throw new OtpApiError(502, 'firebase-write-failed', await readErrorBody(response))
}

type RawAccess = {
  uid?: string
  email?: string
  name?: string
  role?: string
  status?: string
}

export async function findUserAccess(uid: string, email: string, idToken: string): Promise<AccessRecord | null> {
  const direct = await databaseGet<RawAccess>(`users_list/${uid}`, idToken)
  if (direct) {
    return {
      uid,
      email: normalizeEmail(direct.email || email),
      name: String(direct.name || '').trim(),
      role: normalizeRole(direct.role),
      status: normalizeStatus(direct.status),
      refPath: `users_list/${uid}`,
    }
  }

  const allUsers = await databaseGet<Record<string, RawAccess>>('users_list', idToken) || {}
  const cleanEmail = normalizeEmail(email)
  const found = Object.entries(allUsers).find(([, item]) => normalizeEmail(item?.email || '') === cleanEmail)
  if (!found) return null

  const [storedUid, data] = found
  return {
    uid,
    email: normalizeEmail(data.email || cleanEmail),
    name: String(data.name || '').trim(),
    role: normalizeRole(data.role),
    status: normalizeStatus(data.status),
    refPath: `users_list/${storedUid}`,
  }
}

export function assertActiveAccess(access: AccessRecord | null) {
  if (!access) throw new OtpApiError(403, 'not-team', 'Akun tidak terdaftar sebagai anggota tim.')
  if (access.status === 'pending') throw new OtpApiError(403, 'pending-approval', 'Akun masih menunggu persetujuan Admin.')
  if (access.status === 'inactive') throw new OtpApiError(403, 'account-inactive', 'Akun sedang dinonaktifkan.')
}

export function createOtpCode() {
  return String(randomInt(100000, 1000000))
}

export function hashOtp(uid: string, email: string, code: string) {
  return createHmac('sha256', otpHashSecret())
    .update(`${uid}:${normalizeEmail(email)}:${normalizeOtp(code)}`)
    .digest('hex')
}

export function otpMatches(record: LoginOtpRecord, uid: string, email: string, code: string) {
  const cleanCode = normalizeOtp(code)
  if (cleanCode.length !== 6) return false

  if (record.hash) {
    const expected = Buffer.from(hashOtp(uid, email, cleanCode), 'hex')
    const actual = Buffer.from(String(record.hash), 'hex')
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  }

  // Kompatibilitas OTP lama yang dibuat manual dari halaman Manajemen User.
  return Boolean(record.code) && String(record.code) === cleanCode
}

export function maskEmail(email: string) {
  const [local, domain] = normalizeEmail(email).split('@')
  if (!local || !domain) return email
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2)
  return `${visible}${'*'.repeat(Math.max(3, local.length - visible.length))}@${domain}`
}

export async function sendOtpViaEmailJS(params: {
  toEmail: string
  toName: string
  otpCode: string
  appName: string
  loginUrl: string
}) {
  const gmailUser = process.env.GMAIL_OTP_USER?.trim() || process.env.GMAIL_USER?.trim()
  const gmailPass = process.env.GMAIL_OTP_APP_PASSWORD?.trim() || process.env.GMAIL_APP_PASSWORD?.trim()

  if (!gmailUser || !gmailPass) {
    throw new OtpApiError(500, 'otp-service-unavailable', 'Konfigurasi email OTP belum diatur.')
  }

  const nodemailer = await import('nodemailer')
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: gmailUser,
      pass: gmailPass,
    },
  })

  const appName = params.appName || 'FinanceBub'
  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="color:#1B8A7A;margin-bottom:8px">Kode OTP ${appName}</h2>
      <p>Halo <strong>${params.toName || params.toEmail}</strong>,</p>
      <p>Gunakan kode berikut untuk masuk ke <strong>${appName}</strong>:</p>
      <div style="background:#f0fdf4;border:2px solid #1B8A7A;border-radius:12px;padding:20px;text-align:center;margin:20px 0">
        <span style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#1B8A7A">${params.otpCode}</span>
      </div>
      <p style="color:#666;font-size:14px">Kode ini berlaku selama <strong>10 menit</strong> dan hanya dapat digunakan sekali.</p>
      <p style="color:#666;font-size:14px">Jangan berikan kode ini kepada siapapun.</p>
      <p style="margin-top:20px">
        <a href="${params.loginUrl}" style="background:#1B8A7A;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:14px">Masuk ke ${appName}</a>
      </p>
      <hr style="margin:24px 0;border:none;border-top:1px solid #eee">
      <p style="color:#999;font-size:12px">Email ini dikirim otomatis, jangan reply.</p>
    </div>
  `

  await transporter.sendMail({
    from: `"${appName}" <${gmailUser}>`,
    to: params.toEmail,
    subject: `Kode OTP ${appName} — ${params.otpCode}`,
    html,
  })
}

export function jsonError(error: unknown) {
  if (error instanceof OtpApiError) {
    return Response.json(
      {
        ok: false,
        code: error.code,
        message: error.message,
        ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}),
      },
      {
        status: error.status,
        headers: {
          'Cache-Control': 'no-store',
          ...(error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {}),
        },
      },
    )
  }

  console.error('OTP service error:', error)
  return Response.json(
    { ok: false, code: 'otp-service-unavailable', message: 'Layanan OTP sedang tidak tersedia.' },
    { status: 500, headers: { 'Cache-Control': 'no-store' } },
  )
}
