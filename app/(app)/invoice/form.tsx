'use client'

import { useState, useEffect } from 'react'
import { ArrowLeft, Plus, Trash2, Save, Eye, FileText, Search, X, ChevronRight, Download } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { fmt, fmtDate } from '@/lib/utils'
import { fetchGlobal, saveGlobal, subscribeDocs, fetchDocs } from '@/lib/rtdb'
import type { Doc, DocItem, DocFields, DocStatus } from '@/types/document'
import { useAuth } from '@/lib/auth-context'
import {
  accountFields,
  companyFields,
  getAccountById,
  getCompanyById,
  getDefaultCompanyId,
  normalizeCompanies,
  normalizeSignatory,
  type CompanyProfile,
} from '@/lib/company-profile'
import { downloadLegacyDocumentPdf, prepareLegacyDocumentData } from '@/lib/legacy-document-pdf'
import { buildNextNumberUpdates, formatDocumentNumber, getDocumentNumberConfig, isAutoDocumentNumber, parseDocumentNumber } from '@/lib/document-numbering'

const THEME_COLORS = ['#1B8A7A','#185FA5','#7C3AED','#B45309','#DC2626','#0F766E','#374151']
const TERMS = ['Net 7 Days','Net 14 Days','Net 30 Days','Net 45 Days','Net 60 Days','Due on Receipt']
const STATUSES: DocStatus[] = ['Draft','Terbit','Belum Lunas','Lunas','Overdue']

const DEFAULT_FIELDS: DocFields = {
  'c-name': 'PT FinanceBub',
  'c-addr': 'Jl. Tebet Raya No.25B, Jakarta Selatan 12820',
  'c-phone': '0815-5555-566',
  'c-email': 'admin@financebub.com',
  'c-web': 'www.financebub.com',
  'c-tax': '1000.0000.0642.4843',
  'p-bank': 'Bank Central Asia (BCA)',
  'p-branch': 'BCA KCP Tebet Barat',
  'p-accname': 'PT FinanceBub',
  'p-accno': '6270636363',
  's-name': 'Cristi Roderto Roditua S',
  's-title': 'Direktur PT FinanceBub',
  's-tagline': "We Can't Wait For Our Next Collaboration!",
  'q-disc': '0',
  'q-gross': '0',
  'i-term': 'Net 14 Days',
  'i-status': 'Draft',
  'i-notes': '',
}

interface Props {
  doc: Doc | null
  year: number
  onSave: (doc: Doc) => Promise<void>
  onBack: () => void
  onPreview?: (doc: Doc) => void
  onCreateNew?: () => void
}


