import { type PointerEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { MiniProgramHeader } from '../components/MiniProgramChrome'
import { WechatDialog } from '../components/WechatDialog'
import { apiRequest, idempotencyKey } from '../lib/api'
import { getStoredJson, setStoredJson, storageKeys } from '../lib/storage'
import { useAppStore } from '../store/app'
import type { CommunityPublication, LibraryWork, PublicUser } from '../types'

type WorkState = 'PUBLISHED' | 'UNPUBLISHED' | 'HIDDEN' | 'REJECTED'
type WorkCard = { id: string; publicationId: string; title: string; description: string; date: string; cover: string; state: WorkState; stateLabel: string; stateClass: string; source?: LibraryWork }
type DraftCard = { id: string; title: string; editedAt: string; description: string; cover: string; imageCount: number; videoCount: number; offset: number; isLocal: boolean; runId: string | null; source?: LibraryWork }
const covers = ['/assets/images/cover-ridge.jpg', '/assets/images/cover-mountain.jpg', '/assets/images/cover-alley.jpg', '/assets/images/cover-sunrise.jpg']

function dateLabel(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
}

function editedLabel(value: string) {
  const date = new Date(value)
  const today = new Date()
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  if (date.toDateString() === today.toDateString()) return time
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return `昨天 ${time}`
  return `${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
}

function description(work: Pick<LibraryWork, 'category' | 'classicalFormCode' | 'tunePatternCode'>) {
  const forms: Record<string, string> = { WUYAN_JUEJU: '五言绝句', QIYAN_JUEJU: '七言绝句', WUYAN_LVSHI: '五言律诗', QIYAN_LVSHI: '七言律诗', DAYOU_SHI: '打油诗' }
  if (work.category === 'MODERN') return '现代诗'
  if (work.category === 'CI') return work.tunePatternCode || '词'
  return forms[work.classicalFormCode || ''] || '古体诗'
}

function state(work: LibraryWork): Pick<WorkCard, 'state' | 'stateLabel' | 'stateClass'> {
  if (work.publication?.status === 'REJECTED') return { state: 'REJECTED', stateLabel: '已下架', stateClass: 'status--rejected' }
  if (work.publication?.status === 'HIDDEN') return { state: 'HIDDEN', stateLabel: '已隐藏', stateClass: 'status--hidden' }
  if (work.publication?.status === 'PUBLISHED' && work.publication.visibility === 'UNLISTED') return { state: 'UNPUBLISHED', stateLabel: '仅链接可见', stateClass: 'status--private' }
  if (work.publication?.status === 'PUBLISHED' || work.publication?.status === 'PENDING_REVIEW') return { state: 'PUBLISHED', stateLabel: '已发布', stateClass: 'status--published' }
  return { state: 'UNPUBLISHED', stateLabel: '仅自己可见', stateClass: 'status--private' }
}

export default function LibraryPage({ mode }: { mode: 'works' | 'drafts' | 'public' }) {
  const { userId } = useParams()
  const navigate = useNavigate()
  const user = useAppStore((item) => item.user)
  const setToast = useAppStore((item) => item.setToast)
  const [works, setWorks] = useState<WorkCard[]>([])
  const [drafts, setDrafts] = useState<DraftCard[]>([])
  const [author, setAuthor] = useState<(PublicUser & { displayAvatarUrl: string }) | null>(null)
  const [filter, setFilter] = useState<'ALL' | WorkState>('ALL')
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [actionWork, setActionWork] = useState<WorkCard | null>(null)
  const [pendingDeleteWork, setPendingDeleteWork] = useState<WorkCard | null>(null)
  const [pendingDeleteDraft, setPendingDeleteDraft] = useState<DraftCard | null>(null)
  const [moderationDialog, setModerationDialog] = useState(false)
  const touch = useRef({ id: '', x: 0, y: 0 })

  async function load() {
    setLoading(true); setLoadError('')
    try {
      if (mode === 'public' && userId) {
        const response = await apiRequest<{ author: Omit<PublicUser, 'followedByMe'>; items: CommunityPublication[] }>(`/users/${userId}/publications?limit=30`)
        setAuthor({ ...response.author, followedByMe: false, displayAvatarUrl: response.author.avatarUrl || covers[0]! })
        setWorks(response.items.map((item, index) => ({ id: item.workId, publicationId: item.id, title: item.title || '未命名作品', description: description(item), date: dateLabel(item.publishedAt || item.createdAt), cover: item.displayCoverUrl || item.coverUrl || covers[index % covers.length]!, state: 'PUBLISHED', stateLabel: '已发布', stateClass: 'status--published' })))
      } else if (mode === 'works') {
        const response = await apiRequest<{ items: LibraryWork[] }>('/me/works?limit=50')
        setWorks(response.items.map((work, index) => ({ id: work.id, publicationId: work.publication?.id || '', title: work.title?.trim() || '未命名作品', description: description(work), date: dateLabel(work.updatedAt), cover: work.assets?.find((asset) => asset.kind === 'IMAGE' && asset.accessUrl)?.accessUrl || work.assets?.find((asset) => asset.kind === 'VIDEO' && asset.thumbnailUrl)?.thumbnailUrl || covers[index % covers.length]!, source: work, ...state(work) })))
      } else {
        const local = getStoredJson<Array<Record<string, any>>>(storageKeys.localDrafts) || []
        const server = user ? await apiRequest<{ items: LibraryWork[] }>('/me/creations?status=DRAFT&limit=50') : { items: [] }
        const localCards: DraftCard[] = local.map((item, index) => { const draftPrompt = String(item.prompt || '').trim(); return { id: String(item.id || item.localDraftId), title: draftPrompt ? (draftPrompt.length > 12 ? `${draftPrompt.slice(0, 12)}…` : draftPrompt) : '未命名草稿', editedAt: editedLabel(item.localUpdatedAt || item.updatedAt), description: description(item.preferences || item), cover: covers[index % covers.length]!, imageCount: (item.assetKinds || []).filter((kind: string) => kind === 'IMAGE').length, videoCount: (item.assetKinds || []).filter((kind: string) => kind === 'VIDEO').length, offset: 0, isLocal: true, runId: item.runId || item.generationId || null } })
        const serverCards: DraftCard[] = server.items.map((work, index) => { const draftPrompt = work.prompt.trim(); return { id: work.id, title: draftPrompt ? (draftPrompt.length > 12 ? `${draftPrompt.slice(0, 12)}…` : draftPrompt) : '未命名草稿', editedAt: editedLabel(work.updatedAt), description: description(work), cover: work.assets?.find((asset) => asset.kind === 'IMAGE' && asset.accessUrl)?.accessUrl || work.assets?.find((asset) => asset.kind === 'VIDEO' && asset.thumbnailUrl)?.thumbnailUrl || covers[(index + localCards.length) % covers.length]!, imageCount: (work.assets || []).filter((asset) => asset.kind === 'IMAGE').length || work.assetIds?.length || 0, videoCount: (work.assets || []).filter((asset) => asset.kind === 'VIDEO').length, offset: 0, isLocal: false, runId: work.latestGeneration?.id || null, source: work } })
        setDrafts([...localCards, ...serverCards])
      }
    } catch (error) {
      setLoadError(mode === 'public' ? '暂时无法加载这位作者的作品' : mode === 'works' ? '暂时无法加载作品' : '草稿加载失败，请稍后重试')
      setToast(error instanceof Error ? error.message : '加载失败')
    } finally { setLoading(false); setLoaded(true) }
  }
  useEffect(() => { void load() }, [mode, userId, user?.id])

  const visibleWorks = useMemo(() => filter === 'ALL' ? works : works.filter((work) => work.state === filter), [works, filter])

  async function publishOrHide(work: WorkCard) {
    const isPublish = work.state !== 'PUBLISHED'
    setToast(isPublish ? '正在发布' : '正在隐藏')
    try {
      if (work.state === 'PUBLISHED') await apiRequest(`/works/${work.id}/publication/hide`, { method: 'POST', body: {}, idempotencyKey: idempotencyKey('hide-work') })
      else if (work.state === 'HIDDEN') await apiRequest(`/works/${work.id}/publication/restore`, { method: 'POST', body: {}, idempotencyKey: idempotencyKey('restore-work') })
      else await apiRequest(`/works/${work.id}/publications`, { method: 'POST', body: { workId: work.id, visibility: 'PUBLIC', acceptedCommunityRules: true }, idempotencyKey: idempotencyKey('publish-work') })
      setToast(work.state === 'PUBLISHED' ? '已设为仅自己可见' : '已发布到诗词圈')
      setActionWork(null); await load()
    } catch (error) {
      setToast(error instanceof Error ? error.message : (isPublish ? '作品发布失败，请稍后重试' : '可见范围修改失败，请稍后重试'))
    }
  }

  async function deleteWork() {
    if (!pendingDeleteWork) return
    setToast('正在删除')
    try { await apiRequest(`/works/${pendingDeleteWork.id}`, { method: 'DELETE' }); setToast('作品已删除'); setPendingDeleteWork(null); setActionWork(null); await load() }
    catch (error) { setToast(error instanceof Error ? error.message : '作品删除失败，请稍后重试') }
  }

  async function deleteDraft() {
    if (!pendingDeleteDraft) return
    setToast('正在删除')
    try {
      if (pendingDeleteDraft.isLocal) {
        const local = getStoredJson<Array<Record<string, any>>>(storageKeys.localDrafts) || []
        setStoredJson(storageKeys.localDrafts, local.filter((item) => String(item.id || item.localDraftId) !== pendingDeleteDraft.id))
      } else await apiRequest(`/works/${pendingDeleteDraft.id}`, { method: 'DELETE' })
      setDrafts((current) => current.filter((item) => item.id !== pendingDeleteDraft.id)); setPendingDeleteDraft(null); setToast('草稿已删除')
    } catch (error) { setToast(error instanceof Error ? error.message : '草稿删除失败，请稍后重试') }
  }

  function pointerStart(event: PointerEvent<HTMLDivElement>, id: string) { touch.current = { id, x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); setDrafts((current) => current.map((item) => ({ ...item, offset: item.id === id ? item.offset : 0 }))) }
  function pointerMove(event: PointerEvent<HTMLDivElement>) { const state = touch.current; if (!state.id) return; const dx = event.clientX - state.x; const dy = event.clientY - state.y; if (Math.abs(dx) <= Math.abs(dy)) return; const width = 68.64; const offset = Math.max(-width, Math.min(0, dx)); setDrafts((current) => current.map((item) => item.id === state.id ? { ...item, offset } : item)) }
  function pointerEnd() { const state = touch.current; setDrafts((current) => current.map((item) => item.id === state.id ? { ...item, offset: item.offset < -28.8 ? -68.64 : 0 } : item)); touch.current = { id: '', x: 0, y: 0 } }

  function continueDraft(draft: DraftCard) {
    if (!draft.runId) { setToast('草稿数据已更新，请刷新后重试'); return }
    const existing = getStoredJson<Record<string, any>>(storageKeys.activeCreationRun)
    setStoredJson(storageKeys.activeCreationRun, { ...existing, runId: draft.runId, openedFromDraft: true })
    navigate(`/creating/${encodeURIComponent(draft.runId)}`)
  }

  if (mode === 'drafts') return (
    <div className="mp-page mp-my-drafts app-viewport drafts-viewport"><MiniProgramHeader title="我的草稿" loading={loading} /><main className="drafts-scroll page-scroll">{drafts.length ? <div className="drafts-list">{drafts.map((draft) => <div className="swipe-shell" key={draft.id}>{draft.offset < 0 ? <button className="swipe-delete" onClick={() => setPendingDeleteDraft(draft)}><img src="/assets/icons/action-trash.svg" alt="" /><span className="poem-display">删除</span></button> : null}<div className="draft-card" style={{ transform: `translateX(${draft.offset}px)` }} onPointerDown={(event) => pointerStart(event, draft.id)} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd}><img className="draft-cover" src={draft.cover} alt="" /><div className="draft-copy"><strong className="draft-title poem-display">{draft.title}</strong><span className="draft-edited">最后编辑： {draft.editedAt}</span><span className="draft-description">{draft.description}</span><div className="material-counts">{draft.imageCount ? <span className="material-count"><img src="/assets/icons/action-image-count.svg" alt="" />{draft.imageCount}</span> : null}{draft.videoCount ? <span className="material-count"><img src="/assets/icons/action-video-count.svg" alt="" />{draft.videoCount}</span> : null}</div><button className="continue-button poem-display" onClick={(event) => { event.stopPropagation(); continueDraft(draft) }}>继续创作</button></div><img className="drag-icon" src="/assets/icons/action-drag.svg" alt="" /></div></div>)}<div className="swipe-hint"><img src="/assets/icons/action-trash.svg" alt="" /><span>左滑可删除草稿</span></div></div> : loaded && !loading ? <div className="empty-state"><img className="empty-illustration" src="/assets/images/empty-drafts.jpg" alt="" /><strong className="empty-title poem-display">暂无草稿</strong><span className="empty-copy">未完成的创作会暂存在这里</span><button className="empty-outline poem-display" onClick={() => navigate('/create')}>开始创作</button><div className="device-note"><span className="shield-icon">✓</span><span>匿名草稿仅保存在当前设备</span></div></div> : null}</main><WechatDialog open={pendingDeleteDraft !== null} title="删除这篇草稿？" content="删除后将无法恢复，请谨慎操作。" confirmText="删除" onCancel={() => setPendingDeleteDraft(null)} onConfirm={deleteDraft} /></div>
  )

  return (
    <div className="mp-page mp-my-works app-viewport works-viewport"><MiniProgramHeader title={mode === 'public' ? 'TA的作品' : '我的作品'} loading={loading} />
      {mode === 'public' && author ? <section className="author-profile"><span className="author-profile__avatar"><img src={author.displayAvatarUrl} alt="" /></span><span className="author-profile__copy"><strong className="author-profile__name poem-display">{author.nickname}</strong><span className="author-profile__signature">{author.signature || '未留下个性签名'}</span></span></section> : mode === 'public' && !loadError ? <div className="author-profile author-profile--loading"><span className="author-profile__avatar author-profile__skeleton" /><span className="author-profile__copy"><span className="author-profile__skeleton author-profile__skeleton--name" /><span className="author-profile__skeleton author-profile__skeleton--signature" /></span></div> : <nav className="filter-tabs">{([['ALL', '全部'], ['PUBLISHED', '已发布'], ['UNPUBLISHED', '未发布'], ['HIDDEN', '已隐藏']] as const).map(([value, label]) => <button className={`filter-tab poem-display ${filter === value ? 'filter-tab--active' : ''}`} key={value} onClick={() => setFilter(value)}>{label}</button>)}</nav>}
      <main className="works-scroll page-scroll">{visibleWorks.length ? <div className="works-list">{visibleWorks.map((work) => <div className={`work-card ${mode === 'public' ? 'work-card--public' : ''}`} key={work.id} role={mode === 'public' ? 'button' : undefined} onClick={() => mode === 'public' && navigate(`/publication/${work.publicationId}`)}><img className="work-cover" src={work.cover} alt="" /><div className="work-copy"><strong className="work-title poem-display">{work.title}</strong><span className="work-description">{work.description}</span><span className="work-date">{work.date}</span>{mode !== 'public' ? <button className={`work-status ${work.stateClass}`} onClick={(event) => { event.stopPropagation(); if (work.state === 'REJECTED') setModerationDialog(true) }}>{work.stateLabel}{work.state === 'REJECTED' ? <span className="work-status__notice">!</span> : null}</button> : null}</div>{mode !== 'public' ? <button className="more-button" onClick={() => setActionWork(work)}><img src="/assets/icons/action-more.svg" alt="" /></button> : <img className="work-card__chevron" src="/assets/icons/common-chevron-right.svg" alt="" />}</div>)}<img className="mountain-wash" src="/assets/images/mountain-wash.jpg" alt="" /></div> : loadError && !loading ? <div className="empty-state empty-state--error"><strong className="empty-title poem-display">作品加载失败</strong><span className="empty-copy">{loadError}</span><button className="empty-primary empty-primary--outline poem-display" onClick={() => void load()}>重新加载</button><img className="empty-mountain" src="/assets/images/mountain-wash.jpg" alt="" /></div> : loaded && !loading ? <div className="empty-state"><img className="empty-illustration empty-illustration--works" src="/assets/images/empty-works.jpg" alt="" /><strong className="empty-title poem-display">{mode === 'public' ? '还没有公开作品' : '还没有作品'}</strong><span className="empty-copy">{mode === 'public' ? '作者发布的作品会陈列在这里' : '完成一次创作后，作品会收藏在这里'}</span>{mode !== 'public' ? <button className="empty-primary poem-display" onClick={() => navigate('/create')}>去创作</button> : null}<img className="empty-mountain" src="/assets/images/mountain-wash.jpg" alt="" /></div> : null}</main>
      {actionWork ? <div className="sheet-overlay" onClick={() => setActionWork(null)}><div className="sheet-stack" onClick={(event) => event.stopPropagation()}><section className="action-sheet"><div className="sheet-heading"><img className="sheet-cover" src={actionWork.cover} alt="" /><strong className="sheet-title poem-display">{actionWork.title}</strong></div><button className="sheet-action" onClick={() => navigate(actionWork.publicationId && actionWork.state === 'PUBLISHED' ? `/publication/${actionWork.publicationId}` : `/publication/work/${actionWork.id}`)}><img src="/assets/icons/action-eye.svg" alt="" /><span className="poem-display">查看作品</span></button>{actionWork.state !== 'PUBLISHED' ? <button className="sheet-action" onClick={() => void publishOrHide(actionWork)}><img src="/assets/icons/tab-community-active.svg" alt="" /><span className="poem-display">发布到诗词圈</span></button> : <button className="sheet-action" onClick={() => void publishOrHide(actionWork)}><img src="/assets/icons/action-lock.svg" alt="" /><span className="poem-display">设为仅自己可见</span></button>}<button className="sheet-action sheet-action--danger" onClick={() => setPendingDeleteWork(actionWork)}><img src="/assets/icons/action-trash.svg" alt="" /><span className="poem-display">删除作品</span></button></section><button className="sheet-cancel poem-display" onClick={() => setActionWork(null)}>取消</button></div></div> : null}
      <WechatDialog open={pendingDeleteWork !== null} title="删除这篇作品？" content="删除后将无法恢复，请谨慎操作。" confirmText="删除" onCancel={() => setPendingDeleteWork(null)} onConfirm={deleteWork} /><WechatDialog open={moderationDialog} title="作品已下架" content="该作品或素材涉嫌违反社区规范" showCancel={false} confirmText="我知道了" onCancel={() => setModerationDialog(false)} onConfirm={() => setModerationDialog(false)} />
    </div>
  )
}
