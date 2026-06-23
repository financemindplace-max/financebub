'use client'
// ─── app/(app)/sdm/kasbon/page.tsx ───────────────────────────────────────────
// Kasbon = pinjaman karyawan, bisa dicicil manual atau otomatis dari slip gaji
// Path: users/financebub-main/data/_hutangKasbon  (array HutangKasbon)
// Sinkron: slip gaji yg punya kasbon > 0 otomatis mencicil hutang aktif

import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/lib/auth-context'
import { ref, onValue, off, set } from 'firebase/database'
import { db } from '@/lib/firebase'
import { fmt, fmtDate } from '@/lib/utils'
import {
  Plus, X, ChevronDown, ChevronUp, Trash2, Pencil,
  Search, AlertCircle, CheckCircle, Clock
} from 'lucide-react'

const USER_ID = 'financebub-main'
const HK_PATH = `users/${USER_ID}/data/_hutangKasbon`
const KAR_PATH = `users/${USER_ID}/data/_karyawan`

// ── types ─────────────────────────────────────────────────────────────────────

interface RiwayatCicilan {
  id: string
  tgl: string
  jumlah: number
  sumber: string   // 'Manual' | 'Slip Gaji <periode>'
  ket: string
}

interface HutangKasbon {
  id: string
  karId: string
  jumlah: number
  saldo: number    // dihitung otomatis
  keterangan: string
  tgl: string      // tanggal pinjam
  riwayat: RiwayatCicilan[]
}

interface Karyawan {
  id: string; nama: string; jabatan: string; dept: string; status: string
}

// ── helpers ───────────────────────────────────────────────────────────────────

