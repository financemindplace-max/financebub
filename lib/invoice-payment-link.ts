import { ref, get, set } from 'firebase/database'
import { db } from '@/lib/firebase'
import { fetchDocs, fetchGlobal, saveDocs } from '@/lib/rtdb'
import { fetchMonth, saveMonth, type FinanceTransaction } from '@/lib/finance'
import type { Doc } from '@/types/document'

const USER_ID = 'financebub-main'
const DEFAULT_YEARS = Array.from(
  { length: new Date().getFullYear() + 3 - 2020 + 1 },
  (_, index) => 2020 + index,
).sort((a, b) => b - a)

export interface InvoicePaymentLog {
  id: string
  txId: string
  date: string
  amount: number
  accountId?: string
  accountLabel?: string
  note?: string
  createdAt: string
  source: 'mutasi'
}

export interface InvoicePaymentMeta {
  invoiceId: number
  invoiceNo: string
  invoiceYear: number
  projectYear: number
  client: string
  brand: string
  item: string
  total: number
}

export interface PayableInvoice {
  year: number
  projectYear: number  // tahun project (dari field project-year), bisa beda dari year invoice
  doc: Doc
  invoiceNo: string
  client: string
  brand: string
  item: string
  sow: string
  total: number
  paid: number
  remaining: number
  status: string
  searchText: string
}

function parseStoredArray<T>(value: unknown): T[] {
  if (!value) return []
  try {
    const arr = typeof value === 'string' ? JSON.parse(value) : value
    return Array.isArray(arr) ? (arr.filter(Boolean) as T[]) : []
  } catch {
    return []
  }
}

function akumPath(year: number) {
  return `users/${USER_ID}/data/yr_${year}_a`
}

async function fetchAkumulasi(year: number): Promise<any[]> {
  try {
    const snap = await get(ref(db, akumPath(year)))
    if (!snap.exists()) return []
    return parseStoredArray<any>(snap.val())
  } catch {
    return []
  }
}

async function saveAkumulasi(year: number, rows: any[]) {
  await set(ref(db, akumPath(year)), JSON.stringify(rows))
  await set(ref(db, `users/${USER_ID}/data/_ts`), Date.now())
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const raw = String(value || '').trim()
  if (!raw) return 0
  let clean = raw.replace(/Rp/gi, '').replace(/\s/g, '')
  if (clean.includes(',') && clean.includes('.')) {
    clean = clean.lastIndexOf(',') > clean.lastIndexOf('.') ? clean.replace(/\./g, '').replace(',', '.') : clean.replace(/,/g, '')
  } else if (clean.includes(',')) {
    clean = clean.replace(/\./g, '').replace(',', '.')
  }
  return Number(clean.replace(/[^0-9.-]/g, '')) || 0
}

function dedupePaymentLogs(value: unknown): InvoicePaymentLog[] {
  const rawLogs = Array.isArray(value) ? value.filter(Boolean) : []
  const byTxId = new Map<string, InvoicePaymentLog>()

  rawLogs.forEach(rawLog => {
    const log = rawLog as Partial<InvoicePaymentLog>
    const txId = String(log.txId || log.id || '').trim()
    if (!txId) return
    byTxId.set(txId, {
      id: String(log.id || txId),
      txId,
      date: String(log.date || ''),
      amount: toNumber(log.amount),
      accountId: String(log.accountId || ''),
      accountLabel: String(log.accountLabel || ''),
      note: String(log.note || ''),
      createdAt: String(log.createdAt || ''),
      source: 'mutasi',
    })
  })

  return Array.from(byTxId.values())
}

export function getInvoiceTotal(doc: Doc): number {
  const sub = (doc.items || []).reduce((sum, item) => sum + toNumber(item.amount), 0)
  return sub - toNumber(doc.fields?.['q-disc']) + toNumber(doc.fields?.['q-gross'])
}

export function getInvoicePayments(doc: Doc): InvoicePaymentLog[] {
  const logs = (doc as Doc & { paymentLogs?: InvoicePaymentLog[] }).paymentLogs
  return dedupePaymentLogs(logs)
}

export function getInvoicePaymentSummary(doc: Doc) {
  const total = getInvoiceTotal(doc)
  const paid = getInvoicePayments(doc).reduce((sum, payment) => sum + toNumber(payment.amount), 0)
  const remaining = total - paid
  return { total, paid, remaining }
}

function inheritItems(items: Doc['items']) {
  let lastBrand = ''
  let lastItem = ''
  return (items || []).map(item => {
    const brand = String(item.brand || '').trim() || lastBrand
    const itemName = String(item.item || '').trim() || lastItem
    if (brand) lastBrand = brand
    if (itemName) lastItem = itemName
    return { ...item, brand, item: itemName }
  })
}

