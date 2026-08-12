import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MiniProgramHeader, MiniProgramTabBar } from '../components/MiniProgramChrome'
import { WechatDialog } from '../components/WechatDialog'
import { apiRequest, ensureInstallation, idempotencyKey } from '../lib/api'
import {
  clearCreationForm,
  consumeCreationResume,
  currentCreationForm,
  preserveCreationForm,
  type ResumableMaterial,
} from '../lib/creation-resume'
import { getStoredJson, setStoredJson, storageKeys } from '../lib/storage'
import { uploadAsset } from '../lib/uploads'
import { useAppStore } from '../store/app'
import type { ClassicalFormCode, CreationRun, PoemCategory, PoemPreferences, Quota } from '../types'

type Material = ResumableMaterial

type Tune = { code: string; name: string; aliases?: string[] }

const MAX_IMAGES = 3
const MAX_VIDEOS = 1
const defaultTunes: Tune[] = [{ code: 'shui_diao_ge_tou', name: '水調歌頭', aliases: ['水调歌头'] }]
const defaultForms: Array<{ code: ClassicalFormCode; name: string }> = [
  { code: 'WUYAN_JUEJU', name: '五言绝句' },
  { code: 'QIYAN_JUEJU', name: '七言绝句' },
  { code: 'WUYAN_LVSHI', name: '五言律诗' },
  { code: 'QIYAN_LVSHI', name: '七言律诗' },
  { code: 'DAYOU_SHI', name: '打油诗' },
]

function videoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    const url = URL.createObjectURL(file)
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      resolve(video.duration)
    }
    video.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('无法读取视频信息'))
    }
    video.src = url
  })
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '')
}

