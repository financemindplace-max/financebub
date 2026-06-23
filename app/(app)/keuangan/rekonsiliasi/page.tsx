'use client'

import { useEffect, useMemo, useState } from 'react'
import { useYearList, getActiveYear } from '@/lib/use-active-year'
import { Download, FileSpreadsheet } from 'lucide-react'
import { MONTHS, fetchMonth, rupiah, type FinanceMonthData, type FinanceTransaction } from '@/lib/finance'

// ── Types ────────────────────────────────────────────────────────────────────

interface PaymentLinkItem {
  docType: 'invoice' | 'quotation'
  docNo: string
  docYear: number
  projectYear?: number
  taxYear?: number
  amount: number
}

interface LinkedTx extends FinanceTransaction {
  invoicePayment?: { invoiceYear: number; projectYear?: number; invoiceNo: string }
  quotationPayment?: { quotationYear: number; projectYear?: number; quotationNo: string }
  paymentLinks?: PaymentLinkItem[]
}

interface TaxLine {
  taxYear: number
  amount: number
  label: string
}

interface RekonRow {
  date: string
  description: string
  category: string
  accountId: string
  totalAmount: number
  taxLines: TaxLine[]
  remainder: number
}

// ── Helper ───────────────────────────────────────────────────────────────────

function getTaxLines(tx: LinkedTx, fallbackYear: number): { lines: TaxLine[]; remainder: number } {
  const lines: TaxLine[] = []

  if (tx.paymentLinks && tx.paymentLinks.length > 0) {
    tx.paymentLinks.forEach(link => {
      // Gunakan override tahun pajak, lalu tahun project. docYear hanya tahun
      // penyimpanan dokumen dan tidak boleh otomatis dianggap sebagai tahun pajak.
      const effectiveYear = link.taxYear ?? link.projectYear ?? link.docYear
      lines.push({ taxYear: effectiveYear, amount: link.amount, label: `${link.docType === 'invoice' ? 'INV' : 'QUO'}: ${link.docNo}` })
    })
    const linked = tx.paymentLinks.reduce((s, l) => s + l.amount, 0)
    const rem = tx.amount - linked
    if (rem > 0.5) {
      if ((tx as any).taxYearRemainder) {
        const r = (tx as any).taxYearRemainder
        lines.push({ taxYear: r.taxYear, amount: rem, label: r.note || 'Sisa manual' })
        return { lines, remainder: 0 }
      }
      return { lines, remainder: rem }
    }
    return { lines, remainder: 0 }
  }

  if (tx.invoicePayment) {
    // taxYear override manual lebih prioritas daripada invoiceYear
    const effectiveYear = (tx as any).taxYear ?? tx.invoicePayment.projectYear ?? tx.invoicePayment.invoiceYear
    lines.push({ taxYear: effectiveYear, amount: tx.amount, label: `INV: ${tx.invoicePayment.invoiceNo}` })
    return { lines, remainder: 0 }
  }

  if (tx.quotationPayment) {
    const effectiveYear = (tx as any).taxYear ?? tx.quotationPayment.projectYear ?? tx.quotationPayment.quotationYear
    lines.push({ taxYear: effectiveYear, amount: tx.amount, label: `QUO: ${tx.quotationPayment.quotationNo}` })
    return { lines, remainder: 0 }
  }

  lines.push({ taxYear: (tx as any).taxYear ?? fallbackYear, amount: tx.amount, label: 'Manual' })
  return { lines, remainder: 0 }
}

function escapeHtml(v: unknown) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function dateLabel(value: string) {
  const [y, m, d] = (value || '').split('-')
  if (!d) return value
  return `${d}/${m}/${y}`
}

// ── Component ─────────────────────────────────────────────────────────────────

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des']

