'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { get, ref } from 'firebase/database'
import { db } from '@/lib/firebase'
import {
  CheckCircle,
  Clock,
  Loader2,
  Search,
  ShoppingCart,
  XCircle,
} from 'lucide-react'

const USER_ID = 'financebub-main'
const APPLICANT_PROFILE_KEY = 'financebub_reimburse_applicant_v1'

type FundingType = 'reimburse' | 'purchase_request'
type FundingStatus = 'pending' | 'approved' | 'transferred' | 'paid' | 'rejected'

interface PublicFundingData {
  id: string
  trackingCode: string
  type?: FundingType
  name: string
  email: string
  department?: string
  title: string
  amount: number
  date?: string
  neededDate?: string
  category: string
  description: string
  status: FundingStatus
  rejectedReason?: string
  reviewedAt?: string
  createdAt: string
  paymentMethod?: string
  paymentMethodLabel?: string
  providerName?: string
  payeeName?: string
  destinationAccount?: string
  destinationMasked?: string
  paidAt?: string
  paidAmount?: number
  paymentNote?: string
}

function requestType(item: PublicFundingData): FundingType {
  return item.type === 'purchase_request' || item.trackingCode?.startsWith('PRQ-')
    ? 'purchase_request'
    : 'reimburse'
}

function typeLabel(type: FundingType) {
  return type === 'purchase_request' ? 'Purchase Request' : 'Reimburse'
}

function itemDate(item: PublicFundingData) {
  return requestType(item) === 'purchase_request' ? item.neededDate || '' : item.date || ''
}

function fmtDate(value?: string) {
  if (!value) return '-'
  const raw = value.slice(0, 10)
  const parts = raw.split('-')
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : raw
}

function rupiah(value: number) {
  return `Rp ${Number(value || 0).toLocaleString('id-ID')}`
}

function maskDestination(value?: string) {
  const compact = String(value || '').replace(/\s+/g, '')
  if (!compact) return '-'
  if (compact.length <= 4) return `•••• ${compact}`
  return `•••• ${compact.slice(-4)}`
}

function recentMonths() {
  const now = new Date()
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1)
    return {
      year: date.getFullYear(),
      month: String(date.getMonth() + 1).padStart(2, '0'),
    }
  })
}

function recordsFromSnapshot(value: unknown, fallbackType: FundingType): PublicFundingData[] {
  if (!value || typeof value !== 'object') return []
  return Object.entries(value as Record<string, unknown>).flatMap(([id, raw]) => {
    if (!raw || typeof raw !== 'object') return []
    const record = raw as Partial<PublicFundingData>
    if (!record.trackingCode) return []
    return [{ ...record, id: record.id || id, type: record.type || fallbackType } as PublicFundingData]
  })
}

async function loadMonth(year: number, month: string) {
  const [reimburseSnapshot, purchaseSnapshot] = await Promise.all([
    get(ref(db, `users/${USER_ID}/data/public_reimburse/${year}/${month}`)),
    get(ref(db, `users/${USER_ID}/data/public_purchase_request/${year}/${month}`)),
  ])

  return [
    ...recordsFromSnapshot(reimburseSnapshot.val(), 'reimburse'),
    ...recordsFromSnapshot(purchaseSnapshot.val(), 'purchase_request'),
  ]
}

async function findByTrackingCode(code: string): Promise<PublicFundingData | null> {
  for (const { year, month } of recentMonths()) {
    const records = await loadMonth(year, month)
    const found = records.find(item => item.trackingCode === code)
    if (found) return found
  }
  return null
}

async function findByEmail(email: string): Promise<PublicFundingData[]> {
  const results: PublicFundingData[] = []
  for (const { year, month } of recentMonths()) {
    const records = await loadMonth(year, month)
    records.forEach(item => {
      if (item.email?.toLowerCase() === email.toLowerCase()) results.push(item)
    })
  }
  return results.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
}

function statusConfig(item: PublicFundingData) {
  const type = requestType(item)
  const status = item.status || 'pending'

  if (status === 'rejected') {
    return {
      icon: <XCircle className="w-10 h-10 text-red-500" />,
      label: 'Ditolak',
      bg: 'bg-red-50 border-red-100',
      color: 'text-red-700',
    }
  }

  if (status === 'transferred') {
    return {
      icon: <CheckCircle className="w-10 h-10 text-blue-500" />,
      label: 'Sudah Ditransfer',
      bg: 'bg-blue-50 border-blue-100',
      color: 'text-blue-700',
    }
  }

  if (status === 'paid') {
    return {
      icon: <CheckCircle className="w-10 h-10 text-blue-500" />,
      label: 'Sudah Dibayar',
      bg: 'bg-blue-50 border-blue-100',
      color: 'text-blue-700',
    }
  }

  if (status === 'approved') {
    return {
      icon: <CheckCircle className="w-10 h-10 text-green-500" />,
      label: type === 'purchase_request' ? 'Disetujui — Menunggu Pembayaran' : 'Disetujui',
      bg: 'bg-green-50 border-green-100',
      color: 'text-green-700',
    }
  }

  return {
    icon: <Clock className="w-10 h-10 text-amber-500" />,
    label: 'Menunggu Persetujuan',
    bg: 'bg-amber-50 border-amber-100',
    color: 'text-amber-700',
  }
}

