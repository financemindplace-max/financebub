'use client'
import { useYearList } from '@/lib/use-active-year'
// ─── app/(app)/sdm/gaji/page.tsx ─────────────────────────────────────────────

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import { ref, onValue, off, set, get } from 'firebase/database'
import { db } from '@/lib/firebase'
import { fetchGlobal } from '@/lib/rtdb'
import { fmt } from '@/lib/utils'
import { Plus, Download, Trash2, X, ChevronDown, Pencil } from 'lucide-react'

const USER_ID = 'financebub-main'
const KAR_PATH = `users/${USER_ID}/data/_karyawan`
const HK_PATH  = `users/${USER_ID}/data/_hutangKasbon`
const BULAN    = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember']

// ── types ─────────────────────────────────────────────────────────────────────

interface Karyawan {
  id: string; nama: string; jabatan: string
  status: string; gajiPokok: number; bank: string; noRek: string
}

interface CustomRow { label: string; ket: string; nom: number }

interface SlipGaji {
  id: string; periode: string; tglGaji: string; tglTTD: string
  karId: string; nama: string; jabatan: string; bank: string; noRek: string
  gajiPokok: number; bonusKPI: number; ketBonusKPI: string
  overtime: number; ketOvertime: string; reimburse: number; ketReimburse: string
  kasbon: number; ketKasbon: string; offtime: number; ketOfftime: string
  penCustom: CustomRow[]; pngCustom: CustomRow[]
  totalPenerimaan: number; totalPengurangan: number; takeHomePay: number
}

// ── firebase helpers ──────────────────────────────────────────────────────────

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

async function saveSlips(year: number, arr: SlipGaji[]) {
  await set(ref(db, `users/${USER_ID}/data/yr_${year}_sg`), JSON.stringify(arr))
  await set(ref(db, `users/${USER_ID}/data/_ts`), Date.now())
}

async function getSaldoKasbon(karId: string): Promise<number> {
  try {
    const snap = await get(ref(db, HK_PATH))
    if (!snap.exists()) return 0
    const val = snap.val()
    const arr: any[] = typeof val === 'string' ? JSON.parse(val) : val
    return arr.filter(Boolean).reduce((total: number, h: any) => {
      if (h.karId !== karId) return total
      const cicil = (h.riwayat || []).reduce((a: number, r: any) => a + (r.jumlah || 0), 0)
      return total + Math.max(0, (h.jumlah || 0) - cicil)
    }, 0)
  } catch { return 0 }
}

async function cicilKasbonFromSlip(karId: string, jumlah: number, periode: string, tgl: string) {
  if (!karId || jumlah <= 0) return
  try {
    const snap = await get(ref(db, HK_PATH))
    if (!snap.exists()) return
    const val = snap.val()
    const arr: any[] = typeof val === 'string' ? JSON.parse(val) : val
    let sisa = jumlah
    const updated = arr.filter(Boolean).map((h: any) => {
      const cicilSum = (h.riwayat || []).reduce((a: number, r: any) => a + (r.jumlah || 0), 0)
      const saldo = Math.max(0, (h.jumlah || 0) - cicilSum)
      if (h.karId !== karId || sisa <= 0 || saldo <= 0) return h
      const bayar = Math.min(saldo, sisa)
      sisa -= bayar
      return {
        ...h,
        riwayat: [...(h.riwayat || []), {
          id: 'cs-' + Date.now(),
          tgl: tgl || new Date().toISOString().slice(0, 10),
          jumlah: bayar,
          sumber: `Slip Gaji ${periode}`,
          ket: `Dipotong dari slip gaji ${periode}`
        }]
      }
    })
    await set(ref(db, HK_PATH), JSON.stringify(updated))
    await set(ref(db, `users/${USER_ID}/data/_ts`), Date.now())
  } catch (e) { console.error(e) }
}

// ── Download PDF ───────────────────────────────────────────────────────────────
// Menggunakan print dialog browser dengan title dokumen sesuai format filename.
// Di Chrome/Edge, saat pilih Save as PDF, nama file default mengikuti document.title.

