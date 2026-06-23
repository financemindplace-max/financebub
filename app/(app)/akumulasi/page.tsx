'use client'
import { useYearList, getActiveYear, persistActiveYear } from '@/lib/use-active-year'
// ─── app/(app)/akumulasi/page.tsx ────────────────────────────────────────────

import { Fragment, useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { ref, onValue, off, set, get } from 'firebase/database'
import { db } from '@/lib/firebase'
import { fetchDocs } from '@/lib/rtdb'
import { getInvoicePayments, getQuotationPayments, unlinkMutasiPaymentTarget, updateLinkedDocumentPaymentStatus, type InvoicePaymentLog } from '@/lib/invoice-payment-link'
import { fmt, fmtDate } from '@/lib/utils'
import type { Doc } from '@/types/document'
import { Download, Search, ChevronDown, ChevronUp, Lock, Unlink } from 'lucide-react'

const USER_ID = 'financebub-main'

// ── types ─────────────────────────────────────────────────────────────────────

interface AkumRow {
  rid: string
  yr: number
  brand: string
  client: string
  item: string
  sow: string
  noQuo: string
  noInv: string
  totalAmt: number
  statusInv: string
  due: string
  tgl: string
  ket: string
  nom: string
  rek: string
  isExtra: boolean
  parentRid?: string
  theme?: string
  fromMutasi?: boolean   // dari link mutasi — dikunci, tidak bisa diedit di akumulasi
  countAsPaid?: boolean  // manual row yang dihitung sebagai pelunasan invoice
  txId?: string
  accountId?: string
  targetDocType?: 'invoice' | 'quotation'
  targetDocNo?: string
  targetDocYear?: number
  targetProjectYear?: number
}

// ── helpers ───────────────────────────────────────────────────────────────────

function gTot(doc: Doc): number {
  const sub = doc.items?.reduce((a, i) => a + (+i.amount || 0), 0) || 0
  return sub - +(doc.fields?.['q-disc'] || 0) + +(doc.fields?.['q-gross'] || 0)
}

function pN(s: string | number): number {
  if (!s) return 0
  return parseFloat(String(s).replace(/[^0-9.-]/g, '')) || 0
}

function fmtNom(s: string | number): string {
  const n = pN(s)
  if (!n) return ''
  return Math.round(n).toLocaleString('id-ID')
}

function normSearch(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function docKey(row: AkumRow): string {
  const noQuo = String(row.noQuo || '').trim()
  const noInv = String(row.noInv || '').trim()
  if (noQuo || noInv) return `${noQuo}|${noInv}`
  return row.parentRid || row.rid
}

function rowMatchesQuery(row: AkumRow, query: string): boolean {
  const q = normSearch(query).trim()
  if (!q) return true
  const haystack = [
    row.noQuo,
    row.noInv,
    row.client,
    row.brand,
    row.item,
    row.sow,
    row.ket,
    row.rek,
    row.nom,
  ].map(normSearch).join(' ')
  return haystack.includes(q)
}

function filterRowsByQuery(rows: AkumRow[], query: string): AkumRow[] {
  const q = query.trim()
  if (!q) return rows
  // Jika satu item, nomor dokumen, atau pembayaran cocok, tampilkan seluruh
  // baris dokumen yang sama. Hasil tidak boleh berubah hanya karena kata kunci
  // pencarian berbeda.
  const matchedKeys = new Set(
    rows.filter(row => rowMatchesQuery(row, q)).map(docKey)
  )
  return rows.filter(row => matchedKeys.has(docKey(row)))
}

function isFromMutasiRow(row: AkumRow): boolean {
  return Boolean(row.fromMutasi || String(row.rid || '').includes('-mutasi-'))
}

function hasMeaningfulMainPayment(row: AkumRow): boolean {
  // Tanggal lama tanpa nominal/keterangan bukan pembayaran. Kalau ada hasil
  // link Mutasi, baris Mutasi tetap harus dipromosikan ke baris pertama.
  const hasAmount = Math.abs(pN(row.nom)) > 0
  const hasNote = String(row.ket || '').trim().length > 0
  return hasAmount || hasNote
}

function sortPaymentRows(paymentRows: AkumRow[]): AkumRow[] {
  return paymentRows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const mutasiOrder = Number(isFromMutasiRow(b.row)) - Number(isFromMutasiRow(a.row))
      if (mutasiOrder !== 0) return mutasiOrder
      const dateA = /^\d{4}-\d{2}-\d{2}$/.test(String(a.row.tgl || '').trim()) ? String(a.row.tgl).trim() : '9999-12-31'
      const dateB = /^\d{4}-\d{2}-\d{2}$/.test(String(b.row.tgl || '').trim()) ? String(b.row.tgl).trim() : '9999-12-31'
      const dateOrder = dateA.localeCompare(dateB)
      return dateOrder !== 0 ? dateOrder : a.index - b.index
    })
    .map(entry => entry.row)
}

function paymentRowIdentity(row: AkumRow): string {
  if (isFromMutasiRow(row)) {
    const txId = paymentRowTxId(row)
    if (txId) return `mutasi:${txId}`
  }
  return `row:${row.rid}`
}

