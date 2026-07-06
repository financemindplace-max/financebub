// FINANCEBUB_DIRECT_JSPDF_DOWNLOAD_V2
import type { Doc, DocItem } from '@/types/document'

type DocumentKind = 'quotation' | 'invoice'
type RGB = { r: number; g: number; b: number }
type JsPdfConstructor = new (options: Record<string, unknown>) => any

declare global {
  interface Window {
    jspdf?: { jsPDF: JsPdfConstructor }
    __financebubJsPdfLoading?: Promise<JsPdfConstructor>
  }
}

type CompanyAccount = {
  id?: string
  bank?: string
  branch?: string
  accName?: string
  accNo?: string
  label?: string
}

type CompanyProfile = {
  id?: string
  name?: string
  tax?: string
  addr?: string
  phone?: string
  email?: string
  web?: string
  bank?: string
  branch?: string
  accName?: string
  accNo?: string
  logoData?: string
  accounts?: CompanyAccount[]
  activeAccountId?: string
}

type RenderItem = DocItem & {
  _showBrand?: boolean
  _showItem?: boolean
}

export type LegacyDocumentData = {
  kind: DocumentKind
  isQuotation: boolean
  theme: string
  fields: Record<string, string>
  items: RenderItem[]
  currency: string
  subtotal: number
  discount: number
  discLabel: string
  grossUp: number
  grossLabel: string
  extra1: number
  extra2: number
  extra1Label: string
  extra2Label: string
  showGross: boolean
  showExtra1: boolean
  showExtra2: boolean
  total: number
  showSub: boolean
  showDisc: boolean
  logoData: string
  signatureData: string
  fileName: string
}

function asString(value: unknown): string {
  return String(value ?? '').trim()
}

function numberFrom(value: unknown): number {
  const parsed = Number.parseFloat(String(value ?? '0'))
  return Number.isFinite(parsed) ? parsed : 0
}

function sanitizeFileName(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\s+-\s+/g, ' - ')
    .replace(/\.+$/g, '')
    .trim()
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function nl2br(value: unknown): string {
  return escapeHtml(value).replace(/\r\n|\r|\n/g, '<br>')
}

function fmt(value: number | undefined | null): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-'
  return Math.round(Number(value)).toLocaleString('id-ID')
}

function fmtDateFull(value: string): string {
  if (!value) return '-'
  const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
  const parts = value.split('-')
  if (parts.length < 3) return value
  const monthIndex = Number(parts[1]) - 1
  return `${Number(parts[2])} ${months[monthIndex] || parts[1]} ${parts[0]}`
}

function hexToRgb(hex = '#1B8A7A'): RGB {
  const safe = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#1B8A7A'
  return {
    r: Number.parseInt(safe.slice(1, 3), 16),
    g: Number.parseInt(safe.slice(3, 5), 16),
    b: Number.parseInt(safe.slice(5, 7), 16),
  }
}

function lightenRgb(color: RGB, pct: number): RGB {
  return {
    r: Math.min(255, Math.round(color.r + (255 - color.r) * pct)),
    g: Math.min(255, Math.round(color.g + (255 - color.g) * pct)),
    b: Math.min(255, Math.round(color.b + (255 - color.b) * pct)),
  }
}

function lightenCss(hex: string, pct: number): string {
  const color = lightenRgb(hexToRgb(hex), pct)
  return `rgb(${color.r},${color.g},${color.b})`
}

function restoreShowFlags(items: RenderItem[]): RenderItem[] {
  let lastBrand = ''
  let lastItem = ''
  return items.map(item => {
    const next: RenderItem = { ...item }
    if (next._showBrand !== undefined && next._showItem !== undefined) return next
    const brand = asString(next.brand)
    const itemName = asString(next.item)
    next._showBrand = (brand !== '' && brand !== lastBrand) || lastBrand === ''
    next._showItem = (itemName !== '' && itemName !== lastItem) || lastItem === ''
    if (brand) lastBrand = brand
    if (itemName) lastItem = itemName
    return next
  })
}

function activeItems(items: DocItem[] = []): RenderItem[] {
  return restoreShowFlags(items.filter(item => (
    asString(item.brand) ||
    asString(item.item) ||
    asString(item.sow) ||
    Number(item.amount || 0) !== 0
  )))
}

function getSelectedCompany(global: Record<string, unknown>, fields: Record<string, string>): CompanyProfile | null {
  const profiles = Array.isArray(global.companyProfiles) ? (global.companyProfiles as CompanyProfile[]) : []
  if (!profiles.length) return null
  const selectedId = asString(fields.companyProfileId)
  const activeId = asString(global.activeCompanyId)
  return profiles.find(company => company.id === selectedId) || profiles.find(company => company.id === activeId) || profiles[0] || null
}