function defaultDateForActiveYear(year: number) {
  const now = new Date()
  const cleanYear = Number.isFinite(Number(year)) ? Math.trunc(Number(year)) : now.getFullYear()
  const month = now.getMonth()
  const maxDay = new Date(cleanYear, month + 1, 0).getDate()
  const day = Math.min(now.getDate(), maxDay)
  const mm = String(month + 1).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${cleanYear}-${mm}-${dd}`
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function calcDueDate(date: string, term: string): string {
  const match = term.match(/(\d+)/)
  if (!match) return date
  return addDays(date, parseInt(match[1]))
}

// ── Modal Pilih Quotation ─────────────────────────────────────────────────────
function QuotationPickerModal({
  year,
  onPick,
  onClose,
}: {
  year: number
  onPick: (doc: Doc, docYear: number) => void
  onClose: () => void
}) {
  const [quotationsByYear, setQuotationsByYear] = useState<{ year: number; docs: Doc[] }[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Load tahun invoice + 2 tahun sebelumnya agar bisa cross-year linking
    const years = Array.from(new Set([year, year - 1, year - 2, year - 3, year - 4])).filter(y => y >= 2020).sort((a, b) => b - a)
    let alive = true
    setLoading(true)

    Promise.all(
      years.map(y =>
        new Promise<{ year: number; docs: Doc[] }>(resolve => {
          const unsub = subscribeDocs(y, 'q', (data) => {
            resolve({ year: y, docs: data.filter(d => d?.fields?.['q-no']) })
            unsub()
          })
        })
      )
    ).then(results => {
      if (alive) {
        setQuotationsByYear(results.filter(r => r.docs.length > 0))
        setLoading(false)
      }
    })

    return () => { alive = false }
  }, [year])

  const allQuotations = quotationsByYear.flatMap(({ year: y, docs }) =>
    docs.map(doc => ({ doc, year: y }))
  )

  const filtered = allQuotations.filter(({ doc }) => {
    const s = search.toLowerCase()
    return !s ||
      (doc.fields['q-no'] || '').toLowerCase().includes(s) ||
      (doc.fields['cl-name'] || '').toLowerCase().includes(s) ||
      doc.items?.some(i => i.brand?.toLowerCase().includes(s))
  })

  // Sort: exact/startsWith match dulu, lalu tahun terbaru
  filtered.sort((a, b) => {
    if (search) {
      const q = search.toLowerCase()
      const aNo = (a.doc.fields['q-no'] || '').toLowerCase()
      const bNo = (b.doc.fields['q-no'] || '').toLowerCase()
      const aScore = aNo === q ? 0 : aNo.startsWith(q) ? 1 : 2
      const bScore = bNo === q ? 0 : bNo.startsWith(q) ? 1 : 2
      if (aScore !== bScore) return aScore - bScore
    }
    if (b.year !== a.year) return b.year - a.year
    return (b.doc.fields['q-no'] || '').localeCompare(a.doc.fields['q-no'] || '', 'id', { numeric: true })
  })

  const getTotal = (q: Doc) => {
    const sub = q.items?.reduce((a, i) => a + (+i.amount || 0), 0) || 0
    return sub - +(q.fields['q-disc'] || 0) + +(q.fields['q-gross'] || 0)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Pilih Quotation</h2>
            <p className="text-xs text-gray-400 mt-0.5">Data klien & item akan terisi otomatis · Lintas tahun didukung</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b border-gray-100">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Cari nomor quotation, klien, brand..."
              autoFocus
              className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#185FA5]"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="space-y-2 p-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-14 bg-gray-50 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <FileText className="w-10 h-10 mb-2 opacity-30" />
              <p className="text-sm">{search ? 'Tidak ada hasil' : 'Belum ada quotation'}</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {filtered.map(({ doc: q, year: qYear }) => (
                <button
                  key={`${qYear}-${q.id}`}
                  onClick={() => onPick(q, qYear)}
                  className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-blue-50 transition-colors text-left group"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0"
                      style={{ background: q.theme || '#1B8A7A' }}
                    >
                      QT
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-gray-900">{q.fields['q-no']}</div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {q.fields['cl-name']} · {fmtDate(q.fields['q-date'] || '')}
                      </div>
                      {q.items?.length > 0 && (() => {
                        const brands = [...new Set(q.items.map(i => i.brand).filter(Boolean))]
                        const itemNames = [...new Set(q.items.map(i => i.item).filter(Boolean))]
                        return (
                          <div className="mt-1 space-y-1">
                            {brands.length > 0 && (
                              <div className="flex gap-1 flex-wrap">
                                {brands.slice(0, 3).map(b => (
                                  <span key={b} className="px-1.5 py-0.5 bg-gray-100 text-gray-600 text-[10px] rounded font-medium">{b}</span>
                                ))}
                              </div>
                            )}
                            {itemNames.length > 0 && (
                              <div className="text-[11px] text-gray-400 truncate">
                                {itemNames.slice(0, 3).join(' · ')}{itemNames.length > 3 ? ` +${itemNames.length - 3}` : ''}
                              </div>
                            )}
                          </div>
                        )
                      })()}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {qYear !== year && (
                      <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-bold rounded">
                        {qYear}
                      </span>
                    )}
                    <span className="text-sm font-semibold" style={{ color: q.theme || '#1B8A7A' }}>
                      Rp {fmt(getTotal(q))}
                    </span>
                    <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-[#185FA5]" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main Form ─────────────────────────────────────────────────────────────────
export default function InvoiceForm({ doc, year, onSave, onBack, onPreview, onCreateNew }: Props) {
  const { user } = useAuth()
  const isEdit = !!doc
  const today = defaultDateForActiveYear(year)
  const searchParams = useSearchParams()
  const fromQuo = searchParams?.get('from') === 'quo'

  // Ambil data dari quotation jika ada (via sessionStorage dari halaman Quotation)
  const quoData: Doc | null = (() => {
    if (typeof window === 'undefined') return null
    try {
      const raw = sessionStorage.getItem('invoice_from_quo')
      if (raw) return JSON.parse(raw)
    } catch {}
    return null
  })()

  const [fields, setFields] = useState<DocFields>(() => {
    if (!isEdit && fromQuo && quoData) {
      return {
        ...DEFAULT_FIELDS,
        ...quoData.fields,
        'i-no': formatDocumentNumber('invoice', {}, today),
        'i-date': today,
        'i-due': addDays(today, 14),
        'i-term': 'Net 14 Days',
        'i-status': 'Draft',
        'i-ref': quoData.fields['q-no'] || '',
      }
    }
    return {
      ...DEFAULT_FIELDS,
      'i-date': today,
      'i-due': addDays(today, 14),
      ...doc?.fields,
    }
  })

  const [items, setItems] = useState<DocItem[]>(() => {
    if (!isEdit && fromQuo && quoData?.items?.length) return quoData.items
    return doc?.items?.length ? doc.items : [{ brand: '', item: '', sow: '', amount: 0 }]
  })
  const [currentDocId] = useState(doc?.id || Date.now())
  const [theme, setTheme] = useState(() => {
    if (!isEdit && fromQuo && quoData) return quoData.theme || '#185FA5'
    return doc?.theme || '#185FA5'
  })
  const [showSub, setShowSub] = useState(doc?.showSub !== false)
  const [showDisc, setShowDisc] = useState(() => {
    if (!isEdit && fromQuo && quoData) return ((quoData as unknown as { showDisc?: boolean }).showDisc ?? true)
    return ((doc as unknown as { showDisc?: boolean } | null)?.showDisc ?? true)
  })
  const [logoData, setLogoData] = useState<string | null>(() => (!isEdit && fromQuo && quoData ? (quoData.logoData || null) : (doc?.logoData || null)))
  const [sigData, setSigData] = useState<string | null>(() => (!isEdit && fromQuo && quoData ? (quoData.sigData || null) : (doc?.sigData || null)))
  const [sigNW, setSigNW] = useState(() => (!isEdit && fromQuo && quoData ? (quoData.sigNW || 0) : (doc?.sigNW || 0)))
  const [sigNH, setSigNH] = useState(() => (!isEdit && fromQuo && quoData ? (quoData.sigNH || 0) : (doc?.sigNH || 0)))
  const [saving, setSaving] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [isSavedClean, setIsSavedClean] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [showRefPicker, setShowRefPicker] = useState(false)
  const [companies, setCompanies] = useState<CompanyProfile[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = useState(doc?.fields?.companyProfileId || quoData?.fields?.companyProfileId || '')
  const [selectedAccountId, setSelectedAccountId] = useState(doc?.fields?.paymentAccountId || quoData?.fields?.paymentAccountId || '')
  const [globalConfig, setGlobalConfig] = useState<Record<string, unknown>>({})
  const [autoNo, setAutoNo] = useState('')
  // Track apakah sudah diisi dari quotation (baik via sessionStorage maupun picker)
  const [importedFrom, setImportedFrom] = useState<string | null>(
    fromQuo && quoData ? (quoData.fields['q-no'] || null) : null
  )
  const [projectYear, setProjectYear] = useState<string>(
    doc?.fields?.['project-year'] ||
    (fromQuo && quoData ? (quoData.fields?.['project-year'] || String(year)) : String(year))
  )

  // ── Autocomplete: Klien & Brand ──────────────────────────────────────────
  interface ClientInfo { name: string; pic: string; addr: string; phone: string }
  const [pastClients, setPastClients] = useState<ClientInfo[]>([])
  const [brandHistory, setBrandHistory] = useState<string[]>([])
  const [clientQ, setClientQ] = useState(doc?.fields?.['cl-name'] || quoData?.fields?.['cl-name'] || '')
  const [showClientList, setShowClientList] = useState(false)

  useEffect(() => {
    const PAST_YEARS = Array.from({ length: new Date().getFullYear() + 1 - 2020 + 1 }, (_, i) => 2020 + i)
    Promise.all([
      ...PAST_YEARS.map(y => fetchDocs(y, 'q')),
      ...PAST_YEARS.map(y => fetchDocs(y, 'i')),
    ]).then(results => {
      const allDocs = results.flat()
      const clientMap = new Map<string, ClientInfo>()
      allDocs.forEach(d => {
        const name = (d.fields?.['cl-name'] || '').trim()
        if (name && !clientMap.has(name.toLowerCase())) {
          clientMap.set(name.toLowerCase(), {
            name,
            pic: d.fields?.['cl-pic'] || '',
            addr: d.fields?.['cl-addr'] || '',
            phone: d.fields?.['cl-phone'] || '',
          })
        }
      })
      setPastClients(Array.from(clientMap.values()).sort((a, b) => a.name.localeCompare(b.name, 'id')))
      const brandSet = new Set<string>()
      allDocs.forEach(d => { d.items?.forEach(item => { if (item.brand?.trim()) brandSet.add(item.brand.trim()) }) })
      setBrandHistory(Array.from(brandSet).sort((a, b) => a.localeCompare(b, 'id')))
    }).catch(() => {})
  }, [])

  // Clear sessionStorage setelah form dibuka
  useEffect(() => {
    if (fromQuo) sessionStorage.removeItem('invoice_from_quo')
  }, [fromQuo])

  useEffect(() => {
    if (!isEdit) {
      const activeYearDate = defaultDateForActiveYear(year)
      const no = formatDocumentNumber('invoice', globalConfig, activeYearDate)
      setAutoNo(no)
      setFields(f => {
        const currentNo = f['i-no'] || ''
        const shouldUpdateNo = !currentNo || currentNo === autoNo || isAutoDocumentNumber(currentNo, globalConfig, 'invoice')
        const term = f['i-term'] || 'Net 14 Days'
        return {
          ...f,
          'i-date': activeYearDate,
          'i-due': calcDueDate(activeYearDate, term),
          ...(shouldUpdateNo ? { 'i-no': no } : {}),
        }
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, isEdit])

  useEffect(() => {
    fetchGlobal().then(global => {
      setGlobalConfig(global as Record<string, unknown>)
      const loadedCompanies = normalizeCompanies(global as Record<string, any>)
      const signatory = normalizeSignatory(global as Record<string, any>)
      const defaultCompanyId = getDefaultCompanyId(global as Record<string, any>, loadedCompanies)
      const initialCompanyId = doc?.fields?.companyProfileId || quoData?.fields?.companyProfileId || defaultCompanyId
      const initialCompany = getCompanyById(loadedCompanies, initialCompanyId)
      const initialAccount = getAccountById(initialCompany, doc?.fields?.paymentAccountId || quoData?.fields?.paymentAccountId || initialCompany.activeAccountId)

      setCompanies(loadedCompanies)
      setSelectedCompanyId(initialCompany.id)
      setSelectedAccountId(initialAccount.id)

      if (!logoData) setLogoData(quoData?.logoData || initialCompany.logoData || String(global.logoData || '') || null)
      if (!sigData) setSigData(quoData?.sigData || signatory.directorSignatureData || String(global.sigData || '') || null)
      setSigNW(Number(quoData?.sigNW || global.sigNW || 0))
      setSigNH(Number(quoData?.sigNH || global.sigNH || 0))

      if (!isEdit && fromQuo && quoData) {
        const nextNo = formatDocumentNumber('invoice', global as Record<string, unknown>, fields['i-date'] || today)
        setAutoNo(nextNo)
        setFields(f => ({ ...f, 'i-no': f['i-no'] && !isAutoDocumentNumber(f['i-no'], global as Record<string, unknown>, 'invoice') ? f['i-no'] : nextNo }))
      }

      if (!isEdit && !(fromQuo && quoData)) {
        const nextNo = formatDocumentNumber('invoice', global as Record<string, unknown>, fields['i-date'] || today)
        setAutoNo(nextNo)
        const defaultTerm = String(global['default-term'] || 'Net 14 Days')
        setFields(f => ({
          ...f,
          'i-no': f['i-no'] && !isAutoDocumentNumber(f['i-no'], global as Record<string, unknown>, 'invoice') ? f['i-no'] : nextNo,
          ...companyFields(initialCompany, initialAccount),
          's-name': signatory.directorName || f['s-name'],
          's-title': signatory.directorTitle || f['s-title'],
          's-tagline': signatory.tagline || f['s-tagline'],
          'i-term': defaultTerm,
          'i-due': calcDueDate(f['i-date'] || today, defaultTerm),
          'i-notes': String(global['i-notes'] || f['i-notes'] || ''),
        }))
        if (global['default-theme']) setTheme(String(global['default-theme']))
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, year])

  const markDirty = () => setIsSavedClean(false)

  const setField = (key: keyof DocFields, value: string) => {
    markDirty()
    setFields(f => {
      const updated: DocFields = { ...f, [key]: value }
      if (key === 'i-date' || key === 'i-term') {
        const date = key === 'i-date' ? value : (f['i-date'] || today)
        const term = key === 'i-term' ? value : (f['i-term'] || 'Net 14 Days')
        updated['i-due'] = calcDueDate(date, term)
      }
      if (!isEdit && key === 'i-date') {
        const nextNo = formatDocumentNumber('invoice', globalConfig, value || today)
        const currentNo = f['i-no'] || ''
        const shouldUpdateNo = !currentNo || currentNo === autoNo || isAutoDocumentNumber(currentNo, globalConfig, 'invoice')
        setAutoNo(nextNo)
        if (shouldUpdateNo) updated['i-no'] = nextNo
      }
      return updated
    })
  }

  const selectedCompany = getCompanyById(companies, selectedCompanyId)
  const selectedAccount = getAccountById(selectedCompany, selectedAccountId)

  const applyCompanySelection = (companyId: string) => {
    markDirty()
    const company = getCompanyById(companies, companyId)
    const account = getAccountById(company, company.activeAccountId)
    setSelectedCompanyId(company.id)
    setSelectedAccountId(account.id)
    setLogoData(company.logoData || null)
    setFields(f => ({ ...f, ...companyFields(company, account) }))
  }

  const applyAccountSelection = (accountId: string) => {
    markDirty()
    const account = getAccountById(selectedCompany, accountId)
    setSelectedAccountId(account.id)
    setFields(f => ({ ...f, ...accountFields(account) }))
  }

  const setItem = (idx: number, key: keyof DocItem, value: string | number) => {
    markDirty()
    setItems(items => items.map((it, i) => i === idx ? { ...it, [key]: value } : it))
  }

  const addItem = () => { markDirty(); setItems(items => [...items, { brand: '', item: '', sow: '', amount: 0 }]) }
  const removeItem = (idx: number) => { markDirty(); setItems(items => items.filter((_, i) => i !== idx)) }

  // ── Pilih dari Quotation ────────────────────────────────────────────────────
  const handlePickQuotation = (q: Doc, _docYear?: number) => {
    markDirty()
    const nextNo = formatDocumentNumber('invoice', globalConfig, today)
    setAutoNo(nextNo)
    setFields(f => ({
      ...f,
      ...q.fields,
      // Jaga field invoice tetap fresh
      'i-no': f['i-no'] || nextNo,
      'i-date': today,
      'i-due': addDays(today, 14),
      'i-term': f['i-term'] || 'Net 14 Days',
      'i-status': f['i-status'] || 'Draft',
      'i-ref': q.fields['q-no'] || '',
    }))
    setItems(q.items?.length ? q.items : [{ brand: '', item: '', sow: '', amount: 0 }])
    setTheme(q.theme || '#185FA5')
    setLogoData(q.logoData || logoData)
    setSigData(q.sigData || sigData)
    setSigNW(q.sigNW || sigNW)
    setSigNH(q.sigNH || sigNH)
    if (q.fields.companyProfileId) setSelectedCompanyId(q.fields.companyProfileId)
    if (q.fields.paymentAccountId) setSelectedAccountId(q.fields.paymentAccountId)
    if ((q.fields as any)['project-year']) setProjectYear((q.fields as any)['project-year'])
    setImportedFrom(q.fields['q-no'] || 'Quotation')
    setShowPicker(false)
  }

  const subtotal = items.reduce((a, i) => a + (+i.amount || 0), 0)
  const disc = +(fields['q-disc'] || 0)
  const gross = +(fields['q-gross'] || 0)
  const total = subtotal - disc + gross

  const buildDoc = (): Doc => {
    const now = new Date().toISOString()
    const me = user ? { uid: user.uid, name: user.name, at: now } : undefined
    const existingAudit = doc?.audit || {}
    return {
      id: currentDocId,
      savedAt: now,
      theme,
      logoData,
      sigData,
      sigNW,
      sigNH,
      showSub,
      showDisc,
      fields: { ...fields, 'project-year': projectYear },
      items,
      sendLogs: doc?.sendLogs,
      audit: {
        ...existingAudit,
        createdBy: existingAudit.createdBy ?? me,
        updatedBy: me,
      },
    }
  }

  const handleSave = async () => {
    if (!fields['i-no']?.trim()) { alert('No. Invoice wajib diisi'); return }
    if (!fields['cl-name']?.trim()) { alert('Nama klien wajib diisi'); return }
    const draft = buildDoc()
    const shouldAdvanceCounter = !isEdit && Boolean(draft.fields['i-no']) && draft.fields['i-no'] === autoNo
    setSaving(true)
    try {
      await onSave(draft)
      if (shouldAdvanceCounter) {
        const parsed = parseDocumentNumber(draft.fields['i-no'])
        const cfg = getDocumentNumberConfig(globalConfig, 'invoice')
        const next = Math.max(cfg.next, (parsed?.sequence || 0) + 1)
        const updates = buildNextNumberUpdates('invoice', next)
        await saveGlobal(updates)
        setGlobalConfig(current => ({ ...current, ...updates }))
      }
      setIsSavedClean(true)
    } finally { setSaving(false) }
  }

  const handleDownloadPdf = async () => {
    const draft = buildDoc()
    setDownloading(true)
    try {
      await downloadLegacyDocumentPdf(prepareLegacyDocumentData(draft, 'invoice', {}))
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Gagal download PDF invoice')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <>
      {/* Modal Picker — isi semua field dari quotation */}
      {showPicker && (
        <QuotationPickerModal
          year={year}
          onPick={handlePickQuotation}
          onClose={() => setShowPicker(false)}
        />
      )}

      {/* Modal Picker — hanya isi Ref. Quotation */}
      {showRefPicker && (
        <QuotationPickerModal
          year={year}
          onPick={(q, _docYear) => { markDirty(); setField('i-ref', q.fields['q-no'] || ''); setShowRefPicker(false) }}
          onClose={() => setShowRefPicker(false)}
        />
      )}

      <div className="flex flex-col h-screen overflow-hidden">
        {/* Topbar */}
        <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900">
              <ArrowLeft className="w-4 h-4" />
              Kembali
            </button>
            <span className="text-gray-300">|</span>
            <h1 className="text-sm font-semibold text-gray-900">
              {isEdit ? `Invoice — ${doc.fields['i-no']}` : 'Invoice Baru'}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {onPreview && (
              <button onClick={() => onPreview(buildDoc())} className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">
                <Eye className="w-3.5 h-3.5" />
                Preview
              </button>
            )}
            <button onClick={handleDownloadPdf} disabled={downloading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-60">
              <Download className="w-3.5 h-3.5" />
              {downloading ? 'Membuat PDF...' : 'Download'}
            </button>
            <button onClick={handleSave} disabled={saving || isSavedClean} className="flex items-center gap-1.5 px-4 py-1.5 bg-[#185FA5] hover:bg-[#0F4A85] text-white text-sm font-semibold rounded-lg disabled:opacity-40 disabled:cursor-not-allowed">
              <Save className="w-3.5 h-3.5" />
              {saving ? 'Menyimpan...' : isSavedClean ? 'Tersimpan' : 'Simpan'}
            </button>
            {isSavedClean && onCreateNew && (
              <button onClick={onCreateNew}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-[#185FA5]/30 text-[#185FA5] rounded-lg hover:bg-blue-50">
                <Plus className="w-3.5 h-3.5" />
                Buat Invoice Baru
              </button>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">

          {/* ── Banner: Sudah diimpor dari Quotation ── */}
          {importedFrom ? (
            <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center text-white text-xs flex-shrink-0">✓</div>
                <div>
                  <div className="text-sm font-semibold text-green-800">Diimpor dari Quotation</div>
                  <div className="text-xs text-green-600">Ref: {importedFrom} — Data klien & item sudah terisi otomatis</div>
                </div>
              </div>
              <button
                onClick={() => setShowPicker(true)}
                className="text-xs text-green-700 hover:text-green-900 font-medium underline underline-offset-2 flex-shrink-0 ml-4"
              >
                Ganti Quotation
              </button>
            </div>
          ) : !isEdit ? (
            /* ── Banner: Belum ada, ajak pilih ── */
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-[#185FA5] flex items-center justify-center text-white text-xs flex-shrink-0">
                  <FileText className="w-3 h-3" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-blue-900">Ada Quotation sebelumnya?</div>
                  <div className="text-xs text-blue-600">Klik untuk isi otomatis + Ref terisi.</div>
                </div>
              </div>
              <button
                onClick={() => setShowPicker(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#185FA5] hover:bg-[#0F4A85] text-white text-xs font-semibold rounded-lg transition-colors flex-shrink-0 ml-4"
              >
                <FileText className="w-3 h-3" />
                Pilih Quotation
              </button>
            </div>
          ) : null}

          {/* Tema */}
          <Card title="Tema">
            <div className="flex items-center gap-3 flex-wrap">
              {THEME_COLORS.map(c => (
                <button key={c} onClick={() => { markDirty(); setTheme(c) }} className="w-7 h-7 rounded-full transition-all" style={{ background: c, outline: theme === c ? `3px solid ${c}` : 'none', outlineOffset: '2px' }} />
              ))}
              <input type="color" value={theme} onChange={e => { markDirty(); setTheme(e.target.value) }} className="w-8 h-7 rounded cursor-pointer border border-gray-200 p-0.5" />
            </div>
          </Card>

          {/* Info Invoice */}
          <Card title="Info Invoice">
            <div className="grid grid-cols-2 gap-3">
              <Field label="No. Invoice" required>
                <input value={fields['i-no'] || ''} onChange={e => setField('i-no', e.target.value)} className={input} />
              </Field>
              <Field label="Tanggal Invoice">
                <input type="date" value={fields['i-date'] || today} onChange={e => setField('i-date', e.target.value)} className={input} />
              </Field>
              <Field label="Term of Payment">
                <select value={fields['i-term'] || 'Net 14 Days'} onChange={e => setField('i-term', e.target.value)} className={input}>
                  {TERMS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Due Date">
                <input type="date" value={fields['i-due'] || ''} onChange={e => setField('i-due', e.target.value)} className={input} />
              </Field>
              <Field label="Ref. Quotation">
                <div className="flex gap-2">
                  <input value={fields['i-ref'] || ''} onChange={e => setField('i-ref', e.target.value)} placeholder="QTT-BUB-..." className={input} />
                  <button type="button" onClick={() => setShowRefPicker(true)} className="flex-shrink-0 px-3 py-2 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 whitespace-nowrap">Pilih</button>
                </div>
              </Field>
              <Field label="Status">
                <select value={fields['i-status'] || 'Draft'} onChange={e => setField('i-status', e.target.value)} className={input}>
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Mata Uang">
              <select value={fields['q-cur'] || 'IDR'} onChange={e => setField('q-cur', e.target.value)} className={input}>
                <option value="IDR">IDR – Rupiah</option>
                <option value="USD">USD – US Dollar</option>
                <option value="SGD">SGD – Singapore Dollar</option>
                <option value="EUR">EUR – Euro</option>
                <option value="OTHER">Lainnya (custom)</option>
              </select>
              {fields['q-cur'] === 'OTHER' && (
                <input value={fields['cur-custom'] || ''} onChange={e => setField('cur-custom', e.target.value)}
                  placeholder="Contoh: JPY, GBP, dll"
                  className={`${input} mt-2`} />
              )}
            </Field>
            <Field label="Tahun Project" required>
              <select
                value={projectYear}
                onChange={e => { markDirty(); setProjectYear(e.target.value) }}
                className={input}
              >
                {Array.from({ length: 10 }, (_, i) => new Date().getFullYear() + 2 - i).map(y => (
                  <option key={y} value={String(y)}>{y}</option>
                ))}
              </select>
              {projectYear && projectYear !== String(year) && (
                <p className="mt-1 text-[11px] text-amber-600 font-medium">
                  ⚠ Dokumen terbit tahun {year}, tapi project masuk ke Akumulasi &amp; Status Brand tahun {projectYear}
                </p>
              )}
            </Field>
          </Card>

          {/* Perusahaan */}
          <Card title="Perusahaan">
            {companies.length > 0 && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Pilih Perusahaan">
                  <select value={selectedCompanyId} onChange={e => applyCompanySelection(e.target.value)} className={input}>
                    {companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}
                  </select>
                </Field>
                <Field label="Status Default">
                  <div className="px-3 py-2 text-sm rounded-lg border border-gray-100 bg-gray-50 text-gray-500">
                    Bisa diganti manual untuk invoice ini
                  </div>
                </Field>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nama Perusahaan">
                <input value={fields['c-name'] || ''} onChange={e => setField('c-name', e.target.value)} className={input} />
              </Field>
              <Field label="Telepon">
                <input value={fields['c-phone'] || ''} onChange={e => setField('c-phone', e.target.value)} className={input} />
              </Field>
            </div>
            <Field label="Alamat">
              <textarea value={fields['c-addr'] || ''} onChange={e => setField('c-addr', e.target.value)} rows={2} className={input} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Email">
                <input value={fields['c-email'] || ''} onChange={e => setField('c-email', e.target.value)} className={input} />
              </Field>
              <Field label="Website">
                <input value={fields['c-web'] || ''} onChange={e => setField('c-web', e.target.value)} className={input} />
              </Field>
            </div>
            <Field label="Tax ID / NPWP">
              <input value={fields['c-tax'] || ''} onChange={e => setField('c-tax', e.target.value)} className={input} />
            </Field>
          </Card>

          {/* Klien */}
          <Card title="Klien">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nama Klien" required>
                <div className="relative">
                  <input
                    value={clientQ}
                    onChange={e => {
                      setClientQ(e.target.value)
                      setField('cl-name', e.target.value)
                      setShowClientList(true)
                    }}
                    onFocus={() => setShowClientList(true)}
                    onBlur={() => setTimeout(() => setShowClientList(false), 150)}
                    placeholder="Ketik nama klien..."
                    className={input}
                    autoComplete="off"
                  />
                  {showClientList && clientQ && pastClients.filter(c => c.name.toLowerCase().includes(clientQ.toLowerCase())).length > 0 && (
                    <div className="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden max-h-52 overflow-y-auto">
                      {pastClients
                        .filter(c => c.name.toLowerCase().includes(clientQ.toLowerCase()))
                        .map(c => (
                          <button
                            key={c.name}
                            type="button"
                            onMouseDown={() => {
                              setClientQ(c.name)
                              setShowClientList(false)
                              setFields(f => ({
                                ...f,
                                'cl-name': c.name,
                                'cl-pic': c.pic || f['cl-pic'] || '',
                                'cl-addr': c.addr || f['cl-addr'] || '',
                                'cl-phone': c.phone || f['cl-phone'] || '',
                              }))
                            }}
                            className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-gray-50 last:border-0"
                          >
                            <div className="text-xs font-semibold text-gray-900">{c.name}</div>
                            {c.pic && <div className="text-[10px] text-gray-400 mt-0.5">{c.pic}</div>}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              </Field>
              <Field label="Attn / PIC">
                <input value={fields['cl-pic'] || ''} onChange={e => setField('cl-pic', e.target.value)} className={input} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Alamat">
                <textarea value={fields['cl-addr'] || ''} onChange={e => setField('cl-addr', e.target.value)} rows={2} className={input} />
              </Field>
              <Field label="Telepon">
                <input value={fields['cl-phone'] || ''} onChange={e => setField('cl-phone', e.target.value)} className={input} />
              </Field>
            </div>
          </Card>

          {/* Item Layanan */}
          <Card title="Item Layanan">
            <div className="grid gap-2 mb-2 px-1" style={{ gridTemplateColumns: '15% 20% 1fr 18% 28px' }}>
              {['Brand','Item','SOW','Amount',''].map(h => (
                <span key={h} className="text-[10px] font-semibold text-gray-400">{h}</span>
              ))}
            </div>
            <div className="space-y-2">
              {items.map((item, idx) => (
                <div key={idx} className="grid gap-2 items-start" style={{ gridTemplateColumns: '15% 20% 1fr 18% 28px' }}>
                  <input value={item.brand} onChange={e => setItem(idx, 'brand', e.target.value)} placeholder="Brand" list="invoice-brand-list" className={inputSm} />
                  <input value={item.item} onChange={e => setItem(idx, 'item', e.target.value)} placeholder="Nama item" className={inputSm} />
                  <textarea value={item.sow} onChange={e => setItem(idx, 'sow', e.target.value)} placeholder="Scope of work..." rows={2} className={inputSm} />
                  <input type="number" value={item.amount || ''} onChange={e => setItem(idx, 'amount', +e.target.value)} placeholder="0" className={inputSm + ' text-right'} />
                  <button onClick={() => removeItem(idx)} disabled={items.length === 1} className="w-7 h-7 flex items-center justify-center bg-red-50 text-red-400 hover:text-red-600 rounded-lg disabled:opacity-30 mt-0.5">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <button onClick={addItem} className="mt-3 w-full py-2 text-sm text-[#185FA5] border border-dashed border-[#185FA5]/30 rounded-lg hover:bg-blue-50 transition-colors flex items-center justify-center gap-1">
              <Plus className="w-3.5 h-3.5" />
              Tambah Item
            </button>
            <datalist id="invoice-brand-list">
              {brandHistory.map(b => <option key={b} value={b} />)}
            </datalist>
            <div className="mt-4 pt-4 border-t border-gray-100 space-y-2">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                  <input type="checkbox" checked={showSub} onChange={e => { markDirty(); setShowSub(e.target.checked) }} className="accent-[#185FA5]" />
                  Tampilkan Sub Total & Gross Up
                </label>
                {showSub && (
                  <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                    <input type="checkbox" checked={showDisc} onChange={e => { markDirty(); setShowDisc(e.target.checked) }} className="accent-[#185FA5]" />
                    Tampilkan Diskon
                  </label>
                )}
              </div>
              {showSub && (
                <>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">Sub Total</span>
                    <span className="font-medium">Rp {fmt(subtotal)}</span>
                  </div>
                  {showDisc && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500">Diskon</span>
                      <input type="number" value={fields['q-disc'] || '0'} onChange={e => setField('q-disc', e.target.value)} className="w-32 text-right px-2 py-1 border border-gray-200 rounded text-sm text-red-500" />
                    </div>
                  )}
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">Gross Up</span>
                    <input type="number" value={fields['q-gross'] || '0'} onChange={e => setField('q-gross', e.target.value)} className="w-32 text-right px-2 py-1 border border-gray-200 rounded text-sm" />
                  </div>
                </>
              )}
              <div className="flex items-center justify-between text-sm font-semibold pt-2 border-t border-gray-100">
                <span>Total Amount Due</span>
                <span style={{ color: theme }}>Rp {fmt(total)}</span>
              </div>
            </div>
          </Card>

          {/* Pembayaran */}
          <Card title="Pembayaran">
            {selectedCompany?.accounts?.length > 0 && (
              <Field label="Pilih Rekening Pembayaran">
                <select value={selectedAccountId} onChange={e => applyAccountSelection(e.target.value)} className={input}>
                  {selectedCompany.accounts.map(account => (
                    <option key={account.id} value={account.id}>
                      {(account.label || account.bank || 'Rekening')} — {account.bank || '-'} {account.accNo ? `(${account.accNo})` : ''}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Bank Name"><input value={fields['p-bank'] || ''} onChange={e => setField('p-bank', e.target.value)} className={input} /></Field>
              <Field label="Bank Address"><input value={fields['p-branch'] || ''} onChange={e => setField('p-branch', e.target.value)} className={input} /></Field>
              <Field label="Account Name"><input value={fields['p-accname'] || ''} onChange={e => setField('p-accname', e.target.value)} className={input} /></Field>
              <Field label="Account Numbers"><input value={fields['p-accno'] || ''} onChange={e => setField('p-accno', e.target.value)} className={input} /></Field>
            </div>
          </Card>

          {/* TTD */}
          <Card title="TTD & Penutup">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nama"><input value={fields['s-name'] || ''} onChange={e => setField('s-name', e.target.value)} className={input} /></Field>
              <Field label="Jabatan"><input value={fields['s-title'] || ''} onChange={e => setField('s-title', e.target.value)} className={input} /></Field>
            </div>
            <Field label="Tagline"><input value={fields['s-tagline'] || ''} onChange={e => setField('s-tagline', e.target.value)} className={input} /></Field>
            <Field label="Catatan"><textarea value={fields['i-notes'] || ''} onChange={e => setField('i-notes', e.target.value)} rows={2} className={input} /></Field>
          </Card>

          <div className="pb-6">
            <button onClick={handleSave} disabled={saving || isSavedClean} className="w-full py-2.5 bg-[#185FA5] hover:bg-[#0F4A85] text-white text-sm font-semibold rounded-lg disabled:opacity-40 disabled:cursor-not-allowed">
              {saving ? 'Menyimpan...' : isSavedClean ? 'Invoice Tersimpan' : 'Simpan Invoice'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">{title}</div>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

const input = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#185FA5] focus:ring-1 focus:ring-[#185FA5]/10 transition-all resize-none'
const inputSm = 'w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-[#185FA5] transition-all resize-none'
