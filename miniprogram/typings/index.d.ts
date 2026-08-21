/// <reference path="./types/index.d.ts" />

interface PoemCloudUser {
  id: string
  nickname: string
  signature: string
  avatarAssetId: string | null
  avatarUrl: string | null
  level: number
  membershipExpiresAt: string | null
  gender?: 0 | 1 | 2
  profileCompleted: boolean
  followerCount: number
  followingCount: number
  createdAt: string
}

interface IAppOption extends WechatMiniprogram.IAnyObject {
  globalData: {
    currentUser: PoemCloudUser | null
    sessionReady: boolean
  }
}
