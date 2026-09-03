import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MiniProgramHeader, MiniProgramTabBar } from '../components/MiniProgramChrome'
import { apiRequest } from '../lib/api'
import { useAppStore } from '../store/app'
import type { CommunityPublication, PoemCategory } from '../types'

type Card = {
  id: string; title: string; excerpt: string; category: string; author: string
  authorInitial: string; authorAvatarUrl: string; likes: number; likedByMe: boolean; cover: string
}
type Tune = { code: string; name: string; aliases: string[] }

const categoryTabs: Array<{ code: 'ALL' | PoemCategory; name: string }> = [
  { code: 'ALL', name: '全部' }, { code: 'CLASSICAL', name: '古体诗' },
  { code: 'MODERN', name: '现代诗' }, { code: 'CI', name: '词' },
]
const classicalForms = [
  { code: 'ALL', name: '全部' }, { code: 'WUYAN_JUEJU', name: '五言绝句' },
  { code: 'QIYAN_JUEJU', name: '七言绝句' }, { code: 'WUYAN_LVSHI', name: '五言律诗' },
  { code: 'QIYAN_LVSHI', name: '七言律诗' }, { code: 'DAYOU_SHI', name: '打油诗' },
]
const fallbackImages = ['/assets/images/cover-mountain.jpg', '/assets/images/cover-alley.jpg', '/assets/images/cover-ridge.jpg', '/assets/images/cover-sunrise.jpg']
const fallbackTunes: Tune[] = [{ code: 'ALL', name: '全部词牌', aliases: [] }, { code: 'shui_diao_ge_tou', name: '水調歌頭', aliases: ['水调歌头'] }]
const developmentPreviewCards: Card[] = [
  { id: 'preview-1', title: '山雨入窗', excerpt: '山雨入窗前，风轻过旧檐。一灯照客梦，万籁共秋眠。', category: '古体诗', author: '青山小笺', authorInitial: '青', authorAvatarUrl: '', likes: 128, likedByMe: false, cover: '/assets/images/cover-mountain.jpg' },
  { id: 'preview-2', title: '风经过旧巷', excerpt: '风经过旧巷，带走昨日的回声。雨落在青石上，也落进我的掌心。', category: '现代诗', author: '松风', authorInitial: '松', authorAvatarUrl: '', likes: 76, likedByMe: false, cover: '/assets/images/cover-alley.jpg' },
  { id: 'preview-3', title: '雾锁远山', excerpt: '雾锁远山淡，舟横野渡闲。晨钟穿水过，惊起白云还。', category: '词', author: '云起', authorInitial: '云', authorAvatarUrl: '', likes: 96, likedByMe: false, cover: '/assets/images/cover-ridge.jpg' },
]

function card(publication: CommunityPublication, index: number): Card {
  const forms: Record<string, string> = { WUYAN_JUEJU: '五言绝句', QIYAN_JUEJU: '七言绝句', WUYAN_LVSHI: '五言律诗', QIYAN_LVSHI: '七言律诗', DAYOU_SHI: '打油诗' }
  return {
    id: publication.id, title: publication.title,
    excerpt: publication.content.replace(/\\n/g, '\n').replace(/\r\n?/g, '\n').trim(),
    category: publication.category === 'MODERN' ? '现代诗' : publication.category === 'CI' ? '词' : forms[publication.classicalFormCode || ''] || '古体诗',
    author: publication.author.nickname, authorInitial: publication.author.nickname.slice(0, 1) || '诗',
    authorAvatarUrl: publication.author.avatarUrl || '', likes: publication.likeCount,
    likedByMe: publication.likedByMe,
    cover: publication.displayCoverUrl || publication.coverUrl || fallbackImages[index % fallbackImages.length]!,
  }
}

