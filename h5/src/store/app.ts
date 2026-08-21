import { create } from 'zustand'
import type { Dashboard, User } from '../types'
import { apiRequest } from '../lib/api'
import { getStoredJson, setStoredJson, storageKeys } from '../lib/storage'

interface AppState {
  user: User | null
  dashboard: Dashboard | null
  restoring: boolean
  toast: string
  setToast: (message: string) => void
  clearToast: () => void
  setSession: (user: User, accessToken: string, expiresAt?: string) => void
  setUser: (user: User) => void
  expireSession: () => void
  restoreSession: () => Promise<User | null>
  logout: () => Promise<void>
}

export const useAppStore = create<AppState>((set, get) => ({
  user: getStoredJson<User>(storageKeys.currentUser),
  dashboard: null,
  restoring: false,
  toast: '',
  setToast(message) {
    set({ toast: message })
  },
  clearToast() {
    set({ toast: '' })
  },
  setSession(user, accessToken, expiresAt) {
    localStorage.setItem(storageKeys.accessToken, accessToken)
    if (expiresAt) localStorage.setItem(storageKeys.tokenExpiresAt, expiresAt)
    setStoredJson(storageKeys.currentUser, user)
    set({ user })
  },
  setUser(user) {
    setStoredJson(storageKeys.currentUser, user)
    set({ user })
  },
  expireSession() {
    localStorage.removeItem(storageKeys.accessToken)
    localStorage.removeItem(storageKeys.tokenExpiresAt)
    localStorage.removeItem(storageKeys.currentUser)
    set({
      user: null,
      dashboard: null,
      toast: '登录已失效，请重新登录',
    })
  },
  async restoreSession() {
    if (!localStorage.getItem(storageKeys.accessToken)) return null
    if (get().restoring) return get().user
    set({ restoring: true })
    try {
      const profile = await apiRequest<User & { dashboard: Dashboard }>('/me')
      const { dashboard, ...user } = profile
      setStoredJson(storageKeys.currentUser, user)
      set({ user, dashboard })
      return user
    } catch {
      localStorage.removeItem(storageKeys.accessToken)
      localStorage.removeItem(storageKeys.tokenExpiresAt)
      localStorage.removeItem(storageKeys.currentUser)
      set({ user: null, dashboard: null })
      return null
    } finally {
      set({ restoring: false })
    }
  },
  async logout() {
    try {
      await apiRequest<void>('/auth/logout', { method: 'POST' })
    } catch {
      // Local logout remains reliable when the server is unavailable.
    }
    localStorage.removeItem(storageKeys.accessToken)
    localStorage.removeItem(storageKeys.tokenExpiresAt)
    localStorage.removeItem(storageKeys.currentUser)
    set({ user: null, dashboard: null })
  },
}))
