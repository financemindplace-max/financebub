import type { DocFields } from '@/types/document'

export type CompanyPaymentAccount = {
  id: string
  bank: string
  branch: string
  accName: string
  accNo: string
  label?: string
}

export type CompanyProfile = {
  id: string
  name: string
  tax: string
  addr: string
  phone: string
  email: string
  web: string
  bank: string
  branch: string
  accName: string
  accNo: string
  logoData: string
  accounts: CompanyPaymentAccount[]
  activeAccountId: string
}

export type SignatoryProfile = {
  directorName: string
  directorTitle: string
  directorSignatureData: string
  hrdName: string
  hrdTitle: string
  hrdSignatureData: string
  tagline: string
}

export type Signer = {
  id: string
  name: string
  title: string
  signatureData: string
}

export const DEFAULT_COMPANY_ACCOUNT: CompanyPaymentAccount = {
  id: 'account-main',
  bank: 'Bank Central Asia (BCA)',
  branch: 'BCA KCP Tebet Barat',
  accName: 'PT FinanceBub',
  accNo: '6270636363',
  label: 'Rekening Utama',
}

export const DEFAULT_COMPANY: CompanyProfile = {
  id: 'company-main',
  name: 'PT FinanceBub',
  tax: '1000.0000.0642.4843',
  addr: 'Jl. Tebet Raya No.25B, Jakarta Selatan 12820',
  phone: '0815-5555-566',
  email: 'admin@financebub.com',
  web: 'www.financebub.com',
  bank: DEFAULT_COMPANY_ACCOUNT.bank,
  branch: DEFAULT_COMPANY_ACCOUNT.branch,
  accName: DEFAULT_COMPANY_ACCOUNT.accName,
  accNo: DEFAULT_COMPANY_ACCOUNT.accNo,
  logoData: '',
  accounts: [DEFAULT_COMPANY_ACCOUNT],
  activeAccountId: DEFAULT_COMPANY_ACCOUNT.id,
}

export const DEFAULT_SIGNATORY: SignatoryProfile = {
  directorName: 'Cristi Roderto Roditua S',
  directorTitle: 'Direktur PT FinanceBub',
  directorSignatureData: '',
  hrdName: 'HRD',
  hrdTitle: 'Human Resources Department',
  hrdSignatureData: '',
  tagline: "We Can't Wait For Our Next Collaboration!",
}