function getSelectedAccount(company: CompanyProfile | null, fields: Record<string, string>): CompanyAccount | null {
  if (!company) return null
  const accounts = Array.isArray(company.accounts) ? company.accounts : []
  const selectedId = asString(fields.paymentAccountId)
  const activeId = asString(company.activeAccountId)
  return accounts.find(account => account.id === selectedId) || accounts.find(account => account.id === activeId) || accounts[0] || null
}

function firstFilledItem(items: RenderItem[]): RenderItem | undefined {
  return items.find(item => asString(item.brand) || asString(item.item)) || items[0]
}

function buildFileName(fields: Record<string, string>, kind: DocumentKind, items: RenderItem[]): string {
  const first = firstFilledItem(items)
  const number = kind === 'quotation' ? fields['q-no'] : fields['i-no']
  const parts = [number, fields['cl-name'], first?.brand, first?.item]
    .map(part => asString(part))
    .filter(Boolean)
  return sanitizeFileName(parts.join(' - ') || (kind === 'quotation' ? 'Quotation' : 'Invoice'))
}

export function prepareLegacyDocumentData(doc: Doc, kind: DocumentKind, global: Record<string, unknown> = {}): LegacyDocumentData {
  const fields = { ...(doc.fields as Record<string, string>) }
  const selectedCompany = getSelectedCompany(global, fields)
  const selectedAccount = getSelectedAccount(selectedCompany, fields)
  const isQuotation = kind === 'quotation'

  fields['c-name'] = fields['c-name'] || selectedCompany?.name || asString(global['c-name'])
  fields['c-tax'] = fields['c-tax'] || selectedCompany?.tax || asString(global['c-tax'])
  fields['c-addr'] = fields['c-addr'] || selectedCompany?.addr || asString(global['c-addr'])
  fields['c-phone'] = fields['c-phone'] || selectedCompany?.phone || asString(global['c-phone'])
  fields['c-email'] = fields['c-email'] || selectedCompany?.email || asString(global['c-email'])
  fields['c-web'] = fields['c-web'] || selectedCompany?.web || asString(global['c-web'])
  fields['p-bank'] = fields['p-bank'] || selectedAccount?.bank || selectedCompany?.bank || asString(global['p-bank'])
  fields['p-branch'] = fields['p-branch'] || selectedAccount?.branch || selectedCompany?.branch || asString(global['p-branch'])
  fields['p-accname'] = fields['p-accname'] || selectedAccount?.accName || selectedCompany?.accName || asString(global['p-accname'])
  fields['p-accno'] = fields['p-accno'] || selectedAccount?.accNo || selectedCompany?.accNo || asString(global['p-accno'])
  fields['s-name'] = fields['s-name'] || asString(global.directorName) || asString(global['s-name'])
  fields['s-title'] = fields['s-title'] || asString(global.directorTitle) || asString(global['s-title'])
  fields['s-tagline'] = fields['s-tagline'] || asString(global['s-tagline'])

  const items = activeItems(doc.items || [])
  const subtotal = items.reduce((sum, item) => sum + Number(item.amount || 0), 0)
  const discount = numberFrom(fields['q-disc'])
  const discLabel = (fields['q-disc-label'] || '').trim() || 'Diskon'
  const grossUp = numberFrom(fields['q-gross'])
  const grossLabel = (fields['q-gross-label'] || '').trim() || 'Gross Up'
  const showGross = (doc as any)?.showGross !== false
  const showExtra1 = Boolean((doc as any)?.showExtra1)
  const showExtra2 = Boolean((doc as any)?.showExtra2)
  const extra1 = showExtra1 ? numberFrom(fields['q-extra1']) : 0
  const extra2 = showExtra2 ? numberFrom(fields['q-extra2']) : 0
  const extra1Label = (fields['q-extra1-label'] || '').trim() || 'Penambah'
  const extra2Label = (fields['q-extra2-label'] || '').trim() || 'Pengurang'
  const total = subtotal - discount + (showGross ? grossUp : 0) + extra1 - extra2
  const currency = fields['q-cur'] === 'OTHER' ? (fields['cur-custom'] || 'XXX') : (fields['q-cur'] || 'IDR')

  return {
    kind,
    isQuotation,
    theme: doc.theme || (isQuotation ? '#1B8A7A' : '#185FA5'),
    fields,
    items,
    currency,
    subtotal,
    discount,
    discLabel,
    grossUp,
    grossLabel,
    extra1,
    extra2,
    extra1Label,
    extra2Label,
    showGross,
    showExtra1,
    showExtra2,
    total,
    showSub: doc.showSub !== false,
    showDisc: (doc as unknown as { showDisc?: boolean }).showDisc !== false,
    logoData: asString(doc.logoData) || selectedCompany?.logoData || asString(global.logoData),
    signatureData: asString(doc.sigData) || asString(global.directorSignatureData) || asString(global.sigData),
    fileName: buildFileName(fields, kind, items),
  }
}

