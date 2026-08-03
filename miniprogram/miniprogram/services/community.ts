import { STORAGE_KEYS } from '../config/api'
import { request } from './api'
import type { CreationTimelineEvent, PoemCategory } from './creation'
import type { PoemValidationMark } from './creation'

export type PublicationCoverSource = 'MATERIAL' | 'POSTER'

export interface PublicationMaterial {
  id: string
  kind: 'IMAGE' | 'VIDEO'
  url: string
  thumbnailUrl: string
}

export interface CommunityPublication {
  id: string
  workId: string
  status: 'PUBLISHED' | 'PENDING_REVIEW' | 'HIDDEN' | 'REJECTED'
  visibility: 'PUBLIC' | 'UNLISTED'
  title: string
  content: string
  category: PoemCategory
  classicalFormCode: string | null
  tunePatternCode: string | null
  likeCount: number
  commentCount: number
  likedByMe: boolean
  posterUrl: string
  posterReady: boolean
  generatedBackgroundUrl: string | null
  posterBackgroundReady: boolean
  coverUrl: string | null
  displayCoverUrl: string | null
  shareImageUrl: string | null
  materials: PublicationMaterial[]
  creationJournalPublic: boolean
  coverSource: PublicationCoverSource
  canViewCreationJournal: boolean
  hasCreationJournal: boolean
  publishedAt: string | null
  createdAt: string
  selectedGenerationId?: string | null
  validationMarks?: PoemValidationMark[]
  author: {
    id: string
    nickname: string
    avatarAssetId?: string | null
    avatarUrl?: string | null
  }
}

export interface PublicationCreationJournalEntry {
  generationId: string
  baseGenerationId: string | null
  prompt: string
  instruction: string
  materialNarrative: string[]
  events: CreationTimelineEvent[]
}

interface FeedResponse {
  items: CommunityPublication[]
  nextCursor: string | null
}

export type CommentModerationStatus = 'PENDING' | 'PASSED' | 'REJECTED' | 'REVIEW'

export interface CommunityCommentAuthor {
  id: string
  nickname: string
  avatarAssetId: string | null
  avatarUrl: string | null
}

export interface CommunityComment {
  id: string
  publicationId: string
  parentCommentId: string | null
  rootCommentId: string | null
  content: string
  moderationStatus: CommentModerationStatus
  author: CommunityCommentAuthor
  replyToUser: CommunityCommentAuthor | null
  isPublicationAuthor: boolean
  canDelete: boolean
  replyCount: number
  replies: CommunityComment[]
  hasMoreReplies: boolean
  createdAt: string
}

export interface CommunityCommentListResponse {
  items: CommunityComment[]
  total: number
  nextCursor: string | null
}

export interface CommunityReplyListResponse {
  items: CommunityComment[]
  nextCursor: string | null
}

export interface CreateCommunityCommentResponse {
  comment: CommunityComment
  commentCount: number
}

export interface DeleteCommunityCommentResponse {
  deletedCount: number
  visibleDeletedCount: number
  commentCount: number
}

function commentIdempotencyKey(): string {
  const random = Math.random().toString(36).slice(2, 12)
  return `comment-${Date.now().toString(36)}-${random}`
}

export interface PublicUser {
  id: string
  nickname: string
  signature: string
  avatarUrl?: string | null
  followerCount: number
  followingCount: number
  followedByMe: boolean
}

export interface UserPublicationsResponse {
  author: Omit<PublicUser, 'followedByMe'>
  items: CommunityPublication[]
  nextCursor: string | null
}

interface UserListResponse {
  items: PublicUser[]
  nextCursor: string | null
}

export function loadUserFollowers(id: string, cursor?: string): Promise<UserListResponse> {
  const query = `limit=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
  return request<UserListResponse>({
    path: `/users/${encodeURIComponent(id)}/followers?${query}`,
  })
}

export function loadUserFollowing(id: string, cursor?: string): Promise<UserListResponse> {
  const query = `limit=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
  return request<UserListResponse>({
    path: `/users/${encodeURIComponent(id)}/following?${query}`,
  })
}

export function loadUserPublications(
  id: string,
  cursor?: string,
): Promise<UserPublicationsResponse> {
  const query = `limit=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
  return request<UserPublicationsResponse>({
    path: `/users/${encodeURIComponent(id)}/publications?${query}`,
  })
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

export function updatePublicationSettings(
  id: string,
  settings: {
    creationJournalPublic: boolean
    coverSource: PublicationCoverSource
  },
): Promise<CommunityPublication> {
  return request<CommunityPublication>({
    path: `/community/publications/${encodeURIComponent(id)}/settings`,
    method: 'PUT',
    data: settings,
  })
}

export function loadPublicationCreationJournal(
  id: string,
): Promise<PublicationCreationJournalEntry[]> {
  return request<{ items: PublicationCreationJournalEntry[] }>({
    path: `/community/publications/${encodeURIComponent(id)}/creation-journal`,
  }).then((response) => response.items)
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

export function loadPublicationComments(
  publicationId: string,
  cursor?: string,
): Promise<CommunityCommentListResponse> {
  const query = `limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
  return request<CommunityCommentListResponse>({
    path: `/community/publications/${encodeURIComponent(publicationId)}/comments?${query}`,
  })
}

export function loadCommentReplies(
  publicationId: string,
  commentId: string,
  cursor?: string,
): Promise<CommunityReplyListResponse> {
  const query = `limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
  return request<CommunityReplyListResponse>({
    path: `/community/publications/${encodeURIComponent(publicationId)}/comments/${encodeURIComponent(commentId)}/replies?${query}`,
  })
}

export function createPublicationComment(
  publicationId: string,
  content: string,
  parentCommentId?: string,
): Promise<CreateCommunityCommentResponse> {
  return request<CreateCommunityCommentResponse>({
    path: `/community/publications/${encodeURIComponent(publicationId)}/comments`,
    method: 'POST',
    data: {
      content,
      ...(parentCommentId ? { parentCommentId } : {}),
    },
    idempotencyKey: commentIdempotencyKey(),
  })
}

export function deletePublicationComment(
  publicationId: string,
  commentId: string,
): Promise<DeleteCommunityCommentResponse> {
  return request<DeleteCommunityCommentResponse>({
    path: `/community/publications/${encodeURIComponent(publicationId)}/comments/${encodeURIComponent(commentId)}`,
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
