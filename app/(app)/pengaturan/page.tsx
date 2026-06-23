'use client'

import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Hash, Palette, Save, Settings, Shield, SlidersHorizontal } from 'lucide-react'
import { fetchGlobal, saveGlobal } from '@/lib/rtdb'
import { buildNextNumberUpdates, buildPrefixUpdates, formatDocumentNumber } from '@/lib/document-numbering'

type Config = Record<string, string>

const DEFAULT_CONFIG: Config = {
  'q-prefix': 'QTT-BUB',
  'i-prefix': 'INV-BUB',
  'q-next': '1',
  'i-next': '1',
  'number-digits': '2',
  'default-term': 'Net 14 Days',
  'default-theme': '#1B8A7A',
  'default-currency': 'IDR',
  'q-notes': 'Price quotation valid for 14 days from the date issued.',
  'i-notes': 'Please make payment according to the due date stated on this invoice.',
  years: String(new Date().getFullYear()),
}

const input = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A] focus:ring-1 focus:ring-[#1B8A7A]/10 bg-white'
const label = 'block text-xs font-medium text-gray-500 mb-1.5'

function Field({ label: labelText, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <div><label className={label}>{labelText}</label>{children}{hint && <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">{hint}</p>}</div>
}

function parseYears(raw: string): number[] {
  return Array.from(new Set(raw.split(/[,\.\s]+/).map(x => Number(x.trim())).filter(y => Number.isFinite(y) && y >= 2020 && y <= 2099))).sort()
}

function cleanCounter(value: string, fallback = '1') {
  const n = Number(String(value || '').replace(/[^0-9]/g, ''))
  return Number.isFinite(n) && n > 0 ? String(Math.floor(n)) : fallback
}

function cleanDigits(value: string) {
  const n = Number(String(value || '').replace(/[^0-9]/g, ''))
  if (!Number.isFinite(n)) return '2'
  return String(Math.min(Math.max(Math.floor(n), 1), 6))
}

export default function PengaturanPage() {
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetchGlobal().then(global => {
      const years = Array.isArray(global.years) ? global.years.join(', ') : (global.years || DEFAULT_CONFIG.years)
      setConfig({
        ...DEFAULT_CONFIG,
        ...global,
        'q-prefix': String(global['q-prefix'] || global.QPK || DEFAULT_CONFIG['q-prefix']),
        'i-prefix': String(global['i-prefix'] || global.IPK || DEFAULT_CONFIG['i-prefix']),
        'q-next': String(global['q-next'] || global.QNK || DEFAULT_CONFIG['q-next']),
        'i-next': String(global['i-next'] || global.INK || DEFAULT_CONFIG['i-next']),
        'number-digits': String(global['number-digits'] || DEFAULT_CONFIG['number-digits']),
        years: String(years),
      })
      setLoading(false)
    })
  }, [])

  const setField = (key: string, value: string) => {
    setSaved(false)
    setConfig(current => ({ ...current, [key]: value }))
  }

  const yearsPreview = useMemo(() => parseYears(config.years || ''), [config.years])
  const previewDate = useMemo(() => new Date(), [])
  const qPreview = useMemo(() => formatDocumentNumber('quotation', config, previewDate), [config, previewDate])
  const iPreview = useMemo(() => formatDocumentNumber('invoice', config, previewDate), [config, previewDate])

  const save = async () => {
    const qPrefix = config['q-prefix']?.trim().toUpperCase()
    const iPrefix = config['i-prefix']?.trim().toUpperCase()
    if (!qPrefix || !iPrefix) {
      alert('Prefix Quotation dan Invoice wajib diisi')
      return
    }
    const qNext = Number(cleanCounter(config['q-next']))
    const iNext = Number(cleanCounter(config['i-next']))
    const digits = cleanDigits(config['number-digits'])

    setSaving(true)
    try {
      await saveGlobal({
        ...config,
        ...buildPrefixUpdates('quotation', qPrefix),
        ...buildPrefixUpdates('invoice', iPrefix),
        ...buildNextNumberUpdates('quotation', qNext),
        ...buildNextNumberUpdates('invoice', iNext),
        'number-digits': digits,
        years: yearsPreview.length ? yearsPreview : [new Date().getFullYear()],
      })
      setConfig(current => ({
        ...current,
        'q-prefix': qPrefix,
        'i-prefix': iPrefix,
        'q-next': String(qNext),
        'i-next': String(iNext),
        'number-digits': digits,
      }))
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-6 text-sm text-gray-400">Memuat pengaturan...</div>

  return (
    <div className="p-6">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Pengaturan</h1>
          <p className="text-sm text-gray-400 mt-0.5">Atur format dokumen, default pembayaran, dan preferensi aplikasi.</p>
        </div>
        <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 bg-[#1B8A7A] text-white rounded-lg text-sm font-semibold hover:bg-[#0F6E56] disabled:opacity-60">
          <Save className="w-4 h-4" /> {saving ? 'Menyimpan...' : 'Simpan Pengaturan'}
        </button>
      </div>

      {saved && (
        <div className="mb-5 rounded-xl border border-green-100 bg-green-50 text-green-700 px-4 py-3 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" /> Pengaturan berhasil disimpan.
        </div>
      )}

      <div className="grid grid-cols-[1fr_320px] gap-5">
        <div className="space-y-4">
          <section className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <SlidersHorizontal className="w-5 h-5 text-[#1B8A7A]" />
              <h2 className="text-sm font-semibold text-gray-900">Format Nomor Dokumen</h2>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Prefix Quotation" hint="Format hasil: QTT-BUB-MMYY-NN. Contoh: QTT-BUB-0626-44">
                <input className={input} value={config['q-prefix'] || ''} onChange={e => setField('q-prefix', e.target.value.toUpperCase())} />
              </Field>
              <Field label="Prefix Invoice" hint="Format hasil: INV-BUB-MMYY-NN. Contoh: INV-BUB-0626-74">
                <input className={input} value={config['i-prefix'] || ''} onChange={e => setField('i-prefix', e.target.value.toUpperCase())} />
              </Field>
              <Field label="Nomor Quotation Berikutnya" hint="Angka ini akan dipakai untuk quotation baru berikutnya, lalu naik otomatis setelah disimpan.">
                <input type="number" min={1} className={input} value={config['q-next'] || '1'} onChange={e => setField('q-next', e.target.value)} />
              </Field>
              <Field label="Nomor Invoice Berikutnya" hint="Angka ini akan dipakai untuk invoice baru berikutnya, lalu naik otomatis setelah disimpan.">
                <input type="number" min={1} className={input} value={config['i-next'] || '1'} onChange={e => setField('i-next', e.target.value)} />
              </Field>
              <Field label="Digit Nomor Urut" hint="Isi 2 untuk 01, 44. Isi 3 untuk 001, 044.">
                <select className={input} value={config['number-digits'] || '2'} onChange={e => setField('number-digits', e.target.value)}>
                  <option value="1">1 digit</option>
                  <option value="2">2 digit</option>
                  <option value="3">3 digit</option>
                  <option value="4">4 digit</option>
                </select>
              </Field>
              <Field label="Tahun Kerja Aktif" hint="Pisahkan dengan koma atau spasi. Contoh: 2024, 2025, 2026">
                <input className={input} value={config.years || ''} onChange={e => setField('years', e.target.value)} />
              </Field>
              <Field label="Mata Uang Default">
                <select className={input} value={config['default-currency'] || 'IDR'} onChange={e => setField('default-currency', e.target.value)}>
                  <option>IDR</option>
                  <option>USD</option>
                  <option>SGD</option>
                </select>
              </Field>
            </div>
          </section>

          <section className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <Settings className="w-5 h-5 text-blue-700" />
              <h2 className="text-sm font-semibold text-gray-900">Default Invoice</h2>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Default Payment Term">
                <select className={input} value={config['default-term'] || 'Net 14 Days'} onChange={e => setField('default-term', e.target.value)}>
                  <option>Due on Receipt</option>
                  <option>Net 7 Days</option>
                  <option>Net 14 Days</option>
                  <option>Net 30 Days</option>
                  <option>Net 45 Days</option>
                  <option>Net 60 Days</option>
                </select>
              </Field>
              <Field label="Warna Tema Default">
                <div className="flex gap-2">
                  <input type="color" value={config['default-theme'] || '#1B8A7A'} onChange={e => setField('default-theme', e.target.value)} className="w-12 h-10 border border-gray-200 rounded-lg p-1" />
                  <input className={input} value={config['default-theme'] || ''} onChange={e => setField('default-theme', e.target.value)} />
                </div>
              </Field>
              <div className="col-span-2"><Field label="Catatan Default Quotation"><textarea rows={3} className={input} value={config['q-notes'] || ''} onChange={e => setField('q-notes', e.target.value)} /></Field></div>
              <div className="col-span-2"><Field label="Catatan Default Invoice"><textarea rows={3} className={input} value={config['i-notes'] || ''} onChange={e => setField('i-notes', e.target.value)} /></Field></div>
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <Palette className="w-5 h-5 text-[#1B8A7A]" />
              <h2 className="text-sm font-semibold text-gray-900">Preview</h2>
            </div>
            <div className="space-y-3 text-sm">
              <div className="p-3 rounded-xl border border-gray-100 bg-gray-50">
                <div className="text-[10px] text-gray-400 uppercase font-bold">Quotation Baru</div>
                <div className="font-bold text-gray-900 mt-1">{qPreview}</div>
              </div>
              <div className="p-3 rounded-xl border border-gray-100 bg-gray-50">
                <div className="text-[10px] text-gray-400 uppercase font-bold">Invoice Baru</div>
                <div className="font-bold text-gray-900 mt-1">{iPreview}</div>
              </div>
              <div className="p-3 rounded-xl border border-gray-100 bg-gray-50">
                <div className="flex items-center gap-2 text-[10px] text-gray-400 uppercase font-bold"><Hash className="w-3 h-3" /> Counter Aktif</div>
                <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                  <div className="px-2 py-1 rounded-lg bg-white border border-gray-100">QTT: <b>{config['q-next'] || '1'}</b></div>
                  <div className="px-2 py-1 rounded-lg bg-white border border-gray-100">INV: <b>{config['i-next'] || '1'}</b></div>
                </div>
              </div>
              <div className="p-3 rounded-xl border border-gray-100 bg-gray-50">
                <div className="text-[10px] text-gray-400 uppercase font-bold">Tahun Aktif</div>
                <div className="flex flex-wrap gap-1 mt-2">{yearsPreview.map(year => <span key={year} className="px-2 py-1 bg-[#E1F5EE] text-[#0F6E56] rounded-lg text-xs font-semibold">{year}</span>)}</div>
              </div>
            </div>
          </section>

          <section className="bg-white rounded-xl border border-amber-100 shadow-sm p-5 bg-amber-50/40">
            <div className="flex items-center gap-2 mb-2 text-amber-700">
              <Shield className="w-5 h-5" />
              <h2 className="text-sm font-semibold">Catatan Aman</h2>
            </div>
            <p className="text-xs text-amber-700/80 leading-relaxed">Nomor dokumen akan otomatis memakai bulan dan tahun dari tanggal dokumen. Kalau bulan berganti, bagian MMYY otomatis ikut berubah. Counter tetap bisa kamu koreksi manual dari sini.</p>
          </section>
        </aside>
      </div>
    </div>
  )
}
