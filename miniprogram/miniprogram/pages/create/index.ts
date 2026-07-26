import { deleteAsset, uploadImageAsset, uploadVideoAsset } from '../../services/assets'
import { ApiError, hasAccessToken } from '../../services/api'
import { loginWithWechat } from '../../services/auth'
import {
  type ClassicalFormCode,
  consumeCreationEditDraft,
  consumeCreationReset,
  generatePoem,
  loadPoemTaxonomies,
  type PoemCategory,
  savePendingCreation,
} from '../../services/creation'
import { ensureInstallation } from '../../services/installation'
import { loadCreationPreferences } from '../../services/preferences'
import { loadCreationQuota } from '../../services/profile'
import { STORAGE_KEYS } from '../../config/api'

interface ValueChangeEvent {
  detail: {
    value: string
  }
}

interface PickerChangeEvent {
  detail: {
    value: string
  }
}

type MaterialKind = 'IMAGE' | 'VIDEO'

const MAX_IMAGE_COUNT = 3
const MAX_VIDEO_COUNT = 1
const DEFAULT_TUNE_PATTERNS = [{ code: 'shui_diao_ge_tou', name: '水调歌头' }]

interface MaterialItem {
  id: string
  kind: MaterialKind
  sourceUrl: string
  previewUrl: string
  durationLabel: string
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '素材上传失败，请稍后重试'
}

