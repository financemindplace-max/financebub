'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { Eye, EyeOff, Loader2, Mail } from 'lucide-react'
import { fetchGlobal } from '@/lib/rtdb'

function getFirebaseAuthMessage(error: unknown, mode: 'login' | 'register'): string {
  const code = typeof error === 'object' && error && 'code' in error
    ? String((error as { code?: string }).code)
    : ''
  const message = typeof error === 'object' && error && 'message' in error
    ? String((error as { message?: string }).message)
    : ''

  if (code.includes('email-already-in-use')) return 'Email ini sudah terdaftar. Silakan masuk menggunakan akun tersebut.'
  if (code.includes('weak-password')) return 'Password minimal 6 karakter.'
  if (code.includes('invalid-email')) return 'Format email belum benar.'
  if (code.includes('operation-not-allowed')) return 'Metode Email/Password belum aktif di Firebase Authentication.'
  if (code.includes('user-disabled')) return 'Akun ini sedang dinonaktifkan.'
  if (code.includes('pending-approval')) return 'Akun kamu berhasil terdaftar, tapi masih menunggu persetujuan Admin.'
  if (code.includes('account-inactive')) return 'Akun ini sedang dinonaktifkan oleh Admin.'
  if (code.includes('otp-required')) return 'Kirim OTP ke email terlebih dahulu, lalu masukkan kode 6 angka.'
  if (code.includes('otp-expired')) return 'Kode OTP sudah kedaluwarsa. Kirim ulang OTP ke email.'
  if (code.includes('otp-invalid')) return 'Kode OTP salah.'
  if (code.includes('otp-used')) return 'Kode OTP ini sudah pernah dipakai. Kirim ulang OTP ke email.'
  if (code.includes('otp-locked')) return 'Percobaan OTP sudah mencapai batas maksimal. Kirim OTP baru.'
  if (code.includes('otp-service-unavailable')) return 'Layanan OTP sedang tidak tersedia. Coba lagi beberapa saat.'
  if (code.includes('registration-otp-required')) return 'OTP Pendaftaran belum diisi atau belum di-generate Admin.'
  if (code.includes('registration-otp-expired')) return 'OTP Pendaftaran sudah expired. Minta Admin generate kode baru.'
  if (code.includes('registration-otp-invalid')) return 'OTP Pendaftaran salah. Periksa kode yang diberikan Admin.'
  if (code.includes('registration-otp-used')) return 'OTP Pendaftaran sudah pernah dipakai. Minta Admin generate kode baru.'
  if (code.includes('registration-wrong-password')) return 'Email ini pernah terdaftar dengan password berbeda. Gunakan password yang sama seperti pertama kali daftar, atau minta Admin hapus akun di Firebase Console.'
  if (code.includes('not-team')) return 'ANDA BUKAN TEAM KAMI!!'
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'ANDA BUKAN TEAM KAMI!!'

  // Tampilkan error mentah supaya bisa debug — ini akan dihapus setelah masalah selesai
  if (code) return `[DEBUG] code: ${code}`
  if (message) return `[DEBUG] message: ${message}`
  return mode === 'register' ? 'Gagal mendaftarkan akun. Hubungi Admin.' : 'Email atau password salah.'
}

function shouldRedirectNotTeam(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: string }).code) : ''
  return (
    code.includes('not-team') ||
    code.includes('invalid-credential') ||
    code.includes('wrong-password') ||
    code.includes('user-not-found')
  )
}

