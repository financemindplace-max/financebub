'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAuth, changeAdminPin } from '@/lib/auth-context'
import { db } from '@/lib/firebase'
import { onValue, ref, remove, set, update } from 'firebase/database'
import {
  ShieldCheck,
  UserPlus,
  Search,
  Save,
  Trash2,
  UserCog,
  Mail,
  KeyRound,
  Lock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Copy,
  MessageCircle,
} from 'lucide-react'

type LoginOtp = {
  uid: string
  name?: string
  email?: string
  code: string
  createdAt: number
  expiresAt: number
  createdBy?: string
  createdByName?: string
  usedAt?: number | null
}

type RegistrationOtp = {
  code: string
  createdAt: number
  expiresAt: number
  createdBy?: string
  createdByName?: string
  usedAt?: number | null
  usedBy?: string
  usedByEmail?: string
}

type ManagedUser = {
  uid: string
  name: string
  email: string
  role: 'admin' | 'user' | 'viewer' | string
  status?: 'active' | 'pending' | 'inactive' | string
  createdAt?: number
  updatedAt?: number
  lastLoginAt?: number
}

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'user', label: 'User' },
]

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Menunggu Approval' },
  { value: 'active', label: 'Aktif' },
  { value: 'inactive', label: 'Nonaktif' },
]

