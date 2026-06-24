'use client'

import { useRef, useState } from 'react'
import { X, Download, Loader2 } from 'lucide-react'
import { fmt } from '@/lib/utils'

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

interface Props {
  slip: SlipGaji
  onClose: () => void
}

export default function SlipPreviewModal({ slip: s, onClose }: Props) {
  const slipRef = useRef<HTMLDivElement>(null)
  const [downloading, setDownloading] = useState(false)
  const col = '#1B8A7A'
  const dark = '#0F6E56'

  const penerimaan = [
    s.gajiPokok  ? { label: 'Gaji Pokok',  ket: '',              nom: s.gajiPokok  } : null,
    s.bonusKPI   ? { label: 'Bonus KPI',   ket: s.ketBonusKPI,  nom: s.bonusKPI   } : null,
    s.overtime   ? { label: 'Overtime',    ket: s.ketOvertime,  nom: s.overtime   } : null,
    s.reimburse  ? { label: 'Reimburse',   ket: s.ketReimburse, nom: s.reimburse  } : null,
    ...(s.penCustom || []).filter(r => r.nom > 0),
  ].filter(Boolean) as { label: string; ket: string; nom: number }[]

  const pengurangan = [
    s.kasbon  ? { label: 'Kasbon / Cicilan', ket: s.ketKasbon,  nom: s.kasbon  } : null,
    s.offtime ? { label: 'Off-Time',         ket: s.ketOfftime, nom: s.offtime } : null,
    ...(s.pngCustom || []).filter(r => r.nom > 0),
  ].filter(Boolean) as { label: string; ket: string; nom: number }[]

  // Samakan jumlah baris agar total sejajar
  const maxRows = Math.max(penerimaan.length, pengurangan.length)
  while (penerimaan.length < maxRows) penerimaan.push({ label: '', ket: '', nom: -1 })
  while (pengurangan.length < maxRows) pengurangan.push({ label: '', ket: '', nom: -1 })

  const fileName = `Slip Gaji ${s.nama} ${s.periode}`

  const handleDownload = async () => {
    if (!slipRef.current) return
    setDownloading(true)
    try {
      /* eslint-disable */
      const h2c = (await import(/* webpackIgnore: true */ 'html2canvas' as string)) as any
      const html2canvas = h2c.default ?? h2c
      const { default: jsPDF } = await import('jspdf')
      /* eslint-enable */

      const canvas = await html2canvas(slipRef.current, {
        scale: 3,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
      })

      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a5' })
      const pdfW = pdf.internal.pageSize.getWidth()
      const pdfH = pdf.internal.pageSize.getHeight()
      const imgW = canvas.width
      const imgH = canvas.height
      const ratio = Math.min(pdfW / imgW, pdfH / imgH)
      const x = (pdfW - imgW * ratio) / 2
      const y = (pdfH - imgH * ratio) / 2
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', x, y, imgW * ratio, imgH * ratio)
      pdf.save(`${fileName}.pdf`)
    } catch (e) {
      console.error(e)
      alert('Gagal download PDF, coba lagi')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', background: 'rgba(0,0,0,0.65)' }}>
      <div style={{ position: 'relative', background: '#1e1e1e', borderRadius: '16px', width: '100%', maxWidth: '860px', maxHeight: '95vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}>

        {/* Topbar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#fff' }}>{fileName}</div>
            <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>Preview A5 Landscape · PDF siap download</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={handleDownload}
              disabled={downloading}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', background: col, color: '#fff', border: 'none', padding: '8px 18px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: downloading ? 'not-allowed' : 'pointer', opacity: downloading ? 0.7 : 1, transition: 'background 0.15s' }}
            >
              {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {downloading ? 'Mengunduh...' : 'Download PDF'}
            </button>
            <button
              onClick={onClose}
              style={{ padding: '8px', background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: '8px', cursor: 'pointer', color: '#aaa', display: 'flex', alignItems: 'center' }}
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Scroll area */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', justifyContent: 'center' }}>

          {/* Slip A5 landscape wrapper */}
          <div
            ref={slipRef}
            style={{
              width: '794px',
              background: '#fff',
              borderRadius: '6px',
              overflow: 'hidden',
              fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
              fontSize: '10px',
              color: '#1a1a1a',
              flexShrink: 0,
            }}
          >
            {/* Header teal */}
            <div style={{ background: col, padding: '13px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '11px' }}>
                <div>
                  <div style={{ color: '#fff', fontWeight: 800, fontSize: '13px' }}>PT FinanceBub</div>
                  <div style={{ color: 'rgba(255,255,255,0.72)', fontSize: '8px', marginTop: '2px' }}>Jl. Tebet Raya No.25B, Jakarta Selatan · admin@financebub.com · 0815-5555-566</div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ color: '#fff', fontWeight: 900, fontSize: '16px', letterSpacing: '2px' }}>SLIP GAJI</div>
                <div style={{ background: 'rgba(255,255,255,0.18)', color: '#fff', fontSize: '8px', padding: '2px 8px', borderRadius: '20px', marginTop: '4px', display: 'inline-block', fontWeight: 600 }}>{s.periode}</div>
              </div>
            </div>

            {/* Bio strip */}
            <div style={{ background: '#f8fffe', borderBottom: '1px solid #e0f2ee', padding: '9px 20px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 0 }}>
              {[
                ['Nama Karyawan', s.nama],
                ['Jabatan', s.jabatan],
                ['Bank', s.bank || '—'],
                ['No. Rekening', s.noRek || '—'],
              ].map(([label, val], i) => (
                <div key={label} style={{ paddingLeft: i > 0 ? '14px' : 0, paddingRight: i < 3 ? '14px' : 0, borderRight: i < 3 ? '1px solid #d0ede8' : 'none' }}>
                  <div style={{ fontSize: '7px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: '2px' }}>{label}</div>
                  <div style={{ fontSize: '10.5px', fontWeight: 700, color: '#1a1a1a' }}>{val}</div>
                </div>
              ))}
            </div>

            {/* Body */}
            <div style={{ padding: '14px 20px 0' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>

                {/* Penerimaan */}
                <div style={{ paddingRight: '16px', borderRight: '1px solid #eee' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                    <div style={{ width: '3px', height: '11px', background: col, borderRadius: '2px' }}></div>
                    <span style={{ fontSize: '8.5px', fontWeight: 700, color: col, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Penerimaan</span>
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <tbody>
                      {penerimaan.map((r, i) => r.nom === -1 ? (
                        <tr key={i}><td style={{ padding: '3.5px 0' }}>&nbsp;</td><td></td></tr>
                      ) : (
                        <tr key={i}>
                          <td style={{ padding: '3.5px 0', fontSize: '9px', color: '#555' }}>
                            {r.label}
                            {r.ket && <span style={{ color: '#aaa', fontSize: '7.5px', marginLeft: '4px' }}>{r.ket}</span>}
                          </td>
                          <td style={{ padding: '3.5px 0', fontSize: '9px', textAlign: 'right', fontWeight: 600, color: '#1a1a1a', whiteSpace: 'nowrap' }}>Rp {fmt(r.nom)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pengurangan */}
                <div style={{ paddingLeft: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                    <div style={{ width: '3px', height: '11px', background: '#dc2626', borderRadius: '2px' }}></div>
                    <span style={{ fontSize: '8.5px', fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Pengurangan</span>
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <tbody>
                      {pengurangan.map((r, i) => r.nom === -1 ? (
                        <tr key={i}><td style={{ padding: '3.5px 0' }}>&nbsp;</td><td></td></tr>
                      ) : (
                        <tr key={i}>
                          <td style={{ padding: '3.5px 0', fontSize: '9px', color: '#555' }}>
                            {r.label}
                            {r.ket && <span style={{ color: '#aaa', fontSize: '7.5px', marginLeft: '4px' }}>{r.ket}</span>}
                          </td>
                          <td style={{ padding: '3.5px 0', fontSize: '9px', textAlign: 'right', fontWeight: 600, color: '#dc2626', whiteSpace: 'nowrap' }}>Rp {fmt(r.nom)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Total row sejajar */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, marginTop: '6px' }}>
                <div style={{ paddingRight: '16px', borderRight: '1px solid #eee', borderTop: '1px dashed #d0ede8', paddingTop: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '9px', fontWeight: 700, color: col }}>Total Penerimaan</span>
                  <span style={{ fontSize: '10.5px', fontWeight: 800, color: col }}>{fmt(s.totalPenerimaan)}</span>
                </div>
                <div style={{ paddingLeft: '16px', borderTop: '1px dashed #fde8e8', paddingTop: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '9px', fontWeight: 700, color: '#dc2626' }}>Total Pengurangan</span>
                  <span style={{ fontSize: '10.5px', fontWeight: 800, color: '#dc2626' }}>{fmt(s.totalPengurangan)}</span>
                </div>
              </div>
            </div>

            {/* THP */}
            <div style={{ background: dark, padding: '11px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
              <div>
                <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: '7.5px', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '1px' }}>Take Home Pay</div>
                <div style={{ color: '#fff', fontWeight: 900, fontSize: '17px', letterSpacing: '-0.5px' }}>Rp {fmt(s.takeHomePay)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '7.5px' }}>Tanggal Gaji</div>
                <div style={{ color: '#fff', fontSize: '9px', fontWeight: 600, marginTop: '1px' }}>{s.tglGaji}</div>
              </div>
            </div>

            {/* Footer */}
            <div style={{ padding: '10px 20px', display: 'flex', justifyContent: 'flex-end', background: '#fafafa' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '7.5px', color: '#888', marginBottom: '18px' }}>Mengetahui,</div>
                <div style={{ width: '90px', borderTop: '1px solid #444', paddingTop: '3px', margin: '0 auto' }}>
                  <div style={{ fontSize: '8px', fontWeight: 700, color: '#333' }}>Handika Setia Budi</div>
                  <div style={{ fontSize: '7.5px', color: '#777' }}>Direktur</div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  )
}
