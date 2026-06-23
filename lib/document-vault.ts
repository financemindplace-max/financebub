import { get, ref, set, update } from 'firebase/database'
import { db } from '@/lib/firebase'

const USER_ID = 'financebub-main'
const VAULT_PATH = `users/${USER_ID}/document_vault`

export interface VaultFolder {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface VaultFile {
  id: string
  name: string
  type: string
  size: number
  dataUrl: string
  folderId: string | null
  createdAt: string
  updatedAt: string
}

export interface VaultState {
  pinHash?: string
  folders: VaultFolder[]
  files: VaultFile[]
  updatedAt?: string
}

export const EMPTY_VAULT_STATE: VaultState = {
  pinHash: '',
  folders: [],
  files: [],
  updatedAt: '',
}

function listFromFirebase<T = unknown>(value: unknown): T[] {
  if (Array.isArray(value)) return value.filter(Boolean) as T[]
  if (value && typeof value === 'object') return Object.values(value as Record<string, T>).filter(Boolean)
  return []
}

function normalizeFolder(item: Partial<VaultFolder>): VaultFolder {
  const now = new Date().toISOString()
  return {
    id: String(item.id || `folder_${Date.now()}_${Math.random().toString(16).slice(2)}`),
    name: String(item.name || 'Folder Tanpa Nama'),
    createdAt: String(item.createdAt || now),
    updatedAt: String(item.updatedAt || item.createdAt || now),
  }
}

function normalizeFolderId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function normalizeFile(item: Partial<VaultFile>): VaultFile {
  const now = new Date().toISOString()
  return {
    id: String(item.id || `file_${Date.now()}_${Math.random().toString(16).slice(2)}`),
    name: String(item.name || 'Dokumen Tanpa Nama'),
    type: String(item.type || 'application/octet-stream'),
    size: Number(item.size || 0),
    dataUrl: String(item.dataUrl || ''),
    folderId: normalizeFolderId(item.folderId),
    createdAt: String(item.createdAt || now),
    updatedAt: String(item.updatedAt || item.createdAt || now),
  }
}

export async function fetchVault(): Promise<VaultState> {
  try {
    const snap = await get(ref(db, VAULT_PATH))
    if (!snap.exists()) return { ...EMPTY_VAULT_STATE }
    const value = snap.val() || {}
    return {
      pinHash: typeof value.pinHash === 'string' ? value.pinHash : '',
      folders: listFromFirebase<Partial<VaultFolder>>(value.folders).map(normalizeFolder),
      files: listFromFirebase<Partial<VaultFile>>(value.files).map(normalizeFile),
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
    }
  } catch {
    return { ...EMPTY_VAULT_STATE }
  }
}

export async function saveVault(state: VaultState): Promise<void> {
  await set(ref(db, VAULT_PATH), {
    pinHash: state.pinHash || '',
    folders: (state.folders || []).map(normalizeFolder),
    files: (state.files || []).map(normalizeFile),
    updatedAt: new Date().toISOString(),
  })
}

export async function saveVaultMeta(state: Pick<VaultState, 'pinHash' | 'folders'>): Promise<void> {
  await update(ref(db, VAULT_PATH), {
    pinHash: state.pinHash || '',
    folders: (state.folders || []).map(normalizeFolder),
    updatedAt: new Date().toISOString(),
  })
}

export async function saveVaultFolders(folders: VaultFolder[]): Promise<void> {
  await update(ref(db, VAULT_PATH), {
    folders: (folders || []).map(normalizeFolder),
    updatedAt: new Date().toISOString(),
  })
}

export async function saveVaultFiles(files: VaultFile[]): Promise<void> {
  await update(ref(db, VAULT_PATH), {
    files: (files || []).map(normalizeFile),
    updatedAt: new Date().toISOString(),
  })
}

export async function updateVaultFileFolder(fileIdentifier: number | string, folderId: string | null): Promise<void> {
  const now = new Date().toISOString()

  if (typeof fileIdentifier === 'number') {
    await update(ref(db, `${VAULT_PATH}/files/${fileIdentifier}`), {
      folderId: normalizeFolderId(folderId),
      updatedAt: now,
    })
    await update(ref(db, VAULT_PATH), { updatedAt: now })
    return
  }

  const snap = await get(ref(db, `${VAULT_PATH}/files`))
  const rawFiles = snap.val()
  if (Array.isArray(rawFiles)) {
    const index = rawFiles.findIndex(file => file && file.id === fileIdentifier)
    if (index >= 0) {
      await update(ref(db, `${VAULT_PATH}/files/${index}`), {
        folderId: normalizeFolderId(folderId),
        updatedAt: now,
      })
      await update(ref(db, VAULT_PATH), { updatedAt: now })
      return
    }
  }

  if (rawFiles && typeof rawFiles === 'object') {
    const key = Object.keys(rawFiles).find(itemKey => rawFiles[itemKey]?.id === fileIdentifier)
    if (key) {
      await update(ref(db, `${VAULT_PATH}/files/${key}`), {
        folderId: normalizeFolderId(folderId),
        updatedAt: now,
      })
      await update(ref(db, VAULT_PATH), { updatedAt: now })
      return
    }
  }

  throw new Error('Dokumen tidak ditemukan di database.')
}

export async function hashPin(pin: string): Promise<string> {
  const cleanPin = String(pin || '').replace(/\D/g, '')
  const encoder = new TextEncoder()
  const buffer = await crypto.subtle.digest('SHA-256', encoder.encode(`financebub-vault:${cleanPin}`))
  return Array.from(new Uint8Array(buffer)).map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export function formatFileSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return '0 B'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(2)} MB`
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, payload] = dataUrl.split(',')
  const mime = meta.match(/data:(.*?);base64/)?.[1] || 'application/octet-stream'
  const binary = atob(payload || '')
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: mime })
}

export function downloadVaultFile(file: VaultFile) {
  if (!file.dataUrl) {
    alert('File ini belum memiliki data download. Coba upload ulang dokumen tersebut.')
    return
  }

  try {
    const blob = file.dataUrl.startsWith('data:') ? dataUrlToBlob(file.dataUrl) : new Blob([file.dataUrl], { type: file.type || 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = file.name || 'dokumen'
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1500)
  } catch (error) {
    console.error(error)
    const anchor = document.createElement('a')
    anchor.href = file.dataUrl
    anchor.download = file.name || 'dokumen'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  }
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
