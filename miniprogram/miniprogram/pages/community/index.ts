import {
  type CommunityPublication,
  consumeCommunityRefresh,
  loadCommunityFeed,
} from '../../services/community'
import { loadPoemTaxonomies, type PoemCategory } from '../../services/creation'

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
}

interface ValueChangeEvent {
  detail: {
    value: string
  }
}

function categoryName(category: PoemCategory): string {
  if (category === 'CLASSICAL') return '古体诗'
  if (category === 'MODERN') return '现代诗'
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

function toCard(publication: CommunityPublication): PoemCard {
  return {
    id: publication.id,
    title: publication.title,
    excerpt: normalizePoemContent(publication.content).replace(/\n+/g, ' ').trim(),
    category: categoryName(publication.category),
    author: publication.author.nickname,
    authorInitial: publication.author.nickname.slice(0, 1) || '诗',
    authorAvatarUrl: publication.author.avatarUrl || '',
    likes: publication.likeCount,
    likedByMe: publication.likedByMe,
    cover: publication.coverUrl || fallbackCover(publication.category),
  }
}

function splitColumns(poems: PoemCard[]): { left: PoemCard[]; right: PoemCard[] } {
  return poems.reduce(
    (columns, poem, index) => {
      columns[index % 2 === 0 ? 'left' : 'right'].push(poem)
      return columns
    },
    { left: [] as PoemCard[], right: [] as PoemCard[] },
  )
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
    ],
    tunePatterns: [{ code: 'ALL', name: '全部词牌' }] as TunePatternItem[],
    visibleTunePatterns: [{ code: 'ALL', name: '全部词牌' }] as TunePatternItem[],
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
          { code: 'ALL', name: '全部词牌' },
          ...(ci?.tunePatterns || []),
        ]
        this.setData({ tunePatterns, visibleTunePatterns: tunePatterns })
      })
      .catch(() => undefined)
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
      const incoming = feed.items.map(toCard)
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
    } catch (error) {
      if (showError || !this.data.hasLoaded) {
        wx.showToast({
          title: error instanceof Error ? error.message : '诗词圈加载失败',
          icon: 'none',
        })
      }
      this.setData({ hasLoaded: true })
    } finally {
      this.setData({ isLoading: false })
    }
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
    const normalized = tuneSearch.toLowerCase()
    this.setData({
      tuneSearch,
      visibleTunePatterns: normalized
        ? this.data.tunePatterns.filter((item) => item.name.toLowerCase().includes(normalized))
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
