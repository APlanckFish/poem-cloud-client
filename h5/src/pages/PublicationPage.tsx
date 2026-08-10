import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { MiniProgramHeader } from '../components/MiniProgramChrome'
import { WechatDialog } from '../components/WechatDialog'
import { apiRequest, idempotencyKey } from '../lib/api'
import { useAppStore } from '../store/app'
import type { CommunityPublication, CreationTimelineEvent, PublicationCreationJournalEntry } from '../types'

type Comment = {
  id: string
  publicationId: string
  parentCommentId: string | null
  rootCommentId: string | null
  content: string
  moderationStatus: 'PENDING' | 'PASSED' | 'REJECTED' | 'REVIEW'
  createdAt: string
  canDelete: boolean
  isPublicationAuthor: boolean
  replyCount: number
  replies: Comment[]
  hasMoreReplies: boolean
  author: { id: string; nickname: string; avatarUrl: string | null }
  replyToUser: { id: string; nickname: string } | null
}

type LoginAction = 'LIKE' | 'FOLLOW' | 'COMMENT'

function fallbackCover(category: CommunityPublication['category']) {
  if (category === 'MODERN') return '/assets/images/cover-alley.jpg'
  if (category === 'CI') return '/assets/images/cover-sunrise.jpg'
  return '/assets/images/cover-mountain.jpg'
}

function categoryName(publication: CommunityPublication) {
  const forms: Record<string, string> = {
    WUYAN_JUEJU: '五言绝句', QIYAN_JUEJU: '七言绝句',
    WUYAN_LVSHI: '五言律诗', QIYAN_LVSHI: '七言律诗', DAYOU_SHI: '打油诗',
  }
  if (publication.category === 'MODERN') return '现代诗'
  if (publication.category === 'CI') return '词'
  return forms[publication.classicalFormCode || ''] || '古体诗'
}

function poemCardHeight(content: string) {
  const lineCount = content.replace(/\\n/g, '\n').split('\n').filter(Boolean).length
  return Math.max(1040, Math.min(1460, 900 + lineCount * 62))
}

function displayTime(value: string) {
  const date = new Date(value)
  const now = Date.now()
  const delta = now - date.getTime()
  if (delta < 60_000) return '刚刚'
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}分钟前`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}小时前`
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
}

interface CreationJourneyMoment {
  id: string
  label: string
  time: string
  description: string
  entries: string[]
}

interface CreationJourneyHistoryEntry {
  generationId: string
  baseGenerationId: string | null
  prompt: string
  instruction: string
  materialNarrative: string[]
  events: CreationTimelineEvent[]
}

interface JourneyRunSnapshot {
  runId: string
  generationId: string
  baseGenerationId: string | null
  creationId: string | null
  coreStatus: string
  result: unknown
  materialAnalysis: { publicNarrative?: string[] } | null
  input: { prompt: string; instruction: string }
}

