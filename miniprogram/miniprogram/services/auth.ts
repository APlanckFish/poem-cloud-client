import { STORAGE_KEYS } from '../config/api'
import { ApiError, clearSessionStorage, hasAccessToken, request } from './api'
import { uploadImageAsset } from './assets'
import { syncLocalCreationDrafts } from './creation'
import { ensureInstallation, resetInstallation } from './installation'
import type { ProfileDashboard } from './profile'

interface BackendUser {
  id: string
  nickname: string
  signature: string
  avatarAssetId: string | null
  level: number
  gender: 0 | 1 | 2
  profileCompleted: boolean
  followerCount: number
  followingCount: number
  createdAt: string
  dashboard?: ProfileDashboard
}

export interface RestoredSession {
  user: PoemCloudUser
  dashboard: ProfileDashboard | null
}

interface LoginResponse {
  user: BackendUser
  accessToken: string
  expiresAt: string
}

interface AssetResponse {
  accessUrl: string | null
}

interface LocalWechatProfile {
  avatarUrl: string
  gender?: 0 | 1 | 2
}

type LocalWechatProfiles = Record<string, LocalWechatProfile>

let restoreSessionPromise: Promise<RestoredSession | null> | null = null

function getWechatLoginCode(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    wx.login({
      success(result) {
        if (result.code) {
          resolve(result.code)
          return
        }
        reject(new ApiError('微信登录凭证为空', 'WECHAT_LOGIN_FAILED'))
      },
      fail(error) {
        reject(new ApiError(error.errMsg || '微信登录失败', 'WECHAT_LOGIN_FAILED'))
      },
    })
  })
}

function localWechatProfiles(): LocalWechatProfiles {
  const value = wx.getStorageSync(STORAGE_KEYS.localWechatProfiles)
  return value && typeof value === 'object' ? (value as LocalWechatProfiles) : {}
}

function localAvatarUrl(userId: string): string | null {
  const avatarUrl = localWechatProfiles()[userId]?.avatarUrl
  return typeof avatarUrl === 'string' && avatarUrl.length > 0 ? avatarUrl : null
}

function saveLocalAvatarUrl(userId: string, avatarUrl: string): void {
  const profiles = localWechatProfiles()
  profiles[userId] = { ...profiles[userId], avatarUrl }
  wx.setStorageSync(STORAGE_KEYS.localWechatProfiles, profiles)
}

function getAuthorizedWechatGender(): Promise<0 | 1 | 2> {
  return new Promise((resolve) => {
    wx.getSetting({
      success(setting) {
        if (!setting.authSetting['scope.userInfo']) {
          resolve(0)
          return
        }
        wx.getUserInfo({
          success(result) {
            resolve(result.userInfo.gender)
          },
          fail: () => resolve(0),
        })
      },
      fail: () => resolve(0),
    })
  })
}

function isLocalFilePath(filePath: string): boolean {
  return !/^https?:\/\//.test(filePath) || /^https?:\/\/tmp\//.test(filePath)
}

async function enrichUser(user: BackendUser): Promise<PoemCloudUser> {
  const { dashboard: _dashboard, ...userProfile } = user
  let avatarUrl: string | null = localAvatarUrl(user.id)
  if (user.avatarAssetId) {
    try {
      const asset = await request<AssetResponse>({ path: `/assets/${user.avatarAssetId}` })
      avatarUrl = asset.accessUrl || avatarUrl
    } catch {
      // Keep the locally authorized WeChat avatar when the remote asset is unavailable.
    }
  }
  return { ...userProfile, avatarUrl }
}

function cacheUser(user: PoemCloudUser): void {
  wx.setStorageSync(STORAGE_KEYS.currentUser, user)
  getApp<IAppOption>().globalData.currentUser = user
}

export function cachedUser(): PoemCloudUser | null {
  const value = wx.getStorageSync(STORAGE_KEYS.currentUser)
  if (!value || typeof value !== 'object') {
    return null
  }
  return value as PoemCloudUser
}

