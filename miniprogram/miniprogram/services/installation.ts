import { STORAGE_KEYS } from '../config/api'
import { request } from './api'

interface InstallationResponse {
  installationId: string
  installationToken: string
  expiresAt: string | null
}

let installationPromise: Promise<InstallationResponse> | null = null
let activeInstallation: InstallationResponse | null = null

function createInstallationKey(): string {
  const random = Math.random().toString(36).slice(2)
  return `mini-${Date.now().toString(36)}-${random}-${random}`
}

export function ensureInstallation(): Promise<InstallationResponse> {
  if (activeInstallation) {
    return Promise.resolve(activeInstallation)
  }
  if (installationPromise) {
    return installationPromise
  }

  let installationKey = wx.getStorageSync(STORAGE_KEYS.installationKey)
  const installationToken = wx.getStorageSync(STORAGE_KEYS.installationToken)
  const hasInstallationKey =
    typeof installationKey === 'string' && installationKey.length >= 16
  const hasInstallationToken =
    typeof installationToken === 'string' && installationToken.length > 0
  if (!hasInstallationKey || !hasInstallationToken) {
    installationKey = createInstallationKey()
    wx.setStorageSync(STORAGE_KEYS.installationKey, installationKey)
    wx.removeStorageSync(STORAGE_KEYS.installationId)
    wx.removeStorageSync(STORAGE_KEYS.installationToken)
  }

  installationPromise = request<InstallationResponse>({
    path: '/installations',
    method: 'POST',
    data: { installationKey },
    authenticated: false,
    includeInstallation: true,
  })
    .then((installation) => {
      wx.setStorageSync(STORAGE_KEYS.installationId, installation.installationId)
      wx.setStorageSync(STORAGE_KEYS.installationToken, installation.installationToken)
      activeInstallation = installation
      return installation
    })
    .finally(() => {
      installationPromise = null
    })

  return installationPromise
}

export function resetInstallation(
  options: { preserveKey?: boolean; preserveToken?: boolean } = {},
): void {
  installationPromise = null
  activeInstallation = null
  if (!options.preserveKey) {
    wx.removeStorageSync(STORAGE_KEYS.installationKey)
  }
  wx.removeStorageSync(STORAGE_KEYS.installationId)
  if (!options.preserveToken) {
    wx.removeStorageSync(STORAGE_KEYS.installationToken)
  }
}