function uniquePaymentRows(paymentRows: AkumRow[]): AkumRow[] {
  const seen = new Set<string>()
  return paymentRows.filter(row => {
    const key = paymentRowIdentity(row)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function resolvePaymentRows(mainRow: AkumRow, paymentRows: AkumRow[]): { paymentRow: AkumRow; extraRows: AkumRow[] } {
  const orderedRows = uniquePaymentRows(sortPaymentRows(paymentRows))
  if (!hasMeaningfulMainPayment(mainRow) && orderedRows.length > 0) {
    return { paymentRow: orderedRows[0], extraRows: orderedRows.slice(1) }
  }
  return { paymentRow: mainRow, extraRows: orderedRows }
}

function calculateRowsSummary(rows: AkumRow[]): { contract: number; paid: number; remaining: number } {
  const mainRows = rows.filter(row => !row.isExtra)
  const groups = new Map<string, AkumRow[]>()

  mainRows.forEach(row => {
    const key = docKey(row)
    const current = groups.get(key) || []
    current.push(row)
    groups.set(key, current)
  })

  let contract = 0
  let paid = 0

  groups.forEach(group => {
    const first = group[0]
    contract += Math.max(0, pN(first.totalAmt))
    const extraRows = rows.filter(row => row.isExtra && row.parentRid === first.rid)
    const resolved = resolvePaymentRows(first, extraRows)
    const effectiveRows = uniquePaymentRows([resolved.paymentRow, ...resolved.extraRows])
    paid += effectiveRows.reduce((sum, row) => sum + Math.max(0, pN(row.nom)), 0)
  })

  return { contract, paid, remaining: contract - paid }
}

function derivePaymentStatus(total: number, paid: number, fallback: string): string {
  if (paid <= 0) {
    const stalePaymentStatuses = new Set(['Lunas', 'Dibayar Sebagian', 'Lebih Bayar', 'Overpaid'])
    return stalePaymentStatuses.has(fallback) ? 'Terbit' : fallback
  }
  if (paid > total + 0.5) return 'Lebih Bayar'
  if (Math.abs(total - paid) <= 0.5) return 'Lunas'
  return 'Dibayar Sebagian'
}

function manualPaidForParent(rows: AkumRow[], parentRid: string, mainPayment: Partial<AkumRow>): number {
  const mainPaid = pN(mainPayment.nom || '')
  const extraPaid = rows
    .filter(row => row.isExtra && row.parentRid === parentRid && !isFromMutasiRow(row) && row.countAsPaid)
    .reduce((sum, row) => sum + pN(row.nom), 0)
  return mainPaid + extraPaid
}

type OverpayDetail = { row: AkumRow; amount: number; docNo: string }

function getOverpayDetails(total: number, paymentRows: AkumRow[], docNo: string): OverpayDetail[] {
  let running = 0
  return paymentRows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const dateA = /^\d{4}-\d{2}-\d{2}$/.test(String(a.row.tgl || '')) ? String(a.row.tgl) : '9999-12-31'
      const dateB = /^\d{4}-\d{2}-\d{2}$/.test(String(b.row.tgl || '')) ? String(b.row.tgl) : '9999-12-31'
      const dateOrder = dateA.localeCompare(dateB)
      return dateOrder !== 0 ? dateOrder : a.index - b.index
    })
    .map(({ row }) => {
      const before = Math.max(0, running - total)
      running += Math.max(0, pN(row.nom))
      const after = Math.max(0, running - total)
      return { row, amount: after - before, docNo }
    })
    .filter(detail => detail.amount > 0.5)
}

function buildMutasiHref(row: AkumRow): string {
  const txId = paymentRowTxId(row)
  if (!txId) return ''
  const params = new URLSearchParams({ tx: txId })
  const date = String(row.tgl || '')
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    params.set('year', date.slice(0, 4))
    params.set('month', String(Number(date.slice(5, 7))))
  }
  if (row.accountId) params.set('account', row.accountId)
  return `/keuangan/mutasi?${params.toString()}`
}

