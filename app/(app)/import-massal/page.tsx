'use client'
import { useYearList, getActiveYear, persistActiveYear } from '@/lib/use-active-year'

import { ChangeEvent, useMemo, useState } from 'react'
import { CheckCircle2, Database, Download, FileSpreadsheet, Info, Upload, XCircle } from 'lucide-react'
import { fetchDocs, saveDocs } from '@/lib/rtdb'
import type { Doc, DocStatus } from '@/types/document'
import {
  MONTHS,
  fetchAccounts,
  fetchMonth,
  makeId,
  monthKey,
  rupiah,
  saveAccounts,
  saveMonth,
  toNumber,
  type AccountType,
  type FinanceAccount,
  type FinanceTransaction,
  type TxType,
} from '@/lib/finance'


type CsvRow = Record<string, string>
type DocImportMode = 'auto' | 'q' | 'i'
type DuplicateMode = 'skip' | 'replace' | 'append'

interface PendingDoc {
  year: number
  kind: 'q' | 'i'
  no: string
  client: string
  items: number
  total: number
  doc: Doc
}

interface ImportResult {
  ok: boolean
  message: string
}

function splitCsvLine(line: string) {
  const cells: string[] = []
  let current = ''
  let quoted = false

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    const next = line[i + 1]

    if (ch === '"' && quoted && next === '"') {
      current += '"'
      i += 1
    } else if (ch === '"') {
      quoted = !quoted
    } else if ((ch === ',' || ch === ';') && !quoted) {
      cells.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }

  cells.push(current.trim())
  return cells
}

function parseCsv(text: string): CsvRow[] {
  const lines = text.replace(/\r/g, '').split('\n').filter(line => line.trim())
  if (lines.length < 2) return []

  const header = splitCsvLine(lines[0]).map(item => item.trim().toLowerCase())
  return lines.slice(1).map(line => {
    const cells = splitCsvLine(line)
    const row: CsvRow = {}
    header.forEach((key, idx) => { row[key] = cells[idx] || '' })
    return row
  })
}

function value(row: CsvRow, keys: string[], fallback = '') {
  for (const key of keys) {
    const found = row[key.toLowerCase()]
    if (found !== undefined && String(found).trim() !== '') return String(found).trim()
  }
  return fallback
}

function csvEscape(cell: string | number) {
  return `"${String(cell).replace(/"/g, '""')}"`
}

