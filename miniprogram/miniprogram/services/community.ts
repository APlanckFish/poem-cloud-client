import { STORAGE_KEYS } from '../config/api'
import { request } from './api'
import type { PoemCategory } from './creation'

export interface CommunityPublication {
  id: string
  workId: string
  title: string
  content: string
  category: PoemCategory
  classicalFormCode: string | null
  tunePatternCode: string | null
  likeCount: number
  likedByMe: boolean
  posterUrl: string
  coverUrl: string | null
  publishedAt: string | null
  createdAt: string
  author: {
    id: string
    nickname: string
    avatarAssetId?: string | null
    avatarUrl?: string | null
  }
}

interface FeedResponse {
  items: CommunityPublication[]
  nextCursor: string | null
}

export interface PublicUser {
  id: string
  nickname: string
  avatarUrl?: string | null
  followerCount: number
  followingCount: number
  followedByMe: boolean
}

export function loadCommunityFeed(
  options: {
    category?: PoemCategory
    classicalFormCode?: string
    tunePatternCode?: string
    cursor?: string
  } = {},
): Promise<FeedResponse> {
  const query = [
    'limit=30',
    ...(options.category ? [`category=${encodeURIComponent(options.category)}`] : []),
    ...(options.classicalFormCode
      ? [`classicalFormCode=${encodeURIComponent(options.classicalFormCode)}`]
      : []),
    ...(options.tunePatternCode
      ? [`tunePatternCode=${encodeURIComponent(options.tunePatternCode)}`]
      : []),
    ...(options.cursor ? [`cursor=${encodeURIComponent(options.cursor)}`] : []),
  ].join('&')
  return request<FeedResponse>({
    path: `/community/feed?${query}`,
  })
}

export function getPublication(id: string): Promise<CommunityPublication> {
  return request<CommunityPublication>({
    path: `/community/publications/${id}`,
  })
}

export function likePublication(id: string): Promise<void> {
  return request<void>({
    path: `/community/publications/${encodeURIComponent(id)}/like`,
    method: 'PUT',
  })
}

export function unlikePublication(id: string): Promise<void> {
  return request<void>({
    path: `/community/publications/${encodeURIComponent(id)}/like`,
    method: 'DELETE',
  })
}

export function getPublicUser(id: string): Promise<PublicUser> {
  return request<PublicUser>({ path: `/users/${encodeURIComponent(id)}` })
}

export function followUser(id: string): Promise<void> {
  return request<void>({
    path: `/users/${encodeURIComponent(id)}/follow`,
    method: 'PUT',
  })
}

export function unfollowUser(id: string): Promise<void> {
  return request<void>({
    path: `/users/${encodeURIComponent(id)}/follow`,
    method: 'DELETE',
  })
}

export function consumeCommunityRefresh(): boolean {
  const shouldRefresh = wx.getStorageSync(STORAGE_KEYS.communityNeedsRefresh) === true
  if (shouldRefresh) {
    wx.removeStorageSync(STORAGE_KEYS.communityNeedsRefresh)
  }
  return shouldRefresh
}
