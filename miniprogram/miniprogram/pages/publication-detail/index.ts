import { STORAGE_KEYS } from '../../config/api'
import { hasAccessToken } from '../../services/api'
import { cachedUser, loginWithWechat } from '../../services/auth'
import {
  type CommunityComment,
  type CommunityPublication,
  createPublicationComment,
  deletePublicationComment,
  followUser,
  getPublication,
  getPublicUser,
  likePublication,
  loadCommentReplies,
  loadPublicationComments,
  loadPublicationCreationJournal,
  type PublicationCoverSource,
  type PublicationCreationJournalEntry,
  type PublicationMaterial,
  unfollowUser,
  unlikePublication,
  updatePublicationSettings,
} from '../../services/community'
import {
  type CreationHistoryEntry,
  type CreationTimelineEvent,
  loadCreationHistory,
  type PoemCategory,
  type PoemValidationMark,
} from '../../services/creation'
import {
  getLibraryWork,
  getWorkPoster,
  loadTunePatternNames,
  publishLibraryWork,
  restoreLibraryWork,
  type TunePatternNames,
} from '../../services/library'
import { getErrorMessage, showErrorToast } from '../../utils/error'
import { isHanCharacter } from '../../utils/text'

interface PublicationView {
  id: string
  workId: string
  status: 'PUBLISHED' | 'PENDING_REVIEW' | 'HIDDEN' | 'REJECTED'
  visibility: 'PUBLIC' | 'UNLISTED'
  title: string
  content: string
  category: PoemCategory
  classicalFormCode: string | null
  tunePatternCode: string | null
  likeCount: number
  commentCount: number
  likedByMe: boolean
  posterUrl: string
  posterReady: boolean
  generatedBackgroundUrl: string | null
  posterBackgroundReady: boolean
  coverUrl: string | null
  displayCoverUrl: string | null
  materials: PublicationMaterial[]
  creationJournalPublic: boolean
  coverSource: PublicationCoverSource
  canViewCreationJournal: boolean
  hasCreationJournal: boolean
  publishedAt: string | null
  createdAt: string
  selectedGenerationId?: string | null
  validationMarks?: PoemValidationMark[]
  author: {
    id: string
    nickname: string
    avatarAssetId?: string | null
    avatarUrl: string | null
  }
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

interface PoemDisplayRun {
  text: string
  invalid: boolean
}

interface SwitchChangeEvent {
  detail: {
    value: boolean
  }
}

interface TextInputEvent {
  detail: {
    value: string
  }
}

interface CommentView extends Omit<CommunityComment, 'replies'> {
  replies: CommentView[]
  avatarInitial: string
  displayTime: string
  isRepliesLoading: boolean
  repliesExpanded: boolean
  repliesNextCursor: string | null
}

interface CommentReplyTarget {
  id: string
  rootCommentId: string | null
  nickname: string
}

const CLASSICAL_FORM_NAMES: Record<string, string> = {
  WUYAN_JUEJU: '五言绝句',
  QIYAN_JUEJU: '七言绝句',
  WUYAN_LVSHI: '五言律诗',
  QIYAN_LVSHI: '七言律诗',
  DAYOU_SHI: '打油诗',
}

function publicationTypeName(
  publication: Pick<PublicationView, 'category' | 'classicalFormCode' | 'tunePatternCode'>,
  tunePatternNames: TunePatternNames,
): string {
  if (publication.category === 'CLASSICAL') {
    return CLASSICAL_FORM_NAMES[publication.classicalFormCode || ''] || '古体诗'
  }
  if (publication.category === 'CI') {
    return tunePatternNames[publication.tunePatternCode || ''] || '词'
  }
  return '现代诗'
}

function fallbackCover(category: PoemCategory): string {
  if (category === 'MODERN') return '/assets/images/cover-alley.jpg'
  if (category === 'CI') return '/assets/images/cover-sunrise.jpg'
  return '/assets/images/cover-mountain.jpg'
}

function displayDate(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}.${month}.${day}`
}

function commentDisplayTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const differenceMs = Math.max(0, Date.now() - date.getTime())
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (differenceMs < minute) return '刚刚'
  if (differenceMs < hour) return `${Math.floor(differenceMs / minute)}分钟前`
  if (differenceMs < day) return `${Math.floor(differenceMs / hour)}小时前`
  const now = new Date()
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日`
  }
  return `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`
}

