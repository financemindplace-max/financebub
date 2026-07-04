'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import { fmt, fmtDate } from '@/lib/utils'
import { ref, onValue, off } from 'firebase/database'
import { db } from '@/lib/firebase'
import type { Doc, DocStatus } from '@/types/document'
import { FileText, Receipt, TrendingUp, AlertCircle, ChevronRight, Building2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useActiveYear } from '@/lib/use-active-year'

const USER_ID = 'financebub-main'

// ── helpers ───────────────────────────────────────────────────────────────────

function gTot(doc: Doc): number {
  const sub = doc.items?.reduce((a, i) => a + (+i.amount || 0), 0) || 0
  return sub - +(doc.fields?.['q-disc'] || 0) + +(doc.fields?.['q-gross'] || 0)
}

function subscribeData(
  year: number,
  type: 'q' | 'i' | 'a',
  cb: (docs: any[]) => void
) {
  const path = `users/${USER_ID}/data/yr_${year}_${type}`
  const dbRef = ref(db, path)
  const handler = (snap: any) => {
    if (!snap.exists()) { cb([]); return }
    try {
      const val = snap.val()
      const arr = typeof val === 'string' ? JSON.parse(val) : val
      cb(Array.isArray(arr) ? arr.filter(Boolean) : [])
    } catch { cb([]) }
  }
  onValue(dbRef, handler)
  return () => off(dbRef, 'value', handler)
}

const STATUS_COLOR: Record<string, string> = {
  'Draft':       '#9CA3AF',
  'Terbit':      '#185FA5',
  'Belum Lunas': '#D97706',
  'Lunas':       '#3B6D11',
  'Overdue':     '#DC2626',
}
const STATUS_BG: Record<string, string> = {
  'Draft':       'bg-gray-100 text-gray-500',
  'Terbit':      'bg-blue-100 text-blue-700',
  'Belum Lunas': 'bg-amber-100 text-amber-700',
  'Lunas':       'bg-green-100 text-green-700',
  'Overdue':     'bg-red-100 text-red-600',
}

// ── stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color, icon: Icon }: {
  label: string; value: string; sub: string; color: string; icon: React.ElementType
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 min-w-0">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-400 font-medium">{label}</span>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: color + '18' }}>
          <Icon size={14} style={{ color }} />
        </div>
      </div>
      <div className="text-lg font-bold text-gray-900 break-words leading-tight">{value}</div>
      <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>
    </div>
  )
}

