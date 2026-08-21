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
  if (typeof installationKey !== 'string' || installationKey.length < 16) {
    installationKey = createInstallationKey()
    wx.setStorageSync(STORAGE_KEYS.installationKey, installationKey)
  }

  installationPromise = request<InstallationResponse>({
    path: '/installations',
    method: 'POST',
    data: { installationKey },
    authenticated: false,
    // Existing keys may only rotate their token after proving possession of the
    // previous token. A brand-new installation naturally sends no header.
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
