import type { Doc } from '@/types/document'

export type DocumentKind = 'quotation' | 'invoice'
export type DocumentSortMode = 'date_desc' | 'date_asc' | 'number_desc' | 'number_asc'

const naturalCompare = new Intl.Collator('id-ID', {
  numeric: true,
  sensitivity: 'base',
}).compare

function parseDateValue(value?: string | number | null): number {
  if (value === null || value === undefined || value === '') return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0

  const raw = String(value).trim()
  if (!raw) return 0

  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) {
    const [, y, m, d] = iso
    return new Date(Number(y), Number(m) - 1, Number(d)).getTime()
  }

  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (slash) {
    const [, d, m, y] = slash
    return new Date(Number(y), Number(m) - 1, Number(d)).getTime()
  }

  const parsed = Date.parse(raw)
  return Number.isNaN(parsed) ? 0 : parsed
}

function getDocDate(doc: Doc, kind: DocumentKind): number {
  const fieldKey = kind === 'quotation' ? 'q-date' : 'i-date'
  return (
    parseDateValue(doc.fields?.[fieldKey]) ||
    parseDateValue(doc.savedAt) ||
    Number(doc.id || 0) ||
    0
  )
}

type ParsedNumber = {
  year: number
  month: number
  sequence: number
  suffix: string
  original: string
}

function parseDocNumber(no?: string | null): ParsedNumber {
  const original = String(no || '').trim()

  // Format utama: QTT-BUB-MMYY-NN atau INV-BUB-MMYY-NN-A1
  // Untuk urutan nomor terbesar/terkecil, angka urut terakhir adalah pembanding utama.
  const match = original.match(/-(\d{2})(\d{2})-(\d+)(.*)$/)
  if (match) {
    const [, month, year, sequence, suffix] = match
    return {
      year: Number(year),
      month: Number(month),
      sequence: Number(sequence),
      suffix: (suffix || '').trim(),
      original,
    }
  }

  // Fallback untuk dokumen lama dengan format tidak rapi.
  const nums = original.match(/\d+/g) || []
  const last = nums[nums.length - 1] || '0'
  return {
    year: 0,
    month: 0,
    sequence: Number(last),
    suffix: '',
    original,
  }
}

function compareSuffixAsc(a: string, b: string): number {
  if (a === b) return 0
  if (!a && b) return -1
  if (a && !b) return 1
  return naturalCompare(a, b)
}

function compareDocNumberAsc(aNo?: string | null, bNo?: string | null): number {
  const a = parseDocNumber(aNo)
  const b = parseDocNumber(bNo)

  // Yang dimaksud nomor terbesar adalah angka urut dokumen, bukan MMYY.
  // Jadi 0126-109 harus berada di atas 0226-20 saat sort terbesar.
  if (a.sequence !== b.sequence) return a.sequence - b.sequence

  const suffixCompare = compareSuffixAsc(a.suffix, b.suffix)
  if (suffixCompare !== 0) return suffixCompare

  // Jika angka urut sama persis, baru pakai tahun dan bulan sebagai tie breaker.
  if (a.year !== b.year) return a.year - b.year
  if (a.month !== b.month) return a.month - b.month

  return naturalCompare(a.original, b.original)
}

function getDocNumber(doc: Doc, kind: DocumentKind): string {
  return String(doc.fields?.[kind === 'quotation' ? 'q-no' : 'i-no'] || '')
}

export function sortDocumentList(docs: Doc[], kind: DocumentKind, mode: DocumentSortMode): Doc[] {
  return [...docs].sort((a, b) => {
    if (mode === 'date_desc' || mode === 'date_asc') {
      const diff = getDocDate(a, kind) - getDocDate(b, kind)
      if (diff !== 0) return mode === 'date_asc' ? diff : -diff
    }

    const numberCompare = compareDocNumberAsc(getDocNumber(a, kind), getDocNumber(b, kind))
    if (numberCompare !== 0) return mode === 'number_asc' ? numberCompare : -numberCompare

    return Number(b.id || 0) - Number(a.id || 0)
  })
}
