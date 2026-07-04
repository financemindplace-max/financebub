'use client'
import { useYearList, getActiveYear, persistActiveYear } from '@/lib/use-active-year'

import { useEffect, useMemo, useState } from 'react'
import { Download, FileBarChart, Search, RefreshCw, Plus, Trash2 } from 'lucide-react'
import {
  MONTHS,
  accountDisplayName,
  calcAccountSummaries,
  fetchAccounts,
  fetchCategoryMaps,
  fetchMonth,
  findCategoryMap,
  groupLabel,
  isAccountActive,
  makeId,
  rupiah,
  saveCategoryMaps,
  suggestCategoryMap,
  type CategoryReportGroup,
  type CategoryReportType,
  type FinanceAccount,
  type FinanceCategoryMap,
  type FinanceFlatRow,
  type FinanceMonthData,
  type TxType,
} from '@/lib/finance'

const TABS = [
  { id: 'rekap', label: 'Ringkasan' },
  { id: 'labarugi', label: 'Laba Rugi' },
  { id: 'aruskas', label: 'Arus Kas' },
  { id: 'neraca', label: 'Neraca' },
  { id: 'master', label: 'Master Kategori' },
] as const

type TabId = typeof TABS[number]['id']

const GROUPS: CategoryReportGroup[] = ['pendapatan', 'hpp', 'beban_usaha', 'penyusutan', 'luar_usaha', 'pajak', 'aset', 'liabilitas', 'ekuitas']
const REPORT_TYPES: CategoryReportType[] = ['labarugi', 'neraca']
const TX_TYPES: Array<TxType | 'both'> = ['income', 'expense', 'both']

function printPage() { window.print() }

function rowValue(row: FinanceFlatRow) {
  const tx = row.tx
  const map = row.categoryMap
  if (!map) return tx.type === 'income' ? tx.amount : -tx.amount
  if (map.reportType === 'neraca') {
    if (map.reportGroup === 'aset') return tx.type === 'expense' ? tx.amount : -tx.amount
    if (map.reportGroup === 'liabilitas' || map.reportGroup === 'ekuitas') return tx.type === 'income' ? tx.amount : -tx.amount
  }
  return tx.type === 'income' ? tx.amount : -tx.amount
}

function sumRows(rows: FinanceFlatRow[], predicate: (row: FinanceFlatRow) => boolean, absolute = false) {
  return rows.filter(predicate).reduce((sum, row) => sum + (absolute ? Math.abs(rowValue(row)) : rowValue(row)), 0)
}

