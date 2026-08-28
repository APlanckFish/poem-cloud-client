import { request } from './api'

export interface QuotaResponse {
  baseLimit: number | null
  baseRemaining?: number | null
  bonus: number
  bonusRemaining?: number
  bonusLimit: number
  limit: number | null
  used: number
  reserved: number
  remaining: number | null
  unlimited: boolean
  purchasedCredits: {
    balance: number
    reserved: number
    remaining: number
  }
  totalRemaining: number | null
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
