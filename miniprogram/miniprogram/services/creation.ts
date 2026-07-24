import { STORAGE_KEYS } from '../config/api'
import { ApiError, hasAccessToken, request } from './api'
import { deleteAsset } from './assets'
import { ensureInstallation } from './installation'

export type PoemCategory = 'CLASSICAL' | 'MODERN' | 'CI'
export type ClassicalFormCode =
  | 'WUYAN_JUEJU'
  | 'QIYAN_JUEJU'
  | 'WUYAN_LVSHI'
  | 'QIYAN_LVSHI'

export interface CreationPreferences {
  category: PoemCategory
  classicalFormCode: ClassicalFormCode | null
  tunePatternCode: string | null
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

interface GenerationResponse {
  id: string
  workId: string | null
  status: string
  result: PoemResult | null
  error: {
    code: string
    message: string | null
  } | null
  quota?: {
    consumed: number
    remaining: number
  }
}

interface CreationResponse {
  id: string
  status: 'DRAFT' | 'FINAL'
  title: string | null
  content: string | null
  version: number
}

export interface CreationEditDraft {
  workId: string
  version: number
  prompt: string
  assetIds: string[]
  assets: Array<{
    id: string
    kind: 'IMAGE' | 'VIDEO'
    accessUrl: string
    thumbnailUrl?: string | null
  }>
  preferences: CreationPreferences
}

export interface PublicationResponse {
  id: string
  workId: string
  status: 'PUBLISHED' | 'PENDING_REVIEW' | 'HIDDEN' | 'REJECTED'
  title: string
  content: string
}

export interface PendingCreation {
  prompt: string
  assetIds: string[]
  assetKinds: Array<'IMAGE' | 'VIDEO'>
  preferences: CreationPreferences
  generationId: string
  workId: string | null
  result: PoemResult
  remainingQuota: number | null
  localDraftId?: string
  localUpdatedAt?: string
  draftSaved: boolean
  saved: boolean
  published: boolean
}

export interface LocalCreationDraft extends PendingCreation {
  localDraftId: string
  localUpdatedAt: string
}

export interface PoemTaxonomies {
  categories: Array<{
    code: PoemCategory
    name: string
    forms?: Array<{ code: ClassicalFormCode; name: string }>
    tunePatterns?: Array<{ code: string; name: string }>
  }>
}

function idempotencyKey(action: string): string {
  const random = Math.random().toString(36).slice(2, 12)
  return `${action}-${Date.now().toString(36)}-${random}`
}

function requireSuccessfulGeneration(generation: GenerationResponse): PoemResult {
  if (generation.status === 'SUCCEEDED' && generation.result) {
    return generation.result
  }
  throw new ApiError(
    generation.error?.message || '诗词生成未完成，请稍后重试',
    generation.error?.code || 'GENERATION_FAILED',
  )
}

export function loadPoemTaxonomies(): Promise<PoemTaxonomies> {
  return request<PoemTaxonomies>({
    path: '/poem-taxonomies',
    authenticated: false,
  })
}

async function createDraft(options: {
  prompt: string
  assetIds: string[]
  preferences: CreationPreferences
  generationId?: string
  idempotencyKey?: string
}): Promise<CreationResponse> {
  const { idempotencyKey: stableIdempotencyKey, ...data } = options
  return request<CreationResponse>({
    path: '/creations',
    method: 'POST',
    data,
    idempotencyKey: stableIdempotencyKey || idempotencyKey('create-draft'),
  })
}

export async function generatePoem(options: {
  prompt: string
  assetIds: string[]
  assetKinds: Array<'IMAGE' | 'VIDEO'>
  preferences: CreationPreferences
  workId?: string
  version?: number
}): Promise<PendingCreation> {
  await ensureInstallation()
  const requestOptions = {
    prompt: options.prompt,
    assetIds: options.assetIds,
    preferences: options.preferences,
  }
  let workId: string | null = null
  let generation: GenerationResponse

  if (hasAccessToken()) {
    let createdForGeneration = false
    if (options.workId) {
      const updated = await request<CreationResponse>({
        path: `/creations/${options.workId}`,
        method: 'PUT',
        data: {
          ...requestOptions,
          ...(options.version ? { version: options.version } : {}),
        },
      })
      workId = updated.id
    } else {
      const draft = await createDraft(requestOptions)
      workId = draft.id
      createdForGeneration = true
    }
    try {
      generation = await request<GenerationResponse>({
        path: `/creations/${workId}/generations`,
        method: 'POST',
        data: {},
        idempotencyKey: idempotencyKey('generate-poem'),
      })
    } catch (error) {
      if (createdForGeneration && workId) {
        await request<void>({
          path: `/creations/${workId}`,
          method: 'DELETE',
        }).catch(() => undefined)
      }
      throw error
    }
  } else {
    generation = await request<GenerationResponse>({
      path: '/guest/generations',
      method: 'POST',
      data: {
        ...requestOptions,
        instruction: '',
      },
      authenticated: false,
      idempotencyKey: idempotencyKey('guest-generate-poem'),
    })
  }

  return {
    ...options,
    generationId: generation.id,
    workId,
    result: requireSuccessfulGeneration(generation),
    remainingQuota: generation.quota?.remaining ?? null,
    draftSaved: false,
    saved: false,
    published: false,
  }
}

export function savePendingCreation(creation: PendingCreation): void {
  wx.setStorageSync(STORAGE_KEYS.pendingCreation, creation)
}

export function getPendingCreation(): PendingCreation | null {
  const value = wx.getStorageSync(STORAGE_KEYS.pendingCreation)
  if (!value || typeof value !== 'object') {
    return null
  }
  return value as PendingCreation
}

export function clearPendingCreation(): void {
  wx.removeStorageSync(STORAGE_KEYS.pendingCreation)
}

export function saveCreationEditDraft(draft: CreationEditDraft): void {
  wx.setStorageSync(STORAGE_KEYS.editingCreation, draft)
}

export function consumeCreationEditDraft(): CreationEditDraft | null {
  const value = wx.getStorageSync(STORAGE_KEYS.editingCreation)
  wx.removeStorageSync(STORAGE_KEYS.editingCreation)
  if (!value || typeof value !== 'object') return null
  return value as CreationEditDraft
}

export function getLocalCreationDrafts(): LocalCreationDraft[] {
  const value = wx.getStorageSync(STORAGE_KEYS.localCreationDrafts)
  if (!Array.isArray(value)) return []
  return value.filter((item): item is LocalCreationDraft => (
    item
    && typeof item === 'object'
    && typeof item.localDraftId === 'string'
    && typeof item.localUpdatedAt === 'string'
  ))
}

export function deleteLocalCreationDraft(localDraftId: string): void {
  wx.setStorageSync(
    STORAGE_KEYS.localCreationDrafts,
    getLocalCreationDrafts().filter((draft) => draft.localDraftId !== localDraftId),
  )
}

function saveLocalCreationDraft(creation: PendingCreation): LocalCreationDraft {
  const localDraftId = creation.localDraftId || `local-${creation.generationId}`
  const updated: LocalCreationDraft = {
    ...creation,
    localDraftId,
    localUpdatedAt: new Date().toISOString(),
    draftSaved: true,
  }
  const drafts = getLocalCreationDrafts().filter((draft) => draft.localDraftId !== localDraftId)
  wx.setStorageSync(STORAGE_KEYS.localCreationDrafts, [updated, ...drafts])
  savePendingCreation(updated)
  return updated
}

export async function syncLocalCreationDrafts(): Promise<number> {
  if (!hasAccessToken()) return 0
  const drafts = getLocalCreationDrafts()
  let synced = 0
  for (const draft of drafts) {
    try {
      const remote = await createDraft({
        prompt: draft.prompt,
        assetIds: draft.assetIds,
        preferences: draft.preferences,
        generationId: draft.generationId,
        idempotencyKey: `sync-${draft.localDraftId}`,
      })
      const currentPending = getPendingCreation()
      if (currentPending?.localDraftId === draft.localDraftId) {
        const updated: PendingCreation = {
          ...currentPending,
          workId: remote.id,
          draftSaved: true,
        }
        delete updated.localDraftId
        delete updated.localUpdatedAt
        savePendingCreation(updated)
      }
      deleteLocalCreationDraft(draft.localDraftId)
      synced += 1
    } catch {
      // Keep failed items locally so a later login or manual retry can sync them.
    }
  }
  return synced
}

export async function saveCreationAsDraft(
  creation: PendingCreation,
): Promise<PendingCreation> {
  if (!hasAccessToken()) {
    return saveLocalCreationDraft(creation)
  }
  let workId = creation.workId
  if (!workId) {
    const draft = await createDraft({
      prompt: creation.prompt,
      assetIds: creation.assetIds,
      preferences: creation.preferences,
      generationId: creation.generationId,
    })
    workId = draft.id
  }
  const updated = { ...creation, workId, draftSaved: true }
  if (creation.localDraftId) {
    deleteLocalCreationDraft(creation.localDraftId)
  }
  savePendingCreation(updated)
  return updated
}

export async function saveCreationAsWork(
  creation: PendingCreation,
  title: string,
): Promise<PendingCreation> {
  if (!hasAccessToken()) {
    throw new ApiError('登录后才能保存作品', 'AUTH_REQUIRED', 401)
  }
  let workId = creation.workId
  if (!workId) {
    const draft = await createDraft({
      prompt: creation.prompt,
      assetIds: creation.assetIds,
      preferences: creation.preferences,
      generationId: creation.generationId,
    })
    workId = draft.id
  }
  await request<CreationResponse>({
    path: `/creations/${workId}/finalize`,
    method: 'POST',
    data: {
      generationId: creation.generationId,
      title: title.trim() || creation.result.title,
    },
    idempotencyKey: idempotencyKey('finalize-poem'),
  })
  const updated = { ...creation, workId, draftSaved: true, saved: true }
  if (creation.localDraftId) {
    deleteLocalCreationDraft(creation.localDraftId)
  }
  savePendingCreation(updated)
  wx.setStorageSync(STORAGE_KEYS.creationNeedsReset, true)
  return updated
}

export async function discardPendingCreation(creation: PendingCreation): Promise<void> {
  if (creation.workId && hasAccessToken()) {
    await request<void>({
      path: `/creations/${creation.workId}`,
      method: 'DELETE',
    })
  } else if (creation.assetIds.length > 0) {
    await Promise.all(creation.assetIds.map((assetId) => deleteAsset(assetId)))
  }
  clearPendingCreation()
}

export async function publishCreation(creation: PendingCreation): Promise<PublicationResponse> {
  if (!creation.workId || !creation.saved) {
    throw new ApiError('请先保存作品', 'WORK_NOT_FINALIZED')
  }
  const publication = await request<PublicationResponse>({
    path: `/works/${creation.workId}/publications`,
    method: 'POST',
    data: {
      workId: creation.workId,
      visibility: 'PUBLIC',
      acceptedCommunityRules: true,
    },
    idempotencyKey: idempotencyKey('publish-poem'),
  })
  const updated = { ...creation, published: true }
  savePendingCreation(updated)
  wx.setStorageSync(STORAGE_KEYS.creationNeedsReset, true)
  wx.setStorageSync(STORAGE_KEYS.communityNeedsRefresh, true)
  return publication
}

export function consumeCreationReset(): boolean {
  const shouldReset = wx.getStorageSync(STORAGE_KEYS.creationNeedsReset) === true
  if (shouldReset) {
    wx.removeStorageSync(STORAGE_KEYS.creationNeedsReset)
  }
  return shouldReset
}
