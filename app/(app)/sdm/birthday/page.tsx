'use client'

import { useEffect, useMemo, useState } from 'react'
import { ref, onValue, off } from 'firebase/database'
import { db } from '@/lib/firebase'
import { CalendarDays, Gift, Search, Cake, Clock, Users, PartyPopper } from 'lucide-react'

const USER_ID = 'financebub-main'
const PATH = `users/${USER_ID}/data/_karyawan`

interface Karyawan {
  id: string
  nama: string
  nik?: string
  tmplahir?: string
  tgllahir?: string
  jk?: string
  hp?: string
  email?: string
  jabatan?: string
  dept?: string
  status?: 'Aktif' | 'Tidak Aktif' | 'Resign' | string
}

interface BirthdayItem extends Karyawan {
  birthDate: Date
  birthdayThisYear: Date
  age: number
  day: number
  daysFromToday: number
  statusLabel: 'Hari Ini' | 'Akan Datang' | 'Sudah Lewat'
}

const MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
]

function subscribeArr(path: string, cb: (arr: any[]) => void) {
  const dbRef = ref(db, path)
  const handler = (snap: any) => {
    if (!snap.exists()) { cb([]); return }
    try {
      const val = snap.val()
      const arr = typeof val === 'string' ? JSON.parse(val) : val
      cb(Array.isArray(arr) ? arr.filter(Boolean) : [])
    } catch {
      cb([])
    }
  }
  onValue(dbRef, handler)
  return () => off(dbRef, 'value', handler)
}

function parseBirthDate(value?: string) {
  if (!value) return null
  const clean = String(value).trim()
  if (!clean) return null

  const iso = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) {
    const year = Number(iso[1])
    const month = Number(iso[2]) - 1
    const day = Number(iso[3])
    const date = new Date(year, month, day)
    return Number.isNaN(date.getTime()) ? null : date
  }

  const slash = clean.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (slash) {
    const day = Number(slash[1])
    const month = Number(slash[2]) - 1
    const year = Number(slash[3])
    const date = new Date(year, month, day)
    return Number.isNaN(date.getTime()) ? null : date
  }

  const fallback = new Date(clean)
  return Number.isNaN(fallback.getTime()) ? null : fallback
}

function formatDate(date: Date) {
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`
}

function formatBirthdayDate(date: Date) {
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`
}

function daysBetween(a: Date, b: Date) {
  const start = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()
  const end = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()
  return Math.round((end - start) / 86400000)
}

function getInitial(name?: string) {
  return (name || '?').trim().charAt(0).toUpperCase() || '?'
}

function statusClass(label: BirthdayItem['statusLabel']) {
  if (label === 'Hari Ini') return 'bg-amber-100 text-amber-700 border-amber-200'
  if (label === 'Akan Datang') return 'bg-emerald-100 text-emerald-700 border-emerald-200'
  return 'bg-gray-100 text-gray-500 border-gray-200'
}