export default function RekonsiliasiPage() {
  const YEARS = useYearList()
  const [year, setYear] = useState(() => getActiveYear())
  const [monthFilter, setMonthFilter] = useState<number>(0)
  const [accountFilter, setAccountFilter] = useState<string>('all')
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([])
  const [allMonths, setAllMonths] = useState<FinanceMonthData[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    import('@/lib/finance').then(({ fetchAccounts, accountDisplayName }) => {
      fetchAccounts().then(accs => {
        setAccounts(accs.filter(a => !a.isArchived).map(a => ({ id: a.id, name: accountDisplayName(a) })))
      })
    })
  }, [])

  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.all(MONTHS.map(m => fetchMonth(year, m.no))).then(data => {
      if (!alive) return
      setAllMonths(data)
      setLoading(false)
    })
    return () => { alive = false }
  }, [year])

  useEffect(() => {
    const handle = (e: Event) => {
      const y = (e as CustomEvent<number>).detail
      if (Number.isFinite(y) && y >= 2020 && y <= 2099) setYear(y)
    }
    window.addEventListener('financebub-year-change', handle as EventListener)
    return () => window.removeEventListener('financebub-year-change', handle as EventListener)
  }, [])

  // Filter bulan
  const filteredMonths = useMemo(() => {
    if (monthFilter === 0) return allMonths
    return [allMonths[monthFilter - 1]].filter(Boolean)
  }, [allMonths, monthFilter])

  // Hitung baris rekonsiliasi (income only, filter rekening)
  const rekonRows = useMemo((): RekonRow[] => {
    const rows: RekonRow[] = []
    filteredMonths.forEach(monthData => {
      monthData.transactions
        .filter(tx => tx.type === 'income' && (accountFilter === 'all' || tx.accountId === accountFilter))
        .forEach(tx => {
          const ltx = tx as LinkedTx
          const { lines, remainder } = getTaxLines(ltx, year)
          rows.push({
            date: tx.date,
            description: tx.description,
            category: tx.category,
            accountId: tx.accountId,
            totalAmount: tx.amount,
            taxLines: lines,
            remainder,
          })
        })
    })
    return rows.sort((a, b) => a.date.localeCompare(b.date))
  }, [filteredMonths, year, accountFilter])

  // Kumpulkan semua tahun pajak yang unik
  const uniqueTaxYears = useMemo(() => {
    const s = new Set<number>()
    rekonRows.forEach(row => row.taxLines.forEach(l => s.add(l.taxYear)))
    if (s.size === 0) s.add(year)
    return Array.from(s).sort((a, b) => a - b)
  }, [rekonRows, year])

  // Summary per tahun pajak
  const taxYearTotals = useMemo(() => {
    const map: Record<number, number> = {}
    rekonRows.forEach(row => row.taxLines.forEach(l => {
      map[l.taxYear] = (map[l.taxYear] || 0) + l.amount
    }))
    return map
  }, [rekonRows])

  const totalCashIn = rekonRows.reduce((s, r) => s + r.totalAmount, 0)
  const totalRemainder = rekonRows.reduce((s, r) => s + r.remainder, 0)
  const totalAllocated = totalCashIn - totalRemainder

  // ── Download PDF ──────────────────────────────────────────────────────────

  const downloadPdf = () => {
    const monthLabel = monthFilter === 0 ? `Tahun ${year}` : `${MONTH_NAMES[monthFilter - 1]} ${year}`

    const headerCols = uniqueTaxYears.map(y => `<th class="right">TH Pajak ${y}</th>`).join('')
    const rows = rekonRows.map((row, idx) => {
      const taxCells = uniqueTaxYears.map(ty => {
        const amt = row.taxLines.filter(l => l.taxYear === ty).reduce((s, l) => s + l.amount, 0)
        return `<td class="right ${amt > 0 ? 'has-val' : ''}">${amt > 0 ? 'Rp ' + rupiah(amt, 0) : '-'}</td>`
      }).join('')
      const remCell = row.remainder > 0.5 ? `<td class="right warn">Rp ${rupiah(row.remainder, 0)}</td>` : `<td class="right">-</td>`
      return `<tr class="${idx % 2 === 0 ? '' : 'alt'}">
        <td class="nowrap">${escapeHtml(dateLabel(row.date))}</td>
        <td>${escapeHtml(row.description)}</td>
        <td>${escapeHtml(row.category)}</td>
        <td class="right">Rp ${rupiah(row.totalAmount, 0)}</td>
        ${taxCells}
        ${remCell}
      </tr>`
    }).join('')

    const footerCols = uniqueTaxYears.map(ty => `<td class="right bold teal">Rp ${rupiah(taxYearTotals[ty] || 0, 0)}</td>`).join('')

    const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>Rekonsiliasi Pajak ${monthLabel}</title>
<style>
@page{size:A4 landscape;margin:10mm}
*{box-sizing:border-box}
body{font-family:Arial,sans-serif;font-size:10px;color:#0f172a;margin:0}
.header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1B8A7A;padding-bottom:12px;margin-bottom:14px}
.logo{width:40px;height:40px;border-radius:10px;background:#1B8A7A;color:white;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px}
.brand{display:flex;align-items:center;gap:10px}
h1{margin:0;font-size:18px;text-align:right}
h2{margin:0 0 2px;font-size:14px}
.meta{text-align:right;color:#475569;line-height:1.5}
.summary{display:flex;gap:10px;margin-bottom:12px}
.card{border:1px solid #dbe3ea;border-radius:8px;padding:8px 12px;flex:1}
.lbl{color:#64748b;font-size:8px;text-transform:uppercase;font-weight:700;margin-bottom:3px}
.amt{font-size:14px;font-weight:900}
.teal{color:#047857}
.warn{color:#d97706}
.red{color:#dc2626}
table{width:100%;border-collapse:collapse;font-size:9px}
th{background:#f8fafc;color:#64748b;text-transform:uppercase;font-size:8px;padding:6px 8px;border-bottom:2px solid #e5edf3;text-align:left}
td{padding:6px 8px;border-bottom:1px solid #f1f5f9;vertical-align:top}
.right{text-align:right;white-space:nowrap}
.nowrap{white-space:nowrap}
.alt td{background:#fafafa}
.bold{font-weight:800}
.has-val{font-weight:700}
.total-row td{font-weight:800;background:#f0fdf4;border-top:2px solid #1B8A7A}
.footer{margin-top:12px;color:#94a3b8;font-size:8px;display:flex;justify-content:space-between;border-top:1px solid #e5edf3;padding-top:6px}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
</head>
<body>
<div class="header">
  <div class="brand">
    <div class="logo">DK</div>
    <div><h2>FinanceBub</h2><div style="color:#64748b;font-size:10px">Rekonsiliasi Pajak Pemasukan</div></div>
  </div>
  <div>
    <h1>Rekonsiliasi Pajak</h1>
    <div class="meta">Periode: <strong>${escapeHtml(monthLabel)}</strong></div>
  </div>
</div>
<div class="summary">
  <div class="card"><div class="lbl">Total Kas Masuk</div><div class="amt">${rekonRows.length} transaksi · Rp ${rupiah(totalCashIn, 0)}</div></div>
  ${uniqueTaxYears.map(ty => `<div class="card"><div class="lbl">Tahun Pajak ${ty}</div><div class="amt teal">Rp ${rupiah(taxYearTotals[ty] || 0, 0)}</div></div>`).join('')}
  ${totalRemainder > 0.5 ? `<div class="card"><div class="lbl">Belum Dialokasikan</div><div class="amt warn">Rp ${rupiah(totalRemainder, 0)}</div></div>` : ''}
</div>
<table>
<thead><tr>
  <th>Tanggal</th><th>Keterangan</th><th>Kategori</th><th class="right">Total Masuk</th>
  ${headerCols}<th class="right">Sisa</th>
</tr></thead>
<tbody>${rows || '<tr><td colspan="10" style="text-align:center;padding:20px;color:#94a3b8">Tidak ada transaksi pemasukan.</td></tr>'}</tbody>
<tfoot><tr class="total-row">
  <td colspan="3" class="bold">TOTAL</td>
  <td class="right bold teal">Rp ${rupiah(totalCashIn, 0)}</td>
  ${footerCols}
  <td class="right ${totalRemainder > 0.5 ? 'warn' : ''} bold">${totalRemainder > 0.5 ? 'Rp ' + rupiah(totalRemainder, 0) : '-'}</td>
</tr></tfoot>
</table>
<div class="footer">
  <span>Generated by FinanceBub</span>
  <span>Dicetak: ${dateLabel(new Date().toISOString().slice(0, 10))}</span>
</div>
<script>window.onload=function(){setTimeout(function(){window.print()},250)}</script>
</body></html>`

    const win = window.open('', '_blank', 'width=1100,height=780')
    if (!win) return alert('Popup diblokir. Izinkan popup untuk download PDF.')
    win.document.open()
    win.document.write(html)
    win.document.close()
  }

  // ── Download Excel ────────────────────────────────────────────────────────

  const downloadExcel = async () => {
    const XLSX = await import('xlsx')
    const monthLabel = monthFilter === 0 ? `Tahun_${year}` : `${MONTH_NAMES[monthFilter - 1]}_${year}`

    const headers = ['Tanggal', 'Keterangan', 'Kategori', 'Total Masuk (Rp)',
      ...uniqueTaxYears.map(y => `TH Pajak ${y} (Rp)`),
      'Sisa Belum Dialokasikan (Rp)']

    const data = rekonRows.map(row => {
      const taxAmts = uniqueTaxYears.map(ty =>
        row.taxLines.filter(l => l.taxYear === ty).reduce((s, l) => s + l.amount, 0)
      )
      return [dateLabel(row.date), row.description, row.category, row.totalAmount, ...taxAmts, row.remainder > 0.5 ? row.remainder : 0]
    })

    // Total row
    const totalRow = ['TOTAL', '', '', totalCashIn,
      ...uniqueTaxYears.map(ty => taxYearTotals[ty] || 0),
      totalRemainder > 0.5 ? totalRemainder : 0]

    const wsData = [headers, ...data, [], totalRow]
    const ws = XLSX.utils.aoa_to_sheet(wsData)
    ws['!cols'] = [{ wch: 12 }, { wch: 50 }, { wch: 20 }, { wch: 18 },
      ...uniqueTaxYears.map(() => ({ wch: 18 })), { wch: 22 }]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, `Rekonsiliasi ${monthLabel}`)
    XLSX.writeFile(wb, `Rekonsiliasi_Pajak_${monthLabel}.xlsx`)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Rekonsiliasi Pajak</h1>
          <p className="text-sm text-gray-400 mt-0.5">Breakdown pemasukan kas per tahun pajak — {year}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <select value={year} onChange={e => { const y = Number(e.target.value); setYear(y); try { sessionStorage.setItem('financebub_active_year', String(y)); window.dispatchEvent(new CustomEvent('financebub-year-change', { detail: y })) } catch {} }} className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white outline-none focus:border-[#1B8A7A]">
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={monthFilter} onChange={e => setMonthFilter(Number(e.target.value))} className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white outline-none focus:border-[#1B8A7A]">
            <option value={0}>Semua Bulan</option>
            {MONTH_NAMES.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
          </select>
          <select value={accountFilter} onChange={e => setAccountFilter(e.target.value)} className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white outline-none focus:border-[#1B8A7A] max-w-[200px]">
            <option value="all">Semua Rekening</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <button onClick={downloadPdf} className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50">
            <Download className="w-4 h-4" /> PDF
          </button>
          <button onClick={downloadExcel} className="flex items-center gap-1.5 px-3 py-2 bg-[#1B8A7A] text-white rounded-lg text-sm hover:bg-[#0F6E56]">
            <FileSpreadsheet className="w-4 h-4" /> Excel
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 mb-5" style={{ gridTemplateColumns: `repeat(${Math.min(uniqueTaxYears.length + 2, 5)}, 1fr)` }}>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="text-xs text-gray-400">Total Kas Masuk</div>
          <div className="text-lg font-bold text-gray-900 mt-1">Rp {rupiah(totalCashIn, 2)}</div>
          <div className="text-xs text-gray-400 mt-0.5">{rekonRows.length} transaksi</div>
        </div>
        {uniqueTaxYears.map(ty => (
          <div key={ty} className="bg-white rounded-xl border border-gray-100 p-4">
            <div className="text-xs text-gray-400">Tahun Pajak {ty}</div>
            <div className="text-lg font-bold text-[#1B8A7A] mt-1">Rp {rupiah(taxYearTotals[ty] || 0, 2)}</div>
            <div className="text-xs text-gray-400 mt-0.5">{((taxYearTotals[ty] || 0) / (totalCashIn || 1) * 100).toFixed(1)}% dari total</div>
          </div>
        ))}
        {totalRemainder > 0.5 && (
          <div className="bg-amber-50 rounded-xl border border-amber-100 p-4">
            <div className="text-xs text-amber-600">Belum Dialokasikan</div>
            <div className="text-lg font-bold text-amber-700 mt-1">Rp {rupiah(totalRemainder, 2)}</div>
            <div className="text-xs text-amber-500 mt-0.5">Perlu ditetapkan tahun pajaknya</div>
          </div>
        )}
      </div>

      {/* Tabel */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs" style={{ minWidth: `${600 + uniqueTaxYears.length * 150}px` }}>
            <thead className="bg-gray-50 text-gray-400 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left w-24">Tanggal</th>
                <th className="px-4 py-3 text-left">Keterangan</th>
                <th className="px-4 py-3 text-left w-32">Kategori</th>
                <th className="px-4 py-3 text-right w-36">Total Masuk</th>
                {uniqueTaxYears.map(ty => (
                  <th key={ty} className="px-4 py-3 text-right w-36 text-[#0F6E56]">TH Pajak {ty}</th>
                ))}
                <th className="px-4 py-3 text-right w-32 text-amber-600">Sisa</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4 + uniqueTaxYears.length + 1} className="px-4 py-10 text-center text-gray-400">Memuat data...</td></tr>
              ) : rekonRows.length === 0 ? (
                <tr><td colSpan={4 + uniqueTaxYears.length + 1} className="px-4 py-10 text-center text-gray-400">Tidak ada transaksi pemasukan.</td></tr>
              ) : rekonRows.map((row, idx) => (
                <tr key={idx} className="border-t border-gray-50 hover:bg-gray-50/60">
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{dateLabel(row.date)}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-800 truncate max-w-xs">{row.description}</div>
                    {accountFilter === 'all' && (
                      <div className="text-[10px] text-gray-400 mt-0.5">{accounts.find(a => a.id === row.accountId)?.name || row.accountId}</div>
                    )}
                    {row.taxLines.length > 1 && (
                      <div className="mt-1 space-y-0.5">
                        {row.taxLines.map((l, i) => (
                          <div key={i} className="flex items-center gap-1.5">
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-teal-50 text-teal-700 font-semibold">TH {l.taxYear}</span>
                            <span className="text-[10px] text-gray-400">{l.label} · Rp {rupiah(l.amount, 0)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{row.category}</td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900">Rp {rupiah(row.totalAmount, 0)}</td>
                  {uniqueTaxYears.map(ty => {
                    const amt = row.taxLines.filter(l => l.taxYear === ty).reduce((s, l) => s + l.amount, 0)
                    return (
                      <td key={ty} className={`px-4 py-3 text-right ${amt > 0 ? 'font-semibold text-[#1B8A7A]' : 'text-gray-300'}`}>
                        {amt > 0 ? `Rp ${rupiah(amt, 0)}` : '—'}
                      </td>
                    )
                  })}
                  <td className={`px-4 py-3 text-right ${row.remainder > 0.5 ? 'font-semibold text-amber-600' : 'text-gray-300'}`}>
                    {row.remainder > 0.5 ? `Rp ${rupiah(row.remainder, 0)}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
            {rekonRows.length > 0 && (
              <tfoot className="border-t-2 border-gray-200 bg-gray-50">
                <tr>
                  <td colSpan={3} className="px-4 py-3 font-bold text-gray-900">TOTAL</td>
                  <td className="px-4 py-3 text-right font-bold text-gray-900">Rp {rupiah(totalCashIn, 0)}</td>
                  {uniqueTaxYears.map(ty => (
                    <td key={ty} className="px-4 py-3 text-right font-bold text-[#1B8A7A]">
                      Rp {rupiah(taxYearTotals[ty] || 0, 0)}
                    </td>
                  ))}
                  <td className={`px-4 py-3 text-right font-bold ${totalRemainder > 0.5 ? 'text-amber-600' : 'text-gray-400'}`}>
                    {totalRemainder > 0.5 ? `Rp ${rupiah(totalRemainder, 0)}` : '—'}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  )
}