function firstItemInfo(doc: Doc) {
  const items = inheritItems(doc.items)
  const first = items.find(item => item.brand || item.item || item.sow) || items[0]
  return {
    brand: first?.brand || '',
    item: first?.item || '',
    sow: first?.sow || '',
  }
}

function normalizeYears(value: unknown): number[] {
  const now = new Date().getFullYear()
  const fromGlobal = Array.isArray(value) ? value.map(Number).filter(Boolean) : []
  return Array.from(new Set([...DEFAULT_YEARS, now - 1, now, now + 1, ...fromGlobal])).sort((a, b) => b - a)
}

export async function fetchPayableInvoicesAcrossYears(extraYears: number[] = []): Promise<PayableInvoice[]> {
  const global = await fetchGlobal()
  const years = Array.from(new Set([...normalizeYears((global as any)?.years), ...extraYears])).sort((a, b) => b - a)
  const docsByYear = await Promise.all(years.map(async year => ({ year, docs: await fetchDocs(year, 'i') })))
  const invoices: PayableInvoice[] = []

  docsByYear.forEach(({ year, docs }) => {
    docs.filter(doc => doc?.fields?.['i-no']).forEach(doc => {
      const invoiceNo = doc.fields?.['i-no'] || ''
      const client = doc.fields?.['cl-name'] || ''
      const itemInfo = firstItemInfo(doc)
      const { total, paid, remaining } = getInvoicePaymentSummary(doc)
      const status = String(doc.fields?.['i-status'] || '')
      const projectYear = Number((doc.fields as any)?.['project-year']) || year
      const searchText = [invoiceNo, client, itemInfo.brand, itemInfo.item, itemInfo.sow, year]
        .join(' ')
        .toLowerCase()
      invoices.push({
        year,
        projectYear,
        doc,
        invoiceNo,
        client,
        brand: itemInfo.brand,
        item: itemInfo.item,
        sow: itemInfo.sow,
        total,
        paid,
        remaining,
        status,
        searchText,
      })
    })
  })

  return invoices.sort((a, b) => (b.year - a.year) || b.invoiceNo.localeCompare(a.invoiceNo, 'id', { numeric: true }))
}

function nextInvoiceStatus(total: number, paid: number, fallback = 'Terbit') {
  if (paid <= 0) {
    const stalePaymentStatuses = new Set(['Lunas', 'Dibayar Sebagian', 'Lebih Bayar', 'Overpaid'])
    return stalePaymentStatuses.has(fallback) ? 'Terbit' : (fallback || 'Terbit')
  }
  if (paid > total + 0.5) return 'Lebih Bayar'
  if (Math.abs(total - paid) <= 0.5) return 'Lunas'
  return 'Dibayar Sebagian'
}


function inferDocumentStorageYear(documentNo: string): number | null {
  // Format nomor saat ini: INV-BUB-MMYY-NN / QTT-BUB-MMYY-NN.
  // Dua digit terakhir pada blok MMYY adalah tahun dokumen.
  const match = String(documentNo || '').match(/-(\d{2})(\d{2})-/)
  if (!match) return null
  const shortYear = Number(match[2])
  return Number.isFinite(shortYear) ? 2000 + shortYear : null
}

/**
 * Memperbarui status pembayaran dokumen walaupun tahun penyimpanan dokumen
 * berbeda dengan project-year/akumulasi. Contoh: invoice terbit 2026 tetapi
 * project-year 2025.
 */
export async function updateLinkedDocumentPaymentStatus(params: {
  docType: 'invoice' | 'quotation'
  docNo: string
  projectYear: number
  manualPaid?: number
}): Promise<boolean> {
  const kind = params.docType === 'invoice' ? 'i' : 'q'
  const numberField = params.docType === 'invoice' ? 'i-no' : 'q-no'
  const statusField = params.docType === 'invoice' ? 'i-status' : 'q-status'
  const inferredYear = inferDocumentStorageYear(params.docNo)
  const now = new Date().getFullYear()
  const candidates = Array.from(new Set([
    inferredYear,
    params.projectYear,
    now,
    params.projectYear + 1,
    params.projectYear - 1,
    now + 1,
    now - 1,
    ...DEFAULT_YEARS,
  ].filter((year): year is number => Boolean(year && year >= 2020 && year <= 2099))))

  for (const storageYear of candidates) {
    try {
      const docs = await fetchDocs(storageYear, kind)
      const index = docs.findIndex(doc => doc.fields?.[numberField] === params.docNo)
      if (index < 0) continue

      const document = docs[index]
      const total = params.docType === 'invoice'
        ? getInvoiceTotal(document)
        : getQuotationTotal(document)
      const linkedPaid = (params.docType === 'invoice'
        ? getInvoicePayments(document)
        : getQuotationPayments(document)
      ).reduce((sum, payment) => sum + toNumber(payment.amount), 0)
      const paid = linkedPaid + Math.max(0, toNumber(params.manualPaid))
      const currentStatus = String(document.fields?.[statusField] || 'Terbit')
      const fallback = paid <= 0
        ? (currentStatus === 'Draft' ? 'Draft' : 'Terbit')
        : currentStatus
      const nextStatus = nextInvoiceStatus(total, paid, fallback)
      const updatedDocs = docs.map((doc, docIndex) => docIndex === index
        ? { ...doc, fields: { ...doc.fields, [statusField]: nextStatus } }
        : doc)
      await saveDocs(storageYear, kind, updatedDocs as Doc[])
      return true
    } catch {
      // Coba kandidat tahun berikutnya.
    }
  }

  return false
}

