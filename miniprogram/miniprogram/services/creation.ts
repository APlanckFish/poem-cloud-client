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
  | 'DAYOU_SHI'

export interface CreationPreferences {
  category: PoemCategory
  classicalFormCode: ClassicalFormCode | null
  tunePatternCode: string | null
  rhymeScheme: 'TRADITIONAL' | 'NEW_CHINESE'
  preferredPoets: string[]
  styleTags: string[]
  themeTags: string[]
  lengthHint: number | null
}

export interface PoemResult {
  title: string
  content: string
  category: PoemCategory
  classicalFormCode: ClassicalFormCode | null
  tunePatternCode: string | null
  rhymeScheme?: 'TRADITIONAL' | 'NEW_CHINESE'
  writingScript?: 'TRADITIONAL' | 'SIMPLIFIED'
  validation?: {
    valid: boolean
    issues: string[]
    rhymeBook: '平水韵' | '词林正韵' | '中华新韵' | '不适用'
    meterSummary: string
    attempt: number
    acceptedWithIssues?: boolean
    marks?: PoemValidationMark[]
  }
}

export interface PoemValidationMark {
  lineIndex: number
  characterIndex: number
  character: string
  kind: 'TONE' | 'RHYME' | 'UNKNOWN_READING'
  message: string
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
  shareImageUrl: string | null
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
  sharePublicationId?: string
  shareImageUrl?: string
}

export interface ActiveCreationRun {
  runId: string
  eventsUrl: string
  snapshotUrl: string
  creationId: string | null
  prompt: string
  assetIds: string[]
  assetKinds: Array<'IMAGE' | 'VIDEO'>
  preferences: CreationPreferences
  /** 旧缓存可能没有该字段；缺省按开启处理。 */
  posterEnabled?: boolean
  remainingQuota: number | null
  lastEventId: string
  queue: CreationQueueStatus | null
}

export interface SavedCreationRunDraft extends ActiveCreationRun {
  localDraftId: string
  localUpdatedAt: string
}

interface CreationRunResponse {
  runId: string
  generationId: string
  creationId: string | null
  coreStatus: string
  posterStatus: string
  eventsUrl: string
  snapshotUrl: string
  queue: CreationQueueStatus | null
  quota: {
    consumed: number
    limit: number | null
    reserved: number
    remaining: number | null
    unlimited: boolean
  }
}

export interface CreationQueueStatus {
  state: 'QUEUED'
  ahead: number
  position: number
}

export interface CreationRunSnapshot {
  runId: string
  generationId: string
  baseGenerationId: string | null
  creationId: string | null
  coreStatus: string
  posterStatus: string
  currentStage: string
  queue: CreationQueueStatus | null
  result: PoemResult | null
  materialAnalysis: {
    summary?: string
    publicNarrative?: string[]
    symbols?: string[]
    scenes?: string[]
    mood?: string[]
  } | null
  input: {
    prompt: string
    assetIds: string[]
    preferences: CreationPreferences | null
    instruction: string
  }
  error: {
    code: string
    message: string | null
  } | null
  lastEventId: string
  lastPublicEventSeq: number
}

export interface CreationTimelineEvent {
  seq: number
  event: string
  data: Record<string, unknown>
  occurredAt: string
  schemaVersion: number
}

interface CreationTimelineResponse {
  generationId: string
  creationId: string | null
  coreStatus: string
  result: PoemResult | null
  lastSeq: number
  hasMore: boolean
  items: CreationTimelineEvent[]
}

export interface CreationHistoryEntry {
  snapshot: CreationRunSnapshot
  events: CreationTimelineEvent[]
}

export interface LocalCreationDraft extends PendingCreation {
  localDraftId: string
  localUpdatedAt: string
}

export interface PoemTaxonomies {
  categories: Array<{
    code: PoemCategory
    name: string
    forms?: Array<{ code: ClassicalFormCode; name: string; description?: string }>
    tunePatterns?: Array<{ code: string; name: string; aliases?: string[] }>
  }>
}

