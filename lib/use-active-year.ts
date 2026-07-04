'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

export const ACTIVE_YEAR_STORAGE_KEY = 'financebub_active_year'
export const YEAR_OPTIONS_STORAGE_KEY = 'financebub_year_options'

export function defaultYearOptions() {
  const now = new Date().getFullYear()
  return Array.from({ length: now + 3 - 2020 + 1 }, (_, index) => 2020 + index)
    .filter(year => year >= 2020 && year <= 2099)
    .sort((a, b) => b - a)
}

function migrateLegacyYearOptions(years: number[]) {
  const now = new Date().getFullYear()
  const legacyRecentOnly = years.length > 0
    && years.length <= 4
    && years.every(year => year >= now - 2 && year <= now + 2)
  return legacyRecentOnly
    ? Array.from(new Set([...defaultYearOptions(), ...years])).sort((a, b) => b - a)
    : years
}

function cleanYear(value: unknown, fallback = new Date().getFullYear()) {
  const year = Number(value)
  return Number.isFinite(year) && year >= 2020 && year <= 2099 ? Math.trunc(year) : fallback
}

export function getActiveYear(fallback = new Date().getFullYear()) {
  if (typeof window === 'undefined') return fallback
  try {
    // sessionStorage: per-tab, tidak shared antar tab
    const session = sessionStorage.getItem(ACTIVE_YEAR_STORAGE_KEY)
    if (session !== null) return cleanYear(session, fallback)
    // fallback ke localStorage untuk backward compat (tab yang baru dibuka ikut tahun terakhir)
    return cleanYear(localStorage.getItem(ACTIVE_YEAR_STORAGE_KEY), fallback)
  } catch {
    return fallback
  }
}

export function getYearOptions(extraYears: number[] = []) {
  if (typeof window === 'undefined') return defaultYearOptions()
  try {
    const raw = localStorage.getItem(YEAR_OPTIONS_STORAGE_KEY)
    if (raw !== null) {
      // User sudah punya daftar custom — pakai itu saja, jangan merge dengan defaults
      // agar tahun yang dihapus tidak muncul kembali
      const stored = JSON.parse(raw)
      const storedYears = Array.isArray(stored)
        ? stored.map(Number).filter(y => Number.isFinite(y) && y >= 2020 && y <= 2099)
        : []
      const migratedYears = migrateLegacyYearOptions(storedYears)
      if (migratedYears.length !== storedYears.length) {
        localStorage.setItem(YEAR_OPTIONS_STORAGE_KEY, JSON.stringify(migratedYears))
      }
      const base = migratedYears.length > 0 ? migratedYears : defaultYearOptions()
      return Array.from(new Set([...base, ...extraYears]))
        .filter(year => Number.isFinite(year) && year >= 2020 && year <= 2099)
        .sort((a, b) => b - a)
    }
    // Belum ada daftar tersimpan — pakai defaults
    return Array.from(new Set([...defaultYearOptions(), ...extraYears]))
      .filter(year => Number.isFinite(year) && year >= 2020 && year <= 2099)
      .sort((a, b) => b - a)
  } catch {
    return Array.from(new Set([...defaultYearOptions(), ...extraYears])).sort((a, b) => b - a)
  }
}

// Hook reaktif untuk daftar tahun — update otomatis saat sidebar tambah/hapus tahun
export function useYearList() {
  const [yearList, setYearList] = useState<number[]>(() =>
    typeof window !== 'undefined' ? getYearOptions() : defaultYearOptions()
  )
  useEffect(() => {
    const update = () => setYearList(getYearOptions())
    window.addEventListener('financebub-year-change', update)
    window.addEventListener('financebub-year-options-change', update)
    // Hanya update yearList kalau YEAR_OPTIONS_STORAGE_KEY berubah (bukan active year)
    const handleStorage = (event: StorageEvent) => {
      if (event.key === YEAR_OPTIONS_STORAGE_KEY) update()
    }
    window.addEventListener('storage', handleStorage)
    return () => {
      window.removeEventListener('financebub-year-change', update)
      window.removeEventListener('financebub-year-options-change', update)
      window.removeEventListener('storage', handleStorage)
    }
  }, [])
  return yearList
}

export function persistActiveYear(year: number) {
  if (typeof window === 'undefined') return
  const clean = cleanYear(year)
  const years = getYearOptions([clean])
  try {
    // sessionStorage: hanya berlaku untuk tab ini
    sessionStorage.setItem(ACTIVE_YEAR_STORAGE_KEY, String(clean))
    // localStorage dipertahankan untuk kompatibilitas halaman lama dan tab baru.
    localStorage.setItem(ACTIVE_YEAR_STORAGE_KEY, String(clean))
    localStorage.setItem(YEAR_OPTIONS_STORAGE_KEY, JSON.stringify(years))
    window.dispatchEvent(new CustomEvent('financebub-year-change', { detail: clean }))
  } catch {}
}

export function useActiveYear(fallback = new Date().getFullYear()) {
  const [year, setYearState] = useState(() => getActiveYear(fallback))
  const [yearOptions, setYearOptions] = useState<number[]>(() => getYearOptions([getActiveYear(fallback)]))

  useEffect(() => {
    const current = getActiveYear(fallback)
    setYearState(current)
    setYearOptions(getYearOptions([current]))

    const handleYearChange = (event: Event) => {
      const nextYear = cleanYear((event as CustomEvent<number>).detail, current)
      setYearState(nextYear)
      setYearOptions(getYearOptions([nextYear]))
    }

    const handleStorage = (event: StorageEvent) => {
      // Abaikan perubahan ACTIVE_YEAR_STORAGE_KEY dari tab lain — setiap tab punya tahun sendiri
      if (event.key === ACTIVE_YEAR_STORAGE_KEY) return
      if (event.key && event.key !== YEAR_OPTIONS_STORAGE_KEY) return
      // Hanya update daftar tahun (yearOptions), bukan tahun aktif
      setYearOptions(getYearOptions([year]))
    }

    window.addEventListener('financebub-year-change', handleYearChange as EventListener)
    window.addEventListener('storage', handleStorage)
    return () => {
      window.removeEventListener('financebub-year-change', handleYearChange as EventListener)
      window.removeEventListener('storage', handleStorage)
    }
  }, [fallback])

  const setYear = useCallback((nextYear: number) => {
    const clean = cleanYear(nextYear, year)
    setYearState(clean)
    const years = getYearOptions([clean])
    setYearOptions(years)
    persistActiveYear(clean)
  }, [year])

  const years = useMemo(() => {
    return Array.from(new Set([...yearOptions, year]))
      .filter(value => Number.isFinite(value) && value >= 2020 && value <= 2099)
      .sort((a, b) => b - a)
  }, [year, yearOptions])

  return { year, years, setYear }
}
