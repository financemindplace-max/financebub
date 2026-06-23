'use client'

import { useEffect, useRef, useState } from 'react'
import { ref, set, update } from 'firebase/database'
import { db } from '@/lib/firebase'
import {
  CheckCircle,
  Landmark,
  Loader2,
  Paperclip,
  ReceiptText,
  ShoppingCart,
  X,
} from 'lucide-react'

const USER_ID = 'financebub-main'
const EMAILJS_SERVICE = 'service_financebub'
const EMAILJS_TEMPLATE_CONFIRM = 'template_r6sx4ev'
const EMAILJS_PUBLIC_KEY = 'Y-RzB4Z9zSXU1hp4H'
const APPLICANT_PROFILE_KEY = 'financebub_reimburse_applicant_v1'

type FundingType = 'reimburse' | 'purchase_request'
type PaymentMethod = 'bank' | 'virtual_account' | 'ewallet'

type ApplicantProfile = {
  name: string
  email: string
  department: string
}

type Attachment = {
  data: string
  name: string
}

async function sendEmail(templateId: string, params: Record<string, string>) {
  const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: EMAILJS_SERVICE,
      template_id: templateId,
      user_id: EMAILJS_PUBLIC_KEY,
      template_params: params,
    }),
  })
  if (!res.ok) throw new Error(`EmailJS error: ${res.status} ${await res.text()}`)
}

const CATEGORIES = [
  'Transport', 'Makan & Minum', 'Akomodasi', 'Perlengkapan Kantor',
  'Operasional', 'Produksi', 'Marketing', 'Software & Langganan', 'Lainnya',
]

const PAYMENT_METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'bank', label: 'Rekening Bank' },
  { value: 'virtual_account', label: 'Virtual Account' },
  { value: 'ewallet', label: 'E-Wallet' },
]

function makeTrackingCode(type: FundingType) {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `${type === 'reimburse' ? 'RMB' : 'PRQ'}-${y}${m}-${rand}`
}