export default function LaporanPage() {
  const YEARS = useYearList()
  const now = new Date()
  const [year, setYearRaw] = useState(() => getActiveYear())

  const setYear = (y: number) => {
    setYearRaw(y)
    persistActiveYear(y)
  }

  useEffect(() => {
    const handle = (e: Event) => {
      const y = (e as CustomEvent<number>).detail
      if (Number.isFinite(y) && y >= 2020 && y <= 2099) setYearRaw(y)
    }
    window.addEventListener('financebub-year-change', handle as EventListener)
    return () => window.removeEventListener('financebub-year-change', handle as EventListener)
  }, [])
  const [monthFilter, setMonthFilter] = useState<string>('all')
  const [companyFilter, setCompanyFilter] = useState('all')
  const [accountFilter, setAccountFilter] = useState('all')
  const [tab, setTab] = useState<TabId>('rekap')
  const [months, setMonths] = useState<FinanceMonthData[]>([])
  const [accounts, setAccounts] = useState<FinanceAccount[]>([])
  const [categoryMaps, setCategoryMaps] = useState<FinanceCategoryMap[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [newCat, setNewCat] = useState({ name: '', txType: 'expense' as TxType | 'both', reportType: 'labarugi' as CategoryReportType, reportGroup: 'beban_usaha' as CategoryReportGroup })

  useEffect(() => {
    let mounted = true
    setLoading(true)
    Promise.all([
      Promise.all(MONTHS.map(item => fetchMonth(year, item.no))),
      fetchAccounts(),
      fetchCategoryMaps(),
    ]).then(([monthData, accs, maps]) => {
      if (!mounted) return
      setMonths(monthData)
      setAccounts(accs)
      setCategoryMaps(maps)
      setLoading(false)
    })
    return () => { mounted = false }
  }, [year])

  const companyOptions = useMemo(() => Array.from(new Set(accounts.map(a => a.companyName).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b, 'id')), [accounts])
  const accountOptions = useMemo(() => accounts.filter(a => companyFilter === 'all' || a.companyName === companyFilter), [accounts, companyFilter])

  const flatRows = useMemo<FinanceFlatRow[]>(() => {
    return months.flatMap(data => data.transactions.map(tx => {
      const account = accounts.find(a => a.id === tx.accountId) || null
      const categoryMap = findCategoryMap(tx.category, categoryMaps, tx.type) || suggestCategoryMap(tx.category, tx.type)
      return { year: data.year, month: data.month, monthName: MONTHS.find(m => m.no === data.month)?.name || String(data.month), account, tx, categoryMap }
    }))
  }, [accounts, categoryMaps, months])

  const filteredRows = useMemo(() => flatRows.filter(row =>
    (monthFilter === 'all' || row.month === Number(monthFilter)) &&
    (companyFilter === 'all' || row.account?.companyName === companyFilter) &&
    (accountFilter === 'all' || row.account?.id === accountFilter)
  ), [accountFilter, companyFilter, flatRows, monthFilter])

  const monthlyRows = useMemo(() => MONTHS.map(item => {
    const rows = flatRows.filter(row => row.month === item.no &&
      (companyFilter === 'all' || row.account?.companyName === companyFilter) &&
      (accountFilter === 'all' || row.account?.id === accountFilter))
    const income = rows.filter(row => row.tx.type === 'income').reduce((sum, row) => sum + row.tx.amount, 0)
    const expense = rows.filter(row => row.tx.type === 'expense').reduce((sum, row) => sum + row.tx.amount, 0)
    return { ...item, income, expense, profit: income - expense, transactions: rows.length }
  }), [accountFilter, companyFilter, flatRows])

  const selectedMonths = useMemo(() => monthFilter === 'all' ? months : months.filter(m => m.month === Number(monthFilter)), [monthFilter, months])
  const activeAccounts = useMemo(() => accounts.filter(acc => selectedMonths.some(m => isAccountActive(acc, m.year, m.month)) && (companyFilter === 'all' || acc.companyName === companyFilter) && (accountFilter === 'all' || acc.id === accountFilter)), [accountFilter, accounts, companyFilter, selectedMonths])
  const accountCashSummary = useMemo(() => {
    const map = new Map<string, { account: FinanceAccount, opening: number, income: number, expense: number, closing: number }>()
    selectedMonths.forEach(monthData => {
      calcAccountSummaries(activeAccounts, monthData).forEach(sum => {
        const row = map.get(sum.account.id) || { account: sum.account, opening: 0, income: 0, expense: 0, closing: 0 }
        row.opening += sum.opening
        row.income += sum.income
        row.expense += sum.expense
        row.closing += sum.balance
        map.set(sum.account.id, row)
      })
    })
    return Array.from(map.values())
  }, [activeAccounts, selectedMonths])

  const grand = filteredRows.reduce((acc, row) => {
    if (row.tx.type === 'income') acc.income += row.tx.amount
    if (row.tx.type === 'expense') acc.expense += row.tx.amount
    acc.transactions += 1
    return acc
  }, { income: 0, expense: 0, transactions: 0 })

  const categoryRows = useMemo(() => {
    const map = new Map<string, { category: string, income: number, expense: number, count: number, rows: FinanceFlatRow[] }>()
    filteredRows.forEach(row => {
      const key = row.tx.category || 'Tanpa Kategori'
      const item = map.get(key) || { category: key, income: 0, expense: 0, count: 0, rows: [] }
      if (row.tx.type === 'income') item.income += row.tx.amount
      if (row.tx.type === 'expense') item.expense += row.tx.amount
      item.count += 1
      item.rows.push(row)
      map.set(key, item)
    })
    return Array.from(map.values()).sort((a, b) => (b.income + b.expense) - (a.income + a.expense))
  }, [filteredRows])

  const drilldown = useMemo(() => {
    const rows = selectedCategory ? categoryRows.find(r => r.category === selectedCategory)?.rows || [] : []
    const keyword = search.toLowerCase()
    return rows.filter(row => !keyword || row.tx.description.toLowerCase().includes(keyword) || accountDisplayName(row.account).toLowerCase().includes(keyword))
  }, [categoryRows, search, selectedCategory])

  const labaRugi = useMemo(() => {
    const lrRows = filteredRows.filter(row => row.categoryMap?.reportType === 'labarugi')
    const pendapatan = sumRows(lrRows, row => row.categoryMap?.reportGroup === 'pendapatan' && row.tx.type === 'income', true)
    const hpp = sumRows(lrRows, row => row.categoryMap?.reportGroup === 'hpp' && row.tx.type === 'expense', true)
    const bebanUsaha = sumRows(lrRows, row => row.categoryMap?.reportGroup === 'beban_usaha' && row.tx.type === 'expense', true)
    const penyusutan = sumRows(lrRows, row => row.categoryMap?.reportGroup === 'penyusutan' && row.tx.type === 'expense', true)
    const luarUsaha = sumRows(lrRows, row => row.categoryMap?.reportGroup === 'luar_usaha')
    const pajak = sumRows(lrRows, row => row.categoryMap?.reportGroup === 'pajak' && row.tx.type === 'expense', true)
    const labaKotor = pendapatan - hpp
    const labaOperasional = labaKotor - bebanUsaha - penyusutan
    const labaSebelumPajak = labaOperasional + luarUsaha
    const labaBersih = labaSebelumPajak - pajak
    return { pendapatan, hpp, bebanUsaha, penyusutan, luarUsaha, pajak, labaKotor, labaOperasional, labaSebelumPajak, labaBersih }
  }, [filteredRows])

  const neraca = useMemo(() => {
    const cashClosing = accountCashSummary.reduce((sum, row) => sum + row.closing, 0)
    const assetNonCash = sumRows(filteredRows, row => row.categoryMap?.reportType === 'neraca' && row.categoryMap?.reportGroup === 'aset')
    const liabilitas = sumRows(filteredRows, row => row.categoryMap?.reportType === 'neraca' && row.categoryMap?.reportGroup === 'liabilitas')
    const ekuitas = sumRows(filteredRows, row => row.categoryMap?.reportType === 'neraca' && row.categoryMap?.reportGroup === 'ekuitas')
    const totalAset = cashClosing + assetNonCash
    const totalLiabEkuitas = liabilitas + ekuitas + labaRugi.labaBersih
    return { cashClosing, assetNonCash, liabilitas, ekuitas, totalAset, totalLiabEkuitas, selisih: totalAset - totalLiabEkuitas }
  }, [accountCashSummary, filteredRows, labaRugi.labaBersih])

  const syncCategories = async () => {
    const next = [...categoryMaps]
    filteredRows.forEach(row => {
      if (!findCategoryMap(row.tx.category, next, row.tx.type)) next.push(suggestCategoryMap(row.tx.category, row.tx.type))
    })
    setCategoryMaps(next)
    await saveCategoryMaps(next)
    alert('Kategori dari mutasi sudah disinkronkan ke master laporan.')
  }

  const addCategory = async () => {
    if (!newCat.name.trim()) return alert('Nama kategori wajib diisi')
    const next = [...categoryMaps, { id: makeId('cat'), name: newCat.name.trim(), txType: newCat.txType, reportType: newCat.reportType, reportGroup: newCat.reportGroup, normalBalance: (newCat.txType === 'income' ? 'credit' : 'debit') as 'debit' | 'credit', active: true, createdAt: new Date().toISOString() }]
    setCategoryMaps(next)
    await saveCategoryMaps(next)
    setNewCat({ name: '', txType: 'expense', reportType: 'labarugi', reportGroup: 'beban_usaha' })
  }

  const updateCategory = async (id: string, patch: Partial<FinanceCategoryMap>) => {
    const next = categoryMaps.map(cat => cat.id === id ? { ...cat, ...patch } : cat)
    setCategoryMaps(next)
    await saveCategoryMaps(next)
  }

  const deleteCategory = async (id: string) => {
    if (!confirm('Hapus kategori dari master laporan?')) return
    const next = categoryMaps.filter(cat => cat.id !== id)
    setCategoryMaps(next)
    await saveCategoryMaps(next)
  }

  const renderMoney = (value: number, color = 'text-gray-900') => <span className={`font-semibold ${value < 0 ? 'text-red-600' : color}`}>Rp {rupiah(value, 2)}</span>

  return (
    <div className="p-6 print:p-0">
      <style jsx global>{`
        @media print {
          aside, button, input, select, .no-print { display: none !important; }
          main { margin-left: 0 !important; }
          body { background: white !important; }
          .print-card { box-shadow: none !important; border-color: #d1d5db !important; }
          @page { size: A4 landscape; margin: 10mm; }
        }
      `}</style>

      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Laporan Keuangan</h1>
          <p className="text-sm text-gray-400 mt-0.5">Filter per bulan, PT, rekening, master kategori, Laba Rugi, Arus Kas, dan Neraca — {year}</p>
        </div>
        <div className="flex items-center gap-2 no-print flex-wrap justify-end">
          <select value={year} onChange={e => setYear(Number(e.target.value))} className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white outline-none focus:border-[#1B8A7A]">{YEARS.map(y => <option key={y} value={y}>{y}</option>)}</select>
          <select value={monthFilter} onChange={e => setMonthFilter(e.target.value)} className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white outline-none focus:border-[#1B8A7A]"><option value="all">Semua Bulan</option>{MONTHS.map(m => <option key={m.no} value={m.no}>{m.name}</option>)}</select>
          <select value={companyFilter} onChange={e => { setCompanyFilter(e.target.value); setAccountFilter('all') }} className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white outline-none focus:border-[#1B8A7A]"><option value="all">Semua PT</option>{companyOptions.map(c => <option key={c} value={c}>{c}</option>)}</select>
          <select value={accountFilter} onChange={e => setAccountFilter(e.target.value)} className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white outline-none focus:border-[#1B8A7A]"><option value="all">Semua Rekening</option>{accountOptions.map(a => <option key={a.id} value={a.id}>{accountDisplayName(a)}</option>)}</select>
          <button onClick={printPage} className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50"><Download className="w-4 h-4" /> Download PDF</button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-5">
        <div className="bg-white rounded-xl border border-gray-100 p-4 print-card"><div className="text-xs text-gray-400">Total Pemasukan</div><div className="text-lg font-bold text-green-700 mt-1">Rp {rupiah(grand.income, 2)}</div></div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 print-card"><div className="text-xs text-gray-400">Total Pengeluaran</div><div className="text-lg font-bold text-red-600 mt-1">Rp {rupiah(grand.expense, 2)}</div></div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 print-card"><div className="text-xs text-gray-400">Laba Bersih</div><div className={`text-lg font-bold mt-1 ${labaRugi.labaBersih >= 0 ? 'text-[#1B8A7A]' : 'text-red-600'}`}>Rp {rupiah(labaRugi.labaBersih, 2)}</div></div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 print-card"><div className="text-xs text-gray-400">Jumlah Transaksi</div><div className="text-lg font-bold text-gray-900 mt-1">{grand.transactions}</div></div>
      </div>

      <div className="flex gap-2 mb-5 no-print overflow-auto">
        {TABS.map(item => <button key={item.id} onClick={() => setTab(item.id)} className={`px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap ${tab === item.id ? 'bg-[#1B8A7A] text-white' : 'bg-white border border-gray-200 text-gray-500 hover:bg-gray-50'}`}>{item.label}</button>)}
      </div>

      {tab === 'rekap' && <div className="grid grid-cols-[1.2fr_.8fr] gap-5 mb-5">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden print-card"><div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2"><FileBarChart className="w-4 h-4 text-[#1B8A7A]" /><h2 className="text-sm font-semibold text-gray-900">Laporan Bulanan</h2></div><table className="w-full text-xs"><thead className="bg-gray-50 text-gray-400 uppercase tracking-wide"><tr><th className="px-4 py-2 text-left">Bulan</th><th className="px-4 py-2 text-right">Pemasukan</th><th className="px-4 py-2 text-right">Pengeluaran</th><th className="px-4 py-2 text-right">Laba/Rugi</th><th className="px-4 py-2 text-right">Tx</th></tr></thead><tbody>{monthlyRows.map(row => <tr key={row.no} className="border-t border-gray-50"><td className="px-4 py-2 font-medium text-gray-800">{row.name}</td><td className="px-4 py-2 text-right text-green-700">Rp {rupiah(row.income, 2)}</td><td className="px-4 py-2 text-right text-red-600">Rp {rupiah(row.expense, 2)}</td><td className={`px-4 py-2 text-right font-semibold ${row.profit >= 0 ? 'text-gray-900' : 'text-red-600'}`}>Rp {rupiah(row.profit, 2)}</td><td className="px-4 py-2 text-right text-gray-500">{row.transactions}</td></tr>)}</tbody></table></div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden print-card"><div className="px-4 py-3 border-b border-gray-100"><h2 className="text-sm font-semibold text-gray-900">Kategori</h2><p className="text-xs text-gray-400">Klik kategori untuk melihat detail transaksi.</p></div><div className="max-h-[520px] overflow-auto">{categoryRows.map(row => <button key={row.category} onClick={() => { setSelectedCategory(row.category); setSearch('') }} className={`w-full px-4 py-3 border-b border-gray-50 text-left hover:bg-gray-50 ${selectedCategory === row.category ? 'bg-[#E1F5EE]' : ''}`}><div className="flex justify-between gap-3 text-xs"><span className="font-semibold text-gray-800 truncate">{row.category}</span><span className="font-semibold text-gray-900">Rp {rupiah(row.income - row.expense, 2)}</span></div><div className="flex justify-between text-[10px] text-gray-400 mt-1"><span>Masuk Rp {rupiah(row.income, 0)}</span><span>Keluar Rp {rupiah(row.expense, 0)}</span></div></button>)}{!loading && categoryRows.length === 0 && <div className="px-4 py-10 text-center text-xs text-gray-400">Belum ada data kategori.</div>}</div></div>
      </div>}

      {selectedCategory && tab === 'rekap' && <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden print-card mb-5"><div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-gray-900">Detail Kategori: {selectedCategory}</h2><p className="text-xs text-gray-400">Tanggal, rekening, keterangan, dan nominal transaksi.</p></div><div className="relative no-print"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari detail..." className="pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A]" /></div></div><table className="w-full text-xs"><thead className="bg-gray-50 text-gray-400 uppercase"><tr><th className="px-4 py-2 text-left">Tanggal</th><th className="px-4 py-2 text-left">Rekening</th><th className="px-4 py-2 text-left">Keterangan</th><th className="px-4 py-2 text-right">Nominal</th></tr></thead><tbody>{drilldown.map(row => <tr key={row.tx.id} className="border-t border-gray-50"><td className="px-4 py-2">{row.tx.date}</td><td className="px-4 py-2">{accountDisplayName(row.account)}</td><td className="px-4 py-2">{row.tx.description}</td><td className={`px-4 py-2 text-right font-semibold ${row.tx.type === 'income' ? 'text-green-700' : 'text-red-600'}`}>{row.tx.type === 'income' ? '+' : '-'} Rp {rupiah(row.tx.amount, 2)}</td></tr>)}</tbody></table></div>}

      {tab === 'labarugi' && <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden print-card"><div className="px-5 py-4 border-b border-gray-100"><h2 className="text-sm font-semibold text-gray-900">Laporan Laba Rugi</h2></div><div className="p-5 max-w-3xl"><table className="w-full text-xs"><tbody><tr><td className="py-2 font-semibold text-green-700">Pendapatan</td><td className="py-2 text-right">{renderMoney(labaRugi.pendapatan, 'text-green-700')}</td></tr><tr><td className="py-2 text-gray-700">HPP / Biaya Produksi</td><td className="py-2 text-right">{renderMoney(labaRugi.hpp, 'text-red-600')}</td></tr><tr className="border-t"><td className="py-2 font-bold">Laba Kotor</td><td className="py-2 text-right">{renderMoney(labaRugi.labaKotor, 'text-[#1B8A7A]')}</td></tr><tr><td className="py-2 text-gray-700">Beban Usaha</td><td className="py-2 text-right">{renderMoney(labaRugi.bebanUsaha, 'text-red-600')}</td></tr><tr><td className="py-2 text-gray-700">Penyusutan</td><td className="py-2 text-right">{renderMoney(labaRugi.penyusutan, 'text-red-600')}</td></tr><tr className="border-t"><td className="py-2 font-bold">Laba Operasional</td><td className="py-2 text-right">{renderMoney(labaRugi.labaOperasional, 'text-[#1B8A7A]')}</td></tr><tr><td className="py-2 text-gray-700">Pendapatan/Beban Luar Usaha</td><td className="py-2 text-right">{renderMoney(labaRugi.luarUsaha)}</td></tr><tr><td className="py-2 text-gray-700">Pajak</td><td className="py-2 text-right">{renderMoney(labaRugi.pajak, 'text-red-600')}</td></tr><tr className="border-t-2 border-gray-900"><td className="py-3 font-bold text-gray-900">LABA BERSIH</td><td className="py-3 text-right text-base">{renderMoney(labaRugi.labaBersih, 'text-[#1B8A7A]')}</td></tr></tbody></table></div></div>}

      {tab === 'aruskas' && <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden print-card"><div className="px-5 py-4 border-b border-gray-100"><h2 className="text-sm font-semibold text-gray-900">Arus Kas per Rekening</h2></div><table className="w-full text-xs"><thead className="bg-gray-50 text-gray-400 uppercase"><tr><th className="px-4 py-2 text-left">Rekening</th><th className="px-4 py-2 text-right">Saldo Awal</th><th className="px-4 py-2 text-right">Masuk</th><th className="px-4 py-2 text-right">Keluar</th><th className="px-4 py-2 text-right">Saldo Akhir</th></tr></thead><tbody>{accountCashSummary.map(row => <tr key={row.account.id} className="border-t border-gray-50"><td className="px-4 py-2 font-medium">{accountDisplayName(row.account)}</td><td className="px-4 py-2 text-right">Rp {rupiah(row.opening, 2)}</td><td className="px-4 py-2 text-right text-green-700">Rp {rupiah(row.income, 2)}</td><td className="px-4 py-2 text-right text-red-600">Rp {rupiah(row.expense, 2)}</td><td className="px-4 py-2 text-right font-semibold">Rp {rupiah(row.closing, 2)}</td></tr>)}</tbody></table></div>}

      {tab === 'neraca' && <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden print-card"><div className="px-5 py-4 border-b border-gray-100"><h2 className="text-sm font-semibold text-gray-900">Neraca dari Mutasi & Master Kategori</h2></div><div className="grid grid-cols-2 gap-8 p-5"><section><div className="text-xs font-bold text-[#1B8A7A] uppercase tracking-wider mb-2">Aset</div><table className="w-full text-xs"><tbody><tr><td className="py-2">Kas & Bank</td><td className="py-2 text-right">{renderMoney(neraca.cashClosing, 'text-[#1B8A7A]')}</td></tr><tr><td className="py-2">Aset Non-Kas dari Mutasi</td><td className="py-2 text-right">{renderMoney(neraca.assetNonCash, 'text-[#1B8A7A]')}</td></tr><tr className="border-t"><td className="py-2 font-bold">Total Aset</td><td className="py-2 text-right">{renderMoney(neraca.totalAset, 'text-[#1B8A7A]')}</td></tr></tbody></table></section><section><div className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Liabilitas & Ekuitas</div><table className="w-full text-xs"><tbody><tr><td className="py-2">Liabilitas</td><td className="py-2 text-right">{renderMoney(neraca.liabilitas)}</td></tr><tr><td className="py-2">Ekuitas</td><td className="py-2 text-right">{renderMoney(neraca.ekuitas)}</td></tr><tr><td className="py-2">Laba Bersih Berjalan</td><td className="py-2 text-right">{renderMoney(labaRugi.labaBersih)}</td></tr><tr className="border-t"><td className="py-2 font-bold">Total Liabilitas + Ekuitas</td><td className="py-2 text-right">{renderMoney(neraca.totalLiabEkuitas, 'text-[#1B8A7A]')}</td></tr><tr><td className="py-2 text-gray-500">Selisih</td><td className="py-2 text-right">{renderMoney(neraca.selisih)}</td></tr></tbody></table></section></div></div>}

      {tab === 'master' && <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden print-card"><div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between"><div><h2 className="text-sm font-semibold text-gray-900">Master Kategori Laporan</h2><p className="text-xs text-gray-400">Jembatan dari Mutasi Kas/Bank ke Laba Rugi, Arus Kas, dan Neraca.</p></div><button onClick={syncCategories} className="no-print flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#1B8A7A] text-white text-xs font-semibold"><RefreshCw className="w-3.5 h-3.5" /> Sync dari Mutasi</button></div><div className="p-4 border-b border-gray-100 no-print"><div className="grid grid-cols-[1fr_130px_130px_170px_110px] gap-2"><input value={newCat.name} onChange={e => setNewCat(v => ({ ...v, name: e.target.value }))} placeholder="Nama kategori baru" className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A]" /><select value={newCat.txType} onChange={e => setNewCat(v => ({ ...v, txType: e.target.value as TxType | 'both' }))} className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white"><option value="income">Pemasukan</option><option value="expense">Pengeluaran</option><option value="both">Keduanya</option></select><select value={newCat.reportType} onChange={e => setNewCat(v => ({ ...v, reportType: e.target.value as CategoryReportType }))} className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white">{REPORT_TYPES.map(type => <option key={type} value={type}>{type === 'labarugi' ? 'Laba Rugi' : 'Neraca'}</option>)}</select><select value={newCat.reportGroup} onChange={e => setNewCat(v => ({ ...v, reportGroup: e.target.value as CategoryReportGroup }))} className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white">{GROUPS.map(group => <option key={group} value={group}>{groupLabel(group)}</option>)}</select><button onClick={addCategory} className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-gray-900 text-white text-xs font-semibold"><Plus className="w-3.5 h-3.5" /> Tambah</button></div></div><div className="overflow-x-auto"><table className="w-full text-xs min-w-[980px]"><thead className="bg-gray-50 text-gray-400 uppercase"><tr><th className="px-4 py-2 text-left">Kategori</th><th className="px-4 py-2 text-left">Jenis</th><th className="px-4 py-2 text-left">Laporan</th><th className="px-4 py-2 text-left">Grup</th><th className="px-4 py-2 text-left">Saldo Normal</th><th className="px-4 py-2 text-center no-print">Aksi</th></tr></thead><tbody>{categoryMaps.map(cat => <tr key={cat.id} className="border-t border-gray-50"><td className="px-4 py-2"><input value={cat.name} onChange={e => updateCategory(cat.id, { name: e.target.value })} className="w-full px-2 py-1.5 border border-transparent hover:border-gray-200 rounded bg-transparent" /></td><td className="px-4 py-2"><select value={cat.txType} onChange={e => updateCategory(cat.id, { txType: e.target.value as TxType | 'both' })} className="px-2 py-1.5 border border-gray-200 rounded bg-white">{TX_TYPES.map(type => <option key={type} value={type}>{type === 'income' ? 'Pemasukan' : type === 'expense' ? 'Pengeluaran' : 'Keduanya'}</option>)}</select></td><td className="px-4 py-2"><select value={cat.reportType} onChange={e => updateCategory(cat.id, { reportType: e.target.value as CategoryReportType })} className="px-2 py-1.5 border border-gray-200 rounded bg-white"><option value="labarugi">Laba Rugi</option><option value="neraca">Neraca</option></select></td><td className="px-4 py-2"><select value={cat.reportGroup} onChange={e => updateCategory(cat.id, { reportGroup: e.target.value as CategoryReportGroup })} className="px-2 py-1.5 border border-gray-200 rounded bg-white">{GROUPS.map(group => <option key={group} value={group}>{groupLabel(group)}</option>)}</select></td><td className="px-4 py-2"><select value={cat.normalBalance} onChange={e => updateCategory(cat.id, { normalBalance: e.target.value as 'debit' | 'credit' })} className="px-2 py-1.5 border border-gray-200 rounded bg-white"><option value="debit">Debit</option><option value="credit">Credit</option></select></td><td className="px-4 py-2 text-center no-print"><button onClick={() => deleteCategory(cat.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 className="w-3.5 h-3.5" /></button></td></tr>)}</tbody></table></div></div>}

      {loading && <div className="text-xs text-gray-400 mt-4 no-print">Memuat data...</div>}
    </div>
  )
}
