'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, FileText, Receipt, TrendingUp,
  Users, FileBarChart, Bell, Settings, LogOut,
  ChevronDown, ChevronLeft, ChevronRight, Building2, ArrowUpDown, Scale,
  DollarSign, UserCheck, Upload, ArchiveRestore, Wallet, Plus, UsersRound, Gift, Menu, X, Trash2, ClipboardList
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { deleteYearData } from '@/lib/rtdb'
import { useNotifications } from '@/lib/use-notifications'
import { ref, onValue, off } from 'firebase/database'
import { db } from '@/lib/firebase'

const USER_ID = 'financebub-main'

const YEAR_STORAGE_KEY = 'financebub_active_year'
const YEAR_OPTIONS_KEY = 'financebub_year_options'

const navItems = [
  {
    section: 'UTAMA',
    items: [
      { label: 'Notifikasi', href: '/notifikasi', icon: Bell },
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
      { label: 'Akumulasi', href: '/akumulasi', icon: TrendingUp },
      { label: 'Status Brand', href: '/brand', icon: Building2 },
    ]
  },
  {
    section: 'DOKUMEN',
    items: [
      { label: 'Quotation', href: '/quotation', icon: FileText },
      { label: 'Invoice', href: '/invoice', icon: Receipt },
      { label: 'Import Massal', href: '/import-massal', icon: Upload },
    ]
  },
  {
    section: 'KEUANGAN',
    items: [
      { label: 'Mutasi Kas/Bank', href: '/keuangan/mutasi', icon: ArrowUpDown },
      { label: 'Pengajuan', href: '/keuangan/pengajuan', icon: ClipboardList },
      { label: 'Laporan', href: '/keuangan/laporan', icon: FileBarChart },
      { label: 'Rekonsiliasi Pajak', href: '/keuangan/rekonsiliasi', icon: Scale },
      { label: 'L/R Final', href: '/keuangan/lrf', icon: DollarSign },
      { label: 'Neraca', href: '/keuangan/neraca', icon: Scale },
    ]
  },
  {
    section: 'SDM',
    items: [
      { label: 'Database Karyawan', href: '/sdm/karyawan', icon: Users },
      { label: 'Birthday', href: '/sdm/birthday', icon: Gift },
      { label: 'Slip Gaji', href: '/sdm/gaji', icon: UserCheck },
      { label: 'Kasbon', href: '/sdm/kasbon', icon: Wallet },
    ]
  },
  {
    section: 'TOOLS',
    items: [
      { label: 'Profil Perusahaan', href: '/profil', icon: Building2 },
      { label: 'Manajemen User', href: '/users', icon: UsersRound, adminOnly: true },
      { label: 'Dokumen Perusahaan', href: '/dokumen', icon: FileText, adminOnly: true },
      { label: 'Report Generator', href: '/report', icon: FileBarChart },
      { label: 'Backup & Restore', href: '/backup', icon: ArchiveRestore },
    ]
  },
]

const bottomItems = [
  { label: 'Pengaturan', href: '/pengaturan', icon: Settings },
]

function defaultYearOptions() {
  const now = new Date().getFullYear()
  return Array.from({ length: now + 3 - 2020 + 1 }, (_, i) => 2020 + i).reverse()
    .filter(year => Number.isFinite(year) && year >= 2020 && year <= 2099)
    .sort((a, b) => b - a)
}

function readStoredYearOptions() {
  if (typeof window === 'undefined') return defaultYearOptions()
  try {
    const raw = localStorage.getItem(YEAR_OPTIONS_KEY)
    if (raw !== null) {
      const parsed = JSON.parse(raw)
      const customYears = Array.isArray(parsed)
        ? parsed.map(Number).filter(y => Number.isFinite(y) && y >= 2020 && y <= 2099)
        : []
      return customYears.length > 0 ? customYears.sort((a, b) => b - a) : defaultYearOptions()
    }
    return defaultYearOptions()
  } catch {
    return defaultYearOptions()
  }
}

function readStoredYear() {
  if (typeof window === 'undefined') return new Date().getFullYear()
  const stored = Number(localStorage.getItem(YEAR_STORAGE_KEY))
  return Number.isFinite(stored) && stored >= 2020 && stored <= 2099 ? stored : new Date().getFullYear()
}

function looksLikeYearSelect(select: HTMLSelectElement) {
  const values = Array.from(select.options)
    .map(option => Number(option.value))
    .filter(value => Number.isFinite(value) && value >= 2020 && value <= 2099)
  return values.length >= 2
}