export default function CreatePage() {
  const resumedForm = useRef(currentCreationForm()).current
  const resumeStarted = useRef(false)
  const navigate = useNavigate()
  const setToast = useAppStore((state) => state.setToast)
  const user = useAppStore((state) => state.user)
  const [prompt, setPrompt] = useState(resumedForm?.prompt ?? '')
  const [materials, setMaterials] = useState<Material[]>(resumedForm?.materials ?? [])
  const materialsRef = useRef<Material[]>([])
  const [isUploading, setUploading] = useState(false)
  const [isCreating, setCreating] = useState(false)
  const [isCheckingPreferences, setCheckingPreferences] = useState(false)
  const [isCheckingMaterials, setCheckingMaterials] = useState(false)
  const [quota, setQuota] = useState<Quota | null>(null)
  const [selectedCategory, setCategory] = useState<PoemCategory>(resumedForm?.selectedCategory ?? 'CLASSICAL')
  const [selectedForm, setForm] = useState<ClassicalFormCode>(resumedForm?.selectedForm ?? 'WUYAN_JUEJU')
  const [selectedTuneCode, setTuneCode] = useState(resumedForm?.selectedTuneCode ?? defaultTunes[0]!.code)
  const [pendingTuneCode, setPendingTuneCode] = useState(resumedForm?.selectedTuneCode ?? defaultTunes[0]!.code)
  const [tunes, setTunes] = useState(defaultTunes)
  const [tuneSearch, setTuneSearch] = useState('')
  const [showTunePicker, setShowTunePicker] = useState(false)
  const [loginReason, setLoginReason] = useState<'quota' | 'linked' | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  materialsRef.current = materials

  useEffect(() => {
    void ensureInstallation()
      .then(() => apiRequest<Quota>('/me/quota'))
      .then(setQuota)
      .catch(() => undefined)
    void apiRequest<{ categories: Array<{ code: PoemCategory; forms?: typeof defaultForms; tunePatterns?: Tune[] }> }>('/poem-taxonomies', { authenticated: false })
      .then((response) => {
        const remoteTunes = response.categories.find((item) => item.code === 'CI')?.tunePatterns
        if (remoteTunes?.length) {
          const normalized = remoteTunes.map((item) => ({ ...item, aliases: item.aliases ?? [] }))
          setTunes(normalized)
          setTuneCode(normalized[0]!.code)
          setPendingTuneCode(normalized[0]!.code)
        }
      })
      .catch(() => undefined)
  }, [])

  const imageCount = materials.filter((item) => item.kind === 'IMAGE').length
  const videoCount = materials.filter((item) => item.kind === 'VIDEO').length
  const selectedTuneName = tunes.find((item) => item.code === selectedTuneCode)?.name || '请选择词牌'
  const visibleTunes = useMemo(() => {
    const query = normalizeSearch(tuneSearch)
    if (!query) return tunes
    return tunes.filter((item) => [item.name, ...(item.aliases ?? [])].some((candidate) => normalizeSearch(candidate).includes(query)))
  }, [tuneSearch, tunes])

  async function chooseMaterials(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!selected.length) return
    let nextImages = imageCount
    let nextVideos = videoCount
    let ignoredByLimit = 0
    let ignoredLongVideo = 0
    const accepted: Material[] = []
    for (const file of selected) {
      const kind = file.type.startsWith('video/') ? 'VIDEO' : 'IMAGE'
      let durationLabel = ''
      if (kind === 'VIDEO') {
        const duration = await videoDuration(file)
        if (duration > 5) {
          ignoredLongVideo += 1
          continue
        }
        if (nextVideos <= 0) {
          ignoredByLimit += 1
          continue
        }
        durationLabel = `${duration.toFixed(1)}s`
        nextVideos += 1
      } else {
        if (nextImages <= 0) {
          ignoredByLimit += 1
          continue
        }
        nextImages += 1
      }
      const sourceUrl = URL.createObjectURL(file)
      accepted.push({
        id: crypto.randomUUID(), kind, file, sourceUrl, previewUrl: sourceUrl,
        durationLabel, status: 'READY',
      })
    }
    if (accepted.length === 0) {
      setToast(ignoredLongVideo > 0 ? '请选择5秒以内的视频' : '素材数量已达上限')
      return
    }
    setUploading(true)
    const uploadedMaterials: Material[] = []
    try {
      for (const material of accepted) {
        const uploaded = await uploadAsset(material.file, material.kind)
        const isProcessingVideo =
          material.kind === 'VIDEO' && uploaded.status === 'PROCESSING'
        uploadedMaterials.push({
          ...material,
          id: uploaded.id,
          uploadedId: uploaded.id,
          sourceUrl: uploaded.accessUrl || material.sourceUrl,
          previewUrl:
            material.kind === 'VIDEO'
              ? uploaded.thumbnailUrl || material.previewUrl
              : uploaded.accessUrl || material.previewUrl,
          status: isProcessingVideo ? 'PROCESSING' : 'READY',
        })
      }
      const hasProcessingVideo = uploadedMaterials.some(
        (material) => material.kind === 'VIDEO' && material.status === 'PROCESSING',
      )
      const hasIgnored = ignoredByLimit > 0 || ignoredLongVideo > 0
      setToast(
        hasIgnored
          ? '已添加可用素材，超出限制的已忽略'
          : hasProcessingVideo
            ? '视频已上传，正在检测'
            : '素材已添加',
      )
      setMaterials((current) => [...current, ...uploadedMaterials])
      for (const material of uploadedMaterials) {
        if (material.status === 'PROCESSING') void monitorMaterialModeration(material.id)
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : '素材上传失败，请稍后重试')
    } finally {
      setUploading(false)
    }
  }

  async function monitorMaterialModeration(assetId: string) {
    for (let attempt = 0; attempt < 150; attempt += 1) {
      if (!materialsRef.current.some((material) => material.id === assetId)) return
      await delay(2_000)
      try {
        const asset = await apiRequest<{
          status: string
          moderationStatus: string
          accessUrl: string | null
          thumbnailUrl: string | null
        }>(`/assets/${assetId}`)
        if (asset.status === 'PROCESSING' || asset.moderationStatus === 'REVIEW') continue
        if (asset.status === 'READY' && asset.moderationStatus === 'PASSED') {
          setMaterials((current) => current.map((material) =>
            material.id === assetId
              ? {
                  ...material,
                  status: 'READY',
                  sourceUrl: asset.accessUrl || material.sourceUrl,
                  previewUrl: asset.thumbnailUrl || material.previewUrl,
                }
              : material))
          setToast('视频检测通过')
          return
        }
        setMaterials((current) => current.filter((material) => material.id !== assetId))
        void apiRequest(`/assets/${assetId}`, { method: 'DELETE' }).catch(() => undefined)
        setToast(
          asset.status === 'REJECTED' || asset.moderationStatus === 'REJECTED'
            ? '您的素材涉嫌违规，请修改后重试'
            : '视频检测失败，请重新上传',
        )
        return
      } catch {
        // 网络波动时保留“检测中”，创作前还会再次向服务端确认。
      }
    }
  }

  async function removeMaterial(id: string) {
    const material = materialsRef.current.find((candidate) => candidate.id === id)
    if (!material || isUploading) return
    setUploading(true)
    setToast('正在移除')
    try {
      if (material.uploadedId) {
        await apiRequest(`/assets/${material.uploadedId}`, { method: 'DELETE' })
      }
      setMaterials((current) => current.filter((candidate) => candidate.id !== id))
    } catch (error) {
      setToast(error instanceof Error ? error.message : '素材移除失败，请稍后重试')
    } finally {
      setUploading(false)
    }
  }

  async function checkMaterialsBeforeCreation(): Promise<boolean> {
    if (materials.length === 0) return true
    setCheckingMaterials(true)
    try {
      const assets = await Promise.all(
        materials.map((material) =>
          apiRequest<{
            id: string
            status: string
            moderationStatus: string
            accessUrl: string | null
            thumbnailUrl: string | null
          }>(`/assets/${material.uploadedId || material.id}`),
        ),
      )
      const rejectedIds = assets
        .filter((asset) => asset.status === 'REJECTED' || asset.moderationStatus === 'REJECTED')
        .map((asset) => asset.id)
      if (rejectedIds.length > 0) {
        const rejected = new Set(rejectedIds)
        setMaterials((current) => current.filter((material) => !rejected.has(material.uploadedId || material.id)))
        for (const assetId of rejectedIds) void apiRequest(`/assets/${assetId}`, { method: 'DELETE' }).catch(() => undefined)
        setToast('您的素材涉嫌违规，请修改后重试')
        return false
      }
      const failedIds = assets.filter((asset) => asset.status === 'FAILED').map((asset) => asset.id)
      if (failedIds.length > 0) {
        const failed = new Set(failedIds)
        setMaterials((current) => current.filter((material) => !failed.has(material.uploadedId || material.id)))
        for (const assetId of failedIds) void apiRequest(`/assets/${assetId}`, { method: 'DELETE' }).catch(() => undefined)
        setToast('素材检测失败，请重新上传')
        return false
      }
      if (assets.some((asset) => asset.status !== 'READY' || asset.moderationStatus !== 'PASSED')) {
        setToast('素材还在检测中，请稍后')
        return false
      }
      const byId = new Map(assets.map((asset) => [asset.id, asset]))
      setMaterials((current) => current.map((material) => ({
        ...material,
        status: 'READY',
        sourceUrl: byId.get(material.uploadedId || material.id)?.accessUrl || material.sourceUrl,
        previewUrl: byId.get(material.uploadedId || material.id)?.thumbnailUrl || material.previewUrl,
      })))
      return true
    } catch (error) {
      setToast(error instanceof Error ? error.message : '素材状态检查失败，请稍后重试')
      return false
    } finally {
      setCheckingMaterials(false)
    }
  }

  function openTunePicker() {
    setPendingTuneCode(selectedTuneCode)
    setTuneSearch('')
    setShowTunePicker(true)
  }

  function confirmTunePicker() {
    setTuneCode(pendingTuneCode)
    setShowTunePicker(false)
  }

  async function startCreation() {
    if (isCreating || isUploading || isCheckingPreferences || isCheckingMaterials) return
    if (!prompt.trim()) {
      setToast('先写下想表达的内容')
      return
    }
    if (!(await checkMaterialsBeforeCreation())) return
    if (quota && !quota.unlimited && quota.remaining !== null && quota.remaining <= 0) {
      if (!user) setLoginReason('quota')
      else setToast('今日创作次数已用完')
      return
    }
    if (selectedCategory === 'CI' && !selectedTuneCode) {
      setToast('请选择词牌')
      return
    }
    const storedPreferences = getStoredJson<PoemPreferences>(storageKeys.preferences)
    if (!storedPreferences) {
      setCheckingPreferences(true)
      preserveCreationForm({
        prompt,
        materials,
        selectedCategory,
        selectedForm,
        selectedTuneCode,
      })
      navigate('/creation-preferences?returnTo=/create')
      return
    }
    setCreating(true)
    try {
      const assetIds = materials
        .map((material) => material.uploadedId)
        .filter((id): id is string => Boolean(id))
      const preferences: PoemPreferences = {
        ...storedPreferences,
        category: selectedCategory,
        classicalFormCode: selectedCategory === 'CLASSICAL' ? selectedForm : null,
        tunePatternCode: selectedCategory === 'CI' ? selectedTuneCode : null,
      }
      const posterEnabled = storedPreferences.autoGeneratePoster !== false
      const run = await apiRequest<CreationRun>('/creation-runs', {
        method: 'POST',
        body: {
          prompt: prompt.trim(), assetIds, preferences, instruction: '',
          poster: { enabled: posterEnabled, variants: ['BACKGROUND', 'COMPOSED'] },
        },
        idempotencyKey: idempotencyKey('creation-run'),
      })
      setStoredJson(storageKeys.activeCreationRun, {
        ...run, prompt: prompt.trim(), assetIds,
        assetKinds: materials.map((item) => item.kind), preferences,
      })
      materials.forEach((item) => URL.revokeObjectURL(item.sourceUrl))
      clearCreationForm()
      navigate(`/creating/${run.runId}`)
    } catch (error) {
      setToast(error instanceof Error ? error.message : '创作失败，请稍后重试')
    } finally {
      setCreating(false)
    }
  }

  useEffect(() => {
    if (resumeStarted.current || !consumeCreationResume()) return
    resumeStarted.current = true
    // Do not clear this timer in development StrictMode: its synthetic cleanup
    // would otherwise consume the one-shot resume signal without starting.
    window.setTimeout(() => void startCreation(), 80)
  }, [])

  return (
    <div className="mp-page mp-create app-viewport create-viewport">
      <img className="create-background" src="/assets/images/create-home-landscape.jpg" alt="" />
      <div className="create-navigation">
        <MiniProgramHeader back={false} background="transparent" center={<img className="brand-logo" src="/assets/images/brand-icon.png" alt="诗云" />} />
      </div>

      <main className="page-scroll create-scroll">
        <div className="create-page">
          <div className="quota-pill poem-display">
            <span>今日创作额度剩余</span>
            <span className="quota-pill__number">{quota ? quota.unlimited ? '不限' : quota.remaining : '--'}</span>
            {!quota?.unlimited ? <span>次</span> : null}
          </div>

          <div className="create-content">
            <div className="prompt-card">
              <div className="prompt-field">
                <textarea
                  className={`prompt-input poem-display ${materials.length ? 'prompt-input--with-materials' : ''}`}
                  value={prompt}
                  placeholder="写下此刻，或放入一段故事…"
                  maxLength={300}
                  onChange={(event) => setPrompt(event.target.value)}
                />

                {materials.length ? <div className="material-list">{materials.map((item) => (
                  <div className="material-item" key={item.id}>
                    <button className="material-preview" onClick={() => window.open(item.sourceUrl, '_blank')}>
                      {item.previewUrl ? <img className="material-preview__image" src={item.previewUrl} alt="创作素材" /> : <span className="material-preview__fallback"><img src="/assets/icons/media-video.svg" alt="" /></span>}
                      {item.kind === 'VIDEO' ? <span className="material-preview__video"><span className="material-preview__play">▶</span>{item.durationLabel}</span> : null}
                      {item.status === 'PROCESSING' ? <span className="material-preview__audit">检测中</span> : null}
                    </button>
                    <button className="material-remove" onClick={() => removeMaterial(item.id)} aria-label="移除素材">
                      <span className="material-remove__icon"><span className="material-remove__line material-remove__line--forward" /><span className="material-remove__line material-remove__line--backward" /></span>
                    </button>
                  </div>
                ))}</div> : null}

                <button
                  className={`material-entry ${isUploading || (imageCount >= MAX_IMAGES && videoCount >= MAX_VIDEOS) ? 'material-entry--disabled' : ''}`}
                  onClick={() => fileInput.current?.click()}
                  disabled={isUploading || (imageCount >= MAX_IMAGES && videoCount >= MAX_VIDEOS)}
                >
                  <span className="material-entry__main">
                    <img className="material-entry__icon" src="/assets/icons/create-upload.png" alt="" />
                    <span className="material-entry__label poem-display">{isUploading ? '正在上传素材…' : '添加素材'}</span>
                  </span>
                  <span className="material-entry__meta">{materials.length ? `${imageCount}/3 图片 · ${videoCount}/1 视频` : '图片 3张 · 视频 5秒'}</span>
                </button>
                <input ref={fileInput} hidden type="file" multiple accept="image/*,video/*" onChange={chooseMaterials} />
              </div>
            </div>

            <div className={`selection-card ${selectedCategory === 'CI' ? 'selection-card--stacked' : ''}`}>
              <div className="type-row">
                <span className="setting-label poem-display">诗词类型</span>
                <div className="category-selector">
                  {([['CLASSICAL', '古体诗'], ['MODERN', '现代诗'], ['CI', '词']] as const).map(([code, name]) => (
                    <button key={code} className={`category-option ${selectedCategory === code ? 'category-option--active' : ''}`} onClick={() => setCategory(code)}><span className="control-text">{name}</span></button>
                  ))}
                </div>
              </div>
              {selectedCategory === 'CI' ? <button className="secondary-row" onClick={openTunePicker}><span className="setting-label poem-display">词牌</span><span className="secondary-value"><span className="control-text poem-display">{selectedTuneName}</span><span className="secondary-arrow">›</span></span></button> : null}
            </div>

            {selectedCategory === 'CLASSICAL' ? <div className="classical-form-row">
              <span className="setting-label poem-display">体裁</span>
              <div className="classical-form-grid">
                {[defaultForms.slice(0, 2), defaultForms.slice(2, 4), defaultForms.slice(4)].map((row, index) => (
                  <div className="classical-form-line" key={index}>{row.map((item) => <button key={item.code} className={`classical-form-option poem-display ${item.code === 'DAYOU_SHI' ? 'classical-form-option--doggerel' : ''} ${selectedForm === item.code ? 'classical-form-option--active' : ''}`} onClick={() => setForm(item.code)}><span className="control-text">{item.name}</span></button>)}</div>
                ))}
              </div>
            </div> : null}

            <button className={`primary-button poem-display ${isCreating || isUploading || isCheckingPreferences || isCheckingMaterials ? 'primary-button--disabled' : ''}`} onClick={() => void startCreation()}>
              <span className="primary-button__text">{isCreating ? '正在创作…' : isCheckingMaterials ? '正在检测素材…' : isCheckingPreferences ? '正在准备…' : '开始创作'}</span>
            </button>
            <div className="create-footer__safe-area" />
          </div>
        </div>
      </main>

      {showTunePicker ? <div className="tune-picker-overlay" onClick={() => setShowTunePicker(false)}>
        <section className="tune-picker-sheet" onClick={(event) => event.stopPropagation()}>
          <div className="tune-picker-head"><span className="tune-picker-spacer" /><h2 className="tune-picker-title poem-display">选择词牌</h2><button className="tune-picker-reset poem-display" onClick={() => { setPendingTuneCode(tunes[0]?.code || ''); setTuneSearch('') }}>重置</button></div>
          <label className="tune-search"><span className="tune-search__icon" /><input className="tune-search__input poem-display" value={tuneSearch} placeholder="搜索词牌名" onChange={(event) => setTuneSearch(event.target.value)} /></label>
          <div className="tune-options-scroll"><div className="tune-options">{visibleTunes.map((item) => <button key={item.code} className={`tune-option poem-display ${pendingTuneCode === item.code ? 'tune-option--active' : ''}`} onClick={() => setPendingTuneCode(item.code)}><span className="control-text">{item.name}</span></button>)}</div>{!visibleTunes.length ? <div className="tune-no-result poem-display">没有找到相关词牌</div> : null}</div>
          <button className="tune-confirm poem-display" onClick={confirmTunePicker}><span className="control-text">确定</span></button>
        </section>
      </div> : null}

      <MiniProgramTabBar />
      <WechatDialog
        open={loginReason !== null}
        title={loginReason === 'quota' ? '游客创作机会已用完' : '请登录后继续'}
        content={loginReason === 'quota' ? '每位游客可以创作一次，登录后可继续创作。' : '当前游客身份已绑定账号，登录后可继续上传素材和创作。'}
        confirmText="登录"
        onCancel={() => setLoginReason(null)}
        onConfirm={() => navigate('/login?returnTo=/create')}
      />
    </div>
  )
}
