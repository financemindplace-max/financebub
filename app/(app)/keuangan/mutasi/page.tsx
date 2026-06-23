'use client'
import { useYearList, getActiveYear } from '@/lib/use-active-year'
import { useAuth } from '@/lib/auth-context'

import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import DateInput from '@/components/DateInput'
import { Plus, Trash2, Download, Save, WalletCards, Search, Upload, FileDown, Camera, Copy, Building2, Pencil, X, Check, Link } from 'lucide-react'
import {
  MONTHS,
  accountDisplayName,
  accountTypeLabel,
  calcAccountSummaries,
  emptyMonthData,
  fetchMonth,
  isAccountActive,
  makeId,
  mergeMonthOpeningBalances,
  monthKey,
  rupiah,
  saveAccounts,
  saveMonth,
  subscribeAccounts,
  subscribeMonth,
  toNumber,
  type AccountType,
  type FinanceAccount,
  type FinanceMonthData,
  type FinanceTransaction,
  type TxType,
} from '@/lib/finance'
import {
  buildInvoicePaymentMeta,
  buildQuotationPaymentMeta,
  fetchPayableDocsAcrossYears,
  getInvoicePayments,
  getQuotationPayments,
  removeInvoicePayment,
  removeQuotationPayment,
  upsertInvoicePayment,
  upsertQuotationPayment,
  type InvoicePaymentMeta,
  type QuotationPaymentMeta,
  type SearchableDoc,
} from '@/lib/invoice-payment-link'

const ACCOUNT_TYPES: AccountType[] = ['cash', 'bank', 'ewallet', 'other']

type CsvRow = Record<string, string>

interface PaymentLinkItem {
  docType: 'invoice' | 'quotation'
  docNo: string
  docId: number
  docYear: number
  projectYear?: number
  taxYear?: number
  client: string
  brand: string
  item: string
  total: number
  amount: number
}

type TaxYearTarget = 'paymentLink' | 'invoicePayment' | 'quotationPayment'

interface TaxYearLine {
  taxYear: number
  automaticTaxYear: number
  amount: number
  source: 'link' | 'manual' | 'remainder'
  label: string
  target?: TaxYearTarget
  linkIndex?: number
  isManualOverride?: boolean
}

function getTaxYearBreakdown(tx: LinkedFinanceTransaction, fallbackYear: number): { lines: TaxYearLine[]; remainder: number } {
  const lines: TaxYearLine[] = []

  if (tx.paymentLinks && tx.paymentLinks.length > 0) {
    tx.paymentLinks.forEach((link, linkIndex) => {
      const automaticTaxYear = link.projectYear ?? link.docYear
      lines.push({
        taxYear: link.taxYear ?? automaticTaxYear,
        automaticTaxYear,
        amount: link.amount,
        source: 'link',
        label: `${link.docType === 'invoice' ? 'INV' : 'QUO'}: ${link.docNo}`,
        target: 'paymentLink',
        linkIndex,
        isManualOverride: link.taxYear !== undefined,
      })
    })
    const linked = tx.paymentLinks.reduce((s, l) => s + l.amount, 0)
    const rem = tx.amount - linked
    if (rem > 0.5) {
      if (tx.taxYearRemainder) {
        lines.push({ taxYear: tx.taxYearRemainder.taxYear, automaticTaxYear: tx.taxYearRemainder.taxYear, amount: rem, source: 'remainder', label: tx.taxYearRemainder.note || 'Sisa manual' })
        return { lines, remainder: 0 }
      }
      return { lines, remainder: rem }
    }
    return { lines, remainder: 0 }
  }

  if (tx.invoicePayment) {
    const automaticTaxYear = tx.invoicePayment.projectYear ?? tx.invoicePayment.invoiceYear
    lines.push({
      taxYear: tx.taxYear ?? automaticTaxYear,
      automaticTaxYear,
      amount: tx.amount,
      source: 'link',
      label: `INV: ${tx.invoicePayment.invoiceNo}`,
      target: 'invoicePayment',
      isManualOverride: tx.taxYear !== undefined,
    })
    return { lines, remainder: 0 }
  }

  if (tx.quotationPayment) {
    const automaticTaxYear = tx.quotationPayment.projectYear ?? tx.quotationPayment.quotationYear
    lines.push({
      taxYear: tx.taxYear ?? automaticTaxYear,
      automaticTaxYear,
      amount: tx.amount,
      source: 'link',
      label: `QUO: ${tx.quotationPayment.quotationNo}`,
      target: 'quotationPayment',
      isManualOverride: tx.taxYear !== undefined,
    })
    return { lines, remainder: 0 }
  }

  // Tidak ter-link — pakai taxYear manual atau fallback
  lines.push({ taxYear: tx.taxYear ?? fallbackYear, automaticTaxYear: fallbackYear, amount: tx.amount, source: 'manual', label: 'Manual', isManualOverride: tx.taxYear !== undefined })
  return { lines, remainder: 0 }
}

