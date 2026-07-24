import { hasAccessToken } from '../../services/api'
import {
  cachedUser,
  loginWithWechat,
  restoreSession,
  updateWechatProfile,
} from '../../services/auth'
import {
  clearPendingCreation,
  discardPendingCreation,
  getPendingCreation,
  type PendingCreation,
  publishCreation,
  saveCreationAsDraft,
  saveCreationAsWork,
} from '../../services/creation'
import { loadCreationQuota } from '../../services/profile'

interface ValueChangeEvent {
  detail: {
    value: string
  }
}

type AvatarChoiceEvent = WechatMiniprogram.CustomEvent<{ avatarUrl: string }>

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '操作失败，请稍后重试'
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
    creation: null as PendingCreation | null,
    title: '',
    isSavingDraft: false,
    isSaving: false,
    isPublishing: false,
    isEmpty: false,
    quotaRemaining: null as number | null,
    isLeaving: false,
    showProfileSetup: false,
    isSavingProfile: false,
    pendingAvatarUrl: '',
    pendingNickname: '',
    resumeSaveAfterProfile: false,
  },

  onLoad() {
    const creation = getPendingCreation()
    if (!creation) {
      this.setData({ isEmpty: true })
      return
    }
    this.setData({
      creation: {
        ...creation,
        assetKinds: creation.assetKinds || [],
        draftSaved: creation.draftSaved ?? false,
      },
      title: creation.result.title,
      quotaRemaining: creation.remainingQuota,
    })
    void this.refreshQuota()
  },

  onUnload() {
    const creation = this.data.creation
    if (
      creation
      && !creation.saved
      && !creation.draftSaved
      && !this.data.isLeaving
    ) {
      void discardPendingCreation(creation).catch(() => undefined)
    }
  },

  async refreshQuota() {
    try {
      const quota = await loadCreationQuota()
      this.setData({ quotaRemaining: quota.remaining })
    } catch {
      // Keep the generation response value when the live quota is unavailable.
    }
  },

  handleTitleInput(event: ValueChangeEvent) {
    this.setData({ title: event.detail.value })
  },

  handleBack() {
    const creation = this.data.creation
    if (!creation || creation.saved || creation.draftSaved) {
      wx.navigateBack()
      return
    }
    wx.showModal({
      title: '保存本次创作？',
      content: '保存后可以在“我的草稿”中继续创作。',
      confirmText: '保存草稿',
      cancelText: '不保存',
      confirmColor: '#3f6758',
      success: (result) => {
        if (result.confirm) {
          void this.saveBeforeLeaving()
        } else if (result.cancel) {
          void this.discardBeforeLeaving()
        }
      },
    })
  },

  async saveBeforeLeaving() {
    const creation = this.data.creation
    if (!creation || this.data.isLeaving) return
    this.setData({ isLeaving: true })
    wx.showLoading({ title: '正在保存草稿', mask: true })
    try {
      const updated = await saveCreationAsDraft(creation)
      this.setData({ creation: updated })
      wx.navigateBack()
    } catch (error) {
      wx.showToast({ title: errorMessage(error), icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ isLeaving: false })
    }
  },

  async discardBeforeLeaving() {
    const creation = this.data.creation
    if (!creation || this.data.isLeaving) return
    this.setData({ isLeaving: true })
    wx.showLoading({ title: '正在退出', mask: true })
    try {
      await discardPendingCreation(creation)
      wx.navigateBack()
    } catch (error) {
      wx.showToast({ title: errorMessage(error), icon: 'none' })
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
        await this.refreshQuota()
      } catch (error) {
        wx.showToast({ title: errorMessage(error), icon: 'none', duration: 2600 })
        return false
      } finally {
        wx.hideLoading()
      }
    } else if (!user) {
      try {
        const session = await restoreSession()
        user = session?.user || null
      } catch (error) {
        wx.showToast({ title: errorMessage(error), icon: 'none', duration: 2600 })
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
    if (typeof value === 'string') {
      this.setData({ pendingNickname: value })
    }
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
      if (shouldResumeSave) {
        void this.handleSave()
      }
    } catch (error) {
      wx.showToast({ title: errorMessage(error), icon: 'none', duration: 2600 })
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
      this.setData({ creation: updated })
      wx.showToast({
        title: updated.localDraftId ? '草稿已保存在本机' : '已存入我的草稿',
        icon: 'success',
      })
    } catch (error) {
      wx.showToast({ title: errorMessage(error), icon: 'none', duration: 2800 })
    } finally {
      wx.hideLoading()
      this.setData({ isSavingDraft: false })
    }
  },

  async handleSave() {
    let creation = this.data.creation
    if (
      !creation
      || creation.saved
      || this.data.isSaving
      || this.data.isSavingDraft
    ) return
    if (!(await this.ensureLoggedIn())) return
    creation = getPendingCreation() || creation

    this.setData({ isSaving: true })
    wx.showLoading({ title: '正在保存作品', mask: true })
    try {
      const updated = await saveCreationAsWork(creation, this.data.title)
      this.setData({ creation: updated })
      wx.showToast({ title: '作品已保存', icon: 'success' })
    } catch (error) {
      wx.showToast({ title: errorMessage(error), icon: 'none', duration: 2800 })
    } finally {
      wx.hideLoading()
      this.setData({ isSaving: false })
    }
  },

  handlePublish() {
    const creation = this.data.creation
    if (!creation || !creation.saved || creation.published || this.data.isPublishing) return
    wx.showModal({
      title: '发布到诗词圈',
      content: '作品将公开展示。发布即表示你同意诗词圈社区规范。',
      confirmText: '发布',
      confirmColor: '#3f6758',
      success: (result) => {
        if (result.confirm) {
          void this.performPublish()
        }
      },
    })
  },

  async performPublish() {
    const creation = this.data.creation
    if (!creation || this.data.isPublishing) return
    this.setData({ isPublishing: true })
    wx.showLoading({ title: '正在发布', mask: true })
    try {
      const publication = await publishCreation(creation)
      this.setData({
        creation: { ...creation, published: true },
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
      wx.showToast({ title: errorMessage(error), icon: 'none', duration: 2800 })
    } finally {
      wx.hideLoading()
      this.setData({ isPublishing: false })
    }
  },
})
