import { deleteAsset, getAsset, uploadImageAsset, uploadVideoAsset } from '../../services/assets'
import { ApiError, hasAccessToken } from '../../services/api'
import { loginWithWechat } from '../../services/auth'
import {
  type ClassicalFormCode,
  consumeCreationEditDraft,
  consumeCreationReset,
  loadPoemTaxonomies,
  type PoemCategory,
  startCreationRun,
} from '../../services/creation'
import { ensureInstallation } from '../../services/installation'
import { loadCreationPreferences } from '../../services/preferences'
import { loadCreationQuota } from '../../services/profile'
import { STORAGE_KEYS } from '../../config/api'
import { showErrorToast } from '../../utils/error'

interface ValueChangeEvent {
  detail: {
    value: string
  }
}

type MaterialKind = 'IMAGE' | 'VIDEO'

const MAX_IMAGE_COUNT = 3
const MAX_VIDEO_COUNT = 1
const MAX_VIDEO_DURATION_SECONDS = 5

interface TunePatternItem {
  code: string
  name: string
  aliases: string[]
}

interface ClassicalFormItem {
  code: ClassicalFormCode
  name: string
}

interface ClassicalFormRow {
  key: string
  items: ClassicalFormItem[]
}

const DEFAULT_TUNE_PATTERNS: TunePatternItem[] = [
  { code: 'shui_diao_ge_tou', name: '水調歌頭', aliases: ['水调歌头'] },
]
const DEFAULT_CLASSICAL_FORMS: ClassicalFormItem[] = [
  { code: 'WUYAN_JUEJU', name: '五言绝句' },
  { code: 'QIYAN_JUEJU', name: '七言绝句' },
  { code: 'WUYAN_LVSHI', name: '五言律诗' },
  { code: 'QIYAN_LVSHI', name: '七言律诗' },
  { code: 'DAYOU_SHI', name: '打油诗' },
]

function groupClassicalForms(forms: ClassicalFormItem[]): ClassicalFormRow[] {
  const regularForms = forms.filter((form) => form.code !== 'DAYOU_SHI')
  const rows: ClassicalFormRow[] = []
  for (let index = 0; index < regularForms.length; index += 2) {
    rows.push({
      key: `regular-${index / 2}`,
      items: regularForms.slice(index, index + 2),
    })
  }
  const doggerel = forms.find((form) => form.code === 'DAYOU_SHI')
  if (doggerel) rows.push({ key: 'doggerel', items: [doggerel] })
  return rows
}

interface MaterialItem {
  id: string
  kind: MaterialKind
  sourceUrl: string
  previewUrl: string
  durationLabel: string
  status: 'READY' | 'PROCESSING'
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function normalizeTuneSearch(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '')
}

function matchesTuneSearch(item: TunePatternItem, query: string): boolean {
  return [item.name, ...item.aliases].some((candidate) =>
    normalizeTuneSearch(candidate).includes(query),
  )
}

function writingRuleHint(
  category: PoemCategory,
  answers: Record<string, string[]>,
): string {
  const traditional = answers.rhymeScheme?.[0] === 'TRADITIONAL'
  if (category === 'MODERN') return '现代诗默认使用简体中文'
  if (!traditional) return '使用中华新韵，默认以简体中文创作'
  return category === 'CI'
    ? '使用《词林正韵》，默认以繁体中文创作'
    : '使用《平水韵》，默认以繁体中文创作'
}

function confirmQuotaLogin(): Promise<boolean> {
  return new Promise((resolve) => {
    wx.showModal({
      title: '游客创作机会已用完',
      content: '当前游客额度已用完，登录后可按账号等级继续创作。',
      confirmText: '登录',
      confirmColor: '#3f6758',
      success: (result) => resolve(result.confirm),
      fail: () => resolve(false),
    })
  })
}

function confirmLinkedAccountLogin(): Promise<boolean> {
  return new Promise((resolve) => {
    wx.showModal({
      title: '请登录后继续',
      content: '当前游客身份已绑定账号，登录后可继续上传素材和创作。',
      confirmText: '登录',
      confirmColor: '#3f6758',
      success: (result) => resolve(result.confirm),
      fail: () => resolve(false),
    })
  })
}

