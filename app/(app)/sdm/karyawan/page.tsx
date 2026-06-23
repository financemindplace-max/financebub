'use client'
/* eslint-disable @next/next/no-img-element */
// ─── app/(app)/sdm/karyawan/page.tsx ─────────────────────────────────────────

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import { get, off, onValue, ref, remove, set } from 'firebase/database'
import { db } from '@/lib/firebase'
import { fmt } from '@/lib/utils'
import {
  Camera,
  CreditCard,
  Download,
  FileDown,
  Image as ImageIcon,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  User,
  X,
} from 'lucide-react'
import { jsPDF } from 'jspdf'

const USER_ID = 'financebub-main'
const PATH = `users/${USER_ID}/data/_karyawan`
const FILES_PATH = `users/${USER_ID}/data/_karyawan_files`

interface Karyawan {
  id: string; nama: string; nik: string; tmplahir: string; tgllahir: string
  jk: string; ktp: string; hp: string; email: string; alamat: string
  jabatan: string; dept: string; tgljoin: string
  status: 'Aktif' | 'Tidak Aktif' | 'Resign'
  bank: string; noRek: string; atasNama: string; gajiPokok: number; catatan: string
}

interface AttachmentMeta {
  originalName: string
  compressedBytes: number
  width: number
  height: number
  updatedAt: number
}

interface KaryawanFiles {
  fotoProfil?: string
  fotoKtp?: string
  profileMeta?: AttachmentMeta
  ktpMeta?: AttachmentMeta
  updatedAt?: number
}

type UploadKind = 'profile' | 'ktp'

const EMPTY: Omit<Karyawan, 'id'> = {
  nama: '', nik: '', tmplahir: '', tgllahir: '', jk: 'Laki-laki',
  ktp: '', hp: '', email: '', alamat: '',
  jabatan: '', dept: '', tgljoin: new Date().toISOString().slice(0, 10),
  status: 'Aktif', bank: '', noRek: '', atasNama: '', gajiPokok: 0, catatan: ''
}

const STATUS_STYLE: Record<string, string> = {
  'Aktif': 'bg-green-100 text-green-700',
  'Tidak Aktif': 'bg-gray-100 text-gray-500',
  'Resign': 'bg-red-100 text-red-600',
}

function subscribeArr(path: string, cb: (arr: Karyawan[]) => void) {
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

async function saveArr(arr: Karyawan[]) {
  await set(ref(db, PATH), JSON.stringify(arr))
  await set(ref(db, `users/${USER_ID}/data/_ts`), Date.now())
}

async function loadEmployeeFiles(id: string): Promise<KaryawanFiles> {
  const snap = await get(ref(db, `${FILES_PATH}/${id}`))
  return snap.exists() ? (snap.val() as KaryawanFiles) : {}
}

async function saveEmployeeFiles(id: string, files: KaryawanFiles) {
  const payload: KaryawanFiles = {
    ...(files.fotoProfil ? { fotoProfil: files.fotoProfil } : {}),
    ...(files.fotoKtp ? { fotoKtp: files.fotoKtp } : {}),
    ...(files.profileMeta ? { profileMeta: files.profileMeta } : {}),
    ...(files.ktpMeta ? { ktpMeta: files.ktpMeta } : {}),
    updatedAt: Date.now(),
  }

  if (!payload.fotoProfil && !payload.fotoKtp) {
    await remove(ref(db, `${FILES_PATH}/${id}`))
    return
  }

  await set(ref(db, `${FILES_PATH}/${id}`), payload)
}

function bytesFromDataUrl(dataUrl: string) {
  const base64 = dataUrl.split(',')[1] || ''
  return Math.ceil(base64.length * 0.75)
}

function formatFileSize(bytes?: number) {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('File tidak dapat dibaca.'))
    reader.readAsDataURL(file)
  })
}

function loadImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Gambar tidak dapat diproses.'))
    image.src = dataUrl
  })
}

