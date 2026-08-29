import { hasAccessToken } from '../../services/api'
import { deleteAsset } from '../../services/assets'
import {
  activateCreationRun,
  activateSavedCreationRun,
  deleteLocalCreationDraft,
  discardActiveCreationRun,
  getActiveCreationRun,
  getLocalCreationDrafts,
  getSavedCreationRunDrafts,
  loadCreationRunSnapshotById,
  type LocalCreationDraft,
  type PendingCreation,
  savePendingCreation,
  startCreationRun,
} from '../../services/creation'
import type { LibraryWork } from '../../services/library'
import {
  deleteLibraryWork,
  describeWorkType,
  loadMyDrafts,
  loadTunePatternNames,
  type TunePatternNames,
} from '../../services/library'
import { loadCreationPreferences } from '../../services/preferences'
import { showErrorToast } from '../../utils/error'

interface DraftCard {
  id: string
  title: string
  editedAt: string
  description: string
  cover: string
  imageCount: number
  videoCount: number
  offset: number
  isLocal: boolean
  resumeRunId: string | null
  actionLabel: '查看详情' | '继续创作'
}

const ACTIVE_GENERATION_STATUSES = new Set([
  'QUEUED',
  'ANALYZING_MATERIALS',
  'RETRIEVING_KNOWLEDGE',
  'GENERATING',
])

const COVERS = [
  '/assets/images/cover-ridge.jpg',
  '/assets/images/cover-sunrise.jpg',
  '/assets/images/cover-mountain.jpg',
  '/assets/images/cover-alley.jpg',
]

let touchStartX = 0
let touchStartY = 0
let touchingDraftId = ''
let deleteActionWidth = 72
let serverDrafts = new Map<string, LibraryWork>()

function draftTitle(work: LibraryWork): string {
  const generatedTitle = work.latestGeneration?.result?.title
  if (work.title?.trim()) return work.title.trim()
  if (generatedTitle?.trim()) return generatedTitle.trim()
  const prompt = work.prompt.trim()
  if (!prompt) return '未命名草稿'
  return prompt.length > 12 ? `${prompt.slice(0, 12)}…` : prompt
}