function isLinkedInstallationError(error: unknown): boolean {
  return error instanceof ApiError
    && (
      error.code === 'INSTALLATION_LINKED'
      || (
        error.code === 'AUTH_REQUIRED'
        && error.message.includes('已关联账号')
      )
    )
}

async function uploadWithLoginRetry<T>(
  upload: () => Promise<T>,
  loadingTitle: string,
): Promise<T> {
  try {
    return await upload()
  } catch (error) {
    if (!isLinkedInstallationError(error)) throw error
    wx.hideLoading()
    if (!(await confirmLinkedAccountLogin())) {
      throw new ApiError('已取消登录', 'LOGIN_CANCELLED')
    }
    wx.showLoading({ title: '正在登录', mask: true })
    await loginWithWechat()
    wx.showLoading({ title: loadingTitle, mask: true })
    return upload()
  }
}

function chooseMaterials(options: {
  count: number
  mediaType: Array<'image' | 'video'>
}): Promise<WechatMiniprogram.ChooseMediaSuccessCallbackResult | null> {
  return new Promise((resolve, reject) => {
    wx.chooseMedia({
      count: options.count,
      mediaType: options.mediaType,
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      maxDuration: MAX_VIDEO_DURATION_SECONDS,
      success(result) {
        resolve(result)
      },
      fail(error) {
        if (error.errMsg.includes('cancel')) {
          resolve(null)
          return
        }
        reject(new Error(error.errMsg || '无法选择素材'))
      },
    })
  })
}