function setNativeSelectValue(select: HTMLSelectElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')
  if (descriptor?.set) descriptor.set.call(select, value)
  else select.value = value
}

function syncVisibleYearSelectors(year: number) {
  if (typeof window === 'undefined') return
  const value = String(year)
  document.querySelectorAll('select').forEach(selectNode => {
    const select = selectNode as HTMLSelectElement
    if (!looksLikeYearSelect(select)) return
    const hasTargetYear = Array.from(select.options).some(option => option.value === value)
    if (!hasTargetYear || select.value === value) return

    setNativeSelectValue(select, value)
    select.dispatchEvent(new Event('input', { bubbles: true }))
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { user, signOut } = useAuth()
  const [yearOpen, setYearOpen] = useState(false)
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [yearOptions, setYearOptions] = useState<number[]>(defaultYearOptions())
  const [newYear, setNewYear] = useState('')
  const [mobileOpen, setMobileOpen] = useState(false)
  const { counts: notificationCounts } = useNotifications(selectedYear)
  const [appIdentity, setAppIdentity] = useState({
    appName: 'FinanceBub',
    appSubtitle: 'All Project',
    appInitials: 'DK',
    appLogoData: '',
    appColor: '#1B8A7A',
  })

  // ── Navigasi history per-tab ──────────────────────────────────────────────
  const historyRef = useRef<string[]>([pathname])
  const historyIdxRef = useRef<number>(0)
  const [canBack, setCanBack] = useState(false)
  const [canForward, setCanForward] = useState(false)
  const isNavigatingRef = useRef(false)

  useEffect(() => {
    // Kalau pathname berubah bukan karena klik ← →, push ke history
    if (isNavigatingRef.current) {
      isNavigatingRef.current = false
      return
    }
    const current = historyRef.current
    const idx = historyIdxRef.current
    // Jangan push duplikat berturut-turut
    if (current[idx] === pathname) return
    // Hapus forward history saat navigasi baru
    const newHistory = [...current.slice(0, idx + 1), pathname]
    historyRef.current = newHistory
    historyIdxRef.current = newHistory.length - 1
    setCanBack(historyIdxRef.current > 0)
    setCanForward(false)
  }, [pathname])

  const goBack = () => {
    const idx = historyIdxRef.current
    if (idx <= 0) return
    isNavigatingRef.current = true
    historyIdxRef.current = idx - 1
    setCanBack(historyIdxRef.current > 0)
    setCanForward(true)
    router.push(historyRef.current[historyIdxRef.current])
  }

  const goForward = () => {
    const idx = historyIdxRef.current
    if (idx >= historyRef.current.length - 1) return
    isNavigatingRef.current = true
    historyIdxRef.current = idx + 1
    setCanBack(true)
    setCanForward(historyIdxRef.current < historyRef.current.length - 1)
    router.push(historyRef.current[historyIdxRef.current])
  }
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const dbRef = ref(db, `users/${USER_ID}/global`)
    const handler = (snap: any) => {
      const global = snap.val() || {}
      setAppIdentity({
        appName: global.appName || 'FinanceBub',
        appSubtitle: global.appSubtitle || 'All Project',
        appInitials: global.appInitials || 'DK',
        appLogoData: global.appLogoData || '',
        appColor: global.appColor || '#1B8A7A',
      })
    }
    onValue(dbRef, handler)
    return () => off(dbRef, 'value', handler)
  }, [])

  const isActive = (href: string) => {
    if (href === '/dashboard') return pathname === '/dashboard'
    return pathname.startsWith(href)
  }

  const sortedYears = useMemo(() => {
    return Array.from(new Set([...yearOptions, selectedYear]))
      .filter(year => Number.isFinite(year) && year >= 2020 && year <= 2099)
      .sort((a, b) => b - a)
  }, [selectedYear, yearOptions])

  const persistYearOptions = (years: number[]) => {
    const cleaned = Array.from(new Set(years))
      .filter(year => Number.isFinite(year) && year >= 2020 && year <= 2099)
      .sort((a, b) => b - a)
    setYearOptions(cleaned)
    try { localStorage.setItem(YEAR_OPTIONS_KEY, JSON.stringify(cleaned)) } catch {}
  }

  const applyYear = (year: number) => {
    if (!Number.isFinite(year) || year < 2020 || year > 2099) return
    const cleanYear = Math.trunc(year)
    setSelectedYear(cleanYear)
    setYearOpen(false)
    persistYearOptions([...yearOptions, cleanYear])
    try {
      localStorage.setItem(YEAR_STORAGE_KEY, String(cleanYear))
      window.dispatchEvent(new CustomEvent('financebub-year-change', { detail: cleanYear }))
    } catch {}
  }

  const addYear = () => {
    const year = Number(newYear)
    if (!Number.isFinite(year) || year < 2020 || year > 2099) return
    setNewYear('')
    applyYear(year)
  }

  const removeYear = async (year: number) => {
    if (year === selectedYear) return
    if (!confirm(`Hapus tahun ${year} secara permanen?\n\nSemua data akan ikut terhapus:\n• Quotation & Invoice ${year}\n• Mutasi Kas/Bank ${year} (12 bulan)\n• Akumulasi ${year}\n\nTindakan ini TIDAK BISA dibatalkan.`)) return
    try {
      await deleteYearData(year)
      const updated = yearOptions.filter(y => y !== year)
      persistYearOptions(updated)
    } catch {
      alert('Gagal menghapus data. Coba lagi.')
    }
  }

  useEffect(() => {
    const storedYear = readStoredYear()
    const storedOptions = readStoredYearOptions()
    setSelectedYear(storedYear)
    setYearOptions(storedOptions)
  }, [])

  // Sinkronisasi dengan halaman lain via financebub-year-change event
  useEffect(() => {
    const handle = (e: Event) => {
      const y = (e as CustomEvent<number>).detail
      if (!Number.isFinite(y) || y < 2020 || y > 2099) return
      setSelectedYear(Math.trunc(y))
    }
    window.addEventListener('financebub-year-change', handle as EventListener)
    return () => window.removeEventListener('financebub-year-change', handle as EventListener)
  }, [])

  return (
    <>
      <div className="md:hidden fixed left-0 right-0 top-0 h-14 bg-white border-b border-gray-100 z-50 flex items-center justify-between px-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-xs overflow-hidden flex-shrink-0"
            style={{ background: appIdentity.appLogoData ? 'transparent' : appIdentity.appColor }}>
            {appIdentity.appLogoData
              ? <img src={appIdentity.appLogoData} alt="logo" className="w-full h-full object-cover" />
              : appIdentity.appInitials || 'DK'}
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-900">{appIdentity.appName}</div>
            <div className="text-[10px] text-gray-400">{appIdentity.appSubtitle}</div>
          </div>
        </div>
        <button type="button" onClick={() => setMobileOpen(true)} className="w-10 h-10 rounded-xl border border-gray-100 flex items-center justify-center text-gray-700" aria-label="Buka menu">
          <Menu className="w-5 h-5" />
        </button>
      </div>

      {mobileOpen && (
        <button
          type="button"
          className="md:hidden fixed inset-0 bg-black/30 z-40"
          onClick={() => setMobileOpen(false)}
          aria-label="Tutup menu"
        />
      )}

    <aside className={cn("fixed left-0 top-0 h-screen w-[220px] bg-white border-r border-gray-100 flex flex-col z-50 transition-transform duration-200 md:translate-x-0", mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0")}>
      {/* Logo */}
      <div className="px-4 py-4 border-b border-gray-100">
        <div className="flex items-start justify-between gap-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-xs flex-shrink-0 overflow-hidden"
            style={{ background: appIdentity.appLogoData ? 'transparent' : appIdentity.appColor }}>
            {appIdentity.appLogoData
              ? <img src={appIdentity.appLogoData} alt="logo" className="w-full h-full object-cover" />
              : appIdentity.appInitials || 'DK'}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-gray-900 truncate">{appIdentity.appName}</div>
            <div className="text-[10px] text-gray-400">{appIdentity.appSubtitle}</div>
          </div>
          </div>
          <button type="button" onClick={() => setMobileOpen(false)} className="md:hidden w-8 h-8 rounded-lg border border-gray-100 flex items-center justify-center text-gray-500" aria-label="Tutup menu">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Year selector + nav history */}
        <div className="flex items-center gap-1.5 mt-3">
          {/* Tombol back */}
          <button
            type="button"
            onClick={goBack}
            disabled={!canBack}
            title="Halaman sebelumnya"
            className={cn(
              'w-6 h-6 rounded-lg flex items-center justify-center transition-colors',
              canBack
                ? 'bg-[#E1F5EE] text-[#1B8A7A] hover:bg-[#c8ece3]'
                : 'bg-gray-100 text-gray-300 cursor-not-allowed'
            )}
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>

          {/* Tombol forward */}
          <button
            type="button"
            onClick={goForward}
            disabled={!canForward}
            title="Halaman berikutnya"
            className={cn(
              'w-6 h-6 rounded-lg flex items-center justify-center transition-colors',
              canForward
                ? 'bg-[#E1F5EE] text-[#1B8A7A] hover:bg-[#c8ece3]'
                : 'bg-gray-100 text-gray-300 cursor-not-allowed'
            )}
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>

          {/* Year pill */}
          <div className="relative inline-block">
          <button
            type="button"
            onClick={() => setYearOpen(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#E1F5EE] rounded-xl text-[#1B8A7A] text-xs font-semibold hover:bg-[#c8ece3] transition-colors"
          >
            <span>{selectedYear}</span>
            <ChevronDown className={cn('w-3 h-3 transition-transform', yearOpen && 'rotate-180')} />
          </button>

          {yearOpen && (
            <div className="absolute left-0 top-full mt-2 w-44 rounded-xl border border-gray-100 bg-white shadow-xl z-50 overflow-hidden">
              <div className="px-3 py-2 text-[10px] font-semibold text-gray-400 border-b border-gray-50">
                Pilih Tahun Kerja
              </div>
              <div className="max-h-52 overflow-y-auto py-1">
                {sortedYears.map(year => (
                  <div key={year} className={cn('flex items-center group', selectedYear === year ? 'bg-[#E1F5EE]' : 'hover:bg-gray-50')}>
                    <button
                      type="button"
                      onClick={() => applyYear(year)}
                      className={cn(
                        'flex-1 flex items-center justify-between px-3 py-2 text-xs transition-colors',
                        selectedYear === year ? 'text-[#1B8A7A] font-bold' : 'text-gray-600'
                      )}
                    >
                      <span>{year}</span>
                      {selectedYear === year && <span className="text-[10px]">Aktif</span>}
                    </button>
                    {selectedYear !== year && (
                      <button
                        type="button"
                        onClick={() => removeYear(year)}
                        className="pr-2 opacity-0 group-hover:opacity-100 transition-opacity text-gray-300 hover:text-red-500"
                        title="Hapus tahun"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div className="p-2 border-t border-gray-50 flex items-center gap-1.5">
                <input
                  value={newYear}
                  onChange={event => setNewYear(event.target.value.replace(/\D/g, '').slice(0, 4))}
                  onKeyDown={event => { if (event.key === 'Enter') addYear() }}
                  placeholder="Tahun baru"
                  className="min-w-0 flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-[11px] outline-none focus:border-[#1B8A7A]"
                />
                <button
                  type="button"
                  onClick={addYear}
                  className="w-7 h-7 rounded-lg bg-[#1B8A7A] text-white flex items-center justify-center hover:opacity-90"
                  title="Tambah tahun"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {navItems.map((group) => (
          <div key={group.section} className="mb-4">
            <div className="px-2 mb-1 text-[10px] font-semibold text-gray-400 tracking-wider">
              {group.section}
            </div>
            {group.items.map((item) => {
              if (item.adminOnly && user?.role?.toLowerCase() !== 'admin') return null

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs transition-all mb-0.5',
                    isActive(item.href)
                      ? 'bg-[#E1F5EE] text-[#1B8A7A] font-semibold'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  )}
                >
                  <item.icon className="w-4 h-4 flex-shrink-0" />
                  <span className="truncate flex-1">{item.label}</span>
                  {item.href === '/notifikasi' && notificationCounts.unread > 0 && (
                    <span className="min-w-5 h-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                      {notificationCounts.unread > 99 ? '99+' : notificationCounts.unread}
                    </span>
                  )}
                </Link>
              )
            })}
          </div>
        ))}

        {/* Bottom items */}
        <div className="border-t border-gray-100 pt-3 mt-2">
          {bottomItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={cn(
                'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs transition-all mb-0.5',
                isActive(item.href)
                  ? 'bg-[#E1F5EE] text-[#1B8A7A] font-semibold'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              )}
            >
              <item.icon className="w-4 h-4 flex-shrink-0" />
              <span>{item.label}</span>
            </Link>
          ))}
        </div>
      </nav>

      {/* User */}
      <div className="px-3 py-3 border-t border-gray-100">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-7 h-7 rounded-full bg-[#1B8A7A] flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
            {user?.name?.charAt(0)?.toUpperCase() ?? 'U'}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-gray-900 truncate">{user?.name}</div>
            <div className="text-[10px] text-gray-400 uppercase">{user?.role}</div>
          </div>
        </div>
        <button
          onClick={signOut}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" />
          Keluar
        </button>
      </div>
    </aside>
    </>
  )
}
