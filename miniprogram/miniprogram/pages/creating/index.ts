import { hasAccessToken } from '../../services/api'
import {
  cachedUser,
  loginWithWechat,
  restoreSession,
  updateWechatProfile,
} from '../../services/auth'
import {
  type ActiveCreationRun,
  cancelCreationRun,
  clearActiveCreationRun,
  clearPendingCreation,
  type CreationQueueStatus,
  discardActiveCreationRun,
  discardPendingCreation,
  getActiveCreationRun,
  getPendingCreation,
  loadCreationHistory,
  loadCreationRunSnapshot,
  loadCreationRunSnapshotById,
  loadPoemTaxonomies,
  type PendingCreation,
  type PoemResult,
  type PoemValidationMark,
  prepareCreationShare,
  publishCreation,
  requestCreationReset,
  saveCreationAsDraft,
  saveCreationRunDraft,
  saveCreationAsWork,
  savePendingCreation,
  startCreationRun,
  updateActiveCreationCursor,
} from '../../services/creation'
import { createPublicationShareLink } from '../../services/community'
import { ensureInstallation } from '../../services/installation'
import { type SseEvent, type SseSubscription, openSseStream } from '../../services/sse'
import { getErrorMessage, showErrorToast } from '../../utils/error'
import {
  errorLogFields,
  reportRealtimeInfo,
  reportRealtimeWarn,
} from '../../utils/realtime-log'
import { isHanCharacter } from '../../utils/text'

type StepState = 'waiting' | 'active' | 'done'
type StepKey = 'MATERIAL_ANALYSIS' | 'POETIC_RETRIEVAL' | 'POEM_GENERATION'

interface CreatingStep {
  key: StepKey
  title: string
  detail: string
  state: StepState
  expanded: boolean
  traces: string[]
  liveProgress: string
}

interface CreationRevision {
  generationId: string
  label: string
  instruction: string
  state: StepState
  expanded: boolean
  traces: string[]
  liveProgress: string
}

interface TraceTypingTarget {
  kind: 'stage' | 'revision'
  index: number
  text: string
}

interface PoemDisplayRun {
  key: string
  text: string
  invalid: boolean
}

interface PendingPoemPreview {
  title: string
  content: string
  attempt: number
}

interface PoemPresentationEvent {
  event: string
  data: Record<string, unknown>
}

interface ValueChangeEvent {
  detail: {
    value: string
  }
}

type AvatarChoiceEvent = WechatMiniprogram.CustomEvent<{ avatarUrl: string }>

function initialSteps(): CreatingStep[] {
  return [
    {
      key: 'MATERIAL_ANALYSIS',
      title: '理解素材',
      detail: '正在观察素材中的细节…',
      state: 'active',
      expanded: true,
      traces: [],
      liveProgress: '',
    },
    {
      key: 'POETIC_RETRIEVAL',
      title: '检索诗意',
      detail: '等待素材理解完成',
      state: 'waiting',
      expanded: true,
      traces: [],
      liveProgress: '',
    },
    {
      key: 'POEM_GENERATION',
      title: '生成诗词',
      detail: '等待诗意线索汇集',
      state: 'waiting',
      expanded: true,
      traces: [],
      liveProgress: '',
    },
  ]
}

function queuedInitialSteps(): CreatingStep[] {
  return initialSteps().map((step) => ({
    ...step,
    state: 'waiting' as const,
    detail: '等待创作资源',
  }))
}

function errorMessage(error: unknown): string {
  return getErrorMessage(error, '创作暂时中断，请稍后重试')
}

function stripPoemLeadingWhitespace(value: string): string {
  return value.replace(/^[\s\u00a0\u3000]+/u, '')
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
  let absoluteIndex = 0

  const append = (text: string, invalid: boolean) => {
    const previous = runs[runs.length - 1]
    if (previous && previous.invalid === invalid) previous.text += text
    else runs.push({ key: `${absoluteIndex}-${invalid ? 'invalid' : 'normal'}`, text, invalid })
  }

  for (const character of Array.from(content)) {
    const isHan = isHanCharacter(character)
    const invalid = isHan && markedPositions.has(`${lineIndex}:${characterIndex}`)
    append(character, invalid)
    if (isHan) {
      characterIndex += 1
      lineHasHan = true
    }
    if ((/[\n，。！？；!?;]/u.test(character)) && lineHasHan) {
      lineIndex += 1
      characterIndex = 0
      lineHasHan = false
    }
    absoluteIndex += 1
  }
  return runs
}

function categoryLabel(active: ActiveCreationRun): string {
  if (active.preferences.category === 'MODERN') return '现代诗'
  if (active.preferences.category === 'CI') {
    return active.preferences.tunePatternCode || '词'
  }
  const forms: Record<string, string> = {
    WUYAN_JUEJU: '五言绝句',
    QIYAN_JUEJU: '七言绝句',
    WUYAN_LVSHI: '五言律诗',
    QIYAN_LVSHI: '七言律诗',
    DAYOU_SHI: '打油诗',
  }
  return active.preferences.classicalFormCode
    ? forms[active.preferences.classicalFormCode] || '古体诗'
    : '古体诗'
}

function revisionLabel(index: number): string {
  const numerals = ['二', '三', '四', '五', '六', '七', '八', '九', '十']
  return `${numerals[index] || `第${index + 2}`}次创作`
}

function confirmLogin(): Promise<boolean> {
  return new Promise((resolve) => {
    wx.showModal({
      title: '登录后保存',
      content: '登录后可以保存作品，并发布到诗词圈。',
      confirmText: '登录',
      confirmColor: '#3f6758',
      success: (result) => resolve(result.confirm),
      fail: () => resolve(false),
    })
  })
}

