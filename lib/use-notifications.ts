'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { onValue, ref, set, update } from 'firebase/database'
import { useAuth } from '@/lib/auth-context'
import { db } from '@/lib/firebase'
import { subscribeDocs } from '@/lib/rtdb'
import type { Doc } from '@/types/document'

const USER_ID = 'financebub-main'
const DAY_MS = 24 * 60 * 60 * 1000

export type NotificationKind = 'submission' | 'invoice_overdue' | 'invoice_due_today'
export type NotificationSource = 'internal' | 'public' | 'invoice'

export interface AppNotification {
  id: string
  readKey: string
  isRead: boolean
  kind: NotificationKind
  source: NotificationSource
  title: string
  description: string
  amount: number
  date?: string
  createdAt?: string
  reference: string
  person: string
  href: string
}

interface InternalRequestRecord {
  id?: string
  type?: 'purchase_request' | 'reimburse' | string
  title?: string
  amount?: number
  neededDate?: string
  status?: string
  createdAt?: string
  createdBy?: { uid?: string; name?: string }
}

interface PublicRequestRecord {
  id?: string
  trackingCode?: string
  type?: 'purchase_request' | 'reimburse' | string
  title?: string
  amount?: number
  date?: string
  neededDate?: string
  status?: string
  createdAt?: string
  name?: string
}

type NotificationDraft = Omit<AppNotification, 'readKey' | 'isRead'>

function recordsFromYear<T extends { id?: string }>(value: unknown): T[] {
  if (!value || typeof value !== 'object') return []

  return Object.values(value as Record<string, unknown>).flatMap(monthValue => {
    if (!monthValue || typeof monthValue !== 'object') return []

    return Object.entries(monthValue as Record<string, unknown>)
      .filter((entry): entry is [string, Record<string, unknown>] => {
        const record = entry[1]
        return Boolean(record && typeof record === 'object')
      })
      .map(([recordId, record]) => ({ id: recordId, ...record }) as T)
  })
}

function notificationReadKey(notificationId: string) {
  return encodeURIComponent(notificationId).replace(/\./g, '%2E')
}

function parseDateOnly(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  date.setHours(0, 0, 0, 0)

  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }

  const time = date.getTime()
  return Number.isNaN(time) ? null : time
}

function startOfToday() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return today.getTime()
}

function daysFromToday(value: string) {
  const target = parseDateOnly(value)
  if (target === null) return null
  return Math.round((target - startOfToday()) / DAY_MS)
}

function invoiceTotal(doc: Doc) {
  const subtotal = doc.items?.reduce((sum, item) => sum + Number(item.amount || 0), 0) || 0
  return subtotal - Number(doc.fields?.['q-disc'] || 0) + Number(doc.fields?.['q-gross'] || 0)
}

function invoiceCanBeOverdue(status: unknown) {
  const normalized = String(status || '').trim().toLowerCase()
  return !['', 'draft', 'lunas', 'paid', 'dibayar', 'batal', 'cancelled', 'canceled'].includes(normalized)
}

function internalTypeLabel(type: unknown) {
  return type === 'reimburse' ? 'Reimburse internal' : 'Purchase Request'
}

function withReadState(notification: NotificationDraft, readKeys: Set<string>): AppNotification {
  const readKey = notificationReadKey(notification.id)
  return {
    ...notification,
    readKey,
    isRead: readKeys.has(readKey),
  }
}

