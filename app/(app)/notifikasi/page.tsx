'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowUpDown,
  Bell,
  Check,
  CheckCheck,
  CheckCircle2,
  Clock,
  ClipboardList,
  Search,
} from 'lucide-react'
import { fmt, fmtDate } from '@/lib/utils'
import { useActiveYear } from '@/lib/use-active-year'
import { useNotifications, type AppNotification, type NotificationKind } from '@/lib/use-notifications'

type NotificationFilter = 'all' | NotificationKind
type ReadFilter = 'all' | 'unread'
type SortOrder = 'newest' | 'oldest'

function notificationTimestamp(item: AppNotification) {
  const value = item.kind === 'submission'
    ? item.createdAt || item.date
    : item.date || item.createdAt
  const timestamp = value ? Date.parse(value) : Number.NaN
  return Number.isNaN(timestamp) ? 0 : timestamp
}

function notificationStyle(kind: NotificationKind) {
  if (kind === 'invoice_overdue') return 'bg-red-50 border-red-100 text-red-700'
  if (kind === 'invoice_due_today') return 'bg-amber-50 border-amber-100 text-amber-700'
  return 'bg-blue-50 border-blue-100 text-blue-700'
}

function notificationIcon(kind: NotificationKind) {
  if (kind === 'invoice_overdue') return <AlertTriangle className="w-4 h-4" />
  if (kind === 'invoice_due_today') return <Clock className="w-4 h-4" />
  return <ClipboardList className="w-4 h-4" />
}

function actionLabel(item: AppNotification) {
  return item.source === 'invoice' ? 'Buka invoice' : 'Buka pengajuan'
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '')
  if (message.toLowerCase().includes('permission_denied')) {
    return 'Status baca gagal disimpan karena izin Firebase belum tersedia.'
  }
  return 'Status baca gagal disimpan. Silakan coba lagi.'
}