export function buildLegacyPreviewHtml(data: LegacyDocumentData): string {
  const f = data.fields
  const col = data.theme
  const rb = lightenCss(col, 0.93)
  const dC = lightenCss(col, 0.65)
  const nk = data.isQuotation ? f['q-no'] : f['i-no']
  const dk = data.isQuotation ? f['q-date'] : f['i-date']
  const title = data.isQuotation ? 'QUOTATION' : 'INVOICE'
  const logo = data.logoData
    ? `<img src="${data.logoData}" style="max-height:42px;max-width:90px;object-fit:contain;display:block">`
    : `<div style="width:40px;height:40px;background:${col};border-radius:7px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700">BUB</div>`
  const signature = data.signatureData
    ? `<img src="${data.signatureData}" style="width:160px;max-height:70px;display:block;margin:0 auto;object-fit:contain;object-position:center bottom">`
    : '<div style="height:38px"></div>'

  const rows = data.items.map((item, index) => `
    <tr style="background:${index % 2 === 0 ? '#fff' : rb}">
      <td style="padding:4px 6px;font-size:8.5px;vertical-align:top">${item._showBrand !== false ? escapeHtml(item.brand) : ''}</td>
      <td style="padding:4px 6px;font-size:8.5px;vertical-align:top">${item._showItem !== false ? escapeHtml(item.item) : ''}</td>
      <td style="padding:4px 6px;font-size:8.5px;vertical-align:top;text-align:center"><div style="display:inline-block;text-align:left">${nl2br(item.sow)}</div></td>
      <td style="padding:4px 6px;font-size:8.5px;text-align:right;white-space:nowrap;vertical-align:top">${fmt(item.amount)}</td>
    </tr>
  `).join('')

  const toBlock = [
    `<b style="font-size:9px">${escapeHtml(f['cl-name'] || '')}</b>`,
    f['cl-addr'] ? `<span style="color:#666;font-size:7.5px">${nl2br(f['cl-addr'])}</span>` : '',
    f['cl-pic'] ? `<span style="color:#666;font-size:7.5px">Attn: ${escapeHtml(f['cl-pic'])}</span>` : '',
    f['cl-phone'] ? `<span style="color:#666;font-size:7.5px">${escapeHtml(f['cl-phone'])}</span>` : '',
  ].filter(Boolean).join('<br>')

  const totals = data.showSub
    ? `<div style="padding:6px 0"><table style="border-collapse:collapse;font-size:8px;margin-left:auto">
        ${data.showDisc && data.discount ? `<tr><td style="padding:2px 0;color:#888;white-space:nowrap">Sub Total</td><td style="padding:2px 6px;color:${col}">:</td><td style="padding:2px 0;text-align:right;white-space:nowrap">${fmt(data.subtotal)}</td></tr><tr><td style="padding:2px 0;color:#dc2626;white-space:nowrap">${data.discLabel}</td><td style="padding:2px 6px;color:${col}">:</td><td style="padding:2px 0;text-align:right;white-space:nowrap;color:#dc2626">- ${fmt(data.discount)}</td></tr>` : `<tr><td style="padding:2px 0;color:#888;white-space:nowrap">Sub Total</td><td style="padding:2px 6px;color:${col}">:</td><td style="padding:2px 0;text-align:right;white-space:nowrap">${fmt(data.discount ? data.subtotal - data.discount : data.subtotal)}</td></tr>`}
        ${data.showGross ? `<tr><td style="padding:2px 0;color:#888;white-space:nowrap">${data.grossLabel}</td><td style="padding:2px 6px;color:${col}">:</td><td style="padding:2px 0;text-align:right;white-space:nowrap">${fmt(data.grossUp)}</td></tr>` : ""}${data.showExtra1 ? `<tr><td style="padding:2px 0;color:#888;white-space:nowrap">${data.extra1Label}</td><td style="padding:2px 6px;color:${col}">:</td><td style="padding:2px 0;text-align:right;white-space:nowrap">${fmt(data.extra1)}</td></tr>` : ""}${data.showExtra2 ? `<tr><td style="padding:2px 0;color:#888;white-space:nowrap">${data.extra2Label}</td><td style="padding:2px 6px;color:${col}">:</td><td style="padding:2px 0;text-align:right;white-space:nowrap">${fmt(data.extra2)}</td></tr>` : ""}
        <tr style="border-top:1px solid ${dC}"><td style="padding:4px 0 2px;font-weight:700;font-size:9px;color:${col};white-space:nowrap">Total Amount Due</td><td style="padding:4px 6px 2px;color:${col}"><b>:</b></td><td style="padding:4px 0 2px;text-align:right;font-weight:700;font-size:10px;color:${col};white-space:nowrap">${fmt(data.total)}</td></tr>
      </table></div>`
    : `<div style="display:flex;justify-content:flex-end;align-items:center;height:32px"><table style="border-collapse:collapse"><tr><td style="font-weight:700;text-align:right;font-size:9px;color:${col}">Total Amount Due</td><td style="padding:0 5px;color:${col}">:</td><td style="text-align:right;font-weight:700;font-size:10px;color:${col}">${fmt(data.total)}</td></tr></table></div>`

  const termBlock = !data.isQuotation
    ? `<div style="margin-bottom:8px"><table style="font-size:8px;border-collapse:collapse">
        ${[
          ['Term of Payment', f['i-term'] || '-', false],
          ['Due Date', fmtDateFull(f['i-due'] || ''), true],
          ...(f['i-ref'] ? [['Ref. Quotation', f['i-ref'], false] as [string, string, boolean]] : []),
        ].map(row => `<tr><td style="padding:2px 0;color:${col};font-weight:500;min-width:105px">${escapeHtml(row[0])}</td><td style="padding:2px 5px;color:${col}">:</td><td style="padding:2px 0;${row[2] ? 'color:#cc3300;font-weight:700' : 'color:#333'}">${escapeHtml(row[1])}</td></tr>`).join('')}
      </table></div>`
    : ''

  const notesKey = data.isQuotation ? 'q-notes' : 'i-notes'
  const noteValue = asString(f[notesKey])
  const noteBox = noteValue
    ? `<div style="border:1px solid ${dC};background:${rb};border-left:4px solid ${col};border-radius:6px;padding:6px 8px;margin-bottom:8px;max-width:250px"><div style="font-size:7px;font-weight:700;color:${col};letter-spacing:.3px;margin-bottom:3px;text-transform:uppercase">Catatan Penting</div><div style="font-size:7.5px;color:#333;line-height:1.45;font-weight:600">${nl2br(noteValue)}</div></div>`
    : ''

  const payment = `<div style="font-weight:700;font-size:8px;margin-bottom:4px">Payment Details</div><table style="font-size:7.5px;border-collapse:collapse">
    ${[
      ['Bank Name', f['p-bank'] || ''],
      ['Bank Address', f['p-branch'] || ''],
      ['Account Name', f['p-accname'] || ''],
      ['Account Numbers', f['p-accno'] || ''],
      ['Tax ID', f['c-tax'] || ''],
    ].map(row => `<tr><td style="color:#888;padding:1px 0;min-width:105px">${escapeHtml(row[0])}</td><td style="padding:1px 5px;color:${col}">:</td><td style="padding:1px 0;color:#333">${escapeHtml(row[1])}</td></tr>`).join('')}
  </table>`

  return `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:11px">
      <div style="display:flex;align-items:center;gap:9px">${logo}<div><div style="font-size:11px;font-weight:700;color:${col};margin-bottom:2px">${escapeHtml(f['c-name'] || '')}</div><div style="font-size:7.5px;color:#666;line-height:1.5;max-width:180px">${nl2br(f['c-addr'] || '')}</div><div style="font-size:7.5px;color:#666">${escapeHtml(f['c-phone'] || '')}</div></div></div>
      <table style="font-size:7.5px;border-collapse:collapse"><tr><td style="padding:2px 0;color:#888;min-width:65px">No. ${data.isQuotation ? 'Quotation' : 'Invoice'}</td><td style="padding:2px 4px;color:${col}">:</td><td style="padding:2px 0;font-weight:700">${escapeHtml(nk || '')}</td></tr><tr><td style="padding:2px 0;color:#888">Date</td><td style="padding:2px 4px;color:${col}">:</td><td style="padding:2px 0">${fmtDateFull(dk || '')}</td></tr></table>
    </div>
    <div style="border-bottom:0.5px solid ${dC};margin-bottom:6px;padding-bottom:6px"><span style="font-size:7.5px;color:#aaa">To :</span>&nbsp;&nbsp;${toBlock}</div>
    <div style="border-top:2px solid ${col};margin-bottom:6px"></div>
    <div style="font-size:12px;font-weight:700;color:${col};margin-bottom:6px">${title}</div>
    <table style="width:100%;border-collapse:collapse;table-layout:fixed"><colgroup><col style="width:15%"><col style="width:20%"><col style="width:45%"><col style="width:20%"></colgroup>
      <thead><tr style="background:${col}"><th style="padding:4px 6px;text-align:left;font-size:8px;color:#fff">Brand</th><th style="padding:4px 6px;text-align:left;font-size:8px;color:#fff">Item</th><th style="padding:4px 6px;text-align:center;font-size:8px;color:#fff">SOW</th><th style="padding:4px 6px;text-align:right;font-size:8px;color:#fff">Amount (${escapeHtml(data.currency)})</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="border-top:0.5px solid ${dC}"></div>${totals}
    <div style="border-top:2px solid ${col};margin-bottom:8px"></div>${termBlock}
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div style="font-size:7.5px;color:#333">${noteBox}${payment}</div>
      <div style="text-align:center;min-width:135px;padding-left:8px"><div style="font-size:7.5px;color:#888;margin-bottom:8px">Yours Sincerely,</div>${signature}<div style="height:8px"></div><div style="color:#1a1a1a;font-style:italic;text-decoration:underline;font-size:8px;font-weight:700">${escapeHtml(f['s-name'] || '')}</div><div style="color:#888;font-size:7.5px;margin-top:2px">${escapeHtml(f['s-title'] || '')}</div></div>
    </div>
    ${f['s-tagline'] ? `<div style="text-align:center;margin-top:13px;background:${col};color:#fff;padding:5px 8px;border-radius:3px;font-weight:700;font-size:8px">${escapeHtml(f['s-tagline'])}</div>` : ''}
    <div style="text-align:center;margin-top:5px;font-size:7.5px;color:${col}">${f['c-email'] ? escapeHtml(f['c-email']) : ''}${f['c-email'] && f['c-web'] ? ' | ' : ''}${f['c-web'] ? escapeHtml(f['c-web']) : ''}</div>
  `
}