type PaymentTargetType = 'invoice' | 'quotation'

function makePaymentRid(parentRid: string, txId: string, targetType: PaymentTargetType, targetNo: string) {
  const safeTarget = encodeURIComponent(String(targetNo || '').trim())
  return `pay-${parentRid}-mutasi-${targetType}-${safeTarget}-${txId}`
}

function rowTxId(
  row: any,
  targetType?: PaymentTargetType,
  targetNo?: string,
): string {
  if (row?.txId) return String(row.txId)
  const rid = String(row?.rid || '')

  if (targetType && targetNo) {
    const typedMarker = `-mutasi-${targetType}-${encodeURIComponent(targetNo)}-`
    const typedIndex = rid.indexOf(typedMarker)
    if (typedIndex >= 0) return rid.slice(typedIndex + typedMarker.length)
  }

  const marker = '-mutasi-'
  const index = rid.indexOf(marker)
  if (index < 0) return ''
  const suffix = rid.slice(index + marker.length)
  // Format baru tanpa field txId tidak dapat dipisahkan aman bila nomor dokumen
  // mengandung tanda "-". Jangan menebak karena bisa menghapus link lain.
  if (/^(invoice|quotation)-/.test(suffix)) return ''
  return suffix
}

function legacyPaymentMatches(row: any, payment?: InvoicePaymentLog): boolean {
  if (!payment) return false
  if (!Boolean(row?.fromMutasi || String(row?.rid || '').includes('-mutasi-'))) return false
  const sameDate = !row?.tgl || !payment.date || String(row.tgl) === String(payment.date)
  const sameAmount = Math.abs(toNumber(row?.nom) - toNumber(payment.amount)) <= 0.5
  const rowNote = String(row?.ket || '').trim()
  const paymentNote = String(payment.note || '').trim()
  const sameNote = !rowNote || !paymentNote || rowNote === paymentNote
  return sameDate && sameAmount && sameNote
}

function isStoredPaymentForTarget(
  row: any,
  txId: string,
  targetType: PaymentTargetType,
  targetNo: string,
  payment?: InvoicePaymentLog,
): boolean {
  const matchesDoc = row?.targetDocType || row?.targetDocNo
    ? row.targetDocType === targetType && String(row.targetDocNo || '') === targetNo
    : targetType === 'invoice'
      ? String(row?.noInv || '') === targetNo
      : String(row?.noQuo || '') === targetNo
  if (!matchesDoc) return false

  const storedTxId = rowTxId(row, targetType, targetNo)
  if (storedTxId) return storedTxId === txId
  return legacyPaymentMatches(row, payment)
}

