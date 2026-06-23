import { ref, get, onValue, off, set, runTransaction } from 'firebase/database'
import { db } from '@/lib/firebase'

export const FINANCE_USER_ID = 'financebub-main'

export const MONTHS = [
  { no: 1, short: 'Jan', name: 'Januari' },
  { no: 2, short: 'Feb', name: 'Februari' },
  { no: 3, short: 'Mar', name: 'Maret' },
  { no: 4, short: 'Apr', name: 'April' },
  { no: 5, short: 'Mei', name: 'Mei' },
  { no: 6, short: 'Jun', name: 'Juni' },
  { no: 7, short: 'Jul', name: 'Juli' },
  { no: 8, short: 'Agu', name: 'Agustus' },
  { no: 9, short: 'Sep', name: 'September' },
  { no: 10, short: 'Okt', name: 'Oktober' },
  { no: 11, short: 'Nov', name: 'November' },
  { no: 12, short: 'Des', name: 'Desember' },
]

export const DEFAULT_CATEGORIES = [
  'Pendapatan Jasa',
  'Project Brand',
  'Adsense',
  'Sponsor',
  'Pendapatan Lain-lain',
  'HPP / Biaya Produksi',
  'Gaji',
  'THR',
  'Operasional',
  'Sewa',
  'Transport',
  'Konsumsi',
  'Pajak',
  'Peralatan',
  'Aset Tetap',
  'Liabilitas',
  'Ekuitas',
  'Lain-lain',
]

export type AccountType = 'cash' | 'bank' | 'ewallet' | 'other'
export type TxType = 'income' | 'expense'
export type CategoryReportType = 'labarugi' | 'neraca'
export type CategoryReportGroup =
  | 'pendapatan'
  | 'hpp'
  | 'beban_usaha'
  | 'penyusutan'
  | 'luar_usaha'
  | 'pajak'
  | 'aset'
  | 'liabilitas'
  | 'ekuitas'

export interface FinanceAccount {
  id: string
  name: string
  type: AccountType
  activeFrom: string
  createdAt: string
  companyName?: string
  bankName?: string
  accountNumber?: string
  isArchived?: boolean
}

export interface FinanceTransaction {
  id: string
  date: string
  description: string
  category: string
  type: TxType
  accountId: string
  amount: number
  createdAt: string
  proofImage?: string
  proofName?: string
  note?: string
  verified?: boolean
  taxYear?: number
  taxYearRemainder?: { taxYear: number; note?: string }
  createdBy?: { uid: string; name: string }
}

export interface FinanceMonthData {
  year: number
  month: number
  openingBalances: Record<string, number>
  transactions: FinanceTransaction[]
  categories: string[]
  updatedAt: number
}

export interface FinanceCategoryMap {
  id: string
  name: string
  txType: TxType | 'both'
  reportType: CategoryReportType
  reportGroup: CategoryReportGroup
  normalBalance: 'debit' | 'credit'
  active: boolean
  createdAt: string
}

export interface AccountSummary {
  account: FinanceAccount
  opening: number
  income: number
  expense: number
  balance: number
}

export interface FinanceFlatRow {
  year: number
  month: number
  monthName: string
  account: FinanceAccount | null
  tx: FinanceTransaction
  categoryMap?: FinanceCategoryMap | null
}

export const financeBasePath = () => `users/${FINANCE_USER_ID}/data/finance`
export const financeAccountsPath = () => `${financeBasePath()}/accounts`
export const financeCategoryMapsPath = () => `${financeBasePath()}/categoryMaps`
export const financeMonthPath = (year: number, month: number) => `${financeBasePath()}/yr_${year}_m_${String(month).padStart(2, '0')}`

