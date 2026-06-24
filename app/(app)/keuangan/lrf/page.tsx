'use client'
import { useYearList, getActiveYear } from '@/lib/use-active-year'

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Download, DollarSign, X } from 'lucide-react'
import { MONTHS, fetchMonth, rupiah, type FinanceMonthData, type FinanceTransaction } from '@/lib/finance'


interface ProfitLossRow {
  category: string
  income: number
  expense: number
}

interface CategoryDetail {
  category: string
  type: 'income' | 'expense'
  txs: FinanceTransaction[]
}

function dateLabel(value: string) {
  if (!value) return '-'
  const [y, m, d] = value.split('-')
  if (!y || !m || !d) return value
  return `${d}/${m}/${y}`
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export default function LRFPage() {
  const YEARS = useYearList()
  const [year, setYearRaw] = useState(() => getActiveYear())

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
  const [months, setMonths] = useState<FinanceMonthData[]>([])
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<CategoryDetail | null>(null)

  useEffect(() => {
    let mounted = true
    setLoading(true)
    Promise.all(MONTHS.map(item => fetchMonth(year, item.no))).then(data => {
      if (!mounted) return
      setMonths(data)
      setLoading(false)
    })
    return () => { mounted = false }
  }, [year])

  const rows = useMemo(() => {
    const map = new Map<string, ProfitLossRow>()
    months.flatMap(month => month.transactions).forEach(tx => {
      const category = tx.category || 'Tanpa Kategori'
      const row = map.get(category) || { category, income: 0, expense: 0 }
      if (tx.type === 'income') row.income += tx.amount
      if (tx.type === 'expense') row.expense += tx.amount
      map.set(category, row)
    })
    return Array.from(map.values()).sort((a, b) => (b.income + b.expense) - (a.income + a.expense))
  }, [months])

  const txsByCategory = useMemo(() => {
    const map = new Map<string, { income: FinanceTransaction[]; expense: FinanceTransaction[] }>()
    months.flatMap(m => m.transactions).forEach(tx => {
      const cat = tx.category || 'Tanpa Kategori'
      const entry = map.get(cat) || { income: [], expense: [] }
      if (tx.type === 'income') entry.income.push(tx)
      else entry.expense.push(tx)
      map.set(cat, entry)
    })
    return map
  }, [months])

  const openDetail = (category: string, type: 'income' | 'expense') => {
    const entry = txsByCategory.get(category)
    const txs = type === 'income' ? (entry?.income ?? []) : (entry?.expense ?? [])
    setDetail({ category, type, txs: [...txs].sort((a, b) => a.date.localeCompare(b.date)) })
  }

  const downloadDetailPdf = (d: CategoryDetail) => {
    const typeLabel = d.type === 'income' ? 'Pendapatan' : 'Pengeluaran'
    const totalAmt = d.txs.reduce((s, tx) => s + tx.amount, 0)
    const rowsHtml = d.txs.length
      ? d.txs.map((tx, idx) => `
          <tr>
            <td class="center">${idx + 1}</td>
            <td class="nowrap">${escapeHtml(dateLabel(tx.date))}</td>
            <td>${escapeHtml(tx.description)}</td>
            <td class="right ${d.type}"}>Rp ${rupiah(tx.amount, 2)}</td>
          </tr>`).join('')
      : `<tr><td colspan="4" class="empty">Tidak ada transaksi.</td></tr>`

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Detail ${escapeHtml(d.category)} ${year}</title>
  <style>
    @page{size:A4 portrait;margin:12mm}
    *{box-sizing:border-box}
    body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;margin:0;font-size:11px}
    .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1B8A7A;padding-bottom:14px;margin-bottom:16px}
    .brand{display:flex;align-items:center;gap:10px}
    .logo{width:44px;height:44px;border-radius:12px;background:#1B8A7A;color:white;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:16px}
    h1{margin:0;font-size:20px;text-align:right}
    h2{margin:0 0 3px;font-size:15px}
    .meta{text-align:right;color:#475569;line-height:1.6}
    .badge{display:inline-block;padding:2px 10px;border-radius:99px;font-size:9px;font-weight:700;text-transform:uppercase;margin-top:4px}
    .badge-income{background:#dcfce7;color:#047857}
    .badge-expense{background:#fee2e2;color:#dc2626}
    .summary{display:flex;gap:10px;margin-bottom:14px}
    .card{border:1px solid #dbe3ea;border-radius:10px;padding:10px 14px}
    .lbl{color:#64748b;font-size:9px;text-transform:uppercase;letter-spacing:.05em;font-weight:700;margin-bottom:4px}
    .amount{font-size:16px;font-weight:900}
    .income{color:#047857}
    .expense{color:#dc2626}
    table{width:100%;border-collapse:collapse;margin-top:8px}
    th{background:#f8fafc;color:#64748b;text-transform:uppercase;font-size:9px;letter-spacing:.04em;text-align:left;padding:8px 10px;border-bottom:2px solid #e5edf3}
    td{padding:8px 10px;border-bottom:1px solid #edf2f7;vertical-align:top}
    tr:last-child td{border-bottom:0}
    .right{text-align:right;white-space:nowrap;font-weight:700}
    .center{text-align:center;width:32px;color:#64748b}
    .nowrap{white-space:nowrap}
    .empty{text-align:center;padding:20px;color:#94a3b8}
    .total-row td{font-weight:800;font-size:12px;background:#f8fafc;border-top:2px solid #1B8A7A}
    .footer{margin-top:14px;color:#94a3b8;font-size:9px;display:flex;justify-content:space-between;border-top:1px solid #e5edf3;padding-top:8px}
    @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style>
</head>
<body>
  <div class="header">
    <div class="brand">
      <div><h2>FinanceBub</h2><div style="color:#64748b;font-size:11px;margin-top:2px">L/R Final — Detail Kategori</div></div>
    </div>
    <div>
      <h1>${escapeHtml(d.category)}</h1>
      <div class="meta">Periode: <strong>${year}</strong><br/>Jenis: <span class="badge badge-${d.type}">${typeLabel}</span></div>
    </div>
  </div>
  <div class="summary">
    <div class="card"><div class="lbl">Kategori</div><div style="font-size:14px;font-weight:700">${escapeHtml(d.category)}</div></div>
    <div class="card"><div class="lbl">Total Transaksi</div><div style="font-size:14px;font-weight:700">${d.txs.length}</div></div>
    <div class="card" style="flex:1"><div class="lbl">Total ${typeLabel}</div><div class="amount ${d.type}">Rp ${rupiah(totalAmt, 2)}</div></div>
  </div>
  <table>
    <thead><tr><th>No</th><th>Tanggal</th><th>Keterangan</th><th class="right">Nominal</th></tr></thead>
    <tbody>
      ${rowsHtml}
      <tr class="total-row">
        <td colspan="3">Total ${escapeHtml(d.category)}</td>
        <td class="right ${d.type}">Rp ${rupiah(totalAmt, 2)}</td>
      </tr>
    </tbody>
  </table>
  <div class="footer"><span>Generated by FinanceBub</span><span>Dicetak: ${dateLabel(new Date().toISOString().slice(0, 10))}</span></div>
  <script>window.onload=function(){setTimeout(function(){window.print()},250)}</script>
</body>
</html>`

    const win = window.open('', '_blank', 'width=980,height=720')
    if (!win) return alert('Popup diblokir browser. Izinkan popup untuk download PDF.')
    win.document.open()
    win.document.write(html)
    win.document.close()
  }

  const incomeRows = rows.filter(row => row.income > 0)
  const expenseRows = rows.filter(row => row.expense > 0)
  const totalIncome = rows.reduce((sum, row) => sum + row.income, 0)
  const totalExpense = rows.reduce((sum, row) => sum + row.expense, 0)
  const netProfit = totalIncome - totalExpense
  const margin = totalIncome > 0 ? netProfit / totalIncome * 100 : 0

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
          <h1 className="text-xl font-semibold text-gray-900">L/R Final</h1>
          <p className="text-sm text-gray-400 mt-0.5">Laporan laba rugi final per kategori — {year}</p>
        </div>
        <div className="flex items-center gap-2 no-print">
          <div className="relative">
            <select value={year} onChange={e => setYear(Number(e.target.value))}
              className="appearance-none pl-3 pr-8 py-2 text-sm border border-gray-200 rounded-lg bg-white outline-none focus:border-[#1B8A7A]">
              {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          </div>
          <button onClick={() => window.print()} className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50">
            <Download className="w-4 h-4" /> Download PDF
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-5">
        <div className="bg-white rounded-xl border border-gray-100 p-4 print-card"><div className="text-xs text-gray-400">Pendapatan</div><div className="text-lg font-bold text-green-700 mt-1">Rp {rupiah(totalIncome, 2)}</div></div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 print-card"><div className="text-xs text-gray-400">Beban/Biaya</div><div className="text-lg font-bold text-red-600 mt-1">Rp {rupiah(totalExpense, 2)}</div></div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 print-card"><div className="text-xs text-gray-400">Laba Bersih</div><div className={`text-lg font-bold mt-1 ${netProfit >= 0 ? 'text-[#1B8A7A]' : 'text-red-600'}`}>Rp {rupiah(netProfit, 2)}</div></div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 print-card"><div className="text-xs text-gray-400">Margin</div><div className={`text-lg font-bold mt-1 ${margin >= 0 ? 'text-gray-900' : 'text-red-600'}`}>{rupiah(margin, 2)}%</div></div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden print-card">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-[#1B8A7A]" />
          <h2 className="text-sm font-semibold text-gray-900">Statement Laba Rugi</h2>
          <span className="text-xs text-gray-400 ml-1 no-print">· klik baris kategori untuk lihat detail transaksi</span>
        </div>
        <div className="p-5">
          <section className="mb-6">
            <div className="text-xs font-bold text-green-700 uppercase tracking-wider mb-2">Pendapatan</div>
            <table className="w-full text-xs">
              <tbody>
                {incomeRows.map(row => (
                  <tr
                    key={`income-${row.category}`}
                    onClick={() => openDetail(row.category, 'income')}
                    className="border-b border-gray-50 cursor-pointer hover:bg-[#E1F5EE]/40 group no-print-hover"
                  >
                    <td className="py-2 text-gray-700 flex items-center gap-1">
                      {row.category}
                      <ChevronRight className="w-3 h-3 text-gray-300 group-hover:text-[#1B8A7A] opacity-0 group-hover:opacity-100 transition-opacity no-print" />
                    </td>
                    <td className="py-2 text-right font-semibold text-gray-900">Rp {rupiah(row.income, 2)}</td>
                  </tr>
                ))}
                {incomeRows.length === 0 && <tr><td className="py-4 text-gray-400">Belum ada pendapatan.</td><td /></tr>}
                <tr className="border-t border-gray-200">
                  <td className="py-2 font-bold text-gray-900">Total Pendapatan</td>
                  <td className="py-2 text-right font-bold text-green-700">Rp {rupiah(totalIncome, 2)}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section>
            <div className="text-xs font-bold text-red-600 uppercase tracking-wider mb-2">Beban / Pengeluaran</div>
            <table className="w-full text-xs">
              <tbody>
                {expenseRows.map(row => (
                  <tr
                    key={`expense-${row.category}`}
                    onClick={() => openDetail(row.category, 'expense')}
                    className="border-b border-gray-50 cursor-pointer hover:bg-red-50/40 group"
                  >
                    <td className="py-2 text-gray-700 flex items-center gap-1">
                      {row.category}
                      <ChevronRight className="w-3 h-3 text-gray-300 group-hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity no-print" />
                    </td>
                    <td className="py-2 text-right font-semibold text-gray-900">Rp {rupiah(row.expense, 2)}</td>
                  </tr>
                ))}
                {expenseRows.length === 0 && <tr><td className="py-4 text-gray-400">Belum ada pengeluaran.</td><td /></tr>}
                <tr className="border-t border-gray-200">
                  <td className="py-2 font-bold text-gray-900">Total Beban</td>
                  <td className="py-2 text-right font-bold text-red-600">Rp {rupiah(totalExpense, 2)}</td>
                </tr>
                <tr className="border-t-2 border-gray-900">
                  <td className="py-3 font-bold text-gray-900">Laba/Rugi Bersih</td>
                  <td className={`py-3 text-right font-bold ${netProfit >= 0 ? 'text-[#1B8A7A]' : 'text-red-600'}`}>Rp {rupiah(netProfit, 2)}</td>
                </tr>
              </tbody>
            </table>
          </section>

          {loading && <div className="text-xs text-gray-400 mt-4 no-print">Memuat data...</div>}
        </div>
      </div>

      {/* Modal Detail Kategori */}
      {detail && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 no-print"
          onClick={() => setDetail(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col mx-4"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-100 flex-shrink-0">
              <div>
                <div className={`text-[10px] font-bold uppercase tracking-wider mb-0.5 ${detail.type === 'income' ? 'text-green-700' : 'text-red-600'}`}>
                  {detail.type === 'income' ? 'Pendapatan' : 'Pengeluaran'}
                </div>
                <h2 className="text-base font-semibold text-gray-900">{detail.category}</h2>
                <p className="text-xs text-gray-400 mt-0.5">{detail.txs.length} transaksi · {year}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => downloadDetailPdf(detail)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  <Download className="w-3.5 h-3.5" /> Download PDF
                </button>
                <button onClick={() => setDetail(null)} className="p-1.5 rounded-lg hover:bg-gray-100">
                  <X className="w-4 h-4 text-gray-500" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="overflow-y-auto flex-1">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0 z-10">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-gray-400 uppercase tracking-wide">Tanggal</th>
                    <th className="px-4 py-2.5 text-left text-gray-400 uppercase tracking-wide">Keterangan</th>
                    <th className="px-4 py-2.5 text-right text-gray-400 uppercase tracking-wide">Nominal</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.txs.map(tx => (
                    <tr key={tx.id} className="border-t border-gray-50 hover:bg-gray-50/60">
                      <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{dateLabel(tx.date)}</td>
                      <td className="px-4 py-2.5 text-gray-800 font-medium">{tx.description}</td>
                      <td className={`px-4 py-2.5 text-right font-semibold ${detail.type === 'income' ? 'text-green-700' : 'text-red-600'}`}>
                        Rp {rupiah(tx.amount, 2)}
                      </td>
                    </tr>
                  ))}
                  {detail.txs.length === 0 && (
                    <tr><td colSpan={3} className="px-4 py-10 text-center text-gray-400">Tidak ada transaksi.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Modal Footer Total */}
            <div className={`flex items-center justify-between px-5 py-3 border-t-2 ${detail.type === 'income' ? 'border-green-100 bg-green-50/40' : 'border-red-100 bg-red-50/40'} flex-shrink-0`}>
              <span className="text-xs font-bold text-gray-700">Total {detail.category}</span>
              <span className={`text-sm font-bold ${detail.type === 'income' ? 'text-green-700' : 'text-red-600'}`}>
                Rp {rupiah(detail.txs.reduce((s, tx) => s + tx.amount, 0), 2)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