async function findParentRidForInvoice(year: number, invoice: Doc) {
  const invoiceNo = invoice.fields?.['i-no'] || ''
  const quotationNo = invoice.fields?.['i-ref'] || ''
  const invoiceItems = inheritItems(invoice.items)
  const invoiceProjectYear = Number((invoice.fields as any)?.['project-year']) || year

  if (quotationNo) {
    // Tahun penyimpanan dokumen dan tahun project dapat berbeda.
    // Prioritaskan project-year agar baris pembayaran masuk ke Akumulasi tahun project.
    const yearsToSearch = Array.from(new Set([
      invoiceProjectYear,
      year,
      invoiceProjectYear - 1,
      year - 1,
      invoiceProjectYear - 2,
      year - 2,
      invoiceProjectYear - 3,
      year - 3,
      invoiceProjectYear - 4,
      year - 4,
    ])).filter(y => y >= 2020)

    for (const searchYear of yearsToSearch) {
      const quotations = await fetchDocs(searchYear, 'q')
      const quotation = quotations.find(q => q.fields?.['q-no'] === quotationNo)
      if (quotation) {
        const quotationProjectYear = Number((quotation.fields as any)?.['project-year']) || searchYear
        const inheritedItems = inheritItems(quotation.items)
        const first = inheritedItems.find(item => item.brand || item.item || item.sow) || inheritedItems[0]
        const brand = first?.brand || ''
        const item = first?.item || ''
        return {
          parentRid: `${quotationProjectYear}_${quotationNo}_${brand}_${item}`,
          brand,
          item,
          sow: first?.sow || '',
          noQuo: quotationNo,
          noInv: invoiceNo,
          client: quotation.fields?.['cl-name'] || invoice.fields?.['cl-name'] || '',
          akumulasiYear: quotationProjectYear,
        }
      }
    }
  }

  const first = invoiceItems.find(item => item.brand || item.item || item.sow) || invoiceItems[0]
  const brand = first?.brand || ''
  const item = first?.item || ''
  return {
    parentRid: `${invoiceProjectYear}_inv_${invoiceNo}_${brand}_${item}`,
    brand,
    item,
    sow: first?.sow || '',
    noQuo: '',
    noInv: invoiceNo,
    client: invoice.fields?.['cl-name'] || '',
    akumulasiYear: invoiceProjectYear,
  }
}

async function upsertAkumulasiPayment(year: number, invoice: Doc, payment: InvoicePaymentLog) {
  const target = await findParentRidForInvoice(year, invoice)
  if (!target.parentRid) return
  const akumulasiYear = target.akumulasiYear ?? year
  const rid = makePaymentRid(target.parentRid, payment.txId, 'invoice', target.noInv)
  const nextRow = {
    rid,
    yr: akumulasiYear,
    brand: target.brand,
    client: target.client,
    item: '',
    sow: '',
    noQuo: target.noQuo,
    noInv: target.noInv,
    totalAmt: 0,
    statusInv: '',
    due: '',
    tgl: payment.date || '',
    ket: payment.note || `Pembayaran ${target.noInv}`,
    nom: String(Math.round(toNumber(payment.amount))),
    rek: payment.accountLabel || '',
    isExtra: true,
    parentRid: target.parentRid,
    fromMutasi: true,
    txId: payment.txId,
    targetDocType: 'invoice',
    targetDocNo: target.noInv,
    targetDocYear: year,
    targetProjectYear: akumulasiYear,
  }
  // Migrasikan sekaligus baris lama yang pernah tersimpan di tahun dokumen.
  const candidateYears = Array.from(new Set([akumulasiYear, year]))
  for (const candidateYear of candidateYears) {
    const rows = await fetchAkumulasi(candidateYear)
    const cleaned = rows.filter(row =>
      !isStoredPaymentForTarget(row, payment.txId, 'invoice', target.noInv, payment)
    )
    if (candidateYear === akumulasiYear) {
      await saveAkumulasi(candidateYear, [...cleaned, nextRow])
    } else if (cleaned.length !== rows.length) {
      await saveAkumulasi(candidateYear, cleaned)
    }
  }
}

async function removeAkumulasiPayment(year: number, invoice: Doc, txId: string, payment?: InvoicePaymentLog) {
  const target = await findParentRidForInvoice(year, invoice)
  if (!target.parentRid) return
  const akumulasiYear = target.akumulasiYear ?? year
  const candidateYears = Array.from(new Set([akumulasiYear, year]))
  for (const candidateYear of candidateYears) {
    const rows = await fetchAkumulasi(candidateYear)
    const cleaned = rows.filter(row =>
      !isStoredPaymentForTarget(row, txId, 'invoice', target.noInv, payment)
    )
    if (cleaned.length !== rows.length) await saveAkumulasi(candidateYear, cleaned)
  }
}

export async function upsertInvoicePayment(params: {
  invoiceYear: number
  invoiceId: number
  txId: string
  date: string
  amount: number
  accountId?: string
  accountLabel?: string
  note?: string
}) {
  const docs = await fetchDocs(params.invoiceYear, 'i')
  const idx = docs.findIndex(doc => doc.id === params.invoiceId)
  if (idx < 0) throw new Error('Invoice tidak ditemukan. Coba refresh halaman lalu pilih invoice ulang.')

  const doc = docs[idx]
  const currentLogs = getInvoicePayments(doc)
  const payment: InvoicePaymentLog = {
    id: params.txId,
    txId: params.txId,
    date: params.date,
    amount: toNumber(params.amount),
    accountId: params.accountId || '',
    accountLabel: params.accountLabel || '',
    note: params.note || '',
    createdAt: currentLogs.find(log => log.txId === params.txId)?.createdAt || new Date().toISOString(),
    source: 'mutasi',
  }
  const paymentLogs = currentLogs.some(log => log.txId === params.txId)
    ? currentLogs.map(log => log.txId === params.txId ? payment : log)
    : [...currentLogs, payment]
  const paid = paymentLogs.reduce((sum, log) => sum + toNumber(log.amount), 0)
  const total = getInvoiceTotal(doc)
  const updatedDoc = {
    ...(doc as Doc & { paymentLogs?: InvoicePaymentLog[] }),
    paymentLogs,
    savedAt: new Date().toISOString(),
    fields: {
      ...doc.fields,
      'i-status': nextInvoiceStatus(total, paid, doc.fields?.['i-status'] || 'Terbit') as any,
    },
  }
  const updatedDocs = docs.map((item, i) => i === idx ? updatedDoc : item)
  await saveDocs(params.invoiceYear, 'i', updatedDocs as Doc[])
  await upsertAkumulasiPayment(params.invoiceYear, updatedDoc as Doc, payment)
  return updatedDoc as Doc
}

