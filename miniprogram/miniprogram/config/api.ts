/**
 * 各环境的后端地址。
 *
 * 微信平台要求：体验版与正式版的 wx.request 目标必须是
 * 「已备案的 HTTPS 域名」且已配置在小程序后台的 request 合法域名中，
 * 不能使用 IP，也不能使用 http。因此仅 develop（开发者工具/本地调试）
 * 允许使用本地地址。
 */
const API_BASE_URL_BY_ENV = {
  /** 开发者工具、真机调试 */
  // develop: 'http://127.0.0.1:3000/v1',
  develop: 'https://qa-api.planckfish.xyz/v1',
  /** 体验版：需替换为测试环境域名 */
  trial: 'https://qa-api.planckfish.xyz/v1',
  /** 正式版：需替换为生产环境域名 */
  release: 'https://api.planckfish.xyz/v1',
} as const

export type MiniProgramEnvVersion = keyof typeof API_BASE_URL_BY_ENV

export function getMiniProgramEnvVersion(): MiniProgramEnvVersion {
  try {
    const { envVersion } = wx.getAccountInfoSync().miniProgram
    if (envVersion === 'develop' || envVersion === 'trial' || envVersion === 'release') {
      return envVersion
    }
  } catch {
    // 极早期调用或接口不可用时回退到正式环境。
  }
  return 'release'
}

export const DEFAULT_API_BASE_URL = API_BASE_URL_BY_ENV.develop

export const STORAGE_KEYS = {
  apiBaseUrl: 'poem_cloud_api_base_url',
  accessToken: 'poem_cloud_access_token',
  tokenExpiresAt: 'poem_cloud_token_expires_at',
  currentUser: 'poem_cloud_current_user',
  localWechatProfiles: 'poem_cloud_local_wechat_profiles',
  installationKey: 'poem_cloud_installation_key',
  installationId: 'poem_cloud_installation_id',
  installationToken: 'poem_cloud_installation_token',
  pendingCreation: 'poem_cloud_pending_creation',
  activeCreationRun: 'poem_cloud_active_creation_run',
  savedCreationRunDrafts: 'poem_cloud_saved_creation_run_drafts',
  editingCreation: 'poem_cloud_editing_creation',
  localCreationDrafts: 'poem_cloud_local_creation_drafts',
  creationNeedsReset: 'poem_cloud_creation_needs_reset',
  communityNeedsRefresh: 'poem_cloud_community_needs_refresh',
  publicationFlipHints: 'poem_cloud_publication_flip_hints',
  creationResumeAfterPreferences: 'poem_cloud_creation_resume_after_preferences',
} as const

export function getApiBaseUrl(): string {
  const envVersion = getMiniProgramEnvVersion()
  // A developer override must never survive into trial/release and receive
  // production session or installation tokens.
  if (envVersion === 'develop') {
    const customBaseUrl = wx.getStorageSync(STORAGE_KEYS.apiBaseUrl)
    if (typeof customBaseUrl === 'string' && customBaseUrl.length > 0) {
      return customBaseUrl.replace(/\/$/, '')
    }
  }
  return API_BASE_URL_BY_ENV[envVersion].replace(/\/$/, '')
}