export default function NotifikasiPage() {
  const router = useRouter()
  const { year, years, setYear } = useActiveYear()
  const {
    notifications,
    counts,
    loading,
    markAsRead,
    markAllAsRead,
  } = useNotifications(year)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<NotificationFilter>('all')
  const [readFilter, setReadFilter] = useState<ReadFilter>('all')
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest')
  const [savingAll, setSavingAll] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return notifications
      .filter(item => {
        const matchesFilter = filter === 'all' || item.kind === filter
        const matchesRead = readFilter === 'all' || !item.isRead
        const matchesSearch = !query || [
          item.title,
          item.description,
          item.reference,
          item.person,
        ].some(value => value.toLowerCase().includes(query))
        return matchesFilter && matchesRead && matchesSearch
      })
      .sort((a, b) => {
        const difference = notificationTimestamp(a) - notificationTimestamp(b)
        if (difference !== 0) return sortOrder === 'oldest' ? difference : -difference
        return a.reference.localeCompare(b.reference, 'id')
      })
  }, [filter, notifications, readFilter, search, sortOrder])

  const cards: Array<{
    filter: NotificationFilter
    label: string
    value: number
    valueClass: string
    activeClass: string
  }> = [
    {
      filter: 'all',
      label: 'Semua Aktif',
      value: counts.total,
      valueClass: 'text-gray-900',
      activeClass: 'border-[#1B8A7A] ring-2 ring-[#1B8A7A]/10',
    },
    {
      filter: 'submission',
      label: 'Pengajuan',
      value: counts.submissions,
      valueClass: 'text-blue-600',
      activeClass: 'border-blue-300 ring-2 ring-blue-100',
    },
    {
      filter: 'invoice_overdue',
      label: 'Invoice Overdue',
      value: counts.overdue,
      valueClass: 'text-red-600',
      activeClass: 'border-red-300 ring-2 ring-red-100',
    },
    {
      filter: 'invoice_due_today',
      label: 'Jatuh Tempo Hari Ini',
      value: counts.dueToday,
      valueClass: 'text-amber-600',
      activeClass: 'border-amber-300 ring-2 ring-amber-100',
    },
  ]

  const handleMarkRead = async (item: AppNotification) => {
    if (item.isRead || savingId === item.id) return

    setSavingId(item.id)
    setMessage(null)
    try {
      await markAsRead(item.id)
      setMessage({ type: 'success', text: 'Notifikasi ditandai sudah dibaca.' })
    } catch (error) {
      setMessage({ type: 'error', text: errorMessage(error) })
    } finally {
      setSavingId(null)
    }
  }

  const handleOpen = async (item: AppNotification) => {
    if (!item.isRead) {
      setSavingId(item.id)
      try {
        await markAsRead(item.id)
      } catch (error) {
        setMessage({ type: 'error', text: errorMessage(error) })
      } finally {
        setSavingId(null)
      }
    }
    router.push(item.href)
  }

  const handleMarkAll = async () => {
    if (savingAll || counts.unread === 0) return

    setSavingAll(true)
    setMessage(null)
    try {
      const markedCount = await markAllAsRead()
      setMessage({
        type: 'success',
        text: `${markedCount} notifikasi ditandai sudah dibaca.`,
      })
    } catch (error) {
      setMessage({ type: 'error', text: errorMessage(error) })
    } finally {
      setSavingAll(false)
    }
  }

  return (
    <div className="p-4 md:p-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Notifikasi</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Pengajuan yang menunggu persetujuan dan invoice yang sudah jatuh tempo.
          </p>
        </div>
        <select
          value={year}
          onChange={event => setYear(Number(event.target.value))}
          className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm outline-none focus:border-[#1B8A7A]"
        >
          {years.map(optionYear => (
            <option key={optionYear} value={optionYear}>{optionYear}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-5">
        {cards.map(card => (
          <button
            key={card.filter}
            type="button"
            onClick={() => setFilter(card.filter)}
            className={`text-left bg-white rounded-xl border p-4 transition-all ${
              filter === card.filter ? card.activeClass : 'border-gray-100 hover:border-gray-200'
            }`}
          >
            <div className="text-[10px] text-gray-400 uppercase font-bold">{card.label}</div>
            <div className={`text-2xl font-bold mt-1 ${card.valueClass}`}>{card.value}</div>
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex flex-col gap-3">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Bell className="w-4 h-4 text-[#1B8A7A]" />
              <h2 className="text-sm font-semibold text-gray-900">Daftar Notifikasi</h2>
              {counts.unread > 0 && (
                <span className="min-w-5 h-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                  {counts.unread > 99 ? '99+' : counts.unread}
                </span>
              )}
              <span className="text-[11px] text-gray-400">
                {counts.unread} belum dibaca · {counts.read} sudah dibaca
              </span>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 w-full lg:w-auto">
              <button
                type="button"
                onClick={handleMarkAll}
                disabled={savingAll || counts.unread === 0}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <CheckCheck className="w-4 h-4" />
                {savingAll ? 'Menyimpan...' : 'Tandai semua sudah dibaca'}
              </button>
              <div className="relative min-w-36">
                <ArrowUpDown className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300 pointer-events-none" />
                <select
                  value={sortOrder}
                  onChange={event => setSortOrder(event.target.value as SortOrder)}
                  aria-label="Urutkan notifikasi"
                  className="w-full appearance-none pl-9 pr-8 py-2 border border-gray-200 rounded-lg bg-white text-sm text-gray-600 outline-none focus:border-[#1B8A7A] cursor-pointer"
                >
                  <option value="newest">Terbaru</option>
                  <option value="oldest">Terlama</option>
                </select>
              </div>
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
                <input
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder="Cari pengaju, klien, atau nomor..."
                  className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-[#1B8A7A]"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setReadFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                readFilter === 'all'
                  ? 'bg-[#E1F5EE] border-[#1B8A7A]/20 text-[#1B8A7A]'
                  : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}
            >
              Semua
            </button>
            <button
              type="button"
              onClick={() => setReadFilter('unread')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                readFilter === 'unread'
                  ? 'bg-[#E1F5EE] border-[#1B8A7A]/20 text-[#1B8A7A]'
                  : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}
            >
              Belum Dibaca ({counts.unread})
            </button>
          </div>

          {message && (
            <div className={`text-xs rounded-lg px-3 py-2 ${
              message.type === 'success'
                ? 'bg-green-50 text-green-700 border border-green-100'
                : 'bg-red-50 text-red-700 border border-red-100'
            }`}>
              {message.text}
            </div>
          )}
        </div>

        {loading ? (
          <div className="py-16 text-center text-sm text-gray-400">Memuat notifikasi...</div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-green-500 opacity-70" />
            <p className="text-sm font-medium text-gray-500">
              {readFilter === 'unread' ? 'Semua notifikasi sudah dibaca.' : 'Tidak ada notifikasi untuk filter ini.'}
            </p>
            <p className="text-xs mt-1">
              {readFilter === 'unread'
                ? 'Badge notifikasi akan muncul lagi saat ada pengajuan atau invoice baru yang perlu diperiksa.'
                : `Tidak ada pengajuan pending atau invoice jatuh tempo pada tahun ${year}.`}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {filtered.map(item => (
              <div
                key={item.id}
                className={`px-4 py-3 flex flex-col sm:flex-row sm:items-start gap-3 transition-colors ${
                  item.isRead ? 'bg-white hover:bg-gray-50/60' : 'bg-[#F7FCFA] hover:bg-[#F0F9F6]'
                }`}
              >
                <div className="relative">
                  <div className={`w-fit mt-0.5 rounded-lg border p-2 ${notificationStyle(item.kind)} ${
                    item.isRead ? 'opacity-60' : ''
                  }`}>
                    {notificationIcon(item.kind)}
                  </div>
                  {!item.isRead && (
                    <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-white" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className={`text-sm text-gray-900 ${item.isRead ? 'font-medium' : 'font-semibold'}`}>
                      {item.title}
                    </h3>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-semibold">
                      {item.reference}
                    </span>
                    {item.source === 'public' && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-50 text-violet-600 font-semibold">
                        Publik
                      </span>
                    )}
                    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                      item.isRead
                        ? 'bg-gray-100 text-gray-400'
                        : 'bg-red-50 text-red-600'
                    }`}>
                      {item.isRead ? <Check className="w-3 h-3" /> : null}
                      {item.isRead ? 'Sudah dibaca' : 'Belum dibaca'}
                    </span>
                  </div>
                  <p className={`text-xs mt-1 ${item.isRead ? 'text-gray-400' : 'text-gray-500'}`}>
                    {item.description}
                  </p>
                  <div className="text-[11px] text-gray-400 mt-1">
                    {item.person}{item.date ? ` · Tanggal: ${fmtDate(item.date)}` : ''}
                  </div>
                </div>

                <div className="sm:text-right flex sm:block items-center justify-between gap-3">
                  <div className={`text-sm font-bold whitespace-nowrap ${item.isRead ? 'text-gray-500' : 'text-gray-900'}`}>
                    Rp {fmt(item.amount)}
                  </div>
                  <div className="mt-0 sm:mt-2 flex sm:justify-end items-center gap-3">
                    {!item.isRead && (
                      <button
                        type="button"
                        onClick={() => handleMarkRead(item)}
                        disabled={savingId === item.id}
                        className="text-[11px] font-semibold text-gray-500 hover:text-gray-800 disabled:opacity-50"
                      >
                        {savingId === item.id ? 'Menyimpan...' : 'Tandai dibaca'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleOpen(item)}
                      disabled={savingId === item.id}
                      className="text-[11px] font-semibold text-[#1B8A7A] hover:underline disabled:opacity-50"
                    >
                      {actionLabel(item)} →
                    </button>
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
