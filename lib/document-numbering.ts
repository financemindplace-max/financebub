export type DocumentNumberType = 'quotation' | 'invoice'

export interface DocumentNumberConfig {
  prefix: string
  next: number
  digits: number
}

const DEFAULT_PREFIX: Record<DocumentNumberType, string> = {
  quotation: 'QTT-BUB',
  invoice: 'INV-BUB',
}

const NEXT_KEY: Record<DocumentNumberType, string> = {
  quotation: 'q-next',
  invoice: 'i-next',
}

const LEGACY_NEXT_KEY: Record<DocumentNumberType, string> = {
  quotation: 'QNK',
  invoice: 'INK',
}

const PREFIX_KEY: Record<DocumentNumberType, string> = {
  quotation: 'q-prefix',
  invoice: 'i-prefix',
}

const LEGACY_PREFIX_KEY: Record<DocumentNumberType, string> = {
  quotation: 'QPK',
  invoice: 'IPK',
}

function cleanPrefix(value: unknown, fallback: string) {
  const raw = String(value || fallback).trim().toUpperCase()
  return (raw || fallback).replace(/[-\s]+$/g, '')
}

function toPositiveInt(value: unknown, fallback: number) {
  const n = Number(String(value ?? '').replace(/[^0-9]/g, ''))
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

export function getDocumentNumberConfig(global: Record<string, unknown>, type: DocumentNumberType): DocumentNumberConfig {
  const prefix = cleanPrefix(
    global[PREFIX_KEY[type]] ?? global[LEGACY_PREFIX_KEY[type]],
    DEFAULT_PREFIX[type]
  )
  const next = toPositiveInt(global[NEXT_KEY[type]] ?? global[LEGACY_NEXT_KEY[type]], 1)
  const digits = Math.min(Math.max(toPositiveInt(global['number-digits'], 2), 1), 6)
  return { prefix, next, digits }
}

export function getDocumentNumberPeriod(dateValue?: string | Date) {
  const date = dateValue instanceof Date
    ? dateValue
    : dateValue
      ? new Date(`${dateValue}T00:00:00`)
      : new Date()
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date
  const mm = String(safeDate.getMonth() + 1).padStart(2, '0')
  const yy = String(safeDate.getFullYear()).slice(2)
  return `${mm}${yy}`
}

export function formatDocumentNumber(type: DocumentNumberType, global: Record<string, unknown>, dateValue?: string | Date, nextOverride?: number) {
  const cfg = getDocumentNumberConfig(global, type)
  const next = nextOverride ?? cfg.next
  const nn = String(Math.max(1, Number(next) || 1)).padStart(cfg.digits, '0')
  return `${cfg.prefix}-${getDocumentNumberPeriod(dateValue)}-${nn}`
}

export function buildNextNumberUpdates(type: DocumentNumberType, nextNumber: number) {
  const next = Math.max(1, Math.floor(Number(nextNumber) || 1))
  return {
    [NEXT_KEY[type]]: String(next),
    [LEGACY_NEXT_KEY[type]]: String(next),
  }
}

export function buildPrefixUpdates(type: DocumentNumberType, prefix: string) {
  const clean = cleanPrefix(prefix, DEFAULT_PREFIX[type])
  return {
    [PREFIX_KEY[type]]: clean,
    [LEGACY_PREFIX_KEY[type]]: clean,
  }
}

export function parseDocumentNumber(no?: string) {
  const raw = String(no || '').trim()
  const match = raw.match(/^(.+)-(\d{4})-(\d+)$/)
  if (!match) return null
  return {
    prefix: match[1],
    period: match[2],
    sequence: Number(match[3]),
  }
}

export function isAutoDocumentNumber(no: string | undefined, global: Record<string, unknown>, type: DocumentNumberType) {
  const parsed = parseDocumentNumber(no)
  if (!parsed) return false
  const cfg = getDocumentNumberConfig(global, type)
  return parsed.prefix.toUpperCase() === cfg.prefix.toUpperCase()
}
