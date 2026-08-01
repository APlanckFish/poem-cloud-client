import type { LibraryWork } from '../../services/library'
import {
  deleteLibraryWork,
  describeWorkType,
  hideLibraryWork,
  loadMyWorks,
  loadTunePatternNames,
  publishLibraryWork,
  restoreLibraryWork,
  type TunePatternNames,
} from '../../services/library'
import { showErrorToast } from '../../utils/error'

type WorkFilter = 'ALL' | 'PUBLISHED' | 'UNPUBLISHED' | 'HIDDEN'

interface WorkCard {
  id: string
  publicationId: string
  title: string
  description: string
  date: string
  cover: string
  state: Exclude<WorkFilter, 'ALL'>
  stateLabel: string
  stateClass: string
}

const COVERS = [
  '/assets/images/cover-ridge.jpg',
  '/assets/images/cover-mountain.jpg',
  '/assets/images/cover-alley.jpg',
  '/assets/images/cover-sunrise.jpg',
]

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}.${month}.${day}`
}

function workState(work: LibraryWork): Pick<WorkCard, 'state' | 'stateLabel' | 'stateClass'> {
  if (work.publication?.status === 'HIDDEN') {
    return { state: 'HIDDEN', stateLabel: '已隐藏', stateClass: 'status--hidden' }
  }
  if (
    work.publication?.status === 'PUBLISHED'
    || work.publication?.status === 'PENDING_REVIEW'
  ) {
    return { state: 'PUBLISHED', stateLabel: '已发布', stateClass: 'status--published' }
  }
  return {
    state: 'UNPUBLISHED',
    stateLabel: '仅自己可见',
    stateClass: 'status--private',
  }
}

function toCard(work: LibraryWork, index: number, tunePatternNames: TunePatternNames): WorkCard {
  const materialCover = work.assets?.find(
    (asset) => asset.kind === 'IMAGE' && asset.accessUrl,
  )?.accessUrl || work.assets?.find(
    (asset) => asset.kind === 'VIDEO' && asset.thumbnailUrl,
  )?.thumbnailUrl
  return {
    id: work.id,
    publicationId: work.publication?.id || '',
    title: work.title?.trim() || '未命名作品',
    description: describeWorkType(work, tunePatternNames),
    date: formatDate(work.latestActivityAt || work.updatedAt),
    cover: materialCover || COVERS[index % COVERS.length],
    ...workState(work),
  }
}

Page({
  data: {
    tabs: [
      { code: 'ALL', label: '全部' },
      { code: 'PUBLISHED', label: '已发布' },
      { code: 'UNPUBLISHED', label: '未发布' },
      { code: 'HIDDEN', label: '已隐藏' },
    ],
    activeFilter: 'ALL' as WorkFilter,
    allWorks: [] as WorkCard[],
    visibleWorks: [] as WorkCard[],
    actionWork: null as WorkCard | null,
    isLoading: false,
    hasLoaded: false,
    isOperating: false,
  },

  onShow() {
    void this.loadWorks()
  },

  async loadWorks() {
    if (this.data.isLoading) return
    this.setData({ isLoading: true })
    try {
      const [response, tunePatternNames] = await Promise.all([
        loadMyWorks(),
        loadTunePatternNames().catch(() => ({})),
      ])
      const allWorks = response.items.map((work, index) => (
        toCard(work, index, tunePatternNames)
      ))
      this.setData({ allWorks, hasLoaded: true })
      this.applyFilter(this.data.activeFilter, allWorks)
    } catch (error) {
      this.setData({ hasLoaded: true })
      showErrorToast(error, { fallback: '作品加载失败，请稍后重试' })
    } finally {
      this.setData({ isLoading: false })
    }
  },

  applyFilter(filter: WorkFilter, works?: WorkCard[]) {
    const source = works || this.data.allWorks
    this.setData({
      activeFilter: filter,
      visibleWorks:
        filter === 'ALL' ? source : source.filter((work) => work.state === filter),
    })
  },

  selectFilter(event: WechatMiniprogram.TouchEvent) {
    this.applyFilter(String(event.currentTarget.dataset.code) as WorkFilter)
  },

  openActions(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id)
    const actionWork = this.data.allWorks.find((work) => work.id === id) || null
    this.setData({ actionWork })
  },

  closeActions() {
    if (!this.data.isOperating) this.setData({ actionWork: null })
  },

  preventMove() {},

  viewWork() {
    const work = this.data.actionWork
    if (!work) return
    this.setData({ actionWork: null })
    if (work.publicationId && work.state === 'PUBLISHED') {
      wx.navigateTo({
        url: `/pages/publication-detail/index?id=${encodeURIComponent(work.publicationId)}`,
      })
      return
    }
    wx.navigateTo({
      url: `/pages/publication-detail/index?workId=${encodeURIComponent(work.id)}`,
    })
  },

  async publishWork() {
    const work = this.data.actionWork
    if (!work || this.data.isOperating) return
    this.setData({ isOperating: true })
    wx.showLoading({ title: '正在发布', mask: true })
    try {
      if (work.state === 'HIDDEN') {
        await restoreLibraryWork(work.id)
      } else {
        await publishLibraryWork(work.id)
      }
      this.setData({ actionWork: null })
      await this.loadWorks()
      wx.showToast({ title: '已发布到诗词圈', icon: 'success' })
    } catch (error) {
      showErrorToast(error, { fallback: '作品发布失败，请稍后重试' })
    } finally {
      wx.hideLoading()
      this.setData({ isOperating: false })
    }
  },

  async changeVisibility() {
    const work = this.data.actionWork
    if (!work || this.data.isOperating) return
    if (work.state !== 'PUBLISHED') return
    this.setData({ isOperating: true })
    wx.showLoading({ title: '正在隐藏', mask: true })
    try {
      await hideLibraryWork(work.id)
      this.setData({ actionWork: null })
      await this.loadWorks()
      wx.showToast({ title: '已设为仅自己可见', icon: 'none' })
    } catch (error) {
      showErrorToast(error, { fallback: '可见范围修改失败，请稍后重试' })
    } finally {
      wx.hideLoading()
      this.setData({ isOperating: false })
    }
  },

  confirmDelete() {
    const work = this.data.actionWork
    if (!work || this.data.isOperating) return
    wx.showModal({
      title: '删除这篇作品？',
      content: '删除后将无法恢复，请谨慎操作。',
      confirmText: '删除',
      confirmColor: '#b55145',
      success: (result) => {
        if (result.confirm) void this.deleteWork(work.id)
      },
    })
  },

  async deleteWork(id: string) {
    this.setData({ isOperating: true })
    wx.showLoading({ title: '正在删除', mask: true })
    try {
      await deleteLibraryWork(id)
      this.setData({ actionWork: null })
      await this.loadWorks()
      wx.showToast({ title: '作品已删除', icon: 'none' })
    } catch (error) {
      showErrorToast(error, { fallback: '作品删除失败，请稍后重试' })
    } finally {
      wx.hideLoading()
      this.setData({ isOperating: false })
    }
  },

  startCreating() {
    wx.switchTab({ url: '/pages/create/index' })
  },
})
