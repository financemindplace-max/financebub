import {
  OtpApiError,
  assertActiveAccess,
  databaseGet,
  databasePatch,
  emailKey,
  findUserAccess,
  jsonError,
  lookupFirebaseIdToken,
  normalizeOtp,
  otpMatches,
  type LoginOtpRecord,
} from '@/lib/server/auth-otp'

export const runtime = 'nodejs'

const MAX_ATTEMPTS = 5

function bearerToken(request: Request) {
  const header = request.headers.get('authorization') || ''
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
}

export async function POST(request: Request) {
  try {
    const idToken = bearerToken(request)
    if (!idToken) throw new OtpApiError(401, 'invalid-session', 'Sesi login tidak valid.')

    const body = await request.json() as { otpCode?: string }
    const otpCode = normalizeOtp(body.otpCode)
    if (otpCode.length !== 6) throw new OtpApiError(400, 'otp-required', 'OTP wajib 6 angka.')

    const authUser = await lookupFirebaseIdToken(idToken)
    const access = await findUserAccess(authUser.uid, authUser.email, idToken)
    assertActiveAccess(access)
    if (access!.role === 'admin') throw new OtpApiError(400, 'otp-not-required', 'Admin menggunakan PIN.')

    const paths = [
      `login_otps/${authUser.uid}`,
      `login_otps_by_email/${emailKey(authUser.email)}`,
    ]
    const records = await Promise.all(paths.map(async path => ({
      path,
      data: await databaseGet<LoginOtpRecord>(path, idToken),
    })))

    const existing = records.filter(item => item.data?.hash || item.data?.code)
    if (!existing.length) throw new OtpApiError(400, 'otp-required', 'Kirim OTP ke email terlebih dahulu.')

    const now = Date.now()
    const active = existing.filter(item => {
      const record = item.data!
      return !record.usedAt && Boolean(record.expiresAt) && now <= Number(record.expiresAt)
    })

    if (!active.length) {
      if (existing.some(item => item.data?.usedAt)) throw new OtpApiError(400, 'otp-used', 'OTP sudah pernah digunakan.')
      throw new OtpApiError(400, 'otp-expired', 'OTP sudah kedaluwarsa.')
    }

    const highestAttempts = Math.max(...active.map(item => Number(item.data?.attempts || 0)))
    if (highestAttempts >= MAX_ATTEMPTS) {
      throw new OtpApiError(429, 'otp-locked', 'Percobaan OTP sudah mencapai batas maksimal.')
    }

    const matched = active.find(item => otpMatches(item.data!, authUser.uid, authUser.email, otpCode))
    if (!matched) {
      const attempts = highestAttempts + 1
      await Promise.all(active.map(item => databasePatch(item.path, {
        attempts,
        lastAttemptAt: now,
      }, idToken).catch(() => {})))

      if (attempts >= MAX_ATTEMPTS) {
        throw new OtpApiError(429, 'otp-locked', 'Percobaan OTP sudah mencapai batas maksimal.')
      }
      throw new OtpApiError(400, 'otp-invalid', 'Kode OTP salah.')
    }

    await Promise.all(existing.map(item => databasePatch(item.path, {
      usedAt: now,
      usedBy: authUser.uid,
    }, idToken).catch(() => {})))

    return Response.json(
      { ok: true },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return jsonError(error)
  }
}