export async function removeInvoicePayment(params: {
  invoiceYear: number
  invoiceId: number
  txId: string
}) {
  const docs = await fetchDocs(params.invoiceYear, 'i')
  const idx = docs.findIndex(doc => doc.id === params.invoiceId)
  if (idx < 0) return
  const doc = docs[idx]
  const currentPayments = getInvoicePayments(doc)
  const removedPayment = currentPayments.find(log => log.txId === params.txId)
  const paymentLogs = currentPayments.filter(log => log.txId !== params.txId)
  const paid = paymentLogs.reduce((sum, log) => sum + toNumber(log.amount), 0)
  const total = getInvoiceTotal(doc)
  const updatedDoc = {
    ...(doc as Doc & { paymentLogs?: InvoicePaymentLog[] }),
    paymentLogs,
    savedAt: new Date().toISOString(),
    fields: {
      ...doc.fields,
      'i-status': nextInvoiceStatus(total, paid, 'Terbit') as any,
    },
  }
  await saveDocs(params.invoiceYear, 'i', docs.map((item, i) => i === idx ? updatedDoc : item) as Doc[])
  await removeAkumulasiPayment(params.invoiceYear, updatedDoc as Doc, params.txId, removedPayment)
}

export function buildInvoicePaymentMeta(invoice: PayableInvoice): InvoicePaymentMeta {
  return {
    invoiceId: invoice.doc.id,
    invoiceNo: invoice.invoiceNo,
    invoiceYear: invoice.year,
    projectYear: invoice.projectYear,
    client: invoice.client,
    brand: invoice.brand,
    item: invoice.item,
    total: invoice.total,
  }
}

// ─── QUOTATION PAYMENT ────────────────────────────────────────────────────────

export interface QuotationPaymentMeta {
  quotationId: number
  quotationNo: string
  quotationYear: number
  projectYear: number
  client: string
  brand: string
  item: string
  total: number
}

export interface PayableQuotation {
  year: number
  projectYear: number
  doc: Doc
  quotationNo: string
  client: string
  brand: string
  item: string
  sow: string
  total: number
  paid: number
  remaining: number
  status: string
  searchText: string
}

export type SearchableDoc =
  | (PayableInvoice & { docType: 'invoice'; docNo: string })
  | (PayableQuotation & { docType: 'quotation'; docNo: string })

export function getQuotationTotal(doc: Doc): number {
  const sub = (doc.items || []).reduce((sum, item) => sum + toNumber(item.amount), 0)
  return sub - toNumber(doc.fields?.['q-disc']) + toNumber(doc.fields?.['q-gross'])
}

export function getQuotationPayments(doc: Doc): InvoicePaymentLog[] {
  const logs = (doc as Doc & { paymentLogs?: InvoicePaymentLog[] }).paymentLogs
  return dedupePaymentLogs(logs)
}

export function getQuotationPaymentSummary(doc: Doc) {
  const total = getQuotationTotal(doc)
  const paid = getQuotationPayments(doc).reduce((sum, p) => sum + toNumber(p.amount), 0)
  return { total, paid, remaining: total - paid }
}