type LinkedFinanceTransaction = FinanceTransaction & {
  invoicePayment?: InvoicePaymentMeta
  quotationPayment?: QuotationPaymentMeta
  paymentLinks?: PaymentLinkItem[]
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function monthName(no: number) {
  return MONTHS.find(m => m.no === no)?.name || String(no)
}


function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function fileSafe(value: string) {
  return String(value || 'Mutasi Rekening')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function dateLabel(value: string) {
  if (!value) return '-'
  const [y, m, d] = value.split('-')
  if (!y || !m || !d) return value
  return `${d}/${m}/${y}`
}

function shortAccountLabel(account: FinanceAccount) {
  const bankLine = [account.bankName, account.accountNumber].filter(Boolean).join(' ')
  return [account.companyName, bankLine].filter(Boolean).join(' - ') || account.name || 'Rekening'
}

function parseMonth(value: string) {
  const raw = String(value || '').trim().toLowerCase()
  const asNum = Number(raw)
  if (asNum >= 1 && asNum <= 12) return asNum
  const found = MONTHS.find(m => m.name.toLowerCase() === raw || m.short.toLowerCase() === raw)
  return found?.no || 0
}

function splitCsvLine(line: string) {
  const cells: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    const next = line[i + 1]
    if (ch === '"' && quoted && next === '"') {
      cur += '"'
      i += 1
    } else if (ch === '"') {
      quoted = !quoted
    } else if (ch === ',' && !quoted) {
      cells.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  cells.push(cur.trim())
  return cells
}

function parseCsv(text: string): CsvRow[] {
  const lines = text.replace(/\r/g, '').split('\n').filter(line => line.trim())
  if (lines.length < 2) return []
  const header = splitCsvLine(lines[0]).map(h => h.trim().toLowerCase())
  return lines.slice(1).map(line => {
    const cells = splitCsvLine(line)
    const row: CsvRow = {}
    header.forEach((key, idx) => { row[key] = cells[idx] || '' })
    return row
  })
}

function downloadCsvTemplate() {
  const header = ['TAHUN','BULAN','NAMA PT','BANK','NO REKENING','JENIS','TANGGAL','KETERANGAN','NOMINAL','KATEGORI','SALDO AWAL']
  const sample = [
    ['2026','Maret','PT FinanceBub MEDIA KREATIF','BCA','6270344940','MASUK','2026-03-02','Project brand / pembayaran invoice','50000000','Pendapatan Jasa','1121453564'],
    ['2026','Maret','PT FinanceBub MEDIA KREATIF','BCA','6270344940','KELUAR','2026-03-05','Bayar biaya produksi','1300000','HPP / Biaya Produksi',''],
    ['2026','Maret','PT FinanceBub MEDIA SEJAHTERA','BNI','3000009091','KELUAR','2026-03-10','Transport team','500000','Transport',''],
  ]
  const csv = [header, ...sample].map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'Template_Import_Mutasi_FinanceBub.csv'
  a.click()
  URL.revokeObjectURL(url)
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export default function MutasiPage() {
  const { user } = useAuth()
  const YEARS = useYearList()
  const now = new Date()
  const [year, setYearRaw] = useState(() => getActiveYear())
  const [month, setMonth] = useState(now.getMonth() + 1)

  const setYear = (y: number) => {
    setYearRaw(y)
    try {
      localStorage.setItem('financebub_active_year', String(y))
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
  const [monthData, setMonthData] = useState<FinanceMonthData>(emptyMonthData(now.getFullYear(), now.getMonth() + 1))
  const [selectedAccount, setSelectedAccount] = useState('all')
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [viewMode, setViewMode] = useState<'overview' | 'sheet'>('overview')
  const [newAccount, setNewAccount] = useState({
    companyName: '', bankName: '', accountNumber: '', name: '', type: 'bank' as AccountType, opening: '',
  })
  const [editingAccount, setEditingAccount] = useState<string | null>(null)
  const [editAccountData, setEditAccountData] = useState<{ companyName: string; bankName: string; accountNumber: string; name: string; opening: string }>({ companyName: '', bankName: '', accountNumber: '', name: '', opening: '' })
  const [txForm, setTxForm] = useState({
    date: todayISO(), type: 'income' as TxType, accountId: '', description: '', category: '', amount: '',
  })
  const [docOptions, setDocOptions] = useState<SearchableDoc[]>([])
  const [docLoading, setDocLoading] = useState(false)
  const [docSearch, setDocSearch] = useState('')
  const [selectedDoc, setSelectedDoc] = useState<SearchableDoc | null>(null)
  const [linkingTx, setLinkingTx] = useState<LinkedFinanceTransaction | null>(null)
  const [linkSearch, setLinkSearch] = useState('')
  const [linkItems, setLinkItems] = useState<{ doc: SearchableDoc; amount: string }[]>([])
  const [showAddAccountModal, setShowAddAccountModal] = useState(false)
  const [editingTaxYearKey, setEditingTaxYearKey] = useState('')
  const autoFilledRef = useRef<string>('')
  const repairedLinkScopesRef = useRef<Set<string>>(new Set())
  const [focusTxId, setFocusTxId] = useState('')
  const focusScrolledRef = useRef<string>('')

  // Dukungan tautan langsung dari Akumulasi/Status Brand ke satu transaksi.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const txId = String(params.get('tx') || '').trim()
    if (!txId) return
    const queryYear = Number(params.get('year'))
    const queryMonth = Number(params.get('month'))
    const accountId = String(params.get('account') || '').trim()
    if (queryYear >= 2020 && queryYear <= 2099) setYearRaw(queryYear)
    if (queryMonth >= 1 && queryMonth <= 12) setMonth(queryMonth)
    if (accountId) setSelectedAccount(accountId)
    setFocusTxId(txId)
    setSearch(txId)
  }, [])

  useEffect(() => subscribeAccounts(setAccounts), [])

  useEffect(() => {
    let alive = true
    setDocLoading(true)
    fetchPayableDocsAcrossYears([year])
      .then(data => { if (alive) setDocOptions(data) })
      .finally(() => { if (alive) setDocLoading(false) })
    return () => { alive = false }
  }, [year])

  useEffect(() => {
    const unsub = subscribeMonth(year, month, setMonthData)
    return unsub
  }, [year, month])

  useEffect(() => {
    if (!focusTxId) return
    const transaction = monthData.transactions.find(item => item.id === focusTxId)
    if (!transaction) return
    if (selectedAccount !== transaction.accountId) setSelectedAccount(transaction.accountId)
    if (viewMode !== 'sheet') setViewMode('sheet')
    if (focusScrolledRef.current === focusTxId) return
    focusScrolledRef.current = focusTxId
    window.setTimeout(() => {
      document.getElementById(`mutasi-${focusTxId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 150)
  }, [focusTxId, monthData.transactions, selectedAccount, viewMode])

  const activeAccounts = useMemo(
    () => accounts.filter(account => isAccountActive(account, year, month)),
    [accounts, year, month]
  )

  // Auto-isi Saldo Awal dari saldo akhir bulan sebelumnya jika bulan ini belum ada data saldo.
  // Catatan penting:
  // Jangan saveMonth({ ...monthData, ... }) dari efek async ini.
  // Kalau user menambah transaksi saat fetch saldo sebelumnya masih berjalan,
  // state lama bisa menimpa transaksi baru di Firebase.
  useEffect(() => {
    const key = `${year}-${month}`
    if (autoFilledRef.current === key) return
    if (activeAccounts.length === 0) return

    // Cari rekening yang belum punya saldo awal sama sekali (key tidak ada di openingBalances)
    const missingAccounts = activeAccounts.filter(a =>
      monthData.openingBalances?.[a.id] === undefined || monthData.openingBalances?.[a.id] === null
    )

    if (missingAccounts.length === 0) {
      autoFilledRef.current = key
      return
    }

    let cancelled = false
    autoFilledRef.current = key
    const prevMonth = month === 1 ? 12 : month - 1
    const prevYear = month === 1 ? year - 1 : year

    fetchMonth(prevYear, prevMonth).then(async prevData => {
      if (cancelled) return
      const prevSummaries = calcAccountSummaries(missingAccounts, prevData)
      const newBalances: Record<string, number> = {}
      prevSummaries.forEach(s => { if (s.balance !== 0) newBalances[s.account.id] = s.balance })
      if (Object.keys(newBalances).length === 0) return

      setMonthData(current => {
        if (current.year !== year || current.month !== month) return current
        return { ...current, openingBalances: { ...(current.openingBalances || {}), ...newBalances } }
      })

      try {
        await mergeMonthOpeningBalances(year, month, newBalances)
      } catch {
        // Jangan ganggu input transaksi user hanya karena auto saldo awal gagal.
      }
    })

    return () => { cancelled = true }
  }, [monthData.openingBalances, activeAccounts, year, month])

  useEffect(() => {
    const stillActive = activeAccounts.some(account => account.id === txForm.accountId)
    if (!stillActive) setTxForm(form => ({ ...form, accountId: activeAccounts[0]?.id || '' }))
  }, [activeAccounts, txForm.accountId])

  const selectedAccountData = useMemo(() => activeAccounts.find(a => a.id === selectedAccount) || null, [activeAccounts, selectedAccount])
  const summaries = useMemo(() => calcAccountSummaries(activeAccounts, monthData), [activeAccounts, monthData])
  const totalOpening = summaries.reduce((sum, item) => sum + item.opening, 0)
  const totalIncome = summaries.reduce((sum, item) => sum + item.income, 0)
  const totalExpense = summaries.reduce((sum, item) => sum + item.expense, 0)
  const totalClosing = summaries.reduce((sum, item) => sum + item.balance, 0)

  const monthHasData = useMemo(() => MONTHS.map(item => ({
    ...item,
    hasData: item.no === month ? monthData.transactions.length > 0 || Object.keys(monthData.openingBalances || {}).length > 0 : false,
  })), [month, monthData])

  const categories = useMemo(() => {
    const fromTx = monthData.transactions.map(t => t.category).filter(Boolean)
    return Array.from(new Set([...(monthData.categories || []), ...fromTx])).sort((a, b) => a.localeCompare(b, 'id'))
  }, [monthData])

  const visibleTransactions = useMemo(() => {
    const keyword = search.toLowerCase()
    return monthData.transactions
      .filter(tx => selectedAccount === 'all' || tx.accountId === selectedAccount)
      .filter(tx => !keyword ||
        tx.id.toLowerCase().includes(keyword) ||
        tx.description.toLowerCase().includes(keyword) ||
        tx.category.toLowerCase().includes(keyword) ||
        (accountDisplayName(activeAccounts.find(a => a.id === tx.accountId))).toLowerCase().includes(keyword)
      )
      .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
  }, [activeAccounts, monthData.transactions, search, selectedAccount])

  const docMatches = useMemo(() => {
    const q = docSearch.trim().toLowerCase()
    if (!q) return []
    return docOptions.filter(d => d.searchText.includes(q)).slice(0, 50)
  }, [docOptions, docSearch])

  const linkMatches = useMemo(() => {
    const q = linkSearch.trim().toLowerCase()
    if (!q) return []
    return docOptions.filter(d => d.searchText.includes(q)).slice(0, 50)
  }, [docOptions, linkSearch])

  const incomeRows = visibleTransactions.filter(tx => tx.type === 'income')
  const expenseRows = visibleTransactions.filter(tx => tx.type === 'expense')
  const currentMonthName = monthName(month)

  const accountTransactionsForPdf = (accountId: string) => monthData.transactions
    .filter(tx => tx.accountId === accountId)
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))

  const downloadAccountPdf = (accountId?: string) => {
    const targetId = accountId || (selectedAccount !== 'all' ? selectedAccount : '')
    const account = accounts.find(item => item.id === targetId)
    if (!account) {
      alert('Pilih salah satu rekening dulu, lalu klik Download PDF.')
      return
    }
    const summary = calcAccountSummaries([account], monthData)[0]
    if (!summary) return alert('Ringkasan rekening tidak ditemukan.')

    const txs = accountTransactionsForPdf(account.id)
    const income = txs.filter(tx => tx.type === 'income')
    const expense = txs.filter(tx => tx.type === 'expense')
    const fileTitle = fileSafe(`Mutasi ${shortAccountLabel(account)} ${currentMonthName} ${year}`)
    const renderRows = (rows: FinanceTransaction[], emptyText: string) => rows.length
      ? rows.map((tx, index) => `
          <tr>
            <td class="center">${index + 1}</td>
            <td>${escapeHtml(dateLabel(tx.date))}</td>
            <td>
              <strong>${escapeHtml(tx.description)}</strong>
              ${tx.category ? `<div class="muted small">${escapeHtml(tx.category)}</div>` : ''}
            </td>
            <td class="right ${tx.type === 'income' ? 'income' : 'expense'}">${tx.type === 'income' ? '+' : '-'} Rp ${rupiah(tx.amount, 2)}</td>
          </tr>`).join('')
      : `<tr><td colspan="4" class="empty">${escapeHtml(emptyText)}</td></tr>`

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(fileTitle)}</title>
  <style>
    @page { size: A4 portrait; margin: 12mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; margin: 0; background: #fff; font-size: 11px; }
    .page { width: 100%; }
    .header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; border-bottom: 3px solid #1B8A7A; padding-bottom: 14px; margin-bottom: 16px; }
    .brand { display: flex; align-items: center; gap: 10px; }
    .logo { width: 44px; height: 44px; border-radius: 12px; background: #1B8A7A; color: white; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 16px; }
    h1 { margin: 0; font-size: 22px; letter-spacing: .08em; text-align: right; }
    h2 { margin: 0 0 3px; font-size: 15px; }
    .subtitle { color: #64748b; margin-top: 3px; }
    .meta { text-align: right; color: #475569; line-height: 1.55; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 10px; }
    .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 14px; }
    .card { border: 1px solid #dbe3ea; border-radius: 12px; padding: 10px; min-height: 58px; }
    .label { color: #64748b; font-size: 9px; text-transform: uppercase; letter-spacing: .05em; font-weight: 700; margin-bottom: 5px; }
    .value { font-size: 13px; font-weight: 800; line-height: 1.35; }
    .amount { font-size: 16px; font-weight: 900; }
    .closing { background: #e1f5ee; border-color: #a7ead9; }
    .income { color: #047857; }
    .expense { color: #dc2626; }
    .section { margin-top: 14px; border: 1px solid #dbe3ea; border-radius: 12px; overflow: hidden; break-inside: avoid; }
    .section-title { padding: 9px 11px; font-weight: 900; text-transform: uppercase; border-bottom: 1px solid #e5edf3; background: #f8fafc; letter-spacing: .04em; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #f8fafc; color: #64748b; text-transform: uppercase; font-size: 9px; letter-spacing: .04em; text-align: left; padding: 8px 9px; border-bottom: 1px solid #e5edf3; }
    td { padding: 8px 9px; border-bottom: 1px solid #edf2f7; vertical-align: top; }
    tr:last-child td { border-bottom: 0; }
    .right { text-align: right; white-space: nowrap; font-weight: 800; }
    .center { text-align: center; width: 32px; color: #64748b; }
    .small { font-size: 9px; }
    .muted { color: #64748b; }
    .empty { text-align: center; padding: 20px; color: #94a3b8; }
    .footer { margin-top: 16px; color: #94a3b8; font-size: 9px; display: flex; justify-content: space-between; border-top: 1px solid #e5edf3; padding-top: 8px; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="brand">
        <div class="logo">DK</div>
        <div>
          <h2>FinanceBub</h2>
          <div class="subtitle">Laporan mutasi kas/bank per rekening</div>
        </div>
      </div>
      <div>
        <h1>MUTASI REKENING</h1>
        <div class="meta">
          Periode: <strong>${escapeHtml(currentMonthName)} ${year}</strong><br />
          Dicetak: ${escapeHtml(dateLabel(todayISO()))}
        </div>
      </div>
    </div>

    <div class="grid">
      <div class="card"><div class="label">Nama PT / Entitas</div><div class="value">${escapeHtml(account.companyName || '-')}</div></div>
      <div class="card"><div class="label">Bank / E-Wallet</div><div class="value">${escapeHtml(account.bankName || accountTypeLabel(account.type))}</div></div>
      <div class="card"><div class="label">No Rekening</div><div class="value">${escapeHtml(account.accountNumber || '-')}</div></div>
    </div>

    <div class="summary">
      <div class="card"><div class="label">Saldo Awal</div><div class="amount">Rp ${rupiah(summary.opening, 2)}</div></div>
      <div class="card"><div class="label">Pemasukan</div><div class="amount income">Rp ${rupiah(summary.income, 2)}</div></div>
      <div class="card"><div class="label">Pengeluaran</div><div class="amount expense">Rp ${rupiah(summary.expense, 2)}</div></div>
      <div class="card closing"><div class="label">Saldo Akhir</div><div class="amount income">Rp ${rupiah(summary.balance, 2)}</div></div>
    </div>

    <div class="section">
      <div class="section-title income">Pemasukan</div>
      <table>
        <thead><tr><th>No</th><th>Tanggal</th><th>Keterangan</th><th class="right">Nominal</th></tr></thead>
        <tbody>${renderRows(income, 'Tidak ada pemasukan pada rekening ini.')}</tbody>
      </table>
    </div>

    <div class="section">
      <div class="section-title expense">Pengeluaran</div>
      <table>
        <thead><tr><th>No</th><th>Tanggal</th><th>Keterangan</th><th class="right">Nominal</th></tr></thead>
        <tbody>${renderRows(expense, 'Tidak ada pengeluaran pada rekening ini.')}</tbody>
      </table>
    </div>

    <div class="section">
      <div class="section-title">Daftar Mutasi Gabungan</div>
      <table>
        <thead><tr><th>No</th><th>Tanggal</th><th>Keterangan</th><th class="right">Nominal</th></tr></thead>
        <tbody>${renderRows(txs, 'Tidak ada transaksi pada rekening ini.')}</tbody>
      </table>
    </div>

    <div class="footer">
      <span>Generated by FinanceBub</span>
      <span>${escapeHtml(fileTitle)}.pdf</span>
    </div>
  </div>
  <script>
    window.onload = function () {
      setTimeout(function () { window.print(); }, 250);
    };
  </script>
</body>
</html>`

    const printWindow = window.open('', '_blank', 'width=980,height=720')
    if (!printWindow) return alert('Popup diblokir browser. Izinkan popup untuk download PDF mutasi rekening.')
    printWindow.document.open()
    printWindow.document.write(html)
    printWindow.document.close()
  }

  const updateMonth = async (updater: (data: FinanceMonthData) => FinanceMonthData) => {
    const next = updater(monthData)
    setMonthData(next)
    setSaving(true)
    try { await saveMonth(next) } finally { setSaving(false) }
  }

  // Sinkronkan tahun pajak link lama dengan field `project-year` pada
  // Invoice/Quotation. `docYear` hanya tahun penyimpanan/terbit dokumen.
  useEffect(() => {
    if (docLoading || docOptions.length === 0) return

    const resolveDoc = (params: {
      docType: 'invoice' | 'quotation'
      docNo: string
      docId?: number
      docYear?: number
    }) => docOptions.find(doc =>
      doc.docType === params.docType &&
      doc.docNo === params.docNo &&
      (params.docId === undefined || doc.doc.id === params.docId) &&
      (params.docYear === undefined || doc.year === params.docYear)
    ) || docOptions.find(doc => doc.docType === params.docType && doc.docNo === params.docNo)

    let changed = false
    const transactions = monthData.transactions.map(rawTx => {
      const tx = rawTx as LinkedFinanceTransaction
      let nextTx: LinkedFinanceTransaction = tx

      if (tx.paymentLinks?.length) {
        const paymentLinks = tx.paymentLinks.map(link => {
          const doc = resolveDoc({ docType: link.docType, docNo: link.docNo, docId: link.docId, docYear: link.docYear })
          const projectYear = doc?.projectYear
          if (!projectYear || link.projectYear === projectYear) return link
          changed = true
          return { ...link, projectYear }
        })
        if (paymentLinks.some((link, index) => link !== tx.paymentLinks?.[index])) {
          nextTx = { ...nextTx, paymentLinks }
        }
      }

      if (tx.invoicePayment) {
        const doc = resolveDoc({
          docType: 'invoice',
          docNo: tx.invoicePayment.invoiceNo,
          docId: tx.invoicePayment.invoiceId,
          docYear: tx.invoicePayment.invoiceYear,
        })
        if (doc?.projectYear && tx.invoicePayment.projectYear !== doc.projectYear) {
          changed = true
          nextTx = { ...nextTx, invoicePayment: { ...tx.invoicePayment, projectYear: doc.projectYear } }
        }
      }

      if (tx.quotationPayment) {
        const doc = resolveDoc({
          docType: 'quotation',
          docNo: tx.quotationPayment.quotationNo,
          docId: tx.quotationPayment.quotationId,
          docYear: tx.quotationPayment.quotationYear,
        })
        if (doc?.projectYear && tx.quotationPayment.projectYear !== doc.projectYear) {
          changed = true
          nextTx = { ...nextTx, quotationPayment: { ...tx.quotationPayment, projectYear: doc.projectYear } }
        }
      }

      return nextTx
    })

    if (!changed) return
    const next = { ...monthData, transactions }
    setMonthData(next)
    setSaving(true)
    void saveMonth(next).finally(() => setSaving(false))
  }, [docLoading, docOptions, monthData])

  const handleAddAccount = async () => {
    const companyName = newAccount.companyName.trim()
    const bankName = newAccount.bankName.trim()
    const accountNumber = newAccount.accountNumber.trim()
    const customName = newAccount.name.trim()
    if (!companyName && !customName) return alert('Isi Nama PT atau Nama Akun')
    if (newAccount.type === 'bank' && (!bankName || !accountNumber)) return alert('Untuk rekening bank, isi Bank dan Nomor Rekening')

    const duplicate = accounts.find(a =>
      (a.companyName || '').toLowerCase() === companyName.toLowerCase() &&
      (a.bankName || '').toLowerCase() === bankName.toLowerCase() &&
      (a.accountNumber || '') === accountNumber && !a.isArchived
    )
    if (duplicate && !confirm('Rekening ini terlihat sudah ada. Tetap tambahkan ke bulan ini?')) return

    const generatedName = customName || [companyName, [bankName, accountNumber].filter(Boolean).join(' ')].filter(Boolean).join(' · ')
    const account: FinanceAccount = {
      id: makeId('acc'), name: generatedName, type: newAccount.type,
      companyName, bankName, accountNumber,
      activeFrom: monthKey(year, month), createdAt: new Date().toISOString(),
    }
    const nextAccounts = [...accounts, account]
    setAccounts(nextAccounts)
    await saveAccounts(nextAccounts)
    await updateMonth(data => ({ ...data, openingBalances: { ...data.openingBalances, [account.id]: toNumber(newAccount.opening) } }))
    setNewAccount({ companyName: '', bankName: '', accountNumber: '', name: '', type: 'bank', opening: '' })
    setSelectedAccount(account.id)
    setViewMode('sheet')
    setTxForm(form => ({ ...form, accountId: account.id }))
    setShowAddAccountModal(false)
  }

  const handleArchiveAccount = async (accountId: string) => {
    const account = accounts.find(a => a.id === accountId)
    if (!account || !confirm(`Arsipkan rekening ${accountDisplayName(account)}? Data bulan lama tetap aman.`)) return
    const next = accounts.map(a => a.id === accountId ? { ...a, isArchived: true } : a)
    setAccounts(next)
    await saveAccounts(next)
    setSelectedAccount('all')
  }

  const handleDeleteAccount = async (accountId: string) => {
    const account = accounts.find(a => a.id === accountId)
    if (!account) return
    const txCount = monthData.transactions.filter(t => t.accountId === accountId).length
    const msg = txCount > 0
      ? `Hapus permanen rekening ${accountDisplayName(account)}?\n\nAda ${txCount} transaksi di bulan ini yang akan IKUT TERHAPUS. Ini tidak bisa dibatalkan.`
      : `Hapus permanen rekening ${accountDisplayName(account)}? Ini tidak bisa dibatalkan.`
    if (!confirm(msg)) return
    const next = accounts.filter(a => a.id !== accountId)
    setAccounts(next)
    await saveAccounts(next)
    await updateMonth(data => ({
      ...data,
      transactions: data.transactions.filter(t => t.accountId !== accountId),
      openingBalances: Object.fromEntries(Object.entries(data.openingBalances || {}).filter(([k]) => k !== accountId)),
    }))
    if (selectedAccount === accountId) setSelectedAccount('all')
  }

  const startEditAccount = (accountId: string) => {
    const account = accounts.find(a => a.id === accountId)
    if (!account) return
    setEditingAccount(accountId)
    const currentOpening = monthData.openingBalances?.[accountId] ?? 0
    setEditAccountData({
      companyName: account.companyName || '',
      bankName: account.bankName || '',
      accountNumber: account.accountNumber || '',
      name: account.name || '',
      opening: currentOpening !== 0 ? String(currentOpening) : '',
    })
  }

  const saveEditAccount = async (accountId: string) => {
    const companyName = editAccountData.companyName.trim()
    const bankName = editAccountData.bankName.trim()
    const accountNumber = editAccountData.accountNumber.trim()
    const customName = editAccountData.name.trim()
    if (!companyName && !customName) return alert('Isi Nama PT atau Nama Akun')
    const generatedName = customName || [companyName, [bankName, accountNumber].filter(Boolean).join(' ')].filter(Boolean).join(' · ')
    const next = accounts.map(a => a.id === accountId
      ? { ...a, companyName, bankName, accountNumber, name: generatedName }
      : a
    )
    setAccounts(next)
    await saveAccounts(next)
    if (editAccountData.opening.trim() !== '') {
      await handleOpeningChange(accountId, editAccountData.opening)
    }
    setEditingAccount(null)
  }

  const handleOpeningChange = async (accountId: string, value: string) => {
    await updateMonth(data => ({ ...data, openingBalances: { ...data.openingBalances, [accountId]: toNumber(value) } }))
  }

  const copyPreviousClosing = async (accountId: string) => {
    const prevMonth = month === 1 ? 12 : month - 1
    const prevYear = month === 1 ? year - 1 : year
    const prevData = await fetchMonth(prevYear, prevMonth)
    const prevSummary = calcAccountSummaries(accounts.filter(a => a.id === accountId), prevData)[0]
    if (!prevSummary) return alert('Rekening ini belum ada di bulan sebelumnya')
    await handleOpeningChange(accountId, String(prevSummary.balance))
  }

  const getAccountLabel = (accountId: string) => accountDisplayName(accounts.find(account => account.id === accountId))

  const handleSelectDoc = (doc: SearchableDoc) => {
    const amount = Math.max(0, Math.round(doc.remaining || doc.total || 0))
    const docNo = doc.docType === 'invoice' ? (doc as any).invoiceNo : (doc as any).quotationNo
    const desc = `Pembayaran ${docNo} - ${doc.client}${doc.brand ? ` - ${doc.brand}` : ''}${doc.item ? ` - ${doc.item}` : ''}`
    setSelectedDoc(doc)
    setDocSearch(`${docNo} · ${doc.client}`)
    setTxForm(form => ({
      ...form,
      type: 'income',
      description: desc,
      category: 'Pembayaran Invoice',
      amount: amount ? String(amount) : String(Math.round(doc.total || 0)),
    }))
  }

  const clearSelectedDoc = () => {
    setSelectedDoc(null)
    setDocSearch('')
  }

  const handleAddTransaction = async () => {
    if (!txForm.accountId) return alert('Pilih akun kas/bank dulu')
    if (!txForm.description.trim()) return alert('Keterangan wajib diisi')
    if (!txForm.category.trim()) return alert('Kategori wajib diisi')
    const amount = toNumber(txForm.amount)
    if (amount <= 0) return alert('Nominal harus lebih dari 0')
    if (selectedDoc && txForm.type !== 'income') return alert('Pembayaran invoice/quotation harus memakai jenis Pemasukan')

    if (selectedDoc && amount > selectedDoc.remaining + 1) {
      const ok = confirm(`Nominal pembayaran lebih besar dari sisa.\n\nSisa: Rp ${rupiah(selectedDoc.remaining, 0)}\nNominal input: Rp ${rupiah(amount, 0)}\n\nTetap simpan?`)
      if (!ok) return
    }

    const txId = makeId('tx')
    const invoicePayment = selectedDoc?.docType === 'invoice' ? buildInvoicePaymentMeta(selectedDoc as any) : undefined
    const quotationPayment = selectedDoc?.docType === 'quotation' ? buildQuotationPaymentMeta(selectedDoc as any) : undefined
    const tx: LinkedFinanceTransaction = {
      id: txId, date: txForm.date || todayISO(), type: txForm.type,
      accountId: txForm.accountId, description: txForm.description.trim(),
      category: txForm.category.trim(), amount, createdAt: new Date().toISOString(),
      createdBy: user ? { uid: user.uid, name: user.name } : undefined,
      ...(invoicePayment ? { invoicePayment } : {}),
      ...(quotationPayment ? { quotationPayment } : {}),
    }

    const [txYear, txMonth] = (tx.date || todayISO()).split('-').map(Number)
    const sameMonthView = txYear === year && txMonth === month
    if (sameMonthView) {
      await updateMonth(data => ({ ...data, transactions: [...data.transactions, tx], categories: Array.from(new Set([...(data.categories || []), tx.category])) }))
    } else {
      setSaving(true)
      try {
        const target = await fetchMonth(txYear, txMonth)
        await saveMonth({ ...target, transactions: [...target.transactions, tx], categories: Array.from(new Set([...(target.categories || []), tx.category])) })
      } finally { setSaving(false) }
      if (txYear !== year) setYear(txYear)
      if (txMonth !== month) setMonth(txMonth)
    }

    if (selectedDoc) {
      try {
        if (selectedDoc.docType === 'invoice') {
          await upsertInvoicePayment({ invoiceYear: selectedDoc.year, invoiceId: selectedDoc.doc.id, txId, date: tx.date, amount: tx.amount, accountId: tx.accountId, accountLabel: getAccountLabel(tx.accountId), note: tx.description })
        } else {
          await upsertQuotationPayment({ quotationYear: selectedDoc.year, quotationId: selectedDoc.doc.id, txId, date: tx.date, amount: tx.amount, accountId: tx.accountId, accountLabel: getAccountLabel(tx.accountId), note: tx.description })
        }
        const refreshed = await fetchPayableDocsAcrossYears([year])
        setDocOptions(refreshed)
        clearSelectedDoc()
      } catch (error) {
        alert(error instanceof Error ? `Transaksi tersimpan, tapi dokumen gagal diupdate: ${error.message}` : 'Transaksi tersimpan, tapi dokumen gagal diupdate.')
      }
    }
    setTxForm(form => ({ ...form, description: '', amount: '', category: selectedDoc ? 'Pembayaran Invoice' : tx.category }))
  }

  const docOptionKey = (doc: SearchableDoc) =>
    `${doc.docType}|${doc.year}|${doc.doc.id}|${doc.docNo}`

  const paymentLinkKey = (link: PaymentLinkItem) =>
    `${link.docType}|${link.docYear}|${link.docId}|${link.docNo}`

  const documentHasTransactionPayment = (doc: SearchableDoc, txId: string) => {
    const logs = doc.docType === 'invoice'
      ? getInvoicePayments(doc.doc)
      : getQuotationPayments(doc.doc)
    return logs.some(log => log.txId === txId)
  }

  const removePaymentFromDoc = async (doc: SearchableDoc, txId: string) => {
    if (doc.docType === 'invoice') {
      await removeInvoicePayment({ invoiceYear: doc.year, invoiceId: doc.doc.id, txId })
    } else {
      await removeQuotationPayment({ quotationYear: doc.year, quotationId: doc.doc.id, txId })
    }
  }

  const removeAllTransactionPayments = async (tx: LinkedFinanceTransaction) => {
    const processed = new Set<string>()

    if (tx.invoicePayment) {
      const key = `invoice|${tx.invoicePayment.invoiceYear}|${tx.invoicePayment.invoiceId}|${tx.invoicePayment.invoiceNo}`
      processed.add(key)
      await removeInvoicePayment({
        invoiceYear: tx.invoicePayment.invoiceYear,
        invoiceId: tx.invoicePayment.invoiceId,
        txId: tx.id,
      })
    }

    if (tx.quotationPayment) {
      const key = `quotation|${tx.quotationPayment.quotationYear}|${tx.quotationPayment.quotationId}|${tx.quotationPayment.quotationNo}`
      processed.add(key)
      await removeQuotationPayment({
        quotationYear: tx.quotationPayment.quotationYear,
        quotationId: tx.quotationPayment.quotationId,
        txId: tx.id,
      })
    }

    for (const link of tx.paymentLinks || []) {
      const key = paymentLinkKey(link)
      if (processed.has(key)) continue
      processed.add(key)
      if (link.docType === 'invoice') {
        await removeInvoicePayment({ invoiceYear: link.docYear, invoiceId: link.docId, txId: tx.id })
      } else {
        await removeQuotationPayment({ quotationYear: link.docYear, quotationId: link.docId, txId: tx.id })
      }
    }

    // Bersihkan payment log bayangan yang mungkin tertinggal dari bug versi lama.
    for (const doc of docOptions) {
      const key = docOptionKey(doc)
      if (processed.has(key) || !documentHasTransactionPayment(doc, tx.id)) continue
      processed.add(key)
      await removePaymentFromDoc(doc, tx.id)
    }
  }

  const handleDeleteTransaction = async (id: string) => {
    const tx = monthData.transactions.find(item => item.id === id) as LinkedFinanceTransaction | undefined
    if (!tx || !confirm('Hapus transaksi ini?\n\nTransaksi Mutasi akan dihapus dan seluruh link QTT/INV terkait akan dibersihkan.')) return

    setSaving(true)
    try {
      await removeAllTransactionPayments(tx)
      await updateMonth(data => ({
        ...data,
        transactions: data.transactions.filter(item => item.id !== id),
      }))
      const refreshed = await fetchPayableDocsAcrossYears([year])
      setDocOptions(refreshed)
    } catch (error) {
      alert(error instanceof Error ? `Transaksi gagal dihapus: ${error.message}` : 'Transaksi gagal dihapus.')
    } finally {
      setSaving(false)
    }
  }

  const handleTxFieldChange = async (id: string, patch: Partial<FinanceTransaction>) => {
    const currentTx = monthData.transactions.find(tx => tx.id === id) as LinkedFinanceTransaction | undefined
    const nextTx = currentTx ? ({
      ...currentTx,
      ...patch,
      amount: patch.amount !== undefined ? Number(patch.amount || 0) : currentTx.amount,
    } as LinkedFinanceTransaction) : null

    // Jika tanggal diubah ke bulan/tahun berbeda, pindahkan transaksi ke bulan tujuan.
    if (patch.date && nextTx) {
      const [newYear, newMonth] = patch.date.split('-').map(Number)
      if (newYear !== year || newMonth !== month) {
        // Hapus dari bulan saat ini
        await updateMonth(data => ({
          ...data,
          transactions: data.transactions.filter(tx => tx.id !== id),
        }))
        // Tambahkan ke bulan tujuan
        setSaving(true)
        try {
          const target = await fetchMonth(newYear, newMonth)
          await saveMonth({
            ...target,
            transactions: [...target.transactions, nextTx],
            categories: Array.from(new Set([...(target.categories || []), nextTx.category])),
          })
        } finally {
          setSaving(false)
        }
        // Sync invoice jika ada
        if (nextTx.invoicePayment) {
          try {
            if (nextTx.type !== 'income') {
              await removeInvoicePayment({ invoiceYear: nextTx.invoicePayment.invoiceYear, invoiceId: nextTx.invoicePayment.invoiceId, txId: nextTx.id })
            } else {
              await upsertInvoicePayment({ invoiceYear: nextTx.invoicePayment.invoiceYear, invoiceId: nextTx.invoicePayment.invoiceId, txId: nextTx.id, date: nextTx.date, amount: nextTx.amount, accountId: nextTx.accountId, accountLabel: getAccountLabel(nextTx.accountId), note: nextTx.description })
            }
            const refreshed = await fetchPayableDocsAcrossYears([year])
            setDocOptions(refreshed)
          } catch (error) {
            alert(error instanceof Error ? `Invoice terkait gagal disinkronkan: ${error.message}` : 'Invoice terkait gagal disinkronkan.')
          }
        }
        // Pindahkan tampilan ke bulan tujuan agar transaksi langsung terlihat
        if (newYear !== year) setYear(newYear)
        if (newMonth !== month) setMonth(newMonth)
        return
      }
    }

    // Bulan sama: update field biasa tanpa pindah bulan
    await updateMonth(data => ({
      ...data,
      transactions: data.transactions.map(tx => tx.id === id ? { ...tx, ...patch, amount: patch.amount !== undefined ? Number(patch.amount || 0) : tx.amount } : tx),
      categories: patch.category ? Array.from(new Set([...(data.categories || []), patch.category])) : data.categories,
    }))

    if (nextTx?.invoicePayment) {
      try {
        if (nextTx.type !== 'income') {
          await removeInvoicePayment({ invoiceYear: nextTx.invoicePayment.invoiceYear, invoiceId: nextTx.invoicePayment.invoiceId, txId: nextTx.id })
        } else {
          await upsertInvoicePayment({ invoiceYear: nextTx.invoicePayment.invoiceYear, invoiceId: nextTx.invoicePayment.invoiceId, txId: nextTx.id, date: nextTx.date, amount: nextTx.amount, accountId: nextTx.accountId, accountLabel: getAccountLabel(nextTx.accountId), note: nextTx.description })
        }
        const refreshed = await fetchPayableDocsAcrossYears([year])
        setDocOptions(refreshed)
      } catch (error) {
        alert(error instanceof Error ? `Invoice terkait gagal disinkronkan: ${error.message}` : 'Invoice terkait gagal disinkronkan.')
      }
    }
    if (nextTx?.quotationPayment) {
      try {
        if (nextTx.type !== 'income') {
          await removeQuotationPayment({ quotationYear: nextTx.quotationPayment.quotationYear, quotationId: nextTx.quotationPayment.quotationId, txId: nextTx.id })
        } else {
          await upsertQuotationPayment({ quotationYear: nextTx.quotationPayment.quotationYear, quotationId: nextTx.quotationPayment.quotationId, txId: nextTx.id, date: nextTx.date, amount: nextTx.amount, accountId: nextTx.accountId, accountLabel: getAccountLabel(nextTx.accountId), note: nextTx.description })
        }
        const refreshed = await fetchPayableDocsAcrossYears([year])
        setDocOptions(refreshed)
      } catch (error) {
        alert(error instanceof Error ? `Quotation terkait gagal disinkronkan: ${error.message}` : 'Quotation terkait gagal disinkronkan.')
      }
    }
  }

  useEffect(() => {
    const scope = `${year}-${month}`
    if (docLoading || docOptions.length === 0 || repairedLinkScopesRef.current.has(scope)) return

    const linkedTransactions = monthData.transactions
      .map(tx => tx as LinkedFinanceTransaction)
      .filter(tx => tx.invoicePayment || tx.quotationPayment || (tx.paymentLinks && tx.paymentLinks.length > 0))

    repairedLinkScopesRef.current.add(scope)
    if (linkedTransactions.length === 0) return

    let cancelled = false
    void (async () => {
      let changed = false
      for (const tx of linkedTransactions) {
        const desiredKeys = new Set<string>()
        if (tx.invoicePayment) desiredKeys.add(`invoice|${tx.invoicePayment.invoiceYear}|${tx.invoicePayment.invoiceId}|${tx.invoicePayment.invoiceNo}`)
        if (tx.quotationPayment) desiredKeys.add(`quotation|${tx.quotationPayment.quotationYear}|${tx.quotationPayment.quotationId}|${tx.quotationPayment.quotationNo}`)
        ;(tx.paymentLinks || []).forEach(link => desiredKeys.add(paymentLinkKey(link)))

        const staleDocs = docOptions.filter(doc =>
          documentHasTransactionPayment(doc, tx.id) && !desiredKeys.has(docOptionKey(doc))
        )
        for (const staleDoc of staleDocs) {
          await removePaymentFromDoc(staleDoc, tx.id)
          changed = true
        }
      }
      if (changed && !cancelled) {
        const refreshed = await fetchPayableDocsAcrossYears([year])
        if (!cancelled) setDocOptions(refreshed)
      }
    })().catch(() => {
      repairedLinkScopesRef.current.delete(scope)
    })

    return () => { cancelled = true }
  }, [docLoading, docOptions, monthData.transactions, month, year])

  const handleMultiLinkTx = async () => {
    if (!linkingTx || linkItems.length === 0) return
    setSaving(true)
    try {
      const paymentLinks: PaymentLinkItem[] = []
      const desiredKeys = new Set(
        linkItems
          .filter(item => toNumber(item.amount) > 0)
          .map(item => docOptionKey(item.doc))
      )

      // Saat link diganti, payment log lama yang sudah tidak dipilih harus
      // dilepas. Inilah penyebab pembayaran bisa menempel ke INV/QTT lain.
      const staleDocs = docOptions.filter(doc =>
        documentHasTransactionPayment(doc, linkingTx.id) && !desiredKeys.has(docOptionKey(doc))
      )
      for (const staleDoc of staleDocs) await removePaymentFromDoc(staleDoc, linkingTx.id)

      for (const item of linkItems) {
        const amount = toNumber(item.amount)
        if (amount <= 0) continue
        if (item.doc.docType === 'invoice') {
          await upsertInvoicePayment({ invoiceYear: item.doc.year, invoiceId: item.doc.doc.id, txId: linkingTx.id, date: linkingTx.date, amount, accountId: linkingTx.accountId, accountLabel: getAccountLabel(linkingTx.accountId), note: linkingTx.description })
        } else {
          await upsertQuotationPayment({ quotationYear: item.doc.year, quotationId: item.doc.doc.id, txId: linkingTx.id, date: linkingTx.date, amount, accountId: linkingTx.accountId, accountLabel: getAccountLabel(linkingTx.accountId), note: linkingTx.description })
        }
        const existingLink = linkingTx.paymentLinks?.find(link =>
          link.docType === item.doc.docType && link.docNo === item.doc.docNo
        )
        paymentLinks.push({
          docType: item.doc.docType,
          docNo: item.doc.docNo,
          docId: item.doc.doc.id,
          docYear: item.doc.year,
          projectYear: item.doc.projectYear,
          ...(existingLink?.taxYear !== undefined ? { taxYear: existingLink.taxYear } : {}),
          client: item.doc.client,
          brand: item.doc.brand,
          item: item.doc.item,
          total: item.doc.total,
          amount,
        })
      }
      await updateMonth(data => ({
        ...data,
        transactions: data.transactions.map(t => {
          if (t.id !== linkingTx.id) return t
          const { invoicePayment: _inv, quotationPayment: _quo, ...rest } = t as LinkedFinanceTransaction
          return { ...rest, paymentLinks }
        }),
      }))
      const refreshed = await fetchPayableDocsAcrossYears([year])
      setDocOptions(refreshed)
      setLinkingTx(null)
      setLinkItems([])
      setLinkSearch('')
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Gagal menyimpan link.')
    } finally {
      setSaving(false)
    }
  }

  // Hapus link saja (transaksi tetap ada)
  const handleUnlinkTx = async (tx: LinkedFinanceTransaction) => {
    if (!confirm('Hapus semua link ke invoice/quotation ini?\nTransaksi tetap ada, hanya linknya yang dihapus.')) return
    setSaving(true)
    try {
      await removeAllTransactionPayments(tx)
      await updateMonth(data => ({
        ...data,
        transactions: data.transactions.map(t => {
          if (t.id !== tx.id) return t
          const { invoicePayment: _inv, quotationPayment: _quo, paymentLinks: _pl, ...rest } = t as LinkedFinanceTransaction
          return rest
        }),
      }))
      const refreshed = await fetchPayableDocsAcrossYears([year])
      setDocOptions(refreshed)
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Gagal hapus link.')
    } finally {
      setSaving(false)
    }
  }

  const handleVerifyTx = async (id: string) => {
    await updateMonth(data => ({
      ...data,
      transactions: data.transactions.map(tx =>
        tx.id === id ? { ...tx, verified: !tx.verified } : tx
      ),
    }))
  }

  const handleSetTaxYear = async (id: string, taxYear: number) => {
    await updateMonth(data => ({
      ...data,
      transactions: data.transactions.map(tx =>
        tx.id === id ? { ...tx, taxYear } : tx
      ),
    }))
  }

  const handleSetLinkedTaxYear = async (
    id: string,
    target: TaxYearTarget,
    linkIndex: number | undefined,
    taxYear: number | null,
  ) => {
    await updateMonth(data => ({
      ...data,
      transactions: data.transactions.map(rawTx => {
        if (rawTx.id !== id) return rawTx
        const tx = rawTx as LinkedFinanceTransaction

        if (target === 'paymentLink' && tx.paymentLinks) {
          const paymentLinks = tx.paymentLinks.map((link, index) => {
            if (index !== linkIndex) return link
            if (taxYear === null) {
              const nextLink = { ...link }
              delete nextLink.taxYear
              return nextLink
            }
            return { ...link, taxYear }
          })
          return { ...tx, paymentLinks }
        }

        if (taxYear === null) {
          const nextTx = { ...tx }
          delete nextTx.taxYear
          return nextTx
        }
        return { ...tx, taxYear }
      }),
    }))
  }

  const handleSetTaxYearRemainder = async (id: string, taxYear: number, note?: string) => {
    await updateMonth(data => ({
      ...data,
      transactions: data.transactions.map(tx =>
        tx.id === id ? { ...tx, taxYearRemainder: { taxYear, note } } : tx
      ),
    }))
  }

  const handleProofUpload = async (tx: FinanceTransaction, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) return alert('Bukti sementara mendukung file gambar JPG/PNG/WebP')
    const dataUrl = await readFileAsDataUrl(file)
    await handleTxFieldChange(tx.id, { proofImage: dataUrl, proofName: file.name })
  }

  const handleClearMonth = async () => {
    if (!confirm(`Kosongkan semua transaksi dan saldo awal bulan ${currentMonthName} ${year}?`)) return
    autoFilledRef.current = ''
    await saveMonth(emptyMonthData(year, month))
  }

  const handleResetAllMonths = async () => {
    if (!confirm(`Reset SEMUA bulan tahun ${year}?\n\nSemua transaksi dan saldo awal di seluruh bulan akan dihapus.\nData rekening (nama PT, bank, no rek) tetap aman.\n\nIni tidak bisa dibatalkan.`)) return
    setSaving(true)
    autoFilledRef.current = ''
    try {
      await Promise.all(MONTHS.map(m => saveMonth(emptyMonthData(year, m.no))))
    } finally {
      setSaving(false)
    }
  }

  const handleImportCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const text = await file.text()
    const rows = parseCsv(text)
    if (!rows.length) return alert('CSV kosong atau format tidak terbaca')

    const nextAccounts = [...accounts]
    const accountKey = (pt: string, bank: string, no: string) => `${pt.toLowerCase()}|${bank.toLowerCase()}|${no}`
    const accountMap = new Map(nextAccounts.map(a => [accountKey(a.companyName || '', a.bankName || '', a.accountNumber || ''), a]))
    const grouped = new Map<string, { opening: Record<string, number>, txs: FinanceTransaction[] }>()

    for (const row of rows) {
      const yr = Number(row.tahun || row.year || year)
      const mo = parseMonth(row.bulan || row.month || String(month))
      if (!yr || !mo) continue
      const pt = (row['nama pt'] || row.pt || '').trim()
      const bank = (row.bank || '').trim()
      const no = (row['no rekening'] || row['no rek'] || row.rekening || '').trim()
      const key = accountKey(pt, bank, no)
      let account = accountMap.get(key)
      if (!account) {
        account = {
          id: makeId('acc'), name: [pt, [bank, no].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || 'Rekening Import',
          type: bank ? 'bank' : 'other', companyName: pt, bankName: bank, accountNumber: no,
          activeFrom: monthKey(yr, mo), createdAt: new Date().toISOString(),
        }
        accountMap.set(key, account)
        nextAccounts.push(account)
      }
      const groupKey = `${yr}-${String(mo).padStart(2, '0')}`
      const group = grouped.get(groupKey) || { opening: {}, txs: [] }
      const opening = toNumber(row['saldo awal'] || row.saldo || '')
      if (opening) group.opening[account.id] = opening
      const amount = toNumber(row.nominal || row.amount || '')
      const jenis = String(row.jenis || row.type || '').toLowerCase()
      const isOpeningOnly = !amount && opening
      if (!isOpeningOnly && amount > 0) {
        group.txs.push({
          id: makeId('tx'), date: row.tanggal || row.tgl || `${yr}-${String(mo).padStart(2, '0')}-01`,
          description: row.keterangan || row.deskripsi || 'Import mutasi', category: row.kategori || 'Tanpa Kategori',
          type: jenis.includes('keluar') || jenis.includes('expense') || jenis === 'out' ? 'expense' : 'income',
          accountId: account.id, amount, createdAt: new Date().toISOString(),
        })
      }
      grouped.set(groupKey, group)
    }

    await saveAccounts(nextAccounts)
    setAccounts(nextAccounts)
    let imported = 0
    for (const [key, group] of grouped.entries()) {
      const [yr, mo] = key.split('-').map(Number)
      const existing = await fetchMonth(yr, mo)
      imported += group.txs.length
      await saveMonth({
        ...existing,
        openingBalances: { ...existing.openingBalances, ...group.opening },
        transactions: [...existing.transactions, ...group.txs],
        categories: Array.from(new Set([...(existing.categories || []), ...group.txs.map(t => t.category)])),
      })
    }
    alert(`Import selesai: ${imported} transaksi diproses.`)
  }

  const selectedSummary = summaries.find(s => s.account.id === selectedAccount)

  const renderRows = (rows: FinanceTransaction[], type: TxType) => (
    <tbody>
      {rows.map(tx => {
        const account = activeAccounts.find(item => item.id === tx.accountId)
        return (
          <tr id={`mutasi-${tx.id}`} key={tx.id} className={`border-t align-top transition-all ${focusTxId === tx.id ? 'border-amber-300 bg-amber-50 ring-2 ring-inset ring-amber-300' : tx.verified ? 'border-gray-50 bg-[#ccfbf1]' : 'border-gray-50 hover:bg-gray-50/60'}`}>
            <td className="px-2 py-2 no-print">
              <input
                type="checkbox"
                checked={!!tx.verified}
                onChange={() => handleVerifyTx(tx.id)}
                className="w-3.5 h-3.5 rounded accent-[#1B8A7A] cursor-pointer"
                title={tx.verified ? 'Sudah diverifikasi' : 'Belum diverifikasi'}
              />
            </td>
            <td className="px-3 py-2"><DateInput value={tx.date} onChange={v => handleTxFieldChange(tx.id, { date: v })} className="w-[118px] px-2 py-1.5 border border-transparent hover:border-gray-200 rounded-lg outline-none focus-within:border-[#1B8A7A] flex items-center gap-0.5" /></td>
            <td className="px-3 py-2 min-w-[260px]"><input value={tx.description} onChange={e => handleTxFieldChange(tx.id, { description: e.target.value })} className="w-full px-2 py-1.5 border border-transparent hover:border-gray-200 rounded-lg bg-transparent outline-none focus:border-[#1B8A7A] font-medium text-gray-800" />
              <div className="flex items-center gap-1.5 mt-0.5">
                <div className="text-[10px] text-gray-400">{accountDisplayName(account)}</div>
                {(tx as LinkedFinanceTransaction).createdBy && (
                  <div className="text-[9px] text-gray-300">·</div>
                )}
                {(tx as LinkedFinanceTransaction).createdBy && (
                  <div className="text-[9px] text-gray-400 flex items-center gap-0.5">
                    <span className="inline-flex w-3.5 h-3.5 rounded-full bg-gray-200 text-gray-600 text-[8px] font-bold items-center justify-center flex-shrink-0">
                      {(tx as LinkedFinanceTransaction).createdBy!.name.charAt(0).toUpperCase()}
                    </span>
                    {(tx as LinkedFinanceTransaction).createdBy!.name}
                  </div>
                )}
              </div>
                {/* Multi-link badges (paymentLinks) */}
                {(tx as LinkedFinanceTransaction).paymentLinks?.map((link, i) => (
                  <span key={i} className={`inline-flex ml-2 mt-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${link.docType === 'invoice' ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'}`}>
                    {link.docType === 'invoice' ? 'INV' : 'QUO'}: {link.docNo} · Rp {rupiah(link.amount, 0)}
                  </span>
                ))}
                {(tx as LinkedFinanceTransaction).paymentLinks && (tx as LinkedFinanceTransaction).paymentLinks!.length > 0 && (
                  <div className="flex items-center gap-1 mt-1 ml-2">
                    <button onClick={() => { setLinkingTx(tx as LinkedFinanceTransaction); setLinkItems([]); setLinkSearch('') }} className="text-[9px] px-1.5 py-0.5 rounded border border-gray-200 text-gray-400 hover:text-[#1B8A7A] hover:border-[#1B8A7A]">Ganti</button>
                    <button onClick={() => handleUnlinkTx(tx as LinkedFinanceTransaction)} className="text-[9px] px-1.5 py-0.5 rounded border border-gray-200 text-gray-400 hover:text-red-600 hover:border-red-200">Hapus Link</button>
                  </div>
                )}
                {/* Single-link backward compat */}
                {!(tx as LinkedFinanceTransaction).paymentLinks && (tx as LinkedFinanceTransaction).invoicePayment && (
                  <div className="flex items-center gap-1 mt-1 ml-2">
                    <span className="inline-flex px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 text-[10px] font-semibold">INV: {(tx as LinkedFinanceTransaction).invoicePayment?.invoiceNo}</span>
                    <button onClick={() => { setLinkingTx(tx as LinkedFinanceTransaction); setLinkItems([]); setLinkSearch('') }} className="text-[9px] px-1.5 py-0.5 rounded border border-gray-200 text-gray-400 hover:text-[#1B8A7A] hover:border-[#1B8A7A]">Ganti</button>
                    <button onClick={() => handleUnlinkTx(tx as LinkedFinanceTransaction)} className="text-[9px] px-1.5 py-0.5 rounded border border-gray-200 text-gray-400 hover:text-red-600 hover:border-red-200">Hapus Link</button>
                  </div>
                )}
                {!(tx as LinkedFinanceTransaction).paymentLinks && (tx as LinkedFinanceTransaction).quotationPayment && (
                  <div className="flex items-center gap-1 mt-1 ml-2">
                    <span className="inline-flex px-2 py-0.5 rounded-full bg-purple-50 text-purple-600 text-[10px] font-semibold">QUO: {(tx as LinkedFinanceTransaction).quotationPayment?.quotationNo}</span>
                    <button onClick={() => { setLinkingTx(tx as LinkedFinanceTransaction); setLinkItems([]); setLinkSearch('') }} className="text-[9px] px-1.5 py-0.5 rounded border border-gray-200 text-gray-400 hover:text-[#1B8A7A] hover:border-[#1B8A7A]">Ganti</button>
                    <button onClick={() => handleUnlinkTx(tx as LinkedFinanceTransaction)} className="text-[9px] px-1.5 py-0.5 rounded border border-gray-200 text-gray-400 hover:text-red-600 hover:border-red-200">Hapus Link</button>
                  </div>
                )}
                {/* Tahun Pajak breakdown */}
                {type === 'income' && (() => {
                  const ltx = tx as LinkedFinanceTransaction
                  const { lines, remainder } = getTaxYearBreakdown(ltx, year)
                  const hasLinks = ltx.paymentLinks?.length || ltx.invoicePayment || ltx.quotationPayment
                  return (
                    <div className="mt-1.5 ml-2 space-y-0.5">
                      {lines.map((line, i) => {
                        const editKey = `${tx.id}:${line.target || line.source}:${line.linkIndex ?? i}`
                        return (
                          <div key={i} className="flex items-center gap-1.5 flex-wrap">
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                              line.source === 'link' ? 'bg-teal-50 text-teal-700' :
                              line.source === 'remainder' ? 'bg-amber-50 text-amber-700' :
                              'bg-gray-100 text-gray-600'
                            }`}>TH {line.taxYear}</span>
                            <span className="text-[10px] text-gray-500">Rp {rupiah(line.amount, 0)}</span>
                            {line.source !== 'link' && (
                              <span className="text-[9px] text-gray-400">{line.label}</span>
                            )}
                            {line.source === 'link' && line.target && (
                              editingTaxYearKey === editKey ? (
                                <select
                                  autoFocus
                                  value={line.isManualOverride ? String(line.taxYear) : 'auto'}
                                  onBlur={() => setEditingTaxYearKey('')}
                                  onChange={event => {
                                    const value = event.target.value
                                    void handleSetLinkedTaxYear(
                                      tx.id,
                                      line.target!,
                                      line.linkIndex,
                                      value === 'auto' ? null : Number(value),
                                    ).finally(() => setEditingTaxYearKey(''))
                                  }}
                                  className="text-[10px] border border-teal-200 rounded px-1 py-0.5 bg-white text-gray-700 outline-none focus:border-[#1B8A7A]"
                                >
                                  <option value="auto">Otomatis ({line.automaticTaxYear})</option>
                                  {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                                </select>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setEditingTaxYearKey(editKey)}
                                  className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded border border-dashed border-teal-200 text-teal-600 hover:border-[#1B8A7A] hover:text-[#1B8A7A]"
                                  title={`Tahun otomatis dari dokumen: ${line.automaticTaxYear}`}
                                >
                                  <Pencil className="w-2.5 h-2.5" /> Ganti TH Pajak
                                </button>
                              )
                            )}
                            {line.source === 'link' && line.isManualOverride && (
                              <span className="text-[9px] text-amber-600">manual</span>
                            )}
                          </div>
                        )
                      })}
                      {/* Sisa belum dialokasikan */}
                      {remainder > 0.5 && (
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="text-[9px] text-red-500 font-semibold">Sisa Rp {rupiah(remainder, 0)} belum ada tahun pajak</span>
                          <select
                            defaultValue=""
                            onChange={e => { if (e.target.value) handleSetTaxYearRemainder(tx.id, Number(e.target.value)) }}
                            className="text-[10px] border border-dashed border-amber-300 rounded px-1 py-0.5 bg-white text-gray-700 outline-none focus:border-amber-500"
                          >
                            <option value="">Tetapkan TH Pajak...</option>
                            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                          </select>
                        </div>
                      )}
                      {/* Tidak ada link sama sekali */}
                      {!hasLinks && lines.length === 1 && lines[0].source === 'manual' && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="text-[9px] text-gray-400">Tahun Pajak:</span>
                          <select
                            value={ltx.taxYear ?? year}
                            onChange={e => handleSetTaxYear(tx.id, Number(e.target.value))}
                            className="text-[10px] border border-gray-200 rounded px-1 py-0.5 bg-white text-gray-700 outline-none focus:border-[#1B8A7A]"
                          >
                            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                          </select>
                          <button onClick={() => { setLinkingTx(tx as LinkedFinanceTransaction); setLinkItems([]); setLinkSearch('') }} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full border border-dashed border-gray-300 text-[9px] text-gray-400 hover:border-[#1B8A7A] hover:text-[#1B8A7A]"><Link className="w-2.5 h-2.5" /> Link</button>
                        </div>
                      )}
                    </div>
                  )
                })()}
              </td>
            <td className="px-3 py-2"><input list="finance-categories" value={tx.category} onChange={e => handleTxFieldChange(tx.id, { category: e.target.value })} className="w-[160px] px-2 py-1.5 border border-transparent hover:border-gray-200 rounded-lg bg-transparent outline-none focus:border-[#1B8A7A]" /></td>
            <td className="px-3 py-2 text-right"><input defaultValue={rupiah(tx.amount, 2)} onBlur={e => handleTxFieldChange(tx.id, { amount: toNumber(e.target.value) })} className={`w-[140px] px-2 py-1.5 border border-transparent hover:border-gray-200 rounded-lg bg-transparent outline-none focus:border-[#1B8A7A] text-right font-semibold ${type === 'income' ? 'text-green-700' : 'text-red-600'}`} /></td>
            {type === 'expense' && (
              <td className="px-3 py-2 text-center no-print">
                {tx.proofImage ? (
                  <div className="flex items-center justify-center gap-1">
                    <button onClick={() => window.open(tx.proofImage, '_blank')} className="text-[10px] text-[#1B8A7A] underline">Lihat</button>
                    <label className="text-[10px] text-gray-400 cursor-pointer hover:text-[#1B8A7A]">Ganti<input type="file" accept="image/*" onChange={e => handleProofUpload(tx, e)} className="hidden" /></label>
                  </div>
                ) : (
                  <label className="inline-flex items-center gap-1 px-2 py-1 border border-dashed border-gray-300 rounded-lg text-[10px] text-gray-500 cursor-pointer hover:border-[#1B8A7A] hover:text-[#1B8A7A]"><Camera className="w-3 h-3" /> Bukti<input type="file" accept="image/*" onChange={e => handleProofUpload(tx, e)} className="hidden" /></label>
                )}
              </td>
            )}
            <td className="px-3 py-2 text-center no-print"><button onClick={() => handleDeleteTransaction(tx.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 className="w-3.5 h-3.5" /></button></td>
          </tr>
        )
      })}
      {rows.length === 0 && <tr><td colSpan={type === 'expense' ? 6 : 5} className="px-4 py-10 text-center text-gray-400">Belum ada transaksi.</td></tr>}
    </tbody>
  )

  return (
    <div className="p-6 print:p-0">
      <style jsx global>{`
        @media print {
          aside, button, input, select, label, .no-print { display: none !important; }
          main { margin-left: 0 !important; }
          body { background: white !important; }
          .print-card { box-shadow: none !important; border-color: #d1d5db !important; }
          @page { size: A4 landscape; margin: 10mm; }
        }
      `}</style>

      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Mutasi Kas/Bank</h1>
          <p className="text-sm text-gray-400 mt-0.5">Multi rekening per PT, saldo awal, pemasukan, pengeluaran, bukti, dan import CSV — {currentMonthName} {year}</p>
        </div>
        <div className="flex items-center gap-2 no-print flex-wrap justify-end">
          <select value={year} onChange={e => setYear(Number(e.target.value))} className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white outline-none focus:border-[#1B8A7A]">
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={selectedAccount} onChange={e => { const id = e.target.value; setSelectedAccount(id); setViewMode(id === 'all' ? 'overview' : 'sheet'); if (id !== 'all') setTxForm(v => ({ ...v, accountId: id })) }} className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white outline-none focus:border-[#1B8A7A]">
            <option value="all">Semua Rekening</option>
            {activeAccounts.map(account => <option key={account.id} value={account.id}>{accountDisplayName(account)}</option>)}
          </select>
          <button onClick={downloadCsvTemplate} className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50"><FileDown className="w-4 h-4" /> Template CSV</button>
          <label className="flex items-center gap-1.5 px-3 py-2 bg-purple-600 text-white rounded-lg text-sm cursor-pointer hover:bg-purple-700"><Upload className="w-4 h-4" /> Import CSV<input type="file" accept=".csv,text/csv" onChange={handleImportCsv} className="hidden" /></label>
          <button onClick={handleClearMonth} className="flex items-center gap-1.5 px-3 py-2 bg-white border border-red-200 rounded-lg text-sm text-red-600 hover:bg-red-50">Kosongkan Bulan Ini</button>
          <button onClick={handleResetAllMonths} className="flex items-center gap-1.5 px-3 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700">Reset Semua Bulan {year}</button>
          <button onClick={() => downloadAccountPdf()} className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50"><Download className="w-4 h-4" /> Download PDF Rekening</button>
        </div>
      </div>

      {/* Tab Bulan */}
      <div className="grid grid-cols-12 gap-2 mb-5 no-print">
        {monthHasData.map(item => (
          <button key={item.no} onClick={() => setMonth(item.no)} className={`relative py-2 rounded-lg text-xs font-semibold transition-colors ${month === item.no ? 'bg-[#1B8A7A] text-white' : 'bg-white border border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
            {item.short}{item.hasData && <span className="absolute right-2 top-2 w-1.5 h-1.5 rounded-full bg-green-500" />}
          </button>
        ))}
      </div>

      {/* Ringkasan atas */}
      <div className="grid grid-cols-4 gap-4 mb-5">
        <div className="bg-white rounded-xl border border-gray-100 p-4 print-card"><div className="text-xs text-gray-400">Total Saldo Awal Semua Rekening</div><div className="text-lg font-bold text-gray-900 mt-1">Rp {rupiah(totalOpening, 2)}</div></div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 print-card"><div className="text-xs text-gray-400">Total Pemasukan Semua Rekening</div><div className="text-lg font-bold text-green-700 mt-1">Rp {rupiah(totalIncome, 2)}</div></div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 print-card"><div className="text-xs text-gray-400">Total Pengeluaran Semua Rekening</div><div className="text-lg font-bold text-red-600 mt-1">Rp {rupiah(totalExpense, 2)}</div></div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 print-card"><div className="text-xs text-gray-400">Total Saldo Akhir Semua Rekening</div><div className="text-lg font-bold text-[#1B8A7A] mt-1">Rp {rupiah(totalClosing, 2)}</div></div>
      </div>

      {/* Layout utama: sidebar kiri + konten kanan */}
      <div className="grid grid-cols-[320px_1fr] gap-5">

        {/* ── SIDEBAR KIRI ── */}
        <div className="space-y-4 no-print">

          {/* Tambah Transaksi Cepat */}
          <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Tambah Transaksi Cepat</h2>
            <div className="space-y-2">
              <DateInput value={txForm.date} onChange={v => setTxForm(f => ({ ...f, date: v }))} />
              <div className="grid grid-cols-2 gap-2">
                <select value={txForm.type} onChange={e => setTxForm(v => ({ ...v, type: e.target.value as TxType }))} className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A] bg-white">
                  <option value="income">Pemasukan</option>
                  <option value="expense">Pengeluaran</option>
                </select>
                <select value={txForm.accountId} onChange={e => { const id = e.target.value; setTxForm(v => ({ ...v, accountId: id })); if (id) { setSelectedAccount(id); setViewMode('sheet') } }} className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A] bg-white">
                  <option value="">Pilih akun</option>
                  {activeAccounts.map(account => <option key={account.id} value={account.id}>{accountDisplayName(account)}</option>)}
                </select>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input value={docSearch} onChange={e => { setDocSearch(e.target.value); if (selectedDoc) setSelectedDoc(null) }} placeholder="Cari invoice / quotation..." className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A]" />
                {docSearch && !selectedDoc && (
                  <div className="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden max-h-72 overflow-y-auto">
                    {docLoading ? (
                      <div className="px-3 py-3 text-xs text-gray-400">Memuat...</div>
                    ) : docMatches.length === 0 ? (
                      <div className="px-3 py-3 text-xs text-gray-400">Dokumen tidak ditemukan.</div>
                    ) : docMatches.map(d => (
                      <button key={`${d.docType}-${d.year}-${d.doc.id}`} onClick={() => handleSelectDoc(d)} className="w-full text-left px-3 py-2.5 hover:bg-[#E1F5EE] border-b border-gray-50 last:border-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-gray-900">{d.docNo}</span>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${d.docType === 'invoice' ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'}`}>{d.docType === 'invoice' ? 'INV' : 'QUO'}</span>
                        </div>
                        <div className="text-[11px] text-gray-500 mt-0.5 truncate">{d.client} · {d.brand || '-'}</div>
                        <div className="text-[10px] text-gray-400 mt-1">Sisa Rp {rupiah(d.remaining, 0)}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {selectedDoc && (
                <div className="rounded-xl border border-[#1B8A7A]/20 bg-[#E1F5EE]/70 p-3 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-gray-900">{selectedDoc.docNo}</span>
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${selectedDoc.docType === 'invoice' ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'}`}>{selectedDoc.docType === 'invoice' ? 'Invoice' : 'Quotation'}</span>
                      </div>
                      <div className="text-gray-500 mt-0.5">{selectedDoc.client}</div>
                      <div className="text-gray-500">{selectedDoc.brand || '-'} · {selectedDoc.item || '-'}</div>
                    </div>
                    <button onClick={clearSelectedDoc} className="text-[10px] px-2 py-1 rounded-lg bg-white text-gray-500 hover:text-red-600">Batal</button>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-3">
                    <div><div className="text-[10px] text-gray-400">Total</div><div className="font-semibold">Rp {rupiah(selectedDoc.total, 0)}</div></div>
                    <div><div className="text-[10px] text-gray-400">Dibayar</div><div className="font-semibold text-green-700">Rp {rupiah(selectedDoc.paid, 0)}</div></div>
                    <div><div className="text-[10px] text-gray-400">Sisa</div><div className="font-semibold text-red-600">Rp {rupiah(selectedDoc.remaining, 0)}</div></div>
                  </div>
                </div>
              )}
              <input value={txForm.description} onChange={e => setTxForm(v => ({ ...v, description: e.target.value }))} placeholder="Keterangan" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A]" />
              <div className="grid grid-cols-2 gap-2">
                <input list="finance-categories" value={txForm.category} onChange={e => setTxForm(v => ({ ...v, category: e.target.value }))} placeholder="Kategori" className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A]" />
                <input value={txForm.amount} onChange={e => setTxForm(v => ({ ...v, amount: e.target.value }))} placeholder="Nominal" inputMode="numeric" className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A]" />
              </div>
              <datalist id="finance-categories">{categories.map(category => <option key={category} value={category} />)}</datalist>
              <button onClick={handleAddTransaction} disabled={activeAccounts.length === 0} className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-gray-900 text-white text-sm font-semibold rounded-lg hover:bg-black disabled:opacity-40">
                <Save className="w-4 h-4" /> Simpan Transaksi
              </button>
              {saving && <div className="text-[11px] text-gray-400">Menyimpan...</div>}
            </div>
          </div>

          {/* Daftar Rekening */}
          <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <WalletCards className="w-4 h-4 text-[#1B8A7A]" />
                <h2 className="text-sm font-semibold text-gray-900">Rekening</h2>
              </div>
              <button onClick={() => setShowAddAccountModal(true)} className="flex items-center gap-1 px-2.5 py-1.5 bg-[#1B8A7A] text-white text-xs font-semibold rounded-lg hover:bg-[#0F6E56]">
                <Plus className="w-3.5 h-3.5" /> Tambah
              </button>
            </div>
            <div className="space-y-1 max-h-[360px] overflow-auto pr-1">
              <button onClick={() => { setSelectedAccount('all'); setViewMode('overview') }} className={`w-full text-left px-3 py-2 rounded-lg text-xs font-semibold ${selectedAccount === 'all' ? 'bg-[#E1F5EE] text-[#1B8A7A]' : 'hover:bg-gray-50 text-gray-600'}`}>
                Semua Rekening
              </button>
              {summaries.map(item => (
                <div key={item.account.id} className={`group rounded-lg border ${selectedAccount === item.account.id ? 'bg-[#E1F5EE] border-[#1B8A7A]/20' : 'hover:bg-gray-50 border-transparent'}`}>
                  {editingAccount === item.account.id ? (
                    <div className="px-3 py-2 space-y-1.5">
                      <input value={editAccountData.companyName} onChange={e => setEditAccountData(v => ({ ...v, companyName: e.target.value }))} placeholder="Nama PT" className="w-full px-2 py-1 text-xs border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A]" />
                      <div className="grid grid-cols-2 gap-1">
                        <input value={editAccountData.bankName} onChange={e => setEditAccountData(v => ({ ...v, bankName: e.target.value }))} placeholder="Bank" className="px-2 py-1 text-xs border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A]" />
                        <input value={editAccountData.accountNumber} onChange={e => setEditAccountData(v => ({ ...v, accountNumber: e.target.value }))} placeholder="No Rek" className="px-2 py-1 text-xs border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A]" />
                      </div>
                      <input value={editAccountData.opening} onChange={e => setEditAccountData(v => ({ ...v, opening: e.target.value }))} placeholder="Saldo awal bulan ini" inputMode="numeric" className="w-full px-2 py-1 text-xs border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A]" />
                      <div className="flex gap-1">
                        <button onClick={() => saveEditAccount(item.account.id)} className="flex-1 flex items-center justify-center gap-1 py-1 bg-[#1B8A7A] text-white text-[10px] font-semibold rounded-lg"><Check className="w-3 h-3" /> Simpan</button>
                        <button onClick={() => setEditingAccount(null)} className="px-2 py-1 border border-gray-200 text-gray-500 text-[10px] rounded-lg hover:bg-gray-50"><X className="w-3 h-3" /></button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <button onClick={() => { setSelectedAccount(item.account.id); setViewMode('sheet'); setTxForm(v => ({ ...v, accountId: item.account.id })) }} className={`flex-1 text-left px-3 py-2 text-xs ${selectedAccount === item.account.id ? 'text-[#1B8A7A] font-semibold' : 'text-gray-600'}`}>
                        <div className="font-medium leading-snug break-words">{accountDisplayName(item.account)}</div>
                        <div className="flex items-center justify-between gap-2 mt-1">
                          <span className="text-[10px] text-gray-400">{accountTypeLabel(item.account.type)}</span>
                          <span className={`text-xs font-bold ${item.balance >= 0 ? 'text-[#1B8A7A]' : 'text-red-600'}`}>Rp {rupiah(item.balance, 0)}</span>
                        </div>
                      </button>
                      <div className="flex gap-0.5 pr-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => startEditAccount(item.account.id)} className="p-1.5 text-gray-400 hover:text-[#1B8A7A] hover:bg-white rounded-lg" title="Edit rekening"><Pencil className="w-3 h-3" /></button>
                        <button onClick={() => handleDeleteAccount(item.account.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg" title="Hapus permanen"><Trash2 className="w-3 h-3" /></button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {summaries.length === 0 && <div className="text-xs text-gray-400 text-center py-4">Belum ada rekening.</div>}
            </div>
          </div>
        </div>

        {/* ── KONTEN KANAN ── */}
        <div className="space-y-4">
          {viewMode === 'overview' && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden print-card">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
                <div><h2 className="text-sm font-semibold text-gray-900">Sisa Saldo Rekening</h2><p className="text-xs text-gray-400">Klik kartu rekening untuk masuk ke sheet mutasi per rekening.</p></div>
                <button onClick={handleClearMonth} className="no-print text-xs px-3 py-1.5 rounded-lg border border-red-100 text-red-600 hover:bg-red-50">Kosongkan Bulan</button>
              </div>
              <div className="grid grid-cols-3 gap-3 p-4">
                {summaries.map(item => (
                  <button key={item.account.id} onClick={() => { setSelectedAccount(item.account.id); setViewMode('sheet'); setTxForm(v => ({ ...v, accountId: item.account.id })) }} className="text-left border border-gray-100 rounded-xl p-4 hover:border-[#1B8A7A] hover:shadow-sm transition">
                    <div className="flex items-center gap-2 text-[10px] font-semibold text-gray-400 uppercase"><Building2 className="w-3 h-3" /> {item.account.companyName || accountTypeLabel(item.account.type)}</div>
                    <div className="text-xs text-gray-500 mt-1">{[item.account.bankName, item.account.accountNumber].filter(Boolean).join(' · ') || item.account.name}</div>
                    <div className={`text-lg font-bold mt-3 ${item.balance >= 0 ? 'text-[#1B8A7A]' : 'text-red-600'}`}>Rp {rupiah(item.balance, 2)}</div>
                    <div className="grid grid-cols-2 gap-2 text-[10px] mt-2"><span className="text-green-700">Masuk Rp {rupiah(item.income, 0)}</span><span className="text-red-600 text-right">Keluar Rp {rupiah(item.expense, 0)}</span></div>
                  </button>
                ))}
                {summaries.length === 0 && <div className="col-span-3 text-center text-sm text-gray-400 py-12">Belum ada rekening. Klik &quot;Tambah&quot; di panel kiri untuk menambah rekening.</div>}
              </div>
            </div>
          )}

          {viewMode === 'sheet' && selectedAccountData && selectedSummary && (
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 print-card">
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div><h2 className="text-sm font-semibold text-gray-900">Mutasi Rekening</h2><p className="text-xs text-gray-400">{accountDisplayName(selectedAccountData)} — {currentMonthName} {year}</p></div>
                  <div className="flex gap-2 no-print">
                    <button onClick={() => downloadAccountPdf(selectedAccount)} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-gray-200 hover:bg-gray-50"><Download className="w-3.5 h-3.5" /> Download PDF</button>
                    <button onClick={() => copyPreviousClosing(selectedAccount)} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-gray-200 hover:bg-gray-50"><Copy className="w-3.5 h-3.5" /> Salin Saldo Bulan Lalu</button>
                    <button onClick={() => startEditAccount(selectedAccount)} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-gray-200 hover:bg-gray-50"><Pencil className="w-3.5 h-3.5" /> Edit Rekening</button>
                    <button onClick={() => handleArchiveAccount(selectedAccount)} className="px-3 py-1.5 text-xs rounded-lg border border-amber-100 text-amber-600 hover:bg-amber-50">Arsipkan</button>
                    <button onClick={() => handleDeleteAccount(selectedAccount)} className="px-3 py-1.5 text-xs rounded-lg border border-red-100 text-red-600 hover:bg-red-50">Hapus Permanen</button>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="rounded-lg border border-gray-100 p-3"><div className="text-[10px] text-gray-400 uppercase font-bold">Nama PT</div><div className="text-sm font-semibold text-gray-900 mt-1">{selectedAccountData.companyName || '-'}</div></div>
                  <div className="rounded-lg border border-gray-100 p-3"><div className="text-[10px] text-gray-400 uppercase font-bold">Bank / Rekening</div><div className="text-sm font-semibold text-gray-900 mt-1">{[selectedAccountData.bankName, selectedAccountData.accountNumber].filter(Boolean).join(' / ') || '-'}</div></div>
                  <div className="rounded-lg border border-gray-100 p-3"><div className="text-[10px] text-gray-400 uppercase font-bold">Bulan</div><div className="text-sm font-semibold text-gray-900 mt-1">{currentMonthName} {year}</div></div>
                </div>
                <div className="grid grid-cols-4 gap-[1px] bg-gray-200 border border-gray-200 rounded-xl overflow-hidden">
                  <div className="bg-white p-3">
                    <div className="text-[10px] text-gray-400 uppercase font-bold">Saldo Awal</div>
                    <input key={`opening-${selectedAccount}-${selectedSummary.opening}`} defaultValue={rupiah(selectedSummary.opening, 2)} onBlur={e => handleOpeningChange(selectedAccount, e.target.value)} className="w-full mt-1 text-base font-bold text-gray-900 border border-transparent hover:border-gray-200 rounded outline-none focus:border-[#1B8A7A] no-print" />
                    <div className="hidden print:block text-base font-bold">Rp {rupiah(selectedSummary.opening, 2)}</div>
                  </div>
                  <div className="bg-white p-3"><div className="text-[10px] text-gray-400 uppercase font-bold">Pemasukan</div><div className="text-base font-bold text-green-700 mt-1">Rp {rupiah(selectedSummary.income, 2)}</div></div>
                  <div className="bg-white p-3"><div className="text-[10px] text-gray-400 uppercase font-bold">Pengeluaran</div><div className="text-base font-bold text-red-600 mt-1">Rp {rupiah(selectedSummary.expense, 2)}</div></div>
                  <div className="bg-[#E1F5EE] p-3"><div className="text-[10px] text-[#0F6E56] uppercase font-bold">Saldo Akhir</div><div className="text-base font-bold text-[#1B8A7A] mt-1">Rp {rupiah(selectedSummary.balance, 2)}</div></div>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden print-card">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-green-700">PEMASUKAN</h3>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-gray-400">{incomeRows.filter(tx => tx.verified).length} / {incomeRows.length} terverifikasi</span>
                    <button onClick={() => setTxForm(v => ({ ...v, type: 'income', accountId: selectedAccount }))} className="no-print text-xs text-[#1B8A7A]">Gunakan form cepat di kiri</button>
                  </div>
                </div>
                <div className="overflow-x-auto"><table className="w-full text-xs min-w-[860px]"><thead className="bg-gray-50 text-gray-400 uppercase tracking-wide"><tr><th className="px-2 py-2 w-8 no-print"></th><th className="px-3 py-2 text-left">Tanggal</th><th className="px-3 py-2 text-left">Keterangan</th><th className="px-3 py-2 text-left">Kategori</th><th className="px-3 py-2 text-right">Nominal</th><th className="px-3 py-2 text-center no-print">Aksi</th></tr></thead>{renderRows(incomeRows, 'income')}</table></div>
              </div>

              <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden print-card">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-red-600">PENGELUARAN</h3>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-gray-400">{expenseRows.filter(tx => tx.verified).length} / {expenseRows.length} terverifikasi</span>
                    <button onClick={() => setTxForm(v => ({ ...v, type: 'expense', accountId: selectedAccount }))} className="no-print text-xs text-[#1B8A7A]">Gunakan form cepat di kiri</button>
                  </div>
                </div>
                <div className="overflow-x-auto"><table className="w-full text-xs min-w-[980px]"><thead className="bg-gray-50 text-gray-400 uppercase tracking-wide"><tr><th className="px-2 py-2 w-8 no-print"></th><th className="px-3 py-2 text-left">Tanggal</th><th className="px-3 py-2 text-left">Keterangan</th><th className="px-3 py-2 text-left">Kategori</th><th className="px-3 py-2 text-right">Nominal</th><th className="px-3 py-2 text-center no-print">Bukti</th><th className="px-3 py-2 text-center no-print">Aksi</th></tr></thead>{renderRows(expenseRows, 'expense')}</table></div>
              </div>
            </div>
          )}

          {selectedAccount === 'all' && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden print-card">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
              <div><h2 className="text-sm font-semibold text-gray-900">Daftar Mutasi Gabungan</h2><p className="text-xs text-gray-400">{visibleTransactions.length} transaksi tampil.</p></div>
              <div className="relative no-print"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari transaksi..." className="pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A]" /></div>
            </div>
            <div className="overflow-x-auto"><table className="w-full text-xs min-w-[860px]"><thead className="bg-gray-50 text-gray-400 uppercase tracking-wide"><tr><th className="px-4 py-2 text-left w-[16%]">Tanggal</th><th className="px-4 py-2 text-left w-[45%]">Keterangan</th><th className="px-4 py-2 text-left w-[19%]">Kategori</th><th className="px-4 py-2 text-right w-[20%]">Nominal</th></tr></thead><tbody>{visibleTransactions.map(tx => { const account = activeAccounts.find(item => item.id === tx.accountId); return <tr key={tx.id} className="border-t border-gray-50 hover:bg-gray-50/60"><td className="px-4 py-2 text-gray-600">{tx.date}</td><td className="px-4 py-2"><div className="font-medium text-gray-800">{tx.description}</div><div className="text-[10px] text-gray-400">{accountDisplayName(account)}</div></td><td className="px-4 py-2 text-gray-600">{tx.category}</td><td className={`px-4 py-2 text-right font-semibold ${tx.type === 'income' ? 'text-green-700' : 'text-red-600'}`}>{tx.type === 'income' ? '+' : '-'} Rp {rupiah(tx.amount, 2)}</td></tr> })}{visibleTransactions.length === 0 && <tr><td colSpan={4} className="px-4 py-10 text-center text-gray-400">Belum ada transaksi untuk filter ini.</td></tr>}</tbody></table></div>
          </div>
          )}
        </div>
      </div>

      {/* ── MODAL TAMBAH REKENING ── */}
      {showAddAccountModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 no-print" onClick={() => setShowAddAccountModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2"><WalletCards className="w-4 h-4 text-[#1B8A7A]" /><h2 className="text-sm font-semibold text-gray-900">Tambah Rekening</h2></div>
              <button onClick={() => setShowAddAccountModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            <div className="space-y-3">
              <input value={newAccount.companyName} onChange={e => setNewAccount(v => ({ ...v, companyName: e.target.value }))} placeholder="Nama PT / Entitas" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A]" />
              <div className="grid grid-cols-2 gap-2">
                <input value={newAccount.bankName} onChange={e => setNewAccount(v => ({ ...v, bankName: e.target.value }))} placeholder="Nama Bank / E-wallet" className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A]" />
                <input value={newAccount.accountNumber} onChange={e => setNewAccount(v => ({ ...v, accountNumber: e.target.value }))} placeholder="No rekening" className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A]" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select value={newAccount.type} onChange={e => setNewAccount(v => ({ ...v, type: e.target.value as AccountType }))} className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A] bg-white">
                  {ACCOUNT_TYPES.map(type => <option key={type} value={type}>{accountTypeLabel(type)}</option>)}
                </select>
                <input value={newAccount.opening} onChange={e => setNewAccount(v => ({ ...v, opening: e.target.value }))} placeholder="Saldo awal (opsional)" inputMode="numeric" className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A]" />
              </div>
              <input value={newAccount.name} onChange={e => setNewAccount(v => ({ ...v, name: e.target.value }))} placeholder="Nama alias opsional" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A]" />
              <button onClick={handleAddAccount} className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 bg-[#1B8A7A] text-white text-sm font-semibold rounded-lg hover:bg-[#0F6E56]">
                <Plus className="w-4 h-4" /> Tambah Rekening
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── MODAL MULTI-LINK TRANSAKSI ── */}
      {linkingTx && (() => {
        const totalAllocated = linkItems.reduce((s, it) => s + toNumber(it.amount), 0)
        const txAmount = linkingTx.amount
        const over = totalAllocated > txAmount + 1
        const under = totalAllocated < txAmount - 1 && linkItems.length > 0
        const alreadyLinked = linkMatches.filter(d => linkItems.some(it => it.doc.docType === d.docType && it.doc.doc.id === d.doc.id && it.doc.year === d.year))

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 no-print" onClick={() => { setLinkingTx(null); setLinkItems([]) }}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 flex flex-col max-h-[88vh]" onClick={e => e.stopPropagation()}>

              {/* Header */}
              <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">Link ke Invoice / Quotation</h2>
                  <p className="text-xs text-gray-400 mt-0.5 truncate max-w-[320px]">{linkingTx.description}</p>
                  <p className="text-xs font-semibold text-gray-800 mt-1">Nominal transfer: <span className="text-[#1B8A7A]">Rp {rupiah(txAmount, 0)}</span></p>
                </div>
                <button onClick={() => { setLinkingTx(null); setLinkItems([]) }} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4 text-gray-500" /></button>
              </div>

              {/* Daftar yang sudah ditambahkan */}
              {linkItems.length > 0 && (
                <div className="px-5 py-3 border-b border-gray-100 flex-shrink-0 space-y-2">
                  <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Dipilih ({linkItems.length})</div>
                  {linkItems.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${item.doc.docType === 'invoice' ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'}`}>
                        {item.doc.docType === 'invoice' ? 'INV' : 'QUO'}
                      </span>
                      <span className="text-xs font-medium text-gray-800 flex-1 truncate">{item.doc.docNo} · {item.doc.client}</span>
                      <input
                        value={item.amount}
                        onChange={e => setLinkItems(prev => prev.map((it, i) => i === idx ? { ...it, amount: e.target.value } : it))}
                        placeholder="Nominal"
                        inputMode="numeric"
                        className="w-32 px-2 py-1 text-xs border border-gray-200 rounded-lg text-right outline-none focus:border-[#1B8A7A]"
                      />
                      <button onClick={() => setLinkItems(prev => prev.filter((_, i) => i !== idx))} className="p-1 text-gray-400 hover:text-red-600 flex-shrink-0"><X className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}

                  {/* Ringkasan alokasi */}
                  <div className="pt-2 border-t border-gray-100 space-y-1">
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>Total dialokasikan</span>
                      <span className={`font-semibold ${over ? 'text-red-600' : under ? 'text-amber-600' : 'text-green-700'}`}>Rp {rupiah(totalAllocated, 0)}</span>
                    </div>
                    {over && <div className="text-xs text-red-600 font-semibold">⚠ Melebihi nominal transfer Rp {rupiah(totalAllocated - txAmount, 0)}</div>}
                    {under && <div className="text-xs text-amber-600">⚠ Sisa Rp {rupiah(txAmount - totalAllocated, 0)} belum teralokasi — tetap bisa disimpan</div>}
                    {!over && !under && linkItems.length > 0 && <div className="text-xs text-green-700 font-semibold">✓ Alokasi sesuai nominal transfer</div>}
                  </div>

                  <button
                    onClick={handleMultiLinkTx}
                    disabled={saving || over || linkItems.every(it => toNumber(it.amount) <= 0)}
                    className="w-full py-2 text-sm font-semibold rounded-lg bg-[#1B8A7A] text-white hover:bg-[#0F6E56] disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {saving ? 'Menyimpan...' : 'Simpan Link'}
                  </button>
                </div>
              )}

              {/* Search */}
              <div className="px-5 py-3 flex-shrink-0">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                  <input autoFocus={linkItems.length === 0} value={linkSearch} onChange={e => setLinkSearch(e.target.value)} placeholder="Cari nomor, klien, brand, tahun..." className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A]" />
                </div>
              </div>

              {/* Hasil pencarian */}
              <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-1">
                {linkSearch.trim() === '' ? (
                  <div className="text-xs text-gray-400 text-center py-6">Ketik untuk mencari invoice atau quotation dari semua tahun</div>
                ) : linkMatches.length === 0 ? (
                  <div className="text-xs text-gray-400 text-center py-6">Tidak ditemukan</div>
                ) : linkMatches.map(d => {
                  const alreadyAdded = linkItems.some(it => it.doc.docType === d.docType && it.doc.doc.id === d.doc.id && it.doc.year === d.year)
                  return (
                    <div key={`${d.docType}-${d.year}-${d.doc.id}`} className={`flex items-start justify-between gap-2 px-3 py-2.5 rounded-xl border ${alreadyAdded ? 'border-[#1B8A7A]/30 bg-[#E1F5EE]/40' : 'border-gray-100 hover:bg-gray-50'}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${d.docType === 'invoice' ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'}`}>{d.docType === 'invoice' ? 'INV' : 'QUO'}</span>
                          <span className="text-xs font-semibold text-gray-900">{d.docNo}</span>
                          <span className="text-[10px] text-gray-400">{d.year}</span>
                        </div>
                        <div className="text-[11px] text-gray-500 mt-0.5 truncate">{d.client} · {d.brand || '-'}</div>
                        <div className="text-[10px] text-gray-400">Total Rp {rupiah(d.total, 0)} · Sisa Rp {rupiah(d.remaining, 0)}</div>
                      </div>
                      {alreadyAdded ? (
                        <span className="text-[10px] text-[#1B8A7A] font-semibold flex-shrink-0 pt-1">Ditambahkan</span>
                      ) : (
                        <button
                          onClick={() => setLinkItems(prev => [...prev, { doc: d, amount: String(Math.round(Math.max(0, d.remaining || d.total || 0))) }])}
                          className="flex-shrink-0 px-2.5 py-1 text-xs bg-[#1B8A7A] text-white rounded-lg hover:bg-[#0F6E56] mt-0.5"
                        >+ Tambah</button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