function idempotencyKey(action: string): string {
  const random = Math.random().toString(36).slice(2, 12)
  return `${action}-${Date.now().toString(36)}-${random}`
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

export async function startCreationRun(options: {
  prompt: string
  assetIds: string[]
  assetKinds: Array<'IMAGE' | 'VIDEO'>
  preferences: CreationPreferences
  workId?: string
  version?: number
  baseGenerationId?: string
  instruction?: string
  posterEnabled?: boolean
}): Promise<ActiveCreationRun> {
  await ensureInstallation()
  const response = await request<CreationRunResponse>({
    path: '/creation-runs',
    method: 'POST',
    data: {
      ...(options.workId ? { creationId: options.workId } : {}),
      ...(options.version ? { creationVersion: options.version } : {}),
      ...(options.baseGenerationId ? { baseGenerationId: options.baseGenerationId } : {}),
      prompt: options.prompt,
      assetIds: options.assetIds,
      preferences: options.preferences,
      instruction: options.instruction?.trim() ?? '',
      poster: {
        enabled: options.posterEnabled !== false,
        variants: ['BACKGROUND', 'COMPOSED'],
      },
    },
    idempotencyKey: idempotencyKey('creation-run'),
  })
  const active: ActiveCreationRun = {
    runId: response.runId,
    eventsUrl: response.eventsUrl.replace(/^\/v1/, ''),
    snapshotUrl: response.snapshotUrl.replace(/^\/v1/, ''),
    creationId: response.creationId,
    prompt: options.prompt,
    assetIds: options.assetIds,
    assetKinds: options.assetKinds,
    preferences: options.preferences,
    posterEnabled: options.posterEnabled !== false,
    remainingQuota: response.quota?.remaining ?? null,
    lastEventId: '0-0',
    queue: response.queue,
  }
  wx.setStorageSync(STORAGE_KEYS.activeCreationRun, active)
  return active
}

export function getActiveCreationRun(): ActiveCreationRun | null {
  const value = wx.getStorageSync(STORAGE_KEYS.activeCreationRun)
  return value && typeof value === 'object'
    ? { ...value, posterEnabled: value.posterEnabled !== false } as ActiveCreationRun
    : null
}

export function updateActiveCreationCursor(lastEventId: string): void {
  const active = getActiveCreationRun()
  if (!active) return
  wx.setStorageSync(STORAGE_KEYS.activeCreationRun, { ...active, lastEventId })
}

export function clearActiveCreationRun(): void {
  wx.removeStorageSync(STORAGE_KEYS.activeCreationRun)
}

export function getSavedCreationRunDrafts(): SavedCreationRunDraft[] {
  const value = wx.getStorageSync(STORAGE_KEYS.savedCreationRunDrafts)
  if (!Array.isArray(value)) return []
  return value.filter((item): item is SavedCreationRunDraft => (
    item
    && typeof item === 'object'
    && typeof item.runId === 'string'
    && typeof item.localDraftId === 'string'
    && typeof item.localUpdatedAt === 'string'
  ))
}

export function saveCreationRunDraft(active: ActiveCreationRun): SavedCreationRunDraft {
  const localDraftId = `run-${active.runId}`
  const updated: SavedCreationRunDraft = {
    ...active,
    localDraftId,
    localUpdatedAt: new Date().toISOString(),
  }
  const drafts = getSavedCreationRunDrafts().filter((draft) => draft.runId !== active.runId)
  wx.setStorageSync(STORAGE_KEYS.savedCreationRunDrafts, [updated, ...drafts])
  return updated
}

export function activateSavedCreationRun(draft: SavedCreationRunDraft): void {
  const { localDraftId: _localDraftId, localUpdatedAt: _localUpdatedAt, ...active } = draft
  wx.setStorageSync(STORAGE_KEYS.activeCreationRun, active)
}

export function deleteSavedCreationRunDraft(runId: string): void {
  wx.setStorageSync(
    STORAGE_KEYS.savedCreationRunDrafts,
    getSavedCreationRunDrafts().filter((draft) => draft.runId !== runId),
  )
}

export function loadCreationRunSnapshot(active: ActiveCreationRun): Promise<CreationRunSnapshot> {
  return request<CreationRunSnapshot>({ path: active.snapshotUrl })
}

export function loadCreationRunSnapshotById(runId: string): Promise<CreationRunSnapshot> {
  return request<CreationRunSnapshot>({
    path: `/creation-runs/${encodeURIComponent(runId)}`,
  })
}

export async function loadCreationTimeline(runId: string): Promise<CreationTimelineEvent[]> {
  const events: CreationTimelineEvent[] = []
  let afterSeq = 0
  while (true) {
    const response = await request<CreationTimelineResponse>({
      path: `/creation-runs/${encodeURIComponent(runId)}/timeline?afterSeq=${afterSeq}&limit=500`,
    })
    events.push(...response.items)
    if (!response.hasMore || response.lastSeq <= afterSeq) return events
    afterSeq = response.lastSeq
  }
}

export async function loadCreationHistory(runId: string): Promise<CreationHistoryEntry[]> {
  const newestFirst: CreationHistoryEntry[] = []
  const visited = new Set<string>()
  let currentId: string | null = runId
  while (currentId && newestFirst.length < 20 && !visited.has(currentId)) {
    visited.add(currentId)
    const snapshot = await loadCreationRunSnapshotById(currentId)
    const events = await loadCreationTimeline(currentId)
    newestFirst.push({ snapshot, events })
    currentId = snapshot.baseGenerationId
  }
  return newestFirst.reverse()
}

export function cancelCreationRun(active: ActiveCreationRun): Promise<{
  coreStatus: string
  cancellationRequested: boolean
}> {
  return request({
    path: `/creation-runs/${active.runId}/cancel`,
    method: 'POST',
    data: {},
  })
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
    const updated = saveLocalCreationDraft(creation)
    deleteSavedCreationRunDraft(creation.generationId)
    return updated
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
  deleteSavedCreationRunDraft(creation.generationId)
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
  deleteSavedCreationRunDraft(creation.generationId)
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
  deleteSavedCreationRunDraft(creation.generationId)
  clearPendingCreation()
}

export async function discardActiveCreationRun(active: ActiveCreationRun): Promise<void> {
  try {
    await cancelCreationRun(active)
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'GENERATION_ALREADY_FINISHED') {
      throw error
    }
  }
  if (active.creationId && hasAccessToken()) {
    await request<void>({
      path: `/creations/${active.creationId}`,
      method: 'DELETE',
    })
  } else if (active.assetIds.length > 0) {
    await Promise.all(active.assetIds.map((assetId) => deleteAsset(assetId)))
  }
  deleteSavedCreationRunDraft(active.runId)
  const current = getActiveCreationRun()
  if (current?.runId === active.runId) clearActiveCreationRun()
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
  const updated = {
    ...creation,
    published: true,
    sharePublicationId: publication.id,
    ...(publication.shareImageUrl ? { shareImageUrl: publication.shareImageUrl } : {}),
  }
  savePendingCreation(updated)
  wx.setStorageSync(STORAGE_KEYS.creationNeedsReset, true)
  wx.setStorageSync(STORAGE_KEYS.communityNeedsRefresh, true)
  return publication
}

