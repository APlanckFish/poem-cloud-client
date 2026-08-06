export type PoemCategory = 'CLASSICAL' | 'MODERN' | 'CI'
export type ClassicalFormCode =
  | 'WUYAN_JUEJU'
  | 'QIYAN_JUEJU'
  | 'WUYAN_LVSHI'
  | 'QIYAN_LVSHI'
  | 'DAYOU_SHI'

export interface User {
  id: string
  nickname: string
  signature: string
  avatarAssetId: string | null
  avatarUrl?: string | null
  level: number
  gender: 0 | 1 | 2
  registrationSource?: 'WEB' | 'MINIPROGRAM'
  phone?: string | null
  email?: string | null
  profileCompleted: boolean
  followerCount: number
  followingCount: number
  createdAt: string
}

export interface Quota {
  limit: number | null
  used: number
  remaining: number | null
  unlimited: boolean
  resetsAt?: string | null
}

export interface Dashboard {
  quota: Quota
  workCount: number
  draftCount: number
  receivedLikes: number
}

export interface ProfileResponse extends User {
  dashboard: Dashboard
}

export interface PoemPreferences {
  category: PoemCategory
  classicalFormCode: ClassicalFormCode | null
  tunePatternCode: string | null
  rhymeScheme: 'TRADITIONAL' | 'NEW_CHINESE'
  preferredPoets: string[]
  styleTags: string[]
  lengthHint: number | null
}

export interface PoemResult {
  title: string
  content: string
  category: PoemCategory
  classicalFormCode: ClassicalFormCode | null
  tunePatternCode: string | null
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
  materials: Array<{
    id: string
    kind: 'IMAGE' | 'VIDEO'
    url: string
    thumbnailUrl: string
  }>
  creationJournalPublic: boolean
  coverSource: 'MATERIAL' | 'POSTER'
  canViewCreationJournal: boolean
  hasCreationJournal: boolean
  publishedAt: string | null
  createdAt: string
  author: {
    id: string
    nickname: string
    avatarAssetId?: string | null
    avatarUrl?: string | null
  }
}

export interface LibraryWork {
  id: string
  status: 'DRAFT' | 'FINAL'
  title: string | null
  content: string | null
  prompt: string
  category: PoemCategory
  classicalFormCode: string | null
  tunePatternCode: string | null
  preferences?: PoemPreferences
  generationCount: number
  selectedGenerationId?: string | null
  version: number
  publication: {
    id: string
    status: 'PUBLISHED' | 'PENDING_REVIEW' | 'HIDDEN' | 'REJECTED'
    visibility: 'PUBLIC' | 'UNLISTED'
    likeCount: number
  } | null
  createdAt: string
  updatedAt: string
  assetIds?: string[]
  assets?: Array<{
    id?: string
    kind: 'IMAGE' | 'VIDEO'
    accessUrl?: string | null
    thumbnailUrl?: string | null
  }>
  latestGeneration?: { id: string; result: PoemResult | null }
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

export interface CreationRun {
  runId: string
  generationId: string
  creationId: string | null
  eventsUrl: string
  snapshotUrl: string
  quota: Quota
}

export interface CreationSnapshot {
  runId: string
  generationId: string
  creationId: string | null
  coreStatus: string
  currentStage: string
  result: PoemResult | null
  materialAnalysis: {
    publicNarrative?: string[]
    symbols?: string[]
    scenes?: string[]
    mood?: string[]
  } | null
  queue: { state: 'QUEUED'; ahead: number; position: number } | null
  error: { code: string; message: string | null } | null
}
