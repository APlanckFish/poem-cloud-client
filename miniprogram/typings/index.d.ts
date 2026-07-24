/// <reference path="./types/index.d.ts" />

interface PoemCloudUser {
  id: string
  nickname: string
  avatarAssetId: string | null
  avatarUrl: string | null
  level: number
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
