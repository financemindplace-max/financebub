'use client'

import { ChangeEvent, DragEvent, useEffect, useMemo, useState } from 'react'
import {
  Download,
  File,
  FileText,
  Folder,
  KeyRound,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import {
  downloadVaultFile,
  fetchVault,
  fileToDataUrl,
  formatFileSize,
  hashPin,
  saveVaultFiles,
  saveVaultFolders,
  saveVaultMeta,
  updateVaultFileFolder,
  type VaultFile,
  type VaultFolder,
  type VaultState,
} from '@/lib/document-vault'
import { cn } from '@/lib/utils'

const MAX_FILE_SIZE = 8 * 1024 * 1024
const OUTSIDE_FOLDER = '__outside__'

function normalizeFolderId(value: string | null | undefined) {
  return value && value !== OUTSIDE_FOLDER ? value : null
}

type VaultMessage = { type: 'success' | 'error'; text: string } | null

function newId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function sanitizePin(value: string) {
  return value.replace(/\D/g, '').slice(0, 12)
}

function shortDate(value: string) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function fileKind(file: VaultFile) {
  const name = file.name.toLowerCase()
  if (file.type.includes('pdf') || name.endsWith('.pdf')) return 'PDF'
  if (file.type.includes('word') || name.endsWith('.doc') || name.endsWith('.docx')) return 'WORD'
  if (file.type.includes('excel') || name.endsWith('.xls') || name.endsWith('.xlsx')) return 'EXCEL'
  if (file.type.includes('image')) return 'IMAGE'
  if (file.type.includes('zip') || name.endsWith('.zip') || name.endsWith('.rar')) return 'ARCHIVE'
  return 'FILE'
}

function getFolderName(folders: VaultFolder[], folderId: string | null) {
  if (!folderId) return 'Di luar folder'
  return folders.find(folder => folder.id === folderId)?.name || 'Folder tidak ditemukan'
}

export default function DocumentVaultPage() {
  const { user } = useAuth()
  const isAdmin = user?.role?.toLowerCase() === 'admin'
  const [vault, setVault] = useState<VaultState>({ folders: [], files: [], pinHash: '' })
  const [loading, setLoading] = useState(true)
  const [unlocked, setUnlocked] = useState(false)
  const [pin, setPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [message, setMessage] = useState<VaultMessage>(null)
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [uploadFolderId, setUploadFolderId] = useState<string | null>(null)
  const [newFolderName, setNewFolderName] = useState('')
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [search, setSearch] = useState('')
  const [dragFileId, setDragFileId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    fetchVault().then(data => {
      if (!active) return
      setVault(data)
      setLoading(false)
    })
    return () => { active = false }
  }, [])

  const folderCounts = useMemo(() => {
    const counts: Record<string, number> = { [OUTSIDE_FOLDER]: 0 }
    vault.folders.forEach(folder => { counts[folder.id] = 0 })
    vault.files.forEach(file => {
      const key = normalizeFolderId(file.folderId) || OUTSIDE_FOLDER
      counts[key] = (counts[key] || 0) + 1
    })
    return counts
  }, [vault.files, vault.folders])

  const visibleFiles = useMemo(() => {
    const query = search.trim().toLowerCase()
    return vault.files
      .filter(file => normalizeFolderId(file.folderId) === normalizeFolderId(selectedFolderId))
      .filter(file => !query || file.name.toLowerCase().includes(query) || fileKind(file).toLowerCase().includes(query))
      .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime())
  }, [search, selectedFolderId, vault.files])

  const totalSize = useMemo(() => vault.files.reduce((sum, file) => sum + (file.size || 0), 0), [vault.files])

  const setupPin = async () => {
    const cleanPin = sanitizePin(newPin)
    if (cleanPin.length < 4) return setMessage({ type: 'error', text: 'PIN minimal 4 angka.' })
    if (cleanPin !== sanitizePin(confirmPin)) return setMessage({ type: 'error', text: 'Konfirmasi PIN belum sama.' })
    const nextVault = { ...vault, pinHash: await hashPin(cleanPin) }
    setSaving(true)
    setMessage(null)
    try {
      await saveVaultMeta({ pinHash: nextVault.pinHash, folders: nextVault.folders })
      setVault(nextVault)
      setMessage({ type: 'success', text: 'PIN dokumen berhasil disimpan.' })
      setUnlocked(true)
    } catch (error) {
      console.error(error)
      setMessage({ type: 'error', text: 'Gagal menyimpan PIN. Coba ulangi lagi.' })
    } finally {
      setSaving(false)
    }
    setNewPin('')
    setConfirmPin('')
  }

  const unlockVault = async () => {
    const cleanPin = sanitizePin(pin)
    if (!cleanPin) return
    const hashed = await hashPin(cleanPin)
    if (hashed !== vault.pinHash) {
      setMessage({ type: 'error', text: 'PIN salah.' })
      return
    }
    setUnlocked(true)
    setPin('')
    setMessage({ type: 'success', text: 'Dokumen berhasil dibuka.' })
  }

  const resetPin = async () => {
    if (!confirm('Ganti PIN? Setelah ini kamu perlu membuat PIN baru.')) return
    setSaving(true)
    setMessage(null)
    try {
      const nextVault = { ...vault, pinHash: '' }
      await saveVaultMeta({ pinHash: '', folders: nextVault.folders })
      setVault(nextVault)
      setMessage({ type: 'success', text: 'PIN lama dihapus. Buat PIN baru.' })
      setUnlocked(false)
    } catch (error) {
      console.error(error)
      setMessage({ type: 'error', text: 'Gagal menghapus PIN lama.' })
    } finally {
      setSaving(false)
    }
  }

  const addFolder = async () => {
    const name = newFolderName.trim()
    if (!name) {
      setMessage({ type: 'error', text: 'Nama folder belum diisi.' })
      return
    }
    if (saving) return
    const duplicate = vault.folders.some(folder => folder.name.trim().toLowerCase() === name.toLowerCase())
    if (duplicate) {
      setMessage({ type: 'error', text: `Folder "${name}" sudah ada.` })
      return
    }
    const now = new Date().toISOString()
    const nextFolders = [...vault.folders, { id: newId('folder'), name, createdAt: now, updatedAt: now }]
    setSaving(true)
    setMessage(null)
    try {
      await saveVaultFolders(nextFolders)
      setVault(prev => ({ ...prev, folders: nextFolders }))
      setNewFolderName('')
      setMessage({ type: 'success', text: `Folder "${name}" berhasil dibuat.` })
    } catch (error) {
      console.error(error)
      setMessage({ type: 'error', text: 'Gagal membuat folder. Coba ulangi lagi.' })
    } finally {
      setSaving(false)
    }
  }

  const renameFolder = async (folderId: string) => {
    const name = renameValue.trim()
    if (!name) return
    if (saving) return
    const duplicate = vault.folders.some(folder => folder.id !== folderId && folder.name.trim().toLowerCase() === name.toLowerCase())
    if (duplicate) {
      setMessage({ type: 'error', text: `Folder "${name}" sudah ada.` })
      return
    }
    const nextFolders = vault.folders.map(folder => folder.id === folderId ? { ...folder, name, updatedAt: new Date().toISOString() } : folder)
    setSaving(true)
    setMessage(null)
    try {
      await saveVaultFolders(nextFolders)
      setVault(prev => ({ ...prev, folders: nextFolders }))
      setRenamingFolderId(null)
      setRenameValue('')
      setMessage({ type: 'success', text: 'Nama folder berhasil diubah.' })
    } catch (error) {
      console.error(error)
      setMessage({ type: 'error', text: 'Gagal mengganti nama folder.' })
    } finally {
      setSaving(false)
    }
  }

  const deleteFolder = async (folderId: string) => {
    const folder = vault.folders.find(item => item.id === folderId)
    if (!folder) return
    if (saving) return
    if (!confirm(`Hapus folder "${folder.name}"? Dokumen di dalamnya akan dipindah ke luar folder.`)) return
    const nextFolders = vault.folders.filter(item => item.id !== folderId)
    const nextFiles = vault.files.map(file => file.folderId === folderId ? { ...file, folderId: null, updatedAt: new Date().toISOString() } : file)
    setSaving(true)
    setMessage(null)
    try {
      await saveVaultFolders(nextFolders)
      await Promise.all(vault.files.map((file, index) => file.folderId === folderId ? updateVaultFileFolder(index, null) : Promise.resolve()))
      setVault(prev => ({ ...prev, folders: nextFolders, files: nextFiles }))
      if (selectedFolderId === folderId) setSelectedFolderId(null)
      setMessage({ type: 'success', text: 'Folder dihapus. Dokumen dipindah ke luar folder.' })
    } catch (error) {
      console.error(error)
      setMessage({ type: 'error', text: 'Gagal menghapus folder.' })
    } finally {
      setSaving(false)
    }
  }

  const uploadFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || [])
    event.target.value = ''
    if (!selectedFiles.length) return

    const tooLarge = selectedFiles.find(file => file.size > MAX_FILE_SIZE)
    if (tooLarge) {
      setMessage({ type: 'error', text: `${tooLarge.name} terlalu besar. Maksimal ${formatFileSize(MAX_FILE_SIZE)} per file.` })
      return
    }

    setSaving(true)
    setMessage(null)
    try {
      const now = new Date().toISOString()
      const newFiles: VaultFile[] = []
      for (const file of selectedFiles) {
        newFiles.push({
          id: newId('file'),
          name: file.name,
          type: file.type || 'application/octet-stream',
          size: file.size,
          dataUrl: await fileToDataUrl(file),
          folderId: normalizeFolderId(uploadFolderId),
          createdAt: now,
          updatedAt: now,
        })
      }
      const nextVault = { ...vault, files: [...newFiles, ...vault.files] }
      await saveVaultFiles(nextVault.files)
      setVault(nextVault)
      setMessage({ type: 'success', text: `${newFiles.length} dokumen berhasil diunggah.` })
    } catch (error) {
      console.error(error)
      setMessage({ type: 'error', text: 'Gagal upload dokumen. Coba file yang lebih kecil.' })
    } finally {
      setSaving(false)
    }
  }

  const deleteFile = async (fileId: string) => {
    const file = vault.files.find(item => item.id === fileId)
    if (!file) return
    if (!confirm(`Hapus dokumen "${file.name}"?`)) return
    const nextFiles = vault.files.filter(item => item.id !== fileId)
    setSaving(true)
    setMessage(null)
    try {
      await saveVaultFiles(nextFiles)
      setVault(prev => ({ ...prev, files: nextFiles }))
      setMessage({ type: 'success', text: 'Dokumen berhasil dihapus.' })
    } catch (error) {
      console.error(error)
      setMessage({ type: 'error', text: 'Gagal menghapus dokumen.' })
    } finally {
      setSaving(false)
    }
  }

  const moveFile = async (fileId: string, folderId: string | null) => {
    const file = vault.files.find(item => item.id === fileId)
    const cleanFolderId = normalizeFolderId(folderId)
    if (!file || normalizeFolderId(file.folderId) === cleanFolderId) return
    const now = new Date().toISOString()
    const nextFiles = vault.files.map(item => item.id === fileId ? { ...item, folderId: cleanFolderId, updatedAt: now } : item)
    setSaving(true)
    setMessage(null)
    try {
      await updateVaultFileFolder(file.id, cleanFolderId)
      setVault(prev => ({ ...prev, files: nextFiles }))
      setMessage({ type: 'success', text: `Dokumen dipindahkan ke ${getFolderName(vault.folders, cleanFolderId)}.` })
    } catch (error) {
      console.error(error)
      setMessage({ type: 'error', text: 'Gagal memindahkan dokumen.' })
    } finally {
      setSaving(false)
    }
  }

  const handleDrop = async (event: DragEvent<HTMLButtonElement | HTMLDivElement>, folderId: string | null) => {
    event.preventDefault()
    const fileId = event.dataTransfer.getData('text/plain') || dragFileId
    setDropTarget(null)
    setDragFileId(null)
    if (!fileId) return
    await moveFile(fileId, normalizeFolderId(folderId))
  }

  if (!isAdmin) {
    return (
      <div className="p-8">
        <div className="bg-white border border-red-100 rounded-2xl p-8 max-w-xl shadow-sm">
          <div className="w-12 h-12 rounded-xl bg-red-50 text-red-600 flex items-center justify-center mb-4">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Akses Ditolak</h1>
          <p className="text-sm text-gray-500 mt-2">Menu Dokumen Perusahaan hanya bisa dibuka oleh user dengan role admin.</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[#1B8A7A]" />
      </div>
    )
  }

  if (!vault.pinHash) {
    return (
      <div className="p-8">
        <div className="max-w-lg bg-white border border-gray-100 rounded-2xl shadow-sm p-7">
          <div className="w-12 h-12 rounded-xl bg-[#E1F5EE] text-[#1B8A7A] flex items-center justify-center mb-4">
            <KeyRound className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Buat PIN Dokumen</h1>
          <p className="text-sm text-gray-500 mt-2">PIN ini dibutuhkan setiap kali membuka menu dokumen rahasia perusahaan.</p>
          {message && <div className={cn('mt-4 rounded-xl px-4 py-3 text-sm', message.type === 'error' ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700')}>{message.text}</div>}
          <div className="mt-6 space-y-4">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase">PIN angka</label>
              <input value={newPin} onChange={event => setNewPin(sanitizePin(event.target.value))} type="password" inputMode="numeric" className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-[#1B8A7A]" placeholder="Minimal 4 angka" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase">Ulangi PIN</label>
              <input value={confirmPin} onChange={event => setConfirmPin(sanitizePin(event.target.value))} type="password" inputMode="numeric" className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-[#1B8A7A]" placeholder="Ulangi PIN" />
            </div>
            <button type="button" onClick={setupPin} disabled={saving} className="w-full rounded-xl bg-[#1B8A7A] text-white text-sm font-semibold py-3 hover:opacity-90 disabled:opacity-50">
              {saving ? 'Menyimpan...' : 'Simpan PIN'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!unlocked) {
    return (
      <div className="p-8">
        <div className="max-w-lg bg-white border border-gray-100 rounded-2xl shadow-sm p-7">
          <div className="w-12 h-12 rounded-xl bg-[#E1F5EE] text-[#1B8A7A] flex items-center justify-center mb-4">
            <Lock className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Dokumen Perusahaan</h1>
          <p className="text-sm text-gray-500 mt-2">Masukkan PIN angka untuk membuka folder credential dan dokumen perusahaan.</p>
          {message && <div className={cn('mt-4 rounded-xl px-4 py-3 text-sm', message.type === 'error' ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700')}>{message.text}</div>}
          <div className="mt-6 space-y-4">
            <input value={pin} onChange={event => setPin(sanitizePin(event.target.value))} onKeyDown={event => { if (event.key === 'Enter') unlockVault() }} type="password" inputMode="numeric" autoFocus className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-[#1B8A7A]" placeholder="Masukkan PIN" />
            <button type="button" onClick={unlockVault} className="w-full rounded-xl bg-[#1B8A7A] text-white text-sm font-semibold py-3 hover:opacity-90">Buka Dokumen</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dokumen Perusahaan</h1>
          <p className="text-sm text-gray-500 mt-1">Upload, simpan, pindahkan, dan unduh dokumen rahasia perusahaan.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setUnlocked(false)} className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 flex items-center gap-2">
            <Lock className="w-4 h-4" /> Kunci
          </button>
          <button type="button" onClick={resetPin} className="rounded-xl border border-red-100 bg-red-50 px-4 py-2 text-sm text-red-600 hover:bg-red-100 flex items-center gap-2">
            <KeyRound className="w-4 h-4" /> Ganti PIN
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="rounded-2xl bg-white border border-gray-100 p-5 shadow-sm">
          <div className="text-xs text-gray-400 font-semibold uppercase">Folder</div>
          <div className="text-2xl font-bold mt-2">{vault.folders.length}</div>
        </div>
        <div className="rounded-2xl bg-white border border-gray-100 p-5 shadow-sm">
          <div className="text-xs text-gray-400 font-semibold uppercase">Dokumen</div>
          <div className="text-2xl font-bold mt-2">{vault.files.length}</div>
        </div>
        <div className="rounded-2xl bg-white border border-gray-100 p-5 shadow-sm">
          <div className="text-xs text-gray-400 font-semibold uppercase">Total Size</div>
          <div className="text-2xl font-bold mt-2">{formatFileSize(totalSize)}</div>
        </div>
        <div className="rounded-2xl bg-white border border-gray-100 p-5 shadow-sm">
          <div className="text-xs text-gray-400 font-semibold uppercase">Status</div>
          <div className="text-sm font-semibold text-[#1B8A7A] mt-3 flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> Admin + PIN</div>
        </div>
      </div>

      {message && <div className={cn('rounded-xl px-4 py-3 text-sm border', message.type === 'error' ? 'bg-red-50 text-red-600 border-red-100' : 'bg-emerald-50 text-emerald-700 border-emerald-100')}>{message.text}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-[310px_1fr] gap-5">
        <aside className="space-y-4">
          <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-gray-900">Folder</h2>
              {saving && <Loader2 className="w-4 h-4 animate-spin text-[#1B8A7A]" />}
            </div>
            <div className="flex gap-2 mb-3">
              <input value={newFolderName} onInput={event => setNewFolderName(event.currentTarget.value)} onChange={event => setNewFolderName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addFolder() } }} className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-2 text-xs outline-none focus:border-[#1B8A7A]" placeholder="Nama folder baru" />
              <button type="button" onClick={addFolder} disabled={saving} className="w-9 h-9 rounded-xl bg-[#1B8A7A] text-white flex items-center justify-center hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed" title="Buat folder"><Plus className="w-4 h-4" /></button>
            </div>

            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setSelectedFolderId(null)}
                onDragOver={event => { event.preventDefault(); setDropTarget(OUTSIDE_FOLDER) }}
                onDragLeave={() => setDropTarget(null)}
                onDrop={event => handleDrop(event, null)}
                className={cn('w-full rounded-xl border px-3 py-3 text-left transition-all', selectedFolderId === null ? 'border-[#1B8A7A] bg-[#E1F5EE]' : 'border-gray-100 bg-gray-50 hover:bg-gray-100', dropTarget === OUTSIDE_FOLDER && 'ring-2 ring-[#1B8A7A]')}
              >
                <div className="flex items-center gap-2">
                  <Folder className="w-4 h-4 text-[#1B8A7A]" />
                  <span className="text-sm font-semibold text-gray-800">Di luar folder</span>
                  <span className="ml-auto text-xs text-gray-400">{folderCounts[OUTSIDE_FOLDER] || 0}</span>
                </div>
              </button>

              {vault.folders.map(folder => (
                <div
                  key={folder.id}
                  onDragOver={event => { event.preventDefault(); setDropTarget(folder.id) }}
                  onDragLeave={() => setDropTarget(null)}
                  onDrop={event => handleDrop(event, folder.id)}
                  className={cn('rounded-xl border transition-all', selectedFolderId === folder.id ? 'border-[#1B8A7A] bg-[#E1F5EE]' : 'border-gray-100 bg-white hover:bg-gray-50', dropTarget === folder.id && 'ring-2 ring-[#1B8A7A]')}
                >
                  <button type="button" onClick={() => setSelectedFolderId(folder.id)} className="w-full px-3 py-3 text-left">
                    <div className="flex items-center gap-2">
                      <Folder className="w-4 h-4 text-[#1B8A7A]" />
                      {renamingFolderId === folder.id ? (
                        <input
                          value={renameValue}
                          onChange={event => setRenameValue(event.target.value)}
                          onClick={event => event.stopPropagation()}
                          onKeyDown={event => {
                            if (event.key === 'Enter') renameFolder(folder.id)
                            if (event.key === 'Escape') setRenamingFolderId(null)
                          }}
                          className="min-w-0 flex-1 rounded-lg border border-gray-200 px-2 py-1 text-xs outline-none focus:border-[#1B8A7A]"
                          autoFocus
                        />
                      ) : (
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-800">{folder.name}</span>
                      )}
                      <span className="text-xs text-gray-400">{folderCounts[folder.id] || 0}</span>
                    </div>
                  </button>
                  <div className="px-3 pb-3 flex items-center gap-2">
                    {renamingFolderId === folder.id ? (
                      <>
                        <button type="button" onClick={() => renameFolder(folder.id)} className="text-[11px] font-semibold text-[#1B8A7A]">Simpan</button>
                        <button type="button" onClick={() => setRenamingFolderId(null)} className="text-[11px] text-gray-400">Batal</button>
                      </>
                    ) : (
                      <>
                        <button type="button" onClick={() => { setRenamingFolderId(folder.id); setRenameValue(folder.name) }} className="text-[11px] text-gray-400 hover:text-[#1B8A7A] flex items-center gap-1"><Pencil className="w-3 h-3" /> Rename</button>
                        <button type="button" onClick={() => deleteFolder(folder.id)} className="text-[11px] text-gray-400 hover:text-red-600 flex items-center gap-1"><Trash2 className="w-3 h-3" /> Hapus</button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <main className="space-y-4">
          <section className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
            <div className="flex flex-wrap items-center gap-3 justify-between">
              <div>
                <h2 className="text-sm font-bold text-gray-900">Upload Dokumen</h2>
                <p className="text-xs text-gray-400 mt-1">Bisa PDF, Word, Excel, gambar, ZIP, atau file lain. Maksimal {formatFileSize(MAX_FILE_SIZE)} per file.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select value={normalizeFolderId(uploadFolderId) || OUTSIDE_FOLDER} onChange={event => setUploadFolderId(event.target.value === OUTSIDE_FOLDER ? null : event.target.value)} className="rounded-xl border border-gray-200 px-3 py-2 text-xs outline-none focus:border-[#1B8A7A]">
                  <option value={OUTSIDE_FOLDER}>Upload di luar folder</option>
                  {vault.folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                </select>
                <label className="rounded-xl bg-[#1B8A7A] text-white px-4 py-2 text-sm font-semibold hover:opacity-90 cursor-pointer flex items-center gap-2">
                  <Upload className="w-4 h-4" /> Unggah Dokumen
                  <input type="file" multiple className="hidden" onChange={uploadFiles} />
                </label>
              </div>
            </div>
          </section>

          <section className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-gray-900">{getFolderName(vault.folders, normalizeFolderId(selectedFolderId))}</h2>
                <p className="text-xs text-gray-400 mt-1">Drag dokumen ke folder kiri untuk memindahkan.</p>
              </div>
              <div className="relative w-full sm:w-80">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input value={search} onChange={event => setSearch(event.target.value)} className="w-full rounded-xl border border-gray-200 pl-9 pr-3 py-2 text-sm outline-none focus:border-[#1B8A7A]" placeholder="Cari dokumen..." />
              </div>
            </div>

            {visibleFiles.length === 0 ? (
              <div className="p-10 text-center text-gray-400">
                <FileText className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <div className="text-sm font-semibold">Belum ada dokumen</div>
                <div className="text-xs mt-1">Upload dokumen atau pindahkan file ke folder ini.</div>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {visibleFiles.map(file => (
                  <div
                    key={file.id}
                    draggable
                    onDragStart={event => { setDragFileId(file.id); event.dataTransfer.setData('text/plain', file.id) }}
                    onDragEnd={() => { setDragFileId(null); setDropTarget(null) }}
                    className={cn('p-4 flex flex-wrap items-center gap-3 hover:bg-gray-50 transition-colors cursor-grab active:cursor-grabbing', dragFileId === file.id && 'opacity-50')}
                  >
                    <div className="w-10 h-10 rounded-xl bg-[#E1F5EE] text-[#1B8A7A] flex items-center justify-center flex-shrink-0">
                      {fileKind(file) === 'PDF' ? <FileText className="w-5 h-5" /> : <File className="w-5 h-5" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-semibold text-gray-900 truncate max-w-xl">{file.name}</div>
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500">{fileKind(file)}</span>
                      </div>
                      <div className="text-xs text-gray-400 mt-1">{formatFileSize(file.size)} · {shortDate(file.createdAt)} · {getFolderName(vault.folders, normalizeFolderId(file.folderId))}</div>
                    </div>
                    <div className="flex items-center gap-2 ml-auto">
                      <button type="button" onClick={() => downloadVaultFile(file)} className="rounded-xl bg-[#E1F5EE] text-[#1B8A7A] px-3 py-2 text-xs font-semibold hover:bg-[#c8ece3] flex items-center gap-1.5">
                        <Download className="w-3.5 h-3.5" /> Download
                      </button>
                      <button type="button" onClick={() => deleteFile(file.id)} className="w-9 h-9 rounded-xl text-gray-400 hover:bg-red-50 hover:text-red-600 flex items-center justify-center">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  )
}
