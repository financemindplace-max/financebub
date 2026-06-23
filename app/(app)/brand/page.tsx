'use client'
// ─── app/(app)/brand/page.tsx ─────────────────────────────────────────────────

import { Fragment, useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ref, onValue, off, set } from 'firebase/database'
import { db } from '@/lib/firebase'
import { fetchDocs } from '@/lib/rtdb'
import { getInvoicePayments, getQuotationPayments, unlinkMutasiPaymentTarget, updateLinkedDocumentPaymentStatus, type InvoicePaymentLog } from '@/lib/invoice-payment-link'
import { fmt, fmtDate } from '@/lib/utils'
import type { Doc } from '@/types/document'
import { ChevronDown, ArrowLeft, ExternalLink, Download, Search, Lock, Unlink } from 'lucide-react'
import { useActiveYear } from '@/lib/use-active-year'

const USER_ID = 'financebub-main'

// ── types ─────────────────────────────────────────────────────────────────────

interface AkumRow {
  rid: string; yr: number; brand: string; client: string
  item: string; sow: string; noQuo: string; noInv: string
  totalAmt: number; statusInv: string; due: string
  tgl: string; ket: string; nom: string; rek: string
  isExtra: boolean; parentRid?: string; theme?: string
  fromMutasi?: boolean; countAsPaid?: boolean
  txId?: string; accountId?: string; targetDocType?: 'invoice' | 'quotation'; targetDocNo?: string
  targetDocYear?: number; targetProjectYear?: number
}

interface BrandSummary {
  name: string; kontrak: number; bayar: number; sisa: number
  projectCount: number; status: 'Lunas' | 'Kurang Bayar' | 'Lebih Bayar'; theme: string
}

// ── helpers ───────────────────────────────────────────────────────────────────

function gTot(doc: Doc): number {
  const sub = doc.items?.reduce((a, i) => a + (+i.amount || 0), 0) || 0
  return sub - +(doc.fields?.['q-disc'] || 0) + +(doc.fields?.['q-gross'] || 0)
}
function pN(s: string | number): number {
  return parseFloat(String(s || '0').replace(/[^0-9.-]/g, '')) || 0
}
function fmtNom(s: string | number): string {
  const n = pN(s); if (!n) return ''; return Math.round(n).toLocaleString('id-ID')
}

function normSearch(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}
function docKey(row: AkumRow): string {
  // Semua item dan cicilan dari dokumen yang sama harus tetap satu grup saat
  // pencarian. parentRid tidak boleh menjadi bagian key karena extra row akan
  // punya parentRid sementara main row tidak.
  const noQuo = String(row.noQuo || '').trim()
  const noInv = String(row.noInv || '').trim()
  if (noQuo || noInv) return `${noQuo}|${noInv}`
  return row.parentRid || row.rid
}
function rowMatchesQuery(row: AkumRow, query: string): boolean {
  const q = normSearch(query).trim()
  if (!q) return true
  return [row.noQuo, row.noInv, row.client, row.brand, row.item, row.sow, row.ket, row.rek, row.nom]
    .map(normSearch)
    .join(' ')
    .includes(q)
}
function filterRowsByQuery(rows: AkumRow[], query: string): AkumRow[] {
  const q = query.trim()
  if (!q) return rows
  const matchedKeys = new Set(rows.filter(row => rowMatchesQuery(row, q)).map(docKey))
  return rows.filter(row => matchedKeys.has(docKey(row)))
}
function isFromMutasiRow(row: AkumRow): boolean {
  return Boolean(row.fromMutasi || row.rid.includes('-mutasi-'))
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
    try { const val = snap.val(); const arr = typeof val === 'string' ? JSON.parse(val) : val; cb(Array.isArray(arr) ? arr.filter(Boolean) : []) }
    catch { cb([]) }
  }
  onValue(dbRef, handler)
  return () => off(dbRef, 'value', handler)
}
async function saveArr(path: string, arr: any[]) {
  await set(ref(db, path), JSON.stringify(arr))
  await set(ref(db, `users/${USER_ID}/data/_ts`), Date.now())
}
function inheritItems(items: Doc['items']) {
  let lb = '', li = ''
  return (items || []).map(it => {
    const b = (it.brand || '').trim() || lb; const i = (it.item || '').trim() || li
    if (b) lb = b; if (i) li = i
    return { ...it, brand: b, item: i }
  })
}
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

