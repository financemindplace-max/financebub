'use client'

import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, Plus, Trash2, Save, Eye, Download } from 'lucide-react'
import { fmt } from '@/lib/utils'
import { useAuth } from '@/lib/auth-context'
import { fetchGlobal, saveGlobal, fetchDocs } from '@/lib/rtdb'
import type { Doc, DocItem, DocFields } from '@/types/document'
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
  'q-notes': '',
  'q-status': 'Draft',
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

export default function QuotationForm({ doc, year, onSave, onBack, onPreview, onCreateNew }: Props) {
  const { user } = useAuth()
  const isEdit = !!doc
  const today = defaultDateForActiveYear(year)

  const [fields, setFields] = useState<DocFields>(() => ({
    ...DEFAULT_FIELDS,
    'q-date': today,
    ...doc?.fields,
  }))
  const [items, setItems] = useState<DocItem[]>(() =>
    doc?.items?.length ? doc.items : [{ brand: '', item: '', sow: '', amount: 0 }]
  )
  const [currentDocId] = useState(doc?.id || Date.now())
  const [theme, setTheme] = useState(doc?.theme || '#1B8A7A')
  const [showSub, setShowSub] = useState(doc?.showSub !== false)
  const [showGross, setShowGross] = useState(() => (doc as any)?.showGross !== false)
  const [showDisc, setShowDisc] = useState(() => ((doc as unknown as { showDisc?: boolean } | null)?.showDisc ?? true))
  const [showExtra1, setShowExtra1] = useState(() => Boolean((doc as any)?.showExtra1))
  const [showExtra2, setShowExtra2] = useState(() => Boolean((doc as any)?.showExtra2))
  const [logoData, setLogoData] = useState<string | null>(doc?.logoData || null)
  const [sigData, setSigData] = useState<string | null>(doc?.sigData || null)
  const [sigNW, setSigNW] = useState(doc?.sigNW || 0)
  const [sigNH, setSigNH] = useState(doc?.sigNH || 0)
  const [saving, setSaving] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [isSavedClean, setIsSavedClean] = useState(false)
  const prevYearRef = useRef(year)
  const [autoNo, setAutoNo] = useState('')
  const [companies, setCompanies] = useState<CompanyProfile[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = useState(doc?.fields?.companyProfileId || '')
  const [selectedAccountId, setSelectedAccountId] = useState(doc?.fields?.paymentAccountId || '')
  const [globalConfig, setGlobalConfig] = useState<Record<string, unknown>>({})
  const [projectYear, setProjectYear] = useState<string>(
    doc?.fields?.['project-year'] || String(year)
  )
  // ── Autocomplete: Klien & Brand ──────────────────────────────────────────
  interface ClientInfo { name: string; pic: string; addr: string; phone: string }
  const [pastClients, setPastClients] = useState<ClientInfo[]>([])
  const [brandHistory, setBrandHistory] = useState<string[]>([])
  const [clientQ, setClientQ] = useState(doc?.fields?.['cl-name'] || '')
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

  // Generate auto nomor awal dengan format QTT-BUB-MMYY-NN.
  useEffect(() => {
    // Hanya reset isSavedClean jika tahun benar-benar berganti (bukan setiap re-render)
    if (prevYearRef.current !== year) {
      prevYearRef.current = year
      setIsSavedClean(false)
    }
    if (!isEdit) {
      const activeYearDate = defaultDateForActiveYear(year)
      const no = formatDocumentNumber('quotation', globalConfig, activeYearDate)
      setAutoNo(no)
      setFields(f => {
        const currentNo = f['q-no'] || ''
        const shouldUpdateNo = !currentNo || currentNo === autoNo || isAutoDocumentNumber(currentNo, globalConfig, 'quotation')
        return {
          ...f,
          'q-date': activeYearDate,
          ...(shouldUpdateNo ? { 'q-no': no } : {}),
        }
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, isEdit])

  // Load company profiles dari Firebase.
  // Default memakai perusahaan aktif, tapi user tetap bisa pilih manual di form.
  useEffect(() => {
    fetchGlobal().then(global => {
      setGlobalConfig(global as Record<string, unknown>)
      const loadedCompanies = normalizeCompanies(global as Record<string, any>)
      const signatory = normalizeSignatory(global as Record<string, any>)
      const defaultCompanyId = getDefaultCompanyId(global as Record<string, any>, loadedCompanies)
      const initialCompanyId = doc?.fields?.companyProfileId || defaultCompanyId
      const initialCompany = getCompanyById(loadedCompanies, initialCompanyId)
      const initialAccount = getAccountById(initialCompany, doc?.fields?.paymentAccountId || initialCompany.activeAccountId)

      setCompanies(loadedCompanies)
      setSelectedCompanyId(initialCompany.id)
      setSelectedAccountId(initialAccount.id)

      if (!logoData) setLogoData(initialCompany.logoData || String(global.logoData || '') || null)
      if (!sigData) setSigData(signatory.directorSignatureData || String(global.sigData || '') || null)
      setSigNW(Number(global.sigNW || 0))
      setSigNH(Number(global.sigNH || 0))

      if (!isEdit) {
        const nextNo = formatDocumentNumber('quotation', global as Record<string, unknown>, fields['q-date'] || today)
        setAutoNo(nextNo)
        setFields(f => ({
          ...f,
          'q-no': f['q-no'] && !isAutoDocumentNumber(f['q-no'], global as Record<string, unknown>, 'quotation') ? f['q-no'] : nextNo,
          ...companyFields(initialCompany, initialAccount),
          's-name': signatory.directorName || f['s-name'],
          's-title': signatory.directorTitle || f['s-title'],
          's-tagline': signatory.tagline || f['s-tagline'],
          'q-notes': String(global['q-notes'] || f['q-notes'] || ''),
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
      const nextFields: DocFields = { ...f, [key]: value }
      if (!isEdit && key === 'q-date') {
        const nextNo = formatDocumentNumber('quotation', globalConfig, value || today)
        const currentNo = f['q-no'] || ''
        const shouldUpdateNo = !currentNo || currentNo === autoNo || isAutoDocumentNumber(currentNo, globalConfig, 'quotation')
        setAutoNo(nextNo)
        if (shouldUpdateNo) nextFields['q-no'] = nextNo
      }
      return nextFields
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

  const subtotal = items.reduce((a, i) => a + (+i.amount || 0), 0)
  const disc = +(fields['q-disc'] || 0)
  const gross = +(fields['q-gross'] || 0)
  const extra1 = showExtra1 ? +(fields['q-extra1'] || 0) : 0
  const extra2 = showExtra2 ? +(fields['q-extra2'] || 0) : 0
  const total = subtotal - disc + (showGross ? gross : 0) + extra1 - extra2

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
      showGross,
      showDisc,
      showExtra1,
      showExtra2,
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
    if (!fields['q-no']?.trim()) { alert('No. Quotation wajib diisi'); return }
    if (!fields['cl-name']?.trim()) { alert('Nama klien wajib diisi'); return }
    const draft = buildDoc()
    const shouldAdvanceCounter = !isEdit && Boolean(draft.fields['q-no']) && draft.fields['q-no'] === autoNo
    setSaving(true)
    try {
      await onSave(draft)
      // Dokumen sudah berhasil tersimpan. Tandai form sebagai bersih lebih dulu
      // agar tombol "Buat Quotation Baru" tetap muncul meskipun update nomor urut gagal.
      setIsSavedClean(true)

      if (shouldAdvanceCounter) {
        try {
          const parsed = parseDocumentNumber(draft.fields['q-no'])
          const cfg = getDocumentNumberConfig(globalConfig, 'quotation')
          const next = Math.max(cfg.next, (parsed?.sequence || 0) + 1)
          const updates = buildNextNumberUpdates('quotation', next)
          await saveGlobal(updates)
          setGlobalConfig(current => ({ ...current, ...updates }))
        } catch (counterError) {
          console.error('Quotation tersimpan, tetapi nomor urut berikutnya gagal diperbarui:', counterError)
          alert('Quotation sudah tersimpan, tetapi nomor urut berikutnya gagal diperbarui. Periksa koneksi sebelum membuat quotation baru.')
        }
      }
    } catch (error) {
      console.error('Gagal menyimpan quotation:', error)
      setIsSavedClean(false)
      alert(error instanceof Error ? `Gagal menyimpan quotation: ${error.message}` : 'Gagal menyimpan quotation')
    } finally {
      setSaving(false)
    }
  }

  const handleDownloadPdf = async () => {
    const draft = buildDoc()
    setDownloading(true)
    try {
      await downloadLegacyDocumentPdf(prepareLegacyDocumentData(draft, 'quotation', {}))
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Gagal download PDF quotation')
    } finally {
      setDownloading(false)
    }
  }

  const handlePreview = () => onPreview?.(buildDoc())

  return (
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
            {isEdit ? `Quotation — ${doc.fields['q-no']}` : 'Quotation Baru'}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {onPreview && (
            <button onClick={handlePreview} className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">
              <Eye className="w-3.5 h-3.5" />
              Preview
            </button>
          )}
          <button onClick={handleDownloadPdf} disabled={downloading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-60">
            <Download className="w-3.5 h-3.5" />
            {downloading ? 'Membuat PDF...' : 'Download'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || isSavedClean}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-[#1B8A7A] hover:bg-[#0F6E56] text-white text-sm font-semibold rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Menyimpan...' : isSavedClean ? 'Tersimpan' : 'Simpan'}
          </button>
          {isSavedClean && onCreateNew && (
            <button onClick={onCreateNew}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-[#1B8A7A]/30 text-[#1B8A7A] rounded-lg hover:bg-[#E1F5EE]">
              <Plus className="w-3.5 h-3.5" />
              Buat Quotation Baru
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        
        {/* Tema & Warna */}
        <Card title="Tema">
          <div className="flex items-center gap-3 flex-wrap">
            {THEME_COLORS.map(c => (
              <button
                key={c}
                onClick={() => { markDirty(); setTheme(c) }}
                className="w-7 h-7 rounded-full transition-all"
                style={{
                  background: c,
                  outline: theme === c ? `3px solid ${c}` : 'none',
                  outlineOffset: '2px',
                }}
              />
            ))}
            <input
              type="color"
              value={theme}
              onChange={e => { markDirty(); setTheme(e.target.value) }}
              className="w-8 h-7 rounded cursor-pointer border border-gray-200 p-0.5"
            />
          </div>
        </Card>

        {/* Info Quotation */}
        <Card title="Info Quotation">
          <div className="grid grid-cols-2 gap-3">
            <Field label="No. Quotation" required>
              <input
                value={fields['q-no'] || ''}
                onChange={e => setField('q-no', e.target.value)}
                className={input}
                placeholder={autoNo}
              />
            </Field>
            <Field label="Tanggal">
              <input
                type="date"
                value={fields['q-date'] || today}
                onChange={e => setField('q-date', e.target.value)}
                className={input}
              />
            </Field>
          </div>
          <Field label="Status Pembayaran">
            <select value={fields['q-status'] || 'Draft'} onChange={e => setField('q-status', e.target.value)} className={input}>
              {['Draft','Terbit','Belum Lunas','Lunas','Overdue'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
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
                  {selectedCompanyId ? 'Bisa diganti manual untuk dokumen ini' : 'Memakai perusahaan aktif'}
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
                          className="w-full text-left px-3 py-2 hover:bg-[#E1F5EE] border-b border-gray-50 last:border-0"
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
          {/* Header */}
          <div className="grid gap-2 mb-2 px-1" style={{ gridTemplateColumns: '15% 20% 1fr 18% 28px' }}>
            {['Brand','Item','SOW','Amount',''].map(h => (
              <span key={h} className="text-[10px] font-semibold text-gray-400">{h}</span>
            ))}
          </div>

          <div className="space-y-2">
            {items.map((item, idx) => (
              <div key={idx} className="grid gap-2 items-start" style={{ gridTemplateColumns: '15% 20% 1fr 18% 28px' }}>
                <input
                  value={item.brand}
                  onChange={e => setItem(idx, 'brand', e.target.value)}
                  placeholder="Brand"
                  list="quotation-brand-list"
                  className={inputSm}
                />
                <input
                  value={item.item}
                  onChange={e => setItem(idx, 'item', e.target.value)}
                  placeholder="Nama item"
                  className={inputSm}
                />
                <textarea
                  value={item.sow}
                  onChange={e => setItem(idx, 'sow', e.target.value)}
                  placeholder="Scope of work..."
                  rows={2}
                  className={inputSm}
                />
                <input
                  type="number"
                  value={item.amount || ''}
                  onChange={e => setItem(idx, 'amount', +e.target.value)}
                  placeholder="0"
                  className={inputSm + ' text-right'}
                />
                <button
                  onClick={() => removeItem(idx)}
                  disabled={items.length === 1}
                  className="w-7 h-7 flex items-center justify-center bg-red-50 text-red-400 hover:text-red-600 rounded-lg disabled:opacity-30 mt-0.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          <button
            onClick={addItem}
            className="mt-3 w-full py-2 text-sm text-[#1B8A7A] border border-dashed border-[#1B8A7A]/30 rounded-lg hover:bg-[#E1F5EE] transition-colors flex items-center justify-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            Tambah Item
          </button>
          <datalist id="quotation-brand-list">
            {brandHistory.map(b => <option key={b} value={b} />)}
          </datalist>

          {/* Totals */}
          <div className="mt-4 pt-4 border-t border-gray-100 space-y-2">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input type="checkbox" checked={showSub} onChange={e => { markDirty(); setShowSub(e.target.checked) }} className="accent-[#1B8A7A]" />
                Tampilkan Sub Total
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input type="checkbox" checked={showGross} onChange={e => { markDirty(); setShowGross(e.target.checked) }} className="accent-[#1B8A7A]" />
                Tampilkan Gross Up
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input type="checkbox" checked={showDisc} onChange={e => { markDirty(); setShowDisc(e.target.checked) }} className="accent-[#1B8A7A]" />
                Tampilkan Diskon
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input type="checkbox" checked={showExtra1} onChange={e => { markDirty(); setShowExtra1(e.target.checked) }} className="accent-[#1B8A7A]" />
                + Baris Penambah
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input type="checkbox" checked={showExtra2} onChange={e => { markDirty(); setShowExtra2(e.target.checked) }} className="accent-[#1B8A7A]" />
                − Baris Pengurang
              </label>
            </div>
            {showSub && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Sub Total</span>
                <span className="font-medium">Rp {fmt(subtotal)}</span>
              </div>
            )}
            {showDisc && (
              <div className="flex items-center justify-between text-sm">
                <input
                  type="text"
                  value={fields['q-disc-label'] || ''}
                  onChange={e => setField('q-disc-label', e.target.value)}
                  placeholder="Diskon"
                  className="text-gray-500 bg-transparent border-none outline-none w-32 text-sm placeholder:text-gray-400"
                />
                <input
                  type="number"
                  value={fields['q-disc'] || '0'}
                  onChange={e => setField('q-disc', e.target.value)}
                  className="w-32 text-right px-2 py-1 border border-gray-200 rounded text-sm text-red-500"
                />
              </div>
            )}
            {showExtra2 && (
              <div className="flex items-center justify-between text-sm">
                <input
                  type="text"
                  value={fields['q-extra2-label'] || ''}
                  onChange={e => setField('q-extra2-label', e.target.value)}
                  placeholder="Pengurang"
                  className="text-gray-500 bg-transparent border-none outline-none w-32 text-sm placeholder:text-gray-400"
                />
                <input
                  type="number"
                  value={fields['q-extra2'] || '0'}
                  onChange={e => setField('q-extra2', e.target.value)}
                  className="w-32 text-right px-2 py-1 border border-gray-200 rounded text-sm text-red-500"
                />
              </div>
            )}
            {showGross && (
              <div className="flex items-center justify-between text-sm">
                <input
                  type="text"
                  value={fields['q-gross-label'] || ''}
                  onChange={e => setField('q-gross-label', e.target.value)}
                  placeholder="Gross Up"
                  className="text-gray-500 bg-transparent border-none outline-none w-32 text-sm placeholder:text-gray-400"
                />
                <input
                  type="number"
                  value={fields['q-gross'] || '0'}
                  onChange={e => setField('q-gross', e.target.value)}
                  className="w-32 text-right px-2 py-1 border border-gray-200 rounded text-sm"
                />
              </div>
            )}
            {showExtra1 && (
              <div className="flex items-center justify-between text-sm">
                <input
                  type="text"
                  value={fields['q-extra1-label'] || ''}
                  onChange={e => setField('q-extra1-label', e.target.value)}
                  placeholder="Penambah"
                  className="text-gray-500 bg-transparent border-none outline-none w-32 text-sm placeholder:text-gray-400"
                />
                <input
                  type="number"
                  value={fields['q-extra1'] || '0'}
                  onChange={e => setField('q-extra1', e.target.value)}
                  className="w-32 text-right px-2 py-1 border border-gray-200 rounded text-sm text-green-600"
                />
              </div>
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
            <Field label="Bank Name">
              <input value={fields['p-bank'] || ''} onChange={e => setField('p-bank', e.target.value)} className={input} />
            </Field>
            <Field label="Bank Address">
              <input value={fields['p-branch'] || ''} onChange={e => setField('p-branch', e.target.value)} className={input} />
            </Field>
            <Field label="Account Name">
              <input value={fields['p-accname'] || ''} onChange={e => setField('p-accname', e.target.value)} className={input} />
            </Field>
            <Field label="Account Numbers">
              <input value={fields['p-accno'] || ''} onChange={e => setField('p-accno', e.target.value)} className={input} />
            </Field>
          </div>
        </Card>

        {/* TTD & Penutup */}
        <Card title="TTD & Penutup">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nama">
              <input value={fields['s-name'] || ''} onChange={e => setField('s-name', e.target.value)} className={input} />
            </Field>
            <Field label="Jabatan">
              <input value={fields['s-title'] || ''} onChange={e => setField('s-title', e.target.value)} className={input} />
            </Field>
          </div>
          <Field label="Tagline">
            <input value={fields['s-tagline'] || ''} onChange={e => setField('s-tagline', e.target.value)} className={input} />
          </Field>
          <Field label="Catatan">
            <textarea value={fields['q-notes'] || ''} onChange={e => setField('q-notes', e.target.value)} rows={2} className={input} />
          </Field>
        </Card>

        {/* Bottom save */}
        <div className="pb-6">
          <button
            onClick={handleSave}
            disabled={saving || isSavedClean}
            className="w-full py-2.5 bg-[#1B8A7A] hover:bg-[#0F6E56] text-white text-sm font-semibold rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? 'Menyimpan...' : isSavedClean ? 'Quotation Tersimpan' : 'Simpan Quotation'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Sub-components
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

const input = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A] focus:ring-1 focus:ring-[#1B8A7A]/10 transition-all resize-none'
const inputSm = 'w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A] transition-all resize-none'