export async function fetchPayableQuotationsAcrossYears(extraYears: number[] = []): Promise<PayableQuotation[]> {
  const global = await fetchGlobal()
  const years = Array.from(new Set([...normalizeYears((global as any)?.years), ...extraYears])).sort((a, b) => b - a)
  const docsByYear = await Promise.all(years.map(async year => ({ year, docs: await fetchDocs(year, 'q') })))
  const quotations: PayableQuotation[] = []
  docsByYear.forEach(({ year, docs }) => {
    docs.filter(doc => doc?.fields?.['q-no']).forEach(doc => {
      const quotationNo = doc.fields?.['q-no'] || ''
      const client = doc.fields?.['cl-name'] || ''
      const itemInfo = firstItemInfo(doc)
      const { total, paid, remaining } = getQuotationPaymentSummary(doc)
      const status = String(doc.fields?.['q-status'] || 'Draft')
      const projectYear = Number((doc.fields as any)?.['project-year']) || year
      const searchText = [quotationNo, client, itemInfo.brand, itemInfo.item, itemInfo.sow, year, projectYear].join(' ').toLowerCase()
      quotations.push({ year, projectYear, doc, quotationNo, client, brand: itemInfo.brand, item: itemInfo.item, sow: itemInfo.sow, total, paid, remaining, status, searchText })
    })
  })
  return quotations.sort((a, b) => (b.year - a.year) || b.quotationNo.localeCompare(a.quotationNo, 'id', { numeric: true }))
}

export async function fetchPayableDocsAcrossYears(extraYears: number[] = []): Promise<SearchableDoc[]> {
  const [invoices, quotations] = await Promise.all([
    fetchPayableInvoicesAcrossYears(extraYears),
    fetchPayableQuotationsAcrossYears(extraYears),
  ])
  const invDocs: SearchableDoc[] = invoices.map(inv => ({ ...inv, docType: 'invoice' as const, docNo: inv.invoiceNo }))
  const quoDocs: SearchableDoc[] = quotations.map(q => ({ ...q, docType: 'quotation' as const, docNo: q.quotationNo }))
  return [...invDocs, ...quoDocs].sort((a, b) => (b.year - a.year) || b.docNo.localeCompare(a.docNo, 'id', { numeric: true }))
}

async function findParentRidForQuotation(year: number, quotation: Doc) {
  const quotationNo = quotation.fields?.['q-no'] || ''
  const projectYear = Number((quotation.fields as any)?.['project-year']) || year
  const items = inheritItems(quotation.items)
  const first = items.find(item => item.brand || item.item || item.sow) || items[0]
  const brand = first?.brand || ''
  const item = first?.item || ''
  return {
    parentRid: `${projectYear}_${quotationNo}_${brand}_${item}`,
    brand, item, sow: first?.sow || '',
    noQuo: quotationNo, noInv: '',
    client: quotation.fields?.['cl-name'] || '',
    akumulasiYear: projectYear,
  }
}

async function upsertAkumulasiForQuotation(year: number, quotation: Doc, payment: InvoicePaymentLog) {
  const target = await findParentRidForQuotation(year, quotation)
  if (!target.parentRid) return
  const akumulasiYear = target.akumulasiYear ?? year
  const rid = makePaymentRid(target.parentRid, payment.txId, 'quotation', target.noQuo)
  const nextRow = {
    rid, yr: akumulasiYear, brand: target.brand, client: target.client,
    item: '', sow: '', noQuo: target.noQuo, noInv: '',
    totalAmt: 0, statusInv: '', due: '',
    tgl: payment.date || '',
    ket: payment.note || `Pembayaran ${target.noQuo}`,
    nom: String(Math.round(toNumber(payment.amount))),
    rek: payment.accountLabel || '',
    isExtra: true, parentRid: target.parentRid, fromMutasi: true,
    txId: payment.txId,
    targetDocType: 'quotation',
    targetDocNo: target.noQuo,
    targetDocYear: year,
    targetProjectYear: akumulasiYear,
  }
  const candidateYears = Array.from(new Set([akumulasiYear, year]))
  for (const candidateYear of candidateYears) {
    const rows = await fetchAkumulasi(candidateYear)
    const cleaned = rows.filter((row: any) =>
      !isStoredPaymentForTarget(row, payment.txId, 'quotation', target.noQuo, payment)
    )
    if (candidateYear === akumulasiYear) {
      await saveAkumulasi(candidateYear, [...cleaned, nextRow])
    } else if (cleaned.length !== rows.length) {
      await saveAkumulasi(candidateYear, cleaned)
    }
  }
}

async function removeAkumulasiForQuotation(year: number, quotation: Doc, txId: string, payment?: InvoicePaymentLog) {
  const target = await findParentRidForQuotation(year, quotation)
  if (!target.parentRid) return
  const akumulasiYear = target.akumulasiYear ?? year
  const candidateYears = Array.from(new Set([akumulasiYear, year]))
  for (const candidateYear of candidateYears) {
    const rows = await fetchAkumulasi(candidateYear)
    const cleaned = rows.filter((row: any) =>
      !isStoredPaymentForTarget(row, txId, 'quotation', target.noQuo, payment)
    )
    if (cleaned.length !== rows.length) await saveAkumulasi(candidateYear, cleaned)
  }
}