function formatDate(timestamp?: number) {
  if (!timestamp) return '-'
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

function normalizeStatus(status?: string) {
  const value = String(status || 'pending').toLowerCase()
  if (value === 'active') return 'active'
  if (value === 'inactive') return 'inactive'
  return 'pending'
}

function roleLabel(role?: string) {
  return String(role || 'user').toLowerCase() === 'admin' ? 'Admin' : 'User'
}

function makeOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

function makeEmailKey(email: string) {
  return String(email || '').trim().toLowerCase().replace(/[.#$\[\]/]/g, '_')
}

function buildOtpMessage(target: ManagedUser, code: string) {
  return `Kode OTP FinanceBub untuk login ${target.name || target.email}: ${code}. Berlaku 5 menit. Jangan bagikan ke pihak lain.`
}

function buildRegistrationOtpMessage(code: string) {
  return `Kode OTP Pendaftaran FinanceBub: ${code}. Berlaku 5 menit dan hanya bisa dipakai sekali. Jangan bagikan ke pihak luar.`
}

export default function UsersPage() {
  const { user } = useAuth()
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState('')
  const [otps, setOtps] = useState<Record<string, LoginOtp>>({})
  const [registrationOtp, setRegistrationOtp] = useState<RegistrationOtp | null>(null)
  const [draft, setDraft] = useState({ uid: '', name: '', email: '', role: 'user' })
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [pinMessage, setPinMessage] = useState('')
  const [pinError, setPinError] = useState('')
  const [savingPin, setSavingPin] = useState(false)

  const handleChangePin = async () => {
    setPinMessage('')
    setPinError('')
    const clean = newPin.replace(/\D/g, '')
    if (clean.length !== 6) { setPinError('PIN harus 6 digit angka.'); return }
    if (clean !== confirmPin.replace(/\D/g, '')) { setPinError('Konfirmasi PIN tidak cocok.'); return }
    setSavingPin(true)
    try {
      await changeAdminPin(clean)
      setPinMessage('PIN admin berhasil diubah. Gunakan PIN baru saat login berikutnya.')
      setNewPin('')
      setConfirmPin('')
    } catch (e) {
      setPinError(e instanceof Error ? e.message : 'Gagal mengubah PIN.')
    } finally {
      setSavingPin(false)
    }
  }

  const isAdmin = user?.role?.toLowerCase() === 'admin'

  useEffect(() => {
    if (!isAdmin) return
    const usersRef = ref(db, 'users_list')
    const unsub = onValue(usersRef, (snap) => {
      const data = snap.val() || {}
      const list = Object.entries(data).map(([uid, value]) => {
        const item = (value || {}) as Partial<ManagedUser>
        return {
          uid,
          name: item.name || item.email || 'Tanpa nama',
          email: item.email || '',
          role: item.role || 'user',
          status: item.status || 'active',
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          lastLoginAt: item.lastLoginAt,
        }
      })
      setUsers(list.sort((a, b) => String(a.name).localeCompare(String(b.name))))
      setLoading(false)
    })
    return () => unsub()
  }, [isAdmin])

  useEffect(() => {
    if (!isAdmin) return
    const otpRef = ref(db, 'login_otps')
    const unsub = onValue(otpRef, (snap) => {
      setOtps((snap.val() || {}) as Record<string, LoginOtp>)
    })
    return () => unsub()
  }, [isAdmin])

  useEffect(() => {
    if (!isAdmin) return
    const regOtpRef = ref(db, 'registration_otps/current')
    const unsub = onValue(regOtpRef, (snap) => {
      setRegistrationOtp((snap.val() || null) as RegistrationOtp | null)
    })
    return () => unsub()
  }, [isAdmin])


  const filteredUsers = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return users
    return users.filter(item => {
      return [item.name, item.email, item.uid, item.role, item.status]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(keyword))
    })
  }, [query, users])

  const totalAdmin = users.filter(item => String(item.role).toLowerCase() === 'admin').length
  const totalActive = users.filter(item => normalizeStatus(item.status) === 'active').length
  const totalPending = users.filter(item => normalizeStatus(item.status) === 'pending').length
  const totalInactive = users.filter(item => normalizeStatus(item.status) === 'inactive').length

  const showMessage = (text: string) => {
    setMessage(text)
    window.setTimeout(() => setMessage(''), 2600)
  }

  const saveUser = async (targetUid: string, patch: Partial<ManagedUser> & Record<string, unknown>) => {
    if (!targetUid) return
    const cleanPatch = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    )
    await update(ref(db, `users_list/${targetUid}`), {
      ...cleanPatch,
      updatedAt: Date.now(),
    })
    showMessage('Data user berhasil disimpan.')
  }

  const addManualUser = async () => {
    const uid = draft.uid.trim()
    if (!uid) {
      showMessage('UID wajib diisi. Ambil UID dari Firebase Authentication > Users.')
      return
    }
    await set(ref(db, `users_list/${uid}`), {
      uid,
      name: draft.name.trim() || draft.email.trim() || 'User Baru',
      email: draft.email.trim(),
      role: draft.role,
      status: 'active',
      approvedAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    setDraft({ uid: '', name: '', email: '', role: 'user' })
    showMessage('User berhasil ditambahkan ke daftar akses.')
  }

  const deleteUserAccess = async (target: ManagedUser) => {
    if (target.uid === user?.uid) {
      showMessage('Akses akun sendiri tidak bisa dihapus dari halaman ini.')
      return
    }
    const ok = window.confirm(`Hapus akses ${target.name || target.email}? Akun Firebase Auth tidak ikut terhapus.`)
    if (!ok) return
    await remove(ref(db, `users_list/${target.uid}`))
    await remove(ref(db, `login_otps/${target.uid}`))
    const key = makeEmailKey(target.email || '')
    if (key) await remove(ref(db, `login_otps_by_email/${key}`)).catch(() => {})
    showMessage('Akses user berhasil dihapus dari daftar.')
  }

  const getActiveOtp = (uid: string) => {
    const otp = otps[uid]
    if (!otp || otp.usedAt || Date.now() > Number(otp.expiresAt || 0)) return null
    return otp
  }

  const activeRegistrationOtp = registrationOtp && !registrationOtp.usedAt && Date.now() <= Number(registrationOtp.expiresAt || 0)
    ? registrationOtp
    : null

  const generateRegistrationOtp = async () => {
    const code = makeOtpCode()
    const expiresAt = Date.now() + 5 * 60 * 1000
    await set(ref(db, 'registration_otps/current'), {
      code,
      createdAt: Date.now(),
      createdBy: user?.uid || '',
      createdByName: user?.name || '',
      expiresAt,
      usedAt: null,
    })

    try {
      await navigator.clipboard.writeText(buildRegistrationOtpMessage(code))
      showMessage(`OTP Pendaftaran ${code} dibuat. Pesan sudah disalin. Expired 5 menit.`)
    } catch {
      showMessage(`OTP Pendaftaran ${code} dibuat. Expired 5 menit.`)
    }
  }

  const copyRegistrationOtpMessage = async (code: string) => {
    try {
      await navigator.clipboard.writeText(buildRegistrationOtpMessage(code))
      showMessage('Pesan OTP Pendaftaran berhasil disalin.')
    } catch {
      showMessage('Browser tidak mengizinkan copy otomatis. Silakan copy kode manual.')
    }
  }

  const generateLoginOtp = async (target: ManagedUser) => {
    const status = normalizeStatus(target.status)
    if (status !== 'active') {
      showMessage('OTP hanya bisa dibuat untuk user dengan status Aktif.')
      return
    }

    const code = makeOtpCode()
    const expiresAt = Date.now() + 5 * 60 * 1000
    const otpPayload = {
      uid: target.uid,
      name: target.name || '',
      email: target.email || '',
      code,
      createdAt: Date.now(),
      createdBy: user?.uid || '',
      createdByName: user?.name || '',
      expiresAt,
      usedAt: null,
    }

    await set(ref(db, `login_otps/${target.uid}`), otpPayload)

    // Backup OTP berdasarkan email. Ini memperbaiki kasus UID di Firebase Auth berubah
    // setelah user dihapus/daftar ulang, sementara data akses lama masih memakai email yang sama.
    const key = makeEmailKey(target.email || '')
    if (key) {
      await set(ref(db, `login_otps_by_email/${key}`), otpPayload)
    }

    const text = buildOtpMessage(target, code)
    try {
      await navigator.clipboard.writeText(text)
      showMessage(`OTP ${code} dibuat. Pesan WA sudah disalin. Expired 5 menit.`)
    } catch {
      showMessage(`OTP ${code} dibuat. Expired 5 menit.`)
    }
  }

  const copyOtpMessage = async (target: ManagedUser, code: string) => {
    try {
      await navigator.clipboard.writeText(buildOtpMessage(target, code))
      showMessage('Pesan OTP berhasil disalin untuk dikirim via WhatsApp.')
    } catch {
      showMessage('Browser tidak mengizinkan copy otomatis. Silakan copy kode OTP manual.')
    }
  }

  if (!isAdmin) {
    return (
      <div className="p-8">
        <div className="max-w-xl rounded-2xl border border-red-100 bg-white p-6 shadow-sm">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-red-50 text-red-600">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Akses ditolak</h1>
          <p className="mt-2 text-sm text-gray-500">
            Menu Manajemen User hanya bisa dibuka oleh akun dengan role Admin.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Manajemen User</h1>
          <p className="mt-1 text-sm text-gray-500">
            Lihat siapa saja yang punya akses, approve atau tolak user baru, ubah role Admin/User, dan nonaktifkan akun.
          </p>
        </div>
        <div className="rounded-2xl bg-[#E1F5EE] px-4 py-3 text-[#1B8A7A]">
          <div className="flex items-center gap-2 text-sm font-bold">
            <ShieldCheck className="h-4 w-4" /> Admin Area
          </div>
          <div className="mt-1 text-xs opacity-80">Login sebagai {user?.name}</div>
        </div>
      </div>

      {message && (
        <div className="mb-5 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          {message}
        </div>
      )}

      <div className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <div className="font-bold">OTP Login User</div>
          <p className="mt-1 leading-relaxed">
            Setiap user aktif wajib memasukkan OTP saat login. Admin memasukkan PIN admin (bukan OTP) di kolom yang sama. Generate OTP user dari tombol di kolom Aksi, lalu kirim kode tersebut ke user melalui WhatsApp. Kode expired otomatis dalam 5 menit dan hanya bisa dipakai sekali.
          </p>
        </div>

        <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="font-bold">OTP Pendaftaran User Baru</div>
              <p className="mt-1 leading-relaxed">
                User baru hanya bisa daftar jika memasukkan OTP Pendaftaran ini. Kode berlaku 5 menit dan hanya bisa dipakai sekali.
              </p>
            </div>
            <button
              type="button"
              onClick={generateRegistrationOtp}
              className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100"
            >
              <KeyRound className="h-4 w-4" /> Generate OTP Pendaftaran
            </button>
          </div>

          {activeRegistrationOtp ? (
            <div className="mt-3 rounded-xl border border-red-100 bg-white p-3 text-xs text-red-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  OTP Pendaftaran:{' '}
                  <code className="rounded bg-red-50 px-2 py-1 font-bold tracking-[0.18em] text-red-900">
                    {activeRegistrationOtp.code}
                  </code>
                </div>
                <div className="text-[11px]">Exp: {formatDate(activeRegistrationOtp.expiresAt)}</div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => copyRegistrationOtpMessage(activeRegistrationOtp.code)}
                  className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-2 py-1 font-semibold text-red-700 hover:bg-red-100"
                >
                  <Copy className="h-3.5 w-3.5" /> Copy pesan
                </button>
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(buildRegistrationOtpMessage(activeRegistrationOtp.code))}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 font-semibold text-emerald-700 hover:bg-emerald-100"
                >
                  <MessageCircle className="h-3.5 w-3.5" /> Buka WhatsApp
                </a>
              </div>
            </div>
          ) : (
            <div className="mt-3 rounded-xl border border-red-100 bg-white px-3 py-2 text-xs font-medium text-red-600">
              Belum ada OTP Pendaftaran aktif. Klik Generate sebelum mengizinkan user baru daftar.
            </div>
          )}
        </div>
      </div>

      {/* Ganti PIN Admin */}
      <div className="mb-5 rounded-2xl border border-[#1B8A7A]/20 bg-[#F0FBF8] px-4 py-4">
        <div className="flex items-center gap-2 text-sm font-bold text-[#0F6E56]">
          <Lock className="h-4 w-4" /> Ganti PIN Admin
        </div>
        <p className="mt-1 text-xs leading-relaxed text-[#0F6E56]/80">
          PIN ini dipakai admin saat login (diketik di kolom OTP). PIN awal default <strong>122891</strong>. Ubah secara berkala demi keamanan. PIN harus 6 digit angka.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-gray-600">PIN Baru</label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="6 digit"
              className="w-32 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#1B8A7A]"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-gray-600">Konfirmasi PIN</label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="Ulangi PIN"
              className="w-32 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#1B8A7A]"
            />
          </div>
          <button
            onClick={handleChangePin}
            disabled={savingPin}
            className="flex items-center gap-1.5 rounded-lg bg-[#1B8A7A] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0F6E56] disabled:opacity-60"
          >
            <Save className="h-4 w-4" /> {savingPin ? 'Menyimpan...' : 'Simpan PIN'}
          </button>
        </div>
        {pinMessage && <div className="mt-2 text-xs font-medium text-emerald-700">{pinMessage}</div>}
        {pinError && <div className="mt-2 text-xs font-medium text-red-600">{pinError}</div>}
      </div>

      <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-wide text-gray-400">Total User</div>
          <div className="mt-2 text-2xl font-bold text-gray-900">{users.length}</div>
        </div>
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-wide text-gray-400">Admin</div>
          <div className="mt-2 text-2xl font-bold text-[#1B8A7A]">{totalAdmin}</div>
        </div>
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-wide text-gray-400">Aktif</div>
          <div className="mt-2 text-2xl font-bold text-emerald-600">{totalActive}</div>
        </div>
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-wide text-gray-400">Pending / Nonaktif</div>
          <div className="mt-2 text-2xl font-bold text-amber-600">{totalPending} / <span className="text-red-600">{totalInactive}</span></div>
        </div>
      </div>

      <div className="mb-5 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2 text-sm font-bold text-gray-900">
          <UserPlus className="h-4 w-4 text-[#1B8A7A]" /> Tambah daftar akses manual
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.3fr_1fr_1fr_150px_auto]">
          <input
            value={draft.uid}
            onChange={event => setDraft(prev => ({ ...prev, uid: event.target.value }))}
            placeholder="Firebase UID user"
            className="rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#1B8A7A]"
          />
          <input
            value={draft.name}
            onChange={event => setDraft(prev => ({ ...prev, name: event.target.value }))}
            placeholder="Nama user"
            className="rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#1B8A7A]"
          />
          <input
            value={draft.email}
            onChange={event => setDraft(prev => ({ ...prev, email: event.target.value }))}
            placeholder="Email"
            className="rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#1B8A7A]"
          />
          <select
            value={draft.role}
            onChange={event => setDraft(prev => ({ ...prev, role: event.target.value }))}
            className="rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#1B8A7A]"
          >
            {ROLE_OPTIONS.map(role => <option key={role.value} value={role.value}>{role.label}</option>)}
          </select>
          <button
            type="button"
            onClick={addManualUser}
            className="rounded-xl bg-[#1B8A7A] px-4 py-2 text-sm font-bold text-white hover:opacity-90"
          >
            Tambah
          </button>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-gray-400">
          Catatan: user yang daftar sendiri akan muncul sebagai Menunggu Approval. Ubah statusnya menjadi Aktif agar bisa masuk aplikasi.
        </p>
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 p-5">
          <div>
            <div className="text-sm font-bold text-gray-900">Daftar Akses</div>
            <div className="mt-1 text-xs text-gray-400">Data diambil dari Firebase Realtime Database: users_list</div>
          </div>
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Cari nama, email, UID, role..."
              className="w-full rounded-xl border border-gray-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-[#1B8A7A]"
            />
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-sm text-gray-400">Memuat daftar user...</div>
        ) : filteredUsers.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">Belum ada user yang cocok.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-sm">
              <thead className="bg-gray-50 text-left text-xs font-bold uppercase tracking-wide text-gray-400">
                <tr>
                  <th className="px-5 py-3">User</th>
                  <th className="px-5 py-3">UID</th>
                  <th className="px-5 py-3">Role</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Login Terakhir</th>
                  <th className="px-5 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map(item => {
                  const status = normalizeStatus(item.status)
                  const isSelf = item.uid === user?.uid
                  const activeOtp = getActiveOtp(item.uid)
                  return (
                    <tr key={item.uid} className="border-t border-gray-100 align-top">
                      <td className="px-5 py-4">
                        <div className="flex items-start gap-3">
                          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[#E1F5EE] text-sm font-bold text-[#1B8A7A]">
                            {(item.name || item.email || 'U').charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <input
                              defaultValue={item.name}
                              onBlur={event => {
                                const value = event.target.value.trim()
                                if (value && value !== item.name) saveUser(item.uid, { name: value })
                              }}
                              className="w-full rounded-lg border border-transparent px-2 py-1 font-semibold text-gray-900 outline-none hover:border-gray-200 focus:border-[#1B8A7A]"
                            />
                            <div className="mt-1 flex items-center gap-1 text-xs text-gray-400">
                              <Mail className="h-3 w-3" />
                              <input
                                defaultValue={item.email}
                                onBlur={event => {
                                  const value = event.target.value.trim()
                                  if (value !== item.email) saveUser(item.uid, { email: value })
                                }}
                                className="w-full rounded border border-transparent px-1 py-0.5 outline-none hover:border-gray-200 focus:border-[#1B8A7A]"
                              />
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <KeyRound className="h-3.5 w-3.5" />
                          <code className="max-w-[220px] truncate rounded bg-gray-50 px-2 py-1">{item.uid}</code>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <select
                          value={String(item.role || 'user').toLowerCase() === 'admin' ? 'admin' : 'user'}
                          onChange={event => saveUser(item.uid, { role: event.target.value })}
                          className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold outline-none focus:border-[#1B8A7A]"
                        >
                          {ROLE_OPTIONS.map(role => <option key={role.value} value={role.value}>{role.label}</option>)}
                        </select>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            value={status}
                            disabled={isSelf}
                            onChange={event => saveUser(item.uid, {
                              status: event.target.value,
                              approvedAt: event.target.value === 'active' ? Date.now() : undefined,
                            })}
                            className={`rounded-xl border px-3 py-2 text-xs font-semibold outline-none focus:border-[#1B8A7A] ${
                              status === 'active'
                                ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                                : status === 'pending'
                                  ? 'border-amber-100 bg-amber-50 text-amber-700'
                                  : 'border-red-100 bg-red-50 text-red-700'
                            } ${isSelf ? 'cursor-not-allowed opacity-60' : ''}`}
                            title={isSelf ? 'Status akun sendiri tidak bisa diubah' : 'Ubah status akses'}
                          >
                            {STATUS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                          </select>
                          {status === 'pending' && !isSelf && (
                            <>
                              <button
                                type="button"
                                onClick={() => saveUser(item.uid, { status: 'active', approvedAt: Date.now() })}
                                className="inline-flex items-center gap-1.5 rounded-full bg-[#1B8A7A] px-3 py-1.5 text-xs font-bold text-white hover:opacity-90"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const ok = window.confirm(`Tolak akses ${item.name || item.email}? User ini tidak akan bisa masuk aplikasi.`)
                                  if (!ok) return
                                  saveUser(item.uid, {
                                    status: 'inactive',
                                    rejectedAt: Date.now(),
                                    rejectedBy: user?.uid,
                                  })
                                }}
                                className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:opacity-90"
                              >
                                <XCircle className="h-3.5 w-3.5" /> Tolak
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-4 text-xs text-gray-500">
                        {formatDate(item.lastLoginAt)}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                          {status === 'active' && (
                            <button
                              type="button"
                              onClick={() => generateLoginOtp(item)}
                              className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700 hover:bg-amber-100"
                              title="Generate OTP login 5 menit"
                            >
                              <KeyRound className="h-4 w-4" /> OTP
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => saveUser(item.uid, { updatedAt: Date.now() })}
                            className="rounded-xl border border-gray-200 p-2 text-gray-500 hover:border-[#1B8A7A] hover:text-[#1B8A7A]"
                            title="Simpan ulang"
                          >
                            <Save className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            disabled={isSelf}
                            onClick={() => deleteUserAccess(item)}
                            className="rounded-xl border border-gray-200 p-2 text-gray-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                            title={isSelf ? 'Akun sendiri tidak bisa dihapus' : 'Hapus akses'}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>

                        {activeOtp && (
                          <div className="mt-2 rounded-xl border border-amber-100 bg-amber-50 p-2 text-left text-xs text-amber-800">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                OTP: <code className="rounded bg-white px-1.5 py-0.5 font-bold tracking-[0.18em] text-amber-900">{activeOtp.code}</code>
                              </div>
                              <div className="text-[11px]">Exp: {formatDate(activeOtp.expiresAt)}</div>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => copyOtpMessage(item, activeOtp.code)}
                                className="inline-flex items-center gap-1 rounded-lg bg-white px-2 py-1 font-semibold text-amber-700 hover:bg-amber-100"
                              >
                                <Copy className="h-3.5 w-3.5" /> Copy pesan
                              </button>
                              <a
                                href={`https://wa.me/?text=${encodeURIComponent(buildOtpMessage(item, activeOtp.code))}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 rounded-lg bg-white px-2 py-1 font-semibold text-emerald-700 hover:bg-emerald-50"
                              >
                                <MessageCircle className="h-3.5 w-3.5" /> Buka WhatsApp
                              </a>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-5 rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm text-amber-800">
        <div className="mb-1 flex items-center gap-2 font-bold">
          <UserCog className="h-4 w-4" /> Catatan akses
        </div>
        <p>
          User baru hanya bisa daftar jika memakai OTP Pendaftaran yang dibuat Admin. Jika OTP salah/expired, akun tidak dibuat dan tidak masuk daftar approval. Setelah akun disetujui, user tetap wajib memasukkan OTP login yang dibuat Admin setiap login. Admin login memakai PIN yang dapat diganti dari panel ini. Untuk menghapus akun login sepenuhnya, hapus juga user tersebut dari Firebase Authentication.
        </p>
      </div>
    </div>
  )
}