async function compressEmployeeImage(file: File, kind: UploadKind) {
  if (!file.type.startsWith('image/')) throw new Error('Gunakan file foto JPG, PNG, atau WEBP.')
  if (file.size > 15 * 1024 * 1024) throw new Error('Ukuran foto awal maksimal 15 MB.')

  const source = await readFileAsDataUrl(file)
  const image = await loadImage(source)
  const targetRatio = kind === 'profile' ? 2 / 3 : 85.6 / 53.98
  const maxWidth = kind === 'profile' ? 1200 : 1800
  const maxHeight = kind === 'profile' ? 1800 : 1135
  const targetBytes = kind === 'profile' ? 650 * 1024 : 950 * 1024
  const minQuality = kind === 'profile' ? 0.74 : 0.76

  const sourceRatio = image.naturalWidth / image.naturalHeight
  let sx = 0
  let sy = 0
  let cropWidth = image.naturalWidth
  let cropHeight = image.naturalHeight

  if (sourceRatio > targetRatio) {
    cropWidth = image.naturalHeight * targetRatio
    sx = (image.naturalWidth - cropWidth) / 2
  } else if (sourceRatio < targetRatio) {
    cropHeight = image.naturalWidth / targetRatio
    sy = (image.naturalHeight - cropHeight) / 2
  }

  const scale = Math.min(1, maxWidth / cropWidth, maxHeight / cropHeight)
  const width = Math.max(1, Math.round(cropWidth * scale))
  const height = Math.max(1, Math.round(cropHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('Browser tidak mendukung kompresi gambar.')

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, sx, sy, cropWidth, cropHeight, 0, 0, width, height)

  let quality = 0.9
  let dataUrl = canvas.toDataURL('image/jpeg', quality)
  while (bytesFromDataUrl(dataUrl) > targetBytes && quality > minQuality) {
    quality = Math.max(minQuality, quality - 0.04)
    dataUrl = canvas.toDataURL('image/jpeg', quality)
  }

  return {
    dataUrl,
    meta: {
      originalName: file.name,
      compressedBytes: bytesFromDataUrl(dataUrl),
      width,
      height,
      updatedAt: Date.now(),
    } satisfies AttachmentMeta,
  }
}

function safeFileName(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9-_]+/g, '_').replace(/^_+|_+$/g, '') || 'Karyawan'
}

function formatDate(value?: string) {
  if (!value) return '-'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'long', year: 'numeric' }).format(date)
}

function maskAccount(value?: string) {
  if (!value) return '-'
  const clean = value.replace(/\s+/g, '')
  if (clean.length <= 6) return clean
  return `${clean.slice(0, 3)}${'•'.repeat(Math.max(4, clean.length - 7))}${clean.slice(-4)}`
}

function addImageCover(doc: jsPDF, dataUrl: string, x: number, y: number, width: number, height: number) {
  try {
    doc.addImage(dataUrl, 'JPEG', x, y, width, height, undefined, 'FAST')
  } catch {
    // Gambar korup tidak boleh menggagalkan seluruh PDF.
  }
}