Page({
  data: {
    activeRun: null as ActiveCreationRun | null,
    steps: initialSteps(),
    poemTitle: '',
    poemContent: '',
    poemDisplayRuns: [] as PoemDisplayRun[],
    poemCategoryLabel: '古体诗',
    streamMessage: '正在连接创作服务…',
    isFailed: false,
    failureAction: 'RECONNECT' as 'RECONNECT' | 'RECREATE',
    coreReady: false,
    finished: false,
    creation: null as PendingCreation | null,
    title: '',
    isSavingDraft: false,
    isSaving: false,
    isPublishing: false,
    isPreparingFriendShare: false,
    friendShareReady: false,
    friendSharePath: '',
    isRecreating: false,
    isTyping: false,
    isErasingPoem: false,
    isLeaving: false,
    showExitDraftDialog: false,
    showProfileSetup: false,
    isSavingProfile: false,
    pendingAvatarUrl: '',
    pendingNickname: '',
    resumeSaveAfterProfile: false,
    isReplayMode: false,
    openedFromDraft: false,
    hasUnsavedChanges: false,
    showAdjustmentSheet: false,
    adjustmentInstruction: '',
    adjustmentInputFocus: false,
    canSubmitAdjustment: false,
    keyboardHeight: 0,
    keyboardDuration: 200,
    isAdjusting: false,
    revisions: [] as CreationRevision[],
    isQueued: false,
    queueAhead: 0,
  },

  stream: null as SseSubscription | null,
  reconnectCount: 0,
  typingTimer: null as ReturnType<typeof setTimeout> | null,
  poemEraseTimer: null as ReturnType<typeof setTimeout> | null,
  pendingPoemPreview: null as PendingPoemPreview | null,
  poemQueue: [] as string[],
  finalPoemContent: '',
  receivedPoemContent: '',
  validationMarks: [] as PoemValidationMark[],
  poemPresentationQueue: [] as PoemPresentationEvent[],
  isPresentingPoemEvent: false,
  isDispatchingPoemEvent: false,
  poemReviewTimer: null as ReturnType<typeof setTimeout> | null,
  generationAttempt: 1,
  generationMode: 'WRITING' as 'WRITING' | 'VALIDATING',
  pendingPoeticInsights: [] as string[],
  coreConfirmed: false,
  isApplyingHistoricalEvents: false,
  draftBaselineTitle: '',
  draftBaselineGenerationId: '',
  draftBaselineCreation: null as PendingCreation | null,
  activeRevisionIndex: -1,
  traceTypingTimer: null as ReturnType<typeof setTimeout> | null,
  traceTypingQueue: [] as TraceTypingTarget[],
  activeTraceTyping: null as (TraceTypingTarget & { traceIndex: number; offset: number }) | null,
  queuePollingTimer: null as ReturnType<typeof setTimeout> | null,

  onLoad(query: Record<string, string | undefined>) {
    wx.hideShareMenu()
    const openedFromDraft = query.mode === 'draft' || query.fromDraft === '1'
    this.setData({ openedFromDraft })
    const replayRunId = query.generationId || (query.mode === 'replay' ? query.runId : '')
    if (replayRunId) {
      void this.openCreationReplay(replayRunId, query.mode === 'draft')
      return
    }
    const activeRun = getActiveCreationRun()
    if (!activeRun || (query.runId && query.runId !== activeRun.runId)) {
      const pending = getPendingCreation()
      if (pending) {
        this.restorePendingCreation(pending)
        return
      }
      this.setData({
        isFailed: true,
        streamMessage: '没有找到正在进行的创作',
      })
      return
    }
    this.setData({
      activeRun,
      ...(activeRun.queue?.state === 'QUEUED' ? { steps: queuedInitialSteps() } : {}),
      poemCategoryLabel: categoryLabel(activeRun),
      isQueued: activeRun.queue?.state === 'QUEUED',
      queueAhead: activeRun.queue?.ahead ?? 0,
    })
    void this.resolveTunePatternLabel(activeRun.preferences.tunePatternCode)
    void this.restoreDurableTimeline(activeRun)
  },

  onUnload() {
    if (!this.data.isReplayMode) requestCreationReset()
    this.stream?.abort()
    this.stream = null
    this.clearTypingTimer()
    this.clearPoemPresentation()
    this.clearPoemErase()
    this.clearTraceTyping()
    this.stopQueuePolling()
    this.stopGenerationProgress()
  },

  connectStream() {
    const active = this.data.activeRun
    if (!active || this.data.finished) return
    this.stream?.abort()
    this.stream = openSseStream({
      path: active.eventsUrl,
      cursor: active.lastEventId,
      onEvent: (event) => this.handleStreamEvent(event),
      onError: (error) => this.handleStreamError(error),
      onClosed: () => {
        if (!this.data.finished && !this.data.coreReady && !this.data.isFailed) {
          void this.recoverFromSnapshot()
        }
      },
    })
    this.startQueuePolling()
  },

  applyQueueStatus(queue: CreationQueueStatus | null) {
    const active = this.data.activeRun
    if (active) {
      const updated = { ...active, queue }
      this.setData({ activeRun: updated })
    }
    if (!queue) {
      this.stopQueuePolling()
      this.setData({ isQueued: false, queueAhead: 0 })
      return
    }
    this.setData({
      isQueued: true,
      queueAhead: Math.max(0, queue.ahead),
      streamMessage:
        queue.ahead > 0
          ? `前方还有 ${queue.ahead} 个创作任务`
          : '已排到队首，正在等待创作资源',
    })
    if (this.activeRevisionIndex >= 0) {
      this.setData({ [`revisions[${this.activeRevisionIndex}].state`]: 'waiting' })
    } else if (!this.data.steps.some((step) => step.state === 'done')) {
      this.setData({ steps: queuedInitialSteps() })
    }
  },

  startQueuePolling() {
    if (this.queuePollingTimer || this.data.finished || this.data.coreReady) return
    void this.refreshQueueStatus()
  },

  stopQueuePolling() {
    if (this.queuePollingTimer) clearTimeout(this.queuePollingTimer)
    this.queuePollingTimer = null
  },

  async refreshQueueStatus() {
    const active = this.data.activeRun
    if (!active || this.data.finished || this.data.coreReady) {
      this.stopQueuePolling()
      return
    }
    try {
      const snapshot = await loadCreationRunSnapshot(active)
      this.applyQueueStatus(snapshot.queue)
      if (!snapshot.queue) return
    } catch {
      // The live stream remains authoritative when a queue-position refresh briefly fails.
    }
    this.stopQueuePolling()
    this.queuePollingTimer = setTimeout(() => {
      this.queuePollingTimer = null
      void this.refreshQueueStatus()
    }, 2_500 + Math.round(Math.random() * 800))
  },

  async restoreDurableTimeline(active: ActiveCreationRun) {
    try {
      const history = await loadCreationHistory(active.runId)
      const animateCurrentRun = !this.data.openedFromDraft && active.lastEventId === '0-0'
      this.resetCreationHistory()
      this.isApplyingHistoricalEvents = true
      try {
        for (const entry of history) {
          for (const event of entry.events) {
            const data = { ...event.data, seq: event.seq }
            if (
              animateCurrentRun
              && entry.snapshot.generationId === active.runId
              && this.shouldSequencePoemEvent(event.event, data)
            ) {
              this.enqueuePoemPresentation({ event: event.event, data })
            } else {
              this.handleStreamEvent({ id: '', event: event.event, data })
            }
          }
        }
      } finally {
        this.isApplyingHistoricalEvents = false
      }
      const latest = history[history.length - 1]?.snapshot
      if (latest) {
        if (latest.lastEventId && latest.lastEventId !== active.lastEventId) {
          const resumedActive = { ...active, lastEventId: latest.lastEventId }
          this.setData({ activeRun: resumedActive })
          updateActiveCreationCursor(latest.lastEventId)
        }
        if (
          latest.coreStatus === 'QUEUED'
          && latest.baseGenerationId
          && latest.input.instruction
        ) {
          this.ensureRevision(latest.generationId, latest.input.instruction, 'waiting')
        }
        this.restoreSnapshotInsights(latest)
        if (
          latest.coreStatus === 'SUCCEEDED'
          && latest.result
          && !(animateCurrentRun && (
            this.isPresentingPoemEvent || this.poemPresentationQueue.length > 0
          ))
        ) {
          this.restoreCompletedSnapshot(latest.result)
        } else if (latest.coreStatus === 'FAILED' || latest.coreStatus === 'CANCELED') {
          this.setData({
            isFailed: true,
            failureAction: 'RECREATE',
            streamMessage: latest.error?.message || '本次创作没有完成',
          })
        }
      }
    } catch {
      // Redis remains available for a live run if durable history cannot be loaded temporarily.
    }
    if (this.data.finished) clearActiveCreationRun()
    if (!this.data.finished && !this.data.coreReady) this.connectStream()
  },

  async openCreationReplay(runId: string, editableDraft = false) {
    if (editableDraft) this.draftBaselineGenerationId = runId
    this.setData({
      isReplayMode: !editableDraft,
      streamMessage: '正在展开创作手记…',
    })
    try {
      const snapshot = await loadCreationRunSnapshotById(runId)
      if (!snapshot.input.preferences) {
        throw new Error('这次创作缺少可回放的偏好数据')
      }
      const active: ActiveCreationRun = {
        runId,
        eventsUrl: `/creation-runs/${encodeURIComponent(runId)}/events`,
        snapshotUrl: `/creation-runs/${encodeURIComponent(runId)}`,
        creationId: snapshot.creationId,
        creationVersion: snapshot.creationVersion,
        prompt: snapshot.input.prompt,
        assetIds: snapshot.input.assetIds,
        assetKinds: [],
        preferences: snapshot.input.preferences,
        posterEnabled: snapshot.posterStatus !== 'NOT_REQUESTED',
        remainingQuota: null,
        lastEventId: snapshot.lastEventId,
        queue: snapshot.queue,
      }
      this.setData({
        activeRun: active,
        poemCategoryLabel: categoryLabel(active),
      })
      void this.resolveTunePatternLabel(active.preferences.tunePatternCode)
      if (editableDraft && snapshot.coreStatus === 'SUCCEEDED' && snapshot.result) {
        const stored = getPendingCreation()
        const creation: PendingCreation =
          stored?.generationId === runId
            ? stored
            : {
                prompt: active.prompt,
                assetIds: active.assetIds,
                assetKinds: active.assetKinds,
                preferences: active.preferences,
                generationId: runId,
                workId: active.creationId,
                result: snapshot.result,
                remainingQuota: active.remainingQuota,
                draftSaved: true,
                saved: false,
                published: false,
              }
        this.draftBaselineTitle = creation.result.title
        this.draftBaselineCreation = creation
        savePendingCreation(creation)
        this.restorePendingCreation(creation)
        this.setData({
          activeRun: active,
          openedFromDraft: true,
          hasUnsavedChanges: false,
        })
        return
      }
      const history = await loadCreationHistory(runId)
      this.resetCreationHistory()
      this.isApplyingHistoricalEvents = true
      try {
        for (const entry of history) {
          for (const event of entry.events) {
            this.handleStreamEvent({
              id: '',
              event: event.event,
              data: { ...event.data, seq: event.seq },
            })
          }
        }
      } finally {
        this.isApplyingHistoricalEvents = false
      }
      const latest = history[history.length - 1]?.snapshot || snapshot
      this.restoreSnapshotInsights(latest)
      if (latest.result) this.applyReplayResult(latest.result)
      if (editableDraft) {
        const pending = getPendingCreation()
        if (pending?.generationId === runId) {
          this.draftBaselineTitle = pending.result.title
          this.draftBaselineCreation = pending
          this.setData({
            creation: pending,
            title: pending.result.title,
            openedFromDraft: true,
            hasUnsavedChanges: false,
          })
        }
      }
      if (editableDraft && !this.draftBaselineTitle) {
        this.draftBaselineTitle = snapshot.result?.title ?? ''
        this.setData({
          openedFromDraft: true,
          hasUnsavedChanges: false,
        })
      }
      this.setData({
        finished: true,
        streamMessage: '完整创作过程已展开',
      })
    } catch (error) {
      this.setData({
        isFailed: true,
        streamMessage: errorMessage(error),
      })
    }
  },

  restoreSnapshotInsights(snapshot: Awaited<ReturnType<typeof loadCreationRunSnapshotById>>) {
    const analysis = snapshot.materialAnalysis
    if (!analysis) return
    this.appendStageTraces(
      'MATERIAL_ANALYSIS',
      (analysis.publicNarrative || []).map((text) => text.trim()).filter(Boolean),
    )
    this.appendStageTraces('POETIC_RETRIEVAL', [
      ...(analysis.symbols || []).map((symbol, index) => `意象 ${index + 1} · ${symbol.trim()}`),
      ...(analysis.scenes?.length ? [`场景线索 · ${analysis.scenes.join('、')}`] : []),
      ...(analysis.mood?.length ? [`情绪底色 · ${analysis.mood.join('、')}`] : []),
    ])
  },

  async resolveTunePatternLabel(tunePatternCode: string | null) {
    if (!tunePatternCode) return
    try {
      const taxonomies = await loadPoemTaxonomies()
      const ci = taxonomies.categories.find((category) => category.code === 'CI')
      const pattern = ci?.tunePatterns?.find((item) => item.code === tunePatternCode)
      if (pattern?.name) this.setData({ poemCategoryLabel: pattern.name })
    } catch {
      // The creation stream remains usable when taxonomy display data is unavailable.
    }
  },

  appendStageTrace(stage: StepKey, text: string) {
    this.appendStageTraces(stage, [text])
  },

  appendStageTraces(stage: StepKey, texts: string[]) {
    const normalized = texts.map((text) => text.trim()).filter(Boolean)
    if (normalized.length === 0) return
    const index = this.data.steps.findIndex((step) => step.key === stage)
    if (index < 0) return
    const step = this.data.steps[index]
    if (!step) return
    const existing = new Set(step.traces)
    const additions = normalized.filter((text) => !existing.has(text))
    if (additions.length === 0) return
    this.setData({
      [`steps[${index}].traces`]: [...step.traces, ...additions],
      [`steps[${index}].expanded`]: true,
    })
  },

  resetCreationHistory() {
    this.clearTraceTyping()
    this.activeRevisionIndex = -1
    this.setData({
      steps: this.data.isQueued ? queuedInitialSteps() : initialSteps(),
      revisions: [],
      finished: false,
      coreReady: false,
      isFailed: false,
    })
  },

  ensureRevision(generationId: string, instruction: string, state: StepState = 'active') {
    const existingIndex = this.data.revisions.findIndex(
      (revision) => revision.generationId === generationId,
    )
    if (existingIndex >= 0) {
      this.activeRevisionIndex = existingIndex
      this.setData({
        [`revisions[${existingIndex}].state`]: state,
        [`revisions[${existingIndex}].expanded`]: true,
      })
      return existingIndex
    }
    const index = this.data.revisions.length
    const revision: CreationRevision = {
      generationId,
      label: revisionLabel(index),
      instruction: instruction.trim() || '沿用原要求重新创作',
      state,
      expanded: true,
      traces: [],
      liveProgress: '',
    }
    this.activeRevisionIndex = index
    this.setData({ revisions: [...this.data.revisions, revision] })
    return index
  },

  toggleRevision(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index)
    const revision = this.data.revisions[index]
    if (!revision || revision.traces.length === 0) return
    this.setData({ [`revisions[${index}].expanded`]: !revision.expanded })
  },

  appendRevisionTrace(index: number, text: string) {
    const normalized = text.trim()
    const revision = this.data.revisions[index]
    if (!normalized || !revision || revision.traces.includes(normalized)) return
    this.setData({
      [`revisions[${index}].traces`]: [...revision.traces, normalized],
      [`revisions[${index}].expanded`]: true,
    })
  },

  appendCreationTrace(text: string) {
    if (this.activeRevisionIndex >= 0) {
      this.appendRevisionTrace(this.activeRevisionIndex, text)
    } else {
      this.appendStageTrace('POEM_GENERATION', text)
    }
  },

  enqueueTypedTrace(target: TraceTypingTarget) {
    const text = target.text.trim()
    if (!text) return
    if (this.isApplyingHistoricalEvents && !this.isDispatchingPoemEvent) {
      if (target.kind === 'revision') this.appendRevisionTrace(target.index, text)
      else this.appendStageTrace(this.data.steps[target.index]?.key || 'POEM_GENERATION', text)
      return
    }
    const existing =
      target.kind === 'revision'
        ? this.data.revisions[target.index]?.traces
        : this.data.steps[target.index]?.traces
    if (
      existing?.includes(text)
      || this.traceTypingQueue.some(
        (queued: TraceTypingTarget) =>
          queued.kind === target.kind && queued.index === target.index && queued.text === text,
      )
      || (
        this.activeTraceTyping?.kind === target.kind
        && this.activeTraceTyping.index === target.index
        && this.activeTraceTyping.text === text
      )
    ) return
    this.traceTypingQueue.push({ ...target, text })
    if (!this.traceTypingTimer && !this.activeTraceTyping) this.typeNextTraceCharacter()
  },

  enqueueTypedStageTrace(stage: StepKey, text: string) {
    const index = this.data.steps.findIndex((step) => step.key === stage)
    if (index >= 0) this.enqueueTypedTrace({ kind: 'stage', index, text })
  },

  enqueueTypedStageTraces(stage: StepKey, texts: string[]) {
    for (const text of texts) this.enqueueTypedStageTrace(stage, text)
  },

  enqueueTypedCreationTrace(text: string) {
    if (this.activeRevisionIndex >= 0) {
      this.enqueueTypedTrace({ kind: 'revision', index: this.activeRevisionIndex, text })
    } else {
      this.enqueueTypedStageTrace('POEM_GENERATION', text)
    }
  },

  typeNextTraceCharacter() {
    if (!this.activeTraceTyping) {
      const next = this.traceTypingQueue.shift()
      if (!next) {
        if (this.coreConfirmed && !this.data.isTyping) this.finalizeCoreReady()
        return
      }
      const traces =
        next.kind === 'revision'
          ? this.data.revisions[next.index]?.traces
          : this.data.steps[next.index]?.traces
      if (!traces) {
        this.typeNextTraceCharacter()
        return
      }
      const traceIndex = traces.length
      const path =
        next.kind === 'revision'
          ? `revisions[${next.index}]`
          : `steps[${next.index}]`
      this.setData({
        [`${path}.traces`]: [...traces, ''],
        [`${path}.expanded`]: true,
      })
      this.activeTraceTyping = { ...next, traceIndex, offset: 0 }
    }
    const active = this.activeTraceTyping
    if (!active) return
    const characters = Array.from(String(active.text)) as string[]
    const character = characters[active.offset]
    if (character === undefined) {
      this.activeTraceTyping = null
      this.typeNextTraceCharacter()
      return
    }
    active.offset += 1
    const path =
      active.kind === 'revision'
        ? `revisions[${active.index}].traces[${active.traceIndex}]`
        : `steps[${active.index}].traces[${active.traceIndex}]`
    this.setData({ [path]: characters.slice(0, active.offset).join('') })
    const delay = /[。！？；]/.test(character)
      ? 105
      : /[，、：]/.test(character)
        ? 62
        : 32
    this.traceTypingTimer = setTimeout(() => {
      this.traceTypingTimer = null
      this.typeNextTraceCharacter()
    }, delay)
  },

  clearTraceTyping() {
    if (this.traceTypingTimer) clearTimeout(this.traceTypingTimer)
    this.traceTypingTimer = null
    this.traceTypingQueue = []
    this.activeTraceTyping = null
  },

  updateStageProgress(stage: StepKey, text: string) {
    const progress = text.trim()
    if (!progress) return
    if (stage === 'POEM_GENERATION' && this.activeRevisionIndex >= 0) {
      const revision = this.data.revisions[this.activeRevisionIndex]
      if (!revision) return
      this.setData({
        [`revisions[${this.activeRevisionIndex}].liveProgress`]: progress,
        [`revisions[${this.activeRevisionIndex}].expanded`]: true,
      })
      return
    }
    const index = this.data.steps.findIndex((step) => step.key === stage)
    if (index < 0) return
    const step = this.data.steps[index]
    if (!step) return
    this.setData({
      [`steps[${index}].liveProgress`]: progress,
      [`steps[${index}].expanded`]: true,
    })
  },

  clearStageProgress(stage: StepKey) {
    if (stage === 'POEM_GENERATION' && this.activeRevisionIndex >= 0) {
      if (this.data.revisions[this.activeRevisionIndex]) {
        this.setData({ [`revisions[${this.activeRevisionIndex}].liveProgress`]: '' })
      }
      return
    }
    const index = this.data.steps.findIndex((step) => step.key === stage)
    if (index >= 0 && this.data.steps[index]?.liveProgress) {
      this.setData({ [`steps[${index}].liveProgress`]: '' })
    }
  },

  startGenerationProgress(mode: 'WRITING' | 'VALIDATING', attempt = 1) {
    this.generationMode = mode
    this.generationAttempt = attempt
    if (mode === 'VALIDATING') {
      this.updateStageProgress('POEM_GENERATION', `正在进行第 ${attempt} 轮格律审校`)
    } else if (attempt > 1) {
      this.updateStageProgress('POEM_GENERATION', `正在进行第 ${attempt} 轮落笔`)
    }
  },

  refreshGenerationProgress() {
    if (this.generationMode === 'VALIDATING') {
      this.updateStageProgress(
        'POEM_GENERATION',
        `正在进行第 ${this.generationAttempt} 轮格律审校`,
      )
      return
    }
    const receivedContent = String(this.receivedPoemContent || '')
    const chars = Array.from(receivedContent).filter((char) => !/\s/.test(char)).length
    const lines = receivedContent
      ? receivedContent.split(/\r?\n/).filter((line: string) => line.trim()).length
      : 0
    this.updateStageProgress(
      'POEM_GENERATION',
      chars > 0
        ? `第 ${this.generationAttempt} 轮正文已落下 ${chars} 字 / ${lines} 行`
        : '正在根据以上意象组织诗句',
    )
  },

  stopGenerationProgress() {
    this.clearStageProgress('POEM_GENERATION')
  },

  clearTypingTimer() {
    if (this.typingTimer) clearTimeout(this.typingTimer)
    this.typingTimer = null
    this.poemQueue = []
  },

  clearPoemErase() {
    if (this.poemEraseTimer) clearTimeout(this.poemEraseTimer)
    this.poemEraseTimer = null
    this.pendingPoemPreview = null
    if (this.data.isErasingPoem) this.setData({ isErasingPoem: false })
  },

  clearPoemPresentation() {
    if (this.poemReviewTimer) clearTimeout(this.poemReviewTimer)
    this.poemReviewTimer = null
    this.poemPresentationQueue = []
    this.isPresentingPoemEvent = false
    this.isDispatchingPoemEvent = false
  },

  applyPoemPreview(preview: PendingPoemPreview) {
    const content = stripPoemLeadingWhitespace(preview.content)
    if (!content) return
    this.clearTypingTimer()
    this.finalPoemContent = ''
    this.receivedPoemContent = content
    this.validationMarks = []
    this.generationAttempt = preview.attempt
    this.pendingPoemPreview = null
    if (this.isApplyingHistoricalEvents && !this.isDispatchingPoemEvent) {
      this.setData({
        poemTitle: preview.title || '无题',
        poemContent: content,
        poemDisplayRuns: buildPoemDisplayRuns(content, []),
        isTyping: false,
        isErasingPoem: false,
      })
      return
    }
    this.setData({
      poemTitle: preview.title || '无题',
      poemContent: '',
      poemDisplayRuns: [],
      isTyping: false,
      isErasingPoem: false,
      streamMessage: `第 ${preview.attempt} 稿已经写成，正在誊写并审校`,
    })
    this.enqueuePoemText(content)
  },

  erasePoemForRewrite(attempt: number) {
    this.clearTypingTimer()
    this.finalPoemContent = ''
    this.receivedPoemContent = ''
    if (
      (this.isApplyingHistoricalEvents && !this.isDispatchingPoemEvent)
      || !this.data.poemContent
    ) {
      this.validationMarks = []
      this.setData({
        poemContent: '',
        poemDisplayRuns: [],
        isTyping: false,
        isErasingPoem: false,
      })
      return
    }
    if (this.poemEraseTimer) clearTimeout(this.poemEraseTimer)
    this.setData({
      isTyping: false,
      isErasingPoem: true,
      streamMessage: `第 ${attempt} 稿已经写成，正在擦去旧稿`,
    })
    this.poemEraseTimer = setTimeout(() => {
      this.poemEraseTimer = null
      this.validationMarks = []
      const pending = this.pendingPoemPreview
      this.setData({
        poemContent: '',
        poemDisplayRuns: [],
        isErasingPoem: false,
      }, () => {
        if (pending) this.applyPoemPreview(pending)
        if (this.isPresentingPoemEvent) this.completePoemPresentation()
      })
    }, 420)
  },

  updatePoemContent(content: string) {
    this.setData({
      poemContent: content,
      poemDisplayRuns: buildPoemDisplayRuns(content, this.validationMarks),
    })
  },

  applyValidationMarks(marks: PoemValidationMark[]) {
    this.validationMarks = marks
    this.setData({
      poemDisplayRuns: buildPoemDisplayRuns(this.data.poemContent, marks),
    })
  },

  applyValidationStarted(data: Record<string, unknown>) {
    const attempt = Number(data.attempt || this.generationAttempt)
    const message = `正在进行第 ${attempt} 轮格律与押韵校验`
    this.setData({ streamMessage: message })
    this.enqueueTypedCreationTrace(message)
    this.startGenerationProgress('VALIDATING', attempt)
  },

  applyValidationCompleted(data: Record<string, unknown>) {
    const issues = Array.isArray(data.issues)
      ? data.issues.filter((issue): issue is string => typeof issue === 'string').slice(0, 3)
      : []
    const message = data.valid
      ? `${String(data.rhymeBook || '')}格律校验通过${data.meterSummary ? `：${String(data.meterSummary)}` : ''}`
      : Number(data.attempt || 1) >= 3
        ? `三轮审校完成，问题字已标注；当前版本仍可保存${issues.length ? `：${issues.join('；')}` : ''}`
        : `格律校验未通过${issues.length ? `：${issues.join('；')}` : '，正在按审校意见重写'}`
    this.setData({ streamMessage: message })
    const marks = Array.isArray(data.marks)
      ? data.marks.filter(
          (mark): mark is PoemValidationMark =>
            Boolean(mark)
            && Number.isInteger(mark.lineIndex)
            && Number.isInteger(mark.characterIndex)
            && typeof mark.character === 'string',
        )
      : []
    this.applyValidationMarks(data.valid ? [] : marks)
    this.enqueueTypedCreationTrace(message)
    this.stopGenerationProgress()
  },

  shouldSequencePoemEvent(event: string, data: Record<string, unknown>) {
    return event === 'poem.preview'
      || event === 'validation.started'
      || event === 'validation.completed'
      || event === 'poem.completed'
      || event === 'core.done'
      || (event === 'poem.reset' && data.reason === 'VALIDATION_REWRITE')
      || (event === 'poem.progress' && String(data.text || '').trim().startsWith('审校 ·'))
  },

  enqueuePoemPresentation(event: PoemPresentationEvent) {
    this.poemPresentationQueue.push(event)
    this.processNextPoemPresentation()
  },

  processNextPoemPresentation() {
    if (this.isPresentingPoemEvent) return
    const next = this.poemPresentationQueue.shift()
    if (!next) return
    this.isPresentingPoemEvent = true
    this.isDispatchingPoemEvent = true
    try {
      this.handleStreamEvent({ id: '', event: next.event, data: next.data })
    } finally {
      this.isDispatchingPoemEvent = false
    }
    if (
      (next.event === 'poem.preview' || next.event === 'poem.completed')
      && (this.data.isTyping || this.poemQueue.length > 0)
    ) return
    if (
      next.event === 'poem.reset'
      && next.data.reason === 'VALIDATION_REWRITE'
      && this.data.isErasingPoem
    ) return
    if (next.event === 'validation.completed') {
      this.poemReviewTimer = setTimeout(() => {
        this.poemReviewTimer = null
        this.completePoemPresentation()
      }, 900)
      return
    }
    this.completePoemPresentation()
  },

  completePoemPresentation() {
    if (!this.isPresentingPoemEvent) return
    this.isPresentingPoemEvent = false
    this.processNextPoemPresentation()
  },

  finishTyping() {
    this.typingTimer = null
    this.setData({ isTyping: false }, () => {
      if (this.isPresentingPoemEvent) this.completePoemPresentation()
      else if (this.coreConfirmed && !this.activeTraceTyping && this.traceTypingQueue.length === 0) {
        this.finalizeCoreReady()
      }
    })
  },

  enqueuePoemText(text: string) {
    if (!text) return
    this.poemQueue.push(...Array.from(text))
    if (!this.typingTimer) {
      this.setData({ isTyping: true })
      this.typeNextCharacter()
    }
  },

  typeNextCharacter() {
    let character = this.poemQueue.shift()
    if (character === undefined) {
      if (this.finalPoemContent && this.data.poemContent !== this.finalPoemContent) {
        if (this.finalPoemContent.startsWith(this.data.poemContent)) {
          this.poemQueue.push(...Array.from(
            this.finalPoemContent.slice(this.data.poemContent.length),
          ))
        } else {
          this.updatePoemContent(this.finalPoemContent)
          this.finishTyping()
          return
        }
      }
      if (this.poemQueue.length === 0) {
        this.finishTyping()
        return
      }
      character = this.poemQueue.shift()
    }
    if (character === undefined) {
      this.finishTyping()
      return
    }
    this.updatePoemContent(`${this.data.poemContent}${character}`)
    const delay = /[。！？；]/.test(character)
      ? 220
      : /[，、：]/.test(character)
        ? 125
        : character === '\n'
          ? 180
          : 68
    this.typingTimer = setTimeout(() => {
      this.typingTimer = null
      this.typeNextCharacter()
    }, delay)
  },

  finalizeCoreReady() {
    if (this.data.coreReady) return
    const steps =
      this.activeRevisionIndex >= 0
        ? this.data.steps
        : this.data.steps.map((step): CreatingStep => ({
            ...step,
            state: 'done',
            detail: '已完成',
          }))
    const revisionIndex = this.activeRevisionIndex
    if (revisionIndex >= 0) {
      this.setData({
        [`revisions[${revisionIndex}].state`]: 'done',
        [`revisions[${revisionIndex}].expanded`]: true,
      })
    }
    this.setData({
      steps,
      coreReady: true,
      streamMessage: '诗词创作与审校已经完成',
    })
    this.appendCreationTrace('诗词创作与审校已经完成')
  },

  setStage(stage: StepKey, completed: boolean) {
    const stageIndex = this.data.steps.findIndex((step) => step.key === stage)
    if (stageIndex < 0) return
    const steps = this.data.steps.map((step, index): CreatingStep => {
      if (index < stageIndex || (index === stageIndex && completed)) {
        return { ...step, state: 'done', detail: '已完成' }
      }
      if (index === stageIndex) {
        return { ...step, state: 'active', detail: '正在进行…', expanded: true }
      }
      return { ...step, state: 'waiting' }
    })
    if (completed && steps[stageIndex + 1]) {
      steps[stageIndex + 1] = {
        ...steps[stageIndex + 1],
        state: 'active',
        detail: '正在进行…',
        expanded: true,
      }
    }
    this.setData({ steps })
  },

  toggleStage(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index)
    const step = this.data.steps[index]
    if (!step || step.state !== 'done' || step.traces.length === 0) return
    this.setData({ [`steps[${index}].expanded`]: !step.expanded })
  },

  handleStreamEvent(event: SseEvent) {
    if (event.id && !this.data.isReplayMode) {
      const activeRun = this.data.activeRun
      if (activeRun) {
        const updated = { ...activeRun, lastEventId: event.id }
        this.setData({ activeRun: updated })
        updateActiveCreationCursor(event.id)
      }
    }

    const data = event.data
    if (
      !this.isDispatchingPoemEvent
      && !this.isApplyingHistoricalEvents
      && this.shouldSequencePoemEvent(event.event, data)
    ) {
      this.enqueuePoemPresentation({ event: event.event, data })
      return
    }
    if (this.data.isQueued) this.applyQueueStatus(null)
    if (event.event === 'revision.started') {
      const generationId = String(data.generationId || this.data.activeRun?.runId || '')
      const instruction = String(data.instruction || '')
      const revisionIndex = this.ensureRevision(generationId, instruction, 'active')
      this.setData({ streamMessage: `${this.data.revisions[revisionIndex]?.label || '本轮'}正在创作` })
      return
    }
    if (event.event === 'stage.started') {
      const stage = String(data.stage) as StepKey
      const message = String(data.message || '正在创作…')
      if (stage === 'POEM_GENERATION' && (data.revision || this.activeRevisionIndex >= 0)) {
        if (this.activeRevisionIndex >= 0) {
          this.setData({
            [`revisions[${this.activeRevisionIndex}].state`]: 'active',
            [`revisions[${this.activeRevisionIndex}].expanded`]: true,
            streamMessage: message,
          })
          this.enqueueTypedCreationTrace(message)
          this.startGenerationProgress('WRITING', 1)
        }
        return
      }
      this.setStage(stage, false)
      this.setData({ streamMessage: message })
      if (stage === 'POEM_GENERATION') {
        // “正在落笔”必须立即可见，不能排在前序逐字日志之后，
        // 否则模型已经开始生成时用户仍会误以为流程停在上一阶段。
        this.appendStageTrace(stage, message)
      } else {
        this.enqueueTypedStageTrace(stage, message)
      }
      if (stage === 'POETIC_RETRIEVAL') {
        const insights = this.pendingPoeticInsights as string[]
        this.enqueueTypedStageTraces(stage, insights)
        this.pendingPoeticInsights = []
      }
      if (stage === 'POEM_GENERATION') {
        this.startGenerationProgress('WRITING', 1)
      }
      return
    }
    if (event.event === 'stage.completed') {
      const stage = String(data.stage) as StepKey
      if (stage === 'POEM_GENERATION' && this.activeRevisionIndex >= 0) {
        this.setData({ [`revisions[${this.activeRevisionIndex}].state`]: 'done' })
        return
      }
      this.setStage(stage, true)
      if (stage === 'POETIC_RETRIEVAL') {
        this.enqueueTypedStageTrace(stage, '素材意象与创作偏好已经汇集成诗意线索')
      }
      return
    }
    if (event.event === 'analysis.delta') {
      const text = String(data.text || '').trim()
      if (text) {
        this.setData({ streamMessage: text })
        this.enqueueTypedStageTrace('MATERIAL_ANALYSIS', text)
      }
      return
    }
    if (event.event === 'analysis.completed') {
      this.enqueueTypedStageTrace('MATERIAL_ANALYSIS', '素材观察已经汇集成创作线索')
      const symbols = Array.isArray(data.symbols)
        ? data.symbols.filter(
            (item): item is string => typeof item === 'string' && Boolean(item.trim()),
          )
        : []
      const scenes = Array.isArray(data.scenes)
        ? data.scenes.filter(
            (item): item is string => typeof item === 'string' && Boolean(item.trim()),
          )
        : []
      const mood = Array.isArray(data.mood)
        ? data.mood.filter(
            (item): item is string => typeof item === 'string' && Boolean(item.trim()),
          )
        : []
      this.pendingPoeticInsights = [
        ...symbols.slice(0, 12).map(
          (symbol, index) => `意象 ${index + 1} · ${symbol.trim()}`,
        ),
        ...(scenes.length > 0 ? [`场景线索 · ${scenes.slice(0, 4).join('、')}`] : []),
        ...(mood.length > 0 ? [`情绪底色 · ${mood.slice(0, 5).join('、')}`] : []),
      ]
      return
    }
    if (event.event === 'retrieval.delta') {
      const text = String(data.text || '').trim()
      if (text) {
        this.setData({ streamMessage: text })
        this.enqueueTypedStageTrace('POETIC_RETRIEVAL', text)
      }
      return
    }
    if (event.event === 'retrieval.completed') {
      const symbols = Array.isArray(data.symbols)
        ? data.symbols.filter(
            (item): item is string => typeof item === 'string' && Boolean(item.trim()),
          )
        : []
      const scenes = Array.isArray(data.scenes)
        ? data.scenes.filter(
            (item): item is string => typeof item === 'string' && Boolean(item.trim()),
          )
        : []
      const mood = Array.isArray(data.mood)
        ? data.mood.filter(
            (item): item is string => typeof item === 'string' && Boolean(item.trim()),
          )
        : []
      const styleTags = Array.isArray(data.styleTags)
        ? data.styleTags.filter(
            (item): item is string => typeof item === 'string' && Boolean(item.trim()),
          )
        : []
      const publicNarrative = Array.isArray(data.publicNarrative)
        ? data.publicNarrative.filter(
            (item): item is string => typeof item === 'string' && Boolean(item.trim()),
          )
        : []
      this.enqueueTypedStageTraces('POETIC_RETRIEVAL', [
        ...publicNarrative,
        ...symbols.slice(0, 12).map(
          (symbol, index) => `意象 ${index + 1} · ${symbol.trim()}`,
        ),
        ...(scenes.length > 0 ? [`场景线索 · ${scenes.slice(0, 4).join('、')}`] : []),
        ...(mood.length > 0 ? [`情绪底色 · ${mood.slice(0, 5).join('、')}`] : []),
        ...(styleTags.length > 0 ? [`风格取向 · ${styleTags.slice(0, 5).join('、')}`] : []),
      ])
      return
    }
    if (event.event === 'poem.thinking') {
      const text = String(data.text || '').trim()
      if (text) {
        this.setData({ streamMessage: text })
        this.updateStageProgress('POEM_GENERATION', text)
      }
      return
    }
    if (event.event === 'poem.progress') {
      const text = String(data.text || '').trim()
      if (text) {
        this.clearStageProgress('POEM_GENERATION')
        this.setData({ streamMessage: text })
        this.enqueueTypedCreationTrace(text)
        if (data.phase === 'VALIDATION_REWRITE_STARTED') {
          const attempt = Math.max(2, Number(data.attempt || this.generationAttempt + 1))
          this.startGenerationProgress('WRITING', attempt)
        }
      }
      return
    }
    if (event.event === 'poem.meta') {
      const title = String(data.title || '无题')
      const attempt = Number(data.attempt || 1)
      this.generationAttempt = attempt
      this.clearStageProgress('POEM_GENERATION')
      this.setData({ poemTitle: title })
      this.enqueueTypedCreationTrace(`已拟定诗题《${title}》`)
      return
    }
    if (event.event === 'poem.delta') {
      const rawDelta = String(data.delta || '')
      const delta = this.receivedPoemContent
        ? rawDelta
        : stripPoemLeadingWhitespace(rawDelta)
      if (!delta) return
      this.receivedPoemContent += delta
      this.enqueuePoemText(delta)
      this.refreshGenerationProgress()
      return
    }
    if (event.event === 'poem.preview') {
      const preview: PendingPoemPreview = {
        title: String(data.title || '无题'),
        content: String(data.content || ''),
        attempt: Math.max(1, Number(data.attempt || this.generationAttempt)),
      }
      if (!preview.content.trim()) return
      if (this.data.isErasingPoem) {
        this.pendingPoemPreview = preview
      } else {
        this.applyPoemPreview(preview)
      }
      return
    }
    if (event.event === 'poem.reset') {
      const attempt = Number(data.attempt || this.generationAttempt + 1)
      const isValidationRewrite = data.reason === 'VALIDATION_REWRITE'
      const message = isValidationRewrite
        ? '新一稿已经写成，正在替换审校未通过的旧稿'
        : '模型响应出现波动，正在自动重新落笔'
      if (isValidationRewrite) {
        this.erasePoemForRewrite(attempt)
        this.enqueueTypedCreationTrace(message)
        this.startGenerationProgress('WRITING', attempt)
        return
      }
      this.clearPoemErase()
      this.clearTypingTimer()
      this.finalPoemContent = ''
      this.receivedPoemContent = ''
      this.validationMarks = []
      this.setData({
        poemTitle: '',
        poemContent: '',
        poemDisplayRuns: [],
        isTyping: false,
        isErasingPoem: false,
        streamMessage: message,
      })
      this.enqueueTypedCreationTrace(message)
      this.startGenerationProgress('WRITING', attempt)
      return
    }
    if (event.event === 'validation.started') {
      this.applyValidationStarted(data)
      return
    }
    if (event.event === 'validation.completed') {
      this.applyValidationCompleted(data)
      return
    }
    if (event.event === 'poem.completed') {
      if (this.isApplyingHistoricalEvents && !this.isDispatchingPoemEvent) return
      if (this.data.isReplayMode) {
        this.applyReplayResult(data as unknown as PoemResult)
      } else {
        this.prepareResult(data as unknown as PoemResult)
      }
      return
    }
    if (event.event === 'core.done' && data.status === 'SUCCEEDED') {
      if (this.isApplyingHistoricalEvents && !this.isDispatchingPoemEvent) return
      this.stopGenerationProgress()
      this.coreConfirmed = true
      if (
        this.data.isTyping
        || this.poemQueue.length > 0
        || Boolean(this.activeTraceTyping)
        || this.traceTypingQueue.length > 0
      ) {
        this.setData({ streamMessage: '诗稿已经完成，正在逐字落纸…' })
      } else {
        this.finalizeCoreReady()
      }
      return
    }
    if (event.event === 'poster.started') {
      this.appendCreationTrace('正在生成配套诗笺')
      return
    }
    if (event.event === 'poster.ready') {
      this.appendCreationTrace('配套诗笺已经生成')
      return
    }
    if (event.event === 'run.done') {
      if (this.isApplyingHistoricalEvents) return
      this.setData({ finished: true })
      if (!this.data.isReplayMode && !this.isApplyingHistoricalEvents) {
        clearActiveCreationRun()
        requestCreationReset()
      }
      return
    }
    if (event.event === 'error') {
      if (data.scope === 'POSTER' && (this.data.coreReady || this.coreConfirmed)) {
        this.appendCreationTrace(String(data.message || '诗笺生成暂未完成，诗词作品不受影响'))
        return
      }
      const message = String(data.message || '创作暂时中断，请稍后重试')
      const failureAction =
        data.scope === 'CORE' || data.code === 'POEM_VALIDATION_FAILED' || data.retryable === false
          ? 'RECREATE'
          : 'RECONNECT'
      this.setData({ isFailed: true, failureAction, streamMessage: message })
      const activeStep = this.data.steps.find((step) => step.state === 'active')
      if (this.activeRevisionIndex >= 0) this.appendCreationTrace(message)
      else if (activeStep) this.appendStageTrace(activeStep.key, message)
    }
  },

  prepareResult(result: PoemResult) {
    const active = this.data.activeRun
    const content = stripPoemLeadingWhitespace(result.content || '')
    if (!active || !content) return
    const normalizedResult = { ...result, content }
    const baselineDraft = this.data.openedFromDraft ? this.draftBaselineCreation : null
    const creation: PendingCreation = {
      prompt: active.prompt,
      assetIds: active.assetIds,
      assetKinds: active.assetKinds,
      preferences: active.preferences,
      generationId: active.runId,
      workId: active.creationId || baselineDraft?.workId || null,
      result: normalizedResult,
      remainingQuota: active.remainingQuota,
      draftSaved: false,
      saved: false,
      published: false,
      ...(baselineDraft?.localDraftId ? { localDraftId: baselineDraft.localDraftId } : {}),
      ...(baselineDraft?.localUpdatedAt ? { localUpdatedAt: baselineDraft.localUpdatedAt } : {}),
    }
    this.finalPoemContent = content
    const scheduledContent = `${this.data.poemContent}${this.poemQueue.join('')}`
    if (content.startsWith(scheduledContent)) {
      this.enqueuePoemText(content.slice(scheduledContent.length))
    } else if (!this.data.poemContent && this.poemQueue.length === 0) {
      this.enqueuePoemText(content)
    } else if (scheduledContent !== content) {
      this.clearTypingTimer()
      this.setData({ poemContent: '', poemDisplayRuns: [], isTyping: false })
      this.enqueuePoemText(content)
    }
    savePendingCreation(creation)
    this.setData({
      creation,
      title: result.title,
      poemTitle: result.title,
      hasUnsavedChanges:
        this.data.hasUnsavedChanges
        || Boolean(
          this.data.openedFromDraft
          && this.draftBaselineGenerationId
          && active.runId !== this.draftBaselineGenerationId,
        ),
    })
  },

  applyReplayResult(result: PoemResult) {
    const content = stripPoemLeadingWhitespace(result.content || '')
    this.clearTypingTimer()
    this.finalPoemContent = content
    this.receivedPoemContent = content
    this.validationMarks = result.validation?.marks ?? []
    this.coreConfirmed = true
    this.setData({
      title: result.title,
      poemTitle: result.title,
      poemContent: content,
      poemDisplayRuns: buildPoemDisplayRuns(content, this.validationMarks),
      isTyping: false,
      coreReady: true,
      steps: this.data.steps.map((step): CreatingStep => ({
        ...step,
        state: 'done',
        detail: '已完成',
        expanded: step.traces.length > 0,
      })),
    })
  },

  restoreCompletedSnapshot(result: PoemResult) {
    this.prepareResult(result)
    this.clearTypingTimer()
    const content = stripPoemLeadingWhitespace(result.content || '')
    this.finalPoemContent = content
    this.receivedPoemContent = content
    this.validationMarks = result.validation?.marks ?? []
    this.coreConfirmed = true
    const revisionIndex = this.activeRevisionIndex
    if (revisionIndex >= 0) {
      this.setData({ [`revisions[${revisionIndex}].state`]: 'done' })
    }
    this.setData({
      poemTitle: result.title || '无题',
      poemContent: content,
      poemDisplayRuns: buildPoemDisplayRuns(content, this.validationMarks),
      isTyping: false,
      coreReady: true,
      finished: true,
      streamMessage: '诗词创作与审校已经完成',
      steps: this.data.steps.map((step): CreatingStep => ({
        ...step,
        state: 'done',
        detail: '已完成',
      })),
    })
  },

  restorePendingCreation(creation: PendingCreation) {
    this.clearTypingTimer()
    const content = stripPoemLeadingWhitespace(creation.result.content)
    const normalizedCreation = {
      ...creation,
      result: { ...creation.result, content },
    }
    this.finalPoemContent = content
    this.receivedPoemContent = content
    this.validationMarks = creation.result.validation?.marks ?? []
    this.coreConfirmed = true
    this.setData({
      creation: normalizedCreation,
      title: creation.result.title,
      poemTitle: creation.result.title,
      poemContent: content,
      poemDisplayRuns: buildPoemDisplayRuns(content, this.validationMarks),
      poemCategoryLabel:
        creation.result.category === 'MODERN'
          ? '现代诗'
          : creation.result.category === 'CI'
            ? '词'
            : '古体诗',
      steps: initialSteps().map((step) => ({
        ...step,
        state: 'done' as const,
        detail: '已完成',
        expanded: false,
      })),
      coreReady: true,
      finished: true,
      streamMessage: '诗词创作与审校已经完成',
      friendShareReady: false,
      friendSharePath: '',
    }, () => {
      if (creation.saved) void this.prepareCreationFriendShare(normalizedCreation)
    })
    void this.resolveTunePatternLabel(creation.result.tunePatternCode)
  },

  async recoverFromSnapshot() {
    const active = this.data.activeRun
    if (!active || this.data.finished || this.data.coreReady) return
    try {
      const snapshot = await loadCreationRunSnapshot(active)
      const recoveredTrace = Array.isArray(snapshot.materialAnalysis?.publicNarrative)
        ? snapshot.materialAnalysis.publicNarrative
            .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
            .map((item) => item.trim())
            .slice(-30)
        : []
      for (const trace of recoveredTrace) {
        this.appendStageTrace('MATERIAL_ANALYSIS', trace)
      }
      const recoveredSymbols = Array.isArray(snapshot.materialAnalysis?.symbols)
        ? snapshot.materialAnalysis.symbols.filter(
            (item): item is string => typeof item === 'string' && Boolean(item.trim()),
          )
        : []
      for (const [index, symbol] of recoveredSymbols.slice(0, 12).entries()) {
        this.appendStageTrace('POETIC_RETRIEVAL', `意象 ${index + 1} · ${symbol.trim()}`)
      }
      const recoveredMood = Array.isArray(snapshot.materialAnalysis?.mood)
        ? snapshot.materialAnalysis.mood.filter(
            (item): item is string => typeof item === 'string' && Boolean(item.trim()),
          )
        : []
      if (recoveredMood.length > 0) {
        this.appendStageTrace(
          'POETIC_RETRIEVAL',
          `情绪底色 · ${recoveredMood.slice(0, 5).join('、')}`,
        )
      }
      if (snapshot.coreStatus === 'SUCCEEDED' && snapshot.result) {
        this.prepareResult(snapshot.result)
        this.clearTypingTimer()
        const content = stripPoemLeadingWhitespace(snapshot.result.content)
        this.finalPoemContent = content
        this.receivedPoemContent = content
        this.validationMarks = snapshot.result.validation?.marks ?? []
        this.coreConfirmed = true
        const steps = this.data.steps.map((step): CreatingStep => ({
          ...step,
          state: 'done',
          detail: '已完成',
        }))
        this.setData({
          steps,
          coreReady: true,
          streamMessage: '诗词创作与审校已经完成',
          poemTitle: snapshot.result.title || '无题',
          poemContent: content,
          poemDisplayRuns: buildPoemDisplayRuns(content, this.validationMarks),
        })
        this.appendStageTrace('POEM_GENERATION', '诗词创作与审校已经完成')
        return
      }
      if (snapshot.coreStatus === 'FAILED' || snapshot.coreStatus === 'CANCELED') {
        this.setData({
          isFailed: true,
          failureAction: 'RECREATE',
          streamMessage: snapshot.error?.message || '本次创作没有完成',
        })
        return
      }
      if (this.reconnectCount < 3) {
        this.reconnectCount += 1
        setTimeout(() => this.connectStream(), 700)
      } else {
        this.setData({ isFailed: true, streamMessage: '进度连接已断开，可点击重试' })
      }
    } catch (error) {
      this.handleStreamError(error)
    }
  },

  handleStreamError(error: unknown) {
    if (this.data.finished || this.data.coreReady) return
    if (this.reconnectCount < 3) {
      this.reconnectCount += 1
      this.setData({ streamMessage: '连接波动，正在恢复创作进度…' })
      setTimeout(() => void this.recoverFromSnapshot(), 700)
      return
    }
    this.setData({ isFailed: true, streamMessage: errorMessage(error) })
  },

  handleRetry() {
    if (this.data.finished || this.data.coreReady) return
    this.reconnectCount = 0
    this.setData({ isFailed: false, streamMessage: '正在重新连接…' })
    void this.recoverFromSnapshot()
  },

  handleFailureAction() {
    if (this.data.failureAction === 'RECREATE') {
      if (!this.data.isRecreating) void this.performRecreate()
      return
    }
    this.handleRetry()
  },

  handleTitleInput(event: ValueChangeEvent) {
    const title = event.detail.value
    const generationChanged = Boolean(
      this.data.creation
      && this.draftBaselineGenerationId
      && this.data.creation.generationId !== this.draftBaselineGenerationId,
    )
    this.setData({
      title,
      hasUnsavedChanges:
        this.data.openedFromDraft
        && (title.trim() !== this.draftBaselineTitle.trim() || generationChanged),
    })
  },

  hasUnsavedDraftChanges() {
    if (!this.data.openedFromDraft) return false
    const creation = this.data.creation
    return (
      this.data.hasUnsavedChanges
      || Boolean(
        creation
        && this.draftBaselineGenerationId
        && creation.generationId !== this.draftBaselineGenerationId,
      )
    )
  },

  handleBack() {
    if (this.data.showAdjustmentSheet) {
      this.handleAdjustmentCancel()
      return
    }
    if (this.data.isReplayMode) {
      wx.navigateBack()
      return
    }
    const hasUnsavedDraftChanges = this.hasUnsavedDraftChanges()
    if (this.data.openedFromDraft && !hasUnsavedDraftChanges) {
      wx.navigateBack()
      return
    }
    const creation = this.data.creation
    if (creation?.saved || (creation?.draftSaved && !hasUnsavedDraftChanges)) {
      wx.navigateBack()
      return
    }
    this.setData({ showExitDraftDialog: true })
  },

  handleExitSave() {
    if (this.data.isLeaving) return
    if (this.data.creation) {
      void this.saveBeforeLeaving()
      return
    }
    const active = this.data.activeRun
    if (!active) {
      this.setData({ showExitDraftDialog: false })
      wx.navigateBack()
      return
    }
    saveCreationRunDraft(active)
    this.setData({ showExitDraftDialog: false })
    wx.navigateBack()
  },

  handleExitDialogClose() {
    if (this.data.isLeaving) return
    this.setData({ showExitDraftDialog: false })
  },

  handleExitDiscard() {
    if (!this.data.isLeaving) void this.discardBeforeLeaving()
  },

  async saveBeforeLeaving() {
    const creation = this.data.creation
    if (!creation || this.data.isLeaving) return
    this.setData({ isLeaving: true, showExitDraftDialog: false })
    wx.showLoading({ title: '正在保存草稿', mask: true })
    try {
      const title = this.data.title.trim() || creation.result.title
      const updated = await saveCreationAsDraft({
        ...creation,
        result: {
          ...creation.result,
          title,
        },
      })
      this.draftBaselineTitle = title
      this.draftBaselineGenerationId = updated.generationId
      this.draftBaselineCreation = updated
      this.setData({
        creation: updated,
        title,
        poemTitle: title,
        hasUnsavedChanges: false,
      })
      wx.navigateBack()
    } catch (error) {
      showErrorToast(error, { fallback: '草稿保存失败，请稍后重试' })
    } finally {
      wx.hideLoading()
      this.setData({ isLeaving: false })
    }
  },

  async discardBeforeLeaving() {
    const creation = this.data.creation
    const active = this.data.activeRun
    if ((!creation && !active) || this.data.isLeaving) return
    this.setData({ isLeaving: true, showExitDraftDialog: false })
    if (this.data.openedFromDraft) {
      const generationChanged = Boolean(
        active
        && this.draftBaselineGenerationId
        && active.runId !== this.draftBaselineGenerationId,
      )
      if (generationChanged && active && !this.data.coreReady && !this.data.finished) {
        await cancelCreationRun(active).catch(() => undefined)
      }
      if (this.draftBaselineCreation) {
        savePendingCreation(this.draftBaselineCreation)
      } else {
        clearPendingCreation()
      }
      if (generationChanged) clearActiveCreationRun()
      this.setData({
        title: this.draftBaselineTitle || this.data.title,
        hasUnsavedChanges: false,
        isLeaving: false,
      })
      wx.navigateBack()
      return
    }
    wx.showLoading({ title: '正在退出', mask: true })
    try {
      if (creation) {
        await discardPendingCreation(creation)
        clearActiveCreationRun()
      } else if (active) {
        await discardActiveCreationRun(active)
      }
      wx.navigateBack()
    } catch (error) {
      showErrorToast(error, { fallback: '退出失败，请稍后重试' })
    } finally {
      wx.hideLoading()
      this.setData({ isLeaving: false })
    }
  },

  async ensureLoggedIn(): Promise<boolean> {
    let user = cachedUser()
    if (!hasAccessToken()) {
      if (!(await confirmLogin())) return false
      wx.showLoading({ title: '正在登录', mask: true })
      try {
        user = await loginWithWechat()
      } catch (error) {
        showErrorToast(error, { fallback: '登录失败，请稍后重试' })
        return false
      } finally {
        wx.hideLoading()
      }
    } else if (!user) {
      try {
        const session = await restoreSession()
        user = session?.user || null
      } catch (error) {
        showErrorToast(error, { fallback: '登录状态恢复失败，请稍后重试' })
        return false
      }
    }
    if (!user) return false
    if (!user.profileCompleted) {
      this.openProfileSetup(user)
      return false
    }
    return true
  },

  openProfileSetup(user: PoemCloudUser) {
    this.setData({
      showProfileSetup: true,
      pendingAvatarUrl: user.avatarUrl || '',
      pendingNickname: user.nickname,
      resumeSaveAfterProfile: true,
    })
  },

  handleChooseAvatar(event: AvatarChoiceEvent) {
    const avatarUrl = event.detail.avatarUrl
    if (typeof avatarUrl === 'string' && avatarUrl.length > 0) {
      this.setData({ pendingAvatarUrl: avatarUrl })
    }
  },

  handleNicknameInput(event: ValueChangeEvent) {
    const value = event.detail.value
    if (typeof value === 'string') this.setData({ pendingNickname: value })
  },

  handleProfileSetupSkip() {
    if (this.data.isSavingProfile) return
    this.setData({
      showProfileSetup: false,
      resumeSaveAfterProfile: false,
    })
  },

  preventMove() {},

  async handleProfileSetupSave() {
    if (this.data.isSavingProfile) return
    const nickname = this.data.pendingNickname.trim()
    const avatarUrl = this.data.pendingAvatarUrl
    if (!avatarUrl) {
      wx.showToast({ title: '请选择微信头像', icon: 'none' })
      return
    }
    if (!nickname) {
      wx.showToast({ title: '请选择或填写微信昵称', icon: 'none' })
      return
    }
    this.setData({ isSavingProfile: true })
    wx.showLoading({ title: '正在保存', mask: true })
    try {
      await updateWechatProfile({
        nickname,
        avatarTempFilePath: avatarUrl,
      })
      const shouldResumeSave = this.data.resumeSaveAfterProfile
      this.setData({
        showProfileSetup: false,
        resumeSaveAfterProfile: false,
      })
      wx.showToast({ title: '资料已保存', icon: 'success' })
      if (shouldResumeSave) void this.handleSave()
    } catch (error) {
      showErrorToast(error, { fallback: '资料保存失败，请稍后重试' })
    } finally {
      wx.hideLoading()
      this.setData({ isSavingProfile: false })
    }
  },

  async handleSaveDraft() {
    const creation = this.data.creation
    if (
      !creation
      || creation.draftSaved
      || creation.saved
      || this.data.isSavingDraft
      || this.data.isSaving
    ) return
    this.setData({ isSavingDraft: true })
    wx.showLoading({ title: '正在保存草稿', mask: true })
    try {
      const updated = await saveCreationAsDraft(creation)
      if (this.data.openedFromDraft) {
        this.draftBaselineTitle = updated.result.title
        this.draftBaselineGenerationId = updated.generationId
        this.draftBaselineCreation = updated
      }
      this.setData({
        creation: updated,
        hasUnsavedChanges: this.data.openedFromDraft ? false : this.data.hasUnsavedChanges,
      })
      wx.showToast({
        title: updated.localDraftId ? '草稿已保存在本机' : '已存入我的草稿',
        icon: 'success',
      })
    } catch (error) {
      showErrorToast(error, { fallback: '草稿保存失败，请稍后重试', duration: 2800 })
    } finally {
      wx.hideLoading()
      this.setData({ isSavingDraft: false })
    }
  },

  async handleSave() {
    let creation = this.data.creation
    if (!creation || creation.saved || this.data.isSaving || this.data.isSavingDraft) return
    if (!(await this.ensureLoggedIn())) return
    creation = getPendingCreation() || creation
    this.setData({ isSaving: true })
    wx.showLoading({ title: '正在保存作品', mask: true })
    try {
      const updated = await saveCreationAsWork(creation, this.data.title)
      this.setData({
        creation: updated,
        showAdjustmentSheet: false,
        adjustmentInputFocus: false,
        adjustmentInstruction: '',
        canSubmitAdjustment: false,
        keyboardHeight: 0,
        friendShareReady: false,
        friendSharePath: '',
      })
      wx.hideKeyboard()
      void this.prepareCreationFriendShare(updated)
      wx.showToast({ title: '作品已保存', icon: 'success' })
    } catch (error) {
      showErrorToast(error, { fallback: '作品保存失败，请稍后重试', duration: 2800 })
    } finally {
      wx.hideLoading()
      this.setData({ isSaving: false })
    }
  },

  handleAdjustRequirements() {
    if (
      !this.data.coreReady ||
      !this.data.activeRun ||
      this.data.creation?.saved ||
      this.data.isRecreating ||
      this.data.isSaving ||
      this.data.isPublishing
    ) {
      return
    }
    this.setData(
      {
        showAdjustmentSheet: true,
        adjustmentInstruction: '',
        canSubmitAdjustment: false,
        adjustmentInputFocus: false,
        keyboardHeight: 0,
        keyboardDuration: 200,
      },
      () => {
        this.setData({ adjustmentInputFocus: true })
      },
    )
  },

  handleAdjustmentInput(event: ValueChangeEvent) {
    const adjustmentInstruction = event.detail.value.slice(0, 200)
    this.setData({
      adjustmentInstruction,
      canSubmitAdjustment: adjustmentInstruction.trim().length > 0,
    })
  },

  handleAdjustmentKeyboardHeight(
    event: WechatMiniprogram.TextareaKeyboardHeightChange,
  ) {
    const keyboardHeight = Math.max(0, Math.round(event.detail.height))
    if (keyboardHeight === this.data.keyboardHeight) return
    this.setData({
      keyboardHeight,
      keyboardDuration: Math.max(0, Math.min(event.detail.duration || 200, 500)),
    })
  },

  handleAdjustmentCancel() {
    if (this.data.isAdjusting) return
    wx.hideKeyboard()
    this.setData({
      showAdjustmentSheet: false,
      adjustmentInputFocus: false,
      adjustmentInstruction: '',
      canSubmitAdjustment: false,
      keyboardHeight: 0,
      keyboardDuration: 200,
    })
  },

  async handleAdjustmentSubmit() {
    const instruction = this.data.adjustmentInstruction.trim()
    if (
      !instruction ||
      this.data.creation?.saved ||
      this.data.isAdjusting ||
      this.data.isRecreating
    ) return
    this.setData({
      isAdjusting: true,
      adjustmentInputFocus: false,
    })
    wx.hideKeyboard()
    const started = await this.performRecreate(instruction)
    this.setData({
      isAdjusting: false,
      ...(started
        ? {
            showAdjustmentSheet: false,
            adjustmentInstruction: '',
            canSubmitAdjustment: false,
            keyboardHeight: 0,
          }
        : { adjustmentInputFocus: true }),
    })
  },

  handleRecreate() {
    if (
      this.data.creation?.saved ||
      this.data.isRecreating ||
      this.data.isSaving ||
      this.data.isPublishing
    ) return
    wx.showModal({
      title: '重新创作',
      content: '将沿用本次素材和要求，再生成一首新的诗词。',
      confirmText: '重新创作',
      confirmColor: '#3f6758',
      success: (result) => {
        if (result.confirm) void this.performRecreate()
      },
    })
  },

  async performRecreate(instruction = ''): Promise<boolean> {
    const active = this.data.activeRun
    const creation = this.data.creation
    if (!active || creation?.saved || this.data.isRecreating) return false
    this.setData({ isRecreating: true })
    wx.showLoading({ title: instruction ? '正在按要求调整' : '正在重新创作', mask: true })
    try {
      const run = await startCreationRun({
        prompt: active.prompt,
        assetIds: active.assetIds,
        assetKinds: active.assetKinds,
        preferences: active.preferences,
        posterEnabled: active.posterEnabled,
        ...(!creation?.saved && creation?.workId ? { workId: creation.workId } : {}),
        ...(!creation?.saved && creation?.workId && active.creationVersion
          ? { version: active.creationVersion }
          : {}),
        baseGenerationId: active.runId,
        ...(instruction ? { instruction } : {}),
      })
      this.stream?.abort()
      this.clearTypingTimer()
      this.clearPoemErase()
      this.clearTraceTyping()
      this.stopGenerationProgress()
      this.finalPoemContent = ''
      this.receivedPoemContent = ''
      this.coreConfirmed = false
      this.pendingPoeticInsights = []
      this.reconnectCount = 0
      const isRevision = Boolean(instruction)
      const revisionIndex = isRevision
        ? this.ensureRevision(
            run.runId,
            instruction,
            run.queue?.state === 'QUEUED' ? 'waiting' : 'active',
          )
        : -1
      if (!isRevision) {
        this.activeRevisionIndex = -1
      }
      this.setData({
        activeRun: run,
        steps: isRevision
          ? this.data.steps.map((step): CreatingStep => ({
              ...step,
              state: 'done',
              detail: '已完成',
            }))
          : run.queue?.state === 'QUEUED'
            ? queuedInitialSteps()
            : initialSteps(),
        ...(!isRevision ? { revisions: [] } : {}),
        poemTitle: '',
        poemContent: '',
        poemCategoryLabel: categoryLabel(run),
        streamMessage: isRevision
          ? `${this.data.revisions[revisionIndex]?.label || '新一轮创作'}正在连接…`
          : '正在连接创作服务…',
        isFailed: false,
        failureAction: 'RECONNECT',
        coreReady: false,
        finished: false,
        isQueued: run.queue?.state === 'QUEUED',
        queueAhead: run.queue?.ahead ?? 0,
        creation: null,
        title: '',
        isTyping: false,
        hasUnsavedChanges: this.data.openedFromDraft || this.data.hasUnsavedChanges,
      })
      void this.resolveTunePatternLabel(run.preferences.tunePatternCode)
      clearPendingCreation()
      wx.hideShareMenu()
      this.connectStream()
      return true
    } catch (error) {
      showErrorToast(error, { fallback: '重新创作失败，请稍后重试', duration: 2800 })
      return false
    } finally {
      wx.hideLoading()
      this.setData({ isRecreating: false })
    }
  },

  handlePublish() {
    const creation = this.data.creation
    if (!creation?.saved || creation.published || this.data.isPublishing) return
    wx.showModal({
      title: '发布到诗词圈',
      content: '作品将公开展示。发布即表示你同意诗词圈社区规范。',
      confirmText: '发布',
      confirmColor: '#3f6758',
      success: (result) => {
        if (result.confirm) void this.performPublish()
      },
    })
  },

  async prepareCreationFriendShare(targetCreation?: PendingCreation | null) {
    const creation = targetCreation || this.data.creation
    if (
      !creation?.saved ||
      !creation.workId ||
      this.data.friendShareReady ||
      this.data.isPreparingFriendShare
    ) {
      return
    }
    const workId = creation.workId
    this.setData({ isPreparingFriendShare: true })
    try {
      await ensureInstallation()
      let publicationId = creation.sharePublicationId
      let shareImageUrl = creation.shareImageUrl
      if (!publicationId) {
        const publication = await prepareCreationShare(creation)
        publicationId = publication.id
        shareImageUrl = publication.shareImageUrl || undefined
      }
      const shareLink = await createPublicationShareLink(publicationId, 'FRIEND')
      const currentCreation = this.data.creation
      if (currentCreation?.workId !== workId) return
      this.setData({
        creation: {
          ...currentCreation,
          sharePublicationId: publicationId,
          ...(shareImageUrl ? { shareImageUrl } : {}),
        },
        friendSharePath: shareLink.path,
        friendShareReady: true,
      })
      wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage'] })
      reportRealtimeInfo('client.share.link_prepared', {
        operation: 'prepare_creation_friend_or_group_share',
      })
    } catch (error) {
      reportRealtimeWarn('client.share.link_prepare_failed', {
        ...errorLogFields(error),
        operation: 'prepare_creation_friend_or_group_share',
      })
    } finally {
      if (this.data.creation?.workId === workId) {
        this.setData({ isPreparingFriendShare: false })
      }
    }
  },

  async retryCreationFriendSharePreparation() {
    await this.prepareCreationFriendShare()
    if (!this.data.friendShareReady) {
      wx.showToast({ title: '分享准备失败，请稍后重试', icon: 'none' })
    }
  },

  async performPublish() {
    const creation = this.data.creation
    if (!creation?.saved || this.data.isPublishing) return
    this.setData({ isPublishing: true })
    wx.showLoading({ title: '正在发布', mask: true })
    try {
      const publication = await publishCreation(creation)
      this.setData({
        creation: {
          ...creation,
          published: true,
          sharePublicationId: publication.id,
          ...(publication.shareImageUrl ? { shareImageUrl: publication.shareImageUrl } : {}),
        },
      })
      clearPendingCreation()
      wx.showToast({
        title: publication.status === 'PUBLISHED' ? '已发布到诗词圈' : '已提交审核',
        icon: 'success',
      })
      setTimeout(() => {
        wx.switchTab({ url: '/pages/community/index' })
      }, 700)
    } catch (error) {
      showErrorToast(error, { fallback: '发布失败，请稍后重试', duration: 2800 })
    } finally {
      wx.hideLoading()
      this.setData({ isPublishing: false })
    }
  },

  onShareAppMessage() {
    const creation = this.data.creation
    const title = creation?.result.title
      ? `我在诗云为你写下了《${creation.result.title}》，快来看看吧！`
      : '分享一首来自诗云的作品'
    const fallbackShare = {
      title,
      path: '/pages/community/index',
    }
    if (!creation?.saved || !creation.workId) return fallbackShare
    if (this.data.friendSharePath) {
      return {
        title,
        path: this.data.friendSharePath,
        ...(creation.shareImageUrl ? { imageUrl: creation.shareImageUrl } : {}),
      }
    }
    reportRealtimeWarn('client.share.missing_prepared_link', {
      operation: 'share_creation_friend_or_group',
      reasonType: 'share_invoked_before_link_ready',
    })
    void this.prepareCreationFriendShare(creation)
    return fallbackShare
  },
})
