export const storageKeys = {
  accessToken: 'poem_cloud_h5_access_token',
  tokenExpiresAt: 'poem_cloud_h5_token_expires_at',
  currentUser: 'poem_cloud_h5_current_user',
  installationKey: 'poem_cloud_h5_installation_key',
  installationToken: 'poem_cloud_h5_installation_token',
  installationId: 'poem_cloud_h5_installation_id',
  activeCreationRun: 'poem_cloud_h5_active_creation_run',
  pendingCreation: 'poem_cloud_h5_pending_creation',
  localDrafts: 'poem_cloud_h5_local_drafts',
  preferences: 'poem_cloud_h5_preferences',
} as const

export function getStoredJson<T>(key: string): T | null {
  const value = localStorage.getItem(key)
  if (!value) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

export function setStoredJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value))
}

export function randomId(prefix: string): string {
  const random = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
  return `${prefix}-${random}`
}