function editedLabel(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  if (target === today) return time
  if (today - target === 86400000) return `昨天 ${time}`
  return `${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
}

function toCard(work: LibraryWork, index: number, tunePatternNames: TunePatternNames): DraftCard {
  const assets = work.assets || []
  const knownImages = assets.filter((asset) => asset.kind === 'IMAGE').length
  const knownVideos = assets.filter((asset) => asset.kind === 'VIDEO').length
  const unknownAssetCount = assets.length === 0 ? work.assetIds?.length || 0 : 0
  return {
    id: work.id,
    title: draftTitle(work),
    editedAt: editedLabel(work.latestActivityAt || work.updatedAt),
    description: describeWorkType(work, tunePatternNames),
    cover:
      assets.find((asset) => asset.kind === 'IMAGE' && asset.accessUrl)?.accessUrl ||
      assets.find((asset) => asset.kind === 'VIDEO' && asset.thumbnailUrl)?.thumbnailUrl ||
      COVERS[index % COVERS.length],
    imageCount: knownImages + unknownAssetCount,
    videoCount: knownVideos,
    offset: 0,
    isLocal: false,
    resumeRunId: null,
    actionLabel: ACTIVE_GENERATION_STATUSES.has(work.latestGeneration?.status || '')
      ? '查看详情'
      : '继续创作',
  }
}

function toLocalCard(
  draft: LocalCreationDraft,
  index: number,
  tunePatternNames: TunePatternNames,
): DraftCard {
  return {
    id: draft.localDraftId,
    title: draft.result.title || '未命名草稿',
    editedAt: editedLabel(draft.localUpdatedAt),
    description: describeWorkType({
      category: draft.preferences.category,
      classicalFormCode: draft.preferences.classicalFormCode,
      tunePatternCode: draft.preferences.tunePatternCode,
      preferences: draft.preferences,
    }, tunePatternNames),
    cover: COVERS[index % COVERS.length],
    imageCount: (draft.assetKinds || []).filter((kind) => kind === 'IMAGE').length,
    videoCount: (draft.assetKinds || []).filter((kind) => kind === 'VIDEO').length,
    offset: 0,
    isLocal: true,
    resumeRunId: null,
    actionLabel: '继续创作',
  }
}

function toRunDraftCard(
  draft: ReturnType<typeof getSavedCreationRunDrafts>[number],
  index: number,
  tunePatternNames: TunePatternNames,
  status = 'QUEUED',
): DraftCard {
  const prompt = draft.prompt.trim()
  return {
    id: draft.localDraftId,
    title: prompt ? (prompt.length > 12 ? `${prompt.slice(0, 12)}…` : prompt) : '未命名草稿',
    editedAt: editedLabel(draft.localUpdatedAt),
    description: describeWorkType({
      category: draft.preferences.category,
      classicalFormCode: draft.preferences.classicalFormCode,
      tunePatternCode: draft.preferences.tunePatternCode,
      preferences: draft.preferences,
    }, tunePatternNames),
    cover: COVERS[index % COVERS.length],
    imageCount: draft.assetKinds.filter((kind) => kind === 'IMAGE').length,
    videoCount: draft.assetKinds.filter((kind) => kind === 'VIDEO').length,
    offset: 0,
    isLocal: true,
    resumeRunId: draft.runId,
    actionLabel: ACTIVE_GENERATION_STATUSES.has(status) ? '查看详情' : '继续创作',
  }
}

Page({
  data: {
    drafts: [] as DraftCard[],
    pendingDelete: null as DraftCard | null,
    isLoading: false,
    hasLoaded: false,
    nextCursor: null as string | null,
    isDeleting: false,
    continuingDraftId: '',
  },

  onLoad() {
    const info = wx.getSystemInfoSync()
    deleteActionWidth = info.windowWidth * 132 / 750
  },

  onShow() {
    void this.loadDrafts(true)
  },

  async loadDrafts(reset = true) {
    if (this.data.isLoading || (!reset && !this.data.nextCursor)) return
    this.setData({ isLoading: true })
    try {
      const [response, tunePatternNames] = await Promise.all([
        hasAccessToken()
          ? loadMyDrafts(reset ? undefined : this.data.nextCursor || undefined)
          : Promise.resolve({ items: [], nextCursor: null }),
        loadTunePatternNames().catch(() => ({})),
      ])
      const localDrafts = reset ? getLocalCreationDrafts() : []
      const completedGenerationIds = new Set(localDrafts.map((draft) => draft.generationId))
      const runDrafts = reset
        ? getSavedCreationRunDrafts().filter(
            (draft) => !draft.creationId && !completedGenerationIds.has(draft.runId),
          )
        : []
      const runStatuses = new Map(
        await Promise.all(
          runDrafts.map(async (draft) => {
            const snapshot = await loadCreationRunSnapshotById(draft.runId).catch(() => null)
            return [draft.runId, snapshot?.coreStatus || 'QUEUED'] as const
          }),
        ),
      )
      if (reset) serverDrafts = new Map()
      response.items.forEach((work) => serverDrafts.set(work.id, work))
      const localCards = [
        ...runDrafts.map((draft, index) => (
          toRunDraftCard(draft, index, tunePatternNames, runStatuses.get(draft.runId))
        )),
        ...localDrafts.map((draft, index) => (
          toLocalCard(draft, index + runDrafts.length, tunePatternNames)
        )),
      ]
      const remoteOffset = reset ? localCards.length : this.data.drafts.length
      const remoteCards = response.items.map((work, index) => (
        toCard(work, remoteOffset + index, tunePatternNames)
      ))
      this.setData({
        drafts: reset ? [...localCards, ...remoteCards] : [...this.data.drafts, ...remoteCards],
        nextCursor: response.nextCursor,
        hasLoaded: true,
      })
    } catch (error) {
      this.setData({ hasLoaded: true })
      showErrorToast(error, { fallback: '草稿加载失败，请稍后重试' })
    } finally {
      this.setData({ isLoading: false })
    }
  },

  loadMore() {
    void this.loadDrafts(false)
  },

  closeSwipes(exceptId = '') {
    this.setData({
      drafts: this.data.drafts.map((draft) => ({
        ...draft,
        offset: draft.id === exceptId ? draft.offset : 0,
      })),
    })
  },

  handleTouchStart(event: WechatMiniprogram.TouchEvent) {
    const touch = event.touches[0]
    if (!touch) return
    touchingDraftId = String(event.currentTarget.dataset.id)
    touchStartX = touch.clientX
    touchStartY = touch.clientY
    this.closeSwipes(touchingDraftId)
  },

  handleTouchMove(event: WechatMiniprogram.TouchEvent) {
    const touch = event.touches[0]
    if (!touch || !touchingDraftId) return
    const deltaX = touch.clientX - touchStartX
    const deltaY = touch.clientY - touchStartY
    if (Math.abs(deltaX) <= Math.abs(deltaY)) return
    const offset = Math.max(-deleteActionWidth, Math.min(0, deltaX))
    this.setData({
      drafts: this.data.drafts.map((draft) => (
        draft.id === touchingDraftId ? { ...draft, offset } : draft
      )),
    })
  },

  handleTouchEnd() {
    if (!touchingDraftId) return
    const draft = this.data.drafts.find((item) => item.id === touchingDraftId)
    const shouldOpen = Boolean(draft && draft.offset < -deleteActionWidth * 0.42)
    this.setData({
      drafts: this.data.drafts.map((item) => (
        item.id === touchingDraftId
          ? { ...item, offset: shouldOpen ? -deleteActionWidth : 0 }
          : item
      )),
    })
    touchingDraftId = ''
  },

  openDeleteConfirm(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id)
    const pendingDelete = this.data.drafts.find((draft) => draft.id === id) || null
    this.setData({ pendingDelete })
  },

  closeDeleteConfirm() {
    if (!this.data.isDeleting) {
      this.setData({ pendingDelete: null })
      this.closeSwipes()
    }
  },

  preventMove() {},

  async confirmDelete() {
    const draft = this.data.pendingDelete
    if (!draft || this.data.isDeleting) return
    this.setData({ isDeleting: true })
    wx.showLoading({ title: '正在删除', mask: true })
    try {
      const savedRun = getSavedCreationRunDrafts().find(
        (item) => item.localDraftId === draft.id || item.creationId === draft.id,
      )
      if (savedRun) {
        await discardActiveCreationRun(savedRun)
      } else if (draft.isLocal) {
        const localDrafts = getLocalCreationDrafts()
        const source = localDrafts.find((item) => item.localDraftId === draft.id)
        const retainedAssetIds = new Set(
          localDrafts
            .filter((item) => item.localDraftId !== draft.id)
            .flatMap((item) => item.assetIds),
        )
        if (source) {
          await Promise.all(
            source.assetIds
              .filter((assetId) => !retainedAssetIds.has(assetId))
              .map((assetId) => deleteAsset(assetId)),
          )
        }
        deleteLocalCreationDraft(draft.id)
      } else {
        await deleteLibraryWork(draft.id)
      }
      this.setData({
        drafts: this.data.drafts.filter((item) => item.id !== draft.id),
        pendingDelete: null,
      })
      wx.showToast({ title: '草稿已删除', icon: 'none' })
    } catch (error) {
      showErrorToast(error, { fallback: '草稿删除失败，请稍后重试' })
    } finally {
      wx.hideLoading()
      this.setData({ isDeleting: false })
    }
  },

  async continueDraft(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id)
    if (!id || this.data.continuingDraftId) return
    this.closeSwipes()
    const savedRun = getSavedCreationRunDrafts().find(
      (draft) => draft.localDraftId === id || draft.creationId === id,
    )
    if (savedRun) {
      activateSavedCreationRun(savedRun)
      wx.navigateTo({
        url: `/pages/creating/index?runId=${encodeURIComponent(savedRun.runId)}&fromDraft=1`,
      })
      return
    }
    const currentRun = getActiveCreationRun()
    if (currentRun?.creationId === id) {
      wx.navigateTo({
        url: `/pages/creating/index?runId=${encodeURIComponent(currentRun.runId)}&fromDraft=1`,
      })
      return
    }
    const localDraft = getLocalCreationDrafts().find((draft) => draft.localDraftId === id)
    if (localDraft) {
      savePendingCreation(localDraft)
      wx.navigateTo({
        url: `/pages/creating/index?generationId=${encodeURIComponent(localDraft.generationId)}&mode=draft`,
      })
      return
    }
    const work = serverDrafts.get(id)
    if (!work) {
      wx.showToast({ title: '草稿数据已更新，请刷新后重试', icon: 'none' })
      return
    }
    const preferences = work.preferences || {
      category: work.category,
      classicalFormCode: work.classicalFormCode as PendingCreation['preferences']['classicalFormCode'],
      tunePatternCode: work.tunePatternCode,
      rhymeScheme: 'NEW_CHINESE',
      preferredPoets: [],
      styleTags: [],
      themeTags: [],
      lengthHint: null,
    }
    const latest = work.latestGeneration
    if (latest && ACTIVE_GENERATION_STATUSES.has(latest.status)) {
      activateCreationRun({
        runId: latest.id,
        eventsUrl: `/creation-runs/${encodeURIComponent(latest.id)}/events`,
        snapshotUrl: `/creation-runs/${encodeURIComponent(latest.id)}`,
        creationId: work.id,
        prompt: work.prompt,
        assetIds: work.assetIds || [],
        assetKinds: (work.assets || []).map((asset) => asset.kind),
        preferences,
        posterEnabled: true,
        remainingQuota: null,
        lastEventId: '0-0',
        queue: null,
      })
      wx.navigateTo({
        url: `/pages/creating/index?runId=${encodeURIComponent(latest.id)}&fromDraft=1`,
      })
      return
    }
    if (latest?.result) {
      savePendingCreation({
        prompt: work.prompt,
        assetIds: work.assetIds || [],
        assetKinds: (work.assets || []).map((asset) => asset.kind),
        preferences,
        generationId: latest.id,
        workId: work.id,
        result: latest.result,
        remainingQuota: null,
        draftSaved: true,
        saved: false,
        published: false,
      })
      wx.navigateTo({
        url: `/pages/creating/index?generationId=${encodeURIComponent(latest.id)}&mode=draft`,
      })
      return
    }
    this.setData({ continuingDraftId: id })
    wx.showLoading({ title: '正在继续创作', mask: true })
    try {
      const preferenceState = await loadCreationPreferences().catch(() => null)
      const run = await startCreationRun({
        prompt: work.prompt,
        assetIds: work.assetIds || [],
        assetKinds: (work.assets || []).map((asset) => asset.kind),
        preferences,
        workId: work.id,
        version: work.version,
        posterEnabled:
          preferenceState?.preference?.answers.autoGeneratePoster?.[0] !== 'false',
      })
      wx.navigateTo({
        url: `/pages/creating/index?runId=${encodeURIComponent(run.runId)}&fromDraft=1`,
      })
    } catch (error) {
      showErrorToast(error, { fallback: '继续创作失败，请稍后重试' })
    } finally {
      wx.hideLoading()
      this.setData({ continuingDraftId: '' })
    }
  },

  startCreating() {
    wx.switchTab({ url: '/pages/create/index' })
  },
})
