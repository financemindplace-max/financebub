import {
  OtpApiError,
  assertActiveAccess,
  authenticateWithPassword,
  createOtpCode,
  databaseDelete,
  databaseGet,
  databasePut,
  emailKey,
  findUserAccess,
  hashOtp,
  jsonError,
  maskEmail,
  normalizeEmail,
  sendOtpViaEmailJS,
  type LoginOtpRecord,
} from '@/lib/server/auth-otp'

export const runtime = 'nodejs'

const OTP_LIFETIME_MS = 10 * 60 * 1000
const RESEND_COOLDOWN_MS = 60 * 1000
const RATE_WINDOW_MS = 15 * 60 * 1000
const MAX_SENDS_PER_WINDOW = 5

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      email?: string
      password?: string
      appName?: string
    }
    const email = normalizeEmail(body.email)
    const password = String(body.password || '')

    if (!email || !password) throw new OtpApiError(400, 'credential-required', 'Email dan password wajib diisi.')

    const authUser = await authenticateWithPassword(email, password)
    const access = await findUserAccess(authUser.uid, authUser.email, authUser.idToken)
    assertActiveAccess(access)

    if (access!.role === 'admin') {
      return Response.json(
        { ok: true, mode: 'admin_pin' },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }

    const uidPath = `login_otps/${authUser.uid}`
    const emailPath = `login_otps_by_email/${emailKey(authUser.email)}`
    const previous = await databaseGet<LoginOtpRecord>(uidPath, authUser.idToken)
    const now = Date.now()

    if (previous?.resendAvailableAt && now < Number(previous.resendAvailableAt)) {
      const retryAfter = Math.max(1, Math.ceil((Number(previous.resendAvailableAt) - now) / 1000))
      throw new OtpApiError(429, 'otp-cooldown', 'Tunggu sebelum mengirim ulang OTP.', retryAfter)
    }

    const sameWindow = Boolean(previous?.rateWindowStart && now - Number(previous.rateWindowStart) < RATE_WINDOW_MS)
    const sendCount = sameWindow ? Number(previous?.sendCount || 0) : 0
    const rateWindowStart = sameWindow ? Number(previous!.rateWindowStart) : now
    if (sendCount >= MAX_SENDS_PER_WINDOW) {
      const retryAfter = Math.max(1, Math.ceil((rateWindowStart + RATE_WINDOW_MS - now) / 1000))
      throw new OtpApiError(429, 'otp-rate-limit', 'Terlalu banyak permintaan OTP.', retryAfter)
    }

    const code = createOtpCode()
    const otpRecord: LoginOtpRecord = {
      uid: authUser.uid,
      email: authUser.email,
      hash: hashOtp(authUser.uid, authUser.email, code),
      version: 2,
      channel: 'email',
      createdAt: now,
      lastSentAt: now,
      resendAvailableAt: now + RESEND_COOLDOWN_MS,
      expiresAt: now + OTP_LIFETIME_MS,
      usedAt: null,
      usedBy: null,
      attempts: 0,
      sendCount: sendCount + 1,
      rateWindowStart,
    }

    await Promise.all([
      databasePut(uidPath, otpRecord, authUser.idToken),
      databasePut(emailPath, otpRecord, authUser.idToken),
    ])

    try {
      const origin = new URL(request.url).origin
      await sendOtpViaEmailJS({
        toEmail: authUser.email,
        toName: access!.name || authUser.name,
        otpCode: code,
        appName: String(body.appName || 'FinanceBub').trim() || 'FinanceBub',
        loginUrl: `${origin}/login`,
      })
    } catch (emailError) {
      await Promise.all([
        databaseDelete(uidPath, authUser.idToken).catch(() => {}),
        databaseDelete(emailPath, authUser.idToken).catch(() => {}),
      ])
      throw emailError
    }

    return Response.json(
      {
        ok: true,
        mode: 'email',
        maskedEmail: maskEmail(authUser.email),
        cooldownSeconds: RESEND_COOLDOWN_MS / 1000,
        expiresMinutes: OTP_LIFETIME_MS / 60_000,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return jsonError(error)
  }
}
