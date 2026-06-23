'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import { ref, onValue, off, set, get, update } from 'firebase/database'
import { db } from '@/lib/firebase'
import { Plus, X, Check, ChevronDown, Search, Paperclip, Trash2, Clock, CheckCircle, XCircle, Send, Globe, Download, Copy, Loader2, WalletCards } from 'lucide-react'

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
  if (!res.ok) throw new Error(`EmailJS: ${res.status}`)
}

const USER_ID = 'financebub-main'
const EMAILJS_SERVICE = 'service_financebub'
const EMAILJS_TEMPLATE_STATUS = 'template_hc5p4v6'
const EMAILJS_PUBLIC_KEY = 'Y-RzB4Z9zSXU1hp4H'

// Path helpers — subfolder per tahun/bulan
function prPath(year: number, month: number) {
  return `users/${USER_ID}/data/purchase_requests/${year}/${String(month).padStart(2, '0')}`
}
function prItemPath(year: number, month: number, id: string) {
  return `${prPath(year, month)}/${id}`
}
// Path lama (flat) — untuk cleanup
const PR_PATH_LEGACY = `users/${USER_ID}/data/purchase_requests`

// ─── Types ────────────────────────────────────────────────────────────────────

type PRType = 'purchase_request' | 'reimburse'
type PRStatus = 'pending' | 'approved' | 'rejected'

interface PurchaseRequest {
  id: string
  year: number
  month: number
  type: PRType
  title: string
  category: string
  amount: number
  neededDate: string
  description: string
  attachmentData?: string
  attachmentName?: string
  paidBy?: string
  status: PRStatus
  rejectedReason?: string
  createdBy: { uid: string; name: string }
  createdAt: string
  reviewedBy?: { uid: string; name: string }
  reviewedAt?: string
  comments?: Record<string, PRComment>
}

interface PRComment {
  id: string
  text: string
  createdBy: { uid: string; name: string }
  createdAt: string
}

type PublicFundingStatus = 'pending' | 'approved' | 'rejected' | 'transferred' | 'paid'
type PublicPaymentMethod = 'bank' | 'virtual_account' | 'ewallet'

interface PublicFundingRequest {
  id: string
  year: number
  month: number
  type: PRType
  trackingCode: string
  name: string
  email: string
  department?: string
  title: string
  amount: number
  category: string
  description: string
  date?: string
  neededDate?: string
  attachmentData?: string | null
  attachmentName?: string
  status: PublicFundingStatus
  rejectedReason?: string
  reviewedBy?: { uid: string; name: string }
  reviewedAt?: string
  transferredBy?: { uid: string; name: string }
  transferredAt?: string
  payeeName?: string
  paymentMethod?: PublicPaymentMethod
  paymentMethodLabel?: string
  providerName?: string
  destinationAccount?: string
  destinationMasked?: string
  paidBy?: { uid: string; name: string }
  paidAt?: string
  paidAmount?: number
  paymentNote?: string
  paymentProofData?: string
  paymentProofName?: string
  createdAt: string
}

const CATEGORIES = [
  'Operasional', 'Transport', 'Produksi', 'Marketing', 'Makan & Minum',
  'Perlengkapan Kantor', 'Software & Langganan', 'Lainnya',
]

const MONTHS = [
  'Januari','Februari','Maret','April','Mei','Juni',
  'Juli','Agustus','September','Oktober','November','Desember',
]