function subscribeArr(path: string, cb: (arr: any[]) => void) {
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

async function saveHK(arr: HutangKasbon[]) {
  // Recalc saldo sebelum simpan
  const recalced = arr.map(h => ({
    ...h,
    saldo: Math.max(0, (h.jumlah || 0) - (h.riwayat || []).reduce((a, r) => a + (r.jumlah || 0), 0))
  }))
  await set(ref(db, HK_PATH), JSON.stringify(recalced))
  await set(ref(db, `users/${USER_ID}/data/_ts`), Date.now())
  return recalced
}

function recalcSaldo(h: HutangKasbon): HutangKasbon {
  return {
    ...h,
    saldo: Math.max(0, (h.jumlah || 0) - (h.riwayat || []).reduce((a, r) => a + (r.jumlah || 0), 0))
  }
}

// ── Form Tambah Hutang ────────────────────────────────────────────────────────

function TambahHutangModal({ karyawan, onSave, onClose }: {
  karyawan: Karyawan[]; onSave: (h: Omit<HutangKasbon, 'saldo'>) => void; onClose: () => void
}) {
  const aktif = karyawan.filter(k => k.status === 'Aktif')
  const [karId, setKarId] = useState(aktif[0]?.id || '')
  const [jumlah, setJumlah] = useState('')
  const [ket, setKet] = useState('')
  const [tgl, setTgl] = useState(new Date().toISOString().slice(0, 10))

  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A]'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Tambah Kasbon / Pinjaman</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400"><X size={15} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Karyawan *</label>
            <select value={karId} onChange={e => setKarId(e.target.value)} className={inp}>
              {aktif.map(k => <option key={k.id} value={k.id}>{k.nama} — {k.jabatan}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Jumlah Pinjaman (IDR) *</label>
            <input type="number" value={jumlah} onChange={e => setJumlah(e.target.value)}
              placeholder="0" className={inp} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Keterangan *</label>
            <input value={ket} onChange={e => setKet(e.target.value)}
              placeholder="Keperluan pinjaman..." className={inp} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Tanggal Pinjam</label>
            <input type="date" value={tgl} onChange={e => setTgl(e.target.value)} className={inp} />
          </div>
        </div>
        <div className="px-5 py-4 border-t border-gray-100 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 border border-gray-200 text-sm rounded-lg hover:bg-gray-50">Batal</button>
          <button onClick={() => {
            if (!karId) { alert('Pilih karyawan'); return }
            const jml = parseFloat(jumlah) || 0
            if (jml <= 0) { alert('Jumlah harus lebih dari 0'); return }
            if (!ket.trim()) { alert('Keterangan wajib diisi'); return }
            onSave({ id: 'hk-' + Date.now(), karId, jumlah: jml, keterangan: ket.trim(), tgl, riwayat: [] })
          }} className="flex-1 py-2 bg-[#1B8A7A] text-white text-sm font-semibold rounded-lg hover:bg-[#0F6E56]">
            Simpan
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Form Cicilan Manual ───────────────────────────────────────────────────────

function CicilanModal({ hutang, karNama, onSave, onClose }: {
  hutang: HutangKasbon; karNama: string; onSave: (r: RiwayatCicilan) => void; onClose: () => void
}) {
  const [jumlah, setJumlah] = useState(String(hutang.saldo || ''))
  const [ket, setKet] = useState('')
  const [tgl, setTgl] = useState(new Date().toISOString().slice(0, 10))
  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A]'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Bayar / Cicil Kasbon</h2>
            <p className="text-xs text-gray-400 mt-0.5">{karNama} · Sisa Rp {fmt(hutang.saldo)}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400"><X size={15} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Jumlah Pembayaran (IDR) *</label>
            <input type="number" value={jumlah} onChange={e => setJumlah(e.target.value)}
              placeholder="0" className={inp} />
            <p className="text-[11px] text-gray-400 mt-1">Maks: Rp {fmt(hutang.saldo)}</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Keterangan</label>
            <input value={ket} onChange={e => setKet(e.target.value)}
              placeholder="Cicilan manual, dll..." className={inp} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Tanggal Bayar</label>
            <input type="date" value={tgl} onChange={e => setTgl(e.target.value)} className={inp} />
          </div>
        </div>
        <div className="px-5 py-4 border-t border-gray-100 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 border border-gray-200 text-sm rounded-lg hover:bg-gray-50">Batal</button>
          <button onClick={() => {
            const jml = Math.min(parseFloat(jumlah) || 0, hutang.saldo)
            if (jml <= 0) { alert('Jumlah harus lebih dari 0'); return }
            onSave({ id: 'cicil-' + Date.now(), tgl, jumlah: jml, sumber: 'Manual', ket: ket.trim() })
          }} className="flex-1 py-2 bg-[#185FA5] text-white text-sm font-semibold rounded-lg hover:bg-[#0F4A85]">
            Catat Pembayaran
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Hutang Card ───────────────────────────────────────────────────────────────

function HutangCard({ hutang, karNama, onCicil, onDelete, onDeleteCicilan, isAdmin }: {
  hutang: HutangKasbon; karNama: string
  onCicil: () => void; onDelete: () => void
  onDeleteCicilan: (rid: string) => void
  isAdmin: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const persen = hutang.jumlah > 0 ? Math.round(((hutang.jumlah - hutang.saldo) / hutang.jumlah) * 100) : 100
  const lunas = hutang.saldo <= 0

  return (
    <div className={`bg-white rounded-xl border ${lunas ? 'border-green-200' : 'border-gray-100'} shadow-sm overflow-hidden`}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3.5">
        <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${lunas ? 'bg-green-100' : 'bg-amber-100'}`}>
          {lunas
            ? <CheckCircle size={18} className="text-green-600" />
            : <Clock size={18} className="text-amber-600" />
          }
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-900">{hutang.keterangan}</span>
            {lunas && <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-700">Lunas</span>}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">
            Pinjam {fmtDate(hutang.tgl)} · Pokok Rp {fmt(hutang.jumlah)}
          </div>
          {/* Progress bar */}
          <div className="flex items-center gap-2 mt-1.5">
            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-500"
                style={{ width: `${persen}%`, backgroundColor: lunas ? '#16a34a' : '#d97706' }} />
            </div>
            <span className="text-[10px] text-gray-400">{persen}%</span>
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          {!lunas && <div className="text-sm font-bold text-red-600">Sisa Rp {fmt(hutang.saldo)}</div>}
          {lunas && <div className="text-sm font-bold text-green-600">Rp {fmt(hutang.jumlah)}</div>}
          <div className="flex items-center gap-1 justify-end mt-1">
            {!lunas && isAdmin && (
              <button onClick={onCicil}
                className="px-2.5 py-1 text-[11px] font-semibold bg-[#185FA5] text-white rounded-lg hover:bg-[#0F4A85] transition">
                + Bayar
              </button>
            )}
            {isAdmin && (
              <button onClick={onDelete}
                className="p-1.5 hover:bg-red-50 rounded-lg text-gray-300 hover:text-red-500 transition">
                <Trash2 size={13} />
              </button>
            )}
            <button onClick={() => setExpanded(v => !v)}
              className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 transition">
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
        </div>
      </div>

      {/* Riwayat cicilan */}
      {expanded && (
        <div className="border-t border-gray-100">
          {!hutang.riwayat?.length ? (
            <div className="px-4 py-3 text-xs text-gray-400 italic">Belum ada pembayaran</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-400">Tanggal</th>
                  <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-400">Sumber</th>
                  <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-400">Keterangan</th>
                  <th className="px-4 py-2 text-right text-[10px] font-semibold text-gray-400">Jumlah</th>
                  {isAdmin && <th className="px-4 py-2 w-8" />}
                </tr>
              </thead>
              <tbody>
                {hutang.riwayat.map((r, i) => (
                  <tr key={r.id} className={`border-t border-gray-50 ${i % 2 === 0 ? '' : 'bg-gray-50/50'}`}>
                    <td className="px-4 py-2 text-gray-600">{fmtDate(r.tgl)}</td>
                    <td className="px-4 py-2">
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${r.sumber === 'Manual' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                        {r.sumber}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-500">{r.ket || '—'}</td>
                    <td className="px-4 py-2 text-right font-semibold text-green-700">+Rp {fmt(r.jumlah)}</td>
                    {isAdmin && (
                      <td className="px-4 py-2 text-center">
                        <button onClick={() => onDeleteCicilan(r.id)}
                          className="p-1 hover:bg-red-50 rounded text-gray-300 hover:text-red-500 transition">
                          <X size={11} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-200 bg-gray-50">
                  <td colSpan={3} className="px-4 py-2 text-xs font-semibold text-gray-500 text-right">Total Terbayar</td>
                  <td className="px-4 py-2 text-right text-sm font-bold text-green-700">
                    Rp {fmt(hutang.jumlah - hutang.saldo)}
                  </td>
                  {isAdmin && <td />}
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function KasbonPage() {
  const { user } = useAuth()
  const [karyawan, setKaryawan] = useState<Karyawan[]>([])
  const [hutangList, setHutangList] = useState<HutangKasbon[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<'semua' | 'aktif' | 'lunas'>('aktif')
  const [showTambah, setShowTambah] = useState(false)
  const [cicilanTarget, setCicilanTarget] = useState<HutangKasbon | null>(null)
  const isAdmin = user?.role === 'admin'

  useEffect(() => {
    let kDone = false, hDone = false
    const check = () => { if (kDone && hDone) setLoading(false) }
    const uK = subscribeArr(KAR_PATH, d => { setKaryawan(d); kDone = true; check() })
    const uH = subscribeArr(HK_PATH, d => {
      setHutangList(d.map(recalcSaldo))
      hDone = true; check()
    })
    return () => { uK(); uH() }
  }, [])

  const karMap = Object.fromEntries(karyawan.map(k => [k.id, k]))

  // Group by karyawan
  const grouped = karyawan
    .map(k => ({
      kar: k,
      hutangs: hutangList
        .filter(h => h.karId === k.id)
        .filter(h => {
          if (filterStatus === 'aktif') return h.saldo > 0
          if (filterStatus === 'lunas') return h.saldo <= 0
          return true
        })
        .filter(h => {
          if (!search) return true
          return h.keterangan.toLowerCase().includes(search.toLowerCase())
        })
    }))
    .filter(g => g.hutangs.length > 0 ||
      (search === '' && filterStatus === 'aktif' && hutangList.some(h => h.karId === g.kar.id && h.saldo > 0)))

  // Summary
  const totalPinjaman = hutangList.reduce((a, h) => a + h.jumlah, 0)
  const totalSaldo = hutangList.reduce((a, h) => a + h.saldo, 0)
  const totalTerbayar = totalPinjaman - totalSaldo
  const jumlahAktif = hutangList.filter(h => h.saldo > 0).length

  // ── actions ─────────────────────────────────────────────────────────────────

  const handleTambah = useCallback(async (h: Omit<HutangKasbon, 'saldo'>) => {
    const newH: HutangKasbon = recalcSaldo({ ...h, saldo: h.jumlah })
    const updated = await saveHK([newH, ...hutangList])
    setHutangList(updated)
    setShowTambah(false)
  }, [hutangList])

  const handleCicil = useCallback(async (hutangId: string, cicilan: RiwayatCicilan) => {
    const updated = hutangList.map(h => {
      if (h.id !== hutangId) return h
      return recalcSaldo({ ...h, riwayat: [...(h.riwayat || []), cicilan] })
    })
    const saved = await saveHK(updated)
    setHutangList(saved)
    setCicilanTarget(null)
  }, [hutangList])

  const handleDeleteHutang = useCallback(async (id: string) => {
    if (!confirm('Hapus data kasbon ini? Riwayat cicilan juga akan terhapus.')) return
    const updated = await saveHK(hutangList.filter(h => h.id !== id))
    setHutangList(updated)
  }, [hutangList])

  const handleDeleteCicilan = useCallback(async (hutangId: string, riwayatId: string) => {
    if (!confirm('Hapus cicilan ini?')) return
    const updated = hutangList.map(h => {
      if (h.id !== hutangId) return h
      return recalcSaldo({ ...h, riwayat: (h.riwayat || []).filter(r => r.id !== riwayatId) })
    })
    const saved = await saveHK(updated)
    setHutangList(saved)
  }, [hutangList])

  // ── render ───────────────────────────────────────────────────────────────────

  return (
    <div className="p-6">
      {showTambah && (
        <TambahHutangModal karyawan={karyawan} onSave={handleTambah} onClose={() => setShowTambah(false)} />
      )}
      {cicilanTarget && (
        <CicilanModal
          hutang={cicilanTarget}
          karNama={karMap[cicilanTarget.karId]?.nama || '—'}
          onSave={(r) => handleCicil(cicilanTarget.id, r)}
          onClose={() => setCicilanTarget(null)}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Kasbon Karyawan</h1>
          <p className="text-sm text-gray-400 mt-0.5">{jumlahAktif} kasbon aktif · Total sisa Rp {fmt(totalSaldo)}</p>
        </div>
        {isAdmin && (
          <button onClick={() => setShowTambah(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#1B8A7A] hover:bg-[#0F6E56] text-white text-sm font-semibold rounded-lg">
            <Plus size={15} /> Tambah Kasbon
          </button>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-5">
        {[
          { label: 'Kasbon Aktif', value: String(jumlahAktif), color: '#d97706' },
          { label: 'Total Pinjaman', value: `Rp ${fmt(totalPinjaman)}`, color: '#185FA5' },
          { label: 'Sudah Terbayar', value: `Rp ${fmt(totalTerbayar)}`, color: '#3B6D11' },
          { label: 'Sisa Tagihan', value: `Rp ${fmt(totalSaldo)}`, color: totalSaldo > 0 ? '#dc2626' : '#3B6D11' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <div className="text-xs text-gray-400 mb-1">{s.label}</div>
            <div className="text-base font-bold" style={{ color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Info sinkron slip gaji */}
      <div className="bg-purple-50 border border-purple-100 rounded-xl px-4 py-2.5 mb-4 flex items-center gap-2 text-xs text-purple-700">
        <AlertCircle size={13} className="flex-shrink-0" />
        <span>Kasbon yang diinput di <strong>Slip Gaji</strong> akan otomatis mencicil hutang aktif karyawan tersebut.</span>
      </div>

      {/* Filter & search */}
      <div className="flex gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Cari keterangan kasbon..."
            className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A] bg-white" />
        </div>
        <div className="flex gap-1.5">
          {[
            { key: 'aktif', label: 'Aktif' },
            { key: 'lunas', label: 'Lunas' },
            { key: 'semua', label: 'Semua' },
          ].map(f => (
            <button key={f.key} onClick={() => setFilterStatus(f.key as any)}
              className={`px-3 py-2 text-xs font-medium rounded-lg transition-colors ${filterStatus === f.key ? 'bg-[#1B8A7A] text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* List grouped by karyawan */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
              <div className="h-4 w-40 bg-gray-100 rounded mb-2" />
              <div className="h-12 bg-gray-50 rounded" />
            </div>
          ))}
        </div>
      ) : hutangList.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <div className="text-4xl mb-3">💰</div>
          <p className="text-sm text-gray-400">Belum ada data kasbon</p>
          {isAdmin && (
            <button onClick={() => setShowTambah(true)} className="mt-3 text-sm text-[#1B8A7A] hover:underline">
              + Tambah kasbon pertama
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {karyawan
            .filter(k => hutangList.filter(h => h.karId === k.id).filter(h => {
              if (filterStatus === 'aktif') return h.saldo > 0
              if (filterStatus === 'lunas') return h.saldo <= 0
              return true
            }).filter(h => !search || h.keterangan.toLowerCase().includes(search.toLowerCase())).length > 0)
            .map(kar => {
              const karHutangs = hutangList
                .filter(h => h.karId === kar.id)
                .filter(h => {
                  if (filterStatus === 'aktif') return h.saldo > 0
                  if (filterStatus === 'lunas') return h.saldo <= 0
                  return true
                })
                .filter(h => !search || h.keterangan.toLowerCase().includes(search.toLowerCase()))
                .sort((a, b) => b.tgl.localeCompare(a.tgl))

              const totalSaldoKar = karHutangs.reduce((a, h) => a + h.saldo, 0)

              return (
                <div key={kar.id}>
                  {/* Karyawan header */}
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-8 h-8 rounded-full bg-[#1B8A7A] flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                      {kar.nama.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-gray-900">{kar.nama}</div>
                      <div className="text-xs text-gray-400">{kar.jabatan} · {karHutangs.length} kasbon
                        {totalSaldoKar > 0 && <span className="text-red-500 font-medium"> · Sisa Rp {fmt(totalSaldoKar)}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2 pl-11">
                    {karHutangs.map(h => (
                      <HutangCard
                        key={h.id}
                        hutang={h}
                        karNama={kar.nama}
                        isAdmin={isAdmin}
                        onCicil={() => setCicilanTarget(h)}
                        onDelete={() => handleDeleteHutang(h.id)}
                        onDeleteCicilan={(rid) => handleDeleteCicilan(h.id, rid)}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
        </div>
      )}
    </div>
  )
}