export async function upsertQuotationPayment(params: {
  quotationYear: number
  quotationId: number
  txId: string
  date: string
  amount: number
  accountId?: string
  accountLabel?: string
  note?: string
}) {
  const docs = await fetchDocs(params.quotationYear, 'q')
  const idx = docs.findIndex(doc => doc.id === params.quotationId)
  if (idx < 0) throw new Error('Quotation tidak ditemukan. Coba refresh lalu pilih ulang.')
  const doc = docs[idx]
  const currentLogs = getQuotationPayments(doc)
  const payment: InvoicePaymentLog = {
    id: params.txId, txId: params.txId, date: params.date,
    amount: toNumber(params.amount),
    accountId: params.accountId || '', accountLabel: params.accountLabel || '',
    note: params.note || '',
    createdAt: currentLogs.find(l => l.txId === params.txId)?.createdAt || new Date().toISOString(),
    source: 'mutasi',
  }
  const paymentLogs = currentLogs.some(l => l.txId === params.txId)
    ? currentLogs.map(l => l.txId === params.txId ? payment : l)
    : [...currentLogs, payment]
  const paid = paymentLogs.reduce((sum, l) => sum + toNumber(l.amount), 0)
  const total = getQuotationTotal(doc)
  const updatedDoc = {
    ...(doc as Doc & { paymentLogs?: InvoicePaymentLog[] }),
    paymentLogs, savedAt: new Date().toISOString(),
    fields: { ...doc.fields, 'q-status': nextInvoiceStatus(total, paid, doc.fields?.['q-status'] || 'Terbit') as any },
  }
  await saveDocs(params.quotationYear, 'q', docs.map((item, i) => i === idx ? updatedDoc : item) as Doc[])
  await upsertAkumulasiForQuotation(params.quotationYear, updatedDoc as Doc, payment)
  return updatedDoc as Doc
}

export async function removeQuotationPayment(params: {
  quotationYear: number
  quotationId: number
  txId: string
}) {
  const docs = await fetchDocs(params.quotationYear, 'q')
  const idx = docs.findIndex(doc => doc.id === params.quotationId)
  if (idx < 0) return
  const doc = docs[idx]
  const currentPayments = getQuotationPayments(doc)
  const removedPayment = currentPayments.find(log => log.txId === params.txId)
  const paymentLogs = currentPayments.filter(log => log.txId !== params.txId)
  const paid = paymentLogs.reduce((sum, l) => sum + toNumber(l.amount), 0)
  const total = getQuotationTotal(doc)
  const updatedDoc = {
    ...(doc as Doc & { paymentLogs?: InvoicePaymentLog[] }),
    paymentLogs, savedAt: new Date().toISOString(),
    fields: { ...doc.fields, 'q-status': nextInvoiceStatus(total, paid, 'Terbit') as any },
  }
  await saveDocs(params.quotationYear, 'q', docs.map((item, i) => i === idx ? updatedDoc : item) as Doc[])
  await removeAkumulasiForQuotation(params.quotationYear, updatedDoc as Doc, params.txId, removedPayment)
}

export function buildQuotationPaymentMeta(quotation: PayableQuotation): QuotationPaymentMeta {
  return {
    quotationId: quotation.doc.id,
    quotationNo: quotation.quotationNo,
    quotationYear: quotation.year,
    projectYear: quotation.projectYear,
    client: quotation.client,
    brand: quotation.brand,
    item: quotation.item,
    total: quotation.total,
  }
}


export interface UnlinkMutasiPaymentTargetParams {
  txId: string
  targetDocType: 'invoice' | 'quotation'
  targetDocNo: string
  targetDocYear?: number
  targetProjectYear?: number
  paymentDate?: string
}

type StoredPaymentLink = {
  docType: 'invoice' | 'quotation'
  docNo: string
  docId?: number
  docYear?: number
  amount?: number
}

type StoredLinkedTransaction = FinanceTransaction & {
  invoicePayment?: InvoicePaymentMeta
  quotationPayment?: QuotationPaymentMeta
  paymentLinks?: StoredPaymentLink[]
}

function targetMatchesStoredLink(
  link: StoredPaymentLink,
  targetDocType: 'invoice' | 'quotation',
  targetDocNo: string,
) {
  return link.docType === targetDocType && String(link.docNo || '').trim() === targetDocNo
}