async function downloadSlipPdf(s: SlipGaji) {
  const global = await fetchGlobal()
  const color = String(global['default-theme'] || '#1B8A7A')

  // Company data — ambil dari Profil Perusahaan aktif.
  const compName  = String(global['c-name'] || 'PT FinanceBub')
  const compAddr  = String(global['c-addr'] || 'Jl. Tebet Raya No.25B, Jakarta Selatan 12820')
  const compPhone = String(global['c-phone'] || '0815-5555-566')
  const compEmail = String(global['c-email'] || 'admin@financebub.com')
  const logoData  = String(global.logoData || '')

  // Slip gaji wajib memakai tanda tangan HRD, bukan tanda tangan direktur.
  const hrdName   = String(global.hrdName || 'HRD')
  const hrdTitle  = String(global.hrdTitle || 'Human Resources Department')
  const hrdSig    = String(global.hrdSignatureData || '')
  const kota      = 'Jakarta'

  const esc = (value: any) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')

  const fmtTgl = (d: string) => {
    if (!d) return ''
    const dt = new Date(d)
    if (Number.isNaN(dt.getTime())) return d
    return `${dt.getDate()} ${BULAN[dt.getMonth()]} ${dt.getFullYear()}`
  }

  const safeName = (value: string) => String(value || '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  const fileTitle = safeName(`Slip Gaji ${s.nama} ${s.periode || ''}`)
  const money = (n: number) => n > 0 ? `Rp ${fmt(n)}` : '—'

  const makeRows = (rows: { label: string; ket?: string; nom: number }[], type: 'in' | 'out') => {
    const cls = type === 'in' ? 'amount-in' : 'amount-out'
    return rows
      .filter(r => r.label || r.ket || r.nom > 0)
      .map(r => `
        <tr>
          <td>
            <div class="row-label">${esc(r.label)}</div>
            ${r.ket ? `<div class="row-note">${esc(r.ket)}</div>` : ''}
          </td>
          <td class="amount ${cls}">${money(r.nom)}</td>
        </tr>
      `).join('')
  }

  const penerimaanRows = makeRows([
    { label: 'Gaji Pokok', ket: '', nom: s.gajiPokok },
    { label: 'Bonus KPI', ket: s.ketBonusKPI, nom: s.bonusKPI },
    { label: 'Overtime', ket: s.ketOvertime, nom: s.overtime },
    { label: 'Reimburse', ket: s.ketReimburse, nom: s.reimburse },
    ...(s.penCustom || []).map(r => ({ label: r.label || 'Penerimaan Lainnya', ket: r.ket, nom: r.nom }))
  ], 'in')

  const penguranganRows = makeRows([
    { label: 'Kasbon / Cicilan', ket: s.ketKasbon, nom: s.kasbon },
    { label: 'Off-Time', ket: s.ketOfftime, nom: s.offtime },
    ...(s.pngCustom || []).map(r => ({ label: r.label || 'Pengurangan Lainnya', ket: r.ket, nom: r.nom }))
  ], 'out')

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<title>${esc(fileTitle)}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #111827; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; }
  @page { size: A4; margin: 12mm; }
  @media print {
    html, body { width: 210mm; min-height: 297mm; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }

  .sheet {
    width: 100%;
    min-height: calc(297mm - 24mm);
    padding: 0;
    position: relative;
  }

  .topbar {
    border: 1.5px solid #d1d5db;
    border-radius: 14px;
    padding: 16px 18px;
    display: grid;
    grid-template-columns: 1fr 205px;
    gap: 18px;
    align-items: center;
  }
  .company { display: flex; align-items: center; gap: 14px; min-width: 0; }
  .logo-box {
    width: 58px; height: 58px; border: 1px solid #e5e7eb; border-radius: 12px;
    display: flex; align-items: center; justify-content: center; overflow: hidden; flex: 0 0 auto;
  }
  .logo-box img { width: 100%; height: 100%; object-fit: contain; padding: 4px; }
  .logo-fallback { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-weight: 900; color: ${color}; font-size: 14pt; }
  .company-name { font-size: 16pt; font-weight: 900; color: ${color}; line-height: 1.1; margin-bottom: 4px; }
  .company-meta { font-size: 8.5pt; color: #6b7280; line-height: 1.45; }

  .docbox { border-left: 2px solid ${color}; padding-left: 16px; }
  .doc-title { font-size: 20pt; letter-spacing: 2px; font-weight: 900; line-height: 1; margin-bottom: 8px; }
  .doc-period { font-size: 11pt; font-weight: 800; color: ${color}; margin-bottom: 3px; }
  .doc-date { font-size: 8.5pt; color: #6b7280; }

  .employee-card {
    margin-top: 14px;
    border: 1px solid #e5e7eb;
    border-radius: 14px;
    padding: 13px 16px;
  }
  .section-kicker { font-size: 8pt; font-weight: 900; color: ${color}; letter-spacing: .9px; text-transform: uppercase; margin-bottom: 9px; }
  .employee-grid { display: grid; grid-template-columns: 1.2fr 1fr 1fr 1fr; gap: 12px; }
  .field-label { font-size: 7.5pt; color: #6b7280; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 3px; }
  .field-value { font-size: 10.5pt; font-weight: 800; color: #111827; word-break: break-word; }

  .cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    margin-top: 14px;
    align-items: stretch;
  }
  .panel {
    border: 1px solid #e5e7eb;
    border-radius: 14px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-height: 100%;
  }
  .panel-head {
    padding: 10px 14px;
    border-bottom: 1px solid #e5e7eb;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .panel-title { font-size: 10pt; font-weight: 900; text-transform: uppercase; letter-spacing: .7px; }
  .panel-title.in { color: ${color}; }
  .panel-title.out { color: #dc2626; }
  table { width: 100%; border-collapse: collapse; }
  .items { flex: 1; }
  .items td { padding: 9px 13px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
  .items tr:last-child td { border-bottom: none; }
  .row-label { font-size: 9.5pt; font-weight: 800; color: #111827; }
  .row-note { font-size: 8pt; color: #6b7280; margin-top: 2px; line-height: 1.35; }
  .amount { width: 116px; text-align: right; white-space: nowrap; font-weight: 900; font-size: 9.5pt; }
  .amount-in { color: ${color}; }
  .amount-out { color: #dc2626; }
  .panel-total {
    border-top: 1.5px solid #d1d5db;
    padding: 11px 13px;
    display: flex;
    justify-content: space-between;
    gap: 12px;
    margin-top: auto;
  }
  .panel-total span:first-child { font-size: 8.5pt; color: #6b7280; font-weight: 800; text-transform: uppercase; letter-spacing: .5px; }
  .panel-total span:last-child { font-size: 11pt; font-weight: 900; }
  .panel-total .in { color: ${color}; }
  .panel-total .out { color: #dc2626; }

  .summary {
    margin-top: 14px;
    border: 2px solid ${color};
    border-radius: 16px;
    padding: 15px 18px;
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 14px;
  }
  .summary-label { font-size: 9pt; color: #6b7280; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
  .summary-title { font-size: 14pt; font-weight: 900; color: #111827; }
  .summary-value { font-size: 21pt; font-weight: 900; color: ${color}; white-space: nowrap; }

  .sign-row {
    margin-top: 24px;
    display: grid;
    grid-template-columns: 1fr 230px;
    gap: 20px;
    align-items: end;
  }
  .payment-box {
    border-top: 1px solid #e5e7eb;
    padding-top: 10px;
    font-size: 8.5pt;
    color: #6b7280;
    line-height: 1.55;
  }
  .sign-box { text-align: center; }
  .sign-date { font-size: 9pt; color: #374151; margin-bottom: 4px; }
  .sign-space { height: 62px; display: flex; align-items: center; justify-content: center; }
  .sign-space img { max-height: 58px; max-width: 165px; object-fit: contain; }
  .sign-line { border-top: 1.5px solid #111827; padding-top: 5px; }
  .sign-name { font-size: 9.5pt; font-weight: 900; }
  .sign-title { font-size: 8pt; color: #6b7280; margin-top: 2px; }
</style>
</head>
<body>
  <main class="sheet">
    <section class="topbar">
      <div class="company">
        <div class="logo-box">
          ${logoData ? `<img src="${logoData}" alt="Logo" />` : `<div class="logo-fallback">DK</div>`}
        </div>
        <div>
          <div class="company-name">${esc(compName)}</div>
          <div class="company-meta">${esc(compAddr)}</div>
          <div class="company-meta">${esc(compPhone)} · ${esc(compEmail)}</div>
        </div>
      </div>
      <div class="docbox">
        <div class="doc-title">SLIP GAJI</div>
        <div class="doc-period">${esc(s.periode || '-')}</div>
        <div class="doc-date">Tanggal Gaji: ${esc(fmtTgl(s.tglGaji))}</div>
      </div>
    </section>

    <section class="employee-card">
      <div class="section-kicker">Data Karyawan</div>
      <div class="employee-grid">
        <div><div class="field-label">Nama</div><div class="field-value">${esc(s.nama)}</div></div>
        <div><div class="field-label">Jabatan</div><div class="field-value">${esc(s.jabatan || '—')}</div></div>
        <div><div class="field-label">Bank</div><div class="field-value">${esc(s.bank || '—')}</div></div>
        <div><div class="field-label">No. Rekening</div><div class="field-value">${esc(s.noRek || '—')}</div></div>
      </div>
    </section>

    <section class="cols">
      <div class="panel">
        <div class="panel-head"><div class="panel-title in">Penerimaan</div></div>
        <table class="items"><tbody>${penerimaanRows || `<tr><td>—</td><td class="amount">—</td></tr>`}</tbody></table>
        <div class="panel-total"><span>Total Penerimaan</span><span class="in">Rp ${fmt(s.totalPenerimaan)}</span></div>
      </div>

      <div class="panel">
        <div class="panel-head"><div class="panel-title out">Pengurangan</div></div>
        <table class="items"><tbody>${penguranganRows || `<tr><td>—</td><td class="amount">—</td></tr>`}</tbody></table>
        <div class="panel-total"><span>Total Pengurangan</span><span class="out">Rp ${fmt(s.totalPengurangan)}</span></div>
      </div>
    </section>

    <section class="summary">
      <div>
        <div class="summary-label">Total Take Home Pay</div>
        <div class="summary-title">Gaji Bersih Diterima</div>
      </div>
      <div class="summary-value">Rp ${fmt(s.takeHomePay)}</div>
    </section>

    <section class="sign-row">
      <div class="payment-box">
        Pembayaran ditransfer ke rekening karyawan sesuai data bank yang tercantum pada slip ini.
      </div>
      <div class="sign-box">
        <div class="sign-date">${esc(kota)}, ${esc(fmtTgl(s.tglTTD || s.tglGaji))}</div>
        <div class="sign-space">${hrdSig ? `<img src="${hrdSig}" alt="Tanda tangan HRD" />` : ''}</div>
        <div class="sign-line">
          <div class="sign-name">${esc(hrdName)}</div>
          <div class="sign-title">${esc(hrdTitle)}</div>
        </div>
      </div>
    </section>
  </main>

<script>
  window.onload = function(){
    document.title = ${JSON.stringify(fileTitle)};
    setTimeout(function(){ window.print(); }, 250);
  };
  window.onafterprint = function(){ setTimeout(function(){ window.close(); }, 250); };
</script>
</body>
</html>`

  const w = window.open('', '_blank', 'width=980,height=920')
  if (w) { w.document.write(html); w.document.close() }
}

// ── Slip Modal ────────────────────────────────────────────────────────────────

function SlipModal({ initial, year, karyawan, onSave, onClose }: {
  initial: SlipGaji | null; year: number; karyawan: Karyawan[]
  onSave: (s: SlipGaji) => void; onClose: () => void
}) {
  const nowM  = new Date().getMonth()
  const aktif = karyawan.filter(k => k.status === 'Aktif')

  const [karId,        setKarId]        = useState(initial?.karId        || aktif[0]?.id || '')
  const [periode,      setPeriode]      = useState(initial?.periode      || `${BULAN[nowM]} ${year}`)
  const [tglGaji,      setTglGaji]      = useState(initial?.tglGaji      || new Date().toISOString().slice(0, 10))
  const [tglTTD,       setTglTTD]       = useState(initial?.tglTTD       || new Date().toISOString().slice(0, 10))
  const [gajiPokok,    setGajiPokok]    = useState(initial?.gajiPokok    || 0)
  const [bonusKPI,     setBonusKPI]     = useState(initial?.bonusKPI     || 0)
  const [ketBonusKPI,  setKetBonusKPI]  = useState(initial?.ketBonusKPI  || '')
  const [overtime,     setOvertime]     = useState(initial?.overtime     || 0)
  const [ketOvertime,  setKetOvertime]  = useState(initial?.ketOvertime  || '')
  const [reimburse,    setReimburse]    = useState(initial?.reimburse    || 0)
  const [ketReimburse, setKetReimburse] = useState(initial?.ketReimburse || '')
  const [kasbon,       setKasbon]       = useState(initial?.kasbon       || 0)
  const [ketKasbon,    setKetKasbon]    = useState(initial?.ketKasbon    || '')
  const [offtime,      setOfftime]      = useState(initial?.offtime      || 0)
  const [ketOfftime,   setKetOfftime]   = useState(initial?.ketOfftime   || '')
  const [penCustom,    setPenCustom]    = useState<CustomRow[]>(initial?.penCustom  || [])
  const [pngCustom,    setPngCustom]    = useState<CustomRow[]>(initial?.pngCustom  || [])
  const [saldoKasbon,  setSaldoKasbon]  = useState(0)

  useEffect(() => {
    if (!karId) return
    const k = karyawan.find(x => x.id === karId)
    if (k?.gajiPokok && !initial) setGajiPokok(k.gajiPokok)
    getSaldoKasbon(karId).then(setSaldoKasbon)
  }, [karId])

  const totalPen  = gajiPokok + bonusKPI + overtime + reimburse + penCustom.reduce((a, r) => a + r.nom, 0)
  const totalPng  = kasbon + offtime + pngCustom.reduce((a, r) => a + r.nom, 0)
  const thp       = totalPen - totalPng
  const sisaKasbon = Math.max(0, saldoKasbon - kasbon)
  const kar       = karyawan.find(k => k.id === karId)

  const inp    = 'w-full px-3 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A]'
  const nomInp = 'w-32 px-2 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A] text-right'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">

        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">{initial ? 'Edit Slip Gaji' : 'Buat Slip Gaji'}</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400"><X size={15} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">

          {/* Header form */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Karyawan *</label>
              <select value={karId} onChange={e => setKarId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A]">
                {aktif.map(k => <option key={k.id} value={k.id}>{k.nama} — {k.jabatan}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Periode</label>
              <select value={periode} onChange={e => setPeriode(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A]">
                {BULAN.map(b => <option key={b} value={`${b} ${year}`}>{b} {year}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Tanggal Gaji</label>
              <input type="date" value={tglGaji} onChange={e => setTglGaji(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A]" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Tanggal TTD</label>
              <input type="date" value={tglTTD} onChange={e => setTglTTD(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-[#1B8A7A]" />
            </div>
          </div>

          {/* PENERIMAAN */}
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Penerimaan</p>
            <table className="w-full">
              <thead>
                <tr className="bg-green-50">
                  <th className="px-3 py-2 text-left text-[10px] text-gray-500 font-semibold w-36">Item</th>
                  <th className="px-2 py-2 text-left text-[10px] text-gray-500 font-semibold">Keterangan</th>
                  <th className="px-2 py-2 text-right text-[10px] text-gray-500 font-semibold w-36">Nominal</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-gray-50">
                  <td className="px-3 py-2 text-xs font-medium text-gray-700">Gaji Pokok</td>
                  <td></td>
                  <td className="px-2 py-1.5 text-right"><input type="number" value={gajiPokok||''} onChange={e=>setGajiPokok(+e.target.value)} className={nomInp} /></td>
                </tr>
                <tr className="border-b border-gray-50">
                  <td className="px-3 py-2 text-xs font-medium text-gray-700">Bonus KPI</td>
                  <td className="px-2 py-1.5"><input value={ketBonusKPI} onChange={e=>setKetBonusKPI(e.target.value)} placeholder="Keterangan..." className={inp} /></td>
                  <td className="px-2 py-1.5 text-right"><input type="number" value={bonusKPI||''} onChange={e=>setBonusKPI(+e.target.value)} className={nomInp} /></td>
                </tr>
                <tr className="border-b border-gray-50">
                  <td className="px-3 py-2 text-xs font-medium text-gray-700">Overtime</td>
                  <td className="px-2 py-1.5"><input value={ketOvertime} onChange={e=>setKetOvertime(e.target.value)} placeholder="Keterangan..." className={inp} /></td>
                  <td className="px-2 py-1.5 text-right"><input type="number" value={overtime||''} onChange={e=>setOvertime(+e.target.value)} className={nomInp} /></td>
                </tr>
                <tr className="border-b border-gray-50">
                  <td className="px-3 py-2 text-xs font-medium text-gray-700">Reimburse</td>
                  <td className="px-2 py-1.5"><input value={ketReimburse} onChange={e=>setKetReimburse(e.target.value)} placeholder="Keterangan..." className={inp} /></td>
                  <td className="px-2 py-1.5 text-right"><input type="number" value={reimburse||''} onChange={e=>setReimburse(+e.target.value)} className={nomInp} /></td>
                </tr>
                {penCustom.map((r, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="px-2 py-1.5"><input value={r.label} onChange={e=>setPenCustom(p=>p.map((x,j)=>j===i?{...x,label:e.target.value}:x))} placeholder="Label..." className={inp} /></td>
                    <td className="px-2 py-1.5"><input value={r.ket} onChange={e=>setPenCustom(p=>p.map((x,j)=>j===i?{...x,ket:e.target.value}:x))} placeholder="Keterangan..." className={inp} /></td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1 justify-end">
                        <input type="number" value={r.nom||''} onChange={e=>setPenCustom(p=>p.map((x,j)=>j===i?{...x,nom:+e.target.value}:x))} className={nomInp} />
                        <button onClick={()=>setPenCustom(p=>p.filter((_,j)=>j!==i))} className="text-red-400 hover:text-red-600"><X size={12}/></button>
                      </div>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={3} className="px-3 py-1.5">
                    <button onClick={()=>setPenCustom(p=>[...p,{label:'',ket:'',nom:0}])} className="text-xs text-[#1B8A7A] hover:underline">+ Tambah item</button>
                  </td>
                </tr>
                <tr className="bg-green-50">
                  <td className="px-3 py-2 text-xs font-semibold" colSpan={2}>Total Penerimaan</td>
                  <td className="px-2 py-2 text-right text-green-700 font-bold text-sm">Rp {fmt(totalPen)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* PENGURANGAN */}
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Pengurangan</p>
            <table className="w-full">
              <thead>
                <tr className="bg-red-50">
                  <th className="px-3 py-2 text-left text-[10px] text-gray-500 font-semibold w-36">Item</th>
                  <th className="px-2 py-2 text-left text-[10px] text-gray-500 font-semibold">Keterangan</th>
                  <th className="px-2 py-2 text-right text-[10px] text-gray-500 font-semibold w-36">Nominal</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-gray-50">
                  <td className="px-3 py-2 text-xs font-medium text-gray-700">
                    <div>Kasbon / Cicilan</div>
                    {saldoKasbon > 0
                      ? <div className="text-[10px] text-red-500 mt-0.5">Saldo aktif: Rp {fmt(saldoKasbon)}</div>
                      : <div className="text-[10px] text-green-500 mt-0.5">Tidak ada kasbon aktif</div>
                    }
                  </td>
                  <td className="px-2 py-1.5"><input value={ketKasbon} onChange={e=>setKetKasbon(e.target.value)} placeholder="Keterangan cicilan..." className={inp} /></td>
                  <td className="px-2 py-1.5 text-right"><input type="number" value={kasbon||''} onChange={e=>setKasbon(+e.target.value)} className={nomInp} /></td>
                </tr>
                {kasbon > 0 && saldoKasbon > 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-1.5">
                      <div className={`text-[11px] px-2.5 py-1.5 rounded-lg ${kasbon >= saldoKasbon ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                        {kasbon >= saldoKasbon ? '✓ Kasbon lunas setelah slip ini' : `Sisa kasbon bulan berikutnya: Rp ${fmt(sisaKasbon)}`}
                      </div>
                    </td>
                  </tr>
                )}
                <tr className="border-b border-gray-50">
                  <td className="px-3 py-2 text-xs font-medium text-gray-700">Off-Time</td>
                  <td className="px-2 py-1.5"><input value={ketOfftime} onChange={e=>setKetOfftime(e.target.value)} placeholder="Keterangan..." className={inp} /></td>
                  <td className="px-2 py-1.5 text-right"><input type="number" value={offtime||''} onChange={e=>setOfftime(+e.target.value)} className={nomInp} /></td>
                </tr>
                {pngCustom.map((r, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="px-2 py-1.5"><input value={r.label} onChange={e=>setPngCustom(p=>p.map((x,j)=>j===i?{...x,label:e.target.value}:x))} placeholder="Label..." className={inp} /></td>
                    <td className="px-2 py-1.5"><input value={r.ket} onChange={e=>setPngCustom(p=>p.map((x,j)=>j===i?{...x,ket:e.target.value}:x))} placeholder="Keterangan..." className={inp} /></td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1 justify-end">
                        <input type="number" value={r.nom||''} onChange={e=>setPngCustom(p=>p.map((x,j)=>j===i?{...x,nom:+e.target.value}:x))} className={nomInp} />
                        <button onClick={()=>setPngCustom(p=>p.filter((_,j)=>j!==i))} className="text-red-400 hover:text-red-600"><X size={12}/></button>
                      </div>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={3} className="px-3 py-1.5">
                    <button onClick={()=>setPngCustom(p=>[...p,{label:'',ket:'',nom:0}])} className="text-xs text-red-400 hover:underline">+ Tambah potongan</button>
                  </td>
                </tr>
                <tr className="bg-red-50">
                  <td className="px-3 py-2 text-xs font-semibold" colSpan={2}>Total Pengurangan</td>
                  <td className="px-2 py-2 text-right text-red-600 font-bold text-sm">Rp {fmt(totalPng)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* THP */}
          <div className="rounded-xl p-4 flex items-center justify-between" style={{backgroundColor:'#1B8A7A'}}>
            <span className="font-bold text-sm text-white">TAKE HOME PAY</span>
            <span className="font-black text-lg text-white">Rp {fmt(thp)}</span>
          </div>

        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 border border-gray-200 text-sm rounded-lg hover:bg-gray-50">Batal</button>
          <button
            onClick={() => {
              if (!karId)   { alert('Pilih karyawan'); return }
              if (!periode) { alert('Pilih periode');  return }
              onSave({
                id: initial?.id || ('sg-' + Date.now()),
                periode, tglGaji, tglTTD, karId,
                nama:    kar?.nama    || '(Manual)',
                jabatan: kar?.jabatan || '',
                bank:    kar?.bank    || '',
                noRek:   kar?.noRek   || '',
                gajiPokok, bonusKPI, ketBonusKPI,
                overtime,  ketOvertime,
                reimburse, ketReimburse,
                kasbon,    ketKasbon,
                offtime,   ketOfftime,
                penCustom, pngCustom,
                totalPenerimaan:  totalPen,
                totalPengurangan: totalPng,
                takeHomePay:      thp,
              })
            }}
            className="flex-1 py-2 bg-[#1B8A7A] hover:bg-[#0F6E56] text-white text-sm font-semibold rounded-lg"
          >
            Simpan Slip
          </button>
        </div>

      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function GajiPage() {
  const YEARS = useYearList()
  const { user }  = useAuth()
  const [year,      setYear]      = useState(new Date().getFullYear())
  const [karyawan,  setKaryawan]  = useState<Karyawan[]>([])
  const [slips,     setSlips]     = useState<SlipGaji[]>([])
  const [loading,   setLoading]   = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editSlip,  setEditSlip]  = useState<SlipGaji | null>(null)
  const [openPeriode, setOpenPeriode] = useState<string | null>(null)
  const [deletingPeriode, setDeletingPeriode] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    let kDone = false, sDone = false
    const check = () => { if (kDone && sDone) setLoading(false) }
    const uK = subscribeArr(KAR_PATH, d => { setKaryawan(d); kDone = true; check() })
    const uS = subscribeArr(`users/${USER_ID}/data/yr_${year}_sg`, d => { setSlips(d); sDone = true; check() })
    return () => { uK(); uS() }
  }, [year])

  const handleSave = async (s: SlipGaji) => {
    const idx = slips.findIndex(x => x.id === s.id)
    const updated = idx >= 0 ? slips.map((x, i) => i === idx ? s : x) : [s, ...slips]
    setSlips(updated)
    await saveSlips(year, updated)
    if (s.kasbon > 0) await cicilKasbonFromSlip(s.karId, s.kasbon, s.periode, s.tglGaji)
    setShowModal(false)
    setEditSlip(null)
  }

  const handleDelete = async (s: SlipGaji) => {
    if (!confirm(`Hapus slip ${s.nama} — ${s.periode}?`)) return
    const updated = slips.filter(x => x.id !== s.id)
    setSlips(updated)
    await saveSlips(year, updated)
  }

  const handleDeletePeriode = async (periode: string, itemCount: number) => {
    const ok = confirm(
      `Hapus seluruh ${itemCount} slip gaji periode ${periode}?\n\nTindakan ini tidak dapat dibatalkan.`
    )
    if (!ok) return

    setDeletingPeriode(periode)
    try {
      const updated = slips.filter(s => (s.periode || 'Tanpa Periode') !== periode)
      setSlips(updated)
      await saveSlips(year, updated)
      if (openPeriode === periode) setOpenPeriode(null)
    } catch (error) {
      console.error(error)
      alert('Gagal menghapus slip gaji per bulan. Silakan coba lagi.')
    } finally {
      setDeletingPeriode(null)
    }
  }

  // Group slips by periode, sorted newest first
  const grouped: { periode: string; items: SlipGaji[] }[] = []
  const periodeOrder: string[] = []
  ;[...slips].sort((a, b) => (b.tglGaji||'').localeCompare(a.tglGaji||'')).forEach(s => {
    const p = s.periode || 'Tanpa Periode'
    if (!periodeOrder.includes(p)) periodeOrder.push(p)
  })
  periodeOrder.forEach(p => {
    grouped.push({
      periode: p,
      items: slips.filter(s => (s.periode || 'Tanpa Periode') === p)
                  .sort((a, b) => (a.nama||'').localeCompare(b.nama||''))
    })
  })

  const totalTHP = slips.reduce((a, s) => a + (+s.takeHomePay || 0), 0)

  return (
    <div className="p-6">
      {showModal && (
        <SlipModal
          initial={editSlip}
          year={year}
          karyawan={karyawan}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditSlip(null) }}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Slip Gaji <span className="text-gray-400 font-normal text-base">{year}</span></h1>
          <p className="text-sm text-gray-400 mt-0.5">{slips.length} slip · Total THP Rp {fmt(totalTHP)}</p>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <select value={year} onChange={e => setYear(+e.target.value)}
              className="appearance-none pl-3 pr-8 py-2 text-sm border border-gray-200 rounded-lg bg-white outline-none focus:border-[#1B8A7A] cursor-pointer">
              {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          </div>
          {user?.role === 'admin' && (
            <button onClick={() => { setEditSlip(null); setShowModal(true) }}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#1B8A7A] hover:bg-[#0F6E56] text-white text-sm font-semibold rounded-lg">
              <Plus size={15} /> Buat Slip Gaji
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-white rounded-xl border border-gray-100 animate-pulse" />)}</div>
      ) : slips.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <div className="text-4xl mb-3">💰</div>
          <p className="text-sm text-gray-400">Belum ada slip gaji di tahun {year}</p>
          {user?.role === 'admin' && (
            <button onClick={() => { setEditSlip(null); setShowModal(true) }} className="mt-3 text-sm text-[#1B8A7A] hover:underline">
              + Buat slip pertama
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map(({ periode, items }) => {
            const totPen = items.reduce((a, s) => a + (+s.totalPenerimaan || 0), 0)
            const totPng = items.reduce((a, s) => a + (+s.totalPengurangan || 0), 0)
            const totTHP = items.reduce((a, s) => a + (+s.takeHomePay || 0), 0)
            const isOpen = openPeriode === periode
            const isDeleting = deletingPeriode === periode

            return (
              <div key={periode} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                {/* Periode header — klik untuk membuka/menutup daftar slip */}
                <div className="flex items-stretch bg-emerald-50/70">
                  <button
                    type="button"
                    onClick={() => setOpenPeriode(isOpen ? null : periode)}
                    className="flex-1 min-w-0 flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-emerald-50 transition-colors"
                    aria-expanded={isOpen}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white border border-emerald-100 text-[#1B8A7A] flex-shrink-0">
                        <ChevronDown size={16} className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold text-gray-900">{periode}</span>
                          <span className="rounded-full bg-white border border-emerald-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">
                            {items.length} karyawan
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-gray-400">
                          {isOpen ? 'Klik untuk sembunyikan daftar slip' : 'Klik untuk melihat daftar slip gaji'}
                        </p>
                      </div>
                    </div>

                    <div className="hidden lg:grid grid-cols-3 gap-6 text-right flex-shrink-0">
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-gray-400">Penerimaan</div>
                        <div className="mt-0.5 text-xs font-semibold text-green-700">Rp {fmt(totPen)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-gray-400">Pengurangan</div>
                        <div className={`mt-0.5 text-xs font-semibold ${totPng > 0 ? 'text-red-500' : 'text-gray-300'}`}>
                          {totPng > 0 ? `Rp ${fmt(totPng)}` : '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-gray-400">Total THP</div>
                        <div className="mt-0.5 text-sm font-bold text-[#1B8A7A]">Rp {fmt(totTHP)}</div>
                      </div>
                    </div>
                  </button>

                  {user?.role === 'admin' && (
                    <div className="flex items-center border-l border-emerald-100 px-3">
                      <button
                        type="button"
                        onClick={() => handleDeletePeriode(periode, items.length)}
                        disabled={isDeleting}
                        title={`Hapus semua slip periode ${periode}`}
                        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-red-500 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Trash2 size={14} />
                        <span className="hidden xl:inline">{isDeleting ? 'Menghapus...' : 'Hapus Bulan'}</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Ringkasan mobile */}
                <div className="grid grid-cols-3 gap-2 border-t border-emerald-100 bg-emerald-50/40 px-4 py-2 lg:hidden">
                  <div>
                    <div className="text-[9px] uppercase text-gray-400">Penerimaan</div>
                    <div className="text-[11px] font-semibold text-green-700">Rp {fmt(totPen)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase text-gray-400">Pengurangan</div>
                    <div className={`text-[11px] font-semibold ${totPng > 0 ? 'text-red-500' : 'text-gray-300'}`}>
                      {totPng > 0 ? `Rp ${fmt(totPng)}` : '—'}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[9px] uppercase text-gray-400">THP</div>
                    <div className="text-[11px] font-bold text-[#1B8A7A]">Rp {fmt(totTHP)}</div>
                  </div>
                </div>

                {/* Daftar slip hanya tampil saat bulan dibuka */}
                {isOpen && (
                  <div className="divide-y divide-gray-100 border-t border-gray-100">
                    {items.map((s, i) => (
                      <div
                        key={s.id}
                        className="flex flex-col gap-3 px-5 py-3.5 transition-colors hover:bg-gray-50 xl:flex-row xl:items-center"
                        style={{ backgroundColor: i % 2 === 0 ? '#fff' : '#fcfcfc' }}
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <div
                            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                            style={{ backgroundColor: '#1B8A7A' }}
                          >
                            {(s.nama || '?').charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-gray-900">{s.nama}</div>
                            <div className="text-[11px] text-gray-400">{s.jabatan || '—'} · {s.tglGaji}</div>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-3 xl:flex xl:items-center">
                          <div className="xl:w-28 xl:text-right">
                            <div className="text-[9px] uppercase text-gray-400 xl:hidden">Penerimaan</div>
                            <div className="text-xs font-medium text-green-700 xl:text-sm">Rp {fmt(+s.totalPenerimaan || 0)}</div>
                          </div>
                          <div className="xl:w-28 xl:text-right">
                            <div className="text-[9px] uppercase text-gray-400 xl:hidden">Pengurangan</div>
                            {(+s.totalPengurangan || 0) > 0
                              ? <div className="text-xs font-medium text-red-500 xl:text-sm">Rp {fmt(+s.totalPengurangan)}</div>
                              : <div className="text-xs text-gray-300 xl:text-sm">—</div>}
                          </div>
                          <div className="text-right xl:w-32">
                            <div className="text-[9px] uppercase text-gray-400 xl:hidden">THP</div>
                            <div className="text-sm font-bold text-[#1B8A7A]">Rp {fmt(+s.takeHomePay || 0)}</div>
                          </div>
                        </div>

                        <div className="flex items-center justify-end gap-1 xl:w-40">
                          <button
                            onClick={() => downloadSlipPdf(s)}
                            title="Download PDF"
                            className="inline-flex items-center gap-1.5 rounded-lg bg-[#1B8A7A] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-[#0F6E56]"
                          >
                            <Download size={13} /> Download PDF
                          </button>
                          {user?.role === 'admin' && <>
                            <button onClick={() => { setEditSlip(s); setShowModal(true) }} title="Edit" className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600"><Pencil size={13}/></button>
                            <button onClick={() => handleDelete(s)} title="Hapus" className="p-1.5 hover:bg-red-50 rounded-lg text-gray-400 hover:text-red-500"><Trash2 size={13}/></button>
                          </>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