function commentView(comment: CommunityComment): CommentView {
  return {
    ...comment,
    replies: comment.replies.map(commentView),
    avatarInitial: comment.author.nickname.slice(0, 1) || '诗',
    displayTime: commentDisplayTime(comment.createdAt),
    isRepliesLoading: false,
    repliesExpanded: false,
    repliesNextCursor: null,
  }
}

function uniqueComments(comments: CommentView[]): CommentView[] {
  const seen = new Set<string>()
  return comments.filter((comment) => {
    if (seen.has(comment.id)) return false
    seen.add(comment.id)
    return true
  })
}

function normalizePoemContent(value: string): string {
  return value.replace(/\\n/g, '\n').replace(/\r\n?/g, '\n')
}

function buildPoemDisplayRuns(
  content: string,
  marks: PoemValidationMark[],
): PoemDisplayRun[] {
  const markedPositions = new Set(marks.map((mark) => `${mark.lineIndex}:${mark.characterIndex}`))
  const runs: PoemDisplayRun[] = []
  let lineIndex = 0
  let characterIndex = 0
  let lineHasHan = false
  for (const character of Array.from(content)) {
    const isHan = isHanCharacter(character)
    const invalid = isHan && markedPositions.has(`${lineIndex}:${characterIndex}`)
    const previous = runs[runs.length - 1]
    if (previous && previous.invalid === invalid) previous.text += character
    else runs.push({ text: character, invalid })
    if (isHan) {
      characterIndex += 1
      lineHasHan = true
    }
    if (/[\n，。！？；!?;]/u.test(character) && lineHasHan) {
      lineIndex += 1
      characterIndex = 0
      lineHasHan = false
    }
  }
  return runs
}

