'use client'

import { useEffect, useState, useRef } from 'react'
import { useAuth } from '@/lib/auth-context'
import { fetchGlobal, subscribeDocs, saveDocs } from '@/lib/rtdb'
import { fmt, fmtDate } from '@/lib/utils'
import type { Doc } from '@/types/document'
import { Plus, Search, FileText, Trash2, Copy, Eye, ChevronDown, ArrowRight, Pencil, Send, CalendarDays, Download } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import QuotationForm from './form'
import QuotationPreview from './preview'
import { useActiveYear } from '@/lib/use-active-year'
import { downloadLegacyDocumentPdf, prepareLegacyDocumentData } from '@/lib/legacy-document-pdf'
import { sortDocumentList, type DocumentSortMode } from '@/lib/document-list-sort'

const today = () => new Date().toISOString().slice(0, 10)

export default function QuotationPage() {
  const { user } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [docs, setDocs] = useState<Doc[]>([])
  const [loading, setLoading] = useState(true)
  const { year, years, setYear } = useActiveYear()
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'list' | 'form' | 'preview'>('list')
  const [selected, setSelected] = useState<Doc | null>(null)
  const [activeSendDocId, setActiveSendDocId] = useState<number | null>(null)
  const [sendDate, setSendDate] = useState(today())
  const [sendTo, setSendTo] = useState('')
  const [sendNote, setSendNote] = useState('')
  const [formNonce, setFormNonce] = useState(0)
  const [downloadingId, setDownloadingId] = useState<number | null>(null)
  const [sortMode, setSortMode] = useState<DocumentSortMode>('date_desc')

  // Baca param dari URL — pasti fresh setiap navigasi
  const openNo = searchParams?.get('open')
  const backTo = searchParams?.get('back')
  const yearParam = searchParams?.get('year')

  // Saat dibuka dari link mutasi, set tahun ke tahun dokumen
  useEffect(() => {
    if (yearParam && years.includes(Number(yearParam))) {
      setYear(Number(yearParam))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearParam])

  useEffect(() => {
    setLoading(true)
    const unsub = subscribeDocs(year, 'q', (data) => {
      const filtered = data.filter(d => d?.fields?.['q-no'])
      setDocs(filtered)
      setLoading(false)
      if (openNo) {
        const target = filtered.find(d => d.fields?.['q-no'] === openNo)
        if (target) { setSelected(target); setView('preview') }
      }
    })
    return unsub
  }, [year, openNo])

  const handleBack = (fromView: 'preview' | 'form') => {
    if (backTo && fromView === 'preview') {
      router.push(`/${backTo}`)
      return
    }
    setView('list')
    setSelected(null)
  }

  const getTotal = (doc: Doc) => {
    const sub = doc.items?.reduce((a, i) => a + (+i.amount || 0), 0) || 0
    return sub - +(doc.fields?.['q-disc'] || 0) + +(doc.fields?.['q-gross'] || 0)
  }

  const getCurrencyLabel = (doc: Doc) => {
    const cur = doc.fields?.['q-cur'] || 'IDR'
    if (cur === 'IDR') return 'Rp'
    if (cur === 'OTHER') return doc.fields?.['cur-custom'] || 'Rp'
    return cur
  }

  const filtered = docs.filter(d => {
    const q = search.toLowerCase()
    return !q ||
      (d.fields?.['q-no'] || '').toLowerCase().includes(q) ||
      (d.fields?.['cl-name'] || '').toLowerCase().includes(q) ||
      d.items?.some(i =>
        i.brand?.toLowerCase().includes(q) ||
        i.item?.toLowerCase().includes(q) ||
        i.sow?.toLowerCase().includes(q)
      )
  })

  const sorted = sortDocumentList(filtered, 'quotation', sortMode)
  const activeSendDoc = sorted.find(d => d.id === activeSendDocId) || sorted[0] || null
  const activeSendLogs = [...(activeSendDoc?.sendLogs || [])].sort((a, b) => (b.date || '').localeCompare(a.date || ''))

  const resetSendForm = () => {
    setSendDate(today())
    setSendTo('')
    setSendNote('')
  }

  const selectSendDoc = (doc: Doc) => {
    setActiveSendDocId(doc.id)
    resetSendForm()
  }

  const updateDoc = async (updatedDoc: Doc) => {
    const updatedDocs = docs.map(d => d.id === updatedDoc.id ? updatedDoc : d)
    setDocs(updatedDocs)
    await saveDocs(year, 'q', updatedDocs)
  }

  const handleAddSendLog = async () => {
    if (!activeSendDoc) return
    if (!sendTo.trim()) {
      alert('Isi dulu kolom kirim ke / keterangan.')
      return
    }
    const updatedDoc: Doc = {
      ...activeSendDoc,
      sendLogs: [
        {
          id: Date.now(),
          date: sendDate || today(),
          to: sendTo.trim(),
          note: sendNote.trim(),
          createdAt: new Date().toISOString(),
          createdBy: user ? { uid: user.uid, name: user.name } : undefined,
        },
        ...(activeSendDoc.sendLogs || []),
      ],
      savedAt: new Date().toISOString(),
    }
    await updateDoc(updatedDoc)
    setActiveSendDocId(updatedDoc.id)
    resetSendForm()
  }

  const handleDeleteSendLog = async (logId: number) => {
    if (!activeSendDoc) return
    if (!confirm('Hapus riwayat kirim ini?')) return
    const updatedDoc: Doc = {
      ...activeSendDoc,
      sendLogs: (activeSendDoc.sendLogs || []).filter(log => log.id !== logId),
      savedAt: new Date().toISOString(),
    }
    await updateDoc(updatedDoc)
    setActiveSendDocId(updatedDoc.id)
  }

  const handleDelete = async (doc: Doc) => {
    if (!confirm(`Hapus ${doc.fields['q-no']}?`)) return
    await saveDocs(year, 'q', docs.filter(d => d.id !== doc.id))
  }

  const handleDuplicate = async (doc: Doc) => {
    const copy: Doc = {
      ...JSON.parse(JSON.stringify(doc)),
      id: Date.now(),
      savedAt: new Date().toISOString(),
      fields: { ...doc.fields, 'q-no': (doc.fields['q-no'] || '') + '-COPY' },
      sendLogs: [],
    }
    await saveDocs(year, 'q', [copy, ...docs])
  }

  const handleConvertToInvoice = (doc: Doc) => {
    sessionStorage.setItem('invoice_from_quo', JSON.stringify(doc))
    router.push('/invoice?from=quo')
  }

  const handleDownloadPdf = async (doc: Doc) => {
    setDownloadingId(doc.id)
    try {
      const global = await fetchGlobal()
      const data = prepareLegacyDocumentData(doc, 'quotation', (global || {}) as Record<string, unknown>)
      await downloadLegacyDocumentPdf(data)
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Gagal download PDF quotation')
    } finally {
      setDownloadingId(null)
    }
  }

  const handleCreateNew = () => {
    setSelected(null)
    setView('form')
    setFormNonce(v => v + 1)
  }

  const handleSave = async (doc: Doc) => {
    const idx = docs.findIndex(d => d.id === doc.id)
    const updated = idx >= 0
      ? docs.map((d, i) => i === idx ? doc : d)
      : [doc, ...docs]
    setDocs(updated)
    await saveDocs(year, 'q', updated)
    setSelected(doc)
  }

  if (view === 'form') {
    return (
      <QuotationForm
        key={`quotation-form-${formNonce}`}
        doc={selected}
        year={year}
        onSave={handleSave}
        onBack={() => handleBack('form')}
        onPreview={(doc) => { setSelected(doc); setView('preview') }}
        onCreateNew={handleCreateNew}
      />
    )
  }

  if (view === 'preview') {
    return (
      <QuotationPreview
        doc={selected!}
        onBack={() => handleBack('preview')}
        onEdit={() => setView('form')}
      />
    )
  }

  const totalNilai = filtered.reduce((a, d) => a + getTotal(d), 0)

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            Quotation <span className="text-gray-400 font-normal text-base">{year}</span>
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">{filtered.length} dokumen · Rp {fmt(totalNilai)}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <select value={year} onChange={e => setYear(+e.target.value)}
              className="appearance-none pl-3 pr-8 py-2 text-sm border border-gray-200 rounded-lg bg-white text-gray-700 outline-none focus:border-[#1B8A7A] cursor-pointer">
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          </div>
          {user?.role !== 'viewer' && (
            <button onClick={handleCreateNew}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#1B8A7A] hover:bg-[#0F6E56] text-white text-sm font-semibold rounded-lg transition-colors">
              <Plus className="w-4 h-4" /> Buat Quotation
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Cari nomor, klien, brand, item..."
            className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A] bg-white" />
        </div>
        <div className="relative md:w-72">
          <select value={sortMode} onChange={e => setSortMode(e.target.value as DocumentSortMode)}
            className="w-full appearance-none pl-3 pr-8 py-2.5 text-sm border border-gray-200 rounded-lg bg-white text-gray-700 outline-none focus:border-[#1B8A7A] cursor-pointer">
            <option value="date_desc">Tanggal terbaru</option>
            <option value="date_asc">Tanggal terlama</option>
            <option value="number_asc">Nomor quotation terkecil</option>
            <option value="number_desc">Nomor quotation terbesar</option>
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gray-100 flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-48 bg-gray-100 rounded" />
                  <div className="h-3 w-64 bg-gray-100 rounded" />
                  <div className="h-3 w-36 bg-gray-100 rounded" />
                </div>
                <div className="h-5 w-24 bg-gray-100 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <FileText className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-sm text-gray-400">
            {search ? 'Tidak ada hasil pencarian' : `Belum ada quotation di tahun ${year}`}
          </p>
          {!search && user?.role !== 'viewer' && (
            <button onClick={handleCreateNew}
              className="mt-3 text-sm text-[#1B8A7A] font-medium hover:underline">
              + Buat quotation pertama
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-4 items-start">
          <div className="space-y-2">
            {sorted.map((doc) => {
              const brands = [...new Set(doc.items?.map(i => i.brand).filter(Boolean))]
              const items  = [...new Set(doc.items?.map(i => i.item).filter(Boolean))]
              const latestSend = [...(doc.sendLogs || [])].sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0]
              const isActiveSendDoc = activeSendDoc?.id === doc.id
              return (
                <div key={doc.id}
                  className={`bg-white rounded-xl border hover:border-gray-200 hover:shadow-sm transition-all group cursor-pointer ${isActiveSendDoc ? 'border-[#1B8A7A]/40 ring-1 ring-[#1B8A7A]/10' : 'border-gray-100'}`}
                  onClick={() => { setSelected(doc); setView('preview') }}>
                  <div className="flex items-center gap-3 px-4 py-3.5">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0"
                      style={{ background: doc.theme || '#1B8A7A' }}>QT</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-gray-900">{doc.fields['q-no']}</span>
                        <span className="text-[10px] text-gray-400">{fmtDate(doc.fields['q-date'] || '')}</span>
                        {doc.fields['q-status'] && doc.fields['q-status'] !== 'Draft' && (
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                            doc.fields['q-status'] === 'Lunas' ? 'bg-green-100 text-green-700' :
                            doc.fields['q-status'] === 'Belum Lunas' ? 'bg-orange-100 text-orange-700' :
                            doc.fields['q-status'] === 'Overdue' ? 'bg-red-100 text-red-700' :
                            'bg-gray-100 text-gray-600'
                          }`}>{doc.fields['q-status']}</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5 truncate">{doc.fields['cl-name'] || '-'}</div>
                      {(brands.length > 0 || items.length > 0) && (
                        <div className="text-[11px] text-gray-400 mt-0.5 truncate">
                          {brands.slice(0, 2).join(', ')}
                          {items.length > 0 && <span> · {items.slice(0, 2).join(', ')}{items.length > 2 ? ` +${items.length - 2}` : ''}</span>}
                        </div>
                      )}
                      <div className="mt-0.5">
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-500">
                          📁 Project: {(doc.fields as any)?.['project-year'] || year}
                        </span>
                      </div>
                      {latestSend && (
                        <div className="text-[10px] text-emerald-600 mt-1 truncate">
                          Terakhir dikirim {fmtDate(latestSend.date)} · {latestSend.to}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-sm font-bold" style={{ color: doc.theme || '#1B8A7A' }}>{getCurrencyLabel(doc)} {fmt(getTotal(doc))}</span>
                      {user?.role !== 'viewer' && (
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={e => e.stopPropagation()}>
                          <button onClick={() => selectSendDoc(doc)}
                            className={`relative p-1.5 rounded-lg transition-colors ${isActiveSendDoc ? 'bg-emerald-50 text-[#1B8A7A]' : 'text-gray-400 hover:bg-emerald-50 hover:text-[#1B8A7A]'}`} title="Catat kirim quotation">
                            <Send className="w-3.5 h-3.5" />
                            {!!doc.sendLogs?.length && <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-1 rounded-full bg-[#1B8A7A] text-white text-[8px] leading-[14px] text-center">{doc.sendLogs.length}</span>}
                          </button>
                          <button onClick={() => handleDownloadPdf(doc)} disabled={downloadingId === doc.id}
                            className="p-1.5 hover:bg-emerald-50 rounded-lg text-gray-400 hover:text-[#1B8A7A] disabled:opacity-50" title="Download PDF"><Download className="w-3.5 h-3.5" /></button>
                          <button onClick={() => { setSelected(doc); setView('preview') }}
                            className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600" title="Preview"><Eye className="w-3.5 h-3.5" /></button>
                          <button onClick={() => handleConvertToInvoice(doc)}
                            className="p-1.5 hover:bg-blue-50 rounded-lg text-gray-400 hover:text-blue-600" title="Buat Invoice"><ArrowRight className="w-3.5 h-3.5" /></button>
                          <button onClick={() => { setSelected(doc); setView('form') }}
                            className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600" title="Edit"><Pencil className="w-3.5 h-3.5" /></button>
                          <button onClick={() => handleDuplicate(doc)}
                            className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600" title="Duplikat"><Copy className="w-3.5 h-3.5" /></button>
                          <button onClick={() => handleDelete(doc)}
                            className="p-1.5 hover:bg-red-50 rounded-lg text-gray-400 hover:text-red-500" title="Hapus"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <aside className="bg-white rounded-xl border border-gray-100 p-4 sticky top-6">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <div className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                  <Send className="w-4 h-4 text-[#1B8A7A]" /> Kirim Quotation
                </div>
                <p className="text-xs text-gray-400 mt-0.5">Catat tanggal kirim dan tujuan pengiriman.</p>
              </div>
              <span className="text-[10px] px-2 py-1 rounded-full bg-emerald-50 text-[#1B8A7A] font-semibold">
                {activeSendLogs.length} log
              </span>
            </div>

            {activeSendDoc ? (
              <>
                <div className="rounded-lg bg-gray-50 border border-gray-100 p-3 mb-3">
                  <div className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">Dokumen aktif</div>
                  <div className="text-sm font-semibold text-gray-900 truncate">{activeSendDoc.fields['q-no']}</div>
                  <div className="text-xs text-gray-500 truncate">{activeSendDoc.fields['cl-name'] || '-'}</div>
                </div>

                {user?.role !== 'viewer' && (
                  <div className="space-y-2 mb-4">
                    <div>
                      <label className="block text-[11px] font-medium text-gray-500 mb-1">Tanggal kirim</label>
                      <input type="date" value={sendDate} onChange={e => setSendDate(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A]" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-gray-500 mb-1">Kirim ke / keterangan singkat</label>
                      <input value={sendTo} onChange={e => setSendTo(e.target.value)}
                        placeholder="Contoh: Bu Rani via WhatsApp / email brand"
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A]" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-gray-500 mb-1">Catatan tambahan</label>
                      <textarea value={sendNote} onChange={e => setSendNote(e.target.value)}
                        placeholder="Opsional: follow up, revisi, PIC, dsb."
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A] min-h-[72px] resize-none" />
                    </div>
                    <button onClick={handleAddSendLog}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-[#1B8A7A] hover:bg-[#0F6E56] text-white text-sm font-semibold rounded-lg transition-colors">
                      <Plus className="w-4 h-4" /> Tambah Riwayat Kirim
                    </button>
                  </div>
                )}

                <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                  {activeSendLogs.length === 0 ? (
                    <div className="text-center py-8 text-xs text-gray-400 border border-dashed border-gray-200 rounded-lg">
                      Belum ada riwayat kirim untuk quotation ini.
                    </div>
                  ) : activeSendLogs.map(log => {
                    const name = log.createdBy?.name || 'Unknown'
                    const initial = name.charAt(0).toUpperCase()
                    const colors = ['bg-teal-500','bg-blue-500','bg-purple-500','bg-orange-500','bg-pink-500']
                    const color = colors[name.charCodeAt(0) % colors.length]
                    const timeStr = log.createdAt ? new Date(log.createdAt).toLocaleString('id-ID', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : ''
                    return (
                      <div key={log.id} className="flex items-start gap-2">
                        <div className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-bold ${color}`}>{initial}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1 mb-1">
                            <span className="text-xs font-semibold text-gray-800">{name}</span>
                            <span className="text-[10px] text-gray-400 flex-shrink-0">{timeStr}</span>
                          </div>
                          <div className="bg-gray-50 border border-gray-100 rounded-2xl rounded-tl-sm px-3 py-2">
                            <div className="text-xs text-gray-700 font-medium">{log.to}</div>
                            <div className="text-[10px] text-[#1B8A7A] mt-0.5 flex items-center gap-1">
                              <CalendarDays className="w-3 h-3" /> {fmtDate(log.date)}
                            </div>
                            {log.note && <div className="text-[11px] text-gray-500 mt-1 border-t border-gray-100 pt-1">{log.note}</div>}
                          </div>
                        </div>
                        {user?.role !== 'viewer' && (
                          <button onClick={() => handleDeleteSendLog(log.id)}
                            className="p-1 hover:bg-red-50 rounded text-gray-300 hover:text-red-500 flex-shrink-0 mt-1" title="Hapus log">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Audit Trail */}
                {activeSendDoc.audit && (
                  <div className="mt-4 pt-3 border-t border-gray-100 space-y-1.5">
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">Riwayat Dokumen</div>
                    {activeSendDoc.audit.createdBy && (
                      <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
                        <span className="w-4 h-4 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-[9px] font-bold flex-shrink-0">+</span>
                        <span>Dibuat oleh <strong>{activeSendDoc.audit.createdBy.name}</strong></span>
                        <span className="text-gray-300 ml-auto flex-shrink-0">{new Date(activeSendDoc.audit.createdBy.at).toLocaleDateString('id-ID', { day:'2-digit', month:'short', year:'numeric' })}</span>
                      </div>
                    )}
                    {activeSendDoc.audit.updatedBy && activeSendDoc.audit.updatedBy.uid !== activeSendDoc.audit.createdBy?.uid || (activeSendDoc.audit.updatedBy && activeSendDoc.audit.updatedBy.at !== activeSendDoc.audit.createdBy?.at) ? (
                      <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
                        <span className="w-4 h-4 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-[9px] font-bold flex-shrink-0">✎</span>
                        <span>Diedit oleh <strong>{activeSendDoc.audit.updatedBy.name}</strong></span>
                        <span className="text-gray-300 ml-auto flex-shrink-0">{new Date(activeSendDoc.audit.updatedBy.at).toLocaleDateString('id-ID', { day:'2-digit', month:'short', year:'numeric' })}</span>
                      </div>
                    ) : null}
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-10 text-sm text-gray-400">Pilih quotation untuk melihat riwayat kirim.</div>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}
