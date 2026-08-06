import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { MiniProgramHeader } from '../components/MiniProgramChrome'
import { WechatDialog } from '../components/WechatDialog'
import { apiRequest, idempotencyKey } from '../lib/api'
import { openBrowserSse, type BrowserSseEvent } from '../lib/sse'
import { getStoredJson, setStoredJson, storageKeys } from '../lib/storage'
import { useAppStore } from '../store/app'
import type { CreationSnapshot, PoemResult } from '../types'

type StepState = 'waiting' | 'active' | 'done' | 'error'
type Step = { key: string; title: string; detail: string; state: StepState; traces: string[]; expanded: boolean; liveProgress: string }

const stepDefinitions = [
  ['MATERIAL_ANALYSIS', '理解素材', '正在寻找画面里的意象'],
  ['KNOWLEDGE_RETRIEVAL', '检索诗意', '正在梳理韵律与表达'],
  ['POEM_GENERATION', '生成诗词', '正在把这一刻写成诗'],
] as const
const stageOrder = ['QUEUED', 'MATERIAL_ANALYSIS', 'KNOWLEDGE_RETRIEVAL', 'POEM_GENERATION', 'SUCCEEDED']

function normalizeStage(value: string): string {
  if (value === 'ANALYZING_MATERIALS') return 'MATERIAL_ANALYSIS'
  if (value === 'RETRIEVING_KNOWLEDGE' || value === 'POETIC_RETRIEVAL') {
    return 'KNOWLEDGE_RETRIEVAL'
  }
  if (value === 'GENERATING') return 'POEM_GENERATION'
  return value
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    : []
}

function categoryLabel(active: Record<string, any> | null, result: PoemResult | null) {
  const preferences = active?.preferences as Record<string, string | null> | undefined
  const category = result?.category || preferences?.category
  if (category === 'MODERN') return '现代诗'
  if (category === 'CI') return preferences?.tunePatternCode || result?.tunePatternCode || '词'
  const forms: Record<string, string> = { WUYAN_JUEJU: '五言绝句', QIYAN_JUEJU: '七言绝句', WUYAN_LVSHI: '五言律诗', QIYAN_LVSHI: '七言律诗', DAYOU_SHI: '打油诗' }
  return forms[String(result?.classicalFormCode || preferences?.classicalFormCode || '')] || '古体诗'
}