function loadJsPdf(): Promise<JsPdfConstructor> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Browser belum siap'))
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF)
  if (window.__financebubJsPdfLoading) return window.__financebubJsPdfLoading

  window.__financebubJsPdfLoading = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-financebub-jspdf="true"]')
    if (existing) {
      existing.addEventListener('load', () => window.jspdf?.jsPDF ? resolve(window.jspdf.jsPDF) : reject(new Error('jsPDF gagal dimuat')))
      existing.addEventListener('error', () => reject(new Error('jsPDF gagal dimuat')))
      return
    }
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
    script.async = true
    script.dataset.financebubJspdf = 'true'
    script.onload = () => window.jspdf?.jsPDF ? resolve(window.jspdf.jsPDF) : reject(new Error('jsPDF gagal dimuat'))
    script.onerror = () => reject(new Error('jsPDF gagal dimuat'))
    document.head.appendChild(script)
  })

  return window.__financebubJsPdfLoading
}

function imageFormat(dataUrl: string): 'PNG' | 'JPEG' {
  return dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG'
}

function getImageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise(resolve => {
    if (!dataUrl) {
      resolve({ width: 0, height: 0 })
      return
    }
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth || image.width || 0, height: image.naturalHeight || image.height || 0 })
    image.onerror = () => resolve({ width: 0, height: 0 })
    image.src = dataUrl
  })
}