export default function LoginPage() {
  const { signIn, signUp, user, loading } = useAuth()
  const router = useRouter()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [registrationOtp, setRegistrationOtp] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [showOtp, setShowOtp] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sendingOtp, setSendingOtp] = useState(false)
  const [otpCooldown, setOtpCooldown] = useState(0)
  const [otpDeliveryMode, setOtpDeliveryMode] = useState<'email' | 'admin_pin' | null>(null)
  const [appIdentity, setAppIdentity] = useState({
    appName: 'FinanceBub',
    appSubtitle: 'Finance & Report',
    appInitials: 'DK',
    appLogoData: '',
    appColor: '#1B8A7A',
    appFooter: 'PT FinanceBub',
  })

  useEffect(() => {
    fetchGlobal().then(g => {
      if (!g) return
      setAppIdentity({
        appName: (g as any).appName || 'FinanceBub',
        appSubtitle: (g as any).appSubtitle || 'Finance & Report',
        appInitials: (g as any).appInitials || 'DK',
        appLogoData: (g as any).appLogoData || '',
        appColor: (g as any).appColor || '#1B8A7A',
        appFooter: (g as any)['c-name'] || (g as any).appName || 'PT FinanceBub',
      })
    })
  }, [])

  const isRegister = mode === 'register'
  const title = isRegister ? 'Daftar Akun' : 'Masuk'
  const subtitle = isRegister ? 'Buat akun baru memakai OTP Pendaftaran dari Admin' : `Gunakan akun ${appIdentity.appName} kamu.`
  const buttonLabel = useMemo(() => {
    if (submitting) return isRegister ? 'Mendaftarkan...' : 'Masuk...'
    return isRegister ? 'Daftar' : 'Masuk'
  }, [isRegister, submitting])

  useEffect(() => {
    if (!loading && user) router.replace('/dashboard')
  }, [user, loading, router])

  useEffect(() => {
    if (otpCooldown <= 0) return
    const timer = window.setInterval(() => {
      setOtpCooldown(current => Math.max(0, current - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [otpCooldown])

  const toggleMode = () => {
    setMode(current => (current === 'login' ? 'register' : 'login'))
    setError('')
    setSuccess('')
    setPassword('')
    setConfirmPassword('')
    setOtpCode('')
    setRegistrationOtp('')
    setOtpCooldown(0)
    setOtpDeliveryMode(null)
  }

  const handleSendOtp = async () => {
    setError('')
    setSuccess('')

    if (!email.trim()) { setError('Email wajib diisi.'); return }
    if (!password) { setError('Password wajib diisi sebelum mengirim OTP.'); return }
    if (otpCooldown > 0) return

    setSendingOtp(true)
    try {
      const response = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          password,
          appName: appIdentity.appName,
        }),
        cache: 'no-store',
      })
      const payload = await response.json().catch(() => ({})) as {
        code?: string
        message?: string
        mode?: 'email' | 'admin_pin'
        maskedEmail?: string
        cooldownSeconds?: number
        expiresMinutes?: number
        retryAfter?: number
      }

      if (!response.ok) {
        if (payload.code === 'invalid-credential') throw new Error('Email atau password salah.')
        if (payload.code === 'pending-approval') throw new Error('Akun masih menunggu persetujuan Admin.')
        if (payload.code === 'account-inactive') throw new Error('Akun sedang dinonaktifkan oleh Admin.')
        if (payload.code === 'not-team') throw new Error('Akun tidak terdaftar sebagai anggota tim.')
        if (payload.code === 'otp-cooldown') {
          const wait = Number(payload.retryAfter || 60)
          setOtpCooldown(wait)
          throw new Error(`OTP baru dapat dikirim dalam ${wait} detik.`)
        }
        if (payload.code === 'otp-rate-limit') {
          const wait = Number(payload.retryAfter || 60)
          throw new Error(`Terlalu banyak permintaan OTP. Coba lagi dalam ${wait} detik.`)
        }
        if (payload.code === 'email-send-failed') throw new Error('Email OTP gagal dikirim. Periksa konfigurasi EmailJS atau coba lagi.')
        if (payload.code === 'otp-service-unavailable') throw new Error('Layanan OTP belum dikonfigurasi atau sedang tidak tersedia.')
        throw new Error(payload.message || 'Gagal mengirim OTP.')
      }

      if (payload.mode === 'admin_pin') {
        setOtpDeliveryMode('admin_pin')
        setSuccess('Akun Admin terdeteksi. Masukkan PIN Admin pada kolom di bawah.')
        return
      }

      setOtpDeliveryMode('email')
      setOtpCode('')
      setOtpCooldown(Number(payload.cooldownSeconds || 60))
      setSuccess(`OTP sudah dikirim ke ${payload.maskedEmail || 'email akun'}. Kode berlaku ${payload.expiresMinutes || 10} menit.`)
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Gagal mengirim OTP.')
    } finally {
      setSendingOtp(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!isRegister && otpCode.replace(/\D/g, '').length !== 6) {
      setError('Masukkan OTP email atau PIN Admin sebanyak 6 angka.')
      return
    }

    if (isRegister) {
      if (!name.trim()) { setError('Nama wajib diisi.'); return }
      if (password.length < 6) { setError('Password minimal 6 karakter.'); return }
      if (password !== confirmPassword) { setError('Konfirmasi password belum sama.'); return }
      if (registrationOtp.replace(/\D/g, '').length !== 6) {
        setError('OTP Pendaftaran wajib 6 angka dan harus diminta dari Admin.')
        return
      }
    }

    setSubmitting(true)
    try {
      if (isRegister) {
        await signUp(name, email, password, registrationOtp)
        setSuccess('Akun berhasil didaftarkan. Silakan tunggu persetujuan Admin sebelum bisa masuk aplikasi.')
        setMode('login')
        setName('')
        setPassword('')
        setConfirmPassword('')
        setOtpCode('')
        setRegistrationOtp('')
      } else {
        await signIn(email, password, otpCode)
        router.replace('/dashboard')
      }
    } catch (err) {
      // Login: hanya redirect ke /not-team untuk credential invalid
      if (!isRegister && shouldRedirectNotTeam(err)) {
        router.replace('/not-team')
        return
      }
      // Semua error lainnya (termasuk semua error register) tampil sebagai pesan di form
      setError(getFirebaseAuthMessage(err, mode))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f5f4]">
        <Loader2 className="w-6 h-6 animate-spin text-[#1B8A7A]" />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f5f5f4] p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl overflow-hidden flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
            style={{ background: appIdentity.appLogoData ? 'transparent' : appIdentity.appColor }}>
            {appIdentity.appLogoData
              ? <img src={appIdentity.appLogoData} alt="logo" className="w-full h-full object-cover" />
              : appIdentity.appInitials || 'DK'}
          </div>
          <div>
            <div className="font-semibold text-sm text-gray-900">{appIdentity.appName}</div>
            <div className="text-xs text-gray-500">{appIdentity.appSubtitle}</div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-gray-900 mb-1">{title}</h1>
          <p className="text-sm text-gray-500 mb-6">{subtitle}</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {isRegister && (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Nama Lengkap</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Nama user"
                  required={isRegister}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A] focus:ring-2 focus:ring-[#1B8A7A]/10 transition-all"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => { setEmail(e.target.value); setOtpDeliveryMode(null); setOtpCooldown(0); setOtpCode('') }}
                placeholder="nama@financebub.com"
                required
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A] focus:ring-2 focus:ring-[#1B8A7A]/10 transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => { setPassword(e.target.value); setOtpDeliveryMode(null); setOtpCooldown(0); setOtpCode('') }}
                  placeholder="••••••••"
                  required
                  className="w-full px-3 py-2.5 pr-10 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A] focus:ring-2 focus:ring-[#1B8A7A]/10 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  aria-label={showPass ? 'Sembunyikan password' : 'Tampilkan password'}
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {!isRegister && (
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <label className="block text-xs font-medium text-gray-700">
                    {otpDeliveryMode === 'admin_pin' ? 'PIN Admin' : 'Kode OTP'}
                  </label>
                  <button
                    type="button"
                    onClick={handleSendOtp}
                    disabled={sendingOtp || otpCooldown > 0}
                    className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#1B8A7A] hover:text-[#0F6E56] disabled:cursor-not-allowed disabled:text-gray-400"
                  >
                    {sendingOtp ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
                    {sendingOtp
                      ? 'Mengirim...'
                      : otpCooldown > 0
                        ? `Kirim ulang (${otpCooldown} dtk)`
                        : 'Kirim OTP ke Email'}
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showOtp ? 'text' : 'password'}
                    inputMode="numeric"
                    value={otpCode}
                    onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="••••••"
                    maxLength={6}
                    className="w-full px-3 py-2.5 pr-10 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A] focus:ring-2 focus:ring-[#1B8A7A]/10 transition-all tracking-[0.28em] font-semibold"
                  />
                  <button type="button" onClick={() => setShowOtp(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    aria-label={showOtp ? 'Sembunyikan OTP atau PIN' : 'Tampilkan OTP atau PIN'}
                  >
                    {showOtp ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-gray-400">
                  User menerima OTP melalui email. Admin tetap memakai PIN Admin pada kolom yang sama.
                </p>
              </div>
            )}

            {isRegister && (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Konfirmasi Password</label>
                <input
                  type={showPass ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  required={isRegister}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A] focus:ring-2 focus:ring-[#1B8A7A]/10 transition-all"
                />
              </div>
            )}

            {isRegister && (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">OTP Pendaftaran</label>
                <div className="relative">
                  <input
                    type={showOtp ? 'text' : 'password'}
                    inputMode="numeric"
                    value={registrationOtp}
                    onChange={e => setRegistrationOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="••••••"
                    required={isRegister}
                    maxLength={6}
                    className="w-full px-3 py-2.5 pr-10 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A] focus:ring-2 focus:ring-[#1B8A7A]/10 transition-all tracking-[0.28em] font-semibold"
                  />
                  <button type="button" onClick={() => setShowOtp(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showOtp ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-gray-400">
                  Tanpa OTP Pendaftaran yang dibuat Admin, pendaftaran akan langsung ditolak.
                </p>
              </div>
            )}

            {error && (
              <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            {success && (
              <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 leading-relaxed">
                {success}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 bg-[#1B8A7A] hover:bg-[#0F6E56] text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {buttonLabel}
            </button>
          </form>

          <div className="mt-5 text-center text-sm text-gray-500">
            {isRegister ? 'Sudah punya akun?' : 'Belum punya akun?'}{' '}
            <button
              type="button"
              onClick={toggleMode}
              className="font-semibold text-[#1B8A7A] hover:text-[#0F6E56]"
            >
              {isRegister ? 'Masuk di sini' : 'Daftar di sini'}
            </button>
          </div>

          <div className={`mt-4 text-xs rounded-lg px-3 py-2 leading-relaxed ${isRegister ? 'text-amber-700 bg-amber-50 border border-amber-100' : 'text-[#1B8A7A] bg-[#E1F5EE] border border-[#1B8A7A]/20'}`}>
            {isRegister
              ? 'Akun baru hanya bisa daftar dengan OTP Pendaftaran dari Admin. Setelah itu tetap harus menunggu approval Admin.'
              : 'Keamanan tambahan aktif: OTP user dikirim ke email dan berlaku 10 menit. Admin tetap memakai PIN Admin.'}
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          {appIdentity.appFooter} © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  )
}