function generateEmployeePdf(employee: Karyawan, files: KaryawanFiles, includeSalary: boolean) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  const pageWidth = 210
  const pageHeight = 297
  const margin = 12
  const green = '#1B8A7A'
  const darkGreen = '#0F6E56'
  const ink = '#172033'
  const muted = '#687386'
  const border = '#E4E9EE'

  const setText = (color: string, size: number, style: 'normal' | 'bold' = 'normal') => {
    doc.setTextColor(color)
    doc.setFont('helvetica', style)
    doc.setFontSize(size)
  }

  const fitLines = (value: string, width: number, maxLines: number) => {
    const lines = doc.splitTextToSize(value || '-', width) as string[]
    if (lines.length <= maxLines) return lines
    const result = lines.slice(0, maxLines)
    const last = result[maxLines - 1] || ''
    result[maxLines - 1] = `${last.replace(/\s+$/, '')}...`
    return result
  }

  const drawSectionTitle = (title: string, y: number) => {
    doc.setFillColor('#EAF8F5')
    doc.roundedRect(margin, y, pageWidth - margin * 2, 7, 1.8, 1.8, 'F')
    setText(darkGreen, 8, 'bold')
    doc.text(title.toUpperCase(), margin + 3.5, y + 4.7)
  }

  const drawCompactField = (
    label: string,
    value: string,
    x: number,
    y: number,
    width: number,
    height = 12,
    maxLines = 2,
  ) => {
    doc.setFillColor('#FAFBFC')
    doc.setDrawColor(border)
    doc.roundedRect(x, y, width, height, 1.5, 1.5, 'FD')
    setText(muted, 5.8, 'bold')
    doc.text(label.toUpperCase(), x + 2.6, y + 3.3)
    setText(ink, 7.6)
    const lines = fitLines(value || '-', width - 5.2, maxLines)
    doc.text(lines, x + 2.6, y + 7.3, { lineHeightFactor: 1.05 })
  }

  // Header
  doc.setFillColor(green)
  doc.rect(0, 0, pageWidth, 20, 'F')
  setText('#FFFFFF', 13, 'bold')
  doc.text('FINANCEBUB', margin, 8.5)
  setText('#D9FFF8', 7)
  doc.text('PROFIL KARYAWAN & LAMPIRAN IDENTITAS', margin, 14)
  setText('#FFFFFF', 7, 'bold')
  doc.text('DOKUMEN INTERNAL', pageWidth - margin, 10.5, { align: 'right' })

  // Hero employee identity
  doc.setFillColor('#F7FAFC')
  doc.setDrawColor(border)
  doc.roundedRect(margin, 25, pageWidth - margin * 2, 43, 3, 3, 'FD')

  const photoX = pageWidth - margin - 28
  if (files.fotoProfil) {
    addImageCover(doc, files.fotoProfil, photoX, 27, 26, 39)
  } else {
    doc.setFillColor('#E7ECEF')
    doc.roundedRect(photoX, 27, 26, 39, 2, 2, 'F')
    setText('#A0AAB5', 7, 'bold')
    doc.text('FOTO 4 x 6', photoX + 13, 47.5, { align: 'center' })
  }
  doc.setDrawColor(green)
  doc.roundedRect(photoX, 27, 26, 39, 2, 2, 'S')

  const heroTextWidth = photoX - margin - 13
  setText(ink, 15, 'bold')
  const nameLines = fitLines(employee.nama || '-', heroTextWidth, 2)
  doc.text(nameLines, margin + 6, 37, { lineHeightFactor: 1.05 })
  const nameOffset = nameLines.length > 1 ? 6 : 0
  setText(green, 9, 'bold')
  doc.text(employee.jabatan || 'Jabatan belum diisi', margin + 6, 45 + nameOffset)
  setText(muted, 7)
  doc.text(`${employee.dept || 'Departemen belum diisi'} - ${employee.status || '-'}`, margin + 6, 51 + nameOffset)
  doc.setFillColor(employee.status === 'Aktif' ? '#DDF7E9' : '#F1F3F5')
  doc.roundedRect(margin + 6, 57 + nameOffset, 27, 7, 3.5, 3.5, 'F')
  setText(employee.status === 'Aktif' ? '#16794B' : muted, 7, 'bold')
  doc.text(employee.status || '-', margin + 19.5, 61.8 + nameOffset, { align: 'center' })
  setText(muted, 6.2)
  doc.text(`ID: ${employee.id}`, margin + 38, 61.5 + nameOffset)

  // Personal information
  drawSectionTitle('Data Diri', 74)
  const gap = 5
  const colWidth = (pageWidth - margin * 2 - gap) / 2
  const leftX = margin
  const rightX = margin + colWidth + gap
  drawCompactField('NIK / No. KTP', employee.nik || '-', leftX, 84, colWidth)
  drawCompactField('Jenis Kelamin', employee.jk || '-', rightX, 84, colWidth)
  drawCompactField('Tempat, Tanggal Lahir', `${employee.tmplahir || '-'}, ${formatDate(employee.tgllahir)}`, leftX, 98, colWidth)
  drawCompactField('Nomor HP', employee.hp || '-', rightX, 98, colWidth)
  drawCompactField('Email', employee.email || '-', leftX, 112, colWidth)
  drawCompactField('Tanggal Bergabung', formatDate(employee.tgljoin), rightX, 112, colWidth)
  drawCompactField('Alamat', employee.alamat || '-', leftX, 126, pageWidth - margin * 2, 16, 3)

  // Employment and bank information
  drawSectionTitle('Data Pekerjaan dan Rekening', 147)
  drawCompactField('Jabatan', employee.jabatan || '-', leftX, 157, colWidth)
  drawCompactField('Departemen', employee.dept || '-', rightX, 157, colWidth)
  drawCompactField('Status Karyawan', employee.status || '-', leftX, 171, colWidth)
  drawCompactField('Bank', employee.bank || '-', rightX, 171, colWidth)
  drawCompactField('Nomor Rekening', employee.noRek || '-', leftX, 185, colWidth)
  drawCompactField('Atas Nama', employee.atasNama || '-', rightX, 185, colWidth)

  if (includeSalary) {
    doc.setFillColor('#FFF8E5')
    doc.setDrawColor('#F2D58B')
    doc.roundedRect(leftX, 199, pageWidth - margin * 2, 12, 1.5, 1.5, 'FD')
    setText('#8A5B00', 6, 'bold')
    doc.text('GAJI POKOK', leftX + 3, 203)
    setText('#1D2738', 9.5, 'bold')
    doc.text(`Rp ${fmt(employee.gajiPokok || 0)}`, leftX + 3, 208.2)
  } else {
    doc.setFillColor('#F7F8FA')
    doc.setDrawColor(border)
    doc.roundedRect(leftX, 199, pageWidth - margin * 2, 12, 1.5, 1.5, 'FD')
    setText(muted, 6.5, 'bold')
    doc.text('INFORMASI GAJI TIDAK DISERTAKAN PADA DOKUMEN INI', leftX + 3, 206.2)
  }

  // KTP and notes in the same A4 page
  drawSectionTitle('Lampiran KTP dan Catatan', 216)
  const ktpX = 108
  const ktpY = 226
  const ktpWidth = pageWidth - margin - ktpX
  const ktpHeight = ktpWidth / (85.6 / 53.98)

  doc.setFillColor('#F7FAFC')
  doc.setDrawColor(border)
  doc.roundedRect(ktpX, ktpY, ktpWidth, ktpHeight, 2, 2, 'FD')
  if (files.fotoKtp) {
    addImageCover(doc, files.fotoKtp, ktpX + 2, ktpY + 2, ktpWidth - 4, ktpHeight - 4)
  } else {
    setText('#A0AAB5', 7.5, 'bold')
    doc.text('FOTO KTP BELUM DIUNGGAH', ktpX + ktpWidth / 2, ktpY + ktpHeight / 2, { align: 'center' })
  }

  const noteWidth = ktpX - margin - 5
  doc.setFillColor('#FAFBFC')
  doc.setDrawColor(border)
  doc.roundedRect(margin, ktpY, noteWidth, ktpHeight, 2, 2, 'FD')
  setText(muted, 5.8, 'bold')
  doc.text('CATATAN', margin + 3, ktpY + 5)
  setText(ink, 7)
  const noteLines = fitLines(employee.catatan || 'Tidak ada catatan tambahan.', noteWidth - 6, 4)
  doc.text(noteLines, margin + 3, ktpY + 10, { lineHeightFactor: 1.05 })

  doc.setFillColor('#FFF4E5')
  doc.roundedRect(margin + 2, ktpY + 27, noteWidth - 4, ktpHeight - 29, 1.5, 1.5, 'F')
  setText('#8A5300', 5.8, 'bold')
  doc.text('KERAHASIAAN DATA', margin + 5, ktpY + 32)
  setText('#6E4A13', 6.2)
  const privacyLines = fitLines(
    'Dokumen ini memuat data pribadi dan hanya boleh digunakan untuk administrasi internal perusahaan. Dilarang menyebarkan tanpa izin.',
    noteWidth - 10,
    5,
  )
  doc.text(privacyLines, margin + 5, ktpY + 37, { lineHeightFactor: 1.08 })

  // Footer
  doc.setDrawColor(border)
  doc.line(margin, pageHeight - 11, pageWidth - margin, pageHeight - 11)
  setText(muted, 6)
  doc.text(`Dibuat ${new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeStyle: 'short' }).format(new Date())}`, margin, pageHeight - 6)
  doc.text('1 halaman A4', pageWidth - margin, pageHeight - 6, { align: 'right' })

  doc.save(`Profil_Karyawan_${safeFileName(employee.nama)}_${new Date().toISOString().slice(0, 10)}.pdf`)
}
function AttachmentUpload({
  kind,
  value,
  meta,
  processing,
  onSelect,
  onRemove,
}: {
  kind: UploadKind
  value?: string
  meta?: AttachmentMeta
  processing: boolean
  onSelect: (file: File) => void
  onRemove: () => void
}) {
  const profile = kind === 'profile'
  const inputId = `employee-${kind}-upload`
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-xs font-semibold text-gray-700">{profile ? 'Foto Profil 4 x 6' : 'Lampiran Foto KTP'}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">
            {profile ? 'Otomatis dipotong rasio 2:3.' : 'Otomatis dipotong mengikuti rasio kartu KTP.'}
          </div>
        </div>
        {value && (
          <button type="button" onClick={onRemove} className="text-[11px] text-red-500 hover:text-red-600">Hapus</button>
        )}
      </div>
      <label
        htmlFor={inputId}
        className={`relative flex items-center justify-center overflow-hidden rounded-xl border-2 border-dashed transition-colors cursor-pointer ${profile ? 'max-w-[180px]' : 'w-full'} ${value ? 'border-[#1B8A7A]/30 bg-[#F3FBF9]' : 'border-gray-200 hover:border-[#1B8A7A]/50 bg-gray-50'}`}
        style={{ aspectRatio: profile ? '2 / 3' : '1.586 / 1' }}
      >
        {processing ? (
          <div className="text-center text-gray-500">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-[#1B8A7A]" />
            <div className="text-xs">Mengompres foto...</div>
          </div>
        ) : value ? (
          <>
            <img src={value} alt={profile ? 'Foto profil karyawan' : 'Foto KTP karyawan'} className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-x-0 bottom-0 bg-black/55 text-white text-[10px] px-2 py-1.5 text-center">
              Klik untuk mengganti{meta?.compressedBytes ? ` · ${formatFileSize(meta.compressedBytes)}` : ''}
            </div>
          </>
        ) : (
          <div className="text-center px-4 text-gray-400">
            {profile ? <Camera className="w-7 h-7 mx-auto mb-2" /> : <CreditCard className="w-8 h-8 mx-auto mb-2" />}
            <div className="text-xs font-medium text-gray-600">Klik untuk upload</div>
            <div className="text-[10px] mt-1">JPG, PNG, WEBP · maks. 15 MB</div>
          </div>
        )}
      </label>
      <input
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={event => {
          const file = event.target.files?.[0]
          if (file) onSelect(file)
          event.currentTarget.value = ''
        }}
      />
      {meta && (
        <div className="mt-1.5 text-[10px] text-gray-400">
          Hasil: {meta.width} x {meta.height}px · {formatFileSize(meta.compressedBytes)}
        </div>
      )}
    </div>
  )
}

