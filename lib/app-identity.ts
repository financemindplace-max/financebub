export function normalizeAppInitials(value: unknown): string {
  const initials = String(value ?? '').trim().toUpperCase().slice(0, 3)

  // DK adalah identitas bawaan aplikasi lama. Pada hasil clone, anggap sebagai kosong
  // agar logo/inisial lama tidak ikut muncul di deployment baru.
  return initials === 'DK' ? '' : initials
}
