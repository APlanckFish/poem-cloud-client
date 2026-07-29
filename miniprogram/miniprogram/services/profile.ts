import { request } from './api'

export interface QuotaResponse {
  limit: number | null
  used: number
  remaining: number | null
  unlimited: boolean
  resetsAt: string | null
}

export function loadCreationQuota(): Promise<QuotaResponse> {
  return request<QuotaResponse>({ path: '/me/quota' })
}

export interface ProfileDashboard {
  quota: QuotaResponse
  workCount: number
  draftCount: number
  receivedLikes: number
}

export async function loadProfileDashboard(): Promise<ProfileDashboard> {
  const response = await request<{ dashboard: ProfileDashboard }>({
    path: '/me',
    includeInstallation: false,
  })
  return response.dashboard
}
