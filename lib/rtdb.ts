import { ref, get, set, onValue, off } from 'firebase/database'
import { db } from './firebase'
import type { Doc } from '@/types/document'

const USER_ID = 'financebub-main'

// Path helpers — sama persis dengan Finance Suite existing
export const getDocPath = (year: number, type: 'q' | 'i') =>
  `users/${USER_ID}/data/yr_${year}_${type}`

export const getGlobalPath = () => `users/${USER_ID}/global`

// Read docs sekali
export async function fetchDocs(year: number, type: 'q' | 'i'): Promise<Doc[]> {
  try {
    const snap = await get(ref(db, getDocPath(year, type)))
    if (!snap.exists()) return []
    const val = snap.val()
    const arr = typeof val === 'string' ? JSON.parse(val) : val
    return Array.isArray(arr) ? arr.filter(Boolean) : []
  } catch {
    return []
  }
}

// Save docs
// logoData & sigData di-strip sebelum disimpan karena keduanya sudah tersimpan
// di global config dan akan di-load ulang saat PDF digenerate.
// Ini mencegah node Firebase membengkak melewati batas 10MB.
export async function saveDocs(year: number, type: 'q' | 'i', docs: Doc[]): Promise<void> {
  const stripped = docs.map(({ logoData, sigData, ...rest }) => rest)
  await set(ref(db, getDocPath(year, type)), JSON.stringify(stripped))
  // Update timestamp
  await set(ref(db, `users/${USER_ID}/data/_ts`), Date.now())
}

// Subscribe realtime
export function subscribeDocs(
  year: number,
  type: 'q' | 'i',
  callback: (docs: Doc[]) => void
) {
  const dbRef = ref(db, getDocPath(year, type))
  const handler = (snap: any) => {
    if (!snap.exists()) { callback([]); return }
    try {
      const val = snap.val()
      const arr = typeof val === 'string' ? JSON.parse(val) : val
      callback(Array.isArray(arr) ? arr.filter(Boolean) : [])
    } catch {
      callback([])
    }
  }
  onValue(dbRef, handler)
  return () => off(dbRef, 'value', handler)
}

// Read global config (company info, payment info)
export async function fetchGlobal(): Promise<Record<string, string>> {
  try {
    const snap = await get(ref(db, getGlobalPath()))
    return snap.exists() ? (snap.val() || {}) : {}
  } catch {
    return {}
  }
}


// Save / merge global config (company profile, numbering, defaults)
export async function saveGlobal(updates: Record<string, unknown>): Promise<void> {
  const current = await fetchGlobal()
  await set(ref(db, getGlobalPath()), { ...current, ...updates, updatedAt: new Date().toISOString() })
  await set(ref(db, `users/${USER_ID}/data/_ts`), Date.now())
}

// Subscribe global config realtime
export function subscribeGlobal(callback: (global: Record<string, any>) => void) {
  const dbRef = ref(db, getGlobalPath())
  const handler = (snap: any) => {
    callback(snap.exists() ? (snap.val() || {}) : {})
  }
  onValue(dbRef, handler)
  return () => off(dbRef, 'value', handler)
}

// Hapus semua data untuk satu tahun (quotation, invoice, akumulasi, mutasi kas/bank)
export async function deleteYearData(year: number): Promise<void> {
  const paths = [
    `users/${USER_ID}/data/yr_${year}_q`,
    `users/${USER_ID}/data/yr_${year}_i`,
    `users/${USER_ID}/data/yr_${year}_a`,
    ...Array.from({ length: 12 }, (_, i) =>
      `users/${USER_ID}/data/finance/yr_${year}_m_${String(i + 1).padStart(2, '0')}`
    ),
  ]
  await Promise.all(paths.map(path => set(ref(db, path), null)))
}

// Read years list
export async function fetchYears(): Promise<number[]> {
  try {
    const snap = await get(ref(db, `users/${USER_ID}/global`))
    if (!snap.exists()) return [new Date().getFullYear()]
    const val = snap.val()
    if (val?.years && Array.isArray(val.years)) return val.years
    return [new Date().getFullYear()]
  } catch {
    return [new Date().getFullYear()]
  }
}