function makeId(type: FundingType) {
  return `${type === 'reimburse' ? 'pub' : 'pubpr'}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

function rupiah(value: string) {
  const amount = Number(value.replace(/\D/g, ''))
  return Number.isNaN(amount) ? '' : `Rp ${amount.toLocaleString('id-ID')}`
}

function todayISO() {
  const now = new Date()
  const offset = now.getTimezoneOffset()
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10)
}

function fundingLabel(type: FundingType) {
  return type === 'reimburse' ? 'Reimburse' : 'Purchase Request'
}

function paymentMethodLabel(method: PaymentMethod) {
  return PAYMENT_METHODS.find(item => item.value === method)?.label || method
}

export default function PublicFundingPage() {
  const [fundingType, setFundingType] = useState<FundingType>('reimburse')
  const [form, setForm] = useState({
    name: '',
    email: '',
    department: '',
    title: '',
    amount: '',
    date: todayISO(),
    category: '',
    description: '',
    payeeName: '',
    paymentMethod: 'bank' as PaymentMethod,
    providerName: '',
    destinationAccount: '',
    notes: '',
  })
  const [attachment, setAttachment] = useState<Attachment | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState<{
    trackingCode: string
    email: string
    type: FundingType
  } | null>(null)
  const [error, setError] = useState('')
  const [emailWarning, setEmailWarning] = useState(false)
  const [rememberApplicant, setRememberApplicant] = useState(true)
  const [profileRestored, setProfileRestored] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const inputClass = 'w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A] focus:ring-2 focus:ring-[#1B8A7A]/10 bg-white transition-all'

  const setField = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm(current => ({ ...current, [key]: value }))
  }

  useEffect(() => {
    const requestedType = new URLSearchParams(window.location.search).get('type')
    if (requestedType === 'purchase_request' || requestedType === 'purchase-request') {
      setFundingType('purchase_request')
    }

    try {
      const raw = window.localStorage.getItem(APPLICANT_PROFILE_KEY)
      if (!raw) return
      const saved = JSON.parse(raw) as Partial<ApplicantProfile>
      if (!saved.name || !saved.email) return

      setForm(current => ({
        ...current,
        name: saved.name || '',
        email: saved.email || '',
        department: saved.department || '',
      }))
      setProfileRestored(true)
    } catch {
      window.localStorage.removeItem(APPLICANT_PROFILE_KEY)
    }
  }, [])

  const switchType = (type: FundingType) => {
    setFundingType(type)
    setError('')
    setAttachment(null)
    setForm(current => ({
      ...current,
      title: '',
      amount: '',
      date: todayISO(),
      category: '',
      description: '',
      payeeName: '',
      paymentMethod: 'bank',
      providerName: '',
      destinationAccount: '',
      notes: '',
    }))
  }

  const clearSavedApplicant = () => {
    window.localStorage.removeItem(APPLICANT_PROFILE_KEY)
    setForm(current => ({ ...current, name: '', email: '', department: '' }))
    setRememberApplicant(false)
    setProfileRestored(false)
  }

  const submitAnother = (type = submitted?.type || fundingType) => {
    setFundingType(type)
    setSubmitted(null)
    setForm(current => ({
      ...current,
      title: '',
      amount: '',
      date: todayISO(),
      category: '',
      description: '',
      payeeName: '',
      paymentMethod: 'bank',
      providerName: '',
      destinationAccount: '',
      notes: '',
    }))
    setAttachment(null)
    setError('')
    setEmailWarning(false)
  }

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
      setError('Lampiran harus berupa JPG, PNG, atau PDF.')
      event.target.value = ''
      return
    }

    if (file.type.startsWith('image/')) {
      if (file.size > 10 * 1024 * 1024) {
        setError('Ukuran gambar sebelum kompresi maksimal 10MB.')
        event.target.value = ''
        return
      }

      const image = new Image()
      const reader = new FileReader()
      reader.onload = loadEvent => {
        image.onload = () => {
          const canvas = document.createElement('canvas')
          const maxSize = 1024
          let width = image.width
          let height = image.height

          if (width > maxSize || height > maxSize) {
            if (width > height) {
              height = Math.round(height * maxSize / width)
              width = maxSize
            } else {
              width = Math.round(width * maxSize / height)
              height = maxSize
            }
          }

          canvas.width = width
          canvas.height = height
          const context = canvas.getContext('2d')
          if (!context) {
            setError('Gambar tidak dapat diproses. Silakan pilih file lain.')
            return
          }
          context.drawImage(image, 0, 0, width, height)
          setAttachment({
            data: canvas.toDataURL('image/jpeg', 0.7),
            name: file.name.replace(/\.[^.]+$/, '.jpg'),
          })
          setError('')
        }
        image.onerror = () => setError('Gambar tidak dapat dibaca. Silakan pilih file lain.')
        image.src = String(loadEvent.target?.result || '')
      }
      reader.readAsDataURL(file)
      return
    }

    if (file.size > 3 * 1024 * 1024) {
      setError('Ukuran PDF maksimal 3MB.')
      event.target.value = ''
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      setAttachment({ data: String(reader.result || ''), name: file.name })
      setError('')
    }
    reader.readAsDataURL(file)
  }

  const validate = () => {
    if (!form.name.trim()) return 'Nama wajib diisi.'
    if (!form.email.trim() || !form.email.includes('@')) return 'Email valid wajib diisi.'
    if (!form.title.trim()) return fundingType === 'reimburse' ? 'Judul pengeluaran wajib diisi.' : 'Nama kebutuhan wajib diisi.'
    if (!form.amount || Number(form.amount.replace(/\D/g, '')) <= 0) return 'Nominal wajib diisi.'
    if (!form.date) return fundingType === 'reimburse' ? 'Tanggal pengeluaran wajib diisi.' : 'Batas waktu pembayaran wajib diisi.'
    if (!form.category) return 'Kategori wajib dipilih.'
    if (!form.description.trim()) return 'Keterangan wajib diisi.'
    if (!attachment) return fundingType === 'reimburse'
      ? 'Foto nota atau bukti pembayaran wajib diunggah.'
      : 'Invoice, quotation, tagihan, atau screenshot wajib diunggah.'

    if (fundingType === 'purchase_request') {
      if (!form.payeeName.trim()) return 'Nama penerima pembayaran wajib diisi.'
      if (!form.providerName.trim()) return 'Nama bank atau penyedia pembayaran wajib diisi.'
      if (!form.destinationAccount.trim()) return 'Nomor rekening, VA, atau e-wallet wajib diisi.'
    }

    return ''
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }

    setError('')
    setEmailWarning(false)
    setSubmitting(true)

    const submittedAt = new Date()
    const trackingCode = makeTrackingCode(fundingType)
    const id = makeId(fundingType)
    const createdAt = submittedAt.toISOString()
    const amount = Number(form.amount.replace(/\D/g, ''))
    const year = submittedAt.getFullYear()
    const month = submittedAt.getMonth() + 1
    const monthKey = String(month).padStart(2, '0')
    const collection = fundingType === 'reimburse'
      ? 'public_reimburse'
      : 'public_purchase_request'
    const itemPath = `users/${USER_ID}/data/${collection}/${year}/${monthKey}/${id}`

    const record: Record<string, unknown> = {
      id,
      trackingCode,
      type: fundingType,
      source: 'public',
      name: form.name.trim(),
      email: form.email.trim().toLowerCase(),
      department: form.department.trim(),
      title: form.title.trim(),
      amount,
      category: form.category,
      description: form.description.trim(),
      status: 'pending',
      createdAt,
      year,
      month,
    }

    const destinationCompact = form.destinationAccount.replace(/\s+/g, '')
    const destinationMasked = destinationCompact
      ? `•••• ${destinationCompact.slice(-4)}`
      : ''

    if (fundingType === 'reimburse') {
      record.date = form.date
      record.attachmentData = attachment?.data || ''
      record.attachmentName = attachment?.name || ''
    } else {
      record.neededDate = form.date
      record.paymentMethodLabel = paymentMethodLabel(form.paymentMethod)
      record.providerName = form.providerName.trim()
      record.destinationMasked = destinationMasked
      if (form.notes.trim()) record.notes = form.notes.trim()
    }

    try {
      try {
        if (fundingType === 'purchase_request') {
          const privatePath = `users/${USER_ID}/data/public_purchase_request_private/${year}/${monthKey}/${id}`
          await update(ref(db), {
            [itemPath]: record,
            [privatePath]: {
              id,
              payeeName: form.payeeName.trim(),
              paymentMethod: form.paymentMethod,
              paymentMethodLabel: paymentMethodLabel(form.paymentMethod),
              providerName: form.providerName.trim(),
              destinationAccount: form.destinationAccount.trim(),
              attachmentData: attachment?.data || '',
              attachmentName: attachment?.name || '',
              createdAt,
            },
          })
        } else {
          await set(ref(db, itemPath), record)
        }
      } catch (firebaseError) {
        const message = firebaseError instanceof Error ? firebaseError.message : String(firebaseError || '')
        setError(message.toLowerCase().includes('permission_denied')
          ? 'Firebase menolak pengajuan publik. Publish Firebase Rules terbaru terlebih dahulu.'
          : `Data gagal disimpan ke Firebase: ${message || 'kesalahan tidak diketahui'}`)
        return
      }

      try {
        if (rememberApplicant) {
          const applicant: ApplicantProfile = {
            name: form.name.trim(),
            email: form.email.trim().toLowerCase(),
            department: form.department.trim(),
          }
          window.localStorage.setItem(APPLICANT_PROFILE_KEY, JSON.stringify(applicant))
          setProfileRestored(true)
        } else {
          window.localStorage.removeItem(APPLICANT_PROFILE_KEY)
        }
      } catch {
        // Local storage tidak boleh menggagalkan pengajuan.
      }

      try {
        await sendEmail(EMAILJS_TEMPLATE_CONFIRM, {
          to_email: form.email.trim().toLowerCase(),
          name: form.name.trim(),
          tracking_code: trackingCode,
          title: form.title.trim(),
          amount: `Rp ${amount.toLocaleString('id-ID')}`,
          date: form.date,
          type: fundingLabel(fundingType),
          status_url: `${window.location.origin}/reimburse/status?code=${trackingCode}`,
        })
      } catch (emailError) {
        console.warn('Email konfirmasi gagal terkirim:', emailError)
        setEmailWarning(true)
      }

      setSubmitted({
        trackingCode,
        email: form.email.trim().toLowerCase(),
        type: fundingType,
      })
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    const label = fundingLabel(submitted.type)
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-md w-full text-center">
          <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">{label} Terkirim!</h1>
          <p className="text-sm text-gray-500 mb-6">
            Pengajuan sudah tersimpan. Kode tracking ditujukan ke <strong>{submitted.email}</strong>.
          </p>
          <div className="bg-[#E1F5EE] rounded-xl p-4 mb-4">
            <div className="text-xs text-[#1B8A7A] font-semibold mb-1">KODE TRACKING</div>
            <div className="text-2xl font-bold text-[#1B8A7A] tracking-widest">{submitted.trackingCode}</div>
          </div>
          {emailWarning && (
            <div className="mb-4 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Data berhasil tersimpan, tetapi email konfirmasi gagal dikirim. Simpan kode tracking di atas.
            </div>
          )}
          <p className="text-xs text-gray-400 mb-4">
            Simpan kode ini untuk memeriksa status pengajuan.
          </p>
          <div className="space-y-2">
            <a
              href={`/reimburse/status?code=${submitted.trackingCode}`}
              className="block w-full py-2.5 bg-[#1B8A7A] text-white rounded-lg text-sm font-semibold hover:bg-[#0F6E56] transition-colors"
            >
              Cek Status Pengajuan
            </a>
            <button
              type="button"
              onClick={() => submitAnother(submitted.type)}
              className="block w-full py-2.5 border border-[#1B8A7A] text-[#1B8A7A] rounded-lg text-sm font-semibold hover:bg-[#E1F5EE] transition-colors"
            >
              Ajukan {label} Lagi
            </button>
            <button
              type="button"
              onClick={() => submitAnother(submitted.type === 'reimburse' ? 'purchase_request' : 'reimburse')}
              className="block w-full py-2 text-xs font-semibold text-gray-500 hover:text-[#1B8A7A]"
            >
              Ganti ke {submitted.type === 'reimburse' ? 'Purchase Request' : 'Reimburse'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  const isReimburse = fundingType === 'reimburse'

  return (
    <div className="min-h-screen py-8 px-4">
      <div className="max-w-lg mx-auto">
        <div className="text-center mb-7">
          <div className="w-12 h-12 bg-[#1B8A7A] rounded-xl flex items-center justify-center text-white font-bold text-lg mx-auto mb-3">
            Rp
          </div>
          <h1 className="text-xl font-bold text-gray-900">Form Pengajuan Dana</h1>
          <p className="text-sm text-gray-500 mt-1">Pilih jenis pengajuan, lalu lengkapi data yang dibutuhkan.</p>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <button
            type="button"
            onClick={() => switchType('reimburse')}
            className={`rounded-2xl border-2 p-4 text-left transition-all ${
              isReimburse
                ? 'border-[#1B8A7A] bg-[#E1F5EE] shadow-sm'
                : 'border-gray-100 bg-white hover:border-gray-200'
            }`}
          >
            <ReceiptText className={`w-6 h-6 mb-2 ${isReimburse ? 'text-[#1B8A7A]' : 'text-gray-400'}`} />
            <div className={`text-sm font-bold ${isReimburse ? 'text-[#0F6E56]' : 'text-gray-700'}`}>Reimburse</div>
            <div className="text-[11px] leading-relaxed text-gray-500 mt-1">Biaya sudah dibayar memakai uang pribadi.</div>
          </button>
          <button
            type="button"
            onClick={() => switchType('purchase_request')}
            className={`rounded-2xl border-2 p-4 text-left transition-all ${
              !isReimburse
                ? 'border-amber-500 bg-amber-50 shadow-sm'
                : 'border-gray-100 bg-white hover:border-gray-200'
            }`}
          >
            <ShoppingCart className={`w-6 h-6 mb-2 ${!isReimburse ? 'text-amber-600' : 'text-gray-400'}`} />
            <div className={`text-sm font-bold ${!isReimburse ? 'text-amber-700' : 'text-gray-700'}`}>Purchase Request</div>
            <div className="text-[11px] leading-relaxed text-gray-500 mt-1">Pembayaran belum dilakukan dan perlu dibayar perusahaan.</div>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
          <section>
            <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Data Pengaju</div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Nama Lengkap <span className="text-red-500">*</span></label>
                <input value={form.name} onChange={event => setField('name', event.target.value)} placeholder="Nama kamu" className={inputClass} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Email <span className="text-red-500">*</span></label>
                <input type="email" value={form.email} onChange={event => setField('email', event.target.value)} placeholder="email@perusahaan.com" className={inputClass} />
                <p className="text-[11px] text-gray-400 mt-1">Kode tracking dan pembaruan status dikirim ke email ini.</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Departemen / Tim</label>
                <input value={form.department} onChange={event => setField('department', event.target.value)} placeholder="Contoh: Marketing, Produksi, dll" className={inputClass} />
              </div>

              {profileRestored && (
                <div className="flex items-start justify-between gap-3 rounded-lg border border-[#BFE5DA] bg-[#F0FBF7] px-3 py-2.5">
                  <div>
                    <div className="text-xs font-semibold text-[#0F6E56]">Data pengaju terisi otomatis</div>
                    <div className="mt-0.5 text-[11px] leading-relaxed text-gray-500">Nama, email, dan departemen diambil dari pengajuan sebelumnya.</div>
                  </div>
                  <button type="button" onClick={clearSavedApplicant} className="shrink-0 text-[11px] font-semibold text-[#1B8A7A] hover:underline">
                    Gunakan data lain
                  </button>
                </div>
              )}

              <label className="flex cursor-pointer items-start gap-2 text-[11px] leading-relaxed text-gray-500">
                <input
                  type="checkbox"
                  checked={rememberApplicant}
                  onChange={event => setRememberApplicant(event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[#1B8A7A]"
                />
                <span>Ingat data pengaju di perangkat ini. Jangan dicentang jika memakai perangkat umum.</span>
              </label>
            </div>
          </section>

          <div className="border-t border-gray-100" />

          <section>
            <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
              {isReimburse ? 'Detail Pengeluaran' : 'Detail Purchase Request'}
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                  {isReimburse ? 'Judul Pengeluaran' : 'Nama Barang / Kebutuhan'} <span className="text-red-500">*</span>
                </label>
                <input
                  value={form.title}
                  onChange={event => setField('title', event.target.value)}
                  placeholder={isReimburse ? 'Contoh: Makan siang meeting klien' : 'Contoh: Pembelian SSD untuk komputer editing'}
                  className={inputClass}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Nominal <span className="text-red-500">*</span></label>
                  <input
                    value={form.amount ? rupiah(form.amount) : ''}
                    onChange={event => setField('amount', event.target.value.replace(/\D/g, ''))}
                    placeholder="Rp 0"
                    inputMode="numeric"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                    {isReimburse ? 'Tanggal Pengeluaran' : 'Batas Waktu Bayar'} <span className="text-red-500">*</span>
                  </label>
                  <input type="date" value={form.date} onChange={event => setField('date', event.target.value)} className={inputClass} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Kategori <span className="text-red-500">*</span></label>
                <select value={form.category} onChange={event => setField('category', event.target.value)} className={inputClass}>
                  <option value="">-- Pilih Kategori --</option>
                  {CATEGORIES.map(category => <option key={category} value={category}>{category}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Keterangan Detail <span className="text-red-500">*</span></label>
                <textarea
                  value={form.description}
                  onChange={event => setField('description', event.target.value)}
                  rows={3}
                  placeholder={isReimburse ? 'Jelaskan keperluan pengeluaran ini...' : 'Jelaskan alasan pembelian dan kebutuhan penggunaannya...'}
                  className={inputClass}
                />
              </div>
            </div>
          </section>

          {!isReimburse && (
            <>
              <div className="border-t border-gray-100" />
              <section>
                <div className="flex items-center gap-2 text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
                  <Landmark className="w-4 h-4" /> Tujuan Pembayaran
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">Nama Penerima <span className="text-red-500">*</span></label>
                    <input value={form.payeeName} onChange={event => setField('payeeName', event.target.value)} placeholder="Nama pemilik rekening atau nama perusahaan" className={inputClass} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-2">Metode Pembayaran <span className="text-red-500">*</span></label>
                    <div className="grid grid-cols-3 gap-2">
                      {PAYMENT_METHODS.map(method => {
                        const isSelected = form.paymentMethod === method.value
                        return (
                          <button
                            key={method.value}
                            type="button"
                            onClick={() => setField('paymentMethod', method.value)}
                            className={`py-2.5 px-2 rounded-xl border-2 text-xs font-semibold transition-all text-center ${
                              isSelected
                                ? 'border-[#1B8A7A] bg-[#1B8A7A]/10 text-[#1B8A7A]'
                                : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
                            }`}
                          >
                            {method.value === 'bank' ? '🏦 Transfer Bank' : method.value === 'virtual_account' ? '💳 Virtual Account' : '📱 E-Wallet'}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                        {form.paymentMethod === 'bank' ? 'Nama Bank' : form.paymentMethod === 'virtual_account' ? 'Penyedia VA / Bank' : 'Penyedia E-Wallet'} <span className="text-red-500">*</span>
                      </label>
                      <input value={form.providerName} onChange={event => setField('providerName', event.target.value)} placeholder={form.paymentMethod === 'bank' ? 'Contoh: BCA' : form.paymentMethod === 'virtual_account' ? 'Contoh: BNI' : 'Contoh: GoPay'} className={inputClass} />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                        {form.paymentMethod === 'bank' ? 'Nomor Rekening' : form.paymentMethod === 'virtual_account' ? 'Nomor Virtual Account' : 'Nomor E-Wallet'} <span className="text-red-500">*</span>
                      </label>
                      <input
                        value={form.destinationAccount}
                        onChange={event => setField('destinationAccount', event.target.value.replace(/[^0-9+\- ]/g, ''))}
                        placeholder="Masukkan nomor tujuan"
                        inputMode="numeric"
                        className={inputClass}
                      />
                    </div>
                  </div>
                  <p className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-[11px] leading-relaxed text-amber-700">
                    Pastikan nama penerima dan nomor tujuan sudah benar. Nomor lengkap hanya dapat dilihat admin dan akan disamarkan di halaman tracking publik.
                  </p>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">Keterangan Tambahan <span className="text-gray-400 font-normal">(opsional)</span></label>
                    <textarea
                      value={form.notes}
                      onChange={event => setField('notes', event.target.value)}
                      rows={2}
                      placeholder="Catatan tambahan untuk admin, misal: mohon transfer sebelum tgl 20..."
                      className={inputClass}
                    />
                  </div>
                </div>
              </section>
            </>
          )}

          <div className="border-t border-gray-100" />

          <section>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">
              {isReimburse ? 'Foto Nota / Bukti Pembayaran' : 'Invoice / Quotation / Tagihan'} <span className="text-red-500">*</span>
            </label>
            {attachment ? (
              <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-100 rounded-lg">
                <Paperclip className="w-4 h-4 text-green-600 flex-shrink-0" />
                <span className="text-xs text-green-700 flex-1 truncate">{attachment.name}</span>
                <button type="button" onClick={() => setAttachment(null)} className="text-gray-400 hover:text-red-500">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full py-4 border-2 border-dashed border-gray-200 rounded-xl text-sm text-gray-400 hover:border-[#1B8A7A] hover:text-[#1B8A7A] transition-colors flex flex-col items-center gap-2"
              >
                <Paperclip className="w-5 h-5" />
                <span>{isReimburse ? 'Klik untuk upload foto nota' : 'Klik untuk upload invoice atau tagihan'}</span>
                <span className="text-xs">JPG, PNG, PDF — PDF maks 3MB</span>
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,application/pdf" className="hidden" onChange={handleFile} />
          </section>

          {error && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className={`w-full py-3 disabled:opacity-60 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 ${
              isReimburse ? 'bg-[#1B8A7A] hover:bg-[#0F6E56]' : 'bg-amber-600 hover:bg-amber-700'
            }`}
          >
            {submitting
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Mengirim...</>
              : `Kirim Pengajuan ${fundingLabel(fundingType)}`}
          </button>
        </form>

        <p className="text-center text-xs text-gray-400 mt-4">
          Sudah punya kode tracking?{' '}
          <a href="/reimburse/status" className="text-[#1B8A7A] hover:underline font-medium">Cek status di sini</a>
        </p>
      </div>
    </div>
  )
}