export function makeId(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function asString(value: unknown): string {
  return String(value ?? '').trim()
}

function normalizeAccount(raw: Partial<CompanyPaymentAccount> | undefined, index: number, fallbackName = ''): CompanyPaymentAccount {
  return {
    ...DEFAULT_COMPANY_ACCOUNT,
    ...raw,
    id: raw?.id || `account-${index + 1}`,
    label: raw?.label || (index === 0 ? 'Rekening Utama' : `Rekening ${index + 1}`),
    accName: raw?.accName || fallbackName || DEFAULT_COMPANY_ACCOUNT.accName,
  }
}

export function normalizeCompany(raw: Partial<CompanyProfile> | undefined, index = 0): CompanyProfile {
  const merged = {
    ...DEFAULT_COMPANY,
    ...raw,
    id: raw?.id || `company-${index + 1}`,
    name: raw?.name || DEFAULT_COMPANY.name,
  }

  const accountsFromArray = Array.isArray(raw?.accounts) && raw?.accounts.length
    ? raw.accounts.map((account, accountIndex) => normalizeAccount(account, accountIndex, merged.name))
    : []

  const legacyAccount: CompanyPaymentAccount = normalizeAccount({
    id: raw?.activeAccountId || raw?.accounts?.[0]?.id || 'account-main',
    bank: raw?.bank || merged.bank,
    branch: raw?.branch || merged.branch,
    accName: raw?.accName || merged.accName || merged.name,
    accNo: raw?.accNo || merged.accNo,
    label: raw?.accounts?.[0]?.label || 'Rekening Utama',
  }, 0, merged.name)

  const accounts = accountsFromArray.length ? accountsFromArray : [legacyAccount]
  const activeAccountId = raw?.activeAccountId && accounts.some(account => account.id === raw.activeAccountId)
    ? raw.activeAccountId
    : accounts[0]?.id || legacyAccount.id
  const activeAccount = accounts.find(account => account.id === activeAccountId) || accounts[0] || legacyAccount

  return {
    ...merged,
    accounts,
    activeAccountId,
    bank: activeAccount.bank || merged.bank,
    branch: activeAccount.branch || merged.branch,
    accName: activeAccount.accName || merged.accName,
    accNo: activeAccount.accNo || merged.accNo,
  }
}

export function normalizeCompanies(global: Record<string, any>): CompanyProfile[] {
  if (Array.isArray(global.companyProfiles) && global.companyProfiles.length) {
    return global.companyProfiles.map((company: Partial<CompanyProfile>, index: number) => normalizeCompany(company, index))
  }

  return [normalizeCompany({
    ...DEFAULT_COMPANY,
    name: global['c-name'] || DEFAULT_COMPANY.name,
    tax: global['c-tax'] || DEFAULT_COMPANY.tax,
    addr: global['c-addr'] || DEFAULT_COMPANY.addr,
    phone: global['c-phone'] || DEFAULT_COMPANY.phone,
    email: global['c-email'] || DEFAULT_COMPANY.email,
    web: global['c-web'] || DEFAULT_COMPANY.web,
    bank: global['p-bank'] || DEFAULT_COMPANY.bank,
    branch: global['p-branch'] || DEFAULT_COMPANY.branch,
    accName: global['p-accname'] || DEFAULT_COMPANY.accName,
    accNo: global['p-accno'] || DEFAULT_COMPANY.accNo,
    logoData: global.logoData || DEFAULT_COMPANY.logoData,
    accounts: [{
      ...DEFAULT_COMPANY_ACCOUNT,
      bank: global['p-bank'] || DEFAULT_COMPANY_ACCOUNT.bank,
      branch: global['p-branch'] || DEFAULT_COMPANY_ACCOUNT.branch,
      accName: global['p-accname'] || DEFAULT_COMPANY_ACCOUNT.accName,
      accNo: global['p-accno'] || DEFAULT_COMPANY_ACCOUNT.accNo,
    }],
    activeAccountId: DEFAULT_COMPANY_ACCOUNT.id,
  }, 0)]
}

export function normalizeSignatory(global: Record<string, any>): SignatoryProfile {
  return {
    ...DEFAULT_SIGNATORY,
    directorName: global.directorName || global['s-name'] || DEFAULT_SIGNATORY.directorName,
    directorTitle: global.directorTitle || global['s-title'] || DEFAULT_SIGNATORY.directorTitle,
    directorSignatureData: global.directorSignatureData || global.sigData || DEFAULT_SIGNATORY.directorSignatureData,
    hrdName: global.hrdName || DEFAULT_SIGNATORY.hrdName,
    hrdTitle: global.hrdTitle || DEFAULT_SIGNATORY.hrdTitle,
    hrdSignatureData: global.hrdSignatureData || DEFAULT_SIGNATORY.hrdSignatureData,
    tagline: global['s-tagline'] || DEFAULT_SIGNATORY.tagline,
  }
}

export function getDefaultCompanyId(global: Record<string, any>, companies: CompanyProfile[]) {
  const activeId = asString(global.activeCompanyId)
  return companies.some(company => company.id === activeId) ? activeId : (companies[0]?.id || DEFAULT_COMPANY.id)
}

export function getCompanyById(companies: CompanyProfile[], id?: string) {
  return companies.find(company => company.id === id) || companies[0] || DEFAULT_COMPANY
}

export function getAccountById(company: CompanyProfile | null | undefined, id?: string) {
  if (!company) return DEFAULT_COMPANY_ACCOUNT
  return company.accounts.find(account => account.id === id) || company.accounts.find(account => account.id === company.activeAccountId) || company.accounts[0] || DEFAULT_COMPANY_ACCOUNT
}

export function companyFields(company: CompanyProfile, account = getAccountById(company)): Partial<DocFields> {
  return {
    companyProfileId: company.id,
    paymentAccountId: account.id,
    'c-name': company.name,
    'c-addr': company.addr,
    'c-phone': company.phone,
    'c-email': company.email,
    'c-web': company.web,
    'c-tax': company.tax,
    'p-bank': account.bank,
    'p-branch': account.branch,
    'p-accname': account.accName,
    'p-accno': account.accNo,
  }
}

export function accountFields(account: CompanyPaymentAccount): Partial<DocFields> {
  return {
    paymentAccountId: account.id,
    'p-bank': account.bank,
    'p-branch': account.branch,
    'p-accname': account.accName,
    'p-accno': account.accNo,
  }
}

export function getSelectedCompanyFromFields(global: Record<string, any>, fields: Record<string, unknown>): CompanyProfile | null {
  const companies = normalizeCompanies(global)
  if (!companies.length) return null
  const selectedId = asString(fields.companyProfileId)
  const activeId = getDefaultCompanyId(global, companies)
  return companies.find(company => company.id === selectedId) || companies.find(company => company.id === activeId) || companies[0]
}

export function getSelectedAccountFromFields(company: CompanyProfile | null | undefined, fields: Record<string, unknown>): CompanyPaymentAccount | null {
  if (!company) return null
  const selectedId = asString(fields.paymentAccountId)
  return getAccountById(company, selectedId)
}

export function normalizeSigners(global: Record<string, any>): Signer[] {
  if (Array.isArray(global.signers) && global.signers.length > 0) {
    return global.signers.map((s: any) => ({
      id: s.id || makeId('signer'),
      name: String(s.name || ''),
      title: String(s.title || ''),
      signatureData: String(s.signatureData || ''),
    }))
  }
  // Migrate from legacy director data
  const name = global.directorName || global['s-name'] || ''
  const title = global.directorTitle || global['s-title'] || ''
  const sig = global.directorSignatureData || global.sigData || ''
  if (name || title) {
    return [{ id: 'signer-director', name, title, signatureData: sig }]
  }
  return []
}