function buildRows(quotations: Doc[], invoices: Doc[], akumulasi: AkumRow[], yr: number): AkumRow[] {
  const mm: Record<string, AkumRow> = {}
  akumulasi.forEach(m => { mm[m.rid] = m })
  const rows: AkumRow[] = [], uQ = new Set<string>(), uI = new Set<string>()

  quotations.forEach(q => {
    const qNo = q.fields?.['q-no'] || ''
    if (!qNo) return
    const linkedInv = invoices.find(i => i.fields?.['i-ref'] === qNo)
    const projectYear = Number((q.fields as any)?.['project-year'] || (linkedInv?.fields as any)?.['project-year'] || yr)

    inheritItems(q.items).forEach(it => {
      const rid = `${projectYear}_${qNo}_${it.brand || ''}_${it.item || ''}`
      if (uQ.has(rid)) return
      uQ.add(rid)
      const m2: Partial<AkumRow> = mm[rid] || {}
      const linkedInvoiceNo = linkedInv?.fields?.['i-no'] || ''
      const totalAmt = linkedInv ? gTot(linkedInv) : gTot(q)
      const linkedLogs = linkedInv ? getInvoicePayments(linkedInv) : getQuotationPayments(q)
      const manualPaid = manualPaidForParent(akumulasi, rid, m2)
      const rawStatus = linkedInv?.fields?.['i-status'] || q.fields?.['q-status'] || ''
      const computedStatus = derivePaymentStatus(
        totalAmt,
        linkedLogs.reduce((sum, log) => sum + pN(log.amount), 0) + manualPaid,
        rawStatus,
      )
      rows.push({
        rid, yr, brand: it.brand, client: q.fields['cl-name'] || '', item: it.item,
        sow: it.sow || '', noQuo: qNo, noInv: linkedInvoiceNo,
        totalAmt,
        statusInv: computedStatus, due: linkedInv?.fields?.['i-due'] || '',
        tgl: m2.tgl || '', ket: m2.ket || '', nom: m2.nom || '', rek: m2.rek || '',
        isExtra: false, theme: q.theme || linkedInv?.theme || '',
      })

      const sources: PaymentSource[] = [{
        docType: 'quotation',
        docNo: qNo,
        docYear: inferDocYear(qNo, yr),
        projectYear,
        noQuo: qNo,
        noInv: linkedInvoiceNo,
        logs: getQuotationPayments(q),
      }]
      if (linkedInv && linkedInvoiceNo) {
        sources.push({
          docType: 'invoice',
          docNo: linkedInvoiceNo,
          docYear: inferDocYear(linkedInvoiceNo, yr),
          projectYear: Number((linkedInv.fields as any)?.['project-year'] || projectYear),
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
    const projectYear = Number((inv.fields as any)?.['project-year'] || yr)

    inheritItems(inv.items).forEach(it => {
      const rid = `${projectYear}_inv_${iNo}_${it.brand || ''}_${it.item || ''}`
      if (uI.has(rid)) return
      uI.add(rid)
      const m2: Partial<AkumRow> = mm[rid] || {}
      const totalAmt = gTot(inv)
      const manualPaid = manualPaidForParent(akumulasi, rid, m2)
      const computedStatus = derivePaymentStatus(
        totalAmt,
        getInvoicePayments(inv).reduce((sum, log) => sum + pN(log.amount), 0) + manualPaid,
        inv.fields['i-status'] || '',
      )
      rows.push({
        rid, yr, brand: it.brand, client: inv.fields['cl-name'] || '', item: it.item,
        sow: it.sow || '', noQuo: '', noInv: iNo, totalAmt,
        statusInv: computedStatus, due: inv.fields['i-due'] || '',
        tgl: m2.tgl || '', ket: m2.ket || '', nom: m2.nom || '', rek: m2.rek || '',
        isExtra: false, theme: inv.theme || '',
      })
      rows.push(...collectPaymentRows(akumulasi, rid, yr, it.brand, inv.fields['cl-name'] || '', [{
        docType: 'invoice',
        docNo: iNo,
        docYear: inferDocYear(iNo, yr),
        projectYear,
        noQuo: '',
        noInv: iNo,
        logs: getInvoicePayments(inv),
      }]))
    })
  })

  return rows
}
function calcBrands(rows: AkumRow[]): BrandSummary[] {
  const bMap: Record<string, { rows: AkumRow[]; theme: string }> = {}
  rows.forEach(r => { const b = r.brand || '(Tanpa Brand)'; if (!bMap[b]) bMap[b] = { rows: [], theme: '' }; bMap[b].rows.push(r); if (r.theme && !bMap[b].theme) bMap[b].theme = r.theme })
  return Object.entries(bMap).map(([name, { rows: bR, theme }]) => {
    const summary = calculateRowsSummary(bR)
    const sisa = summary.remaining
    const status: BrandSummary['status'] = Math.abs(sisa) < 1 ? 'Lunas' : sisa > 0 ? 'Kurang Bayar' : 'Lebih Bayar'
    const projectCount = new Set(bR.filter(row => !row.isExtra).map(docKey)).size
    return { name, kontrak: summary.contract, bayar: summary.paid, sisa, projectCount, status, theme: theme || '#1B8A7A' }
  }).sort((a, b) => ({ 'Kurang Bayar': 0, 'Lebih Bayar': 1, 'Lunas': 2 }[a.status] || 0) - ({ 'Kurang Bayar': 0, 'Lebih Bayar': 1, 'Lunas': 2 }[b.status] || 0))
}

const ST = { 'Lunas': { bg: '#F0FDF4', color: '#2E6B10', dot: '#3B6D11' }, 'Kurang Bayar': { bg: '#FEF2F2', color: '#B91C1C', dot: '#DC2626' }, 'Lebih Bayar': { bg: '#EFF6FF', color: '#1D4ED8', dot: '#1D4ED8' } }
const INV_ST: Record<string, string> = { 'Draft': 'bg-gray-100 text-gray-500', 'Terbit': 'bg-blue-100 text-blue-700', 'Belum Lunas': 'bg-amber-100 text-amber-700', 'Dibayar Sebagian': 'bg-amber-100 text-amber-700', 'Lunas': 'bg-green-100 text-green-700', 'Lebih Bayar': 'bg-purple-100 text-purple-700', 'Overdue': 'bg-red-100 text-red-600', 'Overpaid': 'bg-purple-100 text-purple-700' }

// ── Editable cell ─────────────────────────────────────────────────────────────
function EC({ value, onChange, type = 'text', placeholder = '' }: { value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  const [local, setLocal] = useState(value)
  useEffect(() => setLocal(value), [value])
  return (
    <input type={type} value={local} placeholder={placeholder}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => { if (local !== value) onChange(local) }}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A] focus:ring-1 focus:ring-[#1B8A7A]/10 bg-white transition-all" />
  )
}

// ── Brand Detail with editing ─────────────────────────────────────────────────
function BrandDetail({ brand, allRows, akumulasi, year, akumPath, setAkumulasi, onBack }: {
  brand: BrandSummary; allRows: AkumRow[]; akumulasi: AkumRow[]
  year: number; akumPath: string; setAkumulasi: (a: AkumRow[]) => void; onBack: () => void
}) {
  const router = useRouter()
  const [detailSearch, setDetailSearch] = useState('')
  const baseRows = allRows.filter(r => (r.brand || '(Tanpa Brand)') === brand.name)
  const rows = filterRowsByQuery(baseRows, detailSearch)

  const summary = calculateRowsSummary(rows)
  const kontrak = summary.contract
  const bayar = summary.paid
  const sisa = summary.remaining
  const st = ST[brand.status]

  const mainRows = rows.filter(r => !r.isExtra)
  const docMap: Record<string, AkumRow[]> = {}
  mainRows.forEach(r => { const dk = (r.noQuo || '__') + '|' + (r.noInv || '__'); if (!docMap[dk]) docMap[dk] = []; docMap[dk].push(r) })
  const overpayDetails = Object.values(docMap).flatMap(dR => {
    const first = dR[0]
    const allExtraRows = rows.filter(row => row.isExtra && row.parentRid === first.rid)
    const { paymentRow, extraRows } = resolvePaymentRows(first, allExtraRows)
    return getOverpayDetails(first.totalAmt, [paymentRow, ...extraRows], first.noInv || first.noQuo)
  })

  const handleUpdate = useCallback(async (rid: string, field: string, value: string) => {
    const updated = [...akumulasi]
    const idx = updated.findIndex(r => r.rid === rid)
    if (idx >= 0) { updated[idx] = { ...updated[idx], [field]: value } }
    else { const fr = baseRows.find(r => r.rid === rid); if (fr) updated.push({ ...fr, [field]: value }) }
    setAkumulasi(updated)
    await saveArr(akumPath, updated)
  }, [akumulasi, baseRows, akumPath])

  const handleAddCicilan = useCallback(async (parentRid: string, b: string, client: string, noQuo: string, noInv: string) => {
    const newRid = `pay-${parentRid}-${Date.now()}`
    const newRow: AkumRow = { rid: newRid, yr: year, brand: b, client, item: '', sow: '', noQuo, noInv, totalAmt: 0, statusInv: '', due: '', tgl: '', ket: '', nom: '', rek: '', isExtra: true, parentRid }
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
    const updated = akumulasi.map(r => r.rid === er.rid ? { ...r, countAsPaid: checked } : r)
    setAkumulasi(updated)
    await saveArr(akumPath, updated)
    if (!totalAmt) return
    const manualPaid = manualPaidForParent(
      updated,
      parentRid,
      updated.find(r => r.rid === parentRid && !r.isExtra) || {},
    )
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

  const downloadBrandPdf = useCallback(() => {
    const reportRows = rows
    if (!reportRows.length) {
      alert('Tidak ada data untuk brand ini')
      return
    }

    const bTheme = reportRows.find(r => r.theme)?.theme || brand.theme || '#2D5A2D'
    const pdfSummary = calculateRowsSummary(reportRows)
    const kontrakPdf = pdfSummary.contract
    const bayarPdf = pdfSummary.paid
    const sisaPdf = pdfSummary.remaining
    const projectCountPdf = new Set(reportRows.filter(row => !row.isExtra).map(docKey)).size

    const escapeHtml = (value: unknown) => String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
    const dateLabel = (value: string) => {
      if (!value) return '—'
      const parts = value.split('-')
      if (parts.length < 3) return value
      return `${parseInt(parts[2], 10)} ${monthNames[Number(parts[1]) - 1] || ''} ${parts[0]}`
    }
    const money = (value: number) => value ? Math.round(value).toLocaleString('id-ID') : '—'
    const lightenHex = (hexValue: string, ratio: number) => {
      let hex = (hexValue || '#2D5A2D').replace('#', '')
      if (hex.length === 3) hex = hex.split('').map(c => c + c).join('')
      const r = parseInt(hex.slice(0, 2), 16)
      const g = parseInt(hex.slice(2, 4), 16)
      const b = parseInt(hex.slice(4, 6), 16)
      const mix = (v: number) => Math.round(v + (255 - v) * ratio).toString(16).padStart(2, '0')
      return `#${mix(r)}${mix(g)}${mix(b)}`
    }
    const statusHtml = () => {
      if (bayarPdf === 0 && kontrakPdf > 0) {
        return '<span class="s-k">KURANG BAYAR</span><span style="font-size:11px;color:#555;margin-left:8px">Belum ada pembayaran</span>'
      }
      if (Math.abs(sisaPdf) < 1) return '<span class="s-l">✓ LUNAS</span>'
      if (sisaPdf > 0) return `<span class="s-k">KURANG BAYAR</span><span style="font-size:11px;color:#555;margin-left:8px">Sisa: Rp ${Math.round(sisaPdf).toLocaleString('id-ID')}</span>`
      return `<span class="s-lb">LEBIH BAYAR</span><span style="font-size:11px;color:#555;margin-left:8px">Lebih: Rp ${Math.round(-sisaPdf).toLocaleString('id-ID')}</span>`
    }
    const invoiceBadge = (value: string) => {
      if (!value) return '<span style="color:#6b7280;font-size:9px">—</span>'
      const cls = value === 'Lunas' ? 's-l' : value === 'Terbit' ? 's-lb' : value === 'Belum Lunas' || value === 'Overdue' ? 's-k' : ''
      if (cls) return `<span class="${cls}" style="font-size:9px;padding:2px 8px">${escapeHtml(value)}</span>`
      return `<span style="background:#f3f4f6;color:#374151;padding:2px 8px;border-radius:4px;font-size:9px">${escapeHtml(value)}</span>`
    }

    const grouped: Record<string, AkumRow[]> = {}
    reportRows.filter(r => !r.isExtra).forEach(r => {
      const key = `${r.noQuo || '__'}|${r.noInv || '__'}`
      if (!grouped[key]) grouped[key] = []
      grouped[key].push(r)
    })

    const rowHtml = Object.values(grouped).map(group => {
      const first = group[0]
      const allExtraRows = reportRows.filter(r => r.isExtra && r.parentRid === first.rid)
      const { paymentRow: payment, extraRows: remainingExtraRows } = resolvePaymentRows(first, allExtraRows)
      const itemHtml = group.map((r, i) => {
        const parts = []
        if (r.item) parts.push(`<b>${escapeHtml(r.item)}</b>`)
        if (r.sow) parts.push(`<div style="font-size:9px;color:#6b7280;margin-top:1px">${escapeHtml(r.sow).replace(/\n/g, '<br>')}</div>`)
        return `<div ${i > 0 ? 'style="border-top:1px dashed #e5e7eb;padding-top:3px;margin-top:3px"' : ''}>${parts.join('')}</div>`
      }).join('')
      const nomVal = pN(payment?.nom || '')
      const td = 'padding:6px 10px;border-bottom:1px solid #e5e7eb;border-right:1px solid #e5e7eb;vertical-align:middle;'
      const tdTop = 'padding:6px 10px;border-bottom:1px solid #e5e7eb;border-right:1px solid #e5e7eb;vertical-align:top;'
      const main = `<tr style="background:#fff">
        <td style="${td}"><b>${escapeHtml(first.client)}</b>${first.due ? `<div style="font-size:9px;color:#6b7280">Due: ${dateLabel(first.due)}</div>` : ''}</td>
        <td style="${td}"><span style="background:${first.theme || bTheme};color:#fff;padding:2px 8px;border-radius:99px;font-size:9px;font-weight:600;display:inline-block;white-space:nowrap">${escapeHtml(first.brand)}</span></td>
        <td style="${tdTop}">${itemHtml}</td>
        <td style="${td}font-size:9px;color:#6b7280">${escapeHtml(first.noQuo || '—')}</td>
        <td style="${td}font-size:9px;color:#6b7280">${escapeHtml(first.noInv || '—')}</td>
        <td style="${td}font-weight:600;color:#1B8A7A;white-space:nowrap">${money(first.totalAmt)}</td>
        <td style="${td}">${invoiceBadge(first.statusInv)}</td>
        <td style="${td}font-size:9px;color:#444">${dateLabel(payment?.tgl || '')}</td>
        <td style="${td}font-size:9px;color:#444">${escapeHtml(payment?.ket || '')}</td>
        <td style="${td}font-weight:600;color:#1B8A7A;white-space:nowrap">${nomVal > 0 ? money(nomVal) : '—'}</td>
        <td style="${td}font-size:9px;color:#444;border-right:none">${escapeHtml(payment?.rek || '')}</td>
      </tr>`
      const extras = remainingExtraRows.map(er => {
        const enom = pN(er.nom)
        return `<tr style="background:#F0FDF4;border-left:3px solid #1B8A7A">
          <td colspan="7" style="background:#F0FDF4;border-bottom:1px solid #e5e7eb;padding:6px 10px;color:#6b7280;font-size:9px">↳ Cicilan tambahan</td>
          <td style="font-size:9px;color:#444;background:#F0FDF4;border-bottom:1px solid #e5e7eb;padding:6px 10px">${dateLabel(er.tgl)}</td>
          <td style="font-size:9px;color:#444;background:#F0FDF4;border-bottom:1px solid #e5e7eb;padding:6px 10px">${escapeHtml(er.ket)}</td>
          <td style="font-weight:600;color:#1B8A7A;white-space:nowrap;background:#F0FDF4;border-bottom:1px solid #e5e7eb;padding:6px 10px">${enom > 0 ? money(enom) : '—'}</td>
          <td style="font-size:9px;color:#444;background:#F0FDF4;border-bottom:1px solid #e5e7eb;padding:6px 10px">${escapeHtml(er.rek)}</td>
        </tr>`
      }).join('')
      return main + extras
    }).join('')

    const today = new Date()
    const todayLabel = `${today.getDate()} ${monthNames[today.getMonth()]} ${today.getFullYear()}`
    const safeTitle = `Status Brand ${brand.name} ${year}`.replace(/[\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim()
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escapeHtml(safeTitle)}</title>
      <style>
        @page{size:A4 landscape;margin:12mm 10mm}
        *{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}
        body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:11px;color:#1a1a1a;background:#fff}
        .aw{margin-bottom:10px;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden}
        .ah{color:#fff;font-size:12px;font-weight:500;padding:8px 12px;display:flex;align-items:center;justify-content:space-between;gap:6px;background:${bTheme}!important}
        .at{width:100%;border-collapse:collapse;font-size:10px}.at th{color:#fff;padding:6px 10px;text-align:left;font-size:9px;font-weight:600;white-space:nowrap;border-right:1px solid rgba(255,255,255,.1)}
        .at th:last-child{border-right:none}.at td{padding:6px 10px;border-bottom:1px solid #e5e7eb;border-right:1px solid #e5e7eb;vertical-align:middle}.at td:last-child{border-right:none}
        .sr td{background:#EEF5E8!important;font-weight:600;color:#2D5A2D;border-top:2px solid #4A7C4A}.str td{background:#EEF5E8!important}.sl{font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:#4A7C4A}
        .s-l{background:#2E6B10;color:#fff;border-radius:5px;padding:2px 10px;font-size:10px;font-weight:600;display:inline-block}.s-k{background:#B91C1C;color:#fff;border-radius:5px;padding:2px 10px;font-size:10px;font-weight:600;display:inline-block}.s-lb{background:#1D4ED8;color:#fff;border-radius:5px;padding:2px 10px;font-size:10px;font-weight:600;display:inline-block}
        .footer{margin-top:6px;font-size:8px;color:#888;display:flex;justify-content:space-between}
      </style></head><body>
      <div class="aw"><div class="ah"><span>📄 ${escapeHtml(brand.name)}</span><span style="font-size:11px;opacity:.85">${projectCountPdf} project · Kontrak Rp ${money(kontrakPdf)}</span></div>
      <table class="at"><thead><tr style="background:${lightenHex(bTheme, 0.15)}!important"><th>Klien</th><th>Brand</th><th>Item / SOW</th><th>No. Quotation</th><th>No. Invoice</th><th>Total</th><th>Status</th><th>Tgl Pembayaran</th><th>Keterangan</th><th>Nominal Pembayaran</th><th>Rekening</th></tr></thead><tbody>
      ${rowHtml}
      <tr class="sr"><td colspan="5" style="text-align:right;padding-right:16px"><span class="sl">Jumlah Kontrak</span></td><td><span style="font-size:9px;color:#4A7C4A">Rp </span><b>${money(kontrakPdf)}</b></td><td colspan="5"></td></tr>
      <tr class="sr"><td colspan="5" style="text-align:right;padding-right:16px"><span class="sl">Jumlah Pembayaran Masuk</span></td><td><span style="font-size:9px;color:#4A7C4A">Rp </span><b>${money(bayarPdf)}</b></td><td colspan="5"></td></tr>
      <tr class="sr"><td colspan="5" style="text-align:right;padding-right:16px"><span class="sl">Kurang / Sisa Pembayaran</span></td><td><span style="font-size:9px;color:#4A7C4A">Rp </span><b>${money(Math.abs(sisaPdf))}</b></td><td colspan="5"></td></tr>
      <tr class="str"><td colspan="5" style="text-align:right;padding-right:16px;background:#EEF5E8;border-top:2px solid #4A7C4A"><span class="sl">Status Pembayaran</span></td><td colspan="6" style="background:#EEF5E8;border-top:2px solid #4A7C4A">${statusHtml()}</td></tr>
      </tbody></table></div><div class="footer"><span>FinanceBub FinanceSuite — Status Brand: ${escapeHtml(brand.name)} — Tahun ${year}</span><span>Dicetak: ${todayLabel}</span></div>
      </body></html>`

    const printWindow = window.open('', '_blank', 'width=1280,height=800')
    if (!printWindow) {
      alert('Popup diblokir browser. Izinkan popup lalu coba lagi.')
      return
    }
    printWindow.document.write(html)
    printWindow.document.close()
    printWindow.onload = () => {
      printWindow.focus()
      printWindow.print()
    }
  }, [rows, brand, year])

  return (
    <div>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900">
            <ArrowLeft size={16} /> Daftar Brand
          </button>
          <span className="text-gray-300">|</span>
          <h1 className="text-xl font-semibold text-gray-900">📄 {brand.name} <span className="text-gray-400 font-normal text-base">{year}</span></h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={downloadBrandPdf} className="flex items-center gap-1.5 text-sm bg-[#1B8A7A] text-white hover:bg-[#0F6E56] border border-[#1B8A7A] rounded-lg px-3 py-1.5 font-medium">
            <Download size={13} /> Download PDF
          </button>
          <button onClick={() => router.push('/akumulasi')} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 border border-gray-200 rounded-lg px-3 py-1.5">
            Akumulasi Lengkap <ExternalLink size={13} />
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl px-5 py-4 mb-5 flex items-center justify-between flex-wrap gap-4">
        <div className="flex gap-8 flex-wrap">
          {[{ label: 'JUMLAH KONTRAK', value: `Rp ${fmt(kontrak)}`, color: '#185FA5' }, { label: 'PEMBAYARAN MASUK', value: `Rp ${fmt(bayar)}`, color: '#3B6D11' }, { label: 'SISA / KELEBIHAN', value: `Rp ${fmt(Math.abs(sisa))}`, color: Math.abs(sisa) < 1 ? '#3B6D11' : sisa > 0 ? '#DC2626' : '#1D4ED8' }].map(s => (
            <div key={s.label}><div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">{s.label}</div><div className="text-lg font-bold" style={{ color: s.color }}>{s.value}</div></div>
          ))}
        </div>
        <div className="text-sm font-bold px-4 py-2 rounded-full" style={{ backgroundColor: st.bg, color: st.color }}>
          {Math.abs(sisa) < 1 ? '✓ LUNAS' : brand.status === 'Kurang Bayar' ? `KURANG BAYAR · Sisa Rp ${fmt(Math.round(sisa))}` : `LEBIH BAYAR · Lebih Rp ${fmt(Math.round(-sisa))}`}
        </div>
      </div>

      {/* Search */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 mb-5">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={detailSearch}
            onChange={event => setDetailSearch(event.target.value)}
            placeholder="Search by Nomor QTT/INV, vendor, brand, item..."
            className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[#1B8A7A] focus:ring-2 focus:ring-[#1B8A7A]/10"
          />
        </div>
      </div>

      {/* Editable table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs" style={{ minWidth: 950 }}>
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                {['Klien','Brand','Item / SOW','No. QTT','No. INV','Total','Status','Tgl Bayar','Keterangan','Nominal','Rekening',''].map((h, i) => (
                  <th key={i} className="px-3 py-2.5 text-left text-[10px] font-semibold text-gray-400 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.values(docMap).map((dR, di) => {
                const fr = dR[0]
                const allExtraRows = rows.filter(r => r.isExtra && r.parentRid === fr.rid)
                const { paymentRow, extraRows } = resolvePaymentRows(fr, allExtraRows)
                const paymentRid = paymentRow.rid
                const paymentIsFromMutasi = isFromMutasiRow(paymentRow)
                const overpayByRid = new Map(
                  getOverpayDetails(fr.totalAmt, [paymentRow, ...extraRows], fr.noInv || fr.noQuo)
                    .map(detail => [detail.row.rid, detail.amount]),
                )
                const paymentOverpay = overpayByRid.get(paymentRow.rid) || 0
                return (
                  <Fragment key={fr.rid || `doc-${di}`}>
                    <tr className={`border-b border-gray-50 ${di % 2 === 0 ? '' : 'bg-gray-50/40'}`}>
                      <td className="px-3 py-2.5 font-medium text-gray-800 min-w-[130px]">
                        {fr.client}
                        {fr.due && <div className="text-[10px] text-gray-400">Due: {fmtDate(fr.due)}</div>}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold text-white" style={{ backgroundColor: fr.theme || '#1B8A7A' }}>{fr.brand}</span>
                      </td>
                      <td className="px-3 py-2.5 max-w-[180px]">
                        {dR.map((r, ri) => (
                          <div key={ri} className={ri > 0 ? 'border-t border-dashed border-gray-200 pt-1 mt-1' : ''}>
                            {r.item && <div className="font-medium">{r.item}</div>}
                            {r.sow && <div className="text-gray-400 text-[10px]">{r.sow}</div>}
                          </div>
                        ))}
                      </td>
                      <td className="px-3 py-2.5 text-gray-400 font-mono text-[10px] whitespace-nowrap">
                        {fr.noQuo
                          ? <button onClick={() => router.push(`/quotation?open=${encodeURIComponent(fr.noQuo)}&back=brand`)} className="text-[#1B8A7A] hover:underline font-mono text-[10px] font-semibold">{fr.noQuo}</button>
                          : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-gray-400 font-mono text-[10px] whitespace-nowrap">
                        {fr.noInv
                          ? <button onClick={() => router.push(`/invoice?open=${encodeURIComponent(fr.noInv)}&back=brand`)} className="text-[#1B8A7A] hover:underline font-mono text-[10px] font-semibold">{fr.noInv}</button>
                          : '—'}
                      </td>
                      <td className="px-3 py-2.5 font-semibold text-gray-800 whitespace-nowrap">Rp {fmt(fr.totalAmt)}</td>
                      <td className="px-3 py-2.5">{fr.statusInv ? <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium ${INV_ST[fr.statusInv] || 'bg-gray-100 text-gray-500'}`}>{fr.statusInv}</span> : <span className="text-gray-300">—</span>}</td>
                      {/* PAYMENT CELLS — transaksi Mutasi pertama tampil di baris utama */}
                      <td className="px-2 py-1.5 min-w-[130px]">
                        {paymentIsFromMutasi
                          ? <span className="flex items-center gap-1 text-xs text-gray-500"><Lock className="w-3 h-3 text-blue-500" />{paymentRow.tgl ? fmtDate(paymentRow.tgl) : '—'}</span>
                          : <EC type="date" value={paymentRow.tgl || ''} onChange={v => handleUpdate(paymentRid, 'tgl', v)} />}
                      </td>
                      <td className="px-2 py-1.5 min-w-[150px]">
                        {paymentIsFromMutasi
                          ? <Link href={buildMutasiHref(paymentRow) || '/keuangan/mutasi'} title="Buka transaksi Mutasi" className="text-left text-xs text-blue-600 hover:underline">{paymentRow.ket || 'Buka transaksi Mutasi'}</Link>
                          : <EC value={paymentRow.ket || ''} placeholder="Keterangan..." onChange={v => handleUpdate(paymentRid, 'ket', v)} />}
                      </td>
                      <td className="px-2 py-1.5 min-w-[130px]">
                        {paymentIsFromMutasi
                          ? <div><span className="text-xs font-medium text-gray-600">{paymentRow.nom ? fmt(pN(paymentRow.nom)) : '—'}</span>{paymentOverpay > 0 && <span className="mt-1 inline-flex rounded-full bg-purple-100 px-2 py-0.5 text-[9px] font-semibold text-purple-700">Lebih bayar +Rp {fmt(Math.round(paymentOverpay))}</span>}</div>
                          : <div><EC value={fmtNom(paymentRow.nom || '')} placeholder="0" onChange={v => handleUpdate(paymentRid, 'nom', v.replace(/[^0-9.-]/g, ''))} />{paymentOverpay > 0 && <span className="mt-1 inline-flex rounded-full bg-purple-100 px-2 py-0.5 text-[9px] font-semibold text-purple-700">Lebih bayar +Rp {fmt(Math.round(paymentOverpay))}</span>}</div>}
                      </td>
                      <td className="px-2 py-1.5 min-w-[120px]">
                        {paymentIsFromMutasi
                          ? <span className="text-xs text-gray-500">{paymentRow.rek || '—'}</span>
                          : <EC value={paymentRow.rek || ''} placeholder="Rekening/Bank..." onChange={v => handleUpdate(paymentRid, 'rek', v)} />}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button onClick={() => handleAddCicilan(fr.rid, fr.brand, fr.client, fr.noQuo, fr.noInv)} title="Tambah baris pembayaran"
                            className="w-6 h-6 rounded-full flex items-center justify-center text-white text-sm font-bold hover:opacity-90 transition"
                            style={{ backgroundColor: brand.theme }}>+</button>
                          {paymentIsFromMutasi && (
                            <button onClick={() => handleUnlinkMutasiPayment(paymentRow)} title="Lepas link pembayaran dari dokumen ini"
                              className="w-7 h-7 rounded-full flex items-center justify-center bg-blue-50 text-blue-500 hover:bg-red-50 hover:text-red-600 transition">
                              <Unlink className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {extraRows.map(er => {
                      const isFromMutasi = isFromMutasiRow(er)
                      const extraOverpay = overpayByRid.get(er.rid) || 0
                      return (
                        <tr key={er.rid} className={`border-b ${isFromMutasi ? 'border-blue-100 bg-blue-50/30' : 'border-green-100'}`} style={isFromMutasi ? { borderLeft: '3px solid #3B82F6' } : { backgroundColor: '#F0FDF4', borderLeft: '3px solid #1B8A7A' }}>
                          <td colSpan={7} className="px-3 py-1.5">
                            {isFromMutasi
                              ? <span className="flex items-center gap-1 text-[10px] text-blue-500"><Lock className="w-3 h-3" /> Dari Mutasi</span>
                              : <label className="flex items-center gap-1.5 cursor-pointer">
                                  <input type="checkbox" checked={!!er.countAsPaid}
                                    onChange={e => handleCountAsPaid(fr.rid, er, e.target.checked, fr.totalAmt, fr.noInv, fr.noQuo, fr.yr)}
                                    className="w-3.5 h-3.5 accent-[#1B8A7A] cursor-pointer" />
                                  <span className="text-[10px] text-gray-500">Hitung sebagai pelunasan</span>
                                </label>
                            }
                          </td>
                          <td className="px-2 py-1.5 min-w-[130px]">
                            {isFromMutasi ? <span className="text-xs text-gray-500">{er.tgl ? fmtDate(er.tgl) : '—'}</span> : <EC type="date" value={er.tgl} onChange={v => handleUpdate(er.rid, 'tgl', v)} />}
                          </td>
                          <td className="px-2 py-1.5 min-w-[150px]">
                            {isFromMutasi ? <Link href={buildMutasiHref(er) || '/keuangan/mutasi'} title="Buka transaksi Mutasi" className="text-left text-xs text-blue-600 hover:underline">{er.ket || 'Buka transaksi Mutasi'}</Link> : <EC value={er.ket} placeholder="Keterangan cicilan..." onChange={v => handleUpdate(er.rid, 'ket', v)} />}
                          </td>
                          <td className="px-2 py-1.5 min-w-[130px]">
                            {isFromMutasi ? <div><span className="text-xs text-gray-500">{er.nom ? fmt(pN(er.nom)) : '—'}</span>{extraOverpay > 0 && <span className="mt-1 inline-flex rounded-full bg-purple-100 px-2 py-0.5 text-[9px] font-semibold text-purple-700">Lebih bayar +Rp {fmt(Math.round(extraOverpay))}</span>}</div> : <div><EC value={fmtNom(er.nom)} placeholder="0" onChange={v => handleUpdate(er.rid, 'nom', v.replace(/[^0-9.-]/g, ''))} />{extraOverpay > 0 && <span className="mt-1 inline-flex rounded-full bg-purple-100 px-2 py-0.5 text-[9px] font-semibold text-purple-700">Lebih bayar +Rp {fmt(Math.round(extraOverpay))}</span>}</div>}
                          </td>
                          <td className="px-2 py-1.5 min-w-[120px]">
                            {isFromMutasi ? <span className="text-xs text-gray-500">{er.rek || '—'}</span> : <EC value={er.rek} placeholder="Rekening/Bank..." onChange={v => handleUpdate(er.rid, 'rek', v)} />}
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            {isFromMutasi ? (
                              <button onClick={() => handleUnlinkMutasiPayment(er)} title="Lepas link pembayaran dari dokumen ini"
                                className="w-7 h-7 rounded-full flex items-center justify-center bg-blue-50 text-blue-500 hover:bg-red-50 hover:text-red-600 transition mx-auto">
                                <Unlink className="w-3.5 h-3.5" />
                              </button>
                            ) : (
                              <button onClick={() => handleDeleteCicilan(er.rid)} title="Hapus cicilan"
                                className="w-6 h-6 rounded-full flex items-center justify-center bg-red-50 text-red-400 hover:text-red-600 text-sm font-bold mx-auto">×</button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </Fragment>
                )
              })}
              {/* Summary */}
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
                <td colSpan={7} className="px-3 py-2 font-bold text-xs" style={{ color: st.color }}>
                  {Math.abs(sisa) < 1 ? '✓ LUNAS' : brand.status === 'Kurang Bayar' ? `KURANG BAYAR · Sisa Rp ${fmt(Math.round(sisa))}` : `LEBIH BAYAR · Lebih Rp ${fmt(Math.round(-sisa))}`}
                </td>
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
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function BrandPage() {
  const { year, years, setYear } = useActiveYear()
  const [quotations, setQuotations] = useState<Doc[]>([])
  const [invoices, setInvoices] = useState<Doc[]>([])
  const [akumulasi, setAkumulasi] = useState<AkumRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedBrand, setSelectedBrand] = useState<BrandSummary | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const router = useRouter()

  const akumPath = `users/${USER_ID}/data/yr_${year}_a`

  useEffect(() => {
    setLoading(true); setSelectedBrand(null)
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

    const uA = subscribeArr(akumPath, d => { setAkumulasi(d); aDone = true; check() })
    unsubs.push(uA)
    return () => { unsubs.forEach(fn => fn()) }
  }, [year])

  const allRows = buildRows(quotations, invoices, akumulasi, year)
  const brands = calcBrands(allRows)
  const filteredBrands = searchQuery.trim()
    ? brands.filter(brand => {
        const brandRows = allRows.filter(row => (row.brand || '(Tanpa Brand)') === brand.name)
        return normSearch(brand.name).includes(normSearch(searchQuery)) || brandRows.some(row => rowMatchesQuery(row, searchQuery))
      })
    : brands
  const totK = filteredBrands.reduce((a, b) => a + b.kontrak, 0)
  const totB = filteredBrands.reduce((a, b) => a + b.bayar, 0)
  const totS = totK - totB

  if (selectedBrand) return (
    <div className="p-4 md:p-6">
      <BrandDetail brand={selectedBrand} allRows={allRows} akumulasi={akumulasi}
        year={year} akumPath={akumPath} setAkumulasi={setAkumulasi} onBack={() => setSelectedBrand(null)} />
    </div>
  )

  return (
    <div className="p-4 md:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Status Brand <span className="text-gray-400 font-normal text-base">{year}</span></h1>
          <p className="text-sm text-gray-400 mt-0.5">Ringkasan pembayaran per brand</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <select value={year} onChange={e => setYear(+e.target.value)}
              className="appearance-none pl-3 pr-8 py-2 text-sm border border-gray-200 rounded-lg bg-white text-gray-700 outline-none focus:border-[#1B8A7A] cursor-pointer">
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          </div>
          <button onClick={() => router.push('/akumulasi')}
            className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 text-sm rounded-lg hover:bg-gray-50 text-gray-600">
            Akumulasi Lengkap <ExternalLink size={13} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 md:gap-4 mb-5">
        {[{ label: 'Total Brand', value: String(filteredBrands.length), color: '#2D5A2D' }, { label: 'Total Kontrak', value: `Rp ${fmt(totK)}`, color: '#185FA5' }, { label: 'Total Masuk', value: `Rp ${fmt(totB)}`, color: '#3B6D11' }, { label: 'Total Sisa', value: `Rp ${fmt(Math.abs(totS))}`, color: Math.abs(totS) < 1 ? '#3B6D11' : totS > 0 ? '#DC2626' : '#1D4ED8' }].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <div className="text-xs text-gray-400 mb-1">{s.label}</div>
            <div className="text-base font-bold" style={{ color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

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
            Menampilkan {filteredBrands.length} brand yang cocok dengan “{searchQuery.trim()}”.
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">{[...Array(6)].map((_, i) => <div key={i} className="h-12 bg-gray-50 rounded-lg animate-pulse" />)}</div>
        ) : filteredBrands.length === 0 ? (
          <div className="p-12 text-center"><div className="text-4xl mb-3">📊</div><p className="text-sm text-gray-400">Belum ada data di tahun {year}.</p></div>
        ) : (
          <>
            <div className="md:hidden divide-y divide-gray-100">
              {filteredBrands.map(br => {
                const st = ST[br.status]
                const nomVal = Math.round(Math.abs(br.sisa))
                const nomTxt = nomVal === 0 ? 'Rp 0' : (br.sisa > 0 ? '− ' : '+ ') + 'Rp ' + nomVal.toLocaleString('id-ID')
                return (
                  <button key={br.name} type="button" onClick={() => setSelectedBrand(br)} className="w-full text-left p-4 hover:bg-green-50 transition-colors">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-[#1B8A7A] underline underline-offset-2 truncate">{br.name}</div>
                        <div className="text-[11px] text-gray-400 mt-0.5">{br.projectCount} project</div>
                      </div>
                      <span className="inline-flex px-2.5 py-1 rounded-full text-[11px] font-bold shrink-0" style={{ backgroundColor: st.bg, color: st.color }}>{br.status}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-lg bg-gray-50 p-2"><div className="text-[10px] text-gray-400">Kontrak</div><div className="font-semibold text-gray-700">Rp {fmt(br.kontrak)}</div></div>
                      <div className="rounded-lg bg-gray-50 p-2"><div className="text-[10px] text-gray-400">Masuk</div><div className="font-semibold text-green-700">Rp {fmt(br.bayar)}</div></div>
                      <div className="col-span-2 rounded-lg bg-gray-50 p-2"><div className="text-[10px] text-gray-400">Sisa / Lebih</div><div className="font-bold" style={{ color: Math.abs(br.sisa) < 1 ? '#9CA3AF' : br.sisa > 0 ? '#B91C1C' : '#1D4ED8' }}>{nomTxt}</div></div>
                    </div>
                  </button>
                )
              })}
            </div>
            <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  {['BRAND','STATUS PEMBAYARAN','KONTRAK','MASUK','SISA / LEBIH'].map((h, i) => (
                    <th key={h} className={`text-[10px] font-semibold text-gray-400 px-5 py-3 ${i > 1 ? 'text-right' : i === 1 ? 'text-center' : 'text-left'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredBrands.map((br, i) => {
                  const st = ST[br.status]
                  const nomVal = Math.round(Math.abs(br.sisa))
                  const nomTxt = nomVal === 0 ? 'Rp 0' : (br.sisa > 0 ? '− ' : '+ ') + 'Rp ' + nomVal.toLocaleString('id-ID')
                  return (
                    <tr key={br.name} onClick={() => setSelectedBrand(br)}
                      className="border-b border-gray-50 hover:bg-green-50 cursor-pointer transition-colors"
                      style={{ backgroundColor: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: st.dot }} />
                          <span className="text-sm font-bold text-[#1B8A7A] underline underline-offset-2">{br.name}</span>
                          <span className="text-[10px] text-gray-400">{br.projectCount} project</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-center">
                        <span className="inline-flex px-3 py-1 rounded-full text-xs font-bold" style={{ backgroundColor: st.bg, color: st.color }}>{br.status}</span>
                      </td>
                      <td className="px-5 py-3.5 text-right text-sm text-gray-700">Rp {fmt(br.kontrak)}</td>
                      <td className="px-5 py-3.5 text-right text-sm text-green-700 font-medium">Rp {fmt(br.bayar)}</td>
                      <td className="px-5 py-3.5 text-right text-sm font-bold whitespace-nowrap" style={{ color: Math.abs(br.sisa) < 1 ? '#9CA3AF' : br.sisa > 0 ? '#B91C1C' : '#1D4ED8' }}>{nomTxt}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </div>
            <div className="px-5 py-2.5 text-[10px] text-gray-400 border-t border-gray-50">Klik nama brand untuk lihat detail & input pembayaran</div>
          </>
        )}
      </div>
    </div>
  )
}