function buildNotifications(
  invoices: Doc[],
  internalRequests: InternalRequestRecord[],
  publicRequests: PublicRequestRecord[],
  readKeys: Set<string>,
): AppNotification[] {
  const notifications: NotificationDraft[] = []

  invoices.forEach(invoice => {
    const dueDate = invoice.fields?.['i-due'] || ''
    const dueDays = daysFromToday(dueDate)
    const status = invoice.fields?.['i-status'] || 'Draft'

    if (!invoiceCanBeOverdue(status) || dueDays === null || dueDays > 0) return

    const docNo = invoice.fields?.['i-no'] || 'Invoice tanpa nomor'
    const client = invoice.fields?.['cl-name'] || 'Tanpa klien'
    const isOverdue = dueDays < 0

    notifications.push({
      id: `invoice:${invoice.id}:${dueDate}`,
      kind: isOverdue ? 'invoice_overdue' : 'invoice_due_today',
      source: 'invoice',
      title: isOverdue ? 'Invoice sudah jatuh tempo' : 'Invoice jatuh tempo hari ini',
      description: isOverdue
        ? `${docNo} terlambat ${Math.abs(dueDays)} hari dan belum berstatus lunas.`
        : `${docNo} jatuh tempo hari ini dan belum berstatus lunas.`,
      amount: invoiceTotal(invoice),
      date: dueDate,
      createdAt: invoice.savedAt,
      reference: docNo,
      person: client,
      href: invoice.fields?.['i-no']
        ? `/invoice?open=${encodeURIComponent(invoice.fields['i-no'])}&back=notifikasi`
        : '/invoice',
    })
  })

  internalRequests.forEach((request, index) => {
    if (String(request.status || '').toLowerCase() !== 'pending') return

    const typeLabel = internalTypeLabel(request.type)
    const requester = request.createdBy?.name || 'Pengaju internal'
    const stableId = request.id || request.createdAt || String(index)

    notifications.push({
      id: `internal:${stableId}`,
      kind: 'submission',
      source: 'internal',
      title: `${typeLabel} menunggu persetujuan`,
      description: `${request.title || 'Pengajuan tanpa judul'} diajukan oleh ${requester}.`,
      amount: Number(request.amount || 0),
      date: request.neededDate,
      createdAt: request.createdAt,
      reference: typeLabel,
      person: requester,
      href: '/keuangan/pengajuan',
    })
  })

  publicRequests.forEach((request, index) => {
    if (String(request.status || '').toLowerCase() !== 'pending') return

    const requester = request.name || 'Pengaju publik'
    const stableId = request.id || request.trackingCode || request.createdAt || String(index)
    const isPurchase = request.type === 'purchase_request' || request.trackingCode?.startsWith('PRQ-')
    const typeLabel = isPurchase ? 'Purchase Request publik' : 'Reimburse publik'

    notifications.push({
      id: isPurchase ? `public:purchase:${stableId}` : `public:${stableId}`,
      kind: 'submission',
      source: 'public',
      title: `${typeLabel} menunggu persetujuan`,
      description: `${request.title || 'Pengajuan tanpa judul'} diajukan oleh ${requester}.`,
      amount: Number(request.amount || 0),
      date: isPurchase ? request.neededDate : request.date,
      createdAt: request.createdAt,
      reference: request.trackingCode || typeLabel,
      person: requester,
      href: '/keuangan/pengajuan',
    })
  })

  const priority: Record<NotificationKind, number> = {
    invoice_overdue: 0,
    invoice_due_today: 1,
    submission: 2,
  }

  return notifications
    .sort((a, b) => {
      if (readKeys.has(notificationReadKey(a.id)) !== readKeys.has(notificationReadKey(b.id))) {
        return readKeys.has(notificationReadKey(a.id)) ? 1 : -1
      }

      const priorityDiff = priority[a.kind] - priority[b.kind]
      if (priorityDiff !== 0) return priorityDiff

      if (a.kind === 'submission' && b.kind === 'submission') {
        return String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
      }

      return String(a.date || '').localeCompare(String(b.date || ''))
    })
    .map(notification => withReadState(notification, readKeys))
}

