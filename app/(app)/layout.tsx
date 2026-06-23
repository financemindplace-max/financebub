'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import Sidebar from '@/components/sidebar'
import { Loader2 } from 'lucide-react'
import { ref, onValue, off } from 'firebase/database'
import { db } from '@/lib/firebase'

const USER_ID = 'financebub-main'
const CACHE_KEY = 'financebub_app_identity'

function getCachedIdentity() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return null
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const router = useRouter()

  const cached = getCachedIdentity()
  const [appIdentity, setAppIdentity] = useState({
    appInitials: cached?.appInitials || 'DK',
    appLogoData: cached?.appLogoData || '',
    appColor: cached?.appColor || '#1B8A7A',
  })

  useEffect(() => {
    const dbRef = ref(db, `users/${USER_ID}/global`)
    const handler = (snap: any) => {
      const g = snap.val() || {}
      const identity = {
        appInitials: g.appInitials || 'DK',
        appLogoData: g.appLogoData || '',
        appColor: g.appColor || '#1B8A7A',
      }
      setAppIdentity(identity)
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(identity)) } catch {}
    }
    onValue(dbRef, handler)
    return () => off(dbRef, 'value', handler)
  }, [])

  useEffect(() => {
    if (!loading && !user) router.replace('/login')
  }, [user, loading, router])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f5f4]">
        <div className="flex flex-col items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm overflow-hidden"
            style={{ background: appIdentity.appLogoData ? 'transparent' : appIdentity.appColor }}
          >
            {appIdentity.appLogoData
              ? <img src={appIdentity.appLogoData} alt="logo" className="w-full h-full object-cover rounded-xl" />
              : appIdentity.appInitials || 'DK'}
          </div>
          <Loader2 className="w-5 h-5 animate-spin" style={{ color: appIdentity.appColor }} />
        </div>
      </div>
    )
  }

  if (!user) return null

  return (
    <div className="min-h-screen bg-[#f5f5f4]">
      <Sidebar />
      <main className="md:ml-[220px] min-h-screen pt-14 md:pt-0 overflow-x-hidden">
        {children}
      </main>
    </div>
  )
}
