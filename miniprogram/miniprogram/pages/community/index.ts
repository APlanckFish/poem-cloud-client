import {
  type CommunityPublication,
  consumeCommunityRefresh,
  loadCommunityFeed,
} from '../../services/community'
import { loadPoemTaxonomies, type PoemCategory } from '../../services/creation'
import { showErrorToast } from '../../utils/error'

interface PoemCard {
  id: string
  title: string
  excerpt: string
  category: string
  sourceCategory: PoemCategory
  tunePatternCode: string
  author: string
  authorInitial: string
  authorAvatarUrl: string
  likes: number
  likedByMe: boolean
  cover: string
}

interface TunePatternItem {
  code: string
  name: string
  aliases: string[]
}

interface ValueChangeEvent {
  detail: {
    value: string
  }
}

interface FeedScrollEvent {
  detail: {
    scrollTop: number
  }
}

interface CommunityScrollViewContext {
  triggerRefresh(options?: { duration?: number }): void
  closeRefresh(): void
  scrollTo(options: {
    top?: number
    left?: number
    duration?: number
    animated?: boolean
  }): void
}

interface TabBarInstance {
  setData(data: { selected: number; skylineMode: boolean }): void
}

type GetTabBar = (
  callback?: (tabBar: TabBarInstance) => void,
) => TabBarInstance | undefined

const CLASSICAL_FORM_NAMES: Record<string, string> = {
  WUYAN_JUEJU: '五言绝句',
  QIYAN_JUEJU: '七言绝句',
  WUYAN_LVSHI: '五言律诗',
  QIYAN_LVSHI: '七言律诗',
  DAYOU_SHI: '打油诗',
}

const TOP_REFRESH_THRESHOLD_PX = 12
const REFRESH_REVEAL_DURATION_MS = 280
let communityScrollTop = 0
let communityScrollContext: CommunityScrollViewContext | null = null

function tunePatternNameMap(patterns: TunePatternItem[]): Record<string, string> {
  return Object.fromEntries(
    patterns
      .filter((pattern) => pattern.code !== 'ALL')
      .map((pattern) => [pattern.code, pattern.name]),
  )
}

function categoryName(
  publication: CommunityPublication,
  tunePatternNames: Record<string, string>,
): string {
  if (publication.category === 'CLASSICAL') {
    return CLASSICAL_FORM_NAMES[publication.classicalFormCode || ''] || '古体诗'
  }
  if (publication.category === 'MODERN') return '现代诗'
  return tunePatternNames[publication.tunePatternCode || ''] || '词'
}

function fallbackCover(category: PoemCategory): string {
  if (category === 'MODERN') return '/assets/images/cover-alley.jpg'
  if (category === 'CI') return '/assets/images/cover-sunrise.jpg'
  return '/assets/images/cover-mountain.jpg'
}

function normalizePoemContent(value: string): string {
  return value.replace(/\\n/g, '\n').replace(/\r\n?/g, '\n')
}

function formatCardPoemContent(value: string, category: PoemCategory): string {
  const normalized = normalizePoemContent(value).trim()
  if (category === 'MODERN') return normalized
  return normalized
    .split(/\n\s*\n/)
    .map((stanza) =>
      stanza
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join('')
        .replace(/([。！？!?][”’》」』】]*)(?!$)/g, '$1\n'),
    )
    .join('\n\n')
}

function normalizeTuneSearch(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '')
}

function matchesTuneSearch(item: TunePatternItem, query: string): boolean {
  return [item.name, ...item.aliases].some((candidate) =>
    normalizeTuneSearch(candidate).includes(query),
  )
}

function toCard(
  publication: CommunityPublication,
  tunePatternNames: Record<string, string>,
): PoemCard {
  return {
    id: publication.id,
    title: publication.title,
    excerpt: formatCardPoemContent(publication.content, publication.category),
    category: categoryName(publication, tunePatternNames),
    sourceCategory: publication.category,
    tunePatternCode: publication.tunePatternCode || '',
    author: publication.author.nickname,
    authorInitial: publication.author.nickname.slice(0, 1) || '诗',
    authorAvatarUrl: publication.author.avatarUrl || '',
    likes: publication.likeCount,
    likedByMe: publication.likedByMe,
    cover:
      publication.displayCoverUrl ||
      publication.coverUrl ||
      fallbackCover(publication.category),
  }
}

function shuffleItems<T>(items: T[]): T[] {
  const shuffled = [...items]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1))
    const current = shuffled[index]
    shuffled[index] = shuffled[target] as T
    shuffled[target] = current as T
  }
  return shuffled
}