function subscribeArr(path: string, cb: (arr: any[]) => void) {
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

async function saveArr(path: string, arr: any[]) {
  await set(ref(db, path), JSON.stringify(arr))
  await set(ref(db, `users/${USER_ID}/data/_ts`), Date.now())
}

// Build baris akumulasi dari Q + I + A (sama persis logika app lama)
function paymentRowTxId(row: AkumRow): string {
  if (row.txId) return String(row.txId)
  const rid = String(row.rid || '')
  const targetType = row.targetDocType || (row.noInv ? 'invoice' : row.noQuo ? 'quotation' : undefined)
  const targetNo = row.targetDocNo || (targetType === 'invoice' ? row.noInv : row.noQuo)
  if (targetType && targetNo) {
    const marker = `-mutasi-${targetType}-${encodeURIComponent(targetNo)}-`
    const index = rid.indexOf(marker)
    if (index >= 0) return rid.slice(index + marker.length)
  }
  const legacyMarker = '-mutasi-'
  const legacyIndex = rid.indexOf(legacyMarker)
  if (legacyIndex < 0) return ''
  const suffix = rid.slice(legacyIndex + legacyMarker.length)
  return /^(invoice|quotation)-/.test(suffix) ? '' : suffix
}

function inferDocYear(docNo: string, fallback: number): number {
  const match = String(docNo || '').match(/-(\d{2})(\d{2})-/)
  return match ? 2000 + Number(match[2]) : fallback
}

type PaymentSource = {
  docType: 'invoice' | 'quotation'
  docNo: string
  docYear: number
  projectYear: number
  noQuo: string
  noInv: string
  logs: InvoicePaymentLog[]
}

function collectPaymentRows(
  akumulasi: AkumRow[],
  mainRid: string,
  yr: number,
  brand: string,
  client: string,
  sources: PaymentSource[],
): AkumRow[] {
  // Untuk satu QTT/INV yang saling terhubung, satu transaksi bank hanya boleh
  // dihitung sekali. Jika txId yang sama ada di quotation dan invoice, invoice
  // menjadi sumber utama karena status pembayaran akhir mengikuti invoice.
  const preferredByTxId = new Map<string, { source: PaymentSource; log: InvoicePaymentLog }>()
  const orderedSources = [...sources].sort((a, b) => Number(b.docType === 'invoice') - Number(a.docType === 'invoice'))
  orderedSources.forEach(source => {
    source.logs.forEach(log => {
      const txId = String(log.txId || log.id || '').trim()
      if (!txId || preferredByTxId.has(txId)) return
      preferredByTxId.set(txId, { source, log: { ...log, txId, id: log.id || txId } })
    })
  })

  const rows: AkumRow[] = []
  const seenTxIds = new Set<string>()

  akumulasi.forEach(row => {
    if (!row?.isExtra) return
    const isMutasi = Boolean(row.fromMutasi || String(row.rid || '').includes('-mutasi-'))

    if (!isMutasi) {
      if (row.parentRid === mainRid || row.rid?.startsWith(`pay-${mainRid}-`)) {
        rows.push({ ...row, brand, client, parentRid: mainRid })
      }
      return
    }

    const txId = paymentRowTxId(row)
    const preferred = txId ? preferredByTxId.get(txId) : undefined
    if (!preferred || seenTxIds.has(txId)) return

    const { source, log } = preferred
    seenTxIds.add(txId)
    rows.push({
      ...row,
      yr,
      brand,
      client,
      noQuo: source.noQuo,
      noInv: source.noInv,
      parentRid: mainRid,
      tgl: log.date || row.tgl || '',
      ket: log.note || row.ket || `Pembayaran ${source.docNo}`,
      nom: String(Math.round(pN(log.amount))),
      rek: log.accountLabel || row.rek || '',
      txId,
      targetDocType: source.docType,
      targetDocNo: source.docNo,
      targetDocYear: source.docYear,
      targetProjectYear: source.projectYear,
      fromMutasi: true,
      accountId: log.accountId || row.accountId || '',
    })
  })

  // paymentLogs adalah sumber kebenaran. Buat baris tampilan otomatis jika
  // baris Akumulasi belum terbentuk, sekaligus hindari duplikasi txId lama.
  preferredByTxId.forEach(({ source, log }, txId) => {
    if (seenTxIds.has(txId)) return
    seenTxIds.add(txId)
    rows.push({
      rid: `pay-${mainRid}-mutasi-${source.docType}-${encodeURIComponent(source.docNo)}-${txId}`,
      yr,
      brand,
      client,
      item: '',
      sow: '',
      noQuo: source.noQuo,
      noInv: source.noInv,
      totalAmt: 0,
      statusInv: '',
      due: '',
      tgl: log.date || '',
      ket: log.note || `Pembayaran ${source.docNo}`,
      nom: String(Math.round(pN(log.amount))),
      rek: log.accountLabel || '',
      isExtra: true,
      parentRid: mainRid,
      fromMutasi: true,
      txId,
      accountId: log.accountId || '',
      targetDocType: source.docType,
      targetDocNo: source.docNo,
      targetDocYear: source.docYear,
      targetProjectYear: source.projectYear,
    })
  })

  return rows
}

// Build baris akumulasi dari Q + I + A
function bRows(quotations: Doc[], invoices: Doc[], akumulasi: AkumRow[], yr: number): AkumRow[] {
  const mm: Record<string, AkumRow> = {}
  akumulasi.forEach(m => { mm[m.rid] = m })
  const rows: AkumRow[] = []
  const uQ = new Set<string>()
  const uI = new Set<string>()

  function inheritItems(items: Doc['items']) {
    let lastBrand = '', lastItem = ''
    return (items || []).map(it => {
      const b = (it.brand || '').trim() || lastBrand
      const i = (it.item || '').trim() || lastItem
      if (b) lastBrand = b
      if (i) lastItem = i
      return { ...it, brand: b, item: i }
    })
  }

  function mkRow(rid: string, brand: string, client: string, item: string, sow: string,
    noQuo: string, noInv: string, totalAmt: number, statusInv: string, due: string,
    m2: Partial<AkumRow>, theme: string): AkumRow {
    return {
      rid, yr, brand: brand || '', client: client || '', item: item || '', sow: sow || '',
      noQuo: noQuo || '', noInv: noInv || '', totalAmt: totalAmt || 0,
      statusInv: statusInv || '', due: due || '',
      tgl: m2.tgl || '', ket: m2.ket || '', nom: m2.nom || '', rek: m2.rek || '',
      isExtra: false, theme: theme || ''
    }
  }

  quotations.forEach(q => {
    const qNo = q.fields?.['q-no'] || ''
    if (!qNo) return
    const linkedInv = invoices.find(i => i.fields?.['i-ref'] === qNo)
    const linkedInvoiceNo = linkedInv?.fields?.['i-no'] || ''
    const items = inheritItems(q.items)
    const docYr = Number((q.fields as any)?.['project-year'] || (linkedInv?.fields as any)?.['project-year'] || yr)

    items.forEach(it => {
      const rid = `${docYr}_${qNo}_${it.brand || ''}_${it.item || ''}`
      if (uQ.has(rid)) return
      uQ.add(rid)
      const m2 = mm[rid] || {}
      const totalAmt = linkedInv ? gTot(linkedInv) : gTot(q)
      const linkedLogs = linkedInv ? getInvoicePayments(linkedInv) : getQuotationPayments(q)
      const computedStatus = derivePaymentStatus(
        totalAmt,
        linkedLogs.reduce((sum, log) => sum + pN(log.amount), 0) + manualPaidForParent(akumulasi, rid, m2),
        linkedInv?.fields?.['i-status'] || q.fields?.['q-status'] || '',
      )
      rows.push(mkRow(
        rid, it.brand, q.fields['cl-name'] || '', it.item, it.sow,
        qNo, linkedInvoiceNo,
        totalAmt,
        computedStatus,
        linkedInv?.fields?.['i-due'] || '',
        m2, q.theme || linkedInv?.theme || '',
      ))

      const sources: PaymentSource[] = [{
        docType: 'quotation',
        docNo: qNo,
        docYear: inferDocYear(qNo, yr),
        projectYear: docYr,
        noQuo: qNo,
        noInv: linkedInvoiceNo,
        logs: getQuotationPayments(q),
      }]
      if (linkedInv && linkedInvoiceNo) {
        sources.push({
          docType: 'invoice',
          docNo: linkedInvoiceNo,
          docYear: inferDocYear(linkedInvoiceNo, yr),
          projectYear: Number((linkedInv.fields as any)?.['project-year'] || docYr),
          noQuo: qNo,
          noInv: linkedInvoiceNo,
          logs: getInvoicePayments(linkedInv),
        })
      }
      rows.push(...collectPaymentRows(akumulasi, rid, yr, it.brand, q.fields['cl-name'] || '', sources))
    })
  })

  invoices.forEach(inv => {
    const iNo = inv.fields?.['i-no'] || ''
    const iRef = inv.fields?.['i-ref'] || ''
    if (!iNo || (iRef && quotations.some(q => q.fields?.['q-no'] === iRef))) return
    const items = inheritItems(inv.items)
    const docYr = Number((inv.fields as any)?.['project-year'] || yr)

    items.forEach(it => {
      const rid = `${docYr}_inv_${iNo}_${it.brand || ''}_${it.item || ''}`
      if (uI.has(rid)) return
      uI.add(rid)
      const m2 = mm[rid] || {}
      const totalAmt = gTot(inv)
      const computedStatus = derivePaymentStatus(
        totalAmt,
        getInvoicePayments(inv).reduce((sum, log) => sum + pN(log.amount), 0) + manualPaidForParent(akumulasi, rid, m2),
        inv.fields['i-status'] || '',
      )
      rows.push(mkRow(
        rid, it.brand, inv.fields['cl-name'] || '', it.item, it.sow,
        '', iNo, totalAmt, computedStatus, inv.fields['i-due'] || '',
        m2, inv.theme || '',
      ))
      rows.push(...collectPaymentRows(akumulasi, rid, yr, it.brand, inv.fields['cl-name'] || '', [{
        docType: 'invoice',
        docNo: iNo,
        docYear: inferDocYear(iNo, yr),
        projectYear: docYr,
        noQuo: '',
        noInv: iNo,
        logs: getInvoicePayments(inv),
      }]))
    })
  })

  return rows
}

// ── Status badge ──────────────────────────────────────────────────────────────

const INV_STATUS_BG: Record<string, string> = {
  'Draft': 'bg-gray-100 text-gray-500',
  'Terbit': 'bg-blue-100 text-blue-700',
  'Belum Lunas': 'bg-amber-100 text-amber-700',
  'Dibayar Sebagian': 'bg-amber-100 text-amber-700',
  'Lunas': 'bg-green-100 text-green-700',
  'Lebih Bayar': 'bg-purple-100 text-purple-700',
  'Overpaid': 'bg-purple-100 text-purple-700',
  'Overdue': 'bg-red-100 text-red-600',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium ${INV_STATUS_BG[status] || 'bg-gray-100 text-gray-500'}`}>
      {status || '—'}
    </span>
  )
}

// ── Inline editable cell ──────────────────────────────────────────────────────

function EditCell({ value, onChange, type = 'text', placeholder = '' }: {
  value: string; onChange: (v: string) => void; type?: string; placeholder?: string
}) {
  const [local, setLocal] = useState(value)
  useEffect(() => setLocal(value), [value])
  return (
    <input
      type={type}
      value={local}
      placeholder={placeholder}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => { if (local !== value) onChange(local) }}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      className="w-full px-2 py-1 text-xs border border-transparent hover:border-gray-200 focus:border-[#1B8A7A] focus:outline-none rounded bg-transparent focus:bg-white transition-all"
    />
  )
}

// ── Brand section ─────────────────────────────────────────────────────────────

function BrandSection({
  brand, rows, year, onUpdate, onAddCicilan, onDeleteCicilan, onUnlinkMutasi, onCountAsPaid, onOpenDoc, onOpenMutasi
}: {
  brand: string
  rows: AkumRow[]
  year: number
  onUpdate: (rid: string, field: string, value: string) => void
  onAddCicilan: (parentRid: string, brand: string, client: string, noQuo: string, noInv: string) => void
  onDeleteCicilan: (rid: string) => void
  onUnlinkMutasi: (row: AkumRow) => void
  onCountAsPaid: (parentRid: string, er: AkumRow, checked: boolean, totalAmt: number, noInv: string, noQuo: string, yr: number) => void
  onOpenDoc: (type: 'invoice' | 'quotation', docNo: string) => void
  onOpenMutasi: (row: AkumRow) => void
}) {
  const [collapsed, setCollapsed] = useState(false)

  // Group main rows by noQuo+noInv
  const mainRows = rows.filter(r => !r.isExtra)
  const docMap: Record<string, AkumRow[]> = {}
  mainRows.forEach(r => {
    const dk = (r.noQuo || '__') + '|' + (r.noInv || '__')
    if (!docMap[dk]) docMap[dk] = []
    docMap[dk].push(r)
  })

  const overpayDetails = Object.values(docMap).flatMap(dR => {
    const first = dR[0]
    const allExtraRows = rows.filter(row => row.isExtra && row.parentRid === first.rid)
    const { paymentRow, extraRows } = resolvePaymentRows(first, allExtraRows)
    return getOverpayDetails(first.totalAmt, [paymentRow, ...extraRows], first.noInv || first.noQuo)
  })

  // Summary — hitung per dokumen dan deduplikasi pembayaran Mutasi.
  const summary = calculateRowsSummary(rows)
  const kontrak = summary.contract
  const bayar = summary.paid
  const sisa = summary.remaining
  const projectCount = new Set(rows.filter(row => !row.isExtra).map(docKey)).size
  const theme = rows.find(r => r.theme)?.theme || '#1B8A7A'

  const statusLabel = Math.abs(sisa) < 1 ? '✓ LUNAS'
    : sisa > 0 ? `KURANG BAYAR · Sisa Rp ${fmt(Math.round(sisa))}` : `LEBIH BAYAR · Lebih Rp ${fmt(Math.round(-sisa))}`
  const statusColor = Math.abs(sisa) < 1 ? 'text-green-700' : sisa > 0 ? 'text-red-600' : 'text-blue-700'

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden mb-4">
      {/* Brand header */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer"
        style={{ backgroundColor: theme }}
        onClick={() => setCollapsed(v => !v)}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-white font-semibold text-sm">📄 {brand}</span>
          <span className="text-white/80 text-xs">{projectCount} project · Kontrak Rp {fmt(kontrak)}</span>
        </div>
        <div className="flex items-center gap-2">
          {collapsed
            ? <ChevronDown size={16} className="text-white/80" />
            : <ChevronUp size={16} className="text-white/80" />}
        </div>
      </div>

      {!collapsed && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs" style={{ minWidth: 900 }}>
            <thead>
              <tr style={{ backgroundColor: theme + '22' }}>
                {['Klien','Brand','Item / SOW','No. Quotation','No. Invoice','Total','Status','Tgl Bayar','Keterangan','Nominal','Rekening',''].map((h, i) => (
                  <th key={i} className="px-3 py-2 text-left text-[10px] font-semibold text-gray-600 whitespace-nowrap border-b border-gray-100">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.values(docMap).map((dR, di) => {
                const fr = dR[0]
                const allExtraRows = rows.filter(r => r.isExtra && r.parentRid === fr.rid)
                const { paymentRow, extraRows } = resolvePaymentRows(fr, allExtraRows)
                const paymentRid = paymentRow.rid
                const isRowFromMutasi = isFromMutasiRow
                const overpayByRid = new Map(
                  getOverpayDetails(fr.totalAmt, [paymentRow, ...extraRows], fr.noInv || fr.noQuo)
                    .map(detail => [detail.row.rid, detail.amount]),
                )
                const paymentOverpay = overpayByRid.get(paymentRow.rid) || 0
                return (
                  <Fragment key={fr.rid || `doc-${di}`}>
                    {/* Main row */}
                    <tr className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-800">
                        {fr.client}
                        {fr.due && <div className="text-[10px] text-gray-400">Due: {fmtDate(fr.due)}</div>}
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold text-white" style={{ backgroundColor: fr.theme || '#1B8A7A' }}>
                          {fr.brand}
                        </span>
                      </td>
                      <td className="px-3 py-2 max-w-[180px]">
                        {dR.map((r, ri) => (
                          <div key={ri} className={ri > 0 ? 'border-t border-dashed border-gray-200 pt-1 mt-1' : ''}>
                            {r.item && <div className="font-medium">{r.item}</div>}
                            {r.sow && <div className="text-gray-400 text-[10px]">{r.sow}</div>}
                          </div>
                        ))}
                      </td>
                      <td className="px-3 py-2 text-gray-400 font-mono text-[10px]">
                        {fr.noQuo
                          ? <button onClick={() => onOpenDoc('quotation', fr.noQuo)} className="text-[#1B8A7A] hover:underline font-mono text-[10px] font-semibold">{fr.noQuo}</button>
                          : '—'}
                      </td>
                      <td className="px-3 py-2 text-gray-400 font-mono text-[10px]">
                        {fr.noInv
                          ? <button onClick={() => onOpenDoc('invoice', fr.noInv)} className="text-[#1B8A7A] hover:underline font-mono text-[10px] font-semibold">{fr.noInv}</button>
                          : '—'}
                      </td>
                      <td className="px-3 py-2 font-semibold text-gray-800 whitespace-nowrap">Rp {fmt(fr.totalAmt)}</td>
                      <td className="px-3 py-2">{fr.statusInv ? <StatusBadge status={fr.statusInv} /> : <span className="text-gray-300">—</span>}</td>
                      <td className="px-3 py-2 min-w-[120px]">
                        {isRowFromMutasi(paymentRow)
                          ? <span className="flex items-center gap-1 text-xs text-gray-400"><Lock className="w-3 h-3" />{paymentRow.tgl ? fmtDate(paymentRow.tgl) : '—'}</span>
                          : <EditCell type="date" value={paymentRow?.tgl || ''} onChange={v => onUpdate(paymentRid, 'tgl', v)} />}
                      </td>
                      <td className="px-3 py-2 min-w-[140px]">
                        {isRowFromMutasi(paymentRow)
                          ? <Link href={buildMutasiHref(paymentRow) || '/keuangan/mutasi'} title="Buka transaksi Mutasi" className="flex items-center gap-1 text-left text-xs text-blue-600 hover:underline"><Lock className="w-3 h-3" />{paymentRow.ket || 'Buka transaksi Mutasi'}</Link>
                          : <EditCell value={paymentRow?.ket || ''} placeholder="Keterangan..." onChange={v => onUpdate(paymentRid, 'ket', v)} />}
                      </td>
                      <td className="px-3 py-2 min-w-[130px]">
                        {isRowFromMutasi(paymentRow)
                          ? <div><span className="flex items-center gap-1 text-xs text-gray-500"><Lock className="w-3 h-3" />{paymentRow.nom ? fmtNom(paymentRow.nom) : '—'}</span>{paymentOverpay > 0 && <span className="mt-1 inline-flex rounded-full bg-purple-100 px-2 py-0.5 text-[9px] font-semibold text-purple-700">Lebih bayar +Rp {fmt(Math.round(paymentOverpay))}</span>}</div>
                          : <div><EditCell value={fmtNom(paymentRow?.nom || '')} placeholder="0" onChange={v => onUpdate(paymentRid, 'nom', v.replace(/[^0-9.-]/g, ''))} />{paymentOverpay > 0 && <span className="mt-1 inline-flex rounded-full bg-purple-100 px-2 py-0.5 text-[9px] font-semibold text-purple-700">Lebih bayar +Rp {fmt(Math.round(paymentOverpay))}</span>}</div>}
                      </td>
                      <td className="px-3 py-2 min-w-[110px]">
                        {isRowFromMutasi(paymentRow)
                          ? <span className="flex items-center gap-1 text-xs text-gray-400"><Lock className="w-3 h-3" />{paymentRow.rek || '—'}</span>
                          : <EditCell value={paymentRow?.rek || ''} placeholder="Rekening/Bank..." onChange={v => onUpdate(paymentRid, 'rek', v)} />}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => onAddCicilan(fr.rid, fr.brand, fr.client, fr.noQuo, fr.noInv)}
                            title="Tambah baris pembayaran"
                            className="w-6 h-6 rounded-full flex items-center justify-center text-white text-sm font-bold hover:opacity-90 transition"
                            style={{ backgroundColor: theme }}
                          >
                            +
                          </button>
                          {isRowFromMutasi(paymentRow) && (
                            <button onClick={() => onUnlinkMutasi(paymentRow)} title="Lepas link pembayaran dari dokumen ini"
                              className="w-7 h-7 rounded-full flex items-center justify-center bg-blue-50 text-blue-500 hover:bg-red-50 hover:text-red-600 transition">
                              <Unlink className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* Cicilan extra rows */}
                    {extraRows.map(er => {
                      const extraOverpay = overpayByRid.get(er.rid) || 0
                      return (
                      <tr key={er.rid} className={`border-b ${isRowFromMutasi(er) ? 'border-blue-100 bg-blue-50/30' : 'border-green-100'}`} style={isRowFromMutasi(er) ? { borderLeft: '3px solid #3B82F6' } : { backgroundColor: '#F0FDF4', borderLeft: '3px solid #1B8A7A' }}>
                        <td colSpan={7} className="px-3 py-1.5">
                          {!isRowFromMutasi(er) && (
                            <label className="flex items-center gap-1.5 cursor-pointer" title="Hitung sebagai pelunasan invoice">
                              <input
                                type="checkbox"
                                checked={!!er.countAsPaid}
                                onChange={e => onCountAsPaid(fr.rid, er, e.target.checked, fr.totalAmt, fr.noInv, fr.noQuo, fr.yr)}
                                className="w-3.5 h-3.5 accent-[#1B8A7A] cursor-pointer"
                              />
                              <span className="text-[10px] text-gray-500">Hitung sebagai pelunasan</span>
                            </label>
                          )}
                          {isRowFromMutasi(er) && (
                            <span className="flex items-center gap-1 text-[10px] text-blue-500"><Lock className="w-3 h-3" /> Dari Mutasi</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 min-w-[120px]">
                          {isRowFromMutasi(er)
                            ? <span className="text-xs text-gray-500">{er.tgl ? fmtDate(er.tgl) : '—'}</span>
                            : <EditCell type="date" value={er.tgl} onChange={v => onUpdate(er.rid, 'tgl', v)} />}
                        </td>
                        <td className="px-3 py-1.5 min-w-[140px]">
                          {isRowFromMutasi(er)
                            ? <Link href={buildMutasiHref(er) || '/keuangan/mutasi'} title="Buka transaksi Mutasi" className="text-left text-xs text-blue-600 hover:underline">{er.ket || 'Buka transaksi Mutasi'}</Link>
                            : <EditCell value={er.ket} placeholder="Keterangan cicilan..." onChange={v => onUpdate(er.rid, 'ket', v)} />}
                        </td>
                        <td className="px-3 py-1.5 min-w-[130px]">
                          {isRowFromMutasi(er)
                            ? <div><span className="text-xs text-gray-500">{er.nom ? fmtNom(er.nom) : '—'}</span>{extraOverpay > 0 && <span className="mt-1 inline-flex rounded-full bg-purple-100 px-2 py-0.5 text-[9px] font-semibold text-purple-700">Lebih bayar +Rp {fmt(Math.round(extraOverpay))}</span>}</div>
                            : <div><EditCell value={fmtNom(er.nom)} placeholder="0" onChange={v => onUpdate(er.rid, 'nom', v.replace(/[^0-9.-]/g, ''))} />{extraOverpay > 0 && <span className="mt-1 inline-flex rounded-full bg-purple-100 px-2 py-0.5 text-[9px] font-semibold text-purple-700">Lebih bayar +Rp {fmt(Math.round(extraOverpay))}</span>}</div>}
                        </td>
                        <td className="px-3 py-1.5 min-w-[110px]">
                          {isRowFromMutasi(er)
                            ? <span className="text-xs text-gray-500">{er.rek || '—'}</span>
                            : <EditCell value={er.rek} placeholder="Rekening/Bank..." onChange={v => onUpdate(er.rid, 'rek', v)} />}
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          {isRowFromMutasi(er) ? (
                            <button onClick={() => onUnlinkMutasi(er)} title="Lepas link pembayaran dari dokumen ini"
                              className="w-7 h-7 rounded-full flex items-center justify-center bg-blue-50 text-blue-500 hover:bg-red-50 hover:text-red-600 transition">
                              <Unlink className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <button onClick={() => onDeleteCicilan(er.rid)} title="Hapus cicilan"
                              className="w-6 h-6 rounded-full flex items-center justify-center bg-red-50 text-red-400 hover:text-red-600 text-sm font-bold transition">×</button>
                          )}
                        </td>
                      </tr>
                      )
                    })}
                  </Fragment>
                )
              })}

              {/* Summary rows */}
              <tr className="bg-gray-50 border-t border-gray-200">
                <td colSpan={5} className="px-3 py-2 text-right text-xs text-gray-500 font-medium">Jumlah Kontrak</td>
                <td className="px-3 py-2 font-bold text-gray-800">Rp {fmt(kontrak)}</td>
                <td colSpan={6} />
              </tr>
              <tr className="bg-gray-50">
                <td colSpan={5} className="px-3 py-2 text-right text-xs text-gray-500 font-medium">Pembayaran Masuk</td>
                <td className="px-3 py-2 font-bold text-green-700">Rp {fmt(bayar)}</td>
                <td colSpan={6} />
              </tr>
              <tr className="bg-gray-50 border-t-2 border-gray-300">
                <td colSpan={5} className="px-3 py-2 text-right text-xs text-gray-500 font-medium">Status Pembayaran</td>
                <td colSpan={7} className={`px-3 py-2 font-bold text-xs ${statusColor}`}>{statusLabel}</td>
              </tr>
              {overpayDetails.length > 0 && (
                <tr className="border-t border-purple-100 bg-purple-50/60">
                  <td colSpan={5} className="px-3 py-2 text-right text-xs font-medium text-purple-700">Sumber Lebih Bayar</td>
                  <td colSpan={7} className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      {overpayDetails.map((detail, index) => {
                        const content = <>
                          <span className="font-semibold">{detail.docNo || 'Dokumen'}</span> · {detail.row.tgl ? fmtDate(detail.row.tgl) : 'Tanpa tanggal'} · {detail.row.ket || 'Tanpa keterangan'} · <span className="font-bold">+Rp {fmt(Math.round(detail.amount))}</span>
                        </>
                        return isFromMutasiRow(detail.row) ? (
                          <Link key={`${detail.row.rid}-${index}`} href={buildMutasiHref(detail.row) || '/keuangan/mutasi'} title="Buka transaksi Mutasi" className="rounded-lg border border-purple-200 bg-white px-2.5 py-1.5 text-left text-[10px] text-purple-800 hover:border-purple-400 hover:shadow-sm">
                            {content}
                          </Link>
                        ) : (
                          <div key={`${detail.row.rid}-${index}`} className="cursor-default rounded-lg border border-purple-200 bg-white px-2.5 py-1.5 text-left text-[10px] text-purple-800">
                            {content}
                          </div>
                        )
                      })}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AkumulasiPage() {
  const YEARS = useYearList()
  const { user } = useAuth()
  const router = useRouter()
  const [year, setYear] = useState(new Date().getFullYear())

  useEffect(() => {
    setYear(getActiveYear(new Date().getFullYear()))
  }, [])
  const [quotations, setQuotations] = useState<Doc[]>([])
  const [invoices, setInvoices] = useState<Doc[]>([])
  const [akumulasi, setAkumulasi] = useState<AkumRow[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  const akumPath = `users/${USER_ID}/data/yr_${year}_a`

  useEffect(() => {
    setLoading(true)
    let qDone = false, iDone = false, aDone = false
    const check = () => { if (qDone && iDone && aDone) setLoading(false) }

    const SCAN_YEARS = Array.from({ length: 8 }, (_, i) => new Date().getFullYear() + 2 - i)
    const qByYear: Record<number, Doc[]> = {}
    const iByYear: Record<number, Doc[]> = {}
    let qCount = 0, iCount = 0
    const unsubs: (() => void)[] = []

    SCAN_YEARS.forEach(y => {
      unsubs.push(subscribeArr(`users/${USER_ID}/data/yr_${y}_q`, d => {
        qByYear[y] = d
        if (++qCount >= SCAN_YEARS.length) {
          setQuotations(
            Object.entries(qByYear).flatMap(([fy, docs]) =>
              docs.filter((x: Doc) => x?.fields?.['q-no']).filter((x: Doc) =>
                (x.fields as any)?.['project-year']
                  ? Number((x.fields as any)['project-year']) === year
                  : Number(fy) === year
              )
            )
          )
          qDone = true; check()
        }
      }))
      unsubs.push(subscribeArr(`users/${USER_ID}/data/yr_${y}_i`, d => {
        iByYear[y] = d
        if (++iCount >= SCAN_YEARS.length) {
          setInvoices(
            Object.entries(iByYear).flatMap(([fy, docs]) =>
              docs.filter((x: Doc) => x?.fields?.['i-no']).filter((x: Doc) =>
                (x.fields as any)?.['project-year']
                  ? Number((x.fields as any)['project-year']) === year
                  : Number(fy) === year
              )
            )
          )
          iDone = true; check()
        }
      }))
    })

    const unsubA = subscribeArr(akumPath, d => { setAkumulasi(d); aDone = true; check() })
    unsubs.push(unsubA)

    return () => { unsubs.forEach(fn => fn()) }
  }, [year])

  // Build rows
  const rows = bRows(quotations, invoices, akumulasi, year)
  const visibleRows = filterRowsByQuery(rows, searchQuery)

  // Group by brand (case-insensitive: "handika" dan "Handika" dianggap satu brand)
  const brandMap: Record<string, { display: string; rows: AkumRow[] }> = {}
  visibleRows.forEach(r => {
    const b = r.brand || '(Tanpa Brand)'
    const key = b.toLowerCase()
    if (!brandMap[key]) brandMap[key] = { display: b, rows: [] }
    brandMap[key].rows.push(r)
  })
  const brands: [string, AkumRow[]][] = Object.values(brandMap).map(v => [v.display, v.rows])

  // Totals — gunakan sumber pembayaran efektif, bukan menjumlahkan seluruh
  // baris mentah yang bisa mengandung duplikasi QTT/INV dari txId yang sama.
  const totalSummary = calculateRowsSummary(visibleRows)
  const totKontrak = totalSummary.contract
  const totBayar = totalSummary.paid
  const totSisa = totalSummary.remaining
  const totalProjectCount = new Set(visibleRows.filter(row => !row.isExtra).map(docKey)).size

  // ── mutations ───────────────────────────────────────────────────────────────

  const handleUpdate = useCallback(async (rid: string, field: string, value: string) => {
    const updated = [...akumulasi]
    const idx = updated.findIndex(r => r.rid === rid)
    if (idx >= 0) {
      updated[idx] = { ...updated[idx], [field]: value }
    } else {
      // New entry from bRows that doesn't exist in akumulasi yet
      const fromRows = rows.find(r => r.rid === rid)
      if (fromRows) updated.push({ ...fromRows, [field]: value })
    }
    setAkumulasi(updated)
    await saveArr(akumPath, updated)
  }, [akumulasi, rows, akumPath])

  const handleAddCicilan = useCallback(async (parentRid: string, brand: string, client: string, noQuo: string, noInv: string) => {
    const newRid = `pay-${parentRid}-${Date.now()}`
    const newRow: AkumRow = {
      rid: newRid, yr: year, brand, client, item: '', sow: '',
      noQuo, noInv, totalAmt: 0, statusInv: '', due: '',
      tgl: '', ket: '', nom: '', rek: '', isExtra: true, parentRid
    }
    const updated = [...akumulasi, newRow]
    setAkumulasi(updated)
    await saveArr(akumPath, updated)
  }, [akumulasi, year, akumPath])

  const handleDeleteCicilan = useCallback(async (rid: string) => {
    if (!confirm('Hapus cicilan ini?')) return
    const updated = akumulasi.filter(r => r.rid !== rid)
    setAkumulasi(updated)
    await saveArr(akumPath, updated)
  }, [akumulasi, akumPath])

  const handleUnlinkMutasiPayment = useCallback(async (row: AkumRow) => {
    const txId = paymentRowTxId(row)
    const targetDocType = row.targetDocType || (row.noInv ? 'invoice' : 'quotation')
    const targetDocNo = row.targetDocNo || (targetDocType === 'invoice' ? row.noInv : row.noQuo)
    if (!txId || !targetDocNo) {
      alert('Data link pembayaran tidak lengkap. Lepaskan link dari halaman Mutasi.')
      return
    }
    if (!confirm(`Lepas pembayaran Mutasi dari ${targetDocNo}?

Transaksi bank tetap ada. Hanya link ke dokumen ini yang dilepas.`)) return
    try {
      await unlinkMutasiPaymentTarget({
        txId,
        targetDocType,
        targetDocNo,
        targetDocYear: row.targetDocYear,
        targetProjectYear: row.targetProjectYear || row.yr,
        paymentDate: row.tgl,
      })
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Gagal melepas link pembayaran.')
    }
  }, [])

  const handleCountAsPaid = useCallback(async (
    parentRid: string, er: AkumRow, checked: boolean,
    totalAmt: number, noInv: string, noQuo: string, yr: number
  ) => {
    // 1. Update flag countAsPaid di akumulasi
    const updated = akumulasi.map(r => r.rid === er.rid ? { ...r, countAsPaid: checked } : r)
    setAkumulasi(updated)
    await saveArr(akumPath, updated)

    if (!totalAmt) return

    // 2. Payment log Mutasi dibaca langsung dari dokumen. Di sini hanya
    // kirim komponen manual yang memang dicentang sebagai pelunasan.
    const manualPaid = manualPaidForParent(
      updated,
      parentRid,
      updated.find(r => r.rid === parentRid && !r.isExtra) || {},
    )

    // 3. Update status pada tahun penyimpanan dokumen yang sebenarnya.
    const updatedStatus = await updateLinkedDocumentPaymentStatus({
      docType: noInv ? 'invoice' : 'quotation',
      docNo: noInv || noQuo,
      projectYear: yr,
      manualPaid,
    })
    if (!updatedStatus) {
      alert(`Status ${noInv || noQuo} belum berhasil diperbarui. Dokumen tidak ditemukan pada tahun penyimpanannya.`)
    }
  }, [akumulasi, akumPath])

  // ── export CSV ──────────────────────────────────────────────────────────────

  const handleExport = () => {
    const headers = ['Tahun','Brand','Klien','Item','SOW','No.Quo','No.Inv','Total','Status','Tgl','Ket','Nominal','Rek']
    const csvRows = [headers.join(',')]
    brands.forEach(([brand, bRows]) => {
      const mainRows = bRows.filter(r => !r.isExtra)
      mainRows.forEach(r => {
        csvRows.push([r.yr, r.brand, r.client, r.item, r.sow, r.noQuo, r.noInv, r.totalAmt, r.statusInv, r.tgl, r.ket, pN(r.nom), r.rek]
          .map(x => `"${String(x || '').replace(/"/g, '""')}"`).join(','))
      })
    })
    const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `Akumulasi_FinanceBub_${year}_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  // ── render ──────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            Akumulasi Project <span className="text-gray-400 font-normal text-base">{year}</span>
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">Tracking pembayaran masuk per brand & project</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <select value={year} onChange={e => { const nextYear = +e.target.value; setYear(nextYear); persistActiveYear(nextYear) }}
              className="appearance-none pl-3 pr-8 py-2 text-sm border border-gray-200 rounded-lg bg-white text-gray-700 outline-none focus:border-[#1B8A7A] cursor-pointer">
              {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          </div>
          <button onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 text-sm rounded-lg hover:bg-gray-50 text-gray-600">
            <Download size={14} /> CSV
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 md:gap-4 mb-5">
        {[
          { label: 'Project', value: String(totalProjectCount), color: '#2D5A2D' },
          { label: 'Jumlah Kontrak', value: `Rp ${fmt(totKontrak)}`, color: '#185FA5' },
          { label: 'Pembayaran Masuk', value: `Rp ${fmt(totBayar)}`, color: '#3B6D11' },
          { label: 'Sisa / Kurang', value: `Rp ${fmt(Math.abs(totSisa))}`, color: totSisa > 0 ? '#DC2626' : '#3B6D11' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <div className="text-xs text-gray-400 mb-1">{s.label}</div>
            <div className="text-base font-bold" style={{ color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 mb-5">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={searchQuery}
            onChange={event => setSearchQuery(event.target.value)}
            placeholder="Search by Nomor QTT/INV, vendor, brand, item..."
            className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[#1B8A7A] focus:ring-2 focus:ring-[#1B8A7A]/10"
          />
        </div>
        {searchQuery.trim() && (
          <div className="mt-2 text-[11px] text-gray-400">
            Menampilkan {brands.length} brand / {totalProjectCount} project yang cocok dengan “{searchQuery.trim()}”.
          </div>
        )}
      </div>

      {/* Brand sections */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
              <div className="h-8 bg-gray-100 rounded mb-3" />
              <div className="h-24 bg-gray-50 rounded" />
            </div>
          ))}
        </div>
      ) : brands.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <div className="text-gray-300 text-4xl mb-3">📊</div>
          <p className="text-sm text-gray-400">{searchQuery.trim() ? 'Data tidak ditemukan untuk kata kunci ini.' : `Belum ada data akumulasi di tahun ${year}.`}</p>
          <p className="text-xs text-gray-400 mt-1">Data akan muncul otomatis setelah ada Quotation atau Invoice.</p>
        </div>
      ) : (
        brands.map(([brand, bR]) => (
          <BrandSection
            key={brand}
            brand={brand}
            rows={bR}
            year={year}
            onUpdate={handleUpdate}
            onAddCicilan={handleAddCicilan}
            onDeleteCicilan={handleDeleteCicilan}
            onUnlinkMutasi={handleUnlinkMutasiPayment}
            onCountAsPaid={handleCountAsPaid}
            onOpenDoc={(type, docNo) => {
              router.push(`/${type}?open=${encodeURIComponent(docNo)}&back=akumulasi`)
            }}
            onOpenMutasi={row => {
              const href = buildMutasiHref(row)
              if (href) router.push(href)
            }}
          />
        ))
      )}
    </div>
  )
}