async function findStoredDocument(params: UnlinkMutasiPaymentTargetParams) {
  const kind = params.targetDocType === 'invoice' ? 'i' : 'q'
  const numberField = params.targetDocType === 'invoice' ? 'i-no' : 'q-no'
  const inferredYear = inferDocumentStorageYear(params.targetDocNo)
  const now = new Date().getFullYear()
  const candidates = Array.from(new Set([
    params.targetDocYear,
    inferredYear,
    params.targetProjectYear,
    now,
    now - 1,
    now + 1,
    ...DEFAULT_YEARS,
  ].filter((year): year is number => Boolean(year && year >= 2020 && year <= 2099))))

  for (const year of candidates) {
    const docs = await fetchDocs(year, kind)
    const doc = docs.find(item => String(item.fields?.[numberField] || '').trim() === params.targetDocNo)
    if (doc) return { year, doc }
  }
  return null
}

function removeTargetFromStoredTransaction(
  tx: StoredLinkedTransaction,
  targetDocType: 'invoice' | 'quotation',
  targetDocNo: string,
): { tx: StoredLinkedTransaction; changed: boolean } {
  const next: StoredLinkedTransaction = { ...tx }
  let changed = false

  if (Array.isArray(next.paymentLinks)) {
    const remainingLinks = next.paymentLinks.filter(link =>
      !targetMatchesStoredLink(link, targetDocType, targetDocNo)
    )
    if (remainingLinks.length !== next.paymentLinks.length) {
      changed = true
      if (remainingLinks.length > 0) next.paymentLinks = remainingLinks
      else delete next.paymentLinks
    }
  }

  if (
    targetDocType === 'invoice'
    && next.invoicePayment
    && String(next.invoicePayment.invoiceNo || '').trim() === targetDocNo
  ) {
    delete next.invoicePayment
    changed = true
  }

  if (
    targetDocType === 'quotation'
    && next.quotationPayment
    && String(next.quotationPayment.quotationNo || '').trim() === targetDocNo
  ) {
    delete next.quotationPayment
    changed = true
  }

  return { tx: next, changed }
}

async function unlinkTargetFromStoredMutasi(params: UnlinkMutasiPaymentTargetParams): Promise<boolean> {
  const preferredDate = /^\d{4}-\d{2}-\d{2}$/.test(String(params.paymentDate || ''))
    ? String(params.paymentDate)
    : ''
  const preferredYear = preferredDate ? Number(preferredDate.slice(0, 4)) : 0
  const preferredMonth = preferredDate ? Number(preferredDate.slice(5, 7)) : 0
  const global = await fetchGlobal()
  const years = Array.from(new Set([
    preferredYear,
    params.targetProjectYear,
    params.targetDocYear,
    ...normalizeYears((global as any)?.years),
  ].filter((year): year is number => Boolean(year && year >= 2020 && year <= 2099))))

  const scopes: Array<{ year: number; month: number }> = []
  if (preferredYear && preferredMonth) scopes.push({ year: preferredYear, month: preferredMonth })
  years.forEach(year => {
    for (let month = 1; month <= 12; month += 1) {
      if (year === preferredYear && month === preferredMonth) continue
      scopes.push({ year, month })
    }
  })

  for (const scope of scopes) {
    const monthData = await fetchMonth(scope.year, scope.month)
    const index = monthData.transactions.findIndex(item => item.id === params.txId)
    if (index < 0) continue

    const result = removeTargetFromStoredTransaction(
      monthData.transactions[index] as StoredLinkedTransaction,
      params.targetDocType,
      params.targetDocNo,
    )
    if (!result.changed) return false

    const transactions = [...monthData.transactions]
    transactions[index] = result.tx
    await saveMonth({ ...monthData, transactions })
    return true
  }

  return false
}

/**
 * Melepas satu target QTT/INV dari sebuah pembayaran Mutasi.
 * Transaksi bank tetap ada. Hanya link target, payment log, baris Akumulasi,
 * dan status dokumen target yang dihitung ulang.
 */
export async function unlinkMutasiPaymentTarget(params: UnlinkMutasiPaymentTargetParams) {
  const targetDocNo = String(params.targetDocNo || '').trim()
  const txId = String(params.txId || '').trim()
  if (!targetDocNo || !txId) throw new Error('Data link pembayaran tidak lengkap.')

  const storedDocument = await findStoredDocument({ ...params, targetDocNo, txId })
  if (!storedDocument) throw new Error(`${targetDocNo} tidak ditemukan.`)

  if (params.targetDocType === 'invoice') {
    await removeInvoicePayment({
      invoiceYear: storedDocument.year,
      invoiceId: storedDocument.doc.id,
      txId,
    })
  } else {
    await removeQuotationPayment({
      quotationYear: storedDocument.year,
      quotationId: storedDocument.doc.id,
      txId,
    })
  }

  const transactionUpdated = await unlinkTargetFromStoredMutasi({
    ...params,
    targetDocNo,
    txId,
    targetDocYear: storedDocument.year,
  })

  return { transactionUpdated }
}