export function useNotifications(year: number) {
  const { user, loading: authLoading } = useAuth()
  const [invoices, setInvoices] = useState<Doc[]>([])
  const [internalRequests, setInternalRequests] = useState<InternalRequestRecord[]>([])
  const [publicReimburseRequests, setPublicReimburseRequests] = useState<PublicRequestRecord[]>([])
  const [publicPurchaseRequests, setPublicPurchaseRequests] = useState<PublicRequestRecord[]>([])
  const [readKeys, setReadKeys] = useState<Set<string>>(new Set())
  const [loaded, setLoaded] = useState({
    invoices: false,
    internal: false,
    public: false,
    publicPurchase: false,
    reads: false,
  })

  useEffect(() => {
    setInvoices([])
    setInternalRequests([])
    setPublicReimburseRequests([])
    setPublicPurchaseRequests([])
    setLoaded(current => ({ ...current, invoices: false, internal: false, public: false, publicPurchase: false }))

    const unsubscribeInvoices = subscribeDocs(year, 'i', docs => {
      setInvoices(docs)
      setLoaded(current => ({ ...current, invoices: true }))
    })

    const unsubscribeInternal = onValue(
      ref(db, `users/${USER_ID}/data/purchase_requests/${year}`),
      snapshot => {
        setInternalRequests(recordsFromYear<InternalRequestRecord>(snapshot.val()))
        setLoaded(current => ({ ...current, internal: true }))
      },
      () => {
        setInternalRequests([])
        setLoaded(current => ({ ...current, internal: true }))
      },
    )

    const unsubscribePublic = onValue(
      ref(db, `users/${USER_ID}/data/public_reimburse/${year}`),
      snapshot => {
        setPublicReimburseRequests(recordsFromYear<PublicRequestRecord>(snapshot.val()).map(item => ({ ...item, type: item.type || 'reimburse' })))
        setLoaded(current => ({ ...current, public: true }))
      },
      () => {
        setPublicReimburseRequests([])
        setLoaded(current => ({ ...current, public: true }))
      },
    )

    const unsubscribePublicPurchase = onValue(
      ref(db, `users/${USER_ID}/data/public_purchase_request/${year}`),
      snapshot => {
        setPublicPurchaseRequests(recordsFromYear<PublicRequestRecord>(snapshot.val()).map(item => ({ ...item, type: 'purchase_request' })))
        setLoaded(current => ({ ...current, publicPurchase: true }))
      },
      () => {
        setPublicPurchaseRequests([])
        setLoaded(current => ({ ...current, publicPurchase: true }))
      },
    )

    return () => {
      unsubscribeInvoices()
      unsubscribeInternal()
      unsubscribePublic()
      unsubscribePublicPurchase()
    }
  }, [year])

  useEffect(() => {
    if (authLoading) return

    setReadKeys(new Set())
    setLoaded(current => ({ ...current, reads: false }))

    if (!user?.uid) {
      setLoaded(current => ({ ...current, reads: true }))
      return
    }

    const readRef = ref(db, `users/${USER_ID}/data/notification_reads/${user.uid}/${year}`)
    return onValue(
      readRef,
      snapshot => {
        const value = snapshot.val()
        const keys = value && typeof value === 'object'
          ? Object.keys(value as Record<string, unknown>)
          : []
        setReadKeys(new Set(keys))
        setLoaded(current => ({ ...current, reads: true }))
      },
      () => {
        setReadKeys(new Set())
        setLoaded(current => ({ ...current, reads: true }))
      },
    )
  }, [authLoading, user?.uid, year])

  const notifications = useMemo(
    () => buildNotifications(invoices, internalRequests, [...publicReimburseRequests, ...publicPurchaseRequests], readKeys),
    [invoices, internalRequests, publicReimburseRequests, publicPurchaseRequests, readKeys],
  )

  const counts = useMemo(() => ({
    total: notifications.length,
    unread: notifications.filter(item => !item.isRead).length,
    read: notifications.filter(item => item.isRead).length,
    submissions: notifications.filter(item => item.kind === 'submission').length,
    overdue: notifications.filter(item => item.kind === 'invoice_overdue').length,
    dueToday: notifications.filter(item => item.kind === 'invoice_due_today').length,
  }), [notifications])

  const markAsRead = useCallback(async (notificationId: string) => {
    if (!user?.uid) throw new Error('Pengguna belum terautentikasi.')

    const readKey = notificationReadKey(notificationId)
    setReadKeys(current => new Set(current).add(readKey))

    try {
      await set(
        ref(db, `users/${USER_ID}/data/notification_reads/${user.uid}/${year}/${readKey}`),
        {
          notificationId,
          readAt: Date.now(),
        },
      )
    } catch (error) {
      setReadKeys(current => {
        const next = new Set(current)
        next.delete(readKey)
        return next
      })
      throw error
    }
  }, [user?.uid, year])

  const markAllAsRead = useCallback(async () => {
    if (!user?.uid) throw new Error('Pengguna belum terautentikasi.')

    const unread = notifications.filter(item => !item.isRead)
    if (unread.length === 0) return 0

    const updates = Object.fromEntries(unread.map(item => [item.readKey, {
      notificationId: item.id,
      readAt: Date.now(),
    }]))

    const previousKeys = new Set(readKeys)
    setReadKeys(current => {
      const next = new Set(current)
      unread.forEach(item => next.add(item.readKey))
      return next
    })

    try {
      await update(
        ref(db, `users/${USER_ID}/data/notification_reads/${user.uid}/${year}`),
        updates,
      )
      return unread.length
    } catch (error) {
      setReadKeys(previousKeys)
      throw error
    }
  }, [notifications, readKeys, user?.uid, year])

  return {
    notifications,
    counts,
    markAsRead,
    markAllAsRead,
    loading: authLoading || !loaded.invoices || !loaded.internal || !loaded.public || !loaded.publicPurchase || !loaded.reads,
  }
}
