import { ApiError, hasAccessToken } from '../../services/api'
import { deleteAsset } from '../../services/assets'
import {
  activateSavedCreationRun,
  deleteLocalCreationDraft,
  discardActiveCreationRun,
  getActiveCreationRun,
  getLocalCreationDrafts,
  getSavedCreationRunDrafts,
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
}

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

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : '草稿加载失败，请稍后重试'
}

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
  }
}

function toRunDraftCard(
  draft: ReturnType<typeof getSavedCreationRunDrafts>[number],
  index: number,
  tunePatternNames: TunePatternNames,
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
  }
}

Page({
  data: {
    drafts: [] as DraftCard[],
    pendingDelete: null as DraftCard | null,
    isLoading: false,
    hasLoaded: false,
    isDeleting: false,
    continuingDraftId: '',
  },

  onLoad() {
    const info = wx.getSystemInfoSync()
    deleteActionWidth = info.windowWidth * 132 / 750
  },

  onShow() {
    void this.loadDrafts()
  },

  async loadDrafts() {
    if (this.data.isLoading) return
    this.setData({ isLoading: true })
    try {
      const [response, tunePatternNames] = await Promise.all([
        hasAccessToken()
          ? loadMyDrafts()
          : Promise.resolve({ items: [], nextCursor: null }),
        loadTunePatternNames().catch(() => ({})),
      ])
      const localDrafts = getLocalCreationDrafts()
      const completedGenerationIds = new Set(localDrafts.map((draft) => draft.generationId))
      const runDrafts = getSavedCreationRunDrafts().filter(
        (draft) => !draft.creationId && !completedGenerationIds.has(draft.runId),
      )
      serverDrafts = new Map(response.items.map((work) => [work.id, work]))
      this.setData({
        drafts: [
          ...runDrafts.map((draft, index) => toRunDraftCard(draft, index, tunePatternNames)),
          ...localDrafts.map((draft, index) => (
            toLocalCard(draft, index + runDrafts.length, tunePatternNames)
          )),
          ...response.items.map((work, index) => (
            toCard(work, index + runDrafts.length + localDrafts.length, tunePatternNames)
          )),
        ],
        hasLoaded: true,
      })
    } catch (error) {
      this.setData({ hasLoaded: true })
      wx.showToast({ title: errorMessage(error), icon: 'none', duration: 2600 })
    } finally {
      this.setData({ isLoading: false })
    }
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
      wx.showToast({ title: errorMessage(error), icon: 'none' })
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
      lengthHint: null,
    }
    if (work.latestGeneration?.result) {
      savePendingCreation({
        prompt: work.prompt,
        assetIds: work.assetIds || [],
        assetKinds: (work.assets || []).map((asset) => asset.kind),
        preferences,
        generationId: work.latestGeneration.id,
        workId: work.id,
        result: work.latestGeneration.result,
        remainingQuota: null,
        draftSaved: true,
        saved: false,
        published: false,
      })
      wx.navigateTo({
        url: `/pages/creating/index?generationId=${encodeURIComponent(work.latestGeneration.id)}&mode=draft`,
      })
      return
    }
    this.setData({ continuingDraftId: id })
    wx.showLoading({ title: '正在继续创作', mask: true })
    try {
      const run = await startCreationRun({
        prompt: work.prompt,
        assetIds: work.assetIds || [],
        assetKinds: (work.assets || []).map((asset) => asset.kind),
        preferences,
        workId: work.id,
        version: work.version,
      })
      wx.navigateTo({
        url: `/pages/creating/index?runId=${encodeURIComponent(run.runId)}&fromDraft=1`,
      })
    } catch (error) {
      wx.showToast({ title: errorMessage(error), icon: 'none', duration: 2600 })
    } finally {
      wx.hideLoading()
      this.setData({ continuingDraftId: '' })
    }
  },

  startCreating() {
    wx.switchTab({ url: '/pages/create/index' })
  },
})