// ── main ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user } = useAuth()
  const router = useRouter()
  const [quotations, setQuotations] = useState<Doc[]>([])
  const [invoices, setInvoices] = useState<Doc[]>([])
  const [akumulasi, setAkumulasi] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const { year } = useActiveYear()

  const today = new Date().toLocaleDateString('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  })

  useEffect(() => {
    let qDone = false, iDone = false, aDone = false
    const check = () => { if (qDone && iDone && aDone) setLoading(false) }
    setLoading(true)

    // Scan 8 tahun terbit, filter by project-year
    const SCAN_YEARS = Array.from(
      { length: new Date().getFullYear() + 3 - 2020 + 1 },
      (_, index) => 2020 + index,
    ).sort((a, b) => b - a)
    const qByYear: Record<number, Doc[]> = {}
    const iByYear: Record<number, Doc[]> = {}
    let qCount = 0, iCount = 0
    const unsubs: (() => void)[] = []

    SCAN_YEARS.forEach(y => {
      unsubs.push(subscribeData(y, 'q', d => {
        qByYear[y] = d
        if (++qCount >= SCAN_YEARS.length) {
          setQuotations(
            Object.entries(qByYear).flatMap(([fy, docs]) =>
              docs.filter((x: Doc) => x?.fields?.['q-no']).filter((x: Doc) =>
                (x.fields as any)?.['project-year']
                  ? (x.fields as any)['project-year'] === String(year)
                  : Number(fy) === year
              )
            )
          )
          qDone = true; check()
        }
      }))
      unsubs.push(subscribeData(y, 'i', d => {
        iByYear[y] = d
        if (++iCount >= SCAN_YEARS.length) {
          setInvoices(
            Object.entries(iByYear).flatMap(([fy, docs]) =>
              docs.filter((x: Doc) => x?.fields?.['i-no']).filter((x: Doc) =>
                (x.fields as any)?.['project-year']
                  ? (x.fields as any)['project-year'] === String(year)
                  : Number(fy) === year
              )
            )
          )
          iDone = true; check()
        }
      }))
    })

    const unsubA = subscribeData(year, 'a', d => { setAkumulasi(d); aDone = true; check() })
    unsubs.push(unsubA)

    return () => { unsubs.forEach(fn => fn()) }
  }, [year])

  // ── computed ────────────────────────────────────────────────────────────────

  const tq = quotations.reduce((a, d) => a + gTot(d), 0)
  const ti = invoices.reduce((a, d) => a + gTot(d), 0)
  const ln = invoices.filter(d => d.fields?.['i-status'] === 'Lunas').reduce((a, d) => a + gTot(d), 0)
  const urgCount = invoices.filter(d => {
    const s = d.fields?.['i-status']
    return s === 'Overdue' || (s === 'Belum Lunas' && d.fields?.['i-due'] && new Date(d.fields['i-due']) < new Date())
  }).length

  // Status breakdown
  const statusCount: Record<string, number> = { Draft: 0, Terbit: 0, 'Belum Lunas': 0, Lunas: 0, Overdue: 0 }
  invoices.forEach(d => {
    const s = (d.fields?.['i-status'] || 'Draft') as string
    if (statusCount[s] !== undefined) statusCount[s]++
  })
  const maxStatus = Math.max(...Object.values(statusCount), 1)

  // Brand summary from akumulasi
  const brandMap: Record<string, { kontrak: number; bayar: number }> = {}
  // Build kontrak dari Q+I
  ;[...quotations, ...invoices].forEach(doc => {
    doc.items?.forEach(item => {
      const b = item.brand?.trim()
      if (!b) return
      if (!brandMap[b]) brandMap[b] = { kontrak: 0, bayar: 0 }
    })
  })
  invoices.forEach(doc => {
    doc.items?.forEach(item => {
      const b = item.brand?.trim()
      if (!b) return
      if (!brandMap[b]) brandMap[b] = { kontrak: 0, bayar: 0 }
      brandMap[b].kontrak += gTot(doc) / Math.max(doc.items.length, 1)
    })
  })
  akumulasi.forEach((a: any) => {
    const b = a.brand?.trim()
    if (!b) return
    if (!brandMap[b]) brandMap[b] = { kontrak: 0, bayar: 0 }
    const nom = parseFloat(String(a.nom || '0').replace(/[^0-9.-]/g, '')) || 0
    brandMap[b].bayar += nom
  })

  const brands = Object.entries(brandMap)
    .map(([name, d]) => ({ name, ...d, sisa: d.kontrak - d.bayar }))
    .filter(b => b.kontrak > 0 || b.bayar > 0)
    .sort((a, b) => Math.abs(b.sisa) - Math.abs(a.sisa))
    .slice(0, 5)

  const recentQ = [...quotations].sort((a, b) => b.savedAt?.localeCompare(a.savedAt || '') || 0).slice(0, 4)
  const recentI = [...invoices].sort((a, b) => b.savedAt?.localeCompare(a.savedAt || '') || 0).slice(0, 5)

  // ── render ──────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            Dashboard <span className="text-gray-400 font-normal text-base">{year}</span>
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">{today}</p>
        </div>
        <div className="flex items-center gap-2 bg-[#E1F5EE] border border-[#1B8A7A]/20 rounded-full px-3 py-1.5">
          <div className="w-5 h-5 rounded-full bg-[#1B8A7A] flex items-center justify-center text-white text-[9px] font-bold">
            {user?.name?.charAt(0)?.toUpperCase()}
          </div>
          <span className="text-xs text-[#0F6E56] font-medium">{user?.name}</span>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
        {loading ? [...Array(4)].map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
            <div className="h-3 w-20 bg-gray-100 rounded mb-3" />
            <div className="h-6 bg-gray-100 rounded mb-2" />
            <div className="h-3 w-16 bg-gray-100 rounded" />
          </div>
        )) : <>
          <StatCard label="Quotation" value={`Rp ${fmt(tq)}`} sub={`${quotations.length} dokumen`} color="#1B8A7A" icon={FileText} />
          <StatCard label="Invoice" value={`Rp ${fmt(ti)}`} sub={`${invoices.length} dokumen`} color="#185FA5" icon={Receipt} />
          <StatCard label="Terbayar" value={`Rp ${fmt(ln)}`} sub={`${invoices.filter(d => d.fields?.['i-status'] === 'Lunas').length} invoice lunas`} color="#3B6D11" icon={TrendingUp} />
          <StatCard label="Perlu Perhatian" value={`${urgCount} item`} sub="jatuh tempo / overdue" color="#DC2626" icon={AlertCircle} />
        </>}
      </div>

      {/* Status Brand shortcut */}
      <div
        onClick={() => router.push('/brand')}
        className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3 mb-5 flex items-center justify-between cursor-pointer hover:shadow-md transition-shadow"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#1B8A7A] flex items-center justify-center">
            <Building2 size={15} className="text-white" />
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-900">Status Pembayaran Brand</div>
            <div className="text-xs text-gray-400">Lihat ringkasan per brand — {year}</div>
          </div>
        </div>
        <ChevronRight size={16} className="text-gray-400" />
      </div>

      {/* 2-col widgets */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mb-5">
        {/* Status Invoice */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Status Invoice</div>
          {loading ? <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-5 bg-gray-50 rounded animate-pulse" />)}</div>
          : Object.entries(statusCount).map(([s, n]) => (
            <div key={s} className="flex items-center gap-2 mb-2">
              <span className="text-[11px] text-gray-500 w-20 flex-shrink-0">{s}</span>
              <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.round(n / maxStatus * 100)}%`, backgroundColor: STATUS_COLOR[s] }} />
              </div>
              <span className="text-[11px] font-medium text-gray-700 w-4 text-right">{n}</span>
            </div>
          ))}
        </div>

        {/* Quotation Terbaru */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Quotation Terbaru</div>
            <button onClick={() => router.push('/quotation')} className="text-[11px] text-[#1B8A7A] hover:underline flex items-center gap-0.5">
              Lihat semua <ChevronRight size={11} />
            </button>
          </div>
          {loading ? <div className="p-4 space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-9 bg-gray-50 rounded animate-pulse" />)}</div>
          : !recentQ.length ? <div className="p-8 text-center text-xs text-gray-400">Belum ada</div>
          : <div className="divide-y divide-gray-50">
            {recentQ.map(d => (
              <div key={d.id} onClick={() => router.push('/quotation')}
                className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-gray-50 cursor-pointer">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0"
                  style={{ background: d.theme || '#1B8A7A' }}>QT</div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-gray-900 truncate">{d.fields['q-no']}</div>
                  <div className="text-[10px] text-gray-400 truncate">{d.fields['cl-name']}</div>
                </div>
                <span className="text-xs font-semibold flex-shrink-0" style={{ color: d.theme || '#1B8A7A' }}>
                  {fmt(gTot(d))}
                </span>
              </div>
            ))}
          </div>}
        </div>
      </div>

      {/* Invoice Terbaru */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Invoice Terbaru</div>
          <button onClick={() => router.push('/invoice')} className="text-[11px] text-[#185FA5] hover:underline flex items-center gap-0.5">
            Lihat semua <ChevronRight size={11} />
          </button>
        </div>
        {loading ? <div className="p-4 space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-9 bg-gray-50 rounded animate-pulse" />)}</div>
        : !recentI.length ? <div className="p-8 text-center text-xs text-gray-400">Belum ada</div>
        : <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-xs">
          <thead>
            <tr className="border-b border-gray-50">
              {['No. Invoice','Klien','Status','Total'].map((h, i) => (
                <th key={h} className={`px-4 py-2.5 text-[10px] font-semibold text-gray-400 ${i === 3 ? 'text-right' : 'text-left'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {recentI.map(d => {
              const status = (d.fields?.['i-status'] || 'Draft') as string
              return (
                <tr key={d.id} onClick={() => router.push('/invoice')}
                  className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer">
                  <td className="px-4 py-2.5 font-semibold text-gray-900">{d.fields['i-no']}</td>
                  <td className="px-4 py-2.5 text-gray-600 max-w-[180px] truncate">{d.fields['cl-name']}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_BG[status] || 'bg-gray-100 text-gray-500'}`}>
                      {status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold" style={{ color: d.theme || '#185FA5' }}>
                    {fmt(gTot(d))}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table></div>}
      </div>
    </div>
  )
}
