export const DEFAULT_API_BASE_URL = 'http://9.134.132.210:3000/v1'

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
  editingCreation: 'poem_cloud_editing_creation',
  localCreationDrafts: 'poem_cloud_local_creation_drafts',
  creationNeedsReset: 'poem_cloud_creation_needs_reset',
  communityNeedsRefresh: 'poem_cloud_community_needs_refresh',
  clientDataResetVersion: 'poem_cloud_client_data_reset_version',
} as const

export function getApiBaseUrl(): string {
  const customBaseUrl = wx.getStorageSync(STORAGE_KEYS.apiBaseUrl)
  return typeof customBaseUrl === 'string' && customBaseUrl.length > 0
    ? customBaseUrl.replace(/\/$/, '')
    : DEFAULT_API_BASE_URL
}
