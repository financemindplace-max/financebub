'use client'

/**
 * DateInput — input tanggal dd/mm/yyyy dengan tombol kalender native.
 * 
 * Pakai:
 *   <DateInput value="2026-06-15" onChange={v => setDate(v)} />
 * 
 * - Tampil: dd / mm / yyyy
 * - Tombol kalender tetap ada (overlay input[type=date] transparan)
 * - onChange dipanggil dengan format yyyy-mm-dd
 */

import { useEffect, useRef, useState } from 'react'
import { Calendar } from 'lucide-react'

interface DateInputProps {
  value: string
  onChange: (value: string) => void
  className?: string
  disabled?: boolean
}

function parseParts(val: string) {
  if (!val) return { d: '', m: '', y: '' }
  if (val.includes('-') && val.length === 10) {
    const [y, m, d] = val.split('-')
    return { d, m, y }
  }
  return { d: '', m: '', y: '' }
}

function toISO(d: string, m: string, y: string) {
  if (d.length === 2 && m.length === 2 && y.length === 4) return `${y}-${m}-${d}`
  return ''
}

export default function DateInput({ value, onChange, className, disabled }: DateInputProps) {
  const { d: initD, m: initM, y: initY } = parseParts(value)
  const [d, setD] = useState(initD)
  const [m, setM] = useState(initM)
  const [y, setY] = useState(initY)
  const mRef = useRef<HTMLInputElement>(null)
  const yRef = useRef<HTMLInputElement>(null)
  const nativeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const { d: nd, m: nm, y: ny } = parseParts(value)
    setD(nd); setM(nm); setY(ny)
  }, [value])

  const emit = (nd: string, nm: string, ny: string) => {
    const iso = toISO(nd, nm, ny)
    if (iso) onChange(iso)
  }

  const handleD = (v: string) => {
    const num = v.replace(/\D/g, '').slice(0, 2)
    setD(num)
    if (num.length === 2) { mRef.current?.focus(); mRef.current?.select() }
    emit(num, m, y)
  }

  const handleM = (v: string) => {
    const num = v.replace(/\D/g, '').slice(0, 2)
    setM(num)
    if (num.length === 2) { yRef.current?.focus(); yRef.current?.select() }
    emit(d, num, y)
  }

  const handleY = (v: string) => {
    const num = v.replace(/\D/g, '').slice(0, 4)
    setY(num)
    emit(d, m, num)
  }

  const handleNativeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const iso = e.target.value // yyyy-mm-dd
    if (!iso) return
    onChange(iso)
  }

  const wrapClass = className || 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus-within:border-[#1B8A7A]'

  return (
    <div className={`${wrapClass} flex items-center gap-0.5 relative`}>
      {/* Text inputs dd / mm / yyyy */}
      <input type="text" inputMode="numeric" value={d} onChange={e => handleD(e.target.value)}
        placeholder="dd" maxLength={2} disabled={disabled}
        className="outline-none bg-transparent text-center w-6 text-sm" />
      <span className="text-gray-400 text-sm">/</span>
      <input ref={mRef} type="text" inputMode="numeric" value={m} onChange={e => handleM(e.target.value)}
        placeholder="mm" maxLength={2} disabled={disabled}
        className="outline-none bg-transparent text-center w-6 text-sm" />
      <span className="text-gray-400 text-sm">/</span>
      <input ref={yRef} type="text" inputMode="numeric" value={y} onChange={e => handleY(e.target.value)}
        placeholder="yyyy" maxLength={4} disabled={disabled}
        className="outline-none bg-transparent text-center w-12 text-sm" />

      {/* Tombol kalender — overlay native date input */}
      <div className="ml-auto relative flex items-center">
        <Calendar className="w-4 h-4 text-gray-300 pointer-events-none" />
        <input
          ref={nativeRef}
          type="date"
          value={value || ''}
          onChange={handleNativeChange}
          disabled={disabled}
          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
          tabIndex={-1}
        />
      </div>
    </div>
  )
}