const STATUS_LABEL: Record<PRStatus, string> = {
  pending: 'Menunggu',
  approved: 'Disetujui',
  rejected: 'Ditolak',
}
const STATUS_STYLE: Record<PRStatus, string> = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-600',
}
const TYPE_LABEL: Record<PRType, string> = {
  purchase_request: '🛒 Purchase Request',
  reimburse: '🧾 Reimburse',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeId() { return `pr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` }
function makeCommentId() { return `c_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` }
function rupiah(n: number) { return n.toLocaleString('id-ID') }
function fmtDate(d: string) {
  if (!d) return '-'
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}
function todayISO() { return new Date().toISOString().slice(0, 10) }

function publicCollection(type: PRType) {
  return type === 'purchase_request' ? 'public_purchase_request' : 'public_reimburse'
}

function publicItemPath(pr: PublicFundingRequest) {
  return `users/${USER_ID}/data/${publicCollection(pr.type)}/${pr.year}/${String(pr.month).padStart(2, '0')}/${pr.id}`
}

function publicPrivateItemPath(pr: PublicFundingRequest) {
  return `users/${USER_ID}/data/public_purchase_request_private/${pr.year}/${String(pr.month).padStart(2, '0')}/${pr.id}`
}

function publicSafeRecord(pr: PublicFundingRequest) {
  if (pr.type !== 'purchase_request') return pr

  const {
    destinationAccount,
    payeeName,
    paymentMethod,
    attachmentData,
    attachmentName,
    paymentProofData,
    paymentProofName,
    ...safe
  } = pr

  void destinationAccount
  void payeeName
  void paymentMethod
  void attachmentData
  void attachmentName
  void paymentProofData
  void paymentProofName

  return safe
}

function publicPrivateRecord(pr: PublicFundingRequest) {
  return {
    id: pr.id,
    payeeName: pr.payeeName || '',
    paymentMethod: pr.paymentMethod || 'bank',
    paymentMethodLabel: pr.paymentMethodLabel || '',
    providerName: pr.providerName || '',
    destinationAccount: pr.destinationAccount || '',
    attachmentData: pr.attachmentData || null,
    attachmentName: pr.attachmentName || '',
    paymentProofData: pr.paymentProofData || null,
    paymentProofName: pr.paymentProofName || '',
    paymentNote: pr.paymentNote || '',
    paidAmount: pr.paidAmount || null,
    paidAt: pr.paidAt || '',
    createdAt: pr.createdAt,
  }
}

async function savePublicFundingRequest(pr: PublicFundingRequest) {
  if (pr.type === 'purchase_request') {
    await update(ref(db), {
      [publicItemPath(pr)]: publicSafeRecord(pr),
      [publicPrivateItemPath(pr)]: publicPrivateRecord(pr),
    })
    return
  }
  await set(ref(db, publicItemPath(pr)), pr)
}

async function deletePublicFundingRequest(pr: PublicFundingRequest) {
  if (pr.type === 'purchase_request') {
    await update(ref(db), {
      [publicItemPath(pr)]: null,
      [publicPrivateItemPath(pr)]: null,
    })
    return
  }
  await set(ref(db, publicItemPath(pr)), null)
}

function publicDate(pr: PublicFundingRequest) {
  return pr.type === 'purchase_request' ? pr.neededDate || '' : pr.date || ''
}

function publicStatusLabel(pr: PublicFundingRequest) {
  if (pr.status === 'rejected') return 'Ditolak'
  if (pr.status === 'transferred') return 'Sudah Ditransfer'
  if (pr.status === 'paid') return 'Sudah Dibayar'
  if (pr.status === 'approved') return pr.type === 'purchase_request' ? 'Disetujui · Menunggu Bayar' : 'Disetujui'
  return 'Menunggu'
}

function publicStatusStyle(status: PublicFundingStatus) {
  if (status === 'rejected') return 'bg-red-100 text-red-600'
  if (status === 'transferred' || status === 'paid') return 'bg-blue-100 text-blue-700'
  if (status === 'approved') return 'bg-green-100 text-green-700'
  return 'bg-amber-100 text-amber-700'
}

function publicIcon(status: PublicFundingStatus) {
  if (status === 'rejected') return <XCircle className="w-5 h-5 text-red-500" />
  if (status === 'transferred' || status === 'paid') return <CheckCircle className="w-5 h-5 text-blue-600" />
  if (status === 'approved') return <CheckCircle className="w-5 h-5 text-green-600" />
  return <Clock className="w-5 h-5 text-amber-500" />
}

function publicIconBg(status: PublicFundingStatus) {
  if (status === 'rejected') return 'bg-red-100'
  if (status === 'transferred' || status === 'paid') return 'bg-blue-100'
  if (status === 'approved') return 'bg-green-100'
  return 'bg-amber-100'
}

// ─── Firebase helpers ─────────────────────────────────────────────────────────

async function saveRequest(pr: PurchaseRequest) {
  await set(ref(db, prItemPath(pr.year, pr.month, pr.id)), pr)
}

async function deleteRequest(pr: PurchaseRequest) {
  await set(ref(db, prItemPath(pr.year, pr.month, pr.id)), null)
}

async function saveComment(pr: PurchaseRequest, comment: PRComment) {
  await set(ref(db, `${prItemPath(pr.year, pr.month, pr.id)}/comments/${comment.id}`), comment)
}

async function deleteComment(pr: PurchaseRequest, commentId: string) {
  await set(ref(db, `${prItemPath(pr.year, pr.month, pr.id)}/comments/${commentId}`), null)
}

// Hapus data lama (flat path) — jalankan sekali saat mount
async function cleanupLegacyData() {
  try {
    const snap = await get(ref(db, PR_PATH_LEGACY))
    if (!snap.exists()) return
    const val = snap.val()
    // Cek apakah ada data flat (bukan subfolder tahun)
    // Data flat punya field 'id', subfolder tahun berisi object dengan key angka
    const hasFlat = Object.values(val).some((v: any) => typeof v === 'object' && v?.id && v?.title)
    if (hasFlat) {
      // Hapus semua data lama flat
      await set(ref(db, PR_PATH_LEGACY), null)
    }
  } catch { /* silent */ }
}

function subscribeRequests(
  year: number,
  month: number,
  cb: (list: PurchaseRequest[]) => void
) {
  const dbRef = ref(db, prPath(year, month))
  const handler = (snap: any) => {
    if (!snap.exists()) { cb([]); return }
    const val = snap.val()
    const list = (Object.values(val) as PurchaseRequest[])
      .filter(x => x?.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    cb(list)
  }
  onValue(dbRef, handler)
  return () => off(dbRef, 'value', handler)
}

// ─── Form Modal ───────────────────────────────────────────────────────────────

function FormModal({
  existing, onClose, onSave, currentUser, defaultYear, defaultMonth,
}: {
  existing: PurchaseRequest | null
  onClose: () => void
  onSave: (pr: PurchaseRequest) => Promise<void>
  currentUser: { uid: string; name: string }
  defaultYear: number
  defaultMonth: number
}) {
  const isEdit = !!existing
  const [type, setType] = useState<PRType>(existing?.type || 'purchase_request')
  const [title, setTitle] = useState(existing?.title || '')
  const [category, setCategory] = useState(existing?.category || '')
  const [amount, setAmount] = useState(existing?.amount ? String(existing.amount) : '')
  const [neededDate, setNeededDate] = useState(existing?.neededDate || todayISO())
  const [description, setDescription] = useState(existing?.description || '')
  const [paidBy, setPaidBy] = useState(existing?.paidBy || '')
  const [attachmentData, setAttachmentData] = useState(existing?.attachmentData || '')
  const [attachmentName, setAttachmentName] = useState(existing?.attachmentName || '')
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A] bg-white'

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 3 * 1024 * 1024) { alert('Ukuran file maksimal 3MB'); return }
    const reader = new FileReader()
    reader.onload = () => { setAttachmentData(String(reader.result || '')); setAttachmentName(file.name) }
    reader.readAsDataURL(file)
  }

  const handleSave = async () => {
    if (!title.trim()) { alert('Judul wajib diisi'); return }
    if (!category) { alert('Kategori wajib dipilih'); return }
    if (!amount || isNaN(Number(amount.replace(/\D/g, '')))) { alert('Nominal wajib diisi'); return }
    if (!neededDate) { alert('Tanggal dibutuhkan wajib diisi'); return }
    if (!description.trim()) { alert('Keterangan wajib diisi'); return }
    if (type === 'reimburse' && !paidBy.trim()) { alert('Field "Dibayar oleh" wajib diisi untuk Reimburse'); return }

    setSaving(true)
    try {
      const now = new Date()
      const pr: PurchaseRequest = {
        id: existing?.id || makeId(),
        year: existing?.year || defaultYear,
        month: existing?.month || defaultMonth,
        type,
        title: title.trim(),
        category,
        amount: Number(amount.replace(/\D/g, '')),
        neededDate,
        description: description.trim(),
        ...(attachmentData ? { attachmentData, attachmentName } : {}),
        ...(type === 'reimburse' ? { paidBy: paidBy.trim() } : {}),
        status: existing?.status || 'pending',
        createdBy: existing?.createdBy || currentUser,
        createdAt: existing?.createdAt || now.toISOString(),
        ...(existing?.rejectedReason ? { rejectedReason: existing.rejectedReason } : {}),
        ...(existing?.reviewedBy ? { reviewedBy: existing.reviewedBy, reviewedAt: existing.reviewedAt } : {}),
        ...(existing?.comments ? { comments: existing.comments } : {}),
      }
      await onSave(pr)
      onClose()
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-bold text-gray-900">{isEdit ? 'Edit Pengajuan' : 'Buat Pengajuan Baru'}</h2>
          <button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-400"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Tipe */}
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1.5 block">Tipe Pengajuan <span className="text-red-500">*</span></label>
            <div className="grid grid-cols-2 gap-2">
              {(['purchase_request', 'reimburse'] as PRType[]).map(t => (
                <button key={t} type="button" onClick={() => setType(t)}
                  className={`py-2.5 px-3 rounded-xl text-xs font-semibold border-2 transition-all ${type === t ? 'border-[#1B8A7A] bg-[#E1F5EE] text-[#1B8A7A]' : 'border-gray-100 text-gray-500 hover:border-gray-200'}`}>
                  {TYPE_LABEL[t]}
                </button>
              ))}
            </div>
            {type === 'reimburse' && <p className="mt-1.5 text-[11px] text-amber-600">Reimburse = pengeluaran sudah terjadi, minta penggantian dana.</p>}
          </div>

          {/* Judul */}
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1.5 block">Judul <span className="text-red-500">*</span></label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Contoh: Beli kertas A3 untuk printing" className={inp} />
          </div>

          {/* Kategori & Nominal */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1.5 block">Kategori <span className="text-red-500">*</span></label>
              <select value={category} onChange={e => setCategory(e.target.value)} className={inp}>
                <option value="">-- Pilih --</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1.5 block">Nominal (Rp) <span className="text-red-500">*</span></label>
              <input
                value={amount ? `Rp ${Number(amount.replace(/\D/g, '')).toLocaleString('id-ID')}` : ''}
                onChange={e => setAmount(e.target.value.replace(/\D/g, ''))}
                placeholder="0" className={inp} />
            </div>
          </div>

          {/* Tanggal */}
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1.5 block">
              {type === 'reimburse' ? 'Tanggal Pengeluaran' : 'Tanggal Dibutuhkan'} <span className="text-red-500">*</span>
            </label>
            <input type="date" value={neededDate} onChange={e => setNeededDate(e.target.value)} className={inp} />
          </div>

          {/* Dibayar oleh */}
          {type === 'reimburse' && (
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1.5 block">Dibayar oleh <span className="text-red-500">*</span></label>
              <input value={paidBy} onChange={e => setPaidBy(e.target.value)} placeholder="Nama orang yang sudah bayar duluan" className={inp} />
            </div>
          )}

          {/* Keterangan */}
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1.5 block">Keterangan <span className="text-red-500">*</span></label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
              placeholder={type === 'reimburse' ? 'Detail pengeluaran, untuk keperluan apa...' : 'Detail kebutuhan, alasan pembelian...'}
              className={inp} />
          </div>

          {/* Lampiran */}
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1.5 block">
              Lampiran Foto/Nota
              {type === 'reimburse' ? <span className="text-red-500"> *</span> : <span className="text-gray-400 font-normal"> (opsional)</span>}
            </label>
            {attachmentData ? (
              <div className="flex items-center gap-2 p-2.5 bg-gray-50 rounded-lg border border-gray-200">
                <Paperclip className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <span className="text-xs text-gray-600 flex-1 truncate">{attachmentName}</span>
                <button type="button" onClick={() => { setAttachmentData(''); setAttachmentName('') }} className="text-gray-400 hover:text-red-500"><X className="w-3.5 h-3.5" /></button>
              </div>
            ) : (
              <button type="button" onClick={() => fileRef.current?.click()}
                className="w-full py-2.5 border-2 border-dashed border-gray-200 rounded-xl text-xs text-gray-400 hover:border-[#1B8A7A] hover:text-[#1B8A7A] transition-colors flex items-center justify-center gap-2">
                <Paperclip className="w-4 h-4" />
                Klik untuk upload foto/nota (maks 3MB)
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={handleFile} />
          </div>
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-50">Batal</button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#1B8A7A] hover:bg-[#0F6E56] text-white text-sm font-semibold rounded-lg disabled:opacity-60">
            <Check className="w-3.5 h-3.5" />
            {saving ? 'Menyimpan...' : isEdit ? 'Simpan Perubahan' : 'Kirim Pengajuan'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Reject Modal ─────────────────────────────────────────────────────────────

function RejectModal({ onConfirm, onClose }: { onConfirm: (reason: string) => Promise<void>; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const handleConfirm = async () => {
    if (!reason.trim()) { alert('Alasan wajib diisi'); return }
    setSaving(true)
    try { await onConfirm(reason.trim()) } finally { setSaving(false) }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5">
        <h2 className="text-sm font-bold text-gray-900 mb-3">Alasan Penolakan</h2>
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
          placeholder="Tulis alasan penolakan..." autoFocus
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-red-400 mb-4" />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 text-sm text-gray-500 hover:bg-gray-50 rounded-lg">Batal</button>
          <button onClick={handleConfirm} disabled={saving}
            className="px-4 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white text-sm font-semibold rounded-lg">
            {saving ? 'Menyimpan...' : 'Tolak Pengajuan'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Payment Modal ──────────────────────────────────────────────────────────

function PaymentModal({
  request,
  onConfirm,
  onClose,
}: {
  request: PublicFundingRequest
  onConfirm: (payment: {
    paidAt: string
    paidAmount: number
    paymentNote: string
    paymentProofData: string
    paymentProofName: string
  }) => Promise<void>
  onClose: () => void
}) {
  const [paidAt, setPaidAt] = useState(todayISO())
  const [paidAmount, setPaidAmount] = useState(String(request.amount || ''))
  const [paymentNote, setPaymentNote] = useState('')
  const [paymentProofData, setPaymentProofData] = useState('')
  const [paymentProofName, setPaymentProofName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setError('')

    if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
      setError('Bukti pembayaran harus berupa JPG, PNG, atau PDF.')
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
            setError('Gambar tidak dapat diproses.')
            return
          }
          context.drawImage(image, 0, 0, width, height)
          setPaymentProofData(canvas.toDataURL('image/jpeg', 0.7))
          setPaymentProofName(file.name.replace(/\.[^.]+$/, '.jpg'))
        }
        image.onerror = () => setError('Gambar tidak dapat dibaca.')
        image.src = String(loadEvent.target?.result || '')
      }
      reader.readAsDataURL(file)
      return
    }

    if (file.size > 3 * 1024 * 1024) {
      setError('PDF maksimal 3MB.')
      event.target.value = ''
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setPaymentProofData(String(reader.result || ''))
      setPaymentProofName(file.name)
    }
    reader.readAsDataURL(file)
  }

  const handleConfirm = async () => {
    const amount = Number(paidAmount.replace(/\D/g, ''))
    if (!paidAt) { setError('Tanggal pembayaran wajib diisi.'); return }
    if (!amount) { setError('Nominal dibayar wajib diisi.'); return }
    if (!paymentProofData) { setError('Bukti pembayaran wajib diunggah.'); return }

    setSaving(true)
    setError('')
    try {
      await onConfirm({
        paidAt,
        paidAmount: amount,
        paymentNote: paymentNote.trim(),
        paymentProofData,
        paymentProofName,
      })
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : 'Pembayaran gagal disimpan.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-sm font-bold text-gray-900">Tandai Sudah Dibayar</h2>
            <p className="text-[11px] text-gray-400 mt-0.5">{request.title}</p>
          </div>
          <button type="button" onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs text-amber-700">
            Transfer ke <strong>{request.providerName || request.paymentMethodLabel}</strong> · {request.payeeName}<br />
            <span className="font-mono font-bold">{request.destinationAccount}</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1.5 block">Tanggal Pembayaran *</label>
              <input type="date" value={paidAt} onChange={event => setPaidAt(event.target.value)} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A]" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1.5 block">Nominal Dibayar *</label>
              <input
                value={paidAmount ? `Rp ${Number(paidAmount.replace(/\D/g, '')).toLocaleString('id-ID')}` : ''}
                onChange={event => setPaidAmount(event.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A]"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1.5 block">Catatan Pembayaran</label>
            <textarea value={paymentNote} onChange={event => setPaymentNote(event.target.value)} rows={3} placeholder="Contoh: Dibayar via mobile banking BCA" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A]" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 mb-1.5 block">Bukti Transfer / Pembayaran *</label>
            {paymentProofData ? (
              <div className="flex items-center gap-2 rounded-lg border border-green-100 bg-green-50 p-3">
                <Paperclip className="w-4 h-4 text-green-600" />
                <span className="flex-1 truncate text-xs text-green-700">{paymentProofName}</span>
                <button type="button" onClick={() => { setPaymentProofData(''); setPaymentProofName('') }} className="text-gray-400 hover:text-red-500">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => fileRef.current?.click()} className="w-full rounded-xl border-2 border-dashed border-gray-200 py-4 text-xs text-gray-400 hover:border-[#1B8A7A] hover:text-[#1B8A7A]">
                Upload bukti transfer (JPG, PNG, PDF)
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,application/pdf" className="hidden" onChange={handleFile} />
          </div>
          {error && <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4">
          <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 text-sm text-gray-500 hover:bg-gray-50 rounded-lg">Batal</button>
          <button type="button" onClick={handleConfirm} disabled={saving} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <WalletCards className="w-4 h-4" />}
            {saving ? 'Menyimpan...' : 'Simpan Pembayaran'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Chat Section ─────────────────────────────────────────────────────────────

function ChatSection({ pr, currentUser }: { pr: PurchaseRequest; currentUser: { uid: string; name: string } }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const comments = pr.comments
    ? Object.values(pr.comments).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    : []

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [comments.length])

  const handleSend = async () => {
    const trimmed = text.trim()
    if (!trimmed) return
    setSending(true)
    try {
      await saveComment(pr, { id: makeCommentId(), text: trimmed, createdBy: currentUser, createdAt: new Date().toISOString() })
      setText('')
    } finally { setSending(false) }
  }

  function timeAgo(iso: string) {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
    if (diff < 60) return 'baru saja'
    if (diff < 3600) return `${Math.floor(diff / 60)} mnt lalu`
    if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`
    return fmtDate(iso.slice(0, 10))
  }

  return (
    <div className="border-t border-gray-100 pt-3 mt-1">
      <div className="text-[10px] font-semibold text-gray-400 mb-2">DISKUSI</div>
      {comments.length === 0
        ? <div className="text-xs text-gray-300 text-center py-3">Belum ada komentar</div>
        : (
          <div className="space-y-2 mb-3 max-h-56 overflow-y-auto pr-1">
            {comments.map(c => {
              const isMe = c.createdBy.uid === currentUser.uid
              return (
                <div key={c.id} className={`flex gap-2 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                  <div className="w-6 h-6 rounded-full bg-[#1B8A7A] flex-shrink-0 flex items-center justify-center text-white text-[9px] font-bold">
                    {c.createdBy.name.charAt(0).toUpperCase()}
                  </div>
                  <div className={`group max-w-[75%] ${isMe ? 'items-end' : 'items-start'} flex flex-col`}>
                    <div className={`px-3 py-2 rounded-2xl text-xs leading-relaxed ${isMe ? 'bg-[#1B8A7A] text-white rounded-tr-sm' : 'bg-gray-100 text-gray-800 rounded-tl-sm'}`}>
                      {!isMe && <div className="text-[10px] font-semibold mb-0.5 opacity-70">{c.createdBy.name}</div>}
                      <span className="whitespace-pre-wrap">{c.text}</span>
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="text-[9px] text-gray-400">{timeAgo(c.createdAt)}</span>
                      {isMe && (
                        <button onClick={() => deleteComment(pr, c.id)} className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-300 hover:text-red-400">
                          <X className="w-2.5 h-2.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>
        )
      }
      <div className="flex items-end gap-2">
        <textarea value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
          placeholder="Tulis komentar... (Enter untuk kirim)" rows={1}
          className="flex-1 px-3 py-2 text-xs border border-gray-200 rounded-xl outline-none focus:border-[#1B8A7A] resize-none leading-relaxed"
          style={{ minHeight: '36px', maxHeight: '96px' }} />
        <button onClick={handleSend} disabled={sending || !text.trim()}
          className="flex-shrink-0 w-9 h-9 bg-[#1B8A7A] hover:bg-[#0F6E56] disabled:opacity-40 text-white rounded-xl flex items-center justify-center transition-colors">
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PengajuanPage() {
  const { user } = useAuth()
  const isAdmin = user?.role?.toLowerCase() === 'admin'
  const now = new Date()

  const [mainTab, setMainTab] = useState<'all' | 'internal' | 'public'>('all')
  const [requests, setRequests] = useState<PurchaseRequest[]>([])
  const [publicRequests, setPublicRequests] = useState<PublicFundingRequest[]>([])
  const [loadingPublic, setLoadingPublic] = useState(false)
  const [rejectingPublicId, setRejectingPublicId] = useState<string | null>(null)
  const [downloadedIds, setDownloadedIds] = useState<Record<string, boolean>>({})
  const [verifiedPublicIds, setVerifiedPublicIds] = useState<Record<string, boolean>>({})
  const [payingPublicId, setPayingPublicId] = useState<string | null>(null)
  const [publicTypeFilter, setPublicTypeFilter] = useState<PRType | 'all'>('all')

  const [viewYear, setViewYear] = useState(now.getFullYear())
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingPR, setEditingPR] = useState<PurchaseRequest | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<PRStatus | 'all'>('all')
  const [filterType, setFilterType] = useState<PRType | 'all'>('all')

  // Cleanup data lama saat pertama mount
  useEffect(() => { cleanupLegacyData() }, [])

  // Subscribe bulan yang dipilih
  useEffect(() => {
    setLoading(true)
    setRequests([])
    const unsub = subscribeRequests(viewYear, viewMonth, list => {
      setRequests(list)
      setLoading(false)
    })
    return unsub
  }, [viewYear, viewMonth])

  const handleSave = async (pr: PurchaseRequest) => { await saveRequest(pr) }

  const handleApprove = async (pr: PurchaseRequest) => {
    if (!confirm(`ACC pengajuan "${pr.title}"?`)) return
    await saveRequest({ ...pr, status: 'approved', reviewedBy: { uid: user!.uid, name: user!.name }, reviewedAt: new Date().toISOString() })
  }

  const handleReject = async (pr: PurchaseRequest, reason: string) => {
    await saveRequest({ ...pr, status: 'rejected', rejectedReason: reason, reviewedBy: { uid: user!.uid, name: user!.name }, reviewedAt: new Date().toISOString() })
    setRejectingId(null)
  }

  const handleDelete = async (pr: PurchaseRequest) => {
    if (!confirm(`Hapus pengajuan "${pr.title}"?\nTindakan ini tidak bisa dibatalkan.`)) return
    await deleteRequest(pr)
    setExpandedId(null)
  }

  // ── Public Funding Requests ───────────────────────────────────────────────
  const loadPublicFunding = useCallback(async () => {
    setLoadingPublic(true)
    try {
      const monthKey = String(viewMonth).padStart(2, '0')
      const [reimburseSnapshot, purchaseSnapshot, purchasePrivateSnapshot] = await Promise.all([
        get(ref(db, `users/${USER_ID}/data/public_reimburse/${viewYear}/${monthKey}`)),
        get(ref(db, `users/${USER_ID}/data/public_purchase_request/${viewYear}/${monthKey}`)),
        get(ref(db, `users/${USER_ID}/data/public_purchase_request_private/${viewYear}/${monthKey}`)),
      ])

      const reimburse = reimburseSnapshot.exists()
        ? Object.entries(reimburseSnapshot.val() as Record<string, unknown>).flatMap(([id, value]) => {
            if (!value || typeof value !== 'object') return []
            const record = value as Partial<PublicFundingRequest>
            if (!record.trackingCode) return []
            return [{ ...record, id: record.id || id, type: 'reimburse' as const } as PublicFundingRequest]
          })
        : []

      const privateRecords = purchasePrivateSnapshot.exists()
        ? purchasePrivateSnapshot.val() as Record<string, Partial<PublicFundingRequest>>
        : {}

      const purchaseRequests = purchaseSnapshot.exists()
        ? Object.entries(purchaseSnapshot.val() as Record<string, unknown>).flatMap(([id, value]) => {
            if (!value || typeof value !== 'object') return []
            const record = value as Partial<PublicFundingRequest>
            if (!record.trackingCode) return []
            return [{
              ...record,
              ...(privateRecords[id] || {}),
              id: record.id || id,
              type: 'purchase_request' as const,
            } as PublicFundingRequest]
          })
        : []

      setPublicRequests([...reimburse, ...purchaseRequests]
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))))
    } finally {
      setLoadingPublic(false)
    }
  }, [viewMonth, viewYear])

  useEffect(() => {
    if (mainTab === 'public' || mainTab === 'all') loadPublicFunding()
  }, [mainTab, loadPublicFunding])

  const sendPublicStatusEmail = async (
    request: PublicFundingRequest,
    status: string,
    reason: string,
  ) => {
    try {
      await sendEmail(EMAILJS_TEMPLATE_STATUS, {
        to_email: request.email,
        name: request.name,
        tracking_code: request.trackingCode,
        title: request.title,
        amount: `Rp ${request.amount.toLocaleString('id-ID')}`,
        status,
        reason,
        type: request.type === 'purchase_request' ? 'Purchase Request' : 'Reimburse',
        status_url: `${window.location.origin}/reimburse/status?code=${request.trackingCode}`,
      })
    } catch (emailError) {
      console.warn('Email status pengajuan publik gagal:', emailError)
    }
  }

  const handleApprovePublic = async (request: PublicFundingRequest) => {
    const label = request.type === 'purchase_request' ? 'purchase request' : 'reimburse'
    if (!confirm(`ACC ${label} "${request.title}"?`)) return

    const updated: PublicFundingRequest = {
      ...request,
      status: 'approved',
      reviewedBy: { uid: user!.uid, name: user!.name },
      reviewedAt: new Date().toISOString(),
      ...(request.type === 'reimburse' ? { attachmentData: null } : {}),
    }
    await savePublicFundingRequest(updated)

    await sendPublicStatusEmail(
      request,
      request.type === 'purchase_request'
        ? 'Disetujui — Menunggu Pembayaran ✅'
        : 'Disetujui ✅',
      request.type === 'purchase_request'
        ? 'Pengajuan telah disetujui dan sedang menunggu proses pembayaran.'
        : '',
    )
    loadPublicFunding()
  }

  const handleRejectPublic = async (request: PublicFundingRequest, reason: string) => {
    const updated: PublicFundingRequest = {
      ...request,
      status: 'rejected',
      rejectedReason: reason,
      reviewedBy: { uid: user!.uid, name: user!.name },
      reviewedAt: new Date().toISOString(),
      attachmentData: null,
    }
    await savePublicFundingRequest(updated)
    await sendPublicStatusEmail(request, 'Ditolak ❌', `Alasan: ${reason}`)
    setRejectingPublicId(null)
    loadPublicFunding()
  }

  const handleDeletePublic = async (request: PublicFundingRequest) => {
    if (!confirm(`Hapus pengajuan "${request.title}"?`)) return
    await deletePublicFundingRequest(request)
    loadPublicFunding()
  }

  const handleTransferPublic = async (request: PublicFundingRequest) => {
    if (!confirm(`Tandai "${request.title}" sudah ditransfer?`)) return
    const updated: PublicFundingRequest = {
      ...request,
      status: 'transferred',
      transferredBy: { uid: user!.uid, name: user!.name },
      transferredAt: new Date().toISOString(),
    }
    await savePublicFundingRequest(updated)
    await sendPublicStatusEmail(
      request,
      'Sudah Ditransfer 💸',
      'Dana reimburse sudah ditransfer ke rekening pengaju.',
    )
    loadPublicFunding()
  }

  const handlePaidPublic = async (
    request: PublicFundingRequest,
    payment: {
      paidAt: string
      paidAmount: number
      paymentNote: string
      paymentProofData: string
      paymentProofName: string
    },
  ) => {
    const updated: PublicFundingRequest = {
      ...request,
      status: 'paid',
      paidBy: { uid: user!.uid, name: user!.name },
      ...payment,
      attachmentData: null,
    }
    await savePublicFundingRequest(updated)
    await sendPublicStatusEmail(
      request,
      'Sudah Dibayar 💸',
      `Purchase Request sudah dibayar sebesar Rp ${payment.paidAmount.toLocaleString('id-ID')}.`,
    )
    setPayingPublicId(null)
    loadPublicFunding()
  }

  const copyDestination = async (request: PublicFundingRequest) => {
    try {
      await navigator.clipboard.writeText(request.destinationAccount || '')
      alert('Nomor tujuan berhasil disalin.')
    } catch {
      alert(`Salin nomor ini secara manual: ${request.destinationAccount || '-'}`)
    }
  }

  const filtered = requests.filter(pr => {
    if (filterStatus !== 'all' && pr.status !== filterStatus) return false
    if (filterType !== 'all' && pr.type !== filterType) return false
    if (search) {
      const q = search.toLowerCase()
      return pr.title.toLowerCase().includes(q) ||
        pr.category.toLowerCase().includes(q) ||
        pr.createdBy.name.toLowerCase().includes(q) ||
        pr.description.toLowerCase().includes(q)
    }
    return true
  })

  const counts = {
    all: requests.length,
    pending: requests.filter(r => r.status === 'pending').length,
    approved: requests.filter(r => r.status === 'approved').length,
    rejected: requests.filter(r => r.status === 'rejected').length,
  }

  // Gabungan internal + publik, diurutkan by tanggal terbaru (untuk tab Semua)
  const mergedAll = [
    ...filtered.map(r => ({ ...r, _source: 'internal' as const })),
    ...publicRequests.map(r => ({ ...r, _source: 'public' as const })),
  ].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))


  const visiblePublicRequests = publicRequests.filter(request =>
    publicTypeFilter === 'all' || request.type === publicTypeFilter
  )

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Pengajuan Pengeluaran</h1>
          <p className="text-xs text-gray-400 mt-0.5">Purchase Request & Reimburse</p>
        </div>
        {mainTab === 'internal' && (
          <button onClick={() => { setEditingPR(null); setShowForm(true) }}
            className="flex items-center gap-1.5 px-3 py-2 bg-[#1B8A7A] hover:bg-[#0F6E56] text-white text-sm font-semibold rounded-lg transition-colors">
            <Plus className="w-4 h-4" /> Buat Pengajuan
          </button>
        )}
      </div>

      {/* Main Tab */}
      <div className="flex items-center gap-2 mb-5 border-b border-gray-100 pb-0">
        <button onClick={() => setMainTab('all')}
          className={`pb-3 px-1 text-sm font-semibold border-b-2 transition-all ${mainTab === 'all' ? 'border-[#1B8A7A] text-[#1B8A7A]' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
          Semua
        </button>
        <button onClick={() => setMainTab('internal')}
          className={`pb-3 px-1 text-sm font-semibold border-b-2 transition-all ${mainTab === 'internal' ? 'border-[#1B8A7A] text-[#1B8A7A]' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
          Internal
        </button>
        <button onClick={() => setMainTab('public')}
          className={`pb-3 px-1 text-sm font-semibold border-b-2 transition-all flex items-center gap-1.5 ${mainTab === 'public' ? 'border-[#1B8A7A] text-[#1B8A7A]' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
          <Globe className="w-3.5 h-3.5" /> Pengajuan Publik
          {publicRequests.filter(r => r.status === 'pending').length > 0 && (
            <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
              {publicRequests.filter(r => r.status === 'pending').length}
            </span>
          )}
        </button>
      </div>

      {/* TAB SEMUA — gabungan internal + publik urut tanggal */}
      {mainTab === 'all' && (
        <div>
          {/* Filter Tahun & Bulan */}
          <div className="flex items-center gap-2 mb-4">
            <select value={viewYear} onChange={e => setViewYear(Number(e.target.value))}
              className="px-3 py-2 text-sm font-semibold border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A] bg-white text-gray-700">
              {Array.from({ length: 8 }, (_, i) => now.getFullYear() + 1 - i).map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <select value={viewMonth} onChange={e => setViewMonth(Number(e.target.value))}
              className="flex-1 px-3 py-2 text-sm font-semibold border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A] bg-white text-gray-700">
              {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </select>
            {viewYear === now.getFullYear() && viewMonth === now.getMonth() + 1 && (
              <span className="text-[11px] text-[#1B8A7A] font-semibold bg-[#E1F5EE] px-2.5 py-1 rounded-full whitespace-nowrap">Bulan ini</span>
            )}
          </div>
          <div className="space-y-3">
          {mergedAll.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <div className="text-4xl mb-3">📋</div>
              <div className="text-sm">Belum ada pengajuan</div>
            </div>
          ) : mergedAll.map((item: any) => {
            if (item._source === 'public') {
              const pr = item as PublicFundingRequest & { _source: 'public' }
              return (
                <div key={`pub-${pr.type}-${pr.id}`} className="bg-white rounded-xl border border-gray-100 hover:shadow-sm transition-all">
                  <div className="flex items-start gap-3 p-4">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${publicIconBg(pr.status)}`}>
                      {publicIcon(pr.status)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <span className="text-sm font-semibold text-gray-900">{pr.title}</span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${publicStatusStyle(pr.status)}`}>
                          {publicStatusLabel(pr)}
                        </span>
                        <span className="text-[10px] bg-violet-50 text-violet-600 px-1.5 py-0.5 rounded-full">🌐 Publik</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${pr.type === 'purchase_request' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'}`}>
                          {pr.type === 'purchase_request' ? '🛒 Purchase Request' : '🧾 Reimburse'}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500">{pr.name} · {pr.category}</div>
                      <div className="text-xs text-gray-400">{fmtDate(publicDate(pr))}</div>
                    </div>
                    <div className="text-sm font-bold text-[#1B8A7A] flex-shrink-0">Rp {pr.amount?.toLocaleString('id-ID')}</div>
                  </div>
                </div>
              )
            } else {
              // Render internal PR card
              const pr = item as PurchaseRequest
              return (
                <div key={`int-${pr.id}`} className="bg-white rounded-xl border border-gray-100 hover:shadow-sm transition-all">
                  <div className="flex items-start gap-3 p-4">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                      pr.status === 'approved' ? 'bg-green-100' :
                      pr.status === 'rejected' ? 'bg-red-100' : 'bg-amber-100'}`}>
                      {pr.status === 'approved' ? <CheckCircle className="w-5 h-5 text-green-600" /> :
                       pr.status === 'rejected' ? <XCircle className="w-5 h-5 text-red-500" /> :
                       <Clock className="w-5 h-5 text-amber-500" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <span className="text-sm font-semibold text-gray-900">{pr.title}</span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${STATUS_STYLE[pr.status]}`}>{STATUS_LABEL[pr.status]}</span>
                        <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">🏢 Internal</span>
                        <span className="text-[10px] text-gray-400 px-1.5 py-0.5 bg-gray-100 rounded-full">{pr.type === 'reimburse' ? '🧾 Reimburse' : '🛒 PR'}</span>
                      </div>
                      <div className="text-xs text-gray-500">{pr.createdBy.name} · {pr.category}</div>
                      <div className="text-xs text-gray-400">{fmtDate(pr.neededDate)}</div>
                    </div>
                    <div className="text-sm font-bold text-[#1B8A7A] flex-shrink-0">Rp {rupiah(pr.amount)}</div>
                  </div>
                </div>
              )
            }
          })}
        </div>
        </div>
      )}

      {/* INTERNAL TAB */}
      {(mainTab === 'internal') && (<div>

      {/* Pilih Tahun & Bulan */}
      <div className="flex items-center gap-2 mb-4">
        <select
          value={viewYear}
          onChange={e => setViewYear(Number(e.target.value))}
          className="px-3 py-2 text-sm font-semibold border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A] bg-white text-gray-700"
        >
          {Array.from({ length: 8 }, (_, i) => now.getFullYear() + 1 - i).map(y => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <select
          value={viewMonth}
          onChange={e => setViewMonth(Number(e.target.value))}
          className="flex-1 px-3 py-2 text-sm font-semibold border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A] bg-white text-gray-700"
        >
          {MONTHS.map((m, i) => (
            <option key={i + 1} value={i + 1}>{m}</option>
          ))}
        </select>
        {viewYear === now.getFullYear() && viewMonth === now.getMonth() + 1 && (
          <span className="text-[11px] text-[#1B8A7A] font-semibold bg-[#E1F5EE] px-2.5 py-1 rounded-full whitespace-nowrap">Bulan ini</span>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {(['all', 'pending', 'approved', 'rejected'] as const).map(s => (
          <button key={s} onClick={() => setFilterStatus(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${filterStatus === s ? 'bg-[#1B8A7A] text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
            {s === 'all' ? 'Semua' : STATUS_LABEL[s]}
            {counts[s] > 0 && <span className="ml-1 opacity-70">({counts[s]})</span>}
          </button>
        ))}
        <select value={filterType} onChange={e => setFilterType(e.target.value as any)}
          className="ml-auto px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A] bg-white text-gray-600">
          <option value="all">Semua Tipe</option>
          <option value="purchase_request">Purchase Request</option>
          <option value="reimburse">Reimburse</option>
        </select>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Cari judul, kategori, nama..."
          className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A]" />
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
            <div className="h-3 w-1/3 bg-gray-100 rounded mb-2" />
            <div className="h-4 w-2/3 bg-gray-100 rounded mb-2" />
            <div className="h-3 w-1/4 bg-gray-100 rounded" />
          </div>
        ))}</div>
      ) : !filtered.length ? (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">📋</div>
          <div className="text-sm font-medium">Tidak ada pengajuan</div>
          <div className="text-xs mt-1">di {MONTHS[viewMonth - 1]} {viewYear}</div>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(pr => {
            const isOwner = pr.createdBy.uid === user?.uid
            const canEdit = isOwner && pr.status === 'pending'
            const canDelete = isAdmin || (isOwner && pr.status === 'pending')
            const isExpanded = expandedId === pr.id
            const commentCount = pr.comments ? Object.keys(pr.comments).length : 0

            return (
              <div key={pr.id} className="bg-white rounded-xl border border-gray-100 hover:border-gray-200 hover:shadow-sm transition-all">
                {/* Main row */}
                <div className="flex items-start gap-3 p-4 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : pr.id)}>
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${pr.status === 'approved' ? 'bg-green-100' : pr.status === 'rejected' ? 'bg-red-100' : 'bg-amber-100'}`}>
                    {pr.status === 'approved' ? <CheckCircle className="w-5 h-5 text-green-600" /> :
                     pr.status === 'rejected' ? <XCircle className="w-5 h-5 text-red-500" /> :
                     <Clock className="w-5 h-5 text-amber-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="text-sm font-semibold text-gray-900 truncate">{pr.title}</span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${STATUS_STYLE[pr.status]}`}>{STATUS_LABEL[pr.status]}</span>
                      <span className="text-[10px] text-gray-400 px-1.5 py-0.5 bg-gray-100 rounded-full">{pr.type === 'reimburse' ? '🧾 Reimburse' : '🛒 PR'}</span>
                      {commentCount > 0 && (
                        <span className="text-[10px] text-[#1B8A7A] bg-[#E1F5EE] px-1.5 py-0.5 rounded-full">💬 {commentCount}</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500">{pr.category} · {fmtDate(pr.neededDate)}</div>
                    <div className="text-xs text-gray-400 mt-0.5">{pr.createdBy.name}</div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <div className="text-sm font-bold text-[#1B8A7A]">Rp {rupiah(pr.amount)}</div>
                    <ChevronDown className={`w-4 h-4 text-gray-300 ml-auto mt-1 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                  </div>
                </div>

                {/* Expanded */}
                {isExpanded && (
                  <div className="px-4 pb-4 space-y-3 border-t border-gray-50 pt-3">
                    <div>
                      <div className="text-[10px] font-semibold text-gray-400 mb-1">KETERANGAN</div>
                      <p className="text-sm text-gray-700 whitespace-pre-wrap">{pr.description}</p>
                    </div>

                    {pr.type === 'reimburse' && pr.paidBy && (
                      <div>
                        <div className="text-[10px] font-semibold text-gray-400 mb-1">DIBAYAR OLEH</div>
                        <p className="text-sm text-gray-700">{pr.paidBy}</p>
                      </div>
                    )}

                    {pr.attachmentData && (
                      <div>
                        <div className="text-[10px] font-semibold text-gray-400 mb-1">LAMPIRAN</div>
                        {pr.attachmentData.startsWith('data:image') ? (
                          <img src={pr.attachmentData} alt="lampiran" className="max-h-48 rounded-lg border border-gray-100 object-contain" />
                        ) : (
                          <a href={pr.attachmentData} download={pr.attachmentName}
                            className="inline-flex items-center gap-1.5 text-xs text-[#1B8A7A] hover:underline">
                            <Paperclip className="w-3.5 h-3.5" />{pr.attachmentName || 'Download lampiran'}
                          </a>
                        )}
                      </div>
                    )}

                    {pr.status === 'rejected' && pr.rejectedReason && (
                      <div className="bg-red-50 border border-red-100 rounded-lg p-3">
                        <div className="text-[10px] font-semibold text-red-400 mb-1">ALASAN PENOLAKAN</div>
                        <p className="text-sm text-red-700">{pr.rejectedReason}</p>
                      </div>
                    )}

                    {pr.reviewedBy && (
                      <div className="text-[10px] text-gray-400">
                        {pr.status === 'approved' ? '✅ Disetujui' : '❌ Ditolak'} oleh {pr.reviewedBy.name}
                        {pr.reviewedAt && ` · ${fmtDate(pr.reviewedAt.slice(0, 10))}`}
                      </div>
                    )}

                    {/* Chat */}
                    <ChatSection pr={pr} currentUser={{ uid: user!.uid, name: user!.name }} />

                    {/* Action buttons */}
                    <div className="flex items-center gap-2 pt-1 flex-wrap border-t border-gray-50">
                      {canEdit && (
                        <button onClick={() => { setEditingPR(pr); setShowForm(true) }}
                          className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600">
                          Edit
                        </button>
                      )}
                      {canDelete && (
                        <button onClick={() => handleDelete(pr)}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs border border-red-100 rounded-lg hover:bg-red-50 text-red-500">
                          <Trash2 className="w-3 h-3" /> Hapus
                        </button>
                      )}
                      {isAdmin && pr.status === 'pending' && (
                        <>
                          <button onClick={() => handleApprove(pr)}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-green-500 hover:bg-green-600 text-white font-semibold rounded-lg">
                            <Check className="w-3.5 h-3.5" /> ACC
                          </button>
                          <button onClick={() => setRejectingId(pr.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-red-500 hover:bg-red-600 text-white font-semibold rounded-lg">
                            <X className="w-3.5 h-3.5" /> Tolak
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      </div>)} {/* end internal tab */}
      {/* PUBLIC TAB */}
      {mainTab === 'public' && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <select value={viewYear} onChange={event => setViewYear(Number(event.target.value))}
              className="px-3 py-2 text-sm font-semibold border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A] bg-white text-gray-700">
              {Array.from({ length: 8 }, (_, index) => now.getFullYear() + 1 - index).map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
            <select value={viewMonth} onChange={event => setViewMonth(Number(event.target.value))}
              className="flex-1 px-3 py-2 text-sm font-semibold border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A] bg-white text-gray-700">
              {MONTHS.map((month, index) => <option key={index + 1} value={index + 1}>{month}</option>)}
            </select>
            {viewYear === now.getFullYear() && viewMonth === now.getMonth() + 1 && (
              <span className="text-[11px] text-[#1B8A7A] font-semibold bg-[#E1F5EE] px-2.5 py-1 rounded-full whitespace-nowrap">Bulan ini</span>
            )}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <div>
              <p className="text-xs text-gray-400">
                Pengajuan dari form publik{' '}
                <a href="/pengajuan" target="_blank" className="text-[#1B8A7A] hover:underline">/pengajuan ↗</a>
              </p>
              <p className="text-[10px] text-gray-300 mt-0.5">Reimburse dan Purchase Request tersimpan pada koleksi Firebase terpisah.</p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={publicTypeFilter}
                onChange={event => setPublicTypeFilter(event.target.value as PRType | 'all')}
                className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A] bg-white text-gray-600"
              >
                <option value="all">Semua Jenis</option>
                <option value="reimburse">Reimburse</option>
                <option value="purchase_request">Purchase Request</option>
              </select>
              <button type="button" onClick={loadPublicFunding} className="text-xs text-gray-400 hover:text-[#1B8A7A]">↻ Refresh</button>
            </div>
          </div>

          {loadingPublic ? (
            <div className="space-y-3">{[...Array(3)].map((_, index) => (
              <div key={index} className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
                <div className="h-4 w-1/2 bg-gray-100 rounded mb-2" />
                <div className="h-3 w-1/3 bg-gray-100 rounded" />
              </div>
            ))}</div>
          ) : visiblePublicRequests.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <Globe className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <div className="text-sm">Belum ada pengajuan publik untuk filter ini.</div>
            </div>
          ) : (
            <div className="space-y-3">
              {visiblePublicRequests.map(request => {
                const isPurchase = request.type === 'purchase_request'
                const downloaded = Boolean(downloadedIds[request.id])
                const verified = Boolean(verifiedPublicIds[request.id])
                const canApprove = downloaded && (!isPurchase || verified)

                return (
                  <div key={`${request.type}-${request.id}`} className="bg-white rounded-xl border border-gray-100 hover:shadow-sm transition-all">
                    <div className="flex items-start gap-3 p-4">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${publicIconBg(request.status)}`}>
                        {publicIcon(request.status)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <span className="text-sm font-semibold text-gray-900">{request.title}</span>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${publicStatusStyle(request.status)}`}>
                            {publicStatusLabel(request)}
                          </span>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isPurchase ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'}`}>
                            {isPurchase ? '🛒 Purchase Request' : '🧾 Reimburse'}
                          </span>
                          <span className="text-[10px] font-mono text-gray-400">{request.trackingCode}</span>
                        </div>
                        <div className="text-xs text-gray-500">{request.name} · {request.email}</div>
                        <div className="text-xs text-gray-400 mt-0.5">{request.category} · {fmtDate(publicDate(request))}</div>
                        {request.department && <div className="text-xs text-gray-400">{request.department}</div>}

                        <div className="mt-3 rounded-lg bg-gray-50 border border-gray-100 p-3">
                          <div className="text-[10px] font-semibold text-gray-400 mb-1">KETERANGAN</div>
                          <p className="text-xs text-gray-600 whitespace-pre-wrap">{request.description}</p>
                        </div>

                        {isPurchase && (
                          <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50 p-3">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <div className="text-[10px] font-bold uppercase tracking-wide text-amber-600">Tujuan Pembayaran</div>
                                <div className="text-sm font-bold text-gray-900 mt-1">{request.providerName || request.paymentMethodLabel || 'Tujuan pembayaran'}</div>
                                <div className="text-xs text-gray-600 mt-0.5">{request.payeeName || '-'}</div>
                                <div className="font-mono text-sm font-bold text-amber-800 mt-1 break-all">{request.destinationAccount || '-'}</div>
                              </div>
                              <button
                                type="button"
                                onClick={() => copyDestination(request)}
                                className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-white border border-amber-200 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100"
                              >
                                <Copy className="w-3.5 h-3.5" /> Salin
                              </button>
                            </div>
                          </div>
                        )}

                        {request.status === 'rejected' && request.rejectedReason && (
                          <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg p-3 mt-3">
                            <span className="font-semibold">Alasan penolakan:</span> {request.rejectedReason}
                          </div>
                        )}

                        {request.attachmentData && (
                          <div className="mt-3">
                            <div className="text-[10px] font-semibold text-gray-400 mb-1.5">
                              {isPurchase ? 'INVOICE / TAGIHAN' : 'NOTA / BUKTI PEMBAYARAN'}
                            </div>
                            {request.attachmentData.startsWith('data:image') && (
                              <img
                                src={request.attachmentData}
                                alt={isPurchase ? 'tagihan' : 'nota'}
                                className="max-h-40 rounded-lg border border-gray-100 object-contain mb-2"
                              />
                            )}
                            <a
                              href={request.attachmentData}
                              download={request.attachmentName || (isPurchase ? 'tagihan' : 'nota')}
                              onClick={() => setDownloadedIds(current => ({ ...current, [request.id]: true }))}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-900 text-white rounded-lg"
                            >
                              <Download className="w-3.5 h-3.5" />
                              {isPurchase ? 'Download Tagihan' : 'Download Nota'}
                            </a>
                            {downloaded && <span className="ml-2 text-[10px] font-semibold text-green-600">✓ Sudah dibuka</span>}
                          </div>
                        )}

                        {request.status === 'paid' && request.paymentProofData && (
                          <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 p-3">
                            <div className="text-[10px] font-bold uppercase text-blue-600 mb-1">Pembayaran Selesai</div>
                            <div className="text-xs text-blue-700">
                              {fmtDate(request.paidAt || '')} · Rp {Number(request.paidAmount || 0).toLocaleString('id-ID')}
                            </div>
                            {request.paymentNote && <div className="text-xs text-blue-600 mt-1">{request.paymentNote}</div>}
                            <a
                              href={request.paymentProofData}
                              download={request.paymentProofName || 'bukti-pembayaran'}
                              className="inline-flex items-center gap-1.5 mt-2 text-xs font-semibold text-blue-700 hover:underline"
                            >
                              <Download className="w-3.5 h-3.5" /> Download Bukti Pembayaran
                            </a>
                          </div>
                        )}

                        {isAdmin && request.status === 'pending' && (
                          <div className="mt-3 space-y-2">
                            {isPurchase && (
                              <label className="flex items-start gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-[11px] leading-relaxed text-gray-600">
                                <input
                                  type="checkbox"
                                  checked={verified}
                                  onChange={event => setVerifiedPublicIds(current => ({ ...current, [request.id]: event.target.checked }))}
                                  className="mt-0.5 h-4 w-4 accent-[#1B8A7A]"
                                />
                                Saya sudah memeriksa nominal, lampiran, nama penerima, dan nomor tujuan pembayaran.
                              </label>
                            )}
                            <div className="flex gap-2 flex-wrap">
                              <button
                                type="button"
                                onClick={() => canApprove
                                  ? handleApprovePublic(request)
                                  : alert(isPurchase
                                    ? 'Download tagihan dan centang konfirmasi pemeriksaan terlebih dahulu.'
                                    : 'Download nota terlebih dahulu sebelum ACC.')}
                                className={`flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                                  canApprove
                                    ? 'bg-green-500 hover:bg-green-600 text-white'
                                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                                }`}
                              >
                                <Check className="w-3.5 h-3.5" /> ACC {!canApprove && '🔒'}
                              </button>
                              <button type="button" onClick={() => setRejectingPublicId(request.id)}
                                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-red-500 hover:bg-red-600 text-white font-semibold rounded-lg">
                                <X className="w-3.5 h-3.5" /> Tolak
                              </button>
                              <button type="button" onClick={() => handleDeletePublic(request)}
                                className="flex items-center gap-1 px-3 py-1.5 text-xs border border-red-100 hover:bg-red-50 text-red-500 rounded-lg ml-auto">
                                <Trash2 className="w-3 h-3" /> Hapus
                              </button>
                            </div>
                          </div>
                        )}

                        {isAdmin && request.status === 'approved' && (
                          <div className="flex gap-2 mt-3 flex-wrap">
                            {isPurchase ? (
                              <button type="button" onClick={() => setPayingPublicId(request.id)}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg">
                                <WalletCards className="w-3.5 h-3.5" /> Tandai Sudah Dibayar
                              </button>
                            ) : (
                              <button type="button" onClick={() => handleTransferPublic(request)}
                                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg">
                                💸 Tandai Sudah Ditransfer
                              </button>
                            )}
                            <button type="button" onClick={() => handleDeletePublic(request)}
                              className="flex items-center gap-1 px-3 py-1.5 text-xs border border-red-100 hover:bg-red-50 text-red-500 rounded-lg ml-auto">
                              <Trash2 className="w-3 h-3" /> Hapus
                            </button>
                          </div>
                        )}

                        {isAdmin && ['rejected', 'transferred', 'paid'].includes(request.status) && (
                          <div className="flex justify-end mt-3">
                            <button type="button" onClick={() => handleDeletePublic(request)}
                              className="flex items-center gap-1 px-3 py-1.5 text-xs border border-red-100 hover:bg-red-50 text-red-500 rounded-lg">
                              <Trash2 className="w-3 h-3" /> Hapus
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="text-sm font-bold text-[#1B8A7A] flex-shrink-0">
                        Rp {request.amount?.toLocaleString('id-ID')}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}


      {/* Modals */}
      {showForm && (
        <FormModal
          existing={editingPR}
          onClose={() => { setShowForm(false); setEditingPR(null) }}
          onSave={handleSave}
          currentUser={{ uid: user!.uid, name: user!.name }}
          defaultYear={viewYear}
          defaultMonth={viewMonth}
        />
      )}
      {rejectingId && (
        <RejectModal
          onClose={() => setRejectingId(null)}
          onConfirm={async (reason) => {
            const pr = requests.find(r => r.id === rejectingId)
            if (!pr) return
            await handleReject(pr, reason)
          }}
        />
      )}
      {rejectingPublicId && (
        <RejectModal
          onClose={() => setRejectingPublicId(null)}
          onConfirm={async (reason) => {
            const pr = publicRequests.find(r => r.id === rejectingPublicId)
            if (!pr) return
            await handleRejectPublic(pr, reason)
          }}
        />
      )}
      {payingPublicId && (() => {
        const request = publicRequests.find(item => item.id === payingPublicId && item.type === 'purchase_request')
        if (!request) return null
        return (
          <PaymentModal
            request={request}
            onClose={() => setPayingPublicId(null)}
            onConfirm={payment => handlePaidPublic(request, payment)}
          />
        )
      })()}
    </div>
  )
}