function gridGapsForWindow(): {
  gridCrossAxisGap: number
  gridMainAxisGap: number
  gridPadding: number[]
} {
  const windowInfo = wx.getSystemInfoSync()
  const windowWidth = windowInfo.windowWidth
  const crossAxisGapRpx = windowWidth >= 430 ? 18 : 14
  const horizontalPaddingRpx = windowWidth >= 430 ? 28 : 24
  const toPx = (rpx: number) => Number(((rpx * windowWidth) / 750).toFixed(2))
  const safeAreaBottom = windowInfo.safeArea
    ? Math.max(0, windowInfo.screenHeight - windowInfo.safeArea.bottom)
    : 0
  return {
    gridCrossAxisGap: toPx(crossAxisGapRpx),
    gridMainAxisGap: toPx(16),
    gridPadding: [
      toPx(18),
      toPx(horizontalPaddingRpx),
      toPx(142) + safeAreaBottom,
      toPx(horizontalPaddingRpx),
    ],
  }
}

Page({
  data: {
    activeCategory: 'ALL',
    activeClassicalForm: 'ALL',
    selectedTuneIndex: 0,
    pendingTuneCode: 'ALL',
    selectedTuneName: '全部词牌',
    tuneSearch: '',
    showTunePicker: false,
    isLoading: false,
    isRefreshing: false,
    hasLoaded: false,
    hasAppeared: false,
    tabs: [
      { code: 'ALL', name: '全部' },
      { code: 'CLASSICAL', name: '古体诗' },
      { code: 'MODERN', name: '现代诗' },
      { code: 'CI', name: '词' },
    ],
    classicalForms: [
      { code: 'ALL', name: '全部' },
      { code: 'WUYAN_JUEJU', name: '五言绝句' },
      { code: 'QIYAN_JUEJU', name: '七言绝句' },
      { code: 'WUYAN_LVSHI', name: '五言律诗' },
      { code: 'QIYAN_LVSHI', name: '七言律诗' },
      { code: 'DAYOU_SHI', name: '打油诗' },
    ],
    tunePatterns: [{ code: 'ALL', name: '全部词牌', aliases: [] }] as TunePatternItem[],
    visibleTunePatterns: [{ code: 'ALL', name: '全部词牌', aliases: [] }] as TunePatternItem[],
    poems: [] as PoemCard[],
    nextCursor: null as string | null,
    ...gridGapsForWindow(),
  },

  onLoad() {
    communityScrollTop = 0
    communityScrollContext = null
    void loadPoemTaxonomies()
      .then((taxonomies) => {
        const ci = taxonomies.categories.find((category) => category.code === 'CI')
        const tunePatterns = [
          { code: 'ALL', name: '全部词牌', aliases: [] },
          ...(ci?.tunePatterns || []).map((pattern) => ({
            ...pattern,
            aliases: Array.isArray(pattern.aliases) ? pattern.aliases : [],
          })),
        ]
        const tunePatternNames = tunePatternNameMap(tunePatterns)
        const poems = this.data.poems.map((poem) =>
          poem.sourceCategory === 'CI'
            ? {
                ...poem,
                category: tunePatternNames[poem.tunePatternCode] || '词',
              }
            : poem,
        )
        this.setData({ tunePatterns, visibleTunePatterns: tunePatterns, poems })
      })
      .catch(() => undefined)
  },

  onShow() {
    const selectCommunityTab = (tabBar: TabBarInstance) => {
      tabBar.setData({ selected: 1, skylineMode: true })
    }
    const getTabBar = this.getTabBar as unknown as GetTabBar
    const tabBar = getTabBar.call(this, selectCommunityTab)
    if (tabBar) {
      selectCommunityTab(tabBar)
    }

    if (!this.data.hasAppeared) {
      this.setData({ hasAppeared: true })
      consumeCommunityRefresh()
      void this.refreshFeed(false, false)
      return
    }

    if (communityScrollTop > TOP_REFRESH_THRESHOLD_PX) return
    consumeCommunityRefresh()
    wx.nextTick(() => {
      void this.refreshFeedWithIndicator(false, true)
    })
  },

  onUnload() {
    communityScrollTop = 0
    communityScrollContext = null
  },

  onResize() {
    this.setData(gridGapsForWindow())
  },

  async refreshFeed(showError: boolean, append: boolean) {
    if (this.data.isLoading) return
    this.setData({ isLoading: true })
    try {
      const category =
        this.data.activeCategory === 'ALL'
          ? undefined
          : (this.data.activeCategory as PoemCategory)
      const selectedTune = this.data.tunePatterns[this.data.selectedTuneIndex]
      const feed = await loadCommunityFeed({
        category,
        ...(category === 'CLASSICAL' && this.data.activeClassicalForm !== 'ALL'
          ? { classicalFormCode: this.data.activeClassicalForm }
          : {}),
        ...(category === 'CI' && selectedTune && selectedTune.code !== 'ALL'
          ? { tunePatternCode: selectedTune.code }
          : {}),
        ...(append && this.data.nextCursor ? { cursor: this.data.nextCursor } : {}),
      })
      const tunePatternNames = tunePatternNameMap(this.data.tunePatterns)
      const incoming = shuffleItems(feed.items).map((publication) =>
        toCard(publication, tunePatternNames),
      )
      const poems = append
        ? [
            ...this.data.poems,
            ...incoming.filter(
              (poem) => !this.data.poems.some((existing) => existing.id === poem.id),
            ),
          ]
        : incoming
      this.setData({
        poems,
        nextCursor: feed.nextCursor,
        hasLoaded: true,
      })
    } catch (error) {
      if (showError || !this.data.hasLoaded) {
        showErrorToast(error, { fallback: '诗词圈加载失败' })
      }
      this.setData({ hasLoaded: true })
    } finally {
      this.setData({ isLoading: false })
    }
  },

  getFeedScrollContext(): Promise<CommunityScrollViewContext | null> {
    if (communityScrollContext) return Promise.resolve(communityScrollContext)
    return new Promise((resolve) => {
      wx.createSelectorQuery()
        .in(this)
        .select('#community-feed-scroll')
        .node((result) => {
          const node = result?.node as unknown as CommunityScrollViewContext | undefined
          communityScrollContext = node || null
          resolve(communityScrollContext)
        })
        .exec()
    })
  },

  async refreshFeedWithIndicator(showError: boolean, reveal = false) {
    if (this.data.isRefreshing || this.data.isLoading) return
    this.setData({ isRefreshing: true })
    const scrollContext = await this.getFeedScrollContext()
    if (reveal) {
      scrollContext?.triggerRefresh({ duration: REFRESH_REVEAL_DURATION_MS })
      await new Promise<void>((resolve) =>
        setTimeout(resolve, REFRESH_REVEAL_DURATION_MS),
      )
    }
    try {
      await this.refreshFeed(showError, false)
    } finally {
      scrollContext?.closeRefresh()
      this.setData({ isRefreshing: false })
    }
  },

  handlePullRefresh() {
    void this.refreshFeedWithIndicator(true)
  },

  handleFeedScroll(event: FeedScrollEvent) {
    communityScrollTop = Math.max(0, Number(event.detail.scrollTop) || 0)
  },

  async handleCommunityTabRetap() {
    const scrollContext = await this.getFeedScrollContext()
    scrollContext?.scrollTo({
      top: 0,
      duration: 300,
      animated: true,
    })
  },

  selectCategory(event: WechatMiniprogram.TouchEvent) {
    const category = String(event.currentTarget.dataset.code)
    if (category === this.data.activeCategory) return
    this.setData({
      activeCategory: category,
      activeClassicalForm: 'ALL',
      selectedTuneIndex: 0,
      pendingTuneCode: 'ALL',
      selectedTuneName: '全部词牌',
      tuneSearch: '',
      poems: [],
      nextCursor: null,
      hasLoaded: false,
    })
    void this.refreshFeed(true, false)
  },

  selectClassicalForm(event: WechatMiniprogram.TouchEvent) {
    const code = String(event.currentTarget.dataset.code)
    if (code === this.data.activeClassicalForm) return
    this.setData({
      activeClassicalForm: code,
      poems: [],
      nextCursor: null,
      hasLoaded: false,
    })
    void this.refreshFeed(true, false)
  },

  openTunePicker() {
    const selected = this.data.tunePatterns[this.data.selectedTuneIndex]
    this.setData({
      showTunePicker: true,
      pendingTuneCode: selected?.code || 'ALL',
      tuneSearch: '',
      visibleTunePatterns: this.data.tunePatterns,
    })
  },

  closeTunePicker() {
    this.setData({ showTunePicker: false, tuneSearch: '' })
  },

  preventMove() {},

  handleTuneSearch(event: ValueChangeEvent) {
    const tuneSearch = event.detail.value.trim()
    const normalized = normalizeTuneSearch(tuneSearch)
    this.setData({
      tuneSearch,
      visibleTunePatterns: normalized
        ? this.data.tunePatterns.filter((item) => matchesTuneSearch(item, normalized))
        : this.data.tunePatterns,
    })
  },

  selectPendingTune(event: WechatMiniprogram.TouchEvent) {
    this.setData({ pendingTuneCode: String(event.currentTarget.dataset.code) })
  },

  resetTunePicker() {
    this.setData({
      pendingTuneCode: 'ALL',
      tuneSearch: '',
      visibleTunePatterns: this.data.tunePatterns,
    })
  },

  confirmTunePicker() {
    const selectedTuneIndex = Math.max(
      0,
      this.data.tunePatterns.findIndex((item) => item.code === this.data.pendingTuneCode),
    )
    const selectedTune = this.data.tunePatterns[selectedTuneIndex]
    this.setData({
      selectedTuneIndex,
      selectedTuneName: selectedTune?.name || '全部词牌',
      showTunePicker: false,
      poems: [],
      nextCursor: null,
      hasLoaded: false,
    })
    void this.refreshFeed(true, false)
  },

  loadMore() {
    if (!this.data.nextCursor || this.data.isLoading) return
    void this.refreshFeed(true, true)
  },

  openPoem(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id)
    if (!id) return
    wx.navigateTo({
      url: `/pages/publication-detail/index?id=${encodeURIComponent(id)}`,
    })
  },
})