function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  const csv = rows.map(row => row.map(csvEscape).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function parseMonth(rawValue: string, fallback: number) {
  const raw = String(rawValue || '').trim().toLowerCase()
  const asNum = Number(raw)
  if (asNum >= 1 && asNum <= 12) return asNum
  const found = MONTHS.find(month => month.name.toLowerCase() === raw || month.short.toLowerCase() === raw)
  return found?.no || fallback
}

function normalizeDocKind(raw: string, mode: DocImportMode): 'q' | 'i' {
  if (mode === 'q' || mode === 'i') return mode
  const lower = raw.toLowerCase()
  if (lower.includes('inv') || lower.includes('invoice')) return 'i'
  return 'q'
}

function normalizeStatus(raw: string): DocStatus {
  const low = raw.toLowerCase()
  if (low.includes('lunas') && !low.includes('belum')) return 'Lunas'
  if (low.includes('belum')) return 'Belum Lunas'
  if (low.includes('over')) return 'Overdue'
  if (low.includes('terbit')) return 'Terbit'
  return 'Draft'
}

function getDocNo(row: CsvRow, kind: 'q' | 'i') {
  return value(row, kind === 'q'
    ? ['no dokumen', 'no quotation', 'quotation', 'q-no', 'nomor', 'no']
    : ['no dokumen', 'no invoice', 'invoice', 'i-no', 'nomor', 'no']
  )
}

function docTotal(doc: Doc) {
  const subtotal = doc.items.reduce((sum, item) => sum + Number(item.amount || 0), 0)
  return subtotal - toNumber(doc.fields['q-disc'] || '') + toNumber(doc.fields['q-gross'] || '')
}

function buildPendingDocs(rows: CsvRow[], mode: DocImportMode, defaultYear: number): PendingDoc[] {
  const groups = new Map<string, CsvRow[]>()

  for (const row of rows) {
    const kind = normalizeDocKind(value(row, ['jenis dokumen', 'jenis_dokumen', 'type', 'tipe']), mode)
    const year = Number(value(row, ['tahun', 'year'], String(defaultYear))) || defaultYear
    const no = getDocNo(row, kind)
    if (!no) continue
    const key = `${year}|${kind}|${no}`
    const group = groups.get(key) || []
    group.push(row)
    groups.set(key, group)
  }

  return Array.from(groups.entries()).map(([key, group]) => {
    const [yearRaw, kindRaw, no] = key.split('|')
    const year = Number(yearRaw)
    const kind = kindRaw as 'q' | 'i'
    const first = group[0]
    const client = value(first, ['client', 'klien', 'nama client', 'cl-name'])
    const date = value(first, kind === 'q' ? ['tanggal', 'tanggal quotation', 'q-date'] : ['tanggal', 'tanggal invoice', 'i-date'])
    const discount = value(first, ['diskon', 'discount', 'q-disc'], '0')
    const gross = value(first, ['gross up', 'gross_up', 'q-gross'], '0')
    const theme = kind === 'q' ? '#1B8A7A' : '#185FA5'
    const items = group.map(row => ({
      brand: value(row, ['brand', 'merek']),
      item: value(row, ['item', 'produk', 'campaign']),
      sow: value(row, ['sow', 'scope', 'scope of work', 'deskripsi']),
      amount: toNumber(value(row, ['nominal', 'amount', 'nilai', 'harga'], '0')),
    })).filter(item => item.brand || item.item || item.sow || item.amount)

    const doc: Doc = {
      id: Date.now() + Math.floor(Math.random() * 1000000),
      savedAt: new Date().toISOString(),
      theme,
      logoData: null,
      sigData: null,
      sigNW: 0,
      sigNH: 0,
      showSub: true,
      fields: {
        'cl-name': client,
        'cl-addr': value(first, ['alamat client', 'client address', 'cl-addr']),
        'cl-pic': value(first, ['pic', 'cl-pic']),
        'cl-phone': value(first, ['phone', 'telp', 'cl-phone']),
        'q-disc': String(toNumber(discount)),
        'q-gross': String(toNumber(gross)),
        'q-cur': value(first, ['currency', 'mata uang'], 'IDR'),
      },
      items,
    }

    if (kind === 'q') {
      doc.fields['q-no'] = no
      doc.fields['q-date'] = date
      doc.fields['q-notes'] = value(first, ['catatan', 'notes', 'q-notes'])
    } else {
      doc.fields['i-no'] = no
      doc.fields['i-date'] = date
      doc.fields['i-due'] = value(first, ['due date', 'jatuh tempo', 'i-due'])
      doc.fields['i-term'] = value(first, ['term', 'payment term', 'i-term'])
      doc.fields['i-ref'] = value(first, ['ref quotation', 'referensi quotation', 'i-ref'])
      doc.fields['i-status'] = normalizeStatus(value(first, ['status', 'i-status']))
      doc.fields['i-notes'] = value(first, ['catatan', 'notes', 'i-notes'])
    }

    return { year, kind, no, client, items: items.length, total: docTotal(doc), doc }
  })
}

function downloadDocumentTemplate() {
  downloadCsv('Template_Import_Dokumen_FinanceBub.csv', [
    ['JENIS DOKUMEN', 'TAHUN', 'NO DOKUMEN', 'TANGGAL', 'CLIENT', 'ALAMAT CLIENT', 'PIC', 'PHONE', 'BRAND', 'ITEM', 'SOW', 'NOMINAL', 'DISKON', 'GROSS UP', 'STATUS', 'DUE DATE', 'TERM', 'REF QUOTATION', 'CATATAN'],
    ['Quotation', 2026, 'QTT-BUB-0326-01', '2026-03-02', 'PT Contoh Brand Indonesia', 'Jakarta', 'Budi', '08123456789', 'Contoh Brand', 'YouTube Review', '1 dedicated video', 50000000, 0, 0, '', '', '', '', 'Harga belum termasuk PPN'],
    ['Invoice', 2026, 'INV-BUB-0326-01', '2026-03-10', 'PT Contoh Brand Indonesia', 'Jakarta', 'Budi', '08123456789', 'Contoh Brand', 'YouTube Review', '1 dedicated video', 50000000, 0, 0, 'Terbit', '2026-03-24', '14 hari', 'QTT-BUB-0326-01', 'Pembayaran ke rekening perusahaan'],
  ])
}

function downloadMutasiTemplate() {
  downloadCsv('Template_Import_Mutasi_FinanceBub.csv', [
    ['TAHUN', 'BULAN', 'NAMA PT', 'BANK', 'NO REKENING', 'TIPE REKENING', 'JENIS', 'TANGGAL', 'KETERANGAN', 'NOMINAL', 'KATEGORI', 'SALDO AWAL'],
    [2026, 'Maret', 'PT FinanceBub', 'BCA', '6270344940', 'Bank', 'MASUK', '2026-03-02', 'Pembayaran invoice brand', 50000000, 'Pendapatan Jasa', 1121453564],
    [2026, 'Maret', 'PT FinanceBub', 'BCA', '6270344940', 'Bank', 'KELUAR', '2026-03-05', 'Bayar biaya produksi', 1300000, 'HPP / Biaya Produksi', ''],
    [2026, 'Maret', 'PT FinanceBub', 'DANA', '08123456789', 'E-Wallet', 'KELUAR', '2026-03-08', 'Operasional kecil', 250000, 'Operasional', 2000000],
  ])
}

function normalizeAccountType(raw: string): AccountType {
  const low = raw.toLowerCase()
  if (low.includes('kas') || low.includes('cash')) return 'cash'
  if (low.includes('wallet') || low.includes('dana') || low.includes('ovo') || low.includes('gopay') || low.includes('shopee')) return 'ewallet'
  if (low.includes('lain')) return 'other'
  return 'bank'
}

function normalizeTxType(raw: string): TxType {
  const low = raw.toLowerCase()
  if (low.includes('keluar') || low.includes('expense') || low.includes('out') || low.includes('debit')) return 'expense'
  return 'income'
}

function makeFinancePreview(rows: CsvRow[], defaultYear: number) {
  const valid = rows.filter(row => toNumber(value(row, ['nominal', 'amount', 'nilai'], '0')) > 0 || toNumber(value(row, ['saldo awal', 'saldo_awal'], '0')) > 0)
  const periods = new Set(valid.map(row => `${Number(value(row, ['tahun', 'year'], String(defaultYear))) || defaultYear}-${String(parseMonth(value(row, ['bulan', 'month'], ''), new Date().getMonth() + 1)).padStart(2, '0')}`))
  const accounts = new Set(valid.map(row => `${value(row, ['nama pt', 'pt', 'company'])}|${value(row, ['bank', 'bank / e-wallet', 'e-wallet'])}|${value(row, ['no rekening', 'rekening', 'no rek'])}`))
  const txCount = valid.filter(row => toNumber(value(row, ['nominal', 'amount', 'nilai'], '0')) > 0).length
  const openingCount = valid.filter(row => toNumber(value(row, ['saldo awal', 'saldo_awal'], '0')) > 0).length
  return { periods: periods.size, accounts: accounts.size, txCount, openingCount }
}

export default function ImportMassalPage() {
  const YEARS = useYearList()
  const [activeTab, setActiveTab] = useState<'dokumen' | 'mutasi'>('dokumen')
  const [year, setYear] = useState(() => getActiveYear())
  const [docMode, setDocMode] = useState<DocImportMode>('auto')
  const [duplicateMode, setDuplicateMode] = useState<DuplicateMode>('skip')
  const [docRows, setDocRows] = useState<CsvRow[]>([])
  const [pendingDocs, setPendingDocs] = useState<PendingDoc[]>([])
  const [mutasiRows, setMutasiRows] = useState<CsvRow[]>([])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)

  const financePreview = useMemo(() => makeFinancePreview(mutasiRows, year), [mutasiRows, year])
  const docSummary = useMemo(() => ({
    quotations: pendingDocs.filter(item => item.kind === 'q').length,
    invoices: pendingDocs.filter(item => item.kind === 'i').length,
    total: pendingDocs.reduce((sum, item) => sum + item.total, 0),
  }), [pendingDocs])

  const handleDocumentFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    setResult(null)
    if (!file) return
    const rows = parseCsv(await file.text())
    const pending = buildPendingDocs(rows, docMode, year)
    setDocRows(rows)
    setPendingDocs(pending)
    if (!pending.length) setResult({ ok: false, message: 'File terbaca, tapi tidak ada dokumen valid. Cek kolom NO DOKUMEN dan JENIS DOKUMEN.' })
  }

  const handleMutasiFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    setResult(null)
    if (!file) return
    const rows = parseCsv(await file.text())
    setMutasiRows(rows)
    if (!rows.length) setResult({ ok: false, message: 'CSV kosong atau format tidak terbaca.' })
  }

  const commitDocuments = async () => {
    if (!pendingDocs.length) return alert('Belum ada dokumen untuk di-import')
    setLoading(true)
    setResult(null)
    try {
      let saved = 0
      let skipped = 0
      const groups = new Map<string, PendingDoc[]>()
      for (const item of pendingDocs) {
        const key = `${item.year}|${item.kind}`
        const group = groups.get(key) || []
        group.push(item)
        groups.set(key, group)
      }

      for (const [key, rows] of groups.entries()) {
        const [yearRaw, kindRaw] = key.split('|')
        const targetYear = Number(yearRaw)
        const kind = kindRaw as 'q' | 'i'
        const existing = await fetchDocs(targetYear, kind)
        const noKey = kind === 'q' ? 'q-no' : 'i-no'
        let next = [...existing]

        for (const row of rows) {
          const existingIndex = next.findIndex(doc => doc.fields?.[noKey] === row.no)
          if (existingIndex >= 0 && duplicateMode === 'skip') {
            skipped += 1
            continue
          }
          if (existingIndex >= 0 && duplicateMode === 'replace') {
            next = next.map((doc, idx) => idx === existingIndex ? row.doc : doc)
          } else {
            next = [{ ...row.doc, id: Date.now() + saved + Math.floor(Math.random() * 1000) }, ...next]
          }
          saved += 1
        }

        await saveDocs(targetYear, kind, next)
      }

      setResult({ ok: true, message: `Import dokumen selesai: ${saved} dokumen disimpan${skipped ? `, ${skipped} duplikat dilewati` : ''}.` })
      setDocRows([])
      setPendingDocs([])
    } catch (error) {
      setResult({ ok: false, message: `Import dokumen gagal: ${error instanceof Error ? error.message : 'unknown error'}` })
    } finally {
      setLoading(false)
    }
  }

  const commitMutasi = async () => {
    if (!mutasiRows.length) return alert('Belum ada mutasi untuk di-import')
    setLoading(true)
    setResult(null)
    try {
      const nextAccounts = await fetchAccounts()
      const accountKey = (pt: string, bank: string, no: string) => `${pt.toLowerCase()}|${bank.toLowerCase()}|${no}`
      const accountMap = new Map(nextAccounts.map(account => [accountKey(account.companyName || '', account.bankName || '', account.accountNumber || ''), account]))
      const grouped = new Map<string, { opening: Record<string, number>, txs: FinanceTransaction[] }>()

      for (const row of mutasiRows) {
        const targetYear = Number(value(row, ['tahun', 'year'], String(year))) || year
        const targetMonth = parseMonth(value(row, ['bulan', 'month'], ''), new Date().getMonth() + 1)
        const pt = value(row, ['nama pt', 'pt', 'company'])
        const bank = value(row, ['bank', 'nama bank', 'bank / e-wallet', 'e-wallet'])
        const no = value(row, ['no rekening', 'rekening', 'no rek', 'account number'])
        const type = normalizeAccountType(value(row, ['tipe rekening', 'tipe', 'jenis rekening'], bank))
        const key = accountKey(pt, bank, no)

        let account = accountMap.get(key)
        if (!account) {
          account = {
            id: makeId('acc'),
            name: [pt, [bank, no].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || 'Rekening Import',
            type,
            companyName: pt,
            bankName: bank,
            accountNumber: no,
            activeFrom: monthKey(targetYear, targetMonth),
            createdAt: new Date().toISOString(),
          } satisfies FinanceAccount
          accountMap.set(key, account)
          nextAccounts.push(account)
        }

        const groupKey = `${targetYear}-${String(targetMonth).padStart(2, '0')}`
        const group = grouped.get(groupKey) || { opening: {}, txs: [] }
        const opening = toNumber(value(row, ['saldo awal', 'saldo_awal'], ''))
        if (opening) group.opening[account.id] = opening

        const amount = toNumber(value(row, ['nominal', 'amount', 'nilai'], '0'))
        if (amount > 0) {
          group.txs.push({
            id: makeId('tx'),
            date: value(row, ['tanggal', 'tgl', 'date'], `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`),
            description: value(row, ['keterangan', 'deskripsi', 'description'], 'Import mutasi'),
            category: value(row, ['kategori', 'category'], 'Tanpa Kategori'),
            type: normalizeTxType(value(row, ['jenis', 'type', 'tipe'], 'MASUK')),
            accountId: account.id,
            amount,
            createdAt: new Date().toISOString(),
          })
        }
        grouped.set(groupKey, group)
      }

      await saveAccounts(nextAccounts)
      let imported = 0
      for (const [period, group] of grouped.entries()) {
        const [targetYear, targetMonth] = period.split('-').map(Number)
        const existing = await fetchMonth(targetYear, targetMonth)
        imported += group.txs.length
        await saveMonth({
          ...existing,
          openingBalances: { ...existing.openingBalances, ...group.opening },
          transactions: [...existing.transactions, ...group.txs],
          categories: Array.from(new Set([...(existing.categories || []), ...group.txs.map(tx => tx.category)])),
        })
      }

      setResult({ ok: true, message: `Import mutasi selesai: ${imported} transaksi, ${nextAccounts.length} total rekening aktif/tersimpan.` })
      setMutasiRows([])
    } catch (error) {
      setResult({ ok: false, message: `Import mutasi gagal: ${error instanceof Error ? error.message : 'unknown error'}` })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Import Massal</h1>
          <p className="text-sm text-gray-400 mt-0.5">Pusat import data dokumen dan mutasi agar tidak input manual satu-satu.</p>
        </div>
        <select value={year} onChange={e => { const nextYear = Number(e.target.value); setYear(nextYear); persistActiveYear(nextYear) }} className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white outline-none focus:border-[#1B8A7A]">
          {YEARS.map(item => <option key={item} value={item}>{item}</option>)}
        </select>
      </div>

      <div className="flex gap-2 mb-5">
        <button onClick={() => setActiveTab('dokumen')} className={`px-4 py-2 rounded-lg text-sm font-semibold ${activeTab === 'dokumen' ? 'bg-[#1B8A7A] text-white' : 'bg-white border border-gray-100 text-gray-600 hover:bg-gray-50'}`}>Dokumen</button>
        <button onClick={() => setActiveTab('mutasi')} className={`px-4 py-2 rounded-lg text-sm font-semibold ${activeTab === 'mutasi' ? 'bg-[#1B8A7A] text-white' : 'bg-white border border-gray-100 text-gray-600 hover:bg-gray-50'}`}>Mutasi Kas/Bank</button>
      </div>

      {result && (
        <div className={`mb-5 rounded-xl border px-4 py-3 text-sm flex items-start gap-2 ${result.ok ? 'bg-green-50 border-green-100 text-green-700' : 'bg-red-50 border-red-100 text-red-700'}`}>
          {result.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5" /> : <XCircle className="w-4 h-4 mt-0.5" />}
          <span>{result.message}</span>
        </div>
      )}

      {activeTab === 'dokumen' && (
        <div className="grid grid-cols-[360px_1fr] gap-5">
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-4">
                <FileSpreadsheet className="w-5 h-5 text-[#1B8A7A]" />
                <h2 className="text-sm font-semibold text-gray-900">Import Quotation / Invoice</h2>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-gray-500">Mode Import</label>
                  <select value={docMode} onChange={e => setDocMode(e.target.value as DocImportMode)} className="w-full mt-1 px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A] bg-white">
                    <option value="auto">Otomatis dari kolom JENIS DOKUMEN</option>
                    <option value="q">Paksa semua jadi Quotation</option>
                    <option value="i">Paksa semua jadi Invoice</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500">Saat nomor dokumen sudah ada</label>
                  <select value={duplicateMode} onChange={e => setDuplicateMode(e.target.value as DuplicateMode)} className="w-full mt-1 px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A] bg-white">
                    <option value="skip">Lewati duplikat</option>
                    <option value="replace">Ganti data lama</option>
                    <option value="append">Tetap tambahkan sebagai data baru</option>
                  </select>
                </div>
                <button onClick={downloadDocumentTemplate} className="w-full flex items-center justify-center gap-1.5 px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50">
                  <Download className="w-4 h-4" /> Download Template Dokumen
                </button>
                <label className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-[#1B8A7A] text-white rounded-lg text-sm font-semibold cursor-pointer hover:bg-[#0F6E56]">
                  <Upload className="w-4 h-4" /> Pilih CSV Dokumen
                  <input type="file" accept=".csv,text/csv" onChange={handleDocumentFile} className="hidden" />
                </label>
                <button onClick={commitDocuments} disabled={loading || pendingDocs.length === 0} className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-gray-900 text-white rounded-lg text-sm font-semibold hover:bg-black disabled:opacity-40">
                  <Database className="w-4 h-4" /> {loading ? 'Mengimport...' : 'Import ke Database'}
                </button>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-xs text-blue-700 leading-relaxed">
              <div className="flex gap-2"><Info className="w-4 h-4 flex-shrink-0 mt-0.5" /><div>Untuk dokumen dengan banyak item, gunakan nomor dokumen yang sama di beberapa baris. Sistem akan menggabungkannya jadi satu Quotation/Invoice.</div></div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white rounded-xl border border-gray-100 p-4"><div className="text-[10px] text-gray-400 uppercase font-bold">Quotation</div><div className="text-xl font-bold text-[#1B8A7A] mt-1">{docSummary.quotations}</div></div>
              <div className="bg-white rounded-xl border border-gray-100 p-4"><div className="text-[10px] text-gray-400 uppercase font-bold">Invoice</div><div className="text-xl font-bold text-blue-700 mt-1">{docSummary.invoices}</div></div>
              <div className="bg-white rounded-xl border border-gray-100 p-4"><div className="text-[10px] text-gray-400 uppercase font-bold">Total Nilai</div><div className="text-xl font-bold text-gray-900 mt-1">Rp {rupiah(docSummary.total)}</div></div>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100"><h2 className="text-sm font-semibold text-gray-900">Preview Dokumen</h2><p className="text-xs text-gray-400">{docRows.length} baris CSV terbaca · {pendingDocs.length} dokumen siap import.</p></div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[760px]">
                  <thead className="bg-gray-50 text-gray-400 uppercase"><tr><th className="px-4 py-2 text-left">Jenis</th><th className="px-4 py-2 text-left">Tahun</th><th className="px-4 py-2 text-left">Nomor</th><th className="px-4 py-2 text-left">Client</th><th className="px-4 py-2 text-right">Item</th><th className="px-4 py-2 text-right">Total</th></tr></thead>
                  <tbody>
                    {pendingDocs.slice(0, 20).map(item => <tr key={`${item.year}-${item.kind}-${item.no}`} className="border-t border-gray-50"><td className="px-4 py-2 font-semibold">{item.kind === 'q' ? 'Quotation' : 'Invoice'}</td><td className="px-4 py-2">{item.year}</td><td className="px-4 py-2">{item.no}</td><td className="px-4 py-2">{item.client || '-'}</td><td className="px-4 py-2 text-right">{item.items}</td><td className="px-4 py-2 text-right font-semibold">Rp {rupiah(item.total)}</td></tr>)}
                    {pendingDocs.length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400">Belum ada file dipilih.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'mutasi' && (
        <div className="grid grid-cols-[360px_1fr] gap-5">
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-4">
                <FileSpreadsheet className="w-5 h-5 text-[#1B8A7A]" />
                <h2 className="text-sm font-semibold text-gray-900">Import Mutasi Multi Rekening</h2>
              </div>
              <div className="space-y-3">
                <button onClick={downloadMutasiTemplate} className="w-full flex items-center justify-center gap-1.5 px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50">
                  <Download className="w-4 h-4" /> Download Template Mutasi
                </button>
                <label className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-[#1B8A7A] text-white rounded-lg text-sm font-semibold cursor-pointer hover:bg-[#0F6E56]">
                  <Upload className="w-4 h-4" /> Pilih CSV Mutasi
                  <input type="file" accept=".csv,text/csv" onChange={handleMutasiFile} className="hidden" />
                </label>
                <button onClick={commitMutasi} disabled={loading || mutasiRows.length === 0} className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-gray-900 text-white rounded-lg text-sm font-semibold hover:bg-black disabled:opacity-40">
                  <Database className="w-4 h-4" /> {loading ? 'Mengimport...' : 'Import ke Mutasi'}
                </button>
              </div>
            </div>
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-xs text-amber-700 leading-relaxed">
              Import mutasi akan membuat rekening otomatis jika kombinasi Nama PT + Bank + Nomor Rekening belum ada. Saldo awal hanya diisi jika kolom SALDO AWAL tidak kosong.
            </div>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-white rounded-xl border border-gray-100 p-4"><div className="text-[10px] text-gray-400 uppercase font-bold">Baris CSV</div><div className="text-xl font-bold text-gray-900 mt-1">{mutasiRows.length}</div></div>
              <div className="bg-white rounded-xl border border-gray-100 p-4"><div className="text-[10px] text-gray-400 uppercase font-bold">Periode</div><div className="text-xl font-bold text-[#1B8A7A] mt-1">{financePreview.periods}</div></div>
              <div className="bg-white rounded-xl border border-gray-100 p-4"><div className="text-[10px] text-gray-400 uppercase font-bold">Rekening</div><div className="text-xl font-bold text-blue-700 mt-1">{financePreview.accounts}</div></div>
              <div className="bg-white rounded-xl border border-gray-100 p-4"><div className="text-[10px] text-gray-400 uppercase font-bold">Transaksi</div><div className="text-xl font-bold text-gray-900 mt-1">{financePreview.txCount}</div></div>
            </div>

            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100"><h2 className="text-sm font-semibold text-gray-900">Preview Mutasi</h2><p className="text-xs text-gray-400">Menampilkan 20 baris pertama dari file CSV.</p></div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[900px]">
                  <thead className="bg-gray-50 text-gray-400 uppercase"><tr><th className="px-4 py-2 text-left">Tahun</th><th className="px-4 py-2 text-left">Bulan</th><th className="px-4 py-2 text-left">PT</th><th className="px-4 py-2 text-left">Bank</th><th className="px-4 py-2 text-left">Jenis</th><th className="px-4 py-2 text-left">Tanggal</th><th className="px-4 py-2 text-left">Keterangan</th><th className="px-4 py-2 text-right">Nominal</th></tr></thead>
                  <tbody>
                    {mutasiRows.slice(0, 20).map((row, idx) => <tr key={`${idx}-${value(row, ['tanggal', 'tgl'])}-${value(row, ['keterangan'])}`} className="border-t border-gray-50"><td className="px-4 py-2">{value(row, ['tahun', 'year'], String(year))}</td><td className="px-4 py-2">{value(row, ['bulan', 'month'])}</td><td className="px-4 py-2">{value(row, ['nama pt', 'pt', 'company'])}</td><td className="px-4 py-2">{value(row, ['bank', 'nama bank', 'bank / e-wallet'])}</td><td className="px-4 py-2">{value(row, ['jenis', 'type', 'tipe'])}</td><td className="px-4 py-2">{value(row, ['tanggal', 'tgl', 'date'])}</td><td className="px-4 py-2">{value(row, ['keterangan', 'deskripsi', 'description'])}</td><td className="px-4 py-2 text-right font-semibold">Rp {rupiah(toNumber(value(row, ['nominal', 'amount', 'nilai'], '0')))}</td></tr>)}
                    {mutasiRows.length === 0 && <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400">Belum ada file dipilih.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