export async function downloadLegacyDocumentPdf(data: LegacyDocumentData, opts?: { skipSignature?: boolean }): Promise<void> {
  if (!data.items.length) {
    alert('Tambahkan minimal 1 item!')
    return
  }

  const JsPDF = await loadJsPdf()
  const doc = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const PW = 210
  const ml = 14
  const mr = 14
  const UW = PW - ml - mr
  const color = hexToRgb(data.theme)
  const lightColor = lightenRgb(color, 0.65)
  const f = data.fields
  const isQ = data.isQuotation
  const nk = isQ ? 'q-no' : 'i-no'
  const dateKey = isQ ? 'q-date' : 'i-date'

  const tc = (r: number, g: number, b: number) => doc.setTextColor(r, g, b)
  const fc = (r: number, g: number, b: number) => doc.setFillColor(r, g, b)
  const dc = (r: number, g: number, b: number) => doc.setDrawColor(r, g, b)

  let y = 14
  const addressLines = doc.setFontSize(7.5).splitTextToSize(f['c-addr'] || '', 82)
  const headerHeight = 6 + addressLines.length * 3.5 + 4
  const logoMaxW = 14
  const logoMaxH = 14
  const logoY = y + (headerHeight - logoMaxH) / 2
  let logoW = logoMaxW
  let logoH = logoMaxH
  let textX = ml

  if (data.logoData) {
    try {
      const size = await getImageSize(data.logoData)
      if (size.width && size.height) {
        const scale = Math.min(logoMaxW / size.width, logoMaxH / size.height, 1)
        logoW = size.width * scale
        logoH = size.height * scale
      }
      doc.addImage(data.logoData, imageFormat(data.logoData), ml, logoY, logoW, logoH, '', 'FAST')
      textX = ml + logoW + 3
    } catch {
      textX = ml
    }
  } else {
    fc(color.r, color.g, color.b)
    doc.roundedRect(ml, logoY, logoMaxW, logoMaxH, 2, 2, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    tc(255, 255, 255)
    doc.text('BUB', ml + logoMaxW / 2, logoY + logoMaxH / 2 + 1.5, { align: 'center' })
    textX = ml + logoMaxW + 3
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  tc(color.r, color.g, color.b)
  doc.text(f['c-name'] || '', textX, y + 5)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  tc(110, 110, 110)
  doc.text(addressLines, textX, y + 10)
  if (f['c-phone']) doc.text(f['c-phone'], textX, y + 10 + addressLines.length * 3.5)

  const metaColonX = PW - mr - 40
  const metaValueX = metaColonX + 4
  ;[
    [`No. ${isQ ? 'Quotation' : 'Invoice'}`, f[nk] || ''],
    ['Date', fmtDateFull(f[dateKey] || '') || ''],
  ].forEach(([label, value], index) => {
    const rowY = y + 4 + index * 6
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    tc(110, 110, 110)
    doc.text(label, metaColonX - 2, rowY, { align: 'right' })
    tc(color.r, color.g, color.b)
    doc.text(':', metaColonX, rowY, { align: 'center' })
    doc.setFont('helvetica', 'bold')
    tc(30, 30, 30)
    doc.text(value, metaValueX, rowY)
  })

  y += headerHeight + 4
  dc(lightColor.r, lightColor.g, lightColor.b)
  doc.setLineWidth(0.25)
  doc.line(ml, y, PW - mr, y)
  y += 5

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  tc(150, 150, 150)
  doc.text('To :', ml, y)
  doc.setFont('helvetica', 'bold')
  tc(25, 25, 25)
  if (f['cl-name']) doc.text(f['cl-name'], ml + 9, y)
  let clientY = y
  if (f['cl-addr']) {
    tc(100, 100, 100)
    const clientAddress = doc.splitTextToSize(f['cl-addr'], 82)
    doc.setFont('helvetica', 'normal')
    doc.text(clientAddress, ml + 9, clientY + 4.5)
    clientY += clientAddress.length * 3.8
  }
  if (f['cl-pic']) {
    tc(100, 100, 100)
    doc.text(`Attn: ${f['cl-pic']}`, ml + 9, clientY + 5)
    clientY += 5
  }
  if (f['cl-phone']) {
    tc(100, 100, 100)
    doc.text(f['cl-phone'], ml + 9, clientY + 5)
    clientY += 5
  }

  y = Math.max(y, clientY) + 8
  dc(color.r, color.g, color.b)
  doc.setLineWidth(0.8)
  doc.line(ml, y, PW - mr, y)
  y += 6
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  tc(color.r, color.g, color.b)
  doc.text(isQ ? 'QUOTATION' : 'INVOICE', ml, y)
  y += 7

  const CW = [UW * 0.15, UW * 0.20, UW * 0.45, UW * 0.20]
  const CX = [ml, ml + CW[0], ml + CW[0] + CW[1], ml + CW[0] + CW[1] + CW[2]]
  const PAD = 2
  const sowCenterX = CX[2] + CW[2] / 2

  fc(color.r, color.g, color.b)
  doc.rect(ml, y - 5, UW, 7.5, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  tc(255, 255, 255)
  doc.text('Brand', CX[0] + PAD, y)
  doc.text('Item', CX[1] + PAD, y)
  doc.text('SOW', sowCenterX, y, { align: 'center' })
  doc.text(`Amount (${data.currency})`, PW - mr - PAD, y, { align: 'right' })
  y += 3

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  let globalMaxSowWidth = 0
  data.items.forEach(item => {
    String(item.sow || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').forEach(line => {
      const wrapped = doc.splitTextToSize(line || '', CW[2] - PAD * 2 - 4)
      wrapped.forEach((wrappedLine: string) => {
        const width = doc.getTextWidth(wrappedLine)
        if (width > globalMaxSowWidth) globalMaxSowWidth = width
      })
    })
  })
  globalMaxSowWidth = Math.min(globalMaxSowWidth, CW[2] - PAD * 2 - 4)
  const globalSowX = CX[2] + (CW[2] - globalMaxSowWidth) / 2

  data.items.forEach((item, index) => {
    const bg = index % 2 === 0 ? { r: 255, g: 255, b: 255 } : lightenRgb(color, 0.93)
    const brandLines = doc.splitTextToSize(item.brand || '', CW[0] - PAD * 2)
    const itemLines = doc.splitTextToSize(item.item || '', CW[1] - PAD * 2)
    const sowLines: string[] = []
    String(item.sow || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').forEach(line => {
      const wrapped = doc.splitTextToSize(line || '', CW[2] - PAD * 2 - 4)
      wrapped.forEach((wrappedLine: string) => sowLines.push(wrappedLine))
    })
    if (!sowLines.length) sowLines.push('')
    const lineHeight = 4.2
    const rowHeight = Math.max(brandLines.length, itemLines.length, sowLines.length, 1) * lineHeight + 6
    fc(bg.r, bg.g, bg.b)
    doc.rect(ml, y, UW, rowHeight, 'F')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    tc(30, 30, 30)
    doc.text(item._showBrand !== false ? brandLines : [], CX[0] + PAD, y + 4)
    doc.text(item._showItem !== false ? itemLines : [], CX[1] + PAD, y + 4)
    sowLines.forEach((line, lineIndex) => doc.text(line, globalSowX, y + 4 + lineIndex * lineHeight))
    const pdfAmount = data.showSub ? item.amount : (data.subtotal > 0 ? Math.round(Number(item.amount || 0) / data.subtotal * data.total) : item.amount)
    doc.text(fmt(pdfAmount), PW - mr - PAD, y + 4, { align: 'right' })
    y += rowHeight
  })

  y += 2
  dc(lightColor.r, lightColor.g, lightColor.b)
  doc.setLineWidth(0.5)
  doc.line(ml, y, PW - mr, y)

  const totalValueX = PW - mr
  const totalColonX = totalValueX - 22
  const totalLabelX = totalColonX - 4
  if (data.showSub) {
    y += 6
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    const rows: [string, string, boolean][] = []
    if (data.showDisc && data.discount) {
      rows.push(['Sub Total', fmt(data.subtotal), false])
      rows.push([data.discLabel, `- ${fmt(data.discount)}`, true])
    } else {
      rows.push(['Sub Total', data.discount ? fmt(data.subtotal - data.discount) : fmt(data.subtotal), false])
    }
    if (data.showGross) rows.push([data.grossLabel, fmt(data.grossUp), false])
    if (data.showExtra2) rows.push([data.extra2Label, fmt(data.extra2), false])
    if (data.showExtra1) rows.push([data.extra1Label, fmt(data.extra1), false])
    rows.forEach(row => {
      tc(row[2] ? 180 : 120, row[2] ? 30 : 120, row[2] ? 0 : 120)
      doc.text(row[0], totalLabelX, y, { align: 'right' })
      tc(color.r, color.g, color.b)
      doc.text(':', totalColonX, y, { align: 'center' })
      tc(row[2] ? 180 : 30, row[2] ? 30 : 30, row[2] ? 0 : 30)
      doc.text(row[1], totalValueX, y, { align: 'right' })
      y += 5
    })
    dc(lightColor.r, lightColor.g, lightColor.b)
    doc.setLineWidth(0.35)
    doc.line(totalLabelX - 18, y, totalValueX, y)
    y += 2
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    tc(color.r, color.g, color.b)
    doc.text('Total Amount Due', totalLabelX, y + 5, { align: 'right' })
    doc.text(':', totalColonX, y + 5, { align: 'center' })
    doc.text(fmt(data.total), totalValueX, y + 5, { align: 'right' })
    y += 13
  } else {
    y += 8
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    tc(color.r, color.g, color.b)
    doc.text('Total Amount Due', totalLabelX, y, { align: 'right' })
    doc.text(':', totalColonX, y, { align: 'center' })
    doc.text(fmt(data.total), totalValueX, y, { align: 'right' })
    y += 10
  }

  dc(color.r, color.g, color.b)
  doc.setLineWidth(0.8)
  doc.line(ml, y, PW - mr, y)
  y += 6

  const leftA = ml
  const leftB = ml + 33
  const leftC = ml + 36
  if (!isQ) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    const termRows: [string, string, boolean][] = [
      ['Term of Payment', f['i-term'] || '-', false],
      ['Due Date', fmtDateFull(f['i-due'] || '') || '-', true],
    ]
    if (f['i-ref']) termRows.push(['Ref. Quotation', f['i-ref'], false])
    termRows.forEach(row => {
      tc(color.r, color.g, color.b)
      doc.text(row[0], leftA, y)
      doc.text(':', leftB, y, { align: 'center' })
      if (row[2]) {
        tc(180, 30, 0)
        doc.setFont('helvetica', 'bold')
      } else {
        tc(30, 30, 30)
        doc.setFont('helvetica', 'normal')
      }
      doc.text(row[1], leftC, y)
      doc.setFont('helvetica', 'normal')
      y += 5
    })
    y += 3
  }

  const pdfNotesKey = isQ ? 'q-notes' : 'i-notes'
  const pdfNote = asString(f[pdfNotesKey])
  if (pdfNote) {
    const noteW = 108
    const noteLines = doc.setFontSize(8).splitTextToSize(pdfNote, noteW - 10)
    const noteH = Math.max(16, noteLines.length * 4.2 + 12)
    fc(lightenRgb(color, 0.93).r, lightenRgb(color, 0.93).g, lightenRgb(color, 0.93).b)
    dc(lightColor.r, lightColor.g, lightColor.b)
    doc.roundedRect(leftA, y, noteW, noteH, 2, 2, 'FD')
    fc(color.r, color.g, color.b)
    doc.rect(leftA, y, 2.5, noteH, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    tc(color.r, color.g, color.b)
    doc.text('CATATAN PENTING', leftA + 6, y + 6)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    tc(45, 45, 45)
    doc.text(noteLines, leftA + 6, y + 11)
    y += noteH + 5
  }

  const paymentStartY = y
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  tc(25, 25, 25)
  doc.text('Payment Details', leftA, y)
  y += 5
  ;[
    ['Bank Name', f['p-bank'] || ''],
    ['Bank Address', f['p-branch'] || ''],
    ['Account Name', f['p-accname'] || ''],
    ['Account Numbers', f['p-accno'] || ''],
    ['Tax ID', f['c-tax'] || ''],
  ].forEach(row => {
    tc(120, 120, 120)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.text(row[0], leftA, y)
    tc(color.r, color.g, color.b)
    doc.text(':', leftB, y, { align: 'center' })
    tc(30, 30, 30)
    doc.text(row[1], leftC, y)
    y += 4.8
  })

  const signatureCenterX = PW - mr - 26
  const signatureStartY = paymentStartY
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  tc(130, 130, 130)
  doc.text('Yours Sincerely,', signatureCenterX, signatureStartY, { align: 'center' })
  const signatureY = signatureStartY + 5
  let signatureHeight = 14
  if (data.signatureData && !opts?.skipSignature) {
    try {
      const maxW = 55
      const maxH = 25
      let sigW = maxW
      let sigH = maxH
      const size = await getImageSize(data.signatureData)
      if (size.width && size.height) {
        const scale = Math.min(maxW / size.width, maxH / size.height, 1)
        sigW = size.width * scale
        sigH = size.height * scale
      }
      doc.addImage(data.signatureData, imageFormat(data.signatureData), signatureCenterX - sigW / 2, signatureY, sigW, sigH, '', 'FAST')
      signatureHeight = sigH
    } catch {
      signatureHeight = 14
    }
  }
  const signNameY = signatureY + signatureHeight + 5
  tc(30, 30, 30)
  doc.setFont('helvetica', 'bolditalic')
  doc.setFontSize(9)
  doc.text(f['s-name'] || '', signatureCenterX, signNameY, { align: 'center' })
  dc(30, 30, 30)
  doc.setLineWidth(0.3)
  doc.line(signatureCenterX - 24, signNameY + 0.8, signatureCenterX + 24, signNameY + 0.8)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  tc(120, 120, 120)
  doc.text(f['s-title'] || '', signatureCenterX, signNameY + 4.5, { align: 'center' })

  y = Math.max(y, signNameY + 12)
  if (f['s-tagline']) {
    fc(color.r, color.g, color.b)
    doc.rect(ml, y, UW, 8, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    tc(255, 255, 255)
    doc.text(f['s-tagline'], PW / 2, y + 5.5, { align: 'center' })
    y += 12
  }

  const socials = []
  if (f['c-email']) socials.push(f['c-email'])
  if (f['c-web']) socials.push(f['c-web'])
  if (socials.length) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    tc(color.r, color.g, color.b)
    doc.text(socials.join('   |   '), PW / 2, y, { align: 'center' })
  }

  doc.save(`${data.fileName}${opts?.skipSignature ? ' (TTD Basah)' : ''}.pdf`)
}