export default function CreatingPage() {
  const { runId = '' } = useParams()
  const navigate = useNavigate()
  const user = useAppStore((state) => state.user)
  const setToast = useAppStore((state) => state.setToast)
  const active = getStoredJson<Record<string, any>>(storageKeys.activeCreationRun)
  const [snapshot, setSnapshot] = useState<CreationSnapshot | null>(null)
  const [result, setResult] = useState<PoemResult | null>(null)
  const [title, setTitle] = useState('')
  const [streamMessage, setStreamMessage] = useState('正在连接创作服务…')
  const [isFailed, setFailed] = useState(false)
  const [steps, setSteps] = useState<Step[]>(stepDefinitions.map(([key, stepTitle, detail]) => ({ key, title: stepTitle, detail, state: 'waiting', traces: [], expanded: false, liveProgress: '' })))
  const [savedWorkId, setSavedWorkId] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [draftSaved, setDraftSaved] = useState(false)
  const [published, setPublished] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [recreating, setRecreating] = useState(false)
  const [showAdjustmentSheet, setShowAdjustmentSheet] = useState(false)
  const [adjustmentInstruction, setAdjustmentInstruction] = useState('')
  const [adjusting, setAdjusting] = useState(false)
  const [showLoginDialog, setShowLoginDialog] = useState(false)
  const [showRecreateDialog, setShowRecreateDialog] = useState(false)
  const [showPublishDialog, setShowPublishDialog] = useState(false)
  const [showExitDialog, setShowExitDialog] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const lastEventIdRef = useRef(String(active?.lastEventId || '0-0'))
  const snapshotStatusRef = useRef<string | null>(null)
  const durableAfterSeqRef = useRef(0)
  const seenEventSeqRef = useRef(new Set<number>())
  const seenTraceRef = useRef(new Map<string, Set<string>>())
  const timelineRestoredRef = useRef(false)

  function applySnapshot(next: CreationSnapshot) {
    snapshotStatusRef.current = next.coreStatus
    setSnapshot(next)
    setFailed(['FAILED', 'CANCELED', 'REJECTED'].includes(next.coreStatus))
    if (next.error?.message) setStreamMessage(next.error.message)
    if (next.result) {
      setResult(next.result)
      setTitle((current) => current || next.result?.title || '')
    }
    const currentStage = normalizeStage(next.currentStage || next.coreStatus || 'QUEUED')
    const currentIndex = stageOrder.indexOf(currentStage)
    setSteps((current) => current.map((step) => {
      const targetIndex = stageOrder.indexOf(step.key)
      const state: StepState = next.coreStatus === 'SUCCEEDED' || currentIndex > targetIndex
        ? 'done'
        : currentIndex === targetIndex
          ? 'active'
          : ['FAILED', 'CANCELED', 'REJECTED'].includes(next.coreStatus)
            ? 'error'
            : 'waiting'
      return { ...step, state, detail: state === 'done' ? '已完成' : step.detail }
    }))

    if (timelineRestoredRef.current && seenTraceRef.current.size === 0) {
      const recoveredNarrative = stringArray(
        (next.materialAnalysis as { publicNarrative?: unknown } | null)?.publicNarrative,
      )
      for (const text of recoveredNarrative) appendTrace('MATERIAL_ANALYSIS', text)
    }
  }

  function appendTrace(key: string, text: string) {
    const clean = text.trim()
    if (!clean) return
    const seen = seenTraceRef.current.get(key) ?? new Set<string>()
    if (seen.has(clean)) return
    seen.add(clean)
    seenTraceRef.current.set(key, seen)
    setSteps((current) => current.map((step) => step.key === key
      ? { ...step, traces: [...step.traces, clean], expanded: true }
      : step))
  }

  function handleSseEvent(event: BrowserSseEvent) {
    if (event.id) {
      lastEventIdRef.current = event.id
      const stored = getStoredJson<Record<string, any>>(storageKeys.activeCreationRun)
      if (stored) setStoredJson(storageKeys.activeCreationRun, { ...stored, lastEventId: event.id })
    }
    const data = event.data
    const seq = Number(data.seq)
    if (Number.isInteger(seq) && seq > 0) {
      if (seenEventSeqRef.current.has(seq)) return
      seenEventSeqRef.current.add(seq)
      durableAfterSeqRef.current = Math.max(durableAfterSeqRef.current, seq)
    }
    if (event.event === 'heartbeat') return
    if (event.event === 'stage.started') {
      const stage = normalizeStage(String(data.stage || ''))
      const message = String(data.message || '正在创作…')
      setStreamMessage(message)
      setSteps((current) => current.map((step) => step.key === stage
        ? { ...step, state: 'active', detail: message, expanded: true }
        : step))
      appendTrace(stage, message)
      return
    }
    if (event.event === 'stage.completed') {
      const stage = normalizeStage(String(data.stage || ''))
      setSteps((current) => current.map((step) => step.key === stage
        ? { ...step, state: 'done', detail: '已完成' }
        : step))
      return
    }
    if (event.event === 'analysis.delta') {
      const text = String(data.text || '')
      setStreamMessage(text)
      appendTrace('MATERIAL_ANALYSIS', text)
      return
    }
    if (event.event === 'analysis.completed') {
      const traces = [
        ...stringArray(data.publicNarrative),
        ...stringArray(data.symbols).slice(0, 12).map((symbol, index) => `意象 ${index + 1} · ${symbol}`),
        ...(stringArray(data.scenes).length
          ? [`场景线索 · ${stringArray(data.scenes).slice(0, 4).join('、')}`]
          : []),
        ...(stringArray(data.mood).length
          ? [`情绪底色 · ${stringArray(data.mood).slice(0, 5).join('、')}`]
          : []),
      ]
      for (const text of traces) appendTrace('MATERIAL_ANALYSIS', text)
      return
    }
    if (event.event === 'retrieval.delta') {
      const text = String(data.text || '')
      setStreamMessage(text)
      appendTrace('KNOWLEDGE_RETRIEVAL', text)
      return
    }
    if (event.event === 'retrieval.completed') {
      const traces = [
        ...stringArray(data.publicNarrative),
        ...stringArray(data.symbols).slice(0, 12).map((symbol, index) => `意象 ${index + 1} · ${symbol}`),
        ...(stringArray(data.scenes).length
          ? [`场景线索 · ${stringArray(data.scenes).slice(0, 4).join('、')}`]
          : []),
        ...(stringArray(data.mood).length
          ? [`情绪底色 · ${stringArray(data.mood).slice(0, 5).join('、')}`]
          : []),
        ...(stringArray(data.styleTags).length
          ? [`风格取向 · ${stringArray(data.styleTags).slice(0, 5).join('、')}`]
          : []),
      ]
      for (const text of traces) appendTrace('KNOWLEDGE_RETRIEVAL', text)
      return
    }
    if (event.event === 'poem.thinking' || event.event === 'poem.progress') {
      const text = String(data.text || '')
      if (text) setStreamMessage(text)
      return
    }
    if (event.event === 'poem.meta') {
      const nextTitle = String(data.title || '无题')
      setTitle(nextTitle)
      return
    }
    if (event.event === 'poem.delta') {
      const delta = String(data.delta || '')
      if (delta) {
        setResult((current) => ({
          title: current?.title || title || '无题',
          content: `${current?.content || ''}${delta}`,
          category: current?.category || (active?.preferences?.category ?? 'CLASSICAL'),
          classicalFormCode: current?.classicalFormCode || active?.preferences?.classicalFormCode || null,
          tunePatternCode: current?.tunePatternCode || active?.preferences?.tunePatternCode || null,
        }))
      }
      return
    }
    if (event.event === 'poem.reset') {
      setResult(null)
      setStreamMessage('正在重新落笔…')
      return
    }
    if (event.event === 'validation.started' || event.event === 'validation.completed') {
      const text = String(data.message || (event.event === 'validation.started' ? '正在进行格律与押韵校验' : '格律审校完成'))
      setStreamMessage(text)
      appendTrace('POEM_GENERATION', text)
      return
    }
    if (event.event === 'poem.completed') {
      const completed = data as unknown as PoemResult
      setResult(completed)
      setTitle(completed.title)
      return
    }
    if (event.event === 'core.done' && data.status === 'SUCCEEDED') {
      setStreamMessage('诗词创作与审校已经完成')
      return
    }
    if (event.event === 'error') {
      setFailed(true)
      setStreamMessage(String(data.message || '创作暂时中断，请稍后重试'))
    }
  }

  async function restoreDurableTimeline() {
    let afterSeq = durableAfterSeqRef.current
    while (true) {
      const response = await apiRequest<{
        lastSeq: number
        hasMore: boolean
        result: PoemResult | null
        items: Array<{
          seq: number
          event: string
          data: Record<string, unknown>
        }>
      }>(`/creation-runs/${encodeURIComponent(runId)}/timeline?afterSeq=${afterSeq}&limit=500`)
      for (const event of response.items) {
        handleSseEvent({ id: '', event: event.event, data: { ...event.data, seq: event.seq } })
      }
      afterSeq = response.lastSeq
      durableAfterSeqRef.current = afterSeq
      if (response.result) {
        setResult(response.result)
        setTitle(response.result.title)
      }
      if (!response.hasMore) break
    }
    timelineRestoredRef.current = true
  }

  useEffect(() => {
    if (!runId) return
    let stopped = false
    let timer = 0
    async function poll() {
      try {
        const next = await apiRequest<CreationSnapshot>(`/creation-runs/${encodeURIComponent(runId)}`)
        if (stopped) return
        applySnapshot(next)
        if (!['SUCCEEDED', 'FAILED', 'CANCELED', 'REJECTED'].includes(next.coreStatus)) timer = window.setTimeout(poll, 1_600)
      } catch (error) {
        if (!stopped) {
          setFailed(true)
          setStreamMessage(error instanceof Error ? error.message : '连接中断')
          timer = window.setTimeout(poll, 3_000)
        }
      }
    }
    void poll()
    return () => { stopped = true; window.clearTimeout(timer) }
  }, [runId])

  useEffect(() => {
    if (!runId) return
    void restoreDurableTimeline().catch(() => undefined)
  }, [runId])

  useEffect(() => {
    if (!runId) return
    const controller = new AbortController()
    let reconnectTimer = 0
    const connect = async () => {
      try {
        await openBrowserSse({
          path: `/creation-runs/${encodeURIComponent(runId)}/events`,
          cursor: lastEventIdRef.current,
          signal: controller.signal,
          onEvent: handleSseEvent,
        })
        if (!controller.signal.aborted && snapshotStatusRef.current !== 'SUCCEEDED') {
          reconnectTimer = window.setTimeout(connect, 700)
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setStreamMessage('连接波动，正在恢复创作进度…')
          reconnectTimer = window.setTimeout(connect, 700)
        }
      }
    }
    void connect()
    return () => {
      controller.abort()
      window.clearTimeout(reconnectTimer)
    }
  }, [runId])

  const coreReady = snapshot?.coreStatus === 'SUCCEEDED' && Boolean(result)
  const isQueued = snapshot?.queue?.state === 'QUEUED'
  const poemContent = result?.content.replace(/\\n/g, '\n') || ''
  const poemCategoryLabel = categoryLabel(active, result)
  const canSubmitAdjustment = Boolean(adjustmentInstruction.trim()) && !adjusting

  async function ensureDraft() {
    const existing = savedWorkId || snapshot?.creationId
    if (existing) return existing
    const response = await apiRequest<{ id: string }>('/creations', {
      method: 'POST',
      body: { prompt: active?.prompt || '', assetIds: active?.assetIds || [], preferences: active?.preferences, generationId: snapshot?.generationId },
      idempotencyKey: idempotencyKey('create-draft'),
    })
    setSavedWorkId(response.id)
    return response.id
  }

  async function saveDraft() {
    if (!result || saved || draftSaved || savingDraft || saving) return
    setSavingDraft(true)
    try {
      if (user) {
        await ensureDraft()
        setToast('已存入我的草稿')
      } else {
        const drafts = getStoredJson<Array<Record<string, any>>>(storageKeys.localDrafts) || []
        const draft = { id: `run-${runId}`, localDraftId: `run-${runId}`, runId, generationId: snapshot?.generationId, result, title, prompt: active?.prompt || '', assetIds: active?.assetIds || [], assetKinds: active?.assetKinds || [], preferences: active?.preferences, localUpdatedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
        setStoredJson(storageKeys.localDrafts, [draft, ...drafts.filter((item) => item.id !== draft.id)])
        setToast('草稿已保存在本机')
      }
      setDraftSaved(true)
    } catch (error) {
      setToast(error instanceof Error ? error.message : '草稿保存失败，请稍后重试')
    } finally {
      setSavingDraft(false)
    }
  }

  async function saveWork() {
    if (!result || saved || saving || savingDraft) return
    if (!user) {
      setShowLoginDialog(true)
      return
    }
    setSaving(true)
    try {
      const workId = await ensureDraft()
      await apiRequest(`/creations/${workId}/finalize`, { method: 'POST', body: { generationId: snapshot?.generationId, title: title.trim() || result.title }, idempotencyKey: idempotencyKey('finalize-poem') })
      setSavedWorkId(workId)
      setSaved(true)
      setDraftSaved(true)
      setToast('作品已保存')
    } catch (error) {
      setToast(error instanceof Error ? error.message : '作品保存失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  async function performRecreate(instruction = '') {
    if (recreating || saved) return
    setRecreating(true)
    setAdjusting(Boolean(instruction))
    try {
      const response = await apiRequest<{ runId: string }>('/creation-runs', {
        method: 'POST',
        body: { creationId: snapshot?.creationId, baseGenerationId: snapshot?.generationId, prompt: active?.prompt || '', assetIds: active?.assetIds || [], preferences: active?.preferences, instruction, poster: { enabled: true, variants: ['BACKGROUND', 'COMPOSED'] } },
        idempotencyKey: idempotencyKey('recreate'),
      })
      setStoredJson(storageKeys.activeCreationRun, { ...active, runId: response.runId })
      setShowAdjustmentSheet(false)
      setAdjustmentInstruction('')
      navigate(`/creating/${response.runId}`, { replace: true })
    } catch (error) {
      setToast(error instanceof Error ? error.message : '重新创作失败，请稍后重试')
    } finally {
      setRecreating(false)
      setAdjusting(false)
    }
  }

  async function performPublish() {
    if (!savedWorkId || publishing) return
    setShowPublishDialog(false)
    setPublishing(true)
    try {
      const publication = await apiRequest<{ status: string }>('/works/' + savedWorkId + '/publications', { method: 'POST', body: { workId: savedWorkId, visibility: 'PUBLIC', acceptedCommunityRules: true }, idempotencyKey: idempotencyKey('publish-poem') })
      setPublished(true)
      setToast(publication.status === 'PUBLISHED' ? '已发布到诗词圈' : '已提交审核')
      window.setTimeout(() => navigate('/community'), 700)
    } catch (error) {
      setToast(error instanceof Error ? error.message : '发布失败，请稍后重试')
    } finally {
      setPublishing(false)
    }
  }

  async function saveAndLeave() {
    setLeaving(true)
    await saveDraft()
    setLeaving(false)
    setShowExitDialog(false)
    navigate(-1)
  }

  return (
    <div className="mp-page mp-creating creating-viewport">
      <MiniProgramHeader title={coreReady ? '创作完成' : '正在创作'} background="#faf9f5" onBack={() => coreReady && saved ? navigate(-1) : setShowExitDialog(true)} />
      <main className="creating-scroll page-scroll">
        <div className="creating-page">
          <img className="creating-landscape" src="/assets/images/mountain-wash.jpg" alt="" />
          <div className="process-heading"><div><span className="process-eyebrow">创作手记</span><strong className="process-title poem-display">你出现在我诗的每一页</strong></div><div className={`process-status ${!coreReady && !isFailed ? 'process-status--active' : ''}`}>{!coreReady && !isFailed ? <span className="process-status__pulse" /> : null}<span>{isFailed ? '连接中断' : coreReady ? '创作完成' : isQueued ? '等待资源' : '实时生成'}</span></div></div>
          {isQueued ? <div className="queue-notice"><div className="queue-notice__mark"><span className="queue-notice__dot queue-notice__dot--one" /><span className="queue-notice__dot queue-notice__dot--two" /><span className="queue-notice__dot queue-notice__dot--three" /></div><div className="queue-notice__content"><strong className="queue-notice__title poem-display">服务器资源紧张，正在排队中</strong><span className="queue-notice__copy">{(snapshot?.queue?.ahead || 0) > 0 ? `前方还有 ${snapshot?.queue?.ahead} 个创作任务，队列会自动更新` : '已排到队首，正在等待创作资源释放'}</span></div></div> : null}
          <div className="stage-list">{steps.map((step, index) => <div className="stage-item" key={step.key}><div className="stage-rail"><span className={`stage-node stage-node--${step.state}`}>{step.state === 'done' ? '✓' : step.state === 'active' ? <span className="stage-spinner" /> : <span className="stage-dot" />}</span>{index < steps.length - 1 ? <span className={`stage-line ${step.state === 'done' ? 'stage-line--done' : ''}`} /> : null}</div><div className="stage-body"><button className={`stage-header ${step.state === 'done' && step.traces.length ? 'stage-header--toggle' : ''}`} onClick={() => step.traces.length && setSteps((current) => current.map((item) => item.key === step.key ? { ...item, expanded: !item.expanded } : item))}><strong className="stage-title poem-display">{step.title}</strong><span className={`stage-summary ${step.state === 'active' ? 'stage-summary--active' : ''}`}><span>{step.state === 'done' ? '已完成' : step.state === 'active' ? '进行中' : '等待中'}</span>{step.traces.length ? <span className={`stage-chevron ${step.expanded ? 'stage-chevron--expanded' : ''}`} /> : null}</span></button>{step.expanded && (step.traces.length || step.liveProgress) ? <div className="stage-trace">{step.traces.map((trace) => <div className="stage-trace-row" key={trace}><span className="stage-trace-mark">·</span><span className="stage-trace-copy">{trace}</span></div>)}</div> : step.state !== 'done' ? <span className="stage-detail">{step.detail}</span> : null}</div></div>)}</div>
          {isFailed && !coreReady ? <div className="stream-error"><span className="stream-error-copy">{streamMessage}</span><button className="stream-retry poem-display" onClick={() => location.reload()}>重新连接</button></div> : null}
          <article className={`result-paper ${coreReady ? 'result-paper--ready' : 'result-paper--writing'}`}><img className="result-paper__bamboo" src="/assets/images/result-bamboo.png" alt="" />{coreReady && saved ? <strong className="result-paper__title poem-display">{title}</strong> : coreReady ? <textarea className="result-paper__title result-paper__title-input poem-display" value={title} maxLength={100} onChange={(event) => setTitle(event.target.value)} /> : result?.title ? <strong className="result-paper__title poem-display">{result.title}</strong> : null}{result?.title || coreReady ? <span className="result-paper__form poem-display">{poemCategoryLabel}</span> : null}{poemContent ? <div className="result-paper__poem poem-display">{poemContent}</div> : null}{coreReady ? <div className="result-paper__signature poem-display"><span>由你的文字与素材生成</span><img className="result-paper__brand" src="/assets/images/brand-icon.png" alt="" /></div> : null}</article>
          {coreReady && result ? <div className="result-actions"><button className={`native-button-reset native-button-reset--block result-primary poem-display ${saved ? 'result-primary--saved' : saving ? 'result-primary--loading' : ''}`} disabled={saved || saving} onClick={() => void saveWork()}>{saved ? <span className="result-primary__saved-mark">✓</span> : null}<span>{saved ? '已保存到我的作品' : saving ? '正在保存…' : '保存到我的作品'}</span></button><div className="result-action-grid">{!saved ? <><button className={`native-button-reset result-action poem-display ${recreating ? 'result-action--disabled' : ''}`} disabled={recreating} onClick={() => setShowRecreateDialog(true)}><img className="result-action__icon" src="/assets/icons/result-recreate.png" alt="" /><span>{recreating ? '正在创作' : '重新创作'}</span></button><button className="native-button-reset result-action poem-display" onClick={() => setShowAdjustmentSheet(true)}><img className="result-action__icon" src="/assets/icons/result-adjust.png" alt="" /><span>调整要求</span></button></> : <><button className="native-button-reset result-action poem-display" onClick={() => setToast('微信 JSSDK 能力待接入')}><img className="result-action__icon" src="/assets/icons/result-share.png" alt="" /><span>分享给好友</span></button><button className={`native-button-reset result-action poem-display ${publishing || published ? 'result-action--disabled' : ''}`} disabled={publishing || published} onClick={() => setShowPublishDialog(true)}><img className="result-action__icon" src="/assets/icons/result-publish.png" alt="" /><span>{published ? '已发布' : publishing ? '正在发布' : '发布到诗词圈'}</span></button></>}</div></div> : null}
        </div>
      </main>

      {showAdjustmentSheet ? <div className="adjustment-overlay" onClick={() => !adjusting && setShowAdjustmentSheet(false)}><section className="adjustment-sheet" onClick={(event) => event.stopPropagation()}><div className="adjustment-heading"><h2 className="adjustment-title poem-display">想怎么调整这首诗？</h2><button className="adjustment-close" aria-label="关闭调整要求" onClick={() => setShowAdjustmentSheet(false)} /></div><p className="adjustment-copy poem-display">可以修改意象、语气、用词或格律，本次创作的素材与上下文会保留。</p><label className="adjustment-field"><textarea className="adjustment-textarea poem-display" value={adjustmentInstruction} maxLength={200} autoFocus placeholder="例如：语气更含蓄一些，结尾保留月亮的意象…" onChange={(event) => setAdjustmentInstruction(event.target.value)} /><span className="adjustment-count">{adjustmentInstruction.length}/200</span></label><div className="adjustment-actions"><button className="adjustment-cancel poem-display" onClick={() => setShowAdjustmentSheet(false)}>取消</button><button className={`adjustment-submit poem-display ${!canSubmitAdjustment ? 'adjustment-submit--disabled' : ''}`} disabled={!canSubmitAdjustment} onClick={() => void performRecreate(adjustmentInstruction.trim())}>{adjusting ? '正在重新创作…' : '按此要求重新创作'}</button></div></section></div> : null}
      {showExitDialog ? <div className="exit-draft-overlay"><section className="exit-draft-dialog"><button className={`exit-draft-close ${leaving ? 'exit-draft-close--disabled' : ''}`} aria-label="关闭" onClick={() => setShowExitDialog(false)} /><img className="exit-draft-ornament" src="/assets/icons/exit-draft-cloud.png" alt="" /><h2 className="exit-draft-title poem-display">要离开本次创作吗？</h2><p className="exit-draft-copy poem-display">当前内容尚未完成，保存草稿后可在「我的草稿」中继续创作。</p><button className={`exit-draft-primary poem-display ${leaving ? 'exit-draft-action--disabled' : ''}`} onClick={() => void saveAndLeave()}>保存草稿并退出</button><button className={`exit-draft-secondary poem-display ${leaving ? 'exit-draft-action--disabled' : ''}`} onClick={() => navigate(-1)}>不保存直接退出</button></section></div> : null}
      <WechatDialog open={showLoginDialog} title="登录后保存" content="登录后可以保存作品，并发布到诗词圈。" confirmText="登录" onCancel={() => setShowLoginDialog(false)} onConfirm={() => navigate(`/login?returnTo=${encodeURIComponent(`/creating/${runId}`)}`)} />
      <WechatDialog open={showRecreateDialog} title="重新创作" content="将沿用本次素材和要求，再生成一首新的诗词。" confirmText="重新创作" onCancel={() => setShowRecreateDialog(false)} onConfirm={() => { setShowRecreateDialog(false); void performRecreate() }} />
      <WechatDialog open={showPublishDialog} title="发布到诗词圈" content="作品将公开展示。发布即表示你同意诗词圈社区规范。" confirmText="发布" onCancel={() => setShowPublishDialog(false)} onConfirm={performPublish} />
    </div>
  )
}