function TypeBadge({ type }: { type: FundingType }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold ${
      type === 'purchase_request'
        ? 'bg-amber-50 text-amber-700'
        : 'bg-blue-50 text-blue-700'
    }`}>
      {type === 'purchase_request' ? <ShoppingCart className="w-3 h-3" /> : null}
      {typeLabel(type)}
    </span>
  )
}

function StatusContent() {
  const searchParams = useSearchParams()
  const [inputCode, setInputCode] = useState(searchParams.get('code') || '')
  const [searchMode, setSearchMode] = useState<'code' | 'email'>('code')
  const [data, setData] = useState<PublicFundingData | null>(null)
  const [dataList, setDataList] = useState<PublicFundingData[]>([])
  const [loading, setLoading] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState('')

  const handleSearch = async () => {
    const query = inputCode.trim()
    if (!query) return

    setLoading(true)
    setNotFound(false)
    setError('')
    setData(null)
    setDataList([])

    try {
      if (searchMode === 'email' || query.includes('@')) {
        const results = await findByEmail(query)
        if (results.length > 0) setDataList(results)
        else setNotFound(true)
      } else {
        const result = await findByTrackingCode(query.toUpperCase())
        if (result) setData(result)
        else setNotFound(true)
      }
    } catch (searchError) {
      console.error(searchError)
      setError('Status tidak dapat dimuat. Silakan coba lagi beberapa saat.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const code = searchParams.get('code')
    if (!code) return

    setInputCode(code)
    setSearchMode('code')
    setLoading(true)
    setNotFound(false)
    setError('')
    setDataList([])

    findByTrackingCode(code.toUpperCase())
      .then(result => {
        if (result) setData(result)
        else setNotFound(true)
      })
      .catch(() => setError('Status tidak dapat dimuat. Silakan coba lagi beberapa saat.'))
      .finally(() => setLoading(false))
  }, [searchParams])

  const openNewFunding = (preferredType?: FundingType) => {
    const applicant = dataList[0] || data
    if (applicant) {
      try {
        window.localStorage.setItem(APPLICANT_PROFILE_KEY, JSON.stringify({
          name: applicant.name || '',
          email: applicant.email || '',
          department: applicant.department || '',
        }))
      } catch {
        // Tetap buka form bila browser menolak localStorage.
      }
    }

    const type = preferredType || (applicant ? requestType(applicant) : 'reimburse')
    window.location.href = `/pengajuan?type=${type}`
  }

  const renderPurchaseDestination = (item: PublicFundingData) => {
    if (requestType(item) !== 'purchase_request') return null
    return (
      <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
        <div className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Tujuan Pembayaran</div>
        <div className="text-sm font-semibold text-gray-800">{item.providerName || item.paymentMethodLabel || 'Tujuan pembayaran'}</div>
        <div className="text-xs text-gray-500 mt-0.5">{item.paymentMethodLabel || 'Tujuan pembayaran'} · {item.destinationMasked || maskDestination(item.destinationAccount)}</div>
        <div className="text-[10px] text-gray-400 mt-1">Nomor lengkap hanya dapat dilihat admin.</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen py-8 px-4">
      <div className="max-w-md mx-auto">
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-[#1B8A7A] rounded-xl flex items-center justify-center text-white font-bold text-lg mx-auto mb-3">🔍</div>
          <h1 className="text-xl font-bold text-gray-900">Cek Status Pengajuan Dana</h1>
          <p className="text-sm text-gray-500 mt-1">Cek Reimburse atau Purchase Request menggunakan kode tracking maupun email.</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
          <div className="flex gap-2 mb-3">
            <button
              type="button"
              onClick={() => setSearchMode('code')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${searchMode === 'code' ? 'bg-[#1B8A7A] text-white' : 'bg-gray-100 text-gray-500'}`}
            >
              Kode Tracking
            </button>
            <button
              type="button"
              onClick={() => setSearchMode('email')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${searchMode === 'email' ? 'bg-[#1B8A7A] text-white' : 'bg-gray-100 text-gray-500'}`}
            >
              Email
            </button>
          </div>
          <div className="flex gap-2">
            <input
              value={inputCode}
              onChange={event => setInputCode(event.target.value)}
              onKeyDown={event => event.key === 'Enter' && handleSearch()}
              placeholder={searchMode === 'email' ? 'email@kamu.com' : 'RMB-... atau PRQ-...'}
              className="flex-1 min-w-0 px-3 py-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A] font-mono"
            />
            <button
              type="button"
              onClick={handleSearch}
              disabled={loading}
              className="px-4 py-2.5 bg-[#1B8A7A] hover:bg-[#0F6E56] text-white rounded-lg disabled:opacity-60"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {notFound && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-center">
            <div className="text-3xl mb-2">🔍</div>
            <div className="text-sm font-semibold text-gray-700 mb-1">Tidak ditemukan</div>
            <div className="text-xs text-gray-400">Pastikan {searchMode === 'email' ? 'email' : 'kode tracking'} sudah benar.</div>
          </div>
        )}

        {data && (() => {
          const config = statusConfig(data)
          const type = requestType(data)
          return (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className={`p-5 border-b ${config.bg} flex items-center gap-3`}>
                {config.icon}
                <div className="min-w-0">
                  <div className={`text-sm font-bold ${config.color}`}>{config.label}</div>
                  <div className="text-xs text-gray-500 font-mono truncate">{data.trackingCode}</div>
                </div>
              </div>
              <div className="p-5 space-y-3">
                <TypeBadge type={type} />
                <div>
                  <div className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Pengaju</div>
                  <div className="text-sm text-gray-800 font-medium">{data.name}</div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold text-gray-400 uppercase mb-1">Detail</div>
                  <div className="text-sm text-gray-800 font-semibold">{data.title}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {data.category} · {type === 'purchase_request' ? 'Batas bayar' : 'Tanggal'}: {fmtDate(itemDate(data))}
                  </div>
                </div>
                <div className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                  <span className="text-xs text-gray-500">Nominal</span>
                  <span className="text-sm font-bold text-[#1B8A7A]">{rupiah(data.amount)}</span>
                </div>
                {renderPurchaseDestination(data)}
                {data.status === 'paid' && (
                  <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-700">
                    Pembayaran diselesaikan {data.paidAt ? `pada ${fmtDate(data.paidAt)}` : ''}
                    {data.paidAmount ? ` sebesar ${rupiah(data.paidAmount)}` : ''}.
                  </div>
                )}
                {data.status === 'rejected' && data.rejectedReason && (
                  <div className="bg-red-50 border border-red-100 rounded-lg p-3">
                    <div className="text-[10px] font-semibold text-red-400 uppercase mb-1">Alasan Penolakan</div>
                    <p className="text-sm text-red-700">{data.rejectedReason}</p>
                  </div>
                )}
                <div className="text-[10px] text-gray-400 pt-1 border-t border-gray-50">Diajukan: {fmtDate(data.createdAt)}</div>
              </div>
            </div>
          )
        })()}

        {dataList.length > 0 && (
          <div className="space-y-3">
            <div className="text-xs text-gray-500 font-medium">{dataList.length} pengajuan ditemukan</div>
            {dataList.map(item => {
              const config = statusConfig(item)
              const type = requestType(item)
              return (
                <div key={`${type}-${item.id}`} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <div className={`p-4 border-b ${config.bg} flex items-center gap-3`}>
                    {config.icon}
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-bold ${config.color} truncate`}>{item.title}</div>
                      <div className="text-xs text-gray-500 font-mono">{item.trackingCode}</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-sm font-bold text-[#1B8A7A]">{rupiah(item.amount)}</div>
                      <div className={`text-[10px] font-bold mt-0.5 ${config.color}`}>{config.label}</div>
                    </div>
                  </div>
                  <div className="px-4 py-3 space-y-2">
                    <TypeBadge type={type} />
                    <div className="text-xs text-gray-500">{item.category} · {fmtDate(itemDate(item))}</div>
                    {type === 'purchase_request' && (
                      <div className="text-xs text-gray-400">{item.providerName || 'Tujuan pembayaran'} · {item.destinationMasked || maskDestination(item.destinationAccount)}</div>
                    )}
                    {item.status === 'rejected' && item.rejectedReason && (
                      <div className="text-xs text-red-500">Alasan: {item.rejectedReason}</div>
                    )}
                    <div className="text-[10px] text-gray-400">Diajukan: {fmtDate(item.createdAt)}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div className="mt-6 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => openNewFunding('reimburse')}
            className="rounded-lg border border-[#1B8A7A] px-3 py-2 text-xs font-semibold text-[#1B8A7A] hover:bg-[#E1F5EE]"
          >
            + Reimburse Baru
          </button>
          <button
            type="button"
            onClick={() => openNewFunding('purchase_request')}
            className="rounded-lg border border-amber-500 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-50"
          >
            + Purchase Request
          </button>
        </div>
      </div>
    </div>
  )
}

export default function PublicFundingStatusPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[#1B8A7A]" />
      </div>
    }>
      <StatusContent />
    </Suspense>
  )
}
