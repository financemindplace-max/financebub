'use client'
import { useYearList, getActiveYear } from '@/lib/use-active-year'

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Download, Scale } from 'lucide-react'
import {
  MONTHS,
  calcAccountSummaries,
  fetchAccounts,
  fetchMonth,
  isAccountActive,
  rupiah,
  type FinanceAccount,
  type FinanceMonthData,
} from '@/lib/finance'


function printPage() {
  window.print()
}

export default function NeracaPage() {
  const YEARS = useYearList()
  const now = new Date()
  const [year, setYearRaw] = useState(() => getActiveYear())
  const [month, setMonth] = useState(now.getMonth() + 1)

  const setYear = (y: number) => {
    setYearRaw(y)
    try {
      sessionStorage.setItem('financebub_active_year', String(y))
      window.dispatchEvent(new CustomEvent('financebub-year-change', { detail: y }))
    } catch {}
  }

  useEffect(() => {
    const handle = (e: Event) => {
      const y = (e as CustomEvent<number>).detail
      if (Number.isFinite(y) && y >= 2020 && y <= 2099) setYearRaw(y)
    }
    window.addEventListener('financebub-year-change', handle as EventListener)
    return () => window.removeEventListener('financebub-year-change', handle as EventListener)
  }, [])
  const [accounts, setAccounts] = useState<FinanceAccount[]>([])
  const [monthData, setMonthData] = useState<FinanceMonthData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    setLoading(true)
    Promise.all([fetchAccounts(), fetchMonth(year, month)]).then(([accs, data]) => {
      if (!mounted) return
      setAccounts(accs)
      setMonthData(data)
      setLoading(false)
    })
    return () => { mounted = false }
  }, [year, month])

  const activeAccounts = useMemo(() => accounts.filter(account => isAccountActive(account, year, month)), [accounts, year, month])
  const summaries = useMemo(() => monthData ? calcAccountSummaries(activeAccounts, monthData) : [], [activeAccounts, monthData])
  const totalAssets = summaries.reduce((sum, item) => sum + item.balance, 0)
  const totalOpeningEquity = summaries.reduce((sum, item) => sum + item.opening, 0)
  const totalIncome = summaries.reduce((sum, item) => sum + item.income, 0)
  const totalExpense = summaries.reduce((sum, item) => sum + item.expense, 0)
  const profit = totalIncome - totalExpense
  const totalEquity = totalOpeningEquity + profit
  const difference = totalAssets - totalEquity
  const currentMonth = MONTHS.find(item => item.no === month)?.name || ''

  return (
    <div className="p-6 print:p-0">
      <style jsx global>{`
        @media print {
          aside, button, select, .no-print { display: none !important; }
          main { margin-left: 0 !important; }
          body { background: white !important; }
          .print-card { box-shadow: none !important; border-color: #d1d5db !important; }
          @page { size: A4 portrait; margin: 12mm; }
        }
      `}</style>

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Neraca</h1>
          <p className="text-sm text-gray-400 mt-0.5">Posisi aset dan ekuitas berdasarkan Mutasi Kas/Bank — {currentMonth} {year}</p>
        </div>
        <div className="flex items-center gap-2 no-print">
          <div className="relative">
            <select value={year} onChange={e => setYear(Number(e.target.value))}
              className="appearance-none pl-3 pr-8 py-2 text-sm border border-gray-200 rounded-lg bg-white outline-none focus:border-[#1B8A7A]">
              {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          </div>
          <div className="relative">
            <select value={month} onChange={e => setMonth(Number(e.target.value))}
              className="appearance-none pl-3 pr-8 py-2 text-sm border border-gray-200 rounded-lg bg-white outline-none focus:border-[#1B8A7A]">
              {MONTHS.map(item => <option key={item.no} value={item.no}>{item.name}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          </div>
          <button onClick={printPage} className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50">
            <Download className="w-4 h-4" /> Download PDF
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-5">
        <div className="bg-white rounded-xl border border-gray-100 p-4 print-card"><div className="text-xs text-gray-400">Total Aset Lancar</div><div className="text-lg font-bold text-[#1B8A7A] mt-1">Rp {rupiah(totalAssets, 2)}</div></div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 print-card"><div className="text-xs text-gray-400">Laba Berjalan</div><div className={`text-lg font-bold mt-1 ${profit >= 0 ? 'text-gray-900' : 'text-red-600'}`}>Rp {rupiah(profit, 2)}</div></div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 print-card"><div className="text-xs text-gray-400">Selisih Neraca</div><div className={`text-lg font-bold mt-1 ${Math.abs(difference) < 1 ? 'text-green-700' : 'text-red-600'}`}>Rp {rupiah(difference, 2)}</div></div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden print-card">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <Scale className="w-4 h-4 text-[#1B8A7A]" />
          <h2 className="text-sm font-semibold text-gray-900">Laporan Posisi Keuangan</h2>
        </div>
        <div className="grid grid-cols-2 gap-8 p-5">
          <section>
            <div className="text-xs font-bold text-[#1B8A7A] uppercase tracking-wider mb-2">Aset</div>
            <table className="w-full text-xs">
              <tbody>
                {summaries.map(item => (
                  <tr key={item.account.id} className="border-b border-gray-50">
                    <td className="py-2 text-gray-700">{item.account.name}</td>
                    <td className="py-2 text-right font-semibold text-gray-900">Rp {rupiah(item.balance, 2)}</td>
                  </tr>
                ))}
                {summaries.length === 0 && <tr><td className="py-4 text-gray-400">Belum ada akun.</td><td /></tr>}
                <tr className="border-t border-gray-200">
                  <td className="py-2 font-bold text-gray-900">Total Aset</td>
                  <td className="py-2 text-right font-bold text-[#1B8A7A]">Rp {rupiah(totalAssets, 2)}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section>
            <div className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Liabilitas & Ekuitas</div>
            <table className="w-full text-xs">
              <tbody>
                <tr className="border-b border-gray-50">
                  <td className="py-2 text-gray-700">Liabilitas</td>
                  <td className="py-2 text-right font-semibold text-gray-900">Rp {rupiah(0, 2)}</td>
                </tr>
                <tr className="border-b border-gray-50">
                  <td className="py-2 text-gray-700">Ekuitas Awal</td>
                  <td className="py-2 text-right font-semibold text-gray-900">Rp {rupiah(totalOpeningEquity, 2)}</td>
                </tr>
                <tr className="border-b border-gray-50">
                  <td className="py-2 text-gray-700">Laba/Rugi Berjalan</td>
                  <td className={`py-2 text-right font-semibold ${profit >= 0 ? 'text-gray-900' : 'text-red-600'}`}>Rp {rupiah(profit, 2)}</td>
                </tr>
                <tr className="border-t border-gray-200">
                  <td className="py-2 font-bold text-gray-900">Total Liabilitas + Ekuitas</td>
                  <td className="py-2 text-right font-bold text-[#1B8A7A]">Rp {rupiah(totalEquity, 2)}</td>
                </tr>
              </tbody>
            </table>
            <p className="text-[11px] text-gray-400 mt-4">Catatan: versi ini menghitung neraca dari akun kas/bank dan transaksi mutasi. Akun liabilitas manual bisa ditambahkan pada pengembangan berikutnya.</p>
          </section>
        </div>
        {loading && <div className="px-5 pb-5 text-xs text-gray-400 no-print">Memuat data...</div>}
      </div>
    </div>
  )
}