export default function BirthdayPage() {
  const [list, setList] = useState<Karyawan[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const today = useMemo(() => new Date(), [])
  const currentMonth = today.getMonth()
  const currentYear = today.getFullYear()

  useEffect(() => {
    return subscribeArr(PATH, data => {
      setList(data as Karyawan[])
      setLoading(false)
    })
  }, [])

  const birthdays = useMemo<BirthdayItem[]>(() => {
    return list
      .filter(k => (k.status || 'Aktif') === 'Aktif')
      .map(k => {
        const birthDate = parseBirthDate(k.tgllahir)
        if (!birthDate || birthDate.getMonth() !== currentMonth) return null
        const birthdayThisYear = new Date(currentYear, birthDate.getMonth(), birthDate.getDate())
        const diff = daysBetween(today, birthdayThisYear)
        const statusLabel: BirthdayItem['statusLabel'] = diff === 0 ? 'Hari Ini' : diff > 0 ? 'Akan Datang' : 'Sudah Lewat'
        return {
          ...k,
          birthDate,
          birthdayThisYear,
          age: currentYear - birthDate.getFullYear(),
          day: birthDate.getDate(),
          daysFromToday: diff,
          statusLabel,
        }
      })
      .filter(Boolean)
      .sort((a, b) => {
        const left = a as BirthdayItem
        const right = b as BirthdayItem
        if (left.day !== right.day) return left.day - right.day
        return (left.nama || '').localeCompare(right.nama || '')
      }) as BirthdayItem[]
  }, [list, currentMonth, currentYear, today])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return birthdays
    return birthdays.filter(k => [k.nama, k.jabatan, k.dept, k.hp, k.email]
      .some(v => (v || '').toLowerCase().includes(q)))
  }, [birthdays, search])

  const todayBirthdays = birthdays.filter(k => k.statusLabel === 'Hari Ini')
  const upcomingBirthdays = birthdays.filter(k => k.statusLabel === 'Akan Datang')
  const passedBirthdays = birthdays.filter(k => k.statusLabel === 'Sudah Lewat')
  const nextBirthday = upcomingBirthdays[0] || todayBirthdays[0] || birthdays[0]

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-400 mb-1">
            <Cake className="w-4 h-4 text-[#1B8A7A]" />
            <span>SDM</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Birthday</h1>
          <p className="text-sm text-gray-500 mt-1">
            Ulang tahun karyawan bulan {MONTHS[currentMonth]} {currentYear}, diambil dari database karyawan.
          </p>
        </div>
        <div className="rounded-2xl bg-[#E1F5EE] border border-[#1B8A7A]/20 px-4 py-3 min-w-[220px]">
          <div className="text-[10px] font-bold tracking-wider text-[#1B8A7A] uppercase">Bulan Berjalan</div>
          <div className="text-lg font-bold text-gray-900 mt-1">{MONTHS[currentMonth]} {currentYear}</div>
          <div className="text-xs text-gray-500">Hari ini: {formatDate(today)}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Total Birthday</div>
            <Gift className="w-5 h-5 text-[#1B8A7A]" />
          </div>
          <div className="text-3xl font-bold text-gray-900">{birthdays.length}</div>
          <div className="text-xs text-gray-400 mt-1">karyawan bulan ini</div>
        </div>
        <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Hari Ini</div>
            <PartyPopper className="w-5 h-5 text-amber-500" />
          </div>
          <div className="text-3xl font-bold text-amber-600">{todayBirthdays.length}</div>
          <div className="text-xs text-gray-400 mt-1">perlu disiapkan surprise</div>
        </div>
        <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Akan Datang</div>
            <CalendarDays className="w-5 h-5 text-emerald-600" />
          </div>
          <div className="text-3xl font-bold text-emerald-600">{upcomingBirthdays.length}</div>
          <div className="text-xs text-gray-400 mt-1">belum lewat bulan ini</div>
        </div>
        <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Next Birthday</div>
            <Clock className="w-5 h-5 text-blue-600" />
          </div>
          <div className="text-lg font-bold text-gray-900 truncate">{nextBirthday?.nama || '-'}</div>
          <div className="text-xs text-gray-400 mt-1">
            {nextBirthday ? `${formatBirthdayDate(nextBirthday.birthdayThisYear)} • ke-${nextBirthday.age}` : 'Tidak ada data'}
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-sm font-bold text-gray-900">Daftar Ulang Tahun Bulan Ini</h2>
            <p className="text-xs text-gray-400 mt-1">Urut berdasarkan tanggal ulang tahun terdekat di bulan berjalan.</p>
          </div>
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Cari nama, jabatan, departemen..."
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:border-[#1B8A7A] focus:ring-1 focus:ring-[#1B8A7A]/10"
            />
          </div>
        </div>

        {loading ? (
          <div className="p-5 space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="h-16 rounded-xl bg-gray-50 animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-20 text-center">
            <div className="w-14 h-14 rounded-2xl bg-gray-50 mx-auto flex items-center justify-center mb-4">
              <Users className="w-7 h-7 text-gray-300" />
            </div>
            <div className="text-sm font-semibold text-gray-700">Tidak ada ulang tahun bulan ini</div>
            <div className="text-xs text-gray-400 mt-1">Pastikan tanggal lahir karyawan sudah diisi di Database Karyawan.</div>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {filtered.map(k => (
              <div key={k.id} className="px-5 py-4 hover:bg-gray-50 transition-colors">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-12 h-12 rounded-2xl bg-[#E1F5EE] text-[#1B8A7A] flex items-center justify-center font-bold text-sm flex-shrink-0">
                      {getInitial(k.nama)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-bold text-gray-900">{k.nama}</h3>
                        <span className={`text-[10px] font-semibold px-2 py-1 rounded-full border ${statusClass(k.statusLabel)}`}>
                          {k.statusLabel}
                        </span>
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        {[k.jabatan, k.dept].filter(Boolean).join(' • ') || 'Data jabatan belum diisi'}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {k.hp || k.email || 'Kontak belum diisi'}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 md:min-w-[360px]">
                    <div className="rounded-xl bg-gray-50 px-3 py-2">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Tanggal</div>
                      <div className="text-sm font-bold text-gray-900 mt-0.5">{formatBirthdayDate(k.birthdayThisYear)}</div>
                    </div>
                    <div className="rounded-xl bg-gray-50 px-3 py-2">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Ulang Tahun</div>
                      <div className="text-sm font-bold text-[#1B8A7A] mt-0.5">Ke-{k.age}</div>
                    </div>
                    <div className="rounded-xl bg-gray-50 px-3 py-2">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Countdown</div>
                      <div className="text-sm font-bold text-gray-900 mt-0.5">
                        {k.daysFromToday === 0 ? 'Hari ini' : k.daysFromToday > 0 ? `${k.daysFromToday} hari` : `Lewat ${Math.abs(k.daysFromToday)} hari`}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