function confirmQuotaLogin(): Promise<boolean> {
  return new Promise((resolve) => {
    wx.showModal({
      title: '游客创作机会已用完',
      content: '每位游客可以创作一次，登录后可继续创作。',
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

function chooseMedia(kind: 'image' | 'video'): Promise<WechatMiniprogram.MediaFile | null> {
  return new Promise((resolve, reject) => {
    wx.chooseMedia({
      count: 1,
      mediaType: [kind],
      sourceType: ['album', 'camera'],
      sizeType: kind === 'image' ? ['compressed'] : undefined,
      maxDuration: kind === 'video' ? 15 : undefined,
      success(result) {
        resolve(result.tempFiles[0] ?? null)
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
    preferenceCheckPassed: false,
    preferenceAnswers: {} as Record<string, string[]>,
    editingWorkId: '',
    editingVersion: 0,
    quota: {
      limit: 0,
      used: 0,
      remaining: 0,
    },
    quotaLoaded: false,
    selectedCategory: 'CLASSICAL' as PoemCategory,
    selectedClassicalForm: 'WUYAN_JUEJU' as ClassicalFormCode,
    selectedTuneIndex: 0,
    tunePatterns: DEFAULT_TUNE_PATTERNS,
    classicalForms: [
      { code: 'WUYAN_JUEJU', name: '五言绝句' },
      { code: 'QIYAN_JUEJU', name: '七言绝句' },
      { code: 'WUYAN_LVSHI', name: '五言律诗' },
      { code: 'QIYAN_LVSHI', name: '七言律诗' },
    ],
    categories: [
      { code: 'CLASSICAL', name: '古体诗', icon: 'classical' },
      { code: 'MODERN', name: '现代诗', icon: 'modern' },
      { code: 'CI', name: '词', icon: 'ci' },
    ],
  },

  onLoad() {
    void loadPoemTaxonomies()
      .then((taxonomies) => {
        const ci = taxonomies.categories.find((category) => category.code === 'CI')
        if (ci?.tunePatterns && ci.tunePatterns.length > 0) {
          this.setData({
            tunePatterns: ci.tunePatterns,
            selectedTuneIndex: 0,
          })
        }
      })
      .catch(() => undefined)
  },

  onShow() {
    const tabBar = this.getTabBar()
    if (tabBar) {
      tabBar.setData({ selected: 0 })
    }
    if (consumeCreationReset()) {
      this.setData({
        prompt: '',
        materials: [],
        imageCount: 0,
        videoCount: 0,
        editingWorkId: '',
        editingVersion: 0,
      })
    }
    const editingDraft = consumeCreationEditDraft()
    if (editingDraft) {
      const materials: MaterialItem[] = editingDraft.assets.map((asset) => ({
        id: asset.id,
        kind: asset.kind,
        sourceUrl: asset.accessUrl,
        previewUrl: asset.kind === 'IMAGE' ? asset.accessUrl : asset.thumbnailUrl || '',
        durationLabel: '',
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
        selectedTuneIndex: Math.max(0, tunePatternIndex),
        editingWorkId: editingDraft.workId,
        editingVersion: editingDraft.version,
      })
    }
    void this.refreshQuota()
    const preferenceResume = wx.getStorageSync(STORAGE_KEYS.creationResumeAfterPreferences)
    if (preferenceResume && typeof preferenceResume === 'object') {
      wx.removeStorageSync(STORAGE_KEYS.creationResumeAfterPreferences)
      const poemType = String(preferenceResume.poemType || '')
      const selectedCategory = ['CLASSICAL', 'MODERN', 'CI'].includes(poemType)
        ? poemType as PoemCategory
        : this.data.selectedCategory
      this.setData({
        selectedCategory,
        preferenceCheckPassed: true,
        preferenceAnswers: {
          poemType: poemType ? [poemType] : [],
          styles: Array.isArray(preferenceResume.styles) ? preferenceResume.styles : [],
        },
      })
      setTimeout(() => void this.startCreation(), 80)
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
    this.setData({
      selectedCategory: String(event.currentTarget.dataset.code) as PoemCategory,
    })
  },

  selectClassicalForm(event: WechatMiniprogram.TouchEvent) {
    this.setData({
      selectedClassicalForm: String(event.currentTarget.dataset.code) as ClassicalFormCode,
    })
  },

  handleTunePatternChange(event: PickerChangeEvent) {
    this.setData({ selectedTuneIndex: Number(event.detail.value) })
  },

  async handleAddImage() {
    if (this.data.isUploading || this.data.imageCount >= MAX_IMAGE_COUNT) return
    try {
      const media = await chooseMedia('image')
      if (!media) return
      this.setData({ isUploading: true })
      wx.showLoading({ title: '正在上传图片', mask: true })
      const asset = await uploadWithLoginRetry(
        () => uploadImageAsset(media.tempFilePath, 'IMAGE'),
        '正在上传图片',
      )
      const sourceUrl = asset.accessUrl || media.tempFilePath
      this.appendMaterial({
        id: asset.id,
        kind: 'IMAGE',
        sourceUrl,
        previewUrl: sourceUrl,
        durationLabel: '',
      })
      wx.showToast({ title: '图片已添加', icon: 'success' })
    } catch (error) {
      if (!(error instanceof ApiError && error.code === 'LOGIN_CANCELLED')) {
        wx.showToast({ title: errorMessage(error), icon: 'none', duration: 2600 })
      }
    } finally {
      wx.hideLoading()
      this.setData({ isUploading: false })
    }
  },

  async handleAddVideo() {
    if (this.data.isUploading || this.data.videoCount >= MAX_VIDEO_COUNT) return
    try {
      const media = await chooseMedia('video')
      if (!media) return
      if (media.duration > 15) {
        wx.showToast({ title: '请选择15秒以内的视频', icon: 'none' })
        return
      }
      this.setData({ isUploading: true })
      wx.showLoading({ title: '正在上传视频', mask: true })
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
        '正在上传视频',
      )
      this.appendMaterial({
        id: asset.id,
        kind: 'VIDEO',
        sourceUrl: asset.accessUrl || media.tempFilePath,
        previewUrl: asset.thumbnailUrl || media.thumbTempFilePath || '',
        durationLabel: `${media.duration.toFixed(1)}s`,
      })
      wx.showToast({ title: '视频已添加', icon: 'success' })
    } catch (error) {
      if (!(error instanceof ApiError && error.code === 'LOGIN_CANCELLED')) {
        wx.showToast({ title: errorMessage(error), icon: 'none', duration: 2600 })
      }
    } finally {
      wx.hideLoading()
      this.setData({ isUploading: false })
    }
  },

  appendMaterial(material: MaterialItem) {
    const materials = [...this.data.materials, material]
    this.setData({
      materials,
      imageCount: materials.filter((item) => item.kind === 'IMAGE').length,
      videoCount: materials.filter((item) => item.kind === 'VIDEO').length,
    })
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
    } catch (error) {
      wx.showToast({ title: errorMessage(error), icon: 'none', duration: 2600 })
    } finally {
      wx.hideLoading()
      this.setData({ isUploading: false })
    }
  },

  async startCreation() {
    if (this.data.isCreating || this.data.isUploading || this.data.isCheckingPreferences) return
    const prompt = this.data.prompt.trim()
    if (!prompt) {
      wx.showToast({ title: '先写下想表达的内容', icon: 'none' })
      return
    }
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
        })
      } catch (error) {
        wx.showToast({ title: errorMessage(error), icon: 'none', duration: 2600 })
        return
      } finally {
        this.setData({ isCheckingPreferences: false })
      }
    }
    if (this.data.quotaLoaded && this.data.quota.remaining <= 0) {
      if (hasAccessToken()) {
        wx.showToast({ title: '今日创作次数已用完', icon: 'none' })
        return
      }
      if (!(await confirmQuotaLogin())) return
      wx.showLoading({ title: '正在登录', mask: true })
      try {
        await loginWithWechat()
        await this.refreshQuota()
      } catch (error) {
        wx.showToast({ title: errorMessage(error), icon: 'none', duration: 2600 })
        return
      } finally {
        wx.hideLoading()
      }
    }
    const tunePattern = this.data.tunePatterns[this.data.selectedTuneIndex]
    if (this.data.selectedCategory === 'CI' && !tunePattern) {
      wx.showToast({ title: '请选择词牌', icon: 'none' })
      return
    }

    const preferences = {
      category: this.data.selectedCategory,
      classicalFormCode:
        this.data.selectedCategory === 'CLASSICAL' ? this.data.selectedClassicalForm : null,
      tunePatternCode: this.data.selectedCategory === 'CI' ? tunePattern?.code ?? null : null,
      styleTags: (this.data.preferenceAnswers.styles ?? []).slice(0, 10),
      lengthHint: null,
    }

    this.setData({ isCreating: true })
    wx.showLoading({ title: '正在酝酿诗意', mask: true })
    try {
      const creation = await generatePoem({
        prompt,
        assetIds: this.data.materials.map((material) => material.id),
        assetKinds: this.data.materials.map((material) => material.kind),
        preferences,
        ...(this.data.editingWorkId
          ? {
              workId: this.data.editingWorkId,
              version: this.data.editingVersion,
            }
          : {}),
      })
      this.setData({
        editingWorkId: creation.workId || '',
        editingVersion: 0,
      })
      savePendingCreation(creation)
      await new Promise<void>((resolve, reject) => {
        wx.navigateTo({
          url: '/pages/create-result/index',
          success: () => resolve(),
          fail: reject,
        })
      })
    } catch (error) {
      if (error instanceof ApiError && error.code === 'QUOTA_EXCEEDED') {
        this.setData({
          'quota.remaining': 0,
          quotaLoaded: true,
        })
      }
      wx.showToast({ title: errorMessage(error), icon: 'none', duration: 2800 })
    } finally {
      wx.hideLoading()
      this.setData({ isCreating: false, preferenceCheckPassed: false })
    }
  },
})