// ── Form Modal ────────────────────────────────────────────────────────────────
function KaryawanModal({ initial, onSave, onClose }: {
  initial: Karyawan | null
  onSave: (k: Karyawan, files: KaryawanFiles) => Promise<void>
  onClose: () => void
}) {
  const [form, setForm] = useState<Omit<Karyawan, 'id'>>(initial ? { ...initial } : { ...EMPTY })
  const [files, setFiles] = useState<KaryawanFiles>({})
  const [loadingFiles, setLoadingFiles] = useState(Boolean(initial?.id))
  const [processing, setProcessing] = useState<UploadKind | null>(null)
  const [saving, setSaving] = useState(false)
  const sf = (k: keyof typeof form, v: any) => setForm(f => ({ ...f, [k]: v }))
  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A] focus:ring-1 focus:ring-[#1B8A7A]/10'
  const lbl = 'block text-xs font-medium text-gray-600 mb-1'

  useEffect(() => {
    let active = true
    if (!initial?.id) {
      setFiles({})
      setLoadingFiles(false)
      return () => { active = false }
    }

    loadEmployeeFiles(initial.id)
      .then(data => { if (active) setFiles(data) })
      .catch(() => { if (active) setFiles({}) })
      .finally(() => { if (active) setLoadingFiles(false) })

    return () => { active = false }
  }, [initial?.id])

  const handleImage = async (kind: UploadKind, file: File) => {
    setProcessing(kind)
    try {
      const result = await compressEmployeeImage(file, kind)
      setFiles(current => kind === 'profile'
        ? { ...current, fotoProfil: result.dataUrl, profileMeta: result.meta }
        : { ...current, fotoKtp: result.dataUrl, ktpMeta: result.meta })
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Gagal memproses gambar.')
    } finally {
      setProcessing(null)
    }
  }

  const handleSubmit = async () => {
    if (!form.nama.trim()) { alert('Nama wajib diisi'); return }
    if (processing) { alert('Tunggu proses kompresi foto selesai.'); return }
    setSaving(true)
    try {
      await onSave({ id: initial?.id || (`kar-${Date.now()}`), ...form }, files)
    } catch (error) {
      console.error(error)
      alert('Gagal menyimpan data karyawan. Silakan coba lagi.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={saving ? undefined : onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">{initial ? 'Edit Karyawan' : 'Tambah Karyawan'}</h2>
          <button disabled={saving} onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 disabled:opacity-50"><X size={15} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div>
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Foto dan Dokumen Identitas</div>
            {loadingFiles ? (
              <div className="h-36 flex items-center justify-center rounded-xl bg-gray-50 text-sm text-gray-400">
                <Loader2 className="w-5 h-5 animate-spin mr-2" /> Memuat lampiran...
              </div>
            ) : (
              <div className="grid grid-cols-[190px_1fr] gap-5 items-start">
                <AttachmentUpload
                  kind="profile"
                  value={files.fotoProfil}
                  meta={files.profileMeta}
                  processing={processing === 'profile'}
                  onSelect={file => handleImage('profile', file)}
                  onRemove={() => setFiles(current => ({ ...current, fotoProfil: undefined, profileMeta: undefined }))}
                />
                <AttachmentUpload
                  kind="ktp"
                  value={files.fotoKtp}
                  meta={files.ktpMeta}
                  processing={processing === 'ktp'}
                  onSelect={file => handleImage('ktp', file)}
                  onRemove={() => setFiles(current => ({ ...current, fotoKtp: undefined, ktpMeta: undefined }))}
                />
              </div>
            )}
            <div className="mt-3 flex items-start gap-2 rounded-lg bg-blue-50 px-3 py-2 text-[11px] text-blue-700">
              <ImageIcon className="w-4 h-4 shrink-0 mt-0.5" />
              Foto dikompres otomatis dengan resolusi tinggi. Profil maksimal 1200 x 1800px dan KTP maksimal 1800 x 1135px agar tetap tajam saat dimasukkan ke PDF A4.
            </div>
          </div>

          <div>
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Data Diri</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><label className={lbl}>Nama Lengkap *</label><input className={inp} value={form.nama} onChange={e => sf('nama', e.target.value)} placeholder="Nama lengkap" /></div>
              <div><label className={lbl}>NIK / No. KTP</label><input className={inp} value={form.nik} onChange={e => sf('nik', e.target.value)} placeholder="16 digit NIK" /></div>
              <div><label className={lbl}>Jenis Kelamin</label>
                <select className={inp} value={form.jk} onChange={e => sf('jk', e.target.value)}>
                  <option>Laki-laki</option><option>Perempuan</option>
                </select>
              </div>
              <div><label className={lbl}>Tempat Lahir</label><input className={inp} value={form.tmplahir} onChange={e => sf('tmplahir', e.target.value)} placeholder="Jakarta" /></div>
              <div><label className={lbl}>Tanggal Lahir</label><input type="date" className={inp} value={form.tgllahir} onChange={e => sf('tgllahir', e.target.value)} /></div>
              <div><label className={lbl}>No. HP</label><input className={inp} value={form.hp} onChange={e => sf('hp', e.target.value)} placeholder="0812-xxxx" /></div>
              <div><label className={lbl}>Email</label><input type="email" className={inp} value={form.email} onChange={e => sf('email', e.target.value)} placeholder="email@..." /></div>
              <div className="col-span-2"><label className={lbl}>Alamat</label><textarea className={inp} rows={2} value={form.alamat} onChange={e => sf('alamat', e.target.value)} placeholder="Alamat lengkap" /></div>
            </div>
          </div>
          <div>
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Data Pekerjaan</div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lbl}>Jabatan *</label><input className={inp} value={form.jabatan} onChange={e => sf('jabatan', e.target.value)} placeholder="Content Creator, Editor..." /></div>
              <div><label className={lbl}>Departemen</label><input className={inp} value={form.dept} onChange={e => sf('dept', e.target.value)} placeholder="Creative, Finance..." /></div>
              <div><label className={lbl}>Tanggal Bergabung</label><input type="date" className={inp} value={form.tgljoin} onChange={e => sf('tgljoin', e.target.value)} /></div>
              <div><label className={lbl}>Status</label>
                <select className={inp} value={form.status} onChange={e => sf('status', e.target.value as Karyawan['status'])}>
                  <option>Aktif</option><option>Tidak Aktif</option><option>Resign</option>
                </select>
              </div>
              <div><label className={lbl}>Gaji Pokok (IDR)</label><input type="number" className={inp} value={form.gajiPokok || ''} onChange={e => sf('gajiPokok', +e.target.value)} placeholder="0" /></div>
            </div>
          </div>
          <div>
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Rekening Bank</div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lbl}>Bank</label><input className={inp} value={form.bank} onChange={e => sf('bank', e.target.value)} placeholder="BCA, Mandiri..." /></div>
              <div><label className={lbl}>No. Rekening</label><input className={inp} value={form.noRek} onChange={e => sf('noRek', e.target.value)} placeholder="xxxx-xxxx-xxxx" /></div>
              <div><label className={lbl}>Atas Nama</label><input className={inp} value={form.atasNama} onChange={e => sf('atasNama', e.target.value)} placeholder="Nama di rekening" /></div>
            </div>
          </div>
          <div>
            <label className={lbl}>Catatan</label>
            <textarea className={inp} rows={2} value={form.catatan} onChange={e => sf('catatan', e.target.value)} placeholder="Catatan tambahan..." />
          </div>
        </div>
        <div className="px-5 py-4 border-t border-gray-100 flex gap-2">
          <button disabled={saving} onClick={onClose} className="flex-1 py-2 border border-gray-200 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50">Batal</button>
          <button disabled={saving || Boolean(processing)} onClick={handleSubmit} className="flex-1 py-2 bg-[#1B8A7A] hover:bg-[#0F6E56] disabled:bg-gray-300 text-white text-sm font-semibold rounded-lg flex items-center justify-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Simpan
          </button>
        </div>
      </div>
    </div>
  )
}

