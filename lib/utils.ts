import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '-'
  return Math.round(n).toLocaleString('id-ID')
}

export function fmtDate(d: string): string {
  if (!d) return '-'
  const M = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des']
  const p = d.split('-')
  return p.length < 3 ? d : `${parseInt(p[2])} ${M[+p[1]-1]} ${p[0]}`
}

// Format dd/mm/yyyy — dipakai untuk input date display
export function fmtDateShort(d: string): string {
  if (!d) return '-'
  const p = d.split('-')
  return p.length < 3 ? d : `${p[2].padStart(2,'0')}/${p[1].padStart(2,'0')}/${p[0]}`
}

export function fmtDateFull(d: string): string {
  if (!d) return '-'
  const M = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember']
  const p = d.split('-')
  return p.length < 3 ? d : `${parseInt(p[2])} ${M[+p[1]-1]} ${p[0]}`
}
