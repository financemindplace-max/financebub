export type DocStatus = 'Draft' | 'Terbit' | 'Belum Lunas' | 'Lunas' | 'Overdue' | 'Dibayar Sebagian' | 'Overpaid'

export interface DocItem {
  brand: string
  item: string
  sow: string
  amount: number
}

export interface DocFields {
  // Quotation fields
  'q-no'?: string
  'q-date'?: string
  'q-disc'?: string
  'q-gross'?: string
  'q-cur'?: string
  // Invoice fields
  'i-no'?: string
  'i-date'?: string
  'i-due'?: string
  'i-term'?: string
  'i-ref'?: string
  'i-status'?: DocStatus
  // Quotation status (payment tracking)
  'q-status'?: DocStatus
  // Client fields
  'cl-name'?: string
  'cl-addr'?: string
  'cl-pic'?: string
  'cl-phone'?: string
  // Company selection
  companyProfileId?: string
  paymentAccountId?: string
  // Company fields
  'c-name'?: string
  'c-addr'?: string
  'c-phone'?: string
  'c-email'?: string
  'c-web'?: string
  'c-tax'?: string
  // Payment fields
  'p-bank'?: string
  'p-branch'?: string
  'p-accname'?: string
  'p-accno'?: string
  // Signatory fields
  's-name'?: string
  's-title'?: string
  's-tagline'?: string
  // Notes
  'q-notes'?: string
  'i-notes'?: string
  // Mata uang custom
  'cur-custom'?: string
  // Tahun project (bisa beda dari tahun terbit dokumen)
  'project-year'?: string
}

export interface DocAuditEntry {
  uid: string
  name: string
  at: string
}

export interface DocAudit {
  createdBy?: DocAuditEntry
  updatedBy?: DocAuditEntry
  statusChangedBy?: DocAuditEntry
}

export interface DocSendLog {
  id: number
  date: string
  to: string
  note?: string
  createdAt?: string
  createdBy?: { uid: string; name: string }
}

export interface Doc {
  id: number
  savedAt: string
  theme: string
  logoData: string | null
  sigData: string | null
  sigNW: number
  sigNH: number
  showSub: boolean
  showDisc?: boolean
  fields: DocFields
  items: DocItem[]
  sendLogs?: DocSendLog[]
  audit?: DocAudit
  _sim?: boolean
}

export type DocType = 'quo' | 'inv'
