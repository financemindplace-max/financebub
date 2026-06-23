export type UserRole = 'admin' | 'user' | 'viewer'
export type UserStatus = 'active' | 'pending' | 'inactive'

export interface AppUser {
  uid: string
  email: string
  name: string
  role: UserRole
  status?: UserStatus
}

export interface AuthContextType {
  user: AppUser | null
  loading: boolean
  signIn: (email: string, password: string, otpCode: string) => Promise<void>
  signUp: (name: string, email: string, password: string, registrationOtp: string) => Promise<void>
  signOut: () => Promise<void>
}