function DownloadEmployeeModal({
  employee,
  files,
  loading,
  onClose,
}: {
  employee: Karyawan
  files: KaryawanFiles
  loading: boolean
  onClose: () => void
}) {
  const [includeSalary, setIncludeSalary] = useState(false)
  const [generating, setGenerating] = useState(false)

  const downloadPdf = async () => {
    setGenerating(true)
    try {
      generateEmployeePdf(employee, files, includeSalary)
    } catch (error) {
      console.error(error)
      alert('Gagal membuat PDF karyawan.')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Download Profil Karyawan</h2>
            <p className="mt-0.5 text-xs text-gray-400">Output PDF A4 satu halaman dengan foto profil dan KTP.</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"><X size={15} /></button>
        </div>

        <div className="p-5">
          <div className="flex items-center gap-4 rounded-xl border border-gray-100 bg-gray-50 p-4">
            <div className="h-20 w-[54px] shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-white">
              {files.fotoProfil ? (
                <img src={files.fotoProfil} alt={employee.nama} className="h-full w-full object-cover" />
              ) : (
                <User className="m-auto mt-6 h-7 w-7 text-gray-300" />
              )}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-gray-900">{employee.nama}</div>
              <div className="mt-1 text-xs text-gray-500">{employee.jabatan || '-'} · {employee.dept || '-'}</div>
              <div className="mt-2 flex gap-2 text-[10px]">
                <span className={`rounded-full px-2 py-1 ${files.fotoProfil ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>
                  Foto {files.fotoProfil ? 'tersedia' : 'belum ada'}
                </span>
                <span className={`rounded-full px-2 py-1 ${files.fotoKtp ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>
                  KTP {files.fotoKtp ? 'tersedia' : 'belum ada'}
                </span>
              </div>
            </div>
          </div>

          <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 p-4 hover:bg-gray-50">
            <input
              type="checkbox"
              checked={includeSalary}
              onChange={event => setIncludeSalary(event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[#1B8A7A]"
            />
            <div>
              <div className="text-sm font-medium text-gray-800">Sertakan informasi gaji pokok</div>
              <div className="mt-1 text-xs leading-relaxed text-gray-400">
                Jika tidak dicentang, nominal gaji tidak akan ditampilkan pada PDF.
              </div>
            </div>
          </label>

          <div className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700">
            PDF memuat data pribadi. Pastikan file hanya diberikan kepada pihak yang berwenang.
          </div>
        </div>

        <div className="flex gap-2 border-t border-gray-100 px-5 py-4">
          <button onClick={onClose} className="flex-1 rounded-lg border border-gray-200 py-2 text-sm hover:bg-gray-50">Batal</button>
          <button
            disabled={loading || generating}
            onClick={downloadPdf}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#1B8A7A] py-2 text-sm font-semibold text-white hover:bg-[#0F6E56] disabled:bg-gray-300"
          >
            {loading || generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
            Download PDF A4
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function KaryawanPage() {
  const { user } = useAuth()
  const [list, setList] = useState<Karyawan[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('Semua')
  const [showModal, setShowModal] = useState(false)
  const [editKaryawan, setEditKaryawan] = useState<Karyawan | null>(null)
  const [downloadEmployee, setDownloadEmployee] = useState<Karyawan | null>(null)
  const [downloadFiles, setDownloadFiles] = useState<KaryawanFiles>({})
  const [downloadLoading, setDownloadLoading] = useState(false)

  useEffect(() => subscribeArr(PATH, data => { setList(data); setLoading(false) }), [])

  const filtered = list.filter(k => {
    const q = search.toLowerCase()
    const matchS = statusFilter === 'Semua' || k.status === statusFilter
    const matchQ = !q || [k.nama, k.jabatan, k.dept, k.email].some(v => (v || '').toLowerCase().includes(q))
    return matchS && matchQ
  })

  const handleSave = async (k: Karyawan, files: KaryawanFiles) => {
    const idx = list.findIndex(x => x.id === k.id)
    const updated = idx >= 0 ? list.map((x, i) => i === idx ? k : x) : [k, ...list]
    await Promise.all([saveArr(updated), saveEmployeeFiles(k.id, files)])
    setList(updated)
    setShowModal(false)
    setEditKaryawan(null)
  }

  const handleDelete = async (k: Karyawan) => {
    if (!confirm(`Hapus karyawan ${k.nama}? Data dan seluruh lampirannya juga akan dihapus.`)) return
    const updated = list.filter(x => x.id !== k.id)
    await Promise.all([saveArr(updated), remove(ref(db, `${FILES_PATH}/${k.id}`))])
    setList(updated)
  }

  const openNew = () => { setEditKaryawan(null); setShowModal(true) }
  const openEdit = (k: Karyawan) => { setEditKaryawan(k); setShowModal(true) }
  const closeModal = () => { setShowModal(false); setEditKaryawan(null) }

  const openDownload = async (employee: Karyawan) => {
    setDownloadEmployee(employee)
    setDownloadFiles({})
    setDownloadLoading(true)
    try {
      setDownloadFiles(await loadEmployeeFiles(employee.id))
    } catch (error) {
      console.error(error)
      alert('Lampiran tidak dapat dimuat. PDF tetap bisa dibuat tanpa lampiran.')
    } finally {
      setDownloadLoading(false)
    }
  }

  const handleExport = () => {
    const headers = ['ID','Nama','NIK','Jabatan','Dept','Status','Gaji Pokok','Bank','No Rek','Atas Nama','Tgl Join','HP','Email']
    const rows = list.map(k => [k.id,k.nama,k.nik,k.jabatan,k.dept,k.status,k.gajiPokok,k.bank,k.noRek,k.atasNama,k.tgljoin,k.hp,k.email].map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(','))
    const blob = new Blob(['\uFEFF'+[headers.join(','),...rows].join('\n')],{type:'text/csv;charset=utf-8;'})
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `Karyawan_FinanceBub_${new Date().toISOString().slice(0,10)}.csv`; a.click()
    URL.revokeObjectURL(a.href)
  }

  const aktif = list.filter(k => k.status === 'Aktif').length
  const totalGaji = list.filter(k => k.status === 'Aktif').reduce((a, k) => a + (k.gajiPokok || 0), 0)

  return (
    <div className="p-6">
      {showModal && (
        <KaryawanModal initial={editKaryawan} onSave={handleSave} onClose={closeModal} />
      )}

      {downloadEmployee && (
        <DownloadEmployeeModal
          employee={downloadEmployee}
          files={downloadFiles}
          loading={downloadLoading}
          onClose={() => { setDownloadEmployee(null); setDownloadFiles({}) }}
        />
      )}

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Database Karyawan</h1>
          <p className="text-sm text-gray-400 mt-0.5">{aktif} aktif · Total gaji pokok Rp {fmt(totalGaji)}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExport} className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 text-sm rounded-lg hover:bg-gray-50 text-gray-600">
            <Download size={14} /> CSV
          </button>
          {user?.role === 'admin' && (
            <button onClick={openNew} className="flex items-center gap-1.5 px-4 py-2 bg-[#1B8A7A] hover:bg-[#0F6E56] text-white text-sm font-semibold rounded-lg">
              <Plus size={15} /> Tambah Karyawan
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-5">
        {[
          { label: 'Karyawan Aktif', value: aktif, color: '#1B8A7A' },
          { label: 'Total Karyawan', value: list.length, color: '#185FA5' },
          { label: 'Total Gaji Pokok', value: `Rp ${fmt(totalGaji)}`, color: '#3B6D11' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <div className="text-xs text-gray-400 mb-1">{s.label}</div>
            <div className="text-base font-bold" style={{ color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Cari nama, jabatan, departemen..."
            className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A] bg-white" />
        </div>
        <div className="flex gap-1.5">
          {['Semua','Aktif','Tidak Aktif','Resign'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-2 text-xs font-medium rounded-lg transition-colors ${statusFilter === s ? 'bg-[#1B8A7A] text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">{[...Array(5)].map((_,i) => <div key={i} className="h-12 bg-gray-50 rounded animate-pulse" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <User className="w-10 h-10 text-gray-200 mx-auto mb-3" />
            <p className="text-sm text-gray-400">{search ? 'Tidak ada hasil' : 'Belum ada data karyawan'}</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                {['Nama','Jabatan','Departemen','Status','Gaji Pokok','Bank','Tgl Join',''].map((h,i) => (
                  <th key={i} className={`text-[10px] font-semibold text-gray-400 px-4 py-3 ${i > 3 ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((k, i) => (
                <tr key={k.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors group"
                  style={{ backgroundColor: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-gray-900">{k.nama}</div>
                    {k.hp && <div className="text-[11px] text-gray-400">{k.hp}</div>}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{k.jabatan || '—'}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{k.dept || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_STYLE[k.status] || 'bg-gray-100 text-gray-500'}`}>{k.status}</span>
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-gray-700">{k.gajiPokok ? `Rp ${fmt(k.gajiPokok)}` : '—'}</td>
                  <td className="px-4 py-3 text-right text-xs text-gray-500">{k.bank ? `${k.bank} · ${maskAccount(k.noRek)}` : '—'}</td>
                  <td className="px-4 py-3 text-right text-xs text-gray-500">{k.tgljoin || '—'}</td>
                  <td className="px-4 py-3">
                    {user?.role === 'admin' && (
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 justify-end">
                        <button title="Download profil PDF" onClick={() => openDownload(k)} className="p-1.5 hover:bg-emerald-50 rounded-lg text-gray-400 hover:text-[#1B8A7A]"><FileDown size={13} /></button>
                        <button title="Edit karyawan" onClick={() => openEdit(k)} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600"><Pencil size={13} /></button>
                        <button title="Hapus karyawan" onClick={() => handleDelete(k)} className="p-1.5 hover:bg-red-50 rounded-lg text-gray-400 hover:text-red-500"><Trash2 size={13} /></button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