interface CreationHistoryEntry {
  snapshot: JourneyRunSnapshot
  events: CreationTimelineEvent[]
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

function eventText(event: CreationTimelineEvent): string {
  return typeof event.data.text === 'string' ? event.data.text.trim() : ''
}

function eventTime(events: CreationTimelineEvent[]): string {
  const raw = events.find((event) => event.occurredAt)?.occurredAt
  if (!raw) return ''
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return ''
  return `${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function uniqueEntries(entries: string[]): string[] {
  return [...new Set(entries.map((entry) => entry.trim()).filter(Boolean))].slice(0, 16)
}

function eventsOf(
  history: CreationJourneyHistoryEntry,
  names: string[],
): CreationTimelineEvent[] {
  return history.events.filter((event) => names.includes(event.event))
}

function revisionLabel(index: number): string {
  const labels = ['二次创作', '三次创作', '四次创作', '五次创作']
  return labels[index] || `第${index + 2}次创作`
}

function ownedJourneyHistory(history: CreationHistoryEntry[]): CreationJourneyHistoryEntry[] {
  return history.map(({ snapshot, events }) => ({
    generationId: snapshot.generationId,
    baseGenerationId: snapshot.baseGenerationId,
    prompt: snapshot.input.prompt.trim(),
    instruction: snapshot.input.instruction.trim(),
    materialNarrative: snapshot.materialAnalysis?.publicNarrative || [],
    events,
  }))
}

function publicJourneyHistory(
  history: PublicationCreationJournalEntry[],
): CreationJourneyHistoryEntry[] {
  return history.map((entry) => ({
    generationId: entry.generationId,
    baseGenerationId: entry.baseGenerationId,
    prompt: entry.prompt.trim(),
    instruction: entry.instruction.trim(),
    materialNarrative: entry.materialNarrative,
    events: entry.events,
  }))
}

function buildCreationJourney(history: CreationJourneyHistoryEntry[]): CreationJourneyMoment[] {
  const moments: CreationJourneyMoment[] = []
  let revisionIndex = 0
  const appendMoment = (
    generationId: string,
    key: string,
    label: string,
    description: string,
    relevantEvents: CreationTimelineEvent[],
    entries: string[],
  ) => {
    const normalized = uniqueEntries(entries)
    if (normalized.length === 0) return
    moments.push({
      id: `${generationId}-${key}`,
      label,
      description,
      time: eventTime(relevantEvents),
      entries: normalized,
    })
  }

  for (const historyEntry of history) {
    const generationId = historyEntry.generationId
    const isRevision = Boolean(historyEntry.baseGenerationId || historyEntry.instruction)
    const analysisEvents = eventsOf(historyEntry, ['analysis.delta', 'analysis.completed'])
    const retrievalEvents = eventsOf(historyEntry, ['retrieval.delta', 'retrieval.completed'])
    const poemEvents = eventsOf(historyEntry, ['poem.progress', 'poem.completed'])
    const validationEvents = eventsOf(historyEntry, [
      'validation.started',
      'validation.completed',
    ])

    if (!isRevision) {
      const analysisEntries = [
        ...analysisEvents.map(eventText),
        ...analysisEvents.flatMap((event) => stringList(event.data.publicNarrative)),
        ...historyEntry.materialNarrative,
      ]
      appendMoment(
        generationId,
        'analysis',
        '理解素材',
        '从文字与画面中辨认真实场景',
        analysisEvents,
        analysisEntries,
      )

      const retrievalEntries = [
        ...retrievalEvents.map(eventText),
        ...retrievalEvents.flatMap((event) => stringList(event.data.publicNarrative)),
        ...retrievalEvents.flatMap((event) =>
          stringList(event.data.symbols).map((symbol) => `取意象 · ${symbol}`),
        ),
      ]
      appendMoment(
        generationId,
        'retrieval',
        '检索诗意',
        '选择意象、情绪与篇章走向',
        retrievalEvents,
        retrievalEntries,
      )
    }

    const publicPoemNotes = poemEvents
      .map(eventText)
      .filter((text) => text && !text.startsWith('审校 ·'))
    const validationNotes = [
      ...poemEvents.map(eventText).filter((text) => text.startsWith('审校 ·')),
      ...validationEvents.flatMap((event) => {
        const summary =
          typeof event.data.meterSummary === 'string' ? event.data.meterSummary.trim() : ''
        const issues = stringList(event.data.issues).map((issue) => `校验意见 · ${issue}`)
        return [summary ? `审校结论 · ${summary}` : '', ...issues]
      }),
    ]

    if (isRevision) {
      const label = revisionLabel(revisionIndex)
      revisionIndex += 1
      appendMoment(
        generationId,
        'revision',
        label,
        historyEntry.instruction || '沿用原意重新推敲',
        [...poemEvents, ...validationEvents],
        [
          historyEntry.instruction ? `调整要求 · ${historyEntry.instruction}` : '',
          ...publicPoemNotes,
          ...validationNotes,
        ],
      )
    } else {
      appendMoment(
        generationId,
        'writing',
        '落笔成诗',
        '让选定的意象在句间成形',
        poemEvents,
        publicPoemNotes,
      )
      appendMoment(
        generationId,
        'validation',
        '格律审校',
        '逐句核对句式、平仄与用韵',
        validationEvents,
        validationNotes,
      )
    }
  }
  return moments
}

export default function PublicationPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const user = useAppStore((state) => state.user)
  const setToast = useAppStore((state) => state.setToast)
  const [publication, setPublication] = useState<CommunityPublication | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [isCardFlipped, setCardFlipped] = useState(false)
  const [isCardHinting, setCardHinting] = useState(false)
  const [showLikeBurst, setShowLikeBurst] = useState(false)
  const [isLiking, setLiking] = useState(false)
  const [followedByMe, setFollowedByMe] = useState(false)
  const [isFollowing, setFollowing] = useState(false)
  const [comments, setComments] = useState<Comment[]>([])
  const [commentsLoaded, setCommentsLoaded] = useState(false)
  const [commentsError, setCommentsError] = useState('')
  const [commentsNextCursor, setCommentsNextCursor] = useState<string | null>(null)
  const [isCommentsLoadingMore, setCommentsLoadingMore] = useState(false)
  const [commentDraft, setCommentDraft] = useState('')
  const [replyingTo, setReplyingTo] = useState<Comment | null>(null)
  const [isSubmittingComment, setSubmittingComment] = useState(false)
  const [deletingComment, setDeletingComment] = useState<Comment | null>(null)
  const [loginAction, setLoginAction] = useState<LoginAction | null>(null)
  const [journeyMoments, setJourneyMoments] = useState<CreationJourneyMoment[]>([])
  const [journeyPrompt, setJourneyPrompt] = useState('')
  const [journeyLoading, setJourneyLoading] = useState(false)
  const [journeyError, setJourneyError] = useState('')
  const [journeyLoaded, setJourneyLoaded] = useState(false)
  const [creationJournalPublic, setCreationJournalPublic] = useState(true)
  const [coverSource, setCoverSource] = useState<'MATERIAL' | 'POSTER'>('MATERIAL')
  const [coverUrl, setCoverUrl] = useState('')
  const [isUpdatingSettings, setUpdatingSettings] = useState(false)
  const [isPublishing, setPublishing] = useState(false)
  const [showModerationDialog, setShowModerationDialog] = useState(false)
  const [showPublishDialog, setShowPublishDialog] = useState(false)
  const [expandedReplies, setExpandedReplies] = useState<Record<string, boolean>>({})
  const [expandingReplies, setExpandingReplies] = useState('')

  async function load() {
    if (!id) return
    setLoading(true)
    setNotFound(false)
    setJourneyMoments([])
    setJourneyPrompt('')
    setJourneyError('')
    setJourneyLoaded(false)
    setJourneyLoading(false)
    try {
      const [item, commentResponse] = await Promise.all([
        apiRequest<CommunityPublication>(`/community/publications/${id}`),
        apiRequest<{ items: Comment[]; nextCursor: string | null }>(`/community/publications/${id}/comments?limit=20`).catch(() => ({ items: [], nextCursor: null })),
      ])
      setPublication(item)
      setCreationJournalPublic(item.creationJournalPublic)
      setCoverSource(item.coverSource)
      setCoverUrl(item.displayCoverUrl || item.coverUrl || '')
      setComments(commentResponse.items)
      setCommentsNextCursor(commentResponse.nextCursor)
      setCommentsLoaded(true)
      if (item.author.id !== user?.id) {
        void apiRequest<{ followedByMe: boolean }>(`/users/${item.author.id}`)
          .then((author) => setFollowedByMe(author.followedByMe))
          .catch(() => undefined)
      }
      const hintKey = `poem_cloud_publication_flip_hint:${user?.id || 'guest'}:${item.id}`
      if (item.canViewCreationJournal && localStorage.getItem(hintKey) !== '1') {
        localStorage.setItem(hintKey, '1')
        setCardHinting(true)
        window.setTimeout(() => setCardHinting(false), 5_200)
        void loadJourney(item)
      }
    } catch {
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [id, user?.id])

  const contentLines = useMemo(
    () => publication?.content.replace(/\\n/g, '\n').split('\n') ?? [],
    [publication?.content],
  )
  const isOwner = Boolean(user && publication?.author.id === user.id)
  const isPublic = publication?.visibility === 'PUBLIC' && publication.status === 'PUBLISHED'
  const canManagePublication = Boolean(isOwner && publication?.id && publication.status !== 'REJECTED')
  const canPublish = Boolean(
    isOwner &&
    publication &&
    publication.status !== 'REJECTED' &&
    publication.status !== 'PENDING_REVIEW' &&
    (publication.status !== 'PUBLISHED' || publication.visibility === 'UNLISTED'),
  )
  const materialBackgroundReady = Boolean(publication?.materials.length)
  const posterBackgroundReady = Boolean(publication?.posterBackgroundReady)

  async function loadCreationHistory(runId: string): Promise<CreationHistoryEntry[]> {
    const newestFirst: CreationHistoryEntry[] = []
    const visited = new Set<string>()
    let currentId: string | null = runId
    while (currentId && newestFirst.length < 20 && !visited.has(currentId)) {
      visited.add(currentId)
      const snapshot: JourneyRunSnapshot = await apiRequest<JourneyRunSnapshot>(
        `/creation-runs/${encodeURIComponent(currentId)}`,
      )
      const events: CreationTimelineEvent[] = []
      let afterSeq = 0
      while (true) {
        const response = await apiRequest<{
          lastSeq: number
          hasMore: boolean
          items: CreationTimelineEvent[]
        }>(`/creation-runs/${encodeURIComponent(currentId)}/timeline?afterSeq=${afterSeq}&limit=500`)
        events.push(...response.items)
        if (!response.hasMore || response.lastSeq <= afterSeq) break
        afterSeq = response.lastSeq
      }
      newestFirst.push({ snapshot, events })
      currentId = snapshot.baseGenerationId
    }
    return newestFirst.reverse()
  }

  async function loadJourney(target?: CommunityPublication) {
    const current = target ?? publication
    const owned = Boolean(current && user && current.author.id === user.id)
    if (!current || !current.canViewCreationJournal || journeyLoaded || journeyLoading) return
    setJourneyLoading(true)
    setJourneyError('')
    try {
      const history = owned && current.selectedGenerationId
        ? ownedJourneyHistory(await loadCreationHistory(current.selectedGenerationId))
        : publicJourneyHistory(
            await apiRequest<{ items: PublicationCreationJournalEntry[] }>(
              `/community/publications/${current.id}/creation-journal`,
            ).then((response) => response.items),
          )
      const moments = buildCreationJourney(history)
      const prompt =
        history.find((entry) => !entry.baseGenerationId && entry.prompt)?.prompt
        || history.find((entry) => entry.prompt)?.prompt
        || ''
      setJourneyMoments(moments)
      setJourneyPrompt(prompt)
      setJourneyError(
        moments.length === 0 && !prompt && current.materials.length === 0
          ? '这首诗暂时没有可展示的创作手记'
          : '',
      )
      setJourneyLoaded(true)
    } catch (error) {
      setJourneyError(error instanceof Error ? error.message : '创作手记加载失败')
    } finally {
      setJourneyLoading(false)
    }
  }

  function toggleCard() {
    if (!publication?.canViewCreationJournal || isCardHinting) return
    const next = !isCardFlipped
    setCardFlipped(next)
    if (next) void loadJourney()
  }

  async function savePublicationSettings(nextSettings: {
    creationJournalPublic: boolean
    coverSource: 'MATERIAL' | 'POSTER'
  }) {
    const current = publication
    if (!current?.id || !isOwner || isUpdatingSettings) return
    const previous = {
      creationJournalPublic,
      coverSource,
      coverUrl,
    }
    const optimisticCoverUrl =
      nextSettings.coverSource === 'POSTER' &&
      posterBackgroundReady &&
      current.generatedBackgroundUrl
        ? current.generatedBackgroundUrl
        : current.coverUrl || fallbackCover(current.category)
    setCreationJournalPublic(nextSettings.creationJournalPublic)
    setCoverSource(nextSettings.coverSource)
    setCoverUrl(optimisticCoverUrl)
    setUpdatingSettings(true)
    try {
      await apiRequest(`/community/publications/${current.id}/settings`, {
        method: 'PUT',
        body: nextSettings,
      })
    } catch (error) {
      setCreationJournalPublic(previous.creationJournalPublic)
      setCoverSource(previous.coverSource)
      setCoverUrl(previous.coverUrl)
      setToast(error instanceof Error ? error.message : '展示设置保存失败')
    } finally {
      setUpdatingSettings(false)
    }
  }

  function toggleJournalVisibility(checked: boolean) {
    void savePublicationSettings({ creationJournalPublic: checked, coverSource })
  }

  function selectCoverSource(source: 'MATERIAL' | 'POSTER') {
    if (!publication || source === coverSource || isUpdatingSettings) return
    if (source === 'POSTER' && !posterBackgroundReady) {
      setToast('海报背景尚未生成完成')
      return
    }
    if (source === 'MATERIAL' && !materialBackgroundReady) {
      setToast('没有可用的原始素材背景')
      return
    }
    void savePublicationSettings({ creationJournalPublic, coverSource: source })
  }

  async function publishToCommunity() {
    const current = publication
    if (!current || !isOwner || !canPublish || isPublishing) return
    setPublishing(true)
    setToast('正在发布')
    try {
      let publicationId = current.id
      let nextStatus = 'PUBLISHED'
      if (current.status === 'HIDDEN' && current.id) {
        await apiRequest(`/works/${current.workId}/publication/restore`, {
          method: 'POST',
          body: {},
          idempotencyKey: idempotencyKey('restore-publication'),
        })
      } else {
        const created = await apiRequest<{ id: string; status: string }>(
          `/works/${current.workId}/publications`,
          {
            method: 'POST',
            body: { workId: current.workId, visibility: 'PUBLIC', acceptedCommunityRules: true },
            idempotencyKey: idempotencyKey('publish-from-detail'),
          },
        )
        publicationId = created.id
        nextStatus = created.status
      }
      setPublication((item) => item ? { ...item, id: publicationId, status: nextStatus as CommunityPublication['status'] } : item)
      setToast(nextStatus === 'PUBLISHED' ? '已发布到诗词圈' : '已提交审核')
      if (nextStatus === 'PUBLISHED') void load()
    } catch (error) {
      setToast(error instanceof Error ? error.message : '发布失败')
    } finally {
      setPublishing(false)
    }
  }

  async function expandReplies(comment: Comment) {
    if (!publication || expandingReplies) return
    setExpandingReplies(comment.id)
    try {
      const response = await apiRequest<{ items: Comment[] }>(
        `/community/publications/${publication.id}/comments/${comment.id}/replies?limit=50`,
      )
      setComments((current) => current.map((item) =>
        item.id === comment.id
          ? { ...item, replies: response.items, hasMoreReplies: false }
          : item))
      setExpandedReplies((current) => ({ ...current, [comment.id]: true }))
    } catch (error) {
      setToast(error instanceof Error ? error.message : '回复加载失败')
    } finally {
      setExpandingReplies('')
    }
  }

  async function loadMoreComments() {
    if (!publication?.id || !commentsNextCursor || isCommentsLoadingMore) return
    setCommentsLoadingMore(true)
    try {
      const response = await apiRequest<{ items: Comment[]; nextCursor: string | null }>(
        `/community/publications/${publication.id}/comments?limit=20&cursor=${encodeURIComponent(commentsNextCursor)}`,
      )
      setComments((current) => [...current, ...response.items.filter((item) => !current.some((existing) => existing.id === item.id))])
      setCommentsNextCursor(response.nextCursor)
    } catch (error) {
      setToast(error instanceof Error ? error.message : '更多评论加载失败')
    } finally {
      setCommentsLoadingMore(false)
    }
  }

  function requireLogin(action: LoginAction) {
    if (user) return true
    setLoginAction(action)
    return false
  }

  function confirmLogin() {
    const action = loginAction
    setLoginAction(null)
    navigate(`/login?returnTo=${encodeURIComponent(`/publication/${id}?resume=${action || ''}`)}`)
  }

  function triggerLikeBurst() {
    setShowLikeBurst(false)
    window.requestAnimationFrame(() => {
      setShowLikeBurst(true)
      window.setTimeout(() => setShowLikeBurst(false), 760)
    })
  }

  async function toggleLike() {
    if (!publication?.id || isLiking || !requireLogin('LIKE')) return
    const previous = publication
    const likedByMe = !publication.likedByMe
    setLiking(true)
    setPublication({ ...publication, likedByMe, likeCount: Math.max(0, publication.likeCount + (likedByMe ? 1 : -1)) })
    if (likedByMe) triggerLikeBurst()
    try {
      await apiRequest(`/community/publications/${publication.id}/like`, { method: likedByMe ? 'PUT' : 'DELETE' })
    } catch (error) {
      setPublication(previous)
      setShowLikeBurst(false)
      setToast(error instanceof Error ? error.message : '操作失败')
    } finally {
      setLiking(false)
    }
  }

  async function toggleFollow() {
    if (!publication || isOwner || isFollowing || !requireLogin('FOLLOW')) return
    const next = !followedByMe
    setFollowing(true)
    setFollowedByMe(next)
    try {
      await apiRequest(`/users/${publication.author.id}/follow`, { method: next ? 'PUT' : 'DELETE' })
    } catch (error) {
      setFollowedByMe(!next)
      setToast(error instanceof Error ? error.message : '操作失败')
    } finally {
      setFollowing(false)
    }
  }

  async function submitComment(event: FormEvent) {
    event.preventDefault()
    if (!publication?.id || isSubmittingComment || !requireLogin('COMMENT')) return
    const content = commentDraft.trim()
    if (!content) {
      setToast('请先写下评论')
      return
    }
    setSubmittingComment(true)
    try {
      const result = await apiRequest<{ comment: Comment; commentCount: number }>(
        `/community/publications/${publication.id}/comments`,
        {
          method: 'POST',
          body: { content, ...(replyingTo ? { parentCommentId: replyingTo.id } : {}) },
          idempotencyKey: idempotencyKey('comment'),
        },
      )
      if (result.comment.moderationStatus === 'PASSED') {
        setComments((current) => result.comment.rootCommentId
          ? current.map((comment) => comment.id === result.comment.rootCommentId
            ? { ...comment, replies: [...comment.replies, result.comment], replyCount: comment.replyCount + 1 }
            : comment)
          : [result.comment, ...current])
        setToast('评论已发布')
      } else setToast('评论已提交审核')
      setPublication((current) => current ? { ...current, commentCount: result.commentCount } : current)
      setCommentDraft('')
      setReplyingTo(null)
    } catch (error) {
      setToast(error instanceof Error ? error.message : '评论发布失败')
    } finally {
      setSubmittingComment(false)
    }
  }

  async function confirmDeleteComment() {
    if (!publication || !deletingComment) return
    const target = deletingComment
    setDeletingComment(null)
    try {
      const result = await apiRequest<{ commentCount: number; visibleDeletedCount: number }>(
        `/community/publications/${publication.id}/comments/${target.id}`,
        { method: 'DELETE' },
      )
      setComments((current) => target.rootCommentId
        ? current.map((comment) => comment.id === target.rootCommentId
          ? { ...comment, replies: comment.replies.filter((reply) => reply.id !== target.id), replyCount: Math.max(0, comment.replyCount - result.visibleDeletedCount) }
          : comment)
        : current.filter((comment) => comment.id !== target.id))
      setPublication({ ...publication, commentCount: result.commentCount })
      setToast('评论已删除')
    } catch (error) {
      setToast(error instanceof Error ? error.message : '评论删除失败')
    }
  }

  function pendingWechatCapability() {
    setToast('微信 JSSDK 能力待接入')
  }

  return (
    <div className="mp-page mp-publication-detail app-viewport detail-viewport">
      <MiniProgramHeader title="作品详情" loading={loading} background={notFound ? '#f6f4f2' : '#fffefa'} />
      <main className="detail-scroll page-scroll">
        {publication ? <div className="detail-page">
          <div className="detail-card-scene" style={{ height: `${poemCardHeight(publication.content) / 7.5}cqw` }}>
            <div className={`detail-flip-card ${isCardFlipped ? 'detail-flip-card--back' : ''} ${isCardHinting ? 'detail-flip-card--hinting' : ''}`} onAnimationEnd={() => setCardHinting(false)}>
              <article className="detail-paper detail-card-face detail-card-front" onClick={() => toggleCard()}>
                <div className="detail-paper__scene"><img className="detail-paper__scene-image" src={coverUrl || publication.displayCoverUrl || publication.coverUrl || fallbackCover(publication.category)} alt="" /><div className="detail-paper__scene-fade" /></div>
                <h2 className="detail-title poem-display">{publication.title}</h2>
                <div className="detail-badges"><span className="detail-type poem-display">{categoryName(publication)}</span>{isOwner && publication.status === 'REJECTED' ? <button className="detail-status detail-status--rejected poem-display" onClick={() => setShowModerationDialog(true)}>已下架<span className="detail-status__notice">!</span></button> : null}</div>
                <div className="detail-author"><span className="detail-author__avatar poem-display">{publication.author.avatarUrl ? <img src={publication.author.avatarUrl} alt="" /> : publication.author.nickname.slice(0, 1)}</span><span className="detail-author__copy"><strong className="detail-author__name poem-display">{publication.author.nickname}</strong>{publication.publishedAt ? <time className="detail-author__date">{displayTime(publication.publishedAt)}</time> : null}</span></div>
                <div className="detail-content poem-display">{contentLines.map((line, index) => <p key={`${index}-${line}`}>{line || '\u00a0'}</p>)}</div>
              </article>

              <article className="detail-card-face detail-journal" onClick={() => setCardFlipped(false)}>
                <button className="detail-journal__header" onClick={() => setCardFlipped(false)}><strong className="detail-journal__title poem-display">创作手记</strong><span className="detail-journal__subtitle poem-display">从一束光影，到一首诗</span></button>
                <div className="detail-journal__scroll">
                  {journeyLoading ? <div className="detail-journal__state poem-display">正在展开创作脉络…</div>
                    : journeyError ? <div className="detail-journal__state detail-journal__state--error poem-display">{journeyError}</div>
                    : <div className="detail-timeline">
                        {publication.materials.length ? <div className="detail-materials"><div className="detail-timeline__rail"><span className="detail-timeline__node" /><span className="detail-timeline__line" /></div><div className="detail-materials__body"><strong className="detail-timeline__label poem-display">查看原始素材</strong><span className="detail-timeline__description">创作这首诗时使用的图片与视频</span><div className="detail-materials__list">{publication.materials.map((material) => <button className="detail-materials__item" key={material.id} onClick={(event) => { event.stopPropagation(); window.open(material.url, '_blank') }}><img className="detail-materials__image" src={material.thumbnailUrl || material.url} alt="" /></button>)}</div></div></div> : null}
                        {journeyPrompt ? <div className="detail-original-prompt"><div className="detail-timeline__rail"><span className="detail-timeline__node" /><span className="detail-timeline__line" /></div><div className="detail-original-prompt__body"><strong className="detail-timeline__label poem-display">原始文字要求</strong><span className="detail-timeline__description">创作这首诗时写下的内容</span><div className="detail-original-prompt__content poem-display" onClick={(event) => event.stopPropagation()}>{journeyPrompt}</div></div></div> : null}
                        {journeyMoments.map((moment, index) => <div className={`detail-timeline__moment ${index === journeyMoments.length - 1 ? 'detail-timeline__moment--last' : ''}`} key={moment.id}><div className="detail-timeline__rail"><span className="detail-timeline__node" />{index !== journeyMoments.length - 1 ? <span className="detail-timeline__line" /> : null}</div><div className="detail-timeline__body"><div className="detail-timeline__heading"><div><strong className="detail-timeline__label poem-display">{moment.label}</strong><span className="detail-timeline__description">{moment.description}</span></div>{moment.time ? <time className="detail-timeline__time">{moment.time}</time> : null}</div>{moment.entries.length ? <div className="detail-timeline__notes">{moment.entries.map((entry) => <div className="detail-timeline__note" key={entry}><span className="detail-timeline__note-mark">·</span><span>{entry}</span></div>)}</div> : null}</div></div>)}
                      </div>}
                </div>
              </article>
            </div>
          </div>

          {isPublic ? <button className={`detail-action detail-action--like ${publication.likedByMe ? 'detail-action--liked' : ''}`} onClick={() => void toggleLike()}>
            <span className="detail-like__summary"><span className="like-anchor"><img className={`heart-icon ${showLikeBurst ? 'heart-icon--pop' : ''}`} src={publication.likedByMe ? '/assets/icons/heart-filled.png' : '/assets/icons/heart-outline.png'} alt="" />{showLikeBurst ? <span className="like-burst"><span className="like-burst__ring" />{[1, 2, 3, 4, 5, 6].map((index) => <span key={index} className={`like-burst__particle like-burst__particle--${index}`} />)}</span> : null}</span><span className="detail-like-count">{publication.likeCount}</span></span>
            <span className="detail-like__state">{publication.likedByMe ? '已点赞' : '点赞'}</span>
          </button> : null}

          {canManagePublication ? <div className="detail-display-settings">
            <label className="detail-setting-row"><span className="detail-setting-row__label poem-display">公开创作手记</span><input className="mp-switch detail-setting-row__switch" type="checkbox" checked={creationJournalPublic} disabled={isUpdatingSettings} onChange={(event) => toggleJournalVisibility(event.target.checked)} /></label>
            <div className="detail-setting-row"><span className="detail-setting-row__label poem-display">卡片背景</span><span className="detail-cover-choice"><button className={`detail-cover-choice__item poem-display ${coverSource === 'MATERIAL' ? 'detail-cover-choice__item--active' : ''} ${!materialBackgroundReady ? 'detail-cover-choice__item--disabled' : ''}`} disabled={!materialBackgroundReady} onClick={() => selectCoverSource('MATERIAL')}>原始素材</button><button className={`detail-cover-choice__item poem-display ${coverSource === 'POSTER' ? 'detail-cover-choice__item--active' : ''} ${!posterBackgroundReady ? 'detail-cover-choice__item--disabled' : ''}`} disabled={!posterBackgroundReady} onClick={() => selectCoverSource('POSTER')}>海报图</button></span></div>
          </div> : null}

          <div className="detail-actions">
            <div className="detail-actions__secondary">
              <button className={`detail-action detail-action--save ${!publication.posterReady ? 'detail-action--disabled' : ''}`} disabled={!publication.posterReady} onClick={() => window.open(publication.posterUrl, '_blank')}><img className="detail-action__download-icon" src="/assets/icons/action-download.svg" alt="" /><span>保存到手机</span></button>
              <button className={`detail-action detail-action--share ${!isPublic ? 'detail-action--disabled' : ''}`} disabled={!isPublic} onClick={pendingWechatCapability}><img src="/assets/icons/result-share.png" alt="" /><span>分享给好友</span></button>
            </div>
            {canPublish ? <button className={`detail-action detail-action--publish ${isPublishing ? 'detail-action--disabled' : ''}`} disabled={isPublishing} onClick={() => setShowPublishDialog(true)}><img src="/assets/icons/result-publish.png" alt="" /><span>{isPublishing ? '正在发布' : '发布到诗词圈'}</span></button> : null}
            {isPublic && !isOwner ? <button className={`detail-action detail-action--follow ${followedByMe ? 'detail-action--followed' : ''}`} onClick={() => void toggleFollow()}><img src="/assets/icons/action-follow.png" alt="" /><span>{followedByMe ? '已关注' : '关注作者'}</span></button> : null}
          </div>

          {isPublic ? <section className="detail-comments">
            <header className="detail-comments__header"><h2 className="detail-comments__title poem-display">评论</h2><span className="detail-comments__count">共 {publication.commentCount} 条</span></header>
            <div className={`detail-comment-composer ${replyingTo ? 'detail-comment-composer--focused' : ''}`}>
              {replyingTo ? <div className="detail-comment-composer__replying"><span>回复 {replyingTo.author.nickname}</span><button className="detail-comment-composer__cancel" onClick={() => setReplyingTo(null)}>取消</button></div> : null}
              {user ? <form className="detail-comment-composer__row" onSubmit={submitComment}><textarea className="detail-comment-composer__input poem-display" value={commentDraft} maxLength={300} placeholder={replyingTo ? `回复 ${replyingTo.author.nickname}…` : '写下此刻的感受…'} onChange={(event) => setCommentDraft(event.target.value)} /><button className={`detail-comment-composer__send ${!commentDraft.trim() || isSubmittingComment ? 'detail-comment-composer__send--disabled' : ''}`} disabled={!commentDraft.trim() || isSubmittingComment}>{isSubmittingComment ? '发送中' : '发送'}</button></form> : <button className="detail-comment-composer__login poem-display" onClick={() => setLoginAction('COMMENT')}>登录后写下评论</button>}
            </div>
            {commentsError ? <div className="detail-comments-state"><span className="detail-comments-state__text poem-display">{commentsError}</span><button className="detail-comments-state__action poem-display" onClick={() => void load()}>重新加载</button></div> : commentsLoaded && !comments.length ? <div className="detail-comments-state detail-comments-state--empty"><span className="detail-comments-state__text poem-display">还没有评论，写下第一句共鸣</span></div> : <div className="detail-comment-list">{comments.map((comment) => <article className="detail-comment-item" key={comment.id}><span className="detail-comment-item__avatar poem-display">{comment.author.avatarUrl ? <img src={comment.author.avatarUrl} alt="" /> : comment.author.nickname.slice(0, 1)}</span><div className="detail-comment-item__body"><div className="detail-comment-item__meta"><span className="detail-comment-item__identity"><strong className="detail-comment-item__name poem-display">{comment.author.nickname}</strong>{comment.isPublicationAuthor ? <span className="detail-comment-item__author-tag poem-display">作者</span> : null}</span><time className="detail-comment-item__time">{displayTime(comment.createdAt)}</time></div><p className="detail-comment-item__content poem-display">{comment.content}</p><div className="detail-comment-item__actions"><button className="detail-comment-item__action poem-display" onClick={() => setReplyingTo(comment)}>回复</button>{comment.canDelete ? <button className="detail-comment-item__action detail-comment-item__action--delete poem-display" onClick={() => setDeletingComment(comment)}>{deletingComment?.id === comment.id ? '删除中' : '删除'}</button> : null}</div>{comment.replies?.length ? <div className="detail-comment-replies">{comment.replies.map((reply) => <div className="detail-comment-reply" key={reply.id}><p className="detail-comment-reply__line poem-display"><strong className="detail-comment-reply__name">{reply.author.nickname}</strong>{reply.replyToUser ? <span className="detail-comment-reply__target"> 回复 {reply.replyToUser.nickname}</span> : null}<span>：{reply.content}</span></p><div className="detail-comment-reply__meta"><time className="detail-comment-item__time">{displayTime(reply.createdAt)}</time><button className="detail-comment-item__action poem-display" onClick={() => setReplyingTo(reply)}>回复</button>{reply.canDelete ? <button className="detail-comment-item__action detail-comment-item__action--delete poem-display" onClick={() => setDeletingComment(reply)}>{deletingComment?.id === reply.id ? '删除中' : '删除'}</button> : null}</div></div>)}</div> : null}{!expandedReplies[comment.id] && comment.replyCount > comment.replies.length ? <div className="detail-comment-replies__more">{expandingReplies === comment.id ? <span className="detail-comment-replies__loading poem-display">正在展开回复…</span> : <button className="detail-comment-replies__button poem-display" onClick={() => void expandReplies(comment)}>展开全部 {comment.replyCount} 条回复</button>}</div> : null}</div></article>)}</div>}{commentsNextCursor ? <button className="detail-comments-more poem-display" disabled={isCommentsLoadingMore} onClick={() => void loadMoreComments()}>{isCommentsLoadingMore ? '正在加载更多评论…' : '查看更多评论'}</button> : null}
          </section> : null}
        </div> : loading ? <div className="detail-empty poem-display">正在展开诗笺…</div> : notFound ? <div className="publication-unavailable"><img className="publication-unavailable__illustration" src="/assets/images/empty-works.jpg" alt="" /><h2 className="publication-unavailable__title poem-display">暂无作品</h2><p className="publication-unavailable__copy">这篇作品暂时无法查看</p><button className="publication-unavailable__action poem-display" onClick={() => navigate('/community')}>去诗词圈看看</button><img className="publication-unavailable__mountain" src="/assets/images/mountain-wash.jpg" alt="" /></div> : null}
      </main>

      <WechatDialog open={loginAction !== null} title="登录后继续" content="登录后可以评论、点赞、关注并同步互动状态。" confirmText="登录" onCancel={() => setLoginAction(null)} onConfirm={confirmLogin} />
      <WechatDialog open={deletingComment !== null} title="删除评论" content={deletingComment?.rootCommentId ? '确认删除这条回复吗？' : '该评论下的回复也会一并隐藏，确认删除吗？'} confirmText="删除" onCancel={() => setDeletingComment(null)} onConfirm={confirmDeleteComment} />
      <WechatDialog open={showModerationDialog} title="作品已下架" content="该作品或素材涉嫌违反社区规范" confirmText="我知道了" onCancel={() => setShowModerationDialog(false)} onConfirm={() => setShowModerationDialog(false)} />
      <WechatDialog open={showPublishDialog} title="发布到诗词圈" content="发布后，其他人可以在诗词圈看到这首作品。" confirmText="确认发布" onCancel={() => setShowPublishDialog(false)} onConfirm={() => { setShowPublishDialog(false); void publishToCommunity() }} />
    </div>
  )
}
