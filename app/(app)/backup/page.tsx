'use client'
import { useYearList } from '@/lib/use-active-year'

import { ChangeEvent, useMemo, useState } from 'react'
import { ArchiveRestore, CheckCircle2, Database, Download, RefreshCw, ShieldCheck, Upload, XCircle } from 'lucide-react'
import { fetchDocs, saveDocs } from '@/lib/rtdb'
import type { Doc } from '@/types/document'
import {
  MONTHS,
  fetchAccounts,
  fetchCategoryMaps,
  fetchMonth,
  saveAccounts,
  saveCategoryMaps,
  saveMonth,
  type FinanceAccount,
  type FinanceCategoryMap,
  type FinanceMonthData,
} from '@/lib/finance'


interface BackupPayload {
  app: 'FinanceBub'
  version: string
  exportedAt: string
  years: number[]
  documents: Record<string, { quotation: Doc[]; invoice: Doc[] }>
  finance: {
    accounts: FinanceAccount[]
    categoryMaps: FinanceCategoryMap[]
    months: FinanceMonthData[]
  }
}

interface BackupStats {
  quotation: number
  invoice: number
  accounts: number
  months: number
  transactions: number
}

interface ResultMessage {
  ok: boolean
  message: string
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function getStats(payload: BackupPayload | null): BackupStats {
  if (!payload) return { quotation: 0, invoice: 0, accounts: 0, months: 0, transactions: 0 }
  const documentStats = Object.values(payload.documents || {}).reduce((acc, item) => ({
    quotation: acc.quotation + (item.quotation?.length || 0),
    invoice: acc.invoice + (item.invoice?.length || 0),
  }), { quotation: 0, invoice: 0 })
  return {
    ...documentStats,
    accounts: payload.finance?.accounts?.length || 0,
    months: payload.finance?.months?.length || 0,
    transactions: payload.finance?.months?.reduce((sum, item) => sum + (item.transactions?.length || 0), 0) || 0,
  }
}

function emptyPayload(years: number[]): BackupPayload {
  return {
    app: 'FinanceBub',
    version: 'finance-suite-backup-v1',
    exportedAt: new Date().toISOString(),
    years,
    documents: {},
    finance: { accounts: [], categoryMaps: [], months: [] },
  }
}

export default function BackupPage() {
  const YEARS = useYearList()
  const [selectedYears, setSelectedYears] = useState<number[]>([new Date().getFullYear()])
  const [includeDocuments, setIncludeDocuments] = useState(true)
  const [includeFinance, setIncludeFinance] = useState(true)
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<BackupPayload | null>(null)
  const [restorePayload, setRestorePayload] = useState<BackupPayload | null>(null)
  const [result, setResult] = useState<ResultMessage | null>(null)

  const previewStats = useMemo(() => getStats(preview), [preview])
  const restoreStats = useMemo(() => getStats(restorePayload), [restorePayload])

  const toggleYear = (year: number) => {
    setSelectedYears(current => current.includes(year) ? current.filter(item => item !== year) : [...current, year].sort())
  }

  const buildBackup = async () => {
    if (!selectedYears.length) return alert('Pilih minimal 1 tahun')
    setLoading(true)
    setResult(null)
    try {
      const payload = emptyPayload(selectedYears)

      if (includeDocuments) {
        for (const year of selectedYears) {
          const [quotation, invoice] = await Promise.all([fetchDocs(year, 'q'), fetchDocs(year, 'i')])
          payload.documents[String(year)] = { quotation, invoice }
        }
      }

      if (includeFinance) {
        const [accounts, categoryMaps] = await Promise.all([fetchAccounts(), fetchCategoryMaps()])
        payload.finance.accounts = accounts
        payload.finance.categoryMaps = categoryMaps
        for (const year of selectedYears) {
          for (const month of MONTHS) {
            const data = await fetchMonth(year, month.no)
            if ((data.transactions?.length || 0) > 0 || Object.keys(data.openingBalances || {}).length > 0) {
              payload.finance.months.push(data)
            }
          }
        }
      }

      setPreview(payload)
      setResult({ ok: true, message: 'Backup berhasil disiapkan. Klik Download JSON untuk menyimpan file backup.' })
    } catch (error) {
      setResult({ ok: false, message: `Gagal menyiapkan backup: ${error instanceof Error ? error.message : 'unknown error'}` })
    } finally {
      setLoading(false)
    }
  }

  const handleDownloadBackup = () => {
    if (!preview) return alert('Generate backup dulu')
    const date = new Date().toISOString().slice(0, 10)
    downloadJson(`FinanceBub-Backup-${date}.json`, preview)
  }

  const handleRestoreFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    setResult(null)
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text()) as BackupPayload
      if (!parsed || parsed.app !== 'FinanceBub') throw new Error('File bukan backup FinanceBub')
      setRestorePayload(parsed)
    } catch (error) {
      setRestorePayload(null)
      setResult({ ok: false, message: `File backup tidak valid: ${error instanceof Error ? error.message : 'unknown error'}` })
    }
  }

  const restoreBackup = async () => {
    if (!restorePayload) return alert('Pilih file backup dulu')
    const agree = confirm('Restore akan mengganti data tahun/rekening yang ada dengan isi file backup. Lanjutkan?')
    if (!agree) return

    setLoading(true)
    setResult(null)
    try {
      for (const [yearRaw, docs] of Object.entries(restorePayload.documents || {})) {
        const year = Number(yearRaw)
        if (!Number.isFinite(year)) continue
        await saveDocs(year, 'q', docs.quotation || [])
        await saveDocs(year, 'i', docs.invoice || [])
      }

      if (restorePayload.finance?.accounts) await saveAccounts(restorePayload.finance.accounts)
      if (restorePayload.finance?.categoryMaps) await saveCategoryMaps(restorePayload.finance.categoryMaps)
      for (const month of restorePayload.finance?.months || []) {
        await saveMonth(month)
      }

      setResult({ ok: true, message: 'Restore selesai. Refresh halaman aplikasi untuk memastikan semua data tersinkron.' })
    } catch (error) {
      setResult({ ok: false, message: `Restore gagal: ${error instanceof Error ? error.message : 'unknown error'}` })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Backup & Restore</h1>
          <p className="text-sm text-gray-400 mt-0.5">Amankan data sebelum deploy, migrasi, atau edit besar.</p>
        </div>
        <div className="inline-flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-100 rounded-lg text-xs text-green-700 font-semibold">
          <ShieldCheck className="w-4 h-4" /> Disarankan sebelum update production
        </div>
      </div>

      {result && (
        <div className={`mb-5 rounded-xl border px-4 py-3 text-sm flex items-start gap-2 ${result.ok ? 'bg-green-50 border-green-100 text-green-700' : 'bg-red-50 border-red-100 text-red-700'}`}>
          {result.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5" /> : <XCircle className="w-4 h-4 mt-0.5" />}
          <span>{result.message}</span>
        </div>
      )}

      <div className="grid grid-cols-[380px_1fr] gap-5">
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <Download className="w-5 h-5 text-[#1B8A7A]" />
              <h2 className="text-sm font-semibold text-gray-900">Buat Backup</h2>
            </div>

            <div className="mb-4">
              <div className="text-xs font-medium text-gray-500 mb-2">Pilih tahun data</div>
              <div className="grid grid-cols-3 gap-2">
                {YEARS.map(year => (
                  <button key={year} onClick={() => toggleYear(year)} className={`px-3 py-2 rounded-lg text-sm font-semibold border ${selectedYears.includes(year) ? 'bg-[#E1F5EE] border-[#1B8A7A] text-[#0F6E56]' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'}`}>{year}</button>
                ))}
              </div>
            </div>

            <div className="space-y-2 mb-4">
              <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={includeDocuments} onChange={e => setIncludeDocuments(e.target.checked)} className="accent-[#1B8A7A]" /> Quotation & Invoice</label>
              <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={includeFinance} onChange={e => setIncludeFinance(e.target.checked)} className="accent-[#1B8A7A]" /> Mutasi, rekening, dan kategori finance</label>
            </div>

            <button onClick={buildBackup} disabled={loading} className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-[#1B8A7A] text-white rounded-lg text-sm font-semibold hover:bg-[#0F6E56] disabled:opacity-50">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> {loading ? 'Menyiapkan...' : 'Generate Backup'}
            </button>
            <button onClick={handleDownloadBackup} disabled={!preview} className="w-full mt-2 flex items-center justify-center gap-1.5 px-3 py-2 bg-gray-900 text-white rounded-lg text-sm font-semibold hover:bg-black disabled:opacity-40">
              <Download className="w-4 h-4" /> Download JSON
            </button>
          </div>

          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <ArchiveRestore className="w-5 h-5 text-amber-600" />
              <h2 className="text-sm font-semibold text-gray-900">Restore Backup</h2>
            </div>
            <label className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-amber-600 text-white rounded-lg text-sm font-semibold cursor-pointer hover:bg-amber-700">
              <Upload className="w-4 h-4" /> Pilih File Backup JSON
              <input type="file" accept="application/json,.json" onChange={handleRestoreFile} className="hidden" />
            </label>
            <button onClick={restoreBackup} disabled={loading || !restorePayload} className="w-full mt-2 flex items-center justify-center gap-1.5 px-3 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 disabled:opacity-40">
              <Database className="w-4 h-4" /> Restore ke Database
            </button>
            <p className="text-xs text-gray-400 mt-3 leading-relaxed">Restore hanya gunakan file dari menu ini. Selalu backup dulu sebelum melakukan restore.</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100"><h2 className="text-sm font-semibold text-gray-900">Preview Backup Aktif</h2><p className="text-xs text-gray-400">Data yang siap di-download.</p></div>
            <div className="grid grid-cols-5 gap-[1px] bg-gray-100">
              <div className="bg-white p-4"><div className="text-[10px] text-gray-400 uppercase font-bold">Quotation</div><div className="text-xl font-bold text-[#1B8A7A] mt-1">{previewStats.quotation}</div></div>
              <div className="bg-white p-4"><div className="text-[10px] text-gray-400 uppercase font-bold">Invoice</div><div className="text-xl font-bold text-blue-700 mt-1">{previewStats.invoice}</div></div>
              <div className="bg-white p-4"><div className="text-[10px] text-gray-400 uppercase font-bold">Rekening</div><div className="text-xl font-bold text-gray-900 mt-1">{previewStats.accounts}</div></div>
              <div className="bg-white p-4"><div className="text-[10px] text-gray-400 uppercase font-bold">Bulan Finance</div><div className="text-xl font-bold text-gray-900 mt-1">{previewStats.months}</div></div>
              <div className="bg-white p-4"><div className="text-[10px] text-gray-400 uppercase font-bold">Transaksi</div><div className="text-xl font-bold text-gray-900 mt-1">{previewStats.transactions}</div></div>
            </div>
            {!preview && <div className="px-4 py-10 text-center text-sm text-gray-400">Belum ada backup digenerate.</div>}
          </div>

          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100"><h2 className="text-sm font-semibold text-gray-900">Preview File Restore</h2><p className="text-xs text-gray-400">Cek isi file sebelum restore.</p></div>
            <div className="grid grid-cols-5 gap-[1px] bg-gray-100">
              <div className="bg-white p-4"><div className="text-[10px] text-gray-400 uppercase font-bold">Quotation</div><div className="text-xl font-bold text-[#1B8A7A] mt-1">{restoreStats.quotation}</div></div>
              <div className="bg-white p-4"><div className="text-[10px] text-gray-400 uppercase font-bold">Invoice</div><div className="text-xl font-bold text-blue-700 mt-1">{restoreStats.invoice}</div></div>
              <div className="bg-white p-4"><div className="text-[10px] text-gray-400 uppercase font-bold">Rekening</div><div className="text-xl font-bold text-gray-900 mt-1">{restoreStats.accounts}</div></div>
              <div className="bg-white p-4"><div className="text-[10px] text-gray-400 uppercase font-bold">Bulan Finance</div><div className="text-xl font-bold text-gray-900 mt-1">{restoreStats.months}</div></div>
              <div className="bg-white p-4"><div className="text-[10px] text-gray-400 uppercase font-bold">Transaksi</div><div className="text-xl font-bold text-gray-900 mt-1">{restoreStats.transactions}</div></div>
            </div>
            {!restorePayload && <div className="px-4 py-10 text-center text-sm text-gray-400">Belum ada file restore dipilih.</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
