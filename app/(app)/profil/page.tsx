'use client'

import type { ReactNode } from 'react'
import { ChangeEvent, useEffect, useMemo, useState } from 'react'
import {
  Building2,
  CheckCircle2,
  CircleDollarSign,
  ImagePlus,
  Plus,
  Save,
  Signature,
  Star,
  Trash2,
  Upload,
  UserRound,
  Users,
} from 'lucide-react'
import { fetchGlobal, saveGlobal } from '@/lib/rtdb'
import { normalizeAppInitials } from '@/lib/app-identity'
import {
  DEFAULT_COMPANY,
  DEFAULT_SIGNATORY,
  type CompanyPaymentAccount,
  type CompanyProfile,
  type SignatoryProfile,
  getAccountById,
  getCompanyById,
  getDefaultCompanyId,
  makeId,
  normalizeCompanies,
  normalizeCompany,
  normalizeSignatory,
  type Signer,
  normalizeSigners,
} from '@/lib/company-profile'

const input = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A] focus:ring-1 focus:ring-[#1B8A7A]/10 bg-white'
const label = 'block text-xs font-medium text-gray-500 mb-1.5'

function Field({ label: labelText, children }: { label: string; children: ReactNode }) {
  return <div><label className={label}>{labelText}</label>{children}</div>
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function normalizeCompanyForSave(company: CompanyProfile): CompanyProfile {
  return normalizeCompany(company, 0)
}

function SignatoryCard({
  title,
  description,
  name,
  jobTitle,
  signatureData,
  active,
  onClick,
}: {
  title: string
  description: string
  name: string
  jobTitle: string
  signatureData: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-xl border p-3 transition ${active ? 'border-[#1B8A7A] bg-[#E1F5EE]' : 'border-gray-100 bg-white hover:border-gray-200'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-900">{title}</div>
          <div className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">{description}</div>
        </div>
        <div className={`rounded-full px-2 py-1 text-[10px] font-bold ${active ? 'bg-[#1B8A7A] text-white' : 'bg-gray-100 text-gray-400'}`}>{signatureData ? 'Ada TTD' : 'Kosong'}</div>
      </div>
      <div className="mt-3 text-xs text-gray-600">
        <div className="font-semibold text-gray-800">{name || '-'}</div>
        <div className="text-gray-400">{jobTitle || '-'}</div>
      </div>
    </button>
  )
}

export default function ProfilPerusahaanPage() {
  const [companies, setCompanies] = useState<CompanyProfile[]>([DEFAULT_COMPANY])
  const [selectedCompanyId, setSelectedCompanyId] = useState(DEFAULT_COMPANY.id)
  const [defaultCompanyId, setDefaultCompanyId] = useState(DEFAULT_COMPANY.id)
  const [signatory, setSignatory] = useState<SignatoryProfile>(DEFAULT_SIGNATORY)
  const [activeSignatureTab, setActiveSignatureTab] = useState<'director' | 'hrd'>('director')
  const [signers, setSigners] = useState<Signer[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [appIdentity, setAppIdentity] = useState({
    appName: 'FinanceBub',
    appSubtitle: 'All Project',
    appFooter: 'FinanceBUB',
    appInitials: '',
    appLogoData: '',
    appColor: '#1B8A7A',
  })

  useEffect(() => {
    fetchGlobal().then(global => {
      const loadedCompanies = normalizeCompanies(global)
      const activeId = getDefaultCompanyId(global, loadedCompanies)
      setCompanies(loadedCompanies)
      setDefaultCompanyId(activeId)
      setSelectedCompanyId(activeId)
      setSignatory(normalizeSignatory(global))
      setSigners(normalizeSigners(global))
      setAppIdentity({
        appName: (global as any).appName || 'FinanceBub',
        appSubtitle: (global as any).appSubtitle || 'All Project',
        appFooter: String((global as any).appFooter ?? 'FinanceBUB').trim() || 'FinanceBUB',
        appInitials: normalizeAppInitials((global as any).appInitials),
        appLogoData: (global as any).appLogoData || '',
        appColor: (global as any).appColor || '#1B8A7A',
      })
      setLoading(false)
    })
  }, [])

  const selectedCompany = useMemo(() => {
    return getCompanyById(companies, selectedCompanyId)
  }, [companies, selectedCompanyId])

  const defaultCompany = useMemo(() => {
    return getCompanyById(companies, defaultCompanyId)
  }, [companies, defaultCompanyId])

  const selectedAccount = useMemo(() => {
    return getAccountById(selectedCompany, selectedCompany.activeAccountId)
  }, [selectedCompany])

  const updateCompany = (key: Exclude<keyof CompanyProfile, 'accounts' | 'activeAccountId'>, value: string) => {
    setSaved(false)
    setCompanies(current => current.map(company => (
      company.id === selectedCompany.id ? normalizeCompanyForSave({ ...company, [key]: value }) : company
    )))
  }

  const updateSignatory = (key: keyof SignatoryProfile, value: string) => {
    setSaved(false)
    setSignatory(current => ({ ...current, [key]: value }))
  }

  const addSigner = () => {
    setSaved(false)
    setSigners(prev => [...prev, { id: makeId('signer'), name: '', title: '', signatureData: '' }])
  }
  const updateSigner = (id: string, key: keyof Signer, value: string) => {
    setSaved(false)
    setSigners(prev => prev.map(s => s.id === id ? { ...s, [key]: value } : s))
  }
  const removeSigner = (id: string) => {
    setSaved(false)
    setSigners(prev => prev.filter(s => s.id !== id))
  }
  const handleSignerImage = async (event: ChangeEvent<HTMLInputElement>, signerId: string) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > 850_000) {
      alert('Ukuran file terlalu besar. Usahakan di bawah 850KB.')
      return
    }
    const dataUrl = await readFileAsDataUrl(file)
    updateSigner(signerId, 'signatureData', dataUrl)
  }

  const updateAccount = (accountId: string, key: keyof CompanyPaymentAccount, value: string) => {
    setSaved(false)
    setCompanies(current => current.map(company => {
      if (company.id !== selectedCompany.id) return company
      const accounts = company.accounts.map(account => account.id === accountId ? { ...account, [key]: value } : account)
      const activeAccount = getAccountById({ ...company, accounts }, company.activeAccountId)
      return normalizeCompanyForSave({
        ...company,
        accounts,
        bank: activeAccount.bank,
        branch: activeAccount.branch,
        accName: activeAccount.accName,
        accNo: activeAccount.accNo,
      })
    }))
  }

  const addCompany = () => {
    const newCompany = normalizeCompany({
      ...DEFAULT_COMPANY,
      id: makeId('company'),
      name: `Perusahaan Baru ${companies.length + 1}`,
      tax: '',
      addr: '',
      phone: '',
      email: '',
      web: '',
      bank: '',
      branch: '',
      accName: '',
      accNo: '',
      logoData: '',
      accounts: [{
        id: makeId('account'),
        label: 'Rekening Utama',
        bank: '',
        branch: '',
        accName: '',
        accNo: '',
      }],
    }, companies.length)
    setCompanies(current => [...current, newCompany])
    setSelectedCompanyId(newCompany.id)
    setSaved(false)
  }

  const removeCompany = (id: string) => {
    if (companies.length <= 1) {
      alert('Minimal harus ada 1 profil perusahaan.')
      return
    }
    if (!confirm('Hapus profil perusahaan ini? Data di quotation/invoice lama tidak ikut berubah.')) return
    const next = companies.filter(company => company.id !== id)
    const nextDefaultId = defaultCompanyId === id ? (next[0]?.id || DEFAULT_COMPANY.id) : defaultCompanyId
    setCompanies(next)
    setDefaultCompanyId(nextDefaultId)
    setSelectedCompanyId(nextDefaultId)
    setSaved(false)
  }

  const addAccount = () => {
    const newAccount: CompanyPaymentAccount = {
      id: makeId('account'),
      label: `Rekening ${selectedCompany.accounts.length + 1}`,
      bank: '',
      branch: '',
      accName: selectedCompany.name,
      accNo: '',
    }
    setCompanies(current => current.map(company => {
      if (company.id !== selectedCompany.id) return company
      return normalizeCompanyForSave({ ...company, accounts: [...company.accounts, newAccount], activeAccountId: newAccount.id })
    }))
    setSaved(false)
  }

  const removeAccount = (accountId: string) => {
    if (selectedCompany.accounts.length <= 1) {
      alert('Minimal harus ada 1 rekening pembayaran.')
      return
    }
    if (!confirm('Hapus rekening ini?')) return
    setCompanies(current => current.map(company => {
      if (company.id !== selectedCompany.id) return company
      const accounts = company.accounts.filter(account => account.id !== accountId)
      const activeAccountId = company.activeAccountId === accountId ? accounts[0]?.id || '' : company.activeAccountId
      return normalizeCompanyForSave({ ...company, accounts, activeAccountId })
    }))
    setSaved(false)
  }

  const setDefaultAccount = (accountId: string) => {
    setCompanies(current => current.map(company => (
      company.id === selectedCompany.id ? normalizeCompanyForSave({ ...company, activeAccountId: accountId }) : company
    )))
    setSaved(false)
  }

  const setDefaultCompany = (companyId: string) => {
    setDefaultCompanyId(companyId)
    setSaved(false)
  }

  const handleImage = async (event: ChangeEvent<HTMLInputElement>, type: 'logo' | 'director' | 'hrd') => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > 850_000) {
      alert('Ukuran file terlalu besar. Usahakan di bawah 850KB supaya database tetap ringan.')
      return
    }
    const dataUrl = await readFileAsDataUrl(file)
    if (type === 'logo') updateCompany('logoData', dataUrl)
    if (type === 'director') updateSignatory('directorSignatureData', dataUrl)
    if (type === 'hrd') updateSignatory('hrdSignatureData', dataUrl)
  }

  const save = async () => {
    setSaving(true)
    try {
      const normalized = companies.map((company, index) => normalizeCompany(company, index))
      const active = getCompanyById(normalized, defaultCompanyId)
      const activeAccount = getAccountById(active, active.activeAccountId)
      await saveGlobal({
        companyProfiles: normalized,
        activeCompanyId: active.id,

        // Legacy flat keys. Ini membuat Quotation/Invoice baru tetap otomatis pakai perusahaan aktif.
        'c-name': active.name,
        'c-tax': active.tax,
        'c-addr': active.addr,
        'c-phone': active.phone,
        'c-email': active.email,
        'c-web': active.web,
        'p-bank': activeAccount.bank,
        'p-branch': activeAccount.branch,
        'p-accname': activeAccount.accName,
        'p-accno': activeAccount.accNo,
        logoData: active.logoData,

        // Direktur dipakai untuk Quotation & Invoice.
        directorName: signatory.directorName,
        directorTitle: signatory.directorTitle,
        directorSignatureData: signatory.directorSignatureData,
        's-name': signatory.directorName,
        's-title': signatory.directorTitle,
        sigData: signatory.directorSignatureData,
        's-tagline': signatory.tagline,

        // HRD dipakai untuk Slip Gaji.
        hrdName: signatory.hrdName,
        hrdTitle: signatory.hrdTitle,
        hrdSignatureData: signatory.hrdSignatureData,

        // Daftar Penandatangan
        signers: signers.map(s => ({ id: s.id, name: s.name, title: s.title, signatureData: s.signatureData })),

        // Identitas Aplikasi
        appName: appIdentity.appName,
        appSubtitle: appIdentity.appSubtitle,
        appFooter: appIdentity.appFooter,
        appInitials: appIdentity.appInitials,
        appLogoData: appIdentity.appLogoData,
        appColor: appIdentity.appColor,
      })
      setCompanies(normalized)
      setDefaultCompanyId(active.id)
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  const completeness = useMemo(() => {
    const defaultAccount = getAccountById(defaultCompany, defaultCompany.activeAccountId)
    const keys = [
      defaultCompany.name,
      defaultCompany.addr,
      defaultCompany.phone,
      defaultCompany.email,
      defaultCompany.tax,
      defaultAccount.bank,
      defaultAccount.accName,
      defaultAccount.accNo,
      signatory.directorName,
      signatory.directorTitle,
      signatory.hrdName,
      signatory.hrdTitle,
    ]
    return Math.round((keys.filter(value => value?.trim()).length / keys.length) * 100)
  }, [defaultCompany, signatory])

  const activeSignature = activeSignatureTab === 'director'
    ? {
      title: 'Tanda Tangan Direktur',
      description: 'Dipakai otomatis di Quotation dan Invoice.',
      data: signatory.directorSignatureData,
      uploadType: 'director' as const,
      clear: () => updateSignatory('directorSignatureData', ''),
      buttonClass: 'bg-gray-900 hover:bg-black',
    }
    : {
      title: 'Tanda Tangan HRD',
      description: 'Dipakai otomatis di Slip Gaji.',
      data: signatory.hrdSignatureData,
      uploadType: 'hrd' as const,
      clear: () => updateSignatory('hrdSignatureData', ''),
      buttonClass: 'bg-[#1B8A7A] hover:bg-[#0F6E56]',
    }

  if (loading) {
    return <div className="p-6 text-sm text-gray-400">Memuat profil perusahaan...</div>
  }

  return (
    <div className="p-6">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Profil Perusahaan</h1>
          <p className="text-sm text-gray-400 mt-0.5">Kelola beberapa perusahaan, rekening pembayaran, dan tanda tangan dokumen.</p>
        </div>
        <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 bg-[#1B8A7A] text-white rounded-lg text-sm font-semibold hover:bg-[#0F6E56] disabled:opacity-60">
          <Save className="w-4 h-4" /> {saving ? 'Menyimpan...' : 'Simpan Profil'}
        </button>
      </div>

      {saved && (
        <div className="mb-5 rounded-xl border border-green-100 bg-green-50 text-green-700 px-4 py-3 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" /> Profil perusahaan berhasil disimpan.
        </div>
      )}

      <div className="grid grid-cols-[1fr_340px] gap-5">
        <div className="space-y-4">
          <section className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-[#1B8A7A]" />
                <h2 className="text-sm font-semibold text-gray-900">Daftar Profil Perusahaan</h2>
              </div>
              <button onClick={addCompany} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#1B8A7A] text-white hover:bg-[#0F6E56]">
                <Plus className="w-3.5 h-3.5" /> Tambah Profil
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {companies.map(company => {
                const account = getAccountById(company, company.activeAccountId)
                const isDefault = company.id === defaultCompanyId
                return (
                  <button
                    key={company.id}
                    type="button"
                    onClick={() => setSelectedCompanyId(company.id)}
                    className={`text-left rounded-xl border p-3 transition relative ${company.id === selectedCompany.id ? 'border-[#1B8A7A] bg-[#E1F5EE]' : 'border-gray-100 bg-white hover:border-gray-200'}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-gray-900 truncate">{company.name || 'Tanpa Nama'}</div>
                        <div className="text-[11px] text-gray-500 mt-1 truncate">{account.bank || 'Bank belum diisi'} · {account.accNo || 'No. rek belum diisi'}</div>
                      </div>
                      {isDefault && <span className="inline-flex items-center gap-1 rounded-full bg-[#1B8A7A] px-2 py-1 text-[10px] font-bold text-white"><Star className="w-3 h-3" /> Aktif</span>}
                    </div>
                    <label className="mt-3 flex items-center gap-2 text-[11px] text-gray-500" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={isDefault} onChange={() => setDefaultCompany(company.id)} className="accent-[#1B8A7A]" />
                      Jadikan perusahaan aktif default
                    </label>
                  </button>
                )
              })}
            </div>
          </section>

          <section className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-[#1B8A7A]" />
                <h2 className="text-sm font-semibold text-gray-900">Identitas Perusahaan Dipilih</h2>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setDefaultCompany(selectedCompany.id)} className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border ${selectedCompany.id === defaultCompanyId ? 'bg-[#E1F5EE] text-[#0F6E56] border-[#1B8A7A]/20' : 'text-gray-500 border-gray-200 hover:bg-gray-50'}`}>
                  <Star className="w-3.5 h-3.5" /> {selectedCompany.id === defaultCompanyId ? 'Perusahaan Aktif' : 'Jadikan Aktif'}
                </button>
                {companies.length > 1 && (
                  <button onClick={() => removeCompany(selectedCompany.id)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-red-100 text-red-600 hover:bg-red-50">
                    <Trash2 className="w-3.5 h-3.5" /> Hapus Profil
                  </button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nama Perusahaan"><input className={input} value={selectedCompany.name || ''} onChange={e => updateCompany('name', e.target.value)} /></Field>
              <Field label="NPWP / Tax ID"><input className={input} value={selectedCompany.tax || ''} onChange={e => updateCompany('tax', e.target.value)} /></Field>
              <div className="col-span-2"><Field label="Alamat"><textarea rows={3} className={input} value={selectedCompany.addr || ''} onChange={e => updateCompany('addr', e.target.value)} /></Field></div>
              <Field label="Telepon"><input className={input} value={selectedCompany.phone || ''} onChange={e => updateCompany('phone', e.target.value)} /></Field>
              <Field label="Email"><input className={input} value={selectedCompany.email || ''} onChange={e => updateCompany('email', e.target.value)} /></Field>
              <Field label="Website"><input className={input} value={selectedCompany.web || ''} onChange={e => updateCompany('web', e.target.value)} /></Field>
            </div>
          </section>

          <section className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
                <CircleDollarSign className="w-5 h-5 text-blue-700" />
                <h2 className="text-sm font-semibold text-gray-900">Rekening Pembayaran</h2>
              </div>
              <button onClick={addAccount} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-700 text-white hover:bg-blue-800">
                <Plus className="w-3.5 h-3.5" /> Tambah Rekening
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-4">
              {selectedCompany.accounts.map(account => {
                const isActive = account.id === selectedCompany.activeAccountId
                return (
                  <button
                    key={account.id}
                    type="button"
                    onClick={() => setDefaultAccount(account.id)}
                    className={`text-left rounded-xl border p-3 transition ${isActive ? 'border-blue-600 bg-blue-50' : 'border-gray-100 hover:border-gray-200'}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-gray-900 truncate">{account.label || account.bank || 'Rekening'}</div>
                        <div className="text-[11px] text-gray-500 mt-1 truncate">{account.bank || '-'} · {account.accNo || '-'}</div>
                      </div>
                      {isActive && <span className="rounded-full bg-blue-700 px-2 py-1 text-[10px] font-bold text-white">Default</span>}
                    </div>
                  </button>
                )
              })}
            </div>

            <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs font-bold uppercase tracking-wider text-blue-700">Edit Rekening Default Perusahaan Ini</div>
                {selectedCompany.accounts.length > 1 && (
                  <button onClick={() => removeAccount(selectedAccount.id)} className="inline-flex items-center gap-1 text-xs text-red-600 hover:underline">
                    <Trash2 className="w-3.5 h-3.5" /> Hapus
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Label Rekening"><input className={input} value={selectedAccount.label || ''} onChange={e => updateAccount(selectedAccount.id, 'label', e.target.value)} placeholder="Contoh: BCA Utama" /></Field>
                <Field label="Nama Bank"><input className={input} value={selectedAccount.bank || ''} onChange={e => updateAccount(selectedAccount.id, 'bank', e.target.value)} placeholder="BCA / Mandiri / BRI" /></Field>
                <Field label="Cabang"><input className={input} value={selectedAccount.branch || ''} onChange={e => updateAccount(selectedAccount.id, 'branch', e.target.value)} /></Field>
                <Field label="Atas Nama"><input className={input} value={selectedAccount.accName || ''} onChange={e => updateAccount(selectedAccount.id, 'accName', e.target.value)} /></Field>
                <Field label="Nomor Rekening"><input className={input} value={selectedAccount.accNo || ''} onChange={e => updateAccount(selectedAccount.id, 'accNo', e.target.value)} /></Field>
              </div>
            </div>
          </section>

          <section className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <Signature className="w-5 h-5 text-amber-600" />
              <h2 className="text-sm font-semibold text-gray-900">Penandatangan Dokumen</h2>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="rounded-xl border border-gray-100 p-4 bg-gray-50/60">
                <div className="flex items-center gap-2 mb-3">
                  <UserRound className="w-4 h-4 text-gray-700" />
                  <div className="text-sm font-semibold text-gray-900">Direktur</div>
                </div>
                <div className="space-y-3">
                  <Field label="Nama Direktur"><input className={input} value={signatory.directorName || ''} onChange={e => updateSignatory('directorName', e.target.value)} /></Field>
                  <Field label="Jabatan"><input className={input} value={signatory.directorTitle || ''} onChange={e => updateSignatory('directorTitle', e.target.value)} /></Field>
                  <div className="text-[11px] leading-relaxed text-gray-400">Dipakai sebagai tanda tangan default untuk Quotation dan Invoice.</div>
                </div>
              </div>

              <div className="rounded-xl border border-gray-100 p-4 bg-gray-50/60">
                <div className="flex items-center gap-2 mb-3">
                  <UserRound className="w-4 h-4 text-gray-700" />
                  <div className="text-sm font-semibold text-gray-900">HRD</div>
                </div>
                <div className="space-y-3">
                  <Field label="Nama HRD"><input className={input} value={signatory.hrdName || ''} onChange={e => updateSignatory('hrdName', e.target.value)} /></Field>
                  <Field label="Jabatan"><input className={input} value={signatory.hrdTitle || ''} onChange={e => updateSignatory('hrdTitle', e.target.value)} /></Field>
                  <div className="text-[11px] leading-relaxed text-gray-400">Dipakai sebagai tanda tangan default untuk Slip Gaji.</div>
                </div>
              </div>

              <div className="col-span-2"><Field label="Tagline / Closing Dokumen"><input className={input} value={signatory.tagline || ''} onChange={e => updateSignatory('tagline', e.target.value)} /></Field></div>
            </div>
          </section>

          {/* ── Daftar Penandatangan ── */}
          <section className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <UserRound className="w-5 h-5 text-[#1B8A7A]" />
                <h2 className="text-sm font-semibold text-gray-900">Daftar Penandatangan</h2>
              </div>
              <button onClick={addSigner} className="px-3 py-1.5 bg-[#1B8A7A] hover:bg-[#0F6E56] text-white text-xs font-semibold rounded-lg">+ Tambah</button>
            </div>
            <p className="text-[11px] text-gray-400 leading-relaxed mb-4">Daftar orang yang bisa dipilih sebagai penandatangan di Quotation dan Invoice.</p>
            {signers.length === 0 && <div className="text-xs text-gray-400 text-center py-6 border border-dashed border-gray-200 rounded-xl">Belum ada penandatangan. Klik + Tambah untuk menambahkan.</div>}
            <div className="space-y-3">
              {signers.map(signer => (
                <div key={signer.id} className="rounded-xl border border-gray-100 p-4 bg-gray-50/60">
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <Field label="Nama"><input className={input} value={signer.name} onChange={e => updateSigner(signer.id, 'name', e.target.value)} /></Field>
                    <Field label="Jabatan"><input className={input} value={signer.title} onChange={e => updateSigner(signer.id, 'title', e.target.value)} /></Field>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 border border-dashed border-gray-200 rounded-lg p-2 bg-white text-center min-h-[48px] flex items-center justify-center">
                      {signer.signatureData ? <img src={signer.signatureData} alt="TTD" className="max-h-10 object-contain" /> : <span className="text-[11px] text-gray-400">Belum ada TTD</span>}
                    </div>
                    <label className="px-3 py-2 bg-[#1B8A7A] text-white rounded-lg text-xs font-semibold cursor-pointer hover:bg-[#0F6E56]">
                      Upload
                      <input type="file" accept="image/*" onChange={e => handleSignerImage(e, signer.id)} className="hidden" />
                    </label>
                    <button onClick={() => removeSigner(signer.id)} className="px-2 py-2 border border-gray-200 rounded-lg text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <div className="text-[10px] uppercase tracking-wider text-gray-400 font-bold mb-1">Kelengkapan Profil Aktif</div>
            <div className="text-3xl font-bold text-[#1B8A7A]">{completeness}%</div>
            <div className="h-2 bg-gray-100 rounded-full mt-3 overflow-hidden">
              <div className="h-full bg-[#1B8A7A]" style={{ width: `${completeness}%` }} />
            </div>
            <p className="text-xs text-gray-400 mt-3 leading-relaxed">Perusahaan aktif otomatis jadi default Quotation dan Invoice baru. Namun di form dokumen, perusahaan dan rekening tetap bisa dipilih manual.</p>
          </section>

          <section className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <ImagePlus className="w-5 h-5 text-[#1B8A7A]" />
              <h2 className="text-sm font-semibold text-gray-900">Logo & Tanda Tangan</h2>
            </div>

            <div className="space-y-4">
              <div>
                <div className="text-xs font-medium text-gray-500 mb-2">Logo Dokumen Perusahaan Dipilih</div>
                <div className="border border-dashed border-gray-200 rounded-xl p-4 text-center bg-gray-50">
                  {selectedCompany.logoData ? <img src={selectedCompany.logoData} alt="Logo" className="mx-auto max-h-16 object-contain" /> : <div className="text-xs text-gray-400 py-4">Belum ada logo</div>}
                </div>
                <div className="flex gap-2 mt-2">
                  <label className="flex-1 text-center px-3 py-2 bg-[#1B8A7A] text-white rounded-lg text-xs font-semibold cursor-pointer hover:bg-[#0F6E56]">
                    Upload
                    <input type="file" accept="image/*" onChange={e => handleImage(e, 'logo')} className="hidden" />
                  </label>
                  <button onClick={() => updateCompany('logoData', '')} className="px-3 py-2 border border-gray-200 rounded-lg text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-medium text-gray-500">Pilih Tanda Tangan</div>
                <SignatoryCard
                  title="Direktur"
                  description="Untuk Quotation dan Invoice"
                  name={signatory.directorName}
                  jobTitle={signatory.directorTitle}
                  signatureData={signatory.directorSignatureData}
                  active={activeSignatureTab === 'director'}
                  onClick={() => setActiveSignatureTab('director')}
                />
                <SignatoryCard
                  title="HRD"
                  description="Untuk Slip Gaji"
                  name={signatory.hrdName}
                  jobTitle={signatory.hrdTitle}
                  signatureData={signatory.hrdSignatureData}
                  active={activeSignatureTab === 'hrd'}
                  onClick={() => setActiveSignatureTab('hrd')}
                />
              </div>

              <div>
                <div className="text-xs font-medium text-gray-500 mb-2">{activeSignature.title}</div>
                <div className="border border-dashed border-gray-200 rounded-xl p-4 text-center bg-gray-50">
                  {activeSignature.data ? <img src={activeSignature.data} alt={activeSignature.title} className="mx-auto max-h-20 object-contain" /> : <div className="text-xs text-gray-400 py-5">Belum ada tanda tangan</div>}
                </div>
                <p className="text-[11px] text-gray-400 leading-relaxed mt-2">{activeSignature.description}</p>
                <div className="flex gap-2 mt-2">
                  <label className={`flex-1 text-center px-3 py-2 text-white rounded-lg text-xs font-semibold cursor-pointer ${activeSignature.buttonClass}`}>
                    Upload
                    <input type="file" accept="image/*" onChange={e => handleImage(e, activeSignature.uploadType)} className="hidden" />
                  </label>
                  <button onClick={activeSignature.clear} className="px-3 py-2 border border-gray-200 rounded-lg text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            </div>
          </section>

          {/* ── Identitas Aplikasi ── */}
          <section className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              {(appIdentity.appLogoData || appIdentity.appInitials) && (
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                  style={{ background: appIdentity.appLogoData ? 'transparent' : appIdentity.appColor }}>
                  {appIdentity.appLogoData
                    ? <img src={appIdentity.appLogoData} alt="logo" className="w-full h-full object-cover rounded-lg" />
                    : appIdentity.appInitials}
                </div>
              )}
              <div>
                <div className="text-sm font-semibold text-gray-900">Identitas Aplikasi</div>
                <div className="text-[11px] text-gray-400">Nama & logo di sidebar</div>
              </div>
            </div>

            <div className="space-y-3">
              <Field label="Nama Aplikasi">
                <input value={appIdentity.appName}
                  onChange={e => { setSaved(false); setAppIdentity(v => ({ ...v, appName: e.target.value })) }}
                  placeholder="FinanceBub" className={input} />
              </Field>
              <Field label="Subtitle (dibawah nama)">
                <input value={appIdentity.appSubtitle}
                  onChange={e => { setSaved(false); setAppIdentity(v => ({ ...v, appSubtitle: e.target.value })) }}
                  placeholder="All Project" className={input} />
              </Field>
              <Field label="Teks Footer Login">
                <input value={appIdentity.appFooter}
                  onChange={e => { setSaved(false); setAppIdentity(v => ({ ...v, appFooter: e.target.value })) }}
                  placeholder="FinanceBUB" className={input} />
              </Field>
              <Field label="Inisial (opsional, tampil jika tidak ada logo)">
                <input value={appIdentity.appInitials}
                  onChange={e => { setSaved(false); setAppIdentity(v => ({ ...v, appInitials: e.target.value.slice(0, 3).toUpperCase() })) }}
                  placeholder="FB" maxLength={3} className={input} />
              </Field>
              <Field label="Warna Utama">
                <div className="flex items-center gap-2">
                  <input type="color" value={appIdentity.appColor}
                    onChange={e => { setSaved(false); setAppIdentity(v => ({ ...v, appColor: e.target.value })) }}
                    className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer p-0.5" />
                  <input value={appIdentity.appColor}
                    onChange={e => { setSaved(false); setAppIdentity(v => ({ ...v, appColor: e.target.value })) }}
                    placeholder="#1B8A7A" className={`${input} flex-1`} />
                </div>
              </Field>
              <Field label="Logo (opsional, ganti inisial)">
                <div className="flex items-center gap-2">
                  {appIdentity.appLogoData && (
                    <img src={appIdentity.appLogoData} alt="logo" className="w-10 h-10 rounded-lg object-cover border border-gray-200" />
                  )}
                  <label className="flex-1 flex items-center justify-center gap-2 px-3 py-2 border border-dashed border-gray-200 rounded-lg text-xs text-gray-400 hover:border-[#1B8A7A] hover:text-[#1B8A7A] cursor-pointer transition-colors">
                    <ImagePlus className="w-4 h-4" />
                    {appIdentity.appLogoData ? 'Ganti Logo' : 'Upload Logo'}
                    <input type="file" accept="image/*" className="hidden" onChange={async e => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      if (file.size > 200_000) { alert('Logo maksimal 200KB'); return }
                      const dataUrl = await readFileAsDataUrl(file)
                      setSaved(false)
                      setAppIdentity(v => ({ ...v, appLogoData: dataUrl }))
                    }} />
                  </label>
                  {appIdentity.appLogoData && (
                    <button onClick={() => { setSaved(false); setAppIdentity(v => ({ ...v, appLogoData: '' })) }}
                      className="px-3 py-2 border border-gray-200 rounded-lg text-gray-400 hover:text-red-600">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </Field>
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