function selectedMediaKind(
  media: WechatMiniprogram.MediaFile,
  selectionType: string,
): MaterialKind {
  const path = media.tempFilePath.toLowerCase().split(/[?#]/, 1)[0] ?? ''
  const isVideo =
    selectionType === 'video'
    || Boolean(media.thumbTempFilePath)
    || Number(media.duration) > 0
    || /\.(mp4|mov|m4v|avi|webm)$/.test(path)
  return isVideo ? 'VIDEO' : 'IMAGE'
}

Page({
  data: {
    prompt: '',
    materials: [] as MaterialItem[],
    imageCount: 0,
    videoCount: 0,
    maxImageCount: MAX_IMAGE_COUNT,
    maxVideoCount: MAX_VIDEO_COUNT,
    isUploading: false,
    isCreating: false,
    isCheckingPreferences: false,
    isCheckingMaterials: false,
    preferenceCheckPassed: false,
    preferenceAnswers: {} as Record<string, string[]>,
    writingRuleHint: '使用中华新韵，默认以简体中文创作',
    editingWorkId: '',
    editingVersion: 0,
    quota: {
      limit: null as number | null,
      used: 0,
      remaining: null as number | null,
      dailyRemaining: null as number | null,
      totalRemaining: null as number | null,
      unlimited: false,
    },
    quotaLoaded: false,
    selectedCategory: 'CLASSICAL' as PoemCategory,
    selectedClassicalForm: 'WUYAN_JUEJU' as ClassicalFormCode,
    selectedClassicalIndex: 0,
    selectedTuneIndex: 0,
    selectedTuneCode: DEFAULT_TUNE_PATTERNS[0].code,
    selectedTuneName: DEFAULT_TUNE_PATTERNS[0].name,
    pendingTuneCode: DEFAULT_TUNE_PATTERNS[0].code,
    tuneSearch: '',
    showTunePicker: false,
    tunePatterns: DEFAULT_TUNE_PATTERNS,
    visibleTunePatterns: DEFAULT_TUNE_PATTERNS,
    classicalForms: DEFAULT_CLASSICAL_FORMS,
    classicalFormRows: groupClassicalForms(DEFAULT_CLASSICAL_FORMS),
    categories: [
      { code: 'CLASSICAL', name: '古体诗', icon: 'classical' },
      { code: 'MODERN', name: '现代诗', icon: 'modern' },
      { code: 'CI', name: '词', icon: 'ci' },
    ],
  },

  preferenceSelectionVersion: 0,

  onLoad() {
    void loadPoemTaxonomies()
      .then((taxonomies) => {
        const classical = taxonomies.categories.find(
          (category) => category.code === 'CLASSICAL',
        )
        const ci = taxonomies.categories.find((category) => category.code === 'CI')
        const remoteClassicalForms = new Map(
          (classical?.forms ?? []).map((form) => [form.code, form]),
        )
        const classicalForms = DEFAULT_CLASSICAL_FORMS.map(
          (fallback) => remoteClassicalForms.get(fallback.code) ?? fallback,
        )
        const tunePatterns = (ci?.tunePatterns ?? []).map((pattern) => ({
          code: pattern.code,
          name: pattern.name,
          aliases: Array.isArray(pattern.aliases) ? pattern.aliases : [],
        }))
        const selectedTuneIndex = Math.max(
          0,
          tunePatterns.findIndex((pattern) => pattern.code === this.data.selectedTuneCode),
        )
        const selectedTune = tunePatterns[selectedTuneIndex]
        this.setData({
          classicalForms,
          classicalFormRows: groupClassicalForms(classicalForms),
          ...(tunePatterns.length > 0
            ? {
                tunePatterns,
                visibleTunePatterns: tunePatterns,
                selectedTuneIndex,
                selectedTuneCode: selectedTune?.code ?? tunePatterns[0].code,
                selectedTuneName: selectedTune?.name ?? tunePatterns[0].name,
              }
            : {}),
        })
      })
      .catch(() => undefined)
  },

  onShow() {
    this.setData({ isCreating: false })
    const tabBar = this.getTabBar()
    if (tabBar) {
      tabBar.setData({ selected: 0 })
    }
    const shouldReset = consumeCreationReset()
    const editingDraft = consumeCreationEditDraft()
    if (editingDraft) {
      const materials: MaterialItem[] = editingDraft.assets.map((asset) => ({
        id: asset.id,
        kind: asset.kind,
        sourceUrl: asset.accessUrl,
        previewUrl: asset.kind === 'IMAGE' ? asset.accessUrl : asset.thumbnailUrl || '',
        durationLabel: '',
        status: 'READY',
      }))
      const tunePatternIndex = editingDraft.preferences.tunePatternCode
        ? this.data.tunePatterns.findIndex(
            (pattern) => pattern.code === editingDraft.preferences.tunePatternCode,
          )
        : 0
      this.setData({
        prompt: editingDraft.prompt,
        materials,
        imageCount: materials.filter((item) => item.kind === 'IMAGE').length,
        videoCount: materials.filter((item) => item.kind === 'VIDEO').length,
        selectedCategory: editingDraft.preferences.category,
        selectedClassicalForm:
          editingDraft.preferences.classicalFormCode || 'WUYAN_JUEJU',
        selectedClassicalIndex: Math.max(
          0,
          this.data.classicalForms.findIndex(
            (form) => form.code === editingDraft.preferences.classicalFormCode,
          ),
        ),
        selectedTuneIndex: Math.max(0, tunePatternIndex),
        selectedTuneCode:
          editingDraft.preferences.tunePatternCode
          || this.data.tunePatterns[Math.max(0, tunePatternIndex)]?.code
          || DEFAULT_TUNE_PATTERNS[0].code,
        selectedTuneName:
          this.data.tunePatterns[Math.max(0, tunePatternIndex)]?.name
          || DEFAULT_TUNE_PATTERNS[0].name,
        editingWorkId: editingDraft.workId,
        editingVersion: editingDraft.version,
      })
    } else if (shouldReset) {
      void this.resetCreationForm()
    }
    void this.refreshQuota()
    const preferenceResume = wx.getStorageSync(STORAGE_KEYS.creationResumeAfterPreferences)
    if (preferenceResume && typeof preferenceResume === 'object') {
      wx.removeStorageSync(STORAGE_KEYS.creationResumeAfterPreferences)
      const resumeAnswers =
        preferenceResume.answers &&
        typeof preferenceResume.answers === 'object'
          ? preferenceResume.answers as Record<string, string[]>
          : {}
      const poemType = String(resumeAnswers.poemType?.[0] || '')
      const selectedCategory = ['CLASSICAL', 'MODERN', 'CI'].includes(poemType)
        ? poemType as PoemCategory
        : this.data.selectedCategory
      this.setData({
        selectedCategory,
        preferenceCheckPassed: true,
        preferenceAnswers: resumeAnswers,
        writingRuleHint: writingRuleHint(selectedCategory, resumeAnswers),
      })
      setTimeout(() => void this.startCreation(), 80)
    }
  },

  async resetCreationForm() {
    this.preferenceSelectionVersion += 1
    const resetSelectionVersion = this.preferenceSelectionVersion
    wx.removeStorageSync(STORAGE_KEYS.creationResumeAfterPreferences)
    const defaultClassicalForm =
      this.data.classicalForms.find((form) => form.code === 'WUYAN_JUEJU')
      ?? this.data.classicalForms[0]
      ?? DEFAULT_CLASSICAL_FORMS[0]
    const defaultTune =
      this.data.tunePatterns.find(
        (pattern) => pattern.code === DEFAULT_TUNE_PATTERNS[0].code,
      )
      ?? this.data.tunePatterns[0]
      ?? DEFAULT_TUNE_PATTERNS[0]
    const applyReset = (
      selectedCategory: PoemCategory,
      preferenceAnswers: Record<string, string[]>,
    ) => {
      this.setData({
        prompt: '',
        materials: [],
        imageCount: 0,
        videoCount: 0,
        isUploading: false,
        isCreating: false,
        isCheckingPreferences: false,
        preferenceCheckPassed: false,
        preferenceAnswers,
        writingRuleHint: writingRuleHint(selectedCategory, preferenceAnswers),
        editingWorkId: '',
        editingVersion: 0,
        selectedCategory,
        selectedClassicalForm: defaultClassicalForm.code,
        selectedClassicalIndex: Math.max(
          0,
          this.data.classicalForms.findIndex(
            (form) => form.code === defaultClassicalForm.code,
          ),
        ),
        selectedTuneIndex: Math.max(
          0,
          this.data.tunePatterns.findIndex(
            (pattern) => pattern.code === defaultTune.code,
          ),
        ),
        selectedTuneCode: defaultTune.code,
        selectedTuneName: defaultTune.name,
        pendingTuneCode: defaultTune.code,
        tuneSearch: '',
        showTunePicker: false,
        visibleTunePatterns: this.data.tunePatterns,
      })
    }

    applyReset('CLASSICAL', {})
    wx.hideKeyboard()
    try {
      await ensureInstallation()
      const preferenceState = await loadCreationPreferences()
      const preferenceAnswers = preferenceState.preference?.answers ?? {}
      const preferredCategory = String(preferenceAnswers.poemType?.[0] || '')
      const selectedCategory: PoemCategory =
        preferredCategory === 'MODERN'
        || preferredCategory === 'CI'
        || preferredCategory === 'CLASSICAL'
          ? preferredCategory
          : 'CLASSICAL'
      if (this.preferenceSelectionVersion !== resetSelectionVersion) return
      this.setData({
        selectedCategory,
        preferenceAnswers,
        writingRuleHint: writingRuleHint(selectedCategory, preferenceAnswers),
      })
    } catch {
      // 保留已经应用的本地默认值；开始创作时仍会再次校验服务端偏好。
    }
  },

  async refreshQuota() {
    this.setData({ quotaLoaded: false })
    try {
      await ensureInstallation()
      const quota = await loadCreationQuota()
      this.setData({
        quota: {
          limit: quota.limit,
          used: quota.used,
          remaining: quota.remaining,
          dailyRemaining: quota.remaining,
          totalRemaining: quota.totalRemaining,
          unlimited: quota.unlimited,
        },
        quotaLoaded: true,
      })
    } catch {
      // Do not render a guessed quota. The create action still uses the
      // authoritative backend check when quota loading is unavailable.
    }
  },

  handlePromptInput(event: ValueChangeEvent) {
    this.setData({ prompt: event.detail.value })
  },

  selectCategory(event: WechatMiniprogram.TouchEvent) {
    const selectedCategory = String(event.currentTarget.dataset.code) as PoemCategory
    this.preferenceSelectionVersion += 1
    this.setData({
      selectedCategory,
      writingRuleHint: writingRuleHint(selectedCategory, this.data.preferenceAnswers),
    })
  },

  selectClassicalForm(event: WechatMiniprogram.TouchEvent) {
    const selectedClassicalForm = String(
      event.currentTarget.dataset.code,
    ) as ClassicalFormCode
    this.setData({
      selectedClassicalForm,
      selectedClassicalIndex: Math.max(
        0,
        this.data.classicalForms.findIndex((form) => form.code === selectedClassicalForm),
      ),
    })
  },

  openTunePicker() {
    this.setData({
      showTunePicker: true,
      pendingTuneCode: this.data.selectedTuneCode,
      tuneSearch: '',
      visibleTunePatterns: this.data.tunePatterns,
    })
  },

  closeTunePicker() {
    this.setData({
      showTunePicker: false,
      tuneSearch: '',
    })
  },

  preventMove() {},

  handleTuneSearch(event: ValueChangeEvent) {
    const tuneSearch = event.detail.value
    const query = normalizeTuneSearch(tuneSearch)
    this.setData({
      tuneSearch,
      visibleTunePatterns: query
        ? this.data.tunePatterns.filter((item) => matchesTuneSearch(item, query))
        : this.data.tunePatterns,
    })
  },

  selectPendingTune(event: WechatMiniprogram.TouchEvent) {
    const selectedTuneCode = String(event.currentTarget.dataset.code)
    if (!this.data.tunePatterns.some((item) => item.code === selectedTuneCode)) return
    this.setData({ pendingTuneCode: selectedTuneCode })
  },

  resetTunePicker() {
    const firstTune =
      this.data.tunePatterns.find(
        (item) => item.code === DEFAULT_TUNE_PATTERNS[0].code,
      )
      ?? this.data.tunePatterns[0]
      ?? DEFAULT_TUNE_PATTERNS[0]
    this.setData({
      pendingTuneCode: firstTune.code,
      tuneSearch: '',
      visibleTunePatterns: this.data.tunePatterns,
    })
  },

  confirmTunePicker() {
    const selectedTuneIndex = Math.max(
      0,
      this.data.tunePatterns.findIndex(
        (item) => item.code === this.data.pendingTuneCode,
      ),
    )
    const selectedTune = this.data.tunePatterns[selectedTuneIndex]
    if (!selectedTune) return
    this.setData({
      selectedTuneIndex,
      selectedTuneCode: selectedTune.code,
      selectedTuneName: selectedTune.name,
      showTunePicker: false,
      tuneSearch: '',
    })
  },

  async handleAddMaterial() {
    if (this.data.isUploading) return
    const remainingImages = MAX_IMAGE_COUNT - this.data.imageCount
    const remainingVideos = MAX_VIDEO_COUNT - this.data.videoCount
    if (remainingImages <= 0 && remainingVideos <= 0) {
      wx.showToast({ title: '素材数量已达上限', icon: 'none' })
      return
    }

    const mediaType: Array<'image' | 'video'> = []
    if (remainingImages > 0) mediaType.push('image')
    if (remainingVideos > 0) mediaType.push('video')

    let uploadedMaterials: MaterialItem[] = []
    try {
      const selection = await chooseMaterials({
        count: remainingImages + remainingVideos,
        mediaType,
      })
      if (!selection || selection.tempFiles.length === 0) return

      let availableImages = remainingImages
      let availableVideos = remainingVideos
      let ignoredByLimit = 0
      let ignoredLongVideo = 0
      const accepted = selection.tempFiles.flatMap((media) => {
        const kind = selectedMediaKind(media, selection.type)
        if (kind === 'VIDEO') {
          if (Number(media.duration) > MAX_VIDEO_DURATION_SECONDS) {
            ignoredLongVideo += 1
            return []
          }
          if (availableVideos <= 0) {
            ignoredByLimit += 1
            return []
          }
          availableVideos -= 1
        } else {
          if (availableImages <= 0) {
            ignoredByLimit += 1
            return []
          }
          availableImages -= 1
        }
        return [{ media, kind }]
      })

      if (accepted.length === 0) {
        wx.showToast({
          title: ignoredLongVideo > 0 ? '请选择5秒以内的视频' : '素材数量已达上限',
          icon: 'none',
        })
        return
      }

      this.setData({ isUploading: true })
      for (let index = 0; index < accepted.length; index += 1) {
        const { media, kind } = accepted[index]
        const loadingTitle = `正在上传 ${index + 1}/${accepted.length}`
        wx.showLoading({ title: loadingTitle, mask: true })
        if (kind === 'IMAGE') {
          const asset = await uploadWithLoginRetry(
            () => uploadImageAsset(media.tempFilePath, 'IMAGE'),
            loadingTitle,
          )
          const sourceUrl = asset.accessUrl || media.tempFilePath
          uploadedMaterials.push({
            id: asset.id,
            kind,
            sourceUrl,
            previewUrl: sourceUrl,
            durationLabel: '',
            status: 'READY',
          })
          continue
        }

        const asset = await uploadWithLoginRetry(
          () => uploadVideoAsset({
            filePath: media.tempFilePath,
            ...(media.thumbTempFilePath
              ? { thumbnailFilePath: media.thumbTempFilePath }
              : {}),
            width: media.width,
            height: media.height,
            durationSeconds: media.duration,
          }),
          loadingTitle,
        )
        uploadedMaterials.push({
          id: asset.id,
          kind,
          sourceUrl: asset.accessUrl || media.tempFilePath,
          previewUrl: asset.thumbnailUrl || media.thumbTempFilePath || '',
          durationLabel: `${media.duration.toFixed(1)}s`,
          status: asset.status === 'PROCESSING' ? 'PROCESSING' : 'READY',
        })
      }

      wx.hideLoading()
      this.appendMaterials(uploadedMaterials)
      const hasProcessingVideo = uploadedMaterials.some(
        (material) => material.kind === 'VIDEO' && material.status === 'PROCESSING',
      )
      uploadedMaterials = []
      const hasIgnored = ignoredByLimit > 0 || ignoredLongVideo > 0
      wx.showToast({
        title: hasIgnored
          ? '已添加可用素材，超出限制的已忽略'
          : hasProcessingVideo
            ? '视频已上传，正在检测'
            : '素材已添加',
        icon: hasIgnored || hasProcessingVideo ? 'none' : 'success',
        duration: hasIgnored ? 2600 : 1500,
      })
    } catch (error) {
      wx.hideLoading()
      if (uploadedMaterials.length > 0) {
        this.appendMaterials(uploadedMaterials)
      }
      if (!(error instanceof ApiError && error.code === 'LOGIN_CANCELLED')) {
        showErrorToast(error, { fallback: '素材上传失败，请稍后重试' })
      }
    } finally {
      this.setData({ isUploading: false })
    }
  },

  appendMaterials(incoming: MaterialItem[]) {
    const materials = [...this.data.materials, ...incoming]
    this.setData({
      materials,
      imageCount: materials.filter((item) => item.kind === 'IMAGE').length,
      videoCount: materials.filter((item) => item.kind === 'VIDEO').length,
    })
    for (const material of incoming) {
      if (material.status === 'PROCESSING') {
        void this.monitorMaterialModeration(material.id)
      }
    }
  },

  async monitorMaterialModeration(assetId: string) {
    for (let attempt = 0; attempt < 150; attempt += 1) {
      if (!this.data.materials.some((material) => material.id === assetId)) return
      await delay(2_000)
      try {
        const asset = await getAsset(assetId)
        if (asset.status === 'PROCESSING' || asset.moderationStatus === 'REVIEW') continue
        if (asset.status === 'READY' && asset.moderationStatus === 'PASSED') {
          this.setData({
            materials: this.data.materials.map((material) =>
              material.id === assetId
                ? {
                    ...material,
                    status: 'READY' as const,
                    sourceUrl: asset.accessUrl || material.sourceUrl,
                    previewUrl: asset.thumbnailUrl || material.previewUrl,
                  }
                : material,
            ),
          })
          wx.showToast({ title: '视频检测通过', icon: 'success' })
          return
        }
        this.dropMaterial(assetId)
        void deleteAsset(assetId).catch(() => undefined)
        wx.showToast({
          title:
            asset.status === 'REJECTED' || asset.moderationStatus === 'REJECTED'
              ? '您的素材涉嫌违规，请修改后重试'
              : '视频检测失败，请重新上传',
          icon: 'none',
          duration: 2800,
        })
        return
      } catch {
        // 网络波动时保留“检测中”，创作前还会再次向服务端确认。
      }
    }
  },

  dropMaterial(assetId: string) {
    const materials = this.data.materials.filter((material) => material.id !== assetId)
    this.setData({
      materials,
      imageCount: materials.filter((item) => item.kind === 'IMAGE').length,
      videoCount: materials.filter((item) => item.kind === 'VIDEO').length,
    })
  },

  async checkMaterialsBeforeCreation(): Promise<boolean> {
    if (this.data.materials.length === 0) return true
    this.setData({ isCheckingMaterials: true })
    try {
      const assets = await Promise.all(
        this.data.materials.map((material) => getAsset(material.id)),
      )
      const rejectedIds = assets
        .filter(
          (asset) => asset.status === 'REJECTED' || asset.moderationStatus === 'REJECTED',
        )
        .map((asset) => asset.id)
      if (rejectedIds.length > 0) {
        const rejected = new Set(rejectedIds)
        const materials = this.data.materials.filter((material) => !rejected.has(material.id))
        this.setData({
          materials,
          imageCount: materials.filter((item) => item.kind === 'IMAGE').length,
          videoCount: materials.filter((item) => item.kind === 'VIDEO').length,
        })
        for (const assetId of rejectedIds) void deleteAsset(assetId).catch(() => undefined)
        wx.showToast({
          title: '您的素材涉嫌违规，请修改后重试',
          icon: 'none',
          duration: 2800,
        })
        return false
      }
      const failedIds = assets
        .filter((asset) => asset.status === 'FAILED')
        .map((asset) => asset.id)
      if (failedIds.length > 0) {
        const failed = new Set(failedIds)
        const materials = this.data.materials.filter((material) => !failed.has(material.id))
        this.setData({
          materials,
          imageCount: materials.filter((item) => item.kind === 'IMAGE').length,
          videoCount: materials.filter((item) => item.kind === 'VIDEO').length,
        })
        for (const assetId of failedIds) void deleteAsset(assetId).catch(() => undefined)
        wx.showToast({ title: '素材检测失败，请重新上传', icon: 'none', duration: 2800 })
        return false
      }
      if (
        assets.some(
          (asset) => asset.status !== 'READY' || asset.moderationStatus !== 'PASSED',
        )
      ) {
        wx.showToast({ title: '素材还在检测中，请稍后', icon: 'none' })
        return false
      }
      const byId = new Map(assets.map((asset) => [asset.id, asset]))
      this.setData({
        materials: this.data.materials.map((material) => ({
          ...material,
          status: 'READY' as const,
          sourceUrl: byId.get(material.id)?.accessUrl || material.sourceUrl,
          previewUrl: byId.get(material.id)?.thumbnailUrl || material.previewUrl,
        })),
      })
      return true
    } catch (error) {
      showErrorToast(error, { fallback: '素材状态检查失败，请稍后重试' })
      return false
    } finally {
      this.setData({ isCheckingMaterials: false })
    }
  },

  previewMaterial(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id)
    const current = this.data.materials.findIndex((item) => item.id === id)
    if (current < 0) return
    wx.previewMedia({
      current,
      sources: this.data.materials.map((item) => ({
        url: item.sourceUrl,
        type: item.kind === 'VIDEO' ? 'video' : 'image',
        ...(item.previewUrl ? { poster: item.previewUrl } : {}),
      })),
    })
  },

  async removeMaterial(event: WechatMiniprogram.TouchEvent) {
    if (this.data.isUploading) return
    const id = String(event.currentTarget.dataset.id)
    const material = this.data.materials.find((item) => item.id === id)
    if (!material) return
    this.setData({ isUploading: true })
    wx.showLoading({ title: '正在移除', mask: true })
    try {
      await deleteAsset(id)
      const materials = this.data.materials.filter((item) => item.id !== id)
      this.setData({
        materials,
        imageCount: materials.filter((item) => item.kind === 'IMAGE').length,
        videoCount: materials.filter((item) => item.kind === 'VIDEO').length,
      })
      wx.hideLoading()
    } catch (error) {
      wx.hideLoading()
      showErrorToast(error, { fallback: '素材移除失败，请稍后重试' })
    } finally {
      this.setData({ isUploading: false })
    }
  },

  async startCreation() {
    if (
      this.data.isCreating ||
      this.data.isUploading ||
      this.data.isCheckingPreferences ||
      this.data.isCheckingMaterials
    ) return
    const prompt = this.data.prompt.trim()
    if (!prompt) {
      wx.showToast({ title: '先写下想表达的内容', icon: 'none' })
      return
    }
    if (!(await this.checkMaterialsBeforeCreation())) return
    if (!this.data.preferenceCheckPassed) {
      this.setData({ isCheckingPreferences: true })
      try {
        await ensureInstallation()
        const preferenceState = await loadCreationPreferences()
        if (!preferenceState.completed) {
          wx.navigateTo({ url: '/pages/creation-preferences/index?returnTo=create' })
          return
        }
        this.setData({
          preferenceCheckPassed: true,
          preferenceAnswers: preferenceState.preference?.answers ?? {},
          writingRuleHint: writingRuleHint(
            this.data.selectedCategory,
            preferenceState.preference?.answers ?? {},
          ),
        })
      } catch (error) {
        showErrorToast(error, { fallback: '创作准备失败，请稍后重试' })
        return
      } finally {
        this.setData({ isCheckingPreferences: false })
      }
    }
    if (
      this.data.quotaLoaded
      && !this.data.quota.unlimited
      && (this.data.quota.totalRemaining ?? this.data.quota.remaining ?? 0) <= 0
    ) {
      if (hasAccessToken()) {
        wx.showToast({ title: '可用创作次数已用完', icon: 'none' })
        return
      }
      if (!(await confirmQuotaLogin())) return
      wx.showLoading({ title: '正在登录', mask: true })
      try {
        await loginWithWechat()
        await this.refreshQuota()
      } catch (error) {
        showErrorToast(error, { fallback: '登录失败，请稍后重试' })
        return
      } finally {
        wx.hideLoading()
      }
    }
    const tunePattern =
      this.data.tunePatterns.find(
        (pattern) => pattern.code === this.data.selectedTuneCode,
      )
      || this.data.tunePatterns[this.data.selectedTuneIndex]
    if (this.data.selectedCategory === 'CI' && !tunePattern) {
      wx.showToast({ title: '请选择词牌', icon: 'none' })
      return
    }

    const preferences = {
      category: this.data.selectedCategory,
      classicalFormCode:
        this.data.selectedCategory === 'CLASSICAL' ? this.data.selectedClassicalForm : null,
      tunePatternCode: this.data.selectedCategory === 'CI' ? tunePattern?.code ?? null : null,
      rhymeScheme:
        this.data.preferenceAnswers.rhymeScheme?.[0] === 'TRADITIONAL'
          ? 'TRADITIONAL' as const
          : 'NEW_CHINESE' as const,
      preferredPoets: (this.data.preferenceAnswers.poets ?? []).slice(0, 20),
      styleTags: (this.data.preferenceAnswers.styles ?? [])
        .filter((style) => style !== '打油诗')
        .slice(0, 10),
      themeTags: (this.data.preferenceAnswers.themes ?? []).slice(0, 10),
      lengthHint: null,
    }

    this.setData({ isCreating: true })
    wx.showLoading({ title: '正在酝酿诗意', mask: true })
    try {
      const run = await startCreationRun({
        prompt,
        assetIds: this.data.materials.map((material) => material.id),
        assetKinds: this.data.materials.map((material) => material.kind),
        preferences,
        posterEnabled: this.data.preferenceAnswers.autoGeneratePoster?.[0] !== 'false',
        ...(this.data.editingWorkId
          ? {
              workId: this.data.editingWorkId,
              version: this.data.editingVersion,
            }
          : {}),
      })
      this.setData({
        editingWorkId: run.creationId || '',
        editingVersion: 0,
      })
      await new Promise<void>((resolve, reject) => {
        wx.navigateTo({
          url: `/pages/creating/index?runId=${encodeURIComponent(run.runId)}`,
          success: () => resolve(),
          fail: reject,
        })
      })
    } catch (error) {
      if (error instanceof ApiError && error.code === 'QUOTA_EXCEEDED') {
        this.setData({
          'quota.remaining': 0,
          'quota.totalRemaining': 0,
          quotaLoaded: true,
        })
      }
      showErrorToast(error, { fallback: '创作失败，请稍后重试', duration: 2800 })
    } finally {
      wx.hideLoading()
      this.setData({ isCreating: false, preferenceCheckPassed: false })
    }
  },
})
