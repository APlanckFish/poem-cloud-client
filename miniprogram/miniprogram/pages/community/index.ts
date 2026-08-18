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

interface MeasuredCardRect {
  height: number
  dataset?: {
    cardId?: string
  }
}

const CLASSICAL_FORM_NAMES: Record<string, string> = {
  WUYAN_JUEJU: '五言绝句',
  QIYAN_JUEJU: '七言绝句',
  WUYAN_LVSHI: '五言律诗',
  QIYAN_LVSHI: '七言律诗',
  DAYOU_SHI: '打油诗',
}

const measuredCardHeights = new Map<string, number>()
const CARD_COLUMN_GAP_RPX = 16
const CARD_FIXED_HEIGHT_RPX = 456
const EXCERPT_LINE_HEIGHT_RPX = 39.2
const EXCERPT_MAX_LINES = 4
const EXCERPT_UNITS_PER_LINE = 13

function categoryName(publication: CommunityPublication): string {
  if (publication.category === 'CLASSICAL') {
    return CLASSICAL_FORM_NAMES[publication.classicalFormCode || ''] || '古体诗'
  }
  if (publication.category === 'MODERN') return '现代诗'
  return '词'
}

function fallbackCover(category: PoemCategory): string {
  if (category === 'MODERN') return '/assets/images/cover-alley.jpg'
  if (category === 'CI') return '/assets/images/cover-sunrise.jpg'
  return '/assets/images/cover-mountain.jpg'
}

function normalizePoemContent(value: string): string {
  return value.replace(/\\n/g, '\n').replace(/\r\n?/g, '\n')
}

function normalizeTuneSearch(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '')
}

function matchesTuneSearch(item: TunePatternItem, query: string): boolean {
  return [item.name, ...item.aliases].some((candidate) =>
    normalizeTuneSearch(candidate).includes(query),
  )
}

function toCard(publication: CommunityPublication): PoemCard {
  return {
    id: publication.id,
    title: publication.title,
    excerpt: normalizePoemContent(publication.content).replace(/\n+/g, ' ').trim(),
    category: categoryName(publication),
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

function excerptDisplayUnits(value: string): number {
  return Array.from(value).reduce((units, character) => {
    if (/\s/.test(character)) return units + 0.45
    if (character.charCodeAt(0) <= 0xff) return units + 0.58
    return units + 1
  }, 0)
}

function estimateCardHeightRpx(poem: PoemCard): number {
  const excerptLines = Math.min(
    EXCERPT_MAX_LINES,
    Math.max(1, Math.ceil(excerptDisplayUnits(poem.excerpt) / EXCERPT_UNITS_PER_LINE)),
  )
  return CARD_FIXED_HEIGHT_RPX + excerptLines * EXCERPT_LINE_HEIGHT_RPX
}

function currentRpxScale(): number {
  return wx.getSystemInfoSync().windowWidth / 750
}

function splitColumns(poems: PoemCard[]): { left: PoemCard[]; right: PoemCard[] } {
  const scale = currentRpxScale()
  const gap = CARD_COLUMN_GAP_RPX * scale
  const columns = { left: [] as PoemCard[], right: [] as PoemCard[] }
  let leftHeight = 0
  let rightHeight = 0

  poems.forEach((poem) => {
    const cardHeight =
      measuredCardHeights.get(poem.id) ?? estimateCardHeightRpx(poem) * scale
    if (leftHeight <= rightHeight) {
      columns.left.push(poem)
      leftHeight += cardHeight + gap
      return
    }
    columns.right.push(poem)
    rightHeight += cardHeight + gap
  })

  return columns
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
    leftColumn: [] as PoemCard[],
    rightColumn: [] as PoemCard[],
    nextCursor: null as string | null,
  },

  onLoad() {
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
        this.setData({ tunePatterns, visibleTunePatterns: tunePatterns })
      })
      .catch(() => undefined)
  },

  measureAndBalanceColumns(poems: PoemCard[]): Promise<void> {
    if (poems.length < 2) return Promise.resolve()

    return new Promise((resolve) => {
      wx.nextTick(() => {
        wx.createSelectorQuery()
          .in(this)
          .selectAll('.poem-card')
          .boundingClientRect((result) => {
            const rects = (
              Array.isArray(result) ? result : result ? [result] : []
            ) as MeasuredCardRect[]
            rects.forEach((rect) => {
              const cardId = rect.dataset?.cardId
              if (cardId && rect.height > 0) {
                measuredCardHeights.set(cardId, rect.height)
              }
            })

            const isCurrentFeed =
              this.data.poems.length === poems.length &&
              poems.every((poem, index) => this.data.poems[index]?.id === poem.id)
            if (!isCurrentFeed) {
              resolve()
              return
            }

            const columns = splitColumns(poems)
            this.setData(
              {
                leftColumn: columns.left,
                rightColumn: columns.right,
              },
              () => resolve(),
            )
          })
          .exec()
      })
    })
  },

  onShow() {
    const tabBar = this.getTabBar()
    if (tabBar) {
      tabBar.setData({ selected: 1 })
    }
    consumeCommunityRefresh()
    void this.refreshFeed(false, false)
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
      const incoming = shuffleItems(feed.items).map(toCard)
      const poems = append
        ? [
            ...this.data.poems,
            ...incoming.filter(
              (poem) => !this.data.poems.some((existing) => existing.id === poem.id),
            ),
          ]
        : incoming
      const columns = splitColumns(poems)
      this.setData({
        poems,
        leftColumn: columns.left,
        rightColumn: columns.right,
        nextCursor: feed.nextCursor,
        hasLoaded: true,
      })
      await this.measureAndBalanceColumns(poems)
    } catch (error) {
      if (showError || !this.data.hasLoaded) {
        showErrorToast(error, { fallback: '诗词圈加载失败' })
      }
      this.setData({ hasLoaded: true })
    } finally {
      this.setData({ isLoading: false })
    }
  },

  handlePullRefresh() {
    if (this.data.isRefreshing) return
    if (this.data.isLoading) {
      this.setData({ isRefreshing: false })
      return
    }

    this.setData({ isRefreshing: true })
    void this.refreshFeed(true, false).finally(() => {
      this.setData({ isRefreshing: false })
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
      leftColumn: [],
      rightColumn: [],
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
      leftColumn: [],
      rightColumn: [],
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
      leftColumn: [],
      rightColumn: [],
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