function poemCardHeight(content: string): number {
  const visualLineCount = content.split('\n').reduce((total, line) => {
    const characterCount = [...line.trim()].length
    return total + Math.max(1, Math.ceil(characterCount / 16))
  }, 0)
  return Math.max(1040, 560 + visualLineCount * 52)
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

function usableCover(publication: PublicationView): string {
  if (publication.displayCoverUrl) return publication.displayCoverUrl
  if (
    publication.coverSource === 'POSTER' &&
    publication.posterBackgroundReady &&
    publication.generatedBackgroundUrl
  ) {
    return publication.generatedBackgroundUrl
  }
  return publication.coverUrl || fallbackCover(publication.category)
}

function hasSeenFlipHint(key: string): boolean {
  const value = wx.getStorageSync(STORAGE_KEYS.publicationFlipHints)
  return Array.isArray(value) && value.includes(key)
}

function markFlipHintSeen(key: string) {
  const value = wx.getStorageSync(STORAGE_KEYS.publicationFlipHints)
  const seen = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
  wx.setStorageSync(
    STORAGE_KEYS.publicationFlipHints,
    [...seen.filter((item) => item !== key), key].slice(-100),
  )
}

function confirmLogin(): Promise<boolean> {
  return new Promise((resolve) => {
    wx.showModal({
      title: '登录后继续',
      content: '登录后可以评论、点赞、关注并同步互动状态。',
      confirmText: '登录',
      confirmColor: '#3f6758',
      success: (result) => resolve(result.confirm),
      fail: () => resolve(false),
    })
  })
}

Page({
  data: {
    publication: null as PublicationView | null,
    publicationContentRuns: [] as PoemDisplayRun[],
    categoryName: '',
    publishedDate: '',
    coverUrl: '',
    authorInitial: '诗',
    isLoading: true,
    isPublic: false,
    isOwner: false,
    canManagePublication: false,
    canPublish: false,
    showDetailActions: false,
    isLiking: false,
    canFollow: false,
    followedByMe: false,
    isFollowing: false,
    showLikeBurst: false,
    canViewCreationJourney: false,
    isCardFlipped: false,
    isCardHinting: false,
    isJourneyLoading: false,
    journeyLoaded: false,
    journeyError: '',
    journeyPrompt: '',
    journeyMoments: [] as CreationJourneyMoment[],
    cardHeightRpx: 1040,
    creationJournalPublic: false,
    coverSource: 'MATERIAL' as PublicationCoverSource,
    posterReady: false,
    posterBackgroundReady: false,
    materialBackgroundReady: false,
    isUpdatingSettings: false,
    isSavingPoster: false,
    isPublishing: false,
    comments: [] as CommentView[],
    commentsNextCursor: null as string | null,
    commentsLoaded: false,
    commentsError: '',
    commentsLoadToken: 0,
    isCommentsLoading: false,
    isCommentsLoadingMore: false,
    commentDraft: '',
    replyingTo: null as CommentReplyTarget | null,
    commentInputFocused: false,
    canComment: hasAccessToken(),
    isSubmittingComment: false,
    deletingCommentIds: [] as string[],
  },

  onLoad(options: Record<string, string | undefined>) {
    if (options.id) {
      void this.loadPublication(options.id)
      return
    }
    if (options.workId) {
      void this.loadPrivateWork(options.workId)
      return
    }
    this.setData({ isLoading: false })
  },

  async loadPublication(id: string) {
    try {
      const [publication, tunePatternNames] = await Promise.all([
        getPublication(id),
        loadTunePatternNames().catch(() => ({})),
      ])
      this.applyPublication(publication, true, tunePatternNames)
      void this.loadComments(publication.id)
      const currentUser = cachedUser()
      if (publication.author.id !== currentUser?.id) {
        const author = await getPublicUser(publication.author.id)
        this.setData({
          canFollow: true,
          followedByMe: author.followedByMe,
          ...(author.avatarUrl ? { 'publication.author.avatarUrl': author.avatarUrl } : {}),
        })
      }
    } catch (error) {
      showErrorToast(error, { fallback: '作品加载失败' })
    } finally {
      this.setData({ isLoading: false })
    }
  },

  async loadPrivateWork(workId: string) {
    try {
      const [work, user, tunePatternNames, poster] = await Promise.all([
        getLibraryWork(workId),
        Promise.resolve(cachedUser()),
        loadTunePatternNames().catch(() => ({})),
        getWorkPoster(workId).catch(() => null),
      ])
      if (work.publication?.status === 'PUBLISHED') {
        const publication = await getPublication(work.publication.id)
        this.applyPublication(publication, true, tunePatternNames)
        void this.loadComments(publication.id)
        return
      }
      const materialCoverUrl =
        work.assets?.find((asset) => asset.kind === 'IMAGE' && asset.accessUrl)?.accessUrl ||
        work.assets?.find((asset) => asset.kind === 'VIDEO' && asset.thumbnailUrl)?.thumbnailUrl ||
        null
      const posterReady = Boolean(poster && !poster.isDefault)
      const posterBackgroundReady = Boolean(poster?.backgroundUrl)
      const materialBackgroundReady = Boolean(materialCoverUrl)
      const coverSource: PublicationCoverSource = materialBackgroundReady
        ? work.publication?.coverSource || 'MATERIAL'
        : 'POSTER'
      this.applyPublication({
        id: work.publication?.id || '',
        workId: work.id,
        status: work.publication?.status || 'HIDDEN',
        visibility: 'PUBLIC',
        title: work.title || '未命名作品',
        content: work.content || '',
        category: work.category,
        classicalFormCode: work.classicalFormCode,
        tunePatternCode: work.tunePatternCode,
        likeCount: work.publication?.likeCount || 0,
        commentCount: 0,
        likedByMe: false,
        posterUrl: poster?.url || '',
        posterReady,
        generatedBackgroundUrl: poster?.backgroundUrl || null,
        posterBackgroundReady,
        coverUrl: materialCoverUrl,
        displayCoverUrl:
          coverSource === 'POSTER' && posterBackgroundReady
            ? poster?.backgroundUrl || null
            : materialCoverUrl,
        materials: (work.assets || []).flatMap((asset) => {
          if (!asset.accessUrl) return []
          return [{
            id: asset.id || asset.accessUrl,
            kind: asset.kind,
            url: asset.accessUrl,
            thumbnailUrl: asset.thumbnailUrl || asset.accessUrl,
          }]
        }),
        creationJournalPublic: work.publication?.creationJournalPublic || false,
        coverSource,
        canViewCreationJournal: true,
        hasCreationJournal: Boolean(work.selectedGenerationId),
        publishedAt: null,
        createdAt: work.createdAt,
        selectedGenerationId: work.selectedGenerationId,
        validationMarks: work.latestGeneration?.result?.validation?.marks ?? [],
        author: {
          id: user?.id || '',
          nickname: user?.nickname || '我',
          avatarUrl: user?.avatarUrl || null,
        },
      }, false, tunePatternNames)
    } catch (error) {
      showErrorToast(error, { fallback: '作品加载失败' })
    } finally {
      this.setData({ isLoading: false })
    }
  },

  applyPublication(
    publication: CommunityPublication,
    isPublic: boolean,
    tunePatternNames: TunePatternNames,
  ) {
    const currentUser = cachedUser()
    const authorAvatarUrl =
      publication.author.avatarUrl ||
      (publication.author.id === currentUser?.id ? currentUser.avatarUrl : null)
    const materialBackgroundReady = Boolean(publication.coverUrl)
    const effectiveCoverSource: PublicationCoverSource = materialBackgroundReady
      ? publication.coverSource
      : 'POSTER'
    const normalizedPublication = {
      ...publication,
      content: normalizePoemContent(publication.content),
      materials: Array.isArray(publication.materials) ? publication.materials : [],
      coverSource: effectiveCoverSource,
      author: {
        ...publication.author,
        avatarUrl: authorAvatarUrl,
      },
    }
    const isOwner = normalizedPublication.author.id === currentUser?.id
    const validationMarks = isOwner ? normalizedPublication.validationMarks ?? [] : []
    const canViewCreationJourney = Boolean(
      isOwner
        ? normalizedPublication.selectedGenerationId
        : normalizedPublication.canViewCreationJournal &&
            normalizedPublication.hasCreationJournal,
    )
    this.setData({
      publication: normalizedPublication,
      publicationContentRuns: buildPoemDisplayRuns(
        normalizedPublication.content,
        validationMarks,
      ),
      isPublic,
      isOwner,
      canManagePublication: Boolean(isOwner && normalizedPublication.id),
      canPublish: Boolean(
        isOwner &&
        normalizedPublication.status !== 'PUBLISHED' &&
        normalizedPublication.status !== 'PENDING_REVIEW',
      ),
      showDetailActions: true,
      categoryName: publicationTypeName(normalizedPublication, tunePatternNames),
      publishedDate: displayDate(
        normalizedPublication.publishedAt || normalizedPublication.createdAt,
      ),
      coverUrl: usableCover(normalizedPublication),
      authorInitial: normalizedPublication.author.nickname.slice(0, 1) || '诗',
      canViewCreationJourney,
      isCardFlipped: false,
      isCardHinting: false,
      journeyLoaded: false,
      journeyError: '',
      journeyPrompt: '',
      journeyMoments: [],
      cardHeightRpx: poemCardHeight(normalizedPublication.content),
      creationJournalPublic: normalizedPublication.creationJournalPublic,
      coverSource: normalizedPublication.coverSource,
      posterReady: normalizedPublication.posterReady,
      posterBackgroundReady: normalizedPublication.posterBackgroundReady,
      materialBackgroundReady,
    }, () => this.maybePlayCardHint())
  },

  async loadComments(publicationId: string, append = false) {
    if (!publicationId) return
    if (append && (!this.data.commentsNextCursor || this.data.isCommentsLoadingMore)) return
    const loadToken = this.data.commentsLoadToken + 1
    this.setData({
      commentsLoadToken: loadToken,
      ...(append
        ? { isCommentsLoadingMore: true }
        : {
            comments: [],
            commentsNextCursor: null,
            commentsLoaded: false,
            commentsError: '',
            isCommentsLoading: true,
          }),
    })
    try {
      const response = await loadPublicationComments(
        publicationId,
        append ? this.data.commentsNextCursor || undefined : undefined,
      )
      if (this.data.commentsLoadToken !== loadToken) return
      const nextComments = response.items.map(commentView)
      this.setData({
        comments: append
          ? uniqueComments([...this.data.comments, ...nextComments])
          : nextComments,
        commentsNextCursor: response.nextCursor,
        commentsLoaded: true,
        commentsError: '',
        'publication.commentCount': response.total,
      })
    } catch (error) {
      if (this.data.commentsLoadToken !== loadToken) return
      if (append) {
        showErrorToast(error, { fallback: '更多评论加载失败' })
      } else {
        this.setData({
          commentsLoaded: false,
          commentsError: getErrorMessage(error, '评论暂时无法加载'),
        })
      }
    } finally {
      if (this.data.commentsLoadToken === loadToken) {
        this.setData({ isCommentsLoading: false, isCommentsLoadingMore: false })
      }
    }
  },

  retryComments() {
    const publicationId = this.data.publication?.id
    if (publicationId) void this.loadComments(publicationId)
  },

  loadMoreComments() {
    const publicationId = this.data.publication?.id
    if (publicationId) void this.loadComments(publicationId, true)
  },

  async ensureCommentLogin(): Promise<boolean> {
    if (hasAccessToken()) return true
    if (!(await confirmLogin())) return false
    wx.showLoading({ title: '正在登录', mask: true })
    try {
      await loginWithWechat()
      this.setData({ canComment: true, commentInputFocused: true })
      return true
    } catch (error) {
      showErrorToast(error, { fallback: '登录失败' })
      return false
    } finally {
      wx.hideLoading()
    }
  },

  async activateCommentComposer() {
    if (await this.ensureCommentLogin()) {
      this.setData({ canComment: true, commentInputFocused: true })
    }
  },

  handleCommentInput(event: TextInputEvent) {
    this.setData({ commentDraft: event.detail.value.slice(0, 300) })
  },

  handleCommentInputFocus() {
    this.setData({ commentInputFocused: true })
  },

  handleCommentInputBlur() {
    this.setData({ commentInputFocused: false })
  },

  async beginCommentReply(event: WechatMiniprogram.TouchEvent) {
    if (!(await this.ensureCommentLogin())) return
    const id = String(event.currentTarget.dataset.id || '')
    const nickname = String(event.currentTarget.dataset.nickname || '')
    if (!id || !nickname) return
    const rootCommentIdValue = event.currentTarget.dataset.rootCommentId
    this.setData({
      replyingTo: {
        id,
        nickname,
        rootCommentId:
          typeof rootCommentIdValue === 'string' && rootCommentIdValue
            ? rootCommentIdValue
            : null,
      },
      commentInputFocused: true,
    })
  },

  cancelCommentReply() {
    this.setData({ replyingTo: null, commentInputFocused: false })
  },

  async submitComment() {
    const publication = this.data.publication
    const content = this.data.commentDraft.trim()
    if (!publication?.id || this.data.isSubmittingComment) return
    if (!(await this.ensureCommentLogin())) return
    if (!content) {
      wx.showToast({ title: '请先写下评论', icon: 'none' })
      this.setData({ commentInputFocused: true })
      return
    }
    this.setData({ isSubmittingComment: true })
    try {
      const result = await createPublicationComment(
        publication.id,
        content,
        this.data.replyingTo?.id,
      )
      const created = commentView(result.comment)
      if (created.moderationStatus === 'PASSED') {
        if (created.rootCommentId) {
          const comments = this.data.comments.map((comment) =>
            comment.id === created.rootCommentId
              ? {
                  ...comment,
                  replies: uniqueComments([...comment.replies, created]),
                  replyCount: comment.replyCount + 1,
                }
              : comment,
          )
          this.setData({ comments })
        } else {
          this.setData({ comments: [created, ...this.data.comments] })
        }
        wx.showToast({ title: '评论已发布', icon: 'success' })
      } else {
        wx.showToast({ title: '评论已提交审核', icon: 'none' })
      }
      this.setData({
        commentDraft: '',
        replyingTo: null,
        commentInputFocused: false,
        'publication.commentCount': result.commentCount,
      })
    } catch (error) {
      showErrorToast(error, { fallback: '评论发布失败' })
    } finally {
      this.setData({ isSubmittingComment: false })
    }
  },

  async loadReplies(rootCommentId: string, append: boolean) {
    const publicationId = this.data.publication?.id
    const root = this.data.comments.find((comment) => comment.id === rootCommentId)
    if (!publicationId || !root || root.isRepliesLoading) return
    const cursor = append ? root.repliesNextCursor : null
    if (append && !cursor) return
    this.setData({
      comments: this.data.comments.map((comment) =>
        comment.id === rootCommentId ? { ...comment, isRepliesLoading: true } : comment,
      ),
    })
    try {
      const response = await loadCommentReplies(publicationId, rootCommentId, cursor || undefined)
      const replies = response.items.map(commentView)
      this.setData({
        comments: this.data.comments.map((comment) =>
          comment.id === rootCommentId
            ? {
                ...comment,
                replies: append
                  ? uniqueComments([...comment.replies, ...replies])
                  : replies,
                repliesExpanded: true,
                repliesNextCursor: response.nextCursor,
                hasMoreReplies: response.nextCursor !== null,
                isRepliesLoading: false,
              }
            : comment,
        ),
      })
    } catch (error) {
      this.setData({
        comments: this.data.comments.map((comment) =>
          comment.id === rootCommentId ? { ...comment, isRepliesLoading: false } : comment,
        ),
      })
      showErrorToast(error, { fallback: '回复加载失败' })
    }
  },

  expandCommentReplies(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    if (id) void this.loadReplies(id, false)
  },

  loadMoreCommentReplies(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    if (id) void this.loadReplies(id, true)
  },

  async deleteComment(event: WechatMiniprogram.TouchEvent) {
    const publication = this.data.publication
    const commentId = String(event.currentTarget.dataset.id || '')
    const rootCommentId = String(event.currentTarget.dataset.rootCommentId || commentId)
    const isRoot = commentId === rootCommentId
    if (
      !publication?.id ||
      !commentId ||
      this.data.deletingCommentIds.length > 0
    ) return
    const confirmed = await new Promise<boolean>((resolve) => {
      wx.showModal({
        title: '删除评论',
        content: isRoot ? '该评论下的回复也会一并隐藏，确认删除吗？' : '确认删除这条回复吗？',
        confirmText: '删除',
        confirmColor: '#a75549',
        success: (result) => resolve(result.confirm),
        fail: () => resolve(false),
      })
    })
    if (!confirmed) return
    this.setData({ deletingCommentIds: [...this.data.deletingCommentIds, commentId] })
    try {
      const result = await deletePublicationComment(publication.id, commentId)
      const comments = isRoot
        ? this.data.comments.filter((comment) => comment.id !== commentId)
        : this.data.comments.map((comment) =>
            comment.id === rootCommentId
              ? {
                  ...comment,
                  replies: comment.replies.filter((reply) => reply.id !== commentId),
                  replyCount: Math.max(0, comment.replyCount - result.visibleDeletedCount),
                }
              : comment,
          )
      this.setData({
        comments,
        'publication.commentCount': result.commentCount,
        ...(this.data.replyingTo?.id === commentId ? { replyingTo: null } : {}),
      })
      wx.showToast({ title: '评论已删除', icon: 'success' })
    } catch (error) {
      showErrorToast(error, { fallback: '评论删除失败' })
    } finally {
      this.setData({
        deletingCommentIds: this.data.deletingCommentIds.filter((id) => id !== commentId),
      })
    }
  },

  async loadCreationJourney() {
    const publication = this.data.publication
    const generationId = this.data.publication?.selectedGenerationId
    const canLoadOwnedHistory = Boolean(this.data.isOwner && generationId)
    if (
      !publication ||
      !this.data.canViewCreationJourney ||
      (!canLoadOwnedHistory && (!this.data.isPublic || !publication.id)) ||
      this.data.journeyLoaded ||
      this.data.isJourneyLoading
    ) return
    this.setData({ isJourneyLoading: true, journeyError: '' })
    try {
      const history =
        canLoadOwnedHistory
          ? ownedJourneyHistory(await loadCreationHistory(generationId || ''))
          : publicJourneyHistory(
              await loadPublicationCreationJournal(publication.id),
            )
      const journeyMoments = buildCreationJourney(history)
      const journeyPrompt =
        history.find((entry) => !entry.baseGenerationId && entry.prompt)?.prompt
        || history.find((entry) => entry.prompt)?.prompt
        || ''
      this.setData({
        journeyLoaded: true,
        journeyPrompt,
        journeyMoments,
        journeyError:
          journeyMoments.length === 0
          && !journeyPrompt
          && publication.materials.length === 0
            ? '这首诗暂时没有可展示的创作手记'
            : '',
      })
    } catch (error) {
      this.setData({
        journeyError: getErrorMessage(error, '创作手记加载失败'),
      })
    } finally {
      this.setData({ isJourneyLoading: false })
    }
  },

  toggleCreationCard() {
    if (!this.data.canViewCreationJourney || this.data.isCardHinting) return
    const isCardFlipped = !this.data.isCardFlipped
    this.setData({ isCardFlipped })
    if (isCardFlipped) void this.loadCreationJourney()
  },

  preventCardFlip() {},

  previewOriginalMaterial(event: WechatMiniprogram.TouchEvent) {
    const publication = this.data.publication
    const materialId = String(event.currentTarget.dataset.id || '')
    const current = publication?.materials.findIndex(
      (material) => material.id === materialId,
    ) ?? -1
    if (!publication || current < 0) return
    wx.previewMedia({
      current,
      sources: publication.materials.map((material) => ({
        url: material.url,
        type: material.kind === 'VIDEO' ? 'video' : 'image',
        ...(material.thumbnailUrl ? { poster: material.thumbnailUrl } : {}),
      })),
    })
  },

  maybePlayCardHint() {
    const publication = this.data.publication
    if (!publication || !this.data.canViewCreationJourney) return
    const workKey = publication.id
      ? `publication:${publication.id}`
      : `work:${publication.workId}`
    const hintKey = `flip-v2:${cachedUser()?.id || 'guest'}:${workKey}`
    if (hasSeenFlipHint(hintKey)) return
    markFlipHintSeen(hintKey)
    void this.loadCreationJourney()
    this.setData({ isCardFlipped: false, isCardHinting: true })
    setTimeout(() => {
      if (this.data.isCardHinting) this.setData({ isCardHinting: false })
    }, 5200)
  },

  handleCardHintEnd() {
    if (this.data.isCardHinting) this.setData({ isCardHinting: false })
  },

  async savePublicationSettings(nextSettings: {
    creationJournalPublic: boolean
    coverSource: PublicationCoverSource
  }) {
    const publication = this.data.publication
    if (!publication?.id || !this.data.isOwner || this.data.isUpdatingSettings) return
    const previous = {
      creationJournalPublic: this.data.creationJournalPublic,
      coverSource: this.data.coverSource,
      coverUrl: this.data.coverUrl,
    }
    const optimisticCoverUrl =
      nextSettings.coverSource === 'POSTER' &&
      publication.posterBackgroundReady &&
      publication.generatedBackgroundUrl
        ? publication.generatedBackgroundUrl
        : publication.coverUrl || fallbackCover(publication.category)
    this.setData({
      ...nextSettings,
      coverUrl: optimisticCoverUrl,
      isUpdatingSettings: true,
    })
    try {
      const updated = await updatePublicationSettings(publication.id, nextSettings)
      const normalizedPublication: PublicationView = {
        ...publication,
        ...updated,
        author: {
          ...publication.author,
          ...updated.author,
          avatarUrl: updated.author.avatarUrl || publication.author.avatarUrl,
        },
      }
      this.setData({
        publication: normalizedPublication,
        creationJournalPublic: updated.creationJournalPublic,
        coverSource: updated.coverSource,
        coverUrl: usableCover(normalizedPublication),
      })
      wx.setStorageSync(STORAGE_KEYS.communityNeedsRefresh, true)
    } catch (error) {
      this.setData(previous)
      showErrorToast(error, { fallback: '展示设置保存失败' })
    } finally {
      this.setData({ isUpdatingSettings: false })
    }
  },

  handleJournalVisibilityChange(event: SwitchChangeEvent) {
    void this.savePublicationSettings({
      creationJournalPublic: event.detail.value,
      coverSource: this.data.coverSource,
    })
  },

  selectCoverSource(event: {
    currentTarget: {
      dataset: {
        source?: PublicationCoverSource
      }
    }
  }) {
    const source = event.currentTarget.dataset.source
    if (
      !source ||
      source === this.data.coverSource ||
      this.data.isUpdatingSettings
    ) return
    if (source === 'POSTER' && !this.data.posterBackgroundReady) {
      wx.showToast({ title: '海报背景尚未生成完成', icon: 'none' })
      return
    }
    if (source === 'MATERIAL' && !this.data.materialBackgroundReady) {
      wx.showToast({ title: '没有可用的原始素材背景', icon: 'none' })
      return
    }
    void this.savePublicationSettings({
      creationJournalPublic: this.data.creationJournalPublic,
      coverSource: source,
    })
  },

  async publishToCommunity() {
    const publication = this.data.publication
    if (
      !publication ||
      !this.data.isOwner ||
      !this.data.canPublish ||
      this.data.isPublishing
    ) return
    const confirmed = await new Promise<boolean>((resolve) => {
      wx.showModal({
        title: '发布到诗词圈',
        content: '发布后，其他人可以在诗词圈看到这首作品。',
        confirmText: '确认发布',
        confirmColor: '#2f6855',
        success: (result) => resolve(result.confirm),
        fail: () => resolve(false),
      })
    })
    if (!confirmed) return

    this.setData({ isPublishing: true })
    wx.showLoading({ title: '正在发布', mask: true })
    try {
      let publicationId = publication.id
      let nextStatus: PublicationView['status'] = 'PUBLISHED'
      if (publication.status === 'HIDDEN' && publication.id) {
        await restoreLibraryWork(publication.workId)
      } else {
        const created = await publishLibraryWork(publication.workId)
        publicationId = created.id
        nextStatus = created.status
      }

      this.setData({
        canPublish: false,
        'publication.status': nextStatus,
        'publication.id': publicationId,
      })
      wx.setStorageSync(STORAGE_KEYS.communityNeedsRefresh, true)

      if (nextStatus === 'PUBLISHED' && publicationId) {
        const [published, tunePatternNames] = await Promise.all([
          getPublication(publicationId),
          loadTunePatternNames().catch(() => ({})),
        ])
        this.applyPublication(published, true, tunePatternNames)
        void this.loadComments(publicationId)
      }
      wx.showToast({
        title: nextStatus === 'PUBLISHED' ? '已发布到诗词圈' : '已提交审核',
        icon: 'success',
      })
    } catch (error) {
      showErrorToast(error, { fallback: '发布失败' })
    } finally {
      wx.hideLoading()
      this.setData({ isPublishing: false })
    }
  },

  async savePosterToAlbum() {
    const publication = this.data.publication
    if (!publication?.posterReady || !publication.posterUrl || this.data.isSavingPoster) {
      wx.showToast({ title: '有字海报尚未生成完成', icon: 'none' })
      return
    }
    this.setData({ isSavingPoster: true })
    wx.showLoading({ title: '正在保存海报', mask: true })
    try {
      const tempFilePath = await new Promise<string>((resolve, reject) => {
        wx.downloadFile({
          url: publication.posterUrl,
          success: (result) => {
            if (result.statusCode >= 200 && result.statusCode < 300) {
              resolve(result.tempFilePath)
            } else {
              reject(new Error('海报下载失败'))
            }
          },
          fail: reject,
        })
      })
      await new Promise<void>((resolve, reject) => {
        wx.saveImageToPhotosAlbum({
          filePath: tempFilePath,
          success: () => resolve(),
          fail: reject,
        })
      })
      wx.showToast({ title: '已保存到相册', icon: 'success' })
    } catch (error) {
      const message =
        error && typeof error === 'object' && 'errMsg' in error
          ? String(error.errMsg)
          : error instanceof Error
            ? error.message
            : '保存失败'
      if (/auth deny|authorize|permission/i.test(message)) {
        wx.showModal({
          title: '需要相册权限',
          content: '请在设置中允许诗云保存图片到相册。',
          confirmText: '去设置',
          confirmColor: '#3f6758',
          success: (result) => {
            if (result.confirm) wx.openSetting()
          },
        })
      } else {
        wx.showToast({ title: message, icon: 'none' })
      }
    } finally {
      wx.hideLoading()
      this.setData({ isSavingPoster: false })
    }
  },

  triggerLikeBurst() {
    this.setData({ showLikeBurst: false }, () => {
      this.setData({ showLikeBurst: true })
      setTimeout(() => {
        this.setData({ showLikeBurst: false })
      }, 760)
    })
  },

  async toggleLike() {
    const publication = this.data.publication
    if (!publication?.id || this.data.isLiking) return
    if (!hasAccessToken()) {
      if (!(await confirmLogin())) return
      wx.showLoading({ title: '正在登录', mask: true })
      try {
        await loginWithWechat()
      } catch (error) {
        showErrorToast(error, { fallback: '登录失败' })
        return
      } finally {
        wx.hideLoading()
      }
    }
    const likedByMe = !publication.likedByMe
    const optimisticPublication = {
      ...publication,
      likedByMe,
      likeCount: Math.max(0, publication.likeCount + (likedByMe ? 1 : -1)),
    }
    this.setData({ isLiking: true, publication: optimisticPublication })
    if (likedByMe) {
      this.triggerLikeBurst()
    }
    try {
      if (publication.likedByMe) {
        await unlikePublication(publication.id)
      } else {
        await likePublication(publication.id)
      }
    } catch (error) {
      this.setData({ publication, showLikeBurst: false })
      showErrorToast(error, { fallback: '操作失败' })
    } finally {
      this.setData({ isLiking: false })
    }
  },

  async toggleFollow() {
    const publication = this.data.publication
    if (!publication || !this.data.canFollow || this.data.isFollowing) return
    if (!hasAccessToken()) {
      if (!(await confirmLogin())) return
      wx.showLoading({ title: '正在登录', mask: true })
      try {
        await loginWithWechat()
      } catch (error) {
        showErrorToast(error, { fallback: '登录失败' })
        return
      } finally {
        wx.hideLoading()
      }
    }
    this.setData({ isFollowing: true })
    try {
      if (this.data.followedByMe) {
        await unfollowUser(publication.author.id)
      } else {
        await followUser(publication.author.id)
      }
      this.setData({ followedByMe: !this.data.followedByMe })
    } catch (error) {
      showErrorToast(error, { fallback: '操作失败' })
    } finally {
      this.setData({ isFollowing: false })
    }
  },

  onShareAppMessage() {
    const publication = this.data.publication
    return {
      title: publication ? `《${publication.title}》` : '诗云',
      path: publication?.id
        ? `/pages/publication-detail/index?id=${encodeURIComponent(publication.id)}`
        : '/pages/community/index',
    }
  },
})