export const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`

export function parseStoredArray<T>(value: unknown): T[] {
  if (!value) return []
  try {
    const arr = typeof value === 'string' ? JSON.parse(value) : value
    return Array.isArray(arr) ? (arr.filter(Boolean) as T[]) : []
  } catch {
    return []
  }
}

export function parseStoredObject<T extends object>(value: unknown, fallback: T): T {
  if (!value) return fallback
  try {
    const obj = typeof value === 'string' ? JSON.parse(value) : value
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? ({ ...fallback, ...obj } as T) : fallback
  } catch {
    return fallback
  }
}

export function emptyMonthData(year: number, month: number): FinanceMonthData {
  return {
    year,
    month,
    openingBalances: {},
    transactions: [],
    categories: DEFAULT_CATEGORIES,
    updatedAt: Date.now(),
  }
}

export function normalizeMonthData(value: unknown, year: number, month: number): FinanceMonthData {
  const fallback = emptyMonthData(year, month)
  const data = parseStoredObject<FinanceMonthData>(value, fallback)
  return {
    ...fallback,
    ...data,
    year,
    month,
    openingBalances: data.openingBalances || {},
    transactions: Array.isArray(data.transactions) ? data.transactions.filter(Boolean) : [],
    categories: Array.from(new Set([...(data.categories || []), ...DEFAULT_CATEGORIES])),
  }
}

export function normalizeAccount(account: FinanceAccount): FinanceAccount {
  const bankLabel = [account.bankName, account.accountNumber].filter(Boolean).join(' ')
  return {
    ...account,
    name: account.name || [account.companyName, bankLabel].filter(Boolean).join(' · ') || 'Akun Baru',
    type: account.type || 'bank',
    activeFrom: account.activeFrom || monthKey(new Date().getFullYear(), 1),
    createdAt: account.createdAt || new Date().toISOString(),
  }
}

export function subscribeAccounts(callback: (accounts: FinanceAccount[]) => void) {
  const dbRef = ref(db, financeAccountsPath())
  const handler = (snap: { exists: () => boolean; val: () => unknown }) => {
    const accounts = snap.exists() ? parseStoredArray<FinanceAccount>(snap.val()).map(normalizeAccount) : []
    callback(accounts)
  }
  onValue(dbRef, handler)
  return () => off(dbRef, 'value', handler)
}

export function subscribeMonth(year: number, month: number, callback: (data: FinanceMonthData) => void) {
  const dbRef = ref(db, financeMonthPath(year, month))
  const handler = (snap: { exists: () => boolean; val: () => unknown }) => {
    callback(snap.exists() ? normalizeMonthData(snap.val(), year, month) : emptyMonthData(year, month))
  }
  onValue(dbRef, handler)
  return () => off(dbRef, 'value', handler)
}

export function subscribeCategoryMaps(callback: (maps: FinanceCategoryMap[]) => void) {
  const dbRef = ref(db, financeCategoryMapsPath())
  const handler = (snap: { exists: () => boolean; val: () => unknown }) => {
    callback(snap.exists() ? parseStoredArray<FinanceCategoryMap>(snap.val()) : defaultCategoryMaps())
  }
  onValue(dbRef, handler)
  return () => off(dbRef, 'value', handler)
}

export async function fetchAccounts(): Promise<FinanceAccount[]> {
  try {
    const snap = await get(ref(db, financeAccountsPath()))
    return snap.exists() ? parseStoredArray<FinanceAccount>(snap.val()).map(normalizeAccount) : []
  } catch {
    return []
  }
}

export async function fetchMonth(year: number, month: number): Promise<FinanceMonthData> {
  try {
    const snap = await get(ref(db, financeMonthPath(year, month)))
    return snap.exists() ? normalizeMonthData(snap.val(), year, month) : emptyMonthData(year, month)
  } catch {
    return emptyMonthData(year, month)
  }
}

export async function fetchCategoryMaps(): Promise<FinanceCategoryMap[]> {
  try {
    const snap = await get(ref(db, financeCategoryMapsPath()))
    return snap.exists() ? parseStoredArray<FinanceCategoryMap>(snap.val()) : defaultCategoryMaps()
  } catch {
    return defaultCategoryMaps()
  }
}

export async function saveAccounts(accounts: FinanceAccount[]) {
  await set(ref(db, financeAccountsPath()), JSON.stringify(accounts.map(normalizeAccount)))
  await set(ref(db, `${financeBasePath()}/_ts`), Date.now())
}

export async function saveMonth(data: FinanceMonthData) {
  await set(ref(db, financeMonthPath(data.year, data.month)), JSON.stringify({ ...data, updatedAt: Date.now() }))
  await set(ref(db, `${financeBasePath()}/_ts`), Date.now())
}

export async function mergeMonthOpeningBalances(year: number, month: number, balances: Record<string, number>) {
  if (!Object.keys(balances || {}).length) return

  await runTransaction(ref(db, financeMonthPath(year, month)), currentValue => {
    const latest = normalizeMonthData(currentValue, year, month)
    const nextOpeningBalances = { ...(latest.openingBalances || {}) }
    let changed = false

    Object.entries(balances).forEach(([accountId, value]) => {
      if (nextOpeningBalances[accountId] === undefined || nextOpeningBalances[accountId] === null) {
        nextOpeningBalances[accountId] = Number(value || 0)
        changed = true
      }
    })

    if (!changed) return currentValue
    return JSON.stringify({ ...latest, openingBalances: nextOpeningBalances, updatedAt: Date.now() })
  })
  await set(ref(db, `${financeBasePath()}/_ts`), Date.now())
}

export async function saveCategoryMaps(maps: FinanceCategoryMap[]) {
  await set(ref(db, financeCategoryMapsPath()), JSON.stringify(maps))
  await set(ref(db, `${financeBasePath()}/_ts`), Date.now())
}

export function isAccountActive(account: FinanceAccount, year?: number, month?: number) {
  // Rekening dibuat sebagai master global.
  // Setelah rekening ditambahkan sekali, rekening harus tampil di semua bulan/tahun
  // agar user tidak perlu input ulang rekening yang sama setiap bulan.
  return !account.isArchived
}

export function rupiah(value: number | null | undefined, decimals = 0) {
  const num = Number(value || 0)
  return num.toLocaleString('id-ID', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

export function toNumber(value: string | number) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const raw = String(value || '').trim()
  if (!raw) return 0
  let clean = raw.replace(/Rp/gi, '').replace(/\s/g, '')
  if (clean.includes(',') && clean.includes('.')) {
    clean = clean.lastIndexOf(',') > clean.lastIndexOf('.') ? clean.replace(/\./g, '').replace(',', '.') : clean.replace(/,/g, '')
  } else if (clean.includes(',')) {
    clean = clean.replace(/\./g, '').replace(',', '.')
  }
  return Number(clean.replace(/[^0-9.-]/g, '')) || 0
}

export function accountTypeLabel(type: AccountType) {
  const labels: Record<AccountType, string> = {
    cash: 'Kas',
    bank: 'Bank',
    ewallet: 'E-Wallet',
    other: 'Lainnya',
  }
  return labels[type]
}

export function accountDisplayName(account: FinanceAccount | null | undefined) {
  if (!account) return 'Akun dihapus'
  const bankLine = [account.bankName, account.accountNumber].filter(Boolean).join(' ')
  if (account.companyName || bankLine) return [account.companyName, bankLine].filter(Boolean).join(' · ')
  return account.name
}

export function calcAccountSummaries(accounts: FinanceAccount[], monthData: FinanceMonthData): AccountSummary[] {
  return accounts.map(account => {
    const txs = monthData.transactions.filter(t => t.accountId === account.id)
    const income = txs.filter(t => t.type === 'income').reduce((sum, t) => sum + Number(t.amount || 0), 0)
    const expense = txs.filter(t => t.type === 'expense').reduce((sum, t) => sum + Number(t.amount || 0), 0)
    const opening = Number(monthData.openingBalances?.[account.id] || 0)
    return { account, opening, income, expense, balance: opening + income - expense }
  })
}

export function calcMonthTotals(data: FinanceMonthData) {
  const income = data.transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + Number(t.amount || 0), 0)
  const expense = data.transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + Number(t.amount || 0), 0)
  const opening = Object.values(data.openingBalances || {}).reduce((sum, value) => sum + Number(value || 0), 0)
  return { opening, income, expense, profit: income - expense, closing: opening + income - expense }
}

export function makeId(prefix = 'id') {
  const random = Math.random().toString(36).slice(2, 8)
  return `${prefix}-${Date.now()}-${random}`
}

export function defaultCategoryMaps(): FinanceCategoryMap[] {
  const now = new Date().toISOString()
  const rows: Omit<FinanceCategoryMap, 'id' | 'createdAt' | 'active'>[] = [
    { name: 'Pendapatan Jasa', txType: 'income', reportType: 'labarugi', reportGroup: 'pendapatan', normalBalance: 'credit' },
    { name: 'Project Brand', txType: 'income', reportType: 'labarugi', reportGroup: 'pendapatan', normalBalance: 'credit' },
    { name: 'Adsense', txType: 'income', reportType: 'labarugi', reportGroup: 'pendapatan', normalBalance: 'credit' },
    { name: 'Sponsor', txType: 'income', reportType: 'labarugi', reportGroup: 'pendapatan', normalBalance: 'credit' },
    { name: 'Pendapatan Lain-lain', txType: 'income', reportType: 'labarugi', reportGroup: 'luar_usaha', normalBalance: 'credit' },
    { name: 'HPP / Biaya Produksi', txType: 'expense', reportType: 'labarugi', reportGroup: 'hpp', normalBalance: 'debit' },
    { name: 'Gaji', txType: 'expense', reportType: 'labarugi', reportGroup: 'beban_usaha', normalBalance: 'debit' },
    { name: 'THR', txType: 'expense', reportType: 'labarugi', reportGroup: 'beban_usaha', normalBalance: 'debit' },
    { name: 'Operasional', txType: 'expense', reportType: 'labarugi', reportGroup: 'beban_usaha', normalBalance: 'debit' },
    { name: 'Sewa', txType: 'expense', reportType: 'labarugi', reportGroup: 'beban_usaha', normalBalance: 'debit' },
    { name: 'Transport', txType: 'expense', reportType: 'labarugi', reportGroup: 'beban_usaha', normalBalance: 'debit' },
    { name: 'Konsumsi', txType: 'expense', reportType: 'labarugi', reportGroup: 'beban_usaha', normalBalance: 'debit' },
    { name: 'Pajak', txType: 'expense', reportType: 'labarugi', reportGroup: 'pajak', normalBalance: 'debit' },
    { name: 'Peralatan', txType: 'expense', reportType: 'neraca', reportGroup: 'aset', normalBalance: 'debit' },
    { name: 'Aset Tetap', txType: 'expense', reportType: 'neraca', reportGroup: 'aset', normalBalance: 'debit' },
    { name: 'Liabilitas', txType: 'income', reportType: 'neraca', reportGroup: 'liabilitas', normalBalance: 'credit' },
    { name: 'Ekuitas', txType: 'income', reportType: 'neraca', reportGroup: 'ekuitas', normalBalance: 'credit' },
  ]
  return rows.map(row => ({ ...row, id: makeId('cat'), active: true, createdAt: now }))
}

export function normalizeText(value: string) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

export function findCategoryMap(category: string, maps: FinanceCategoryMap[], txType?: TxType) {
  const norm = normalizeText(category)
  const active = maps.filter(m => m.active !== false)
  return active.find(m => normalizeText(m.name) === norm && (!txType || m.txType === 'both' || m.txType === txType)) ||
    active.find(m => normalizeText(m.name) === norm) || null
}

export function suggestCategoryMap(name: string, txType: TxType): FinanceCategoryMap {
  const low = normalizeText(name)
  let reportType: CategoryReportType = 'labarugi'
  let reportGroup: CategoryReportGroup = txType === 'income' ? 'pendapatan' : 'beban_usaha'
  let normalBalance: 'debit' | 'credit' = txType === 'income' ? 'credit' : 'debit'

  if (/pajak|pph|ppn/.test(low)) reportGroup = 'pajak'
  if (/hpp|produksi|talent|sewa alat|crew|editor|shoot|shooting/.test(low)) reportGroup = 'hpp'
  if (/aset|peralatan|kamera|lensa|laptop|komputer|inventaris|deposit/.test(low)) {
    reportType = 'neraca'
    reportGroup = 'aset'
    normalBalance = 'debit'
  }
  if (/hutang|pinjaman|utang|liabilitas/.test(low)) {
    reportType = 'neraca'
    reportGroup = 'liabilitas'
    normalBalance = 'credit'
  }
  if (/modal|ekuitas/.test(low)) {
    reportType = 'neraca'
    reportGroup = 'ekuitas'
    normalBalance = 'credit'
  }
  if (txType === 'income' && reportType === 'labarugi' && /lain|bunga|refund|cashback/.test(low)) reportGroup = 'luar_usaha'

  return {
    id: makeId('cat'),
    name: name.trim() || 'Tanpa Kategori',
    txType,
    reportType,
    reportGroup,
    normalBalance,
    active: true,
    createdAt: new Date().toISOString(),
  }
}

export function groupLabel(group: CategoryReportGroup) {
  const labels: Record<CategoryReportGroup, string> = {
    pendapatan: 'Pendapatan',
    hpp: 'HPP / Biaya Produksi',
    beban_usaha: 'Beban Usaha',
    penyusutan: 'Penyusutan',
    luar_usaha: 'Pendapatan/Beban Luar Usaha',
    pajak: 'Pajak',
    aset: 'Aset Non-Kas',
    liabilitas: 'Liabilitas',
    ekuitas: 'Ekuitas',
  }
  return labels[group]
}