export async function loginWithWechat(): Promise<PoemCloudUser> {
  await ensureInstallation()
  const gender = await getAuthorizedWechatGender()
  const code = await getWechatLoginCode()
  const result = await request<LoginResponse>({
    path: '/auth/wechat/mini-program',
    method: 'POST',
    data: { code, gender },
    authenticated: false,
  })
  wx.setStorageSync(STORAGE_KEYS.accessToken, result.accessToken)
  wx.setStorageSync(STORAGE_KEYS.tokenExpiresAt, result.expiresAt)
  const user = await enrichUser(result.user)
  cacheUser(user)
  await syncLocalCreationDrafts()
  return user
}

async function requestRestoredSession(): Promise<RestoredSession | null> {
  if (!hasAccessToken()) {
    return null
  }
  try {
    const backendUser = await request<BackendUser>({
      path: '/me',
      // Guest data is claimed atomically by the login endpoint. Sending the
      // installation token here made every profile refresh repeat that work.
      includeInstallation: false,
    })
    const user = await enrichUser(backendUser)
    cacheUser(user)
    const syncedDraftCount = await syncLocalCreationDrafts()
    const dashboard = backendUser.dashboard
      ? {
          ...backendUser.dashboard,
          draftCount: backendUser.dashboard.draftCount + syncedDraftCount,
        }
      : null
    return { user, dashboard }
  } catch (error) {
    if (error instanceof ApiError && (error.statusCode === 401 || error.statusCode === 403)) {
      clearSessionStorage()
      getApp<IAppOption>().globalData.currentUser = null
      return null
    }
    throw error
  }
}

export function restoreSession(): Promise<RestoredSession | null> {
  if (restoreSessionPromise) {
    return restoreSessionPromise
  }
  restoreSessionPromise = requestRestoredSession().finally(() => {
    restoreSessionPromise = null
  })
  return restoreSessionPromise
}

export async function updateWechatProfile(options: {
  nickname: string
  avatarTempFilePath?: string
  signature?: string
}): Promise<PoemCloudUser> {
  const currentUser = cachedUser()
  if (!currentUser) {
    throw new ApiError('登录状态已失效，请重新登录', 'AUTH_REQUIRED', 401)
  }
  const nickname = options.nickname.trim()
  if (!nickname) {
    throw new ApiError('请选择或填写微信昵称', 'NICKNAME_REQUIRED')
  }

  let avatarAssetId = currentUser.avatarAssetId
  let uploadedAvatarUrl: string | null = null
  if (options.avatarTempFilePath && isLocalFilePath(options.avatarTempFilePath)) {
    const avatarAsset = await uploadImageAsset(options.avatarTempFilePath, 'AVATAR')
    avatarAssetId = avatarAsset.id
    uploadedAvatarUrl = avatarAsset.accessUrl
  }
  const backendUser = await request<BackendUser>({
    path: '/me/profile',
    method: 'POST',
    data: {
      nickname,
      signature: options.signature?.trim(),
      ...(avatarAssetId ? { avatarAssetId } : {}),
    },
  })
  const user = await enrichUser(backendUser)
  const avatarUrl = user.avatarUrl || uploadedAvatarUrl
  if (avatarUrl) {
    saveLocalAvatarUrl(currentUser.id, avatarUrl)
  }
  cacheUser(user)
  return user
}

export async function logout(): Promise<void> {
  try {
    await request<void>({ path: '/auth/logout', method: 'POST' })
  } finally {
    clearSessionStorage()
    // Keep the device identity stable after logout so a guest quota cannot be
    // reset simply by signing out and receiving a new installation identity.
    resetInstallation({ preserveKey: true })
    getApp<IAppOption>().globalData.currentUser = null
    void ensureInstallation().catch(() => undefined)
  }
}