export async function prepareCreationShare(
  creation: PendingCreation,
): Promise<PublicationResponse> {
  if (!creation.workId || !creation.saved) {
    throw new ApiError('请先保存作品', 'WORK_NOT_FINALIZED')
  }
  const publication = await request<PublicationResponse>({
    path: `/works/${creation.workId}/publications`,
    method: 'POST',
    data: {
      workId: creation.workId,
      visibility: 'UNLISTED',
      acceptedCommunityRules: true,
    },
    idempotencyKey: idempotencyKey('share-poem'),
  })
  if (publication.status !== 'PUBLISHED') {
    throw new ApiError('作品正在审核，审核通过后即可分享', 'PUBLICATION_NOT_SHAREABLE', 409)
  }
  savePendingCreation({
    ...creation,
    sharePublicationId: publication.id,
    ...(publication.shareImageUrl ? { shareImageUrl: publication.shareImageUrl } : {}),
  })
  return publication
}

export function consumeCreationReset(): boolean {
  const shouldReset = wx.getStorageSync(STORAGE_KEYS.creationNeedsReset) === true
  if (shouldReset) {
    wx.removeStorageSync(STORAGE_KEYS.creationNeedsReset)
  }
  return shouldReset
}

export function requestCreationReset(): void {
  wx.setStorageSync(STORAGE_KEYS.creationNeedsReset, true)
}