export default function CommunityPage() {
  const navigate = useNavigate()
  const setToast = useAppStore((state) => state.setToast)
  const [activeCategory, setActiveCategory] = useState<'ALL' | PoemCategory>('ALL')
  const [activeClassicalForm, setClassicalForm] = useState('ALL')
  const [tunes, setTunes] = useState<Tune[]>(fallbackTunes)
  const [selectedTuneCode, setSelectedTuneCode] = useState('ALL')
  const [pendingTuneCode, setPendingTuneCode] = useState('ALL')
  const [tuneSearch, setTuneSearch] = useState('')
  const [showTunePicker, setShowTunePicker] = useState(false)
  const [poems, setPoems] = useState<Card[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    void apiRequest<{ categories: Array<{ code: PoemCategory; tunePatterns?: Array<{ code: string; name: string; aliases?: string[] }> }> }>('/poem-taxonomies', { authenticated: false })
      .then((response) => {
        const remote = response.categories.find((item) => item.code === 'CI')?.tunePatterns || []
        if (remote.length) setTunes([{ code: 'ALL', name: '全部词牌', aliases: [] }, ...remote.map((item) => ({ ...item, aliases: item.aliases || [] }))])
      }).catch(() => undefined)
  }, [])

  async function load(append = false) {
    if (loading) return
    setLoading(true)
    try {
      const query = new URLSearchParams({ limit: '30' })
      if (activeCategory !== 'ALL') query.set('category', activeCategory)
      if (activeCategory === 'CLASSICAL' && activeClassicalForm !== 'ALL') query.set('classicalFormCode', activeClassicalForm)
      if (activeCategory === 'CI' && selectedTuneCode !== 'ALL') query.set('tunePatternCode', selectedTuneCode)
      if (append && nextCursor) query.set('cursor', nextCursor)
      const response = await apiRequest<{ items: CommunityPublication[]; nextCursor: string | null }>(`/community/feed?${query}`)
      const incoming = response.items.map((item, index) => card(item, (append ? poems.length : 0) + index))
      setPoems((current) => append ? [...current, ...incoming.filter((item) => !current.some((existing) => existing.id === item.id))] : incoming)
      setNextCursor(response.nextCursor)
    } catch (error) {
      if (!loaded && import.meta.env.DEV && activeCategory === 'ALL') setPoems(developmentPreviewCards)
      else if (!loaded) setToast(error instanceof Error ? error.message : '诗词圈加载失败')
    } finally {
      setLoading(false)
      setLoaded(true)
    }
  }

  useEffect(() => { setPoems([]); setLoaded(false); void load(false) }, [activeCategory, activeClassicalForm, selectedTuneCode])
  const columns = [poems.filter((_, index) => index % 2 === 0), poems.filter((_, index) => index % 2 === 1)]
  const selectedTuneName = tunes.find((item) => item.code === selectedTuneCode)?.name || '全部词牌'
  const visibleTunes = useMemo(() => {
    const search = tuneSearch.trim().toLowerCase().replace(/\s+/g, '')
    return search ? tunes.filter((item) => [item.name, ...item.aliases].some((candidate) => candidate.toLowerCase().replace(/\s+/g, '').includes(search))) : tunes
  }, [tunes, tuneSearch])

  return (
    <div className="mp-page mp-community app-viewport community-viewport">
      <MiniProgramHeader title="诗词圈" back={false} loading={loading && loaded} background="#faf9f5" />
      <nav className="category-tabs">{categoryTabs.map((item) => <button className={`category-tab poem-display ${activeCategory === item.code ? 'category-tab--active' : ''}`} key={item.code} onClick={() => { setActiveCategory(item.code); setClassicalForm('ALL'); setSelectedTuneCode('ALL') }}>{item.name}</button>)}</nav>
      {activeCategory === 'CLASSICAL' ? <div className="subfilter-scroll"><div className="subfilter-row">{classicalForms.map((item) => <button className={`subfilter-chip ${activeClassicalForm === item.code ? 'subfilter-chip--active' : ''}`} key={item.code} onClick={() => setClassicalForm(item.code)}>{item.name}</button>)}</div></div> : null}
      {activeCategory === 'CI' ? <button className="tune-filter" onClick={() => { setPendingTuneCode(selectedTuneCode); setTuneSearch(''); setShowTunePicker(true) }}><span className="tune-filter__value"><span className="tune-filter__label poem-display">词牌：</span><span className="tune-filter__name poem-display">{selectedTuneName}</span><img className="tune-filter__arrow" src="/assets/icons/common-chevron-right.svg" alt="" /></span></button> : null}

      <main className={`feed-scroll page-scroll ${activeCategory === 'CLASSICAL' ? 'feed-scroll--classical' : ''} ${activeCategory === 'CI' ? 'feed-scroll--ci' : ''}`}>
        <div className="feed-shell">{columns.map((column, columnIndex) => <div className="feed-column" key={columnIndex}>{column.map((item) => <button className="poem-card" key={item.id} onClick={() => navigate(`/publication/${item.id}`)}><img className={`poem-cover ${columnIndex ? 'poem-cover--right' : ''}`} src={item.cover} alt="" /><span className="poem-card__body"><span className="poem-card__heading"><strong className="poem-title poem-display">{item.title}</strong><span className="poem-tag">{item.category}</span></span><span className="poem-excerpt poem-display">{item.excerpt}</span><span className="poem-meta"><span className="author-avatar poem-display">{item.authorAvatarUrl ? <img src={item.authorAvatarUrl} alt="" /> : item.authorInitial}</span><span className="author-name">{item.author}</span><img className="like-icon" src={item.likedByMe ? '/assets/icons/heart-filled.png' : '/assets/icons/heart-outline.png'} alt="" /><span className={`like-count ${item.likedByMe ? 'like-count--liked' : ''}`}>{item.likes}</span></span></span></button>)}</div>)}</div>
        {!loaded && loading ? <div className="empty-state"><strong className="empty-title poem-display">正在寻诗</strong><span className="empty-copy">翻开诗词圈的一页</span></div> : loaded && !poems.length ? <div className="empty-state"><strong className="empty-title poem-display">此处尚无诗作</strong><span className="empty-copy">成为第一个发布的人吧</span></div> : null}
        {nextCursor ? <button className="load-more" onClick={() => void load(true)}>{loading ? '正在加载…' : '加载更多'}</button> : null}
      </main>

      {showTunePicker ? <div className="tune-picker-overlay" onClick={() => setShowTunePicker(false)}><section className="tune-picker-sheet" onClick={(event) => event.stopPropagation()}><div className="tune-picker-head"><span className="tune-picker-spacer" /><h2 className="tune-picker-title poem-display">选择词牌</h2><button className="tune-picker-reset poem-display" onClick={() => { setPendingTuneCode('ALL'); setTuneSearch('') }}>重置</button></div><label className="tune-search"><span className="tune-search__icon" /><input className="tune-search__input poem-display" value={tuneSearch} placeholder="搜索词牌名" onChange={(event) => setTuneSearch(event.target.value)} /></label><div className="tune-options-scroll"><div className="tune-options">{visibleTunes.map((item) => <button className={`tune-option poem-display ${pendingTuneCode === item.code ? 'tune-option--active' : ''}`} key={item.code} onClick={() => setPendingTuneCode(item.code)}>{item.name}</button>)}</div>{!visibleTunes.length ? <div className="tune-no-result poem-display">没有找到相关词牌</div> : null}</div><button className="tune-confirm poem-display" onClick={() => { setSelectedTuneCode(pendingTuneCode); setShowTunePicker(false) }}>确定</button></section></div> : null}
      <MiniProgramTabBar />
    </div>
  )
}
