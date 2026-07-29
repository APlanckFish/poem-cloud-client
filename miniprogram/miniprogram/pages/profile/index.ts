import { ApiError, hasAccessToken } from '../../services/api'
import {
  cachedUser,
  loginWithWechat,
  logout,
  restoreSession,
  updateWechatProfile,
} from '../../services/auth'
import { loadCreationQuota, loadProfileDashboard } from '../../services/profile'
import { getLocalCreationDrafts } from '../../services/creation'
import { ensureInstallation } from '../../services/installation'

type AvatarChoiceEvent = WechatMiniprogram.CustomEvent<{ avatarUrl: string }>
type ValueChangeEvent = WechatMiniprogram.CustomEvent<{ value: string }>

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : '服务暂时不可用，请稍后重试'
}

function quotaRingClass(
  remaining: number | null,
  limit: number | null,
  unlimited = false,
): string {
  if (unlimited) return 'quota-ring--3'
  if (limit === null || remaining === null) return 'quota-ring--0'
  if (limit <= 0 || remaining <= 0) return 'quota-ring--0'
  const progress = Math.min(1, remaining / limit)
  if (progress <= 1 / 3) return 'quota-ring--1'
  if (progress <= 2 / 3) return 'quota-ring--2'
  return 'quota-ring--3'
}

Page({
  data: {
    isLoggedIn: false,
    isLoading: false,
    isLoggingIn: false,
    isSavingProfile: false,
    showProfileSetup: false,
    pendingAvatarUrl: '',
    pendingNickname: '',
    user: null as PoemCloudUser | null,
    isLevelZeroVip: false,
    avatarInitial: '云',
    displayAvatarUrl: '',
    rankLabel: '小诗弟',
    stats: {
      works: 0,
      drafts: 0,
      likes: 0,
      following: 0,
    },
    quota: {
      limit: null as number | null,
      used: 0,
      remaining: null as number | null,
      unlimited: false,
    },
    quotaLoaded: false,
    quotaRingClass: 'quota-ring--0',
    libraryMenus: [
      { key: 'works', icon: '册', label: '我的作品', protected: true },
      { key: 'drafts', icon: '笺', label: '我的草稿', protected: false },
    ],
    accountMenus: [
      { key: 'preferences', icon: '调', label: '创作偏好', protected: false },
      { key: 'security', icon: '盾', label: '账号与安全', protected: true },
    ],
    supportMenus: [
      { key: 'feedback', icon: '问', label: '帮助与反馈', protected: false },
      { key: 'about', icon: '诗', label: '关于诗云', protected: false },
    ],
  },

  onLoad() {
    const user = cachedUser()
    if (user) {
      this.applyUser(user)
    }
  },

  onShow() {
    const tabBar = this.getTabBar()
    if (tabBar) {
      tabBar.setData({ selected: 2 })
    }
    void this.refreshProfile(false)
  },

  applyUser(user: PoemCloudUser) {
    this.setData({
      isLoggedIn: true,
      user,
      isLevelZeroVip: user.level === 0,
      avatarInitial: user.nickname.slice(0, 1) || '云',
      displayAvatarUrl: user.avatarUrl || '',
      rankLabel: user.level === 0
        ? '诗云黑金 SVIP'
        : `诗云 · 等级 ${user.level}`,
      'stats.following': user.followingCount,
    })
  },

  clearUser() {
    this.setData({
      isLoggedIn: false,
      user: null,
      isLevelZeroVip: false,
      avatarInitial: '云',
      displayAvatarUrl: '',
      rankLabel: '小诗弟',
      stats: {
        works: 0,
        drafts: getLocalCreationDrafts().length,
        likes: 0,
        following: 0,
      },
      quota: {
        limit: null as number | null,
        used: 0,
        remaining: null as number | null,
        unlimited: false,
      },
      quotaLoaded: false,
      quotaRingClass: 'quota-ring--0',
    })
  },

  async refreshGuestProfile() {
    this.clearUser()
    try {
      await ensureInstallation()
      const quota = await loadCreationQuota()
      this.setData({
        quota: {
          limit: quota.limit,
          used: quota.used,
          remaining: quota.remaining,
          unlimited: quota.unlimited,
        },
        quotaLoaded: true,
        quotaRingClass: quotaRingClass(quota.remaining, quota.limit, quota.unlimited),
      })
    } catch {
      // Keep the quota placeholder when the endpoint is unavailable.
    }
  },

  async refreshProfile(showError: boolean) {
    if (!hasAccessToken()) {
      await this.refreshGuestProfile()
      return
    }

    this.setData({ isLoading: true, quotaLoaded: false })
    try {
      const session = await restoreSession()
      if (!session) {
        await this.refreshGuestProfile()
        return
      }
      const { user } = session
      this.applyUser(user)
      // Current servers include dashboard data in /me. Keep the fallback only
      // for compatibility with an older deployment.
      const dashboard = session.dashboard || await loadProfileDashboard()
      this.setData({
        stats: {
          works: dashboard.workCount,
          drafts: dashboard.draftCount + getLocalCreationDrafts().length,
          likes: dashboard.receivedLikes,
          following: user.followingCount,
        },
        quota: {
          limit: dashboard.quota.limit,
          used: dashboard.quota.used,
          remaining: dashboard.quota.remaining,
          unlimited: dashboard.quota.unlimited,
        },
        quotaLoaded: true,
        quotaRingClass: quotaRingClass(
          dashboard.quota.remaining,
          dashboard.quota.limit,
          dashboard.quota.unlimited,
        ),
      })
    } catch (error) {
      if (showError) {
        wx.showToast({ title: errorMessage(error), icon: 'none' })
      }
    } finally {
      this.setData({ isLoading: false })
    }
  },

  async handleLogin() {
    if (this.data.isLoggingIn) {
      return
    }
    this.setData({ isLoggingIn: true })
    wx.showLoading({ title: '正在登录', mask: true })
    let loggedInUser: PoemCloudUser | null = null
    try {
      const user = await loginWithWechat()
      this.applyUser(user)
      await this.refreshProfile(false)
      loggedInUser = this.data.user
    } catch (error) {
      wx.showToast({ title: errorMessage(error), icon: 'none', duration: 2600 })
    } finally {
      this.setData({ isLoggingIn: false })
      wx.hideLoading()
    }
    if (loggedInUser) {
      wx.showToast({ title: '登录成功', icon: 'success' })
      if (!loggedInUser.profileCompleted) {
        this.openProfileSetup()
      }
    }
  },

  openProfileSetup() {
    const user = this.data.user
    if (!user) return
    this.setData({
      showProfileSetup: true,
      pendingAvatarUrl: user.avatarUrl || '',
      pendingNickname: user.nickname,
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
    if (!this.data.isSavingProfile) {
      this.setData({ showProfileSetup: false })
    }
  },

  preventMove() {},

  async handleProfileSetupSave() {
    if (this.data.isSavingProfile) return
    const nickname = this.data.pendingNickname.trim() || this.data.user?.nickname.trim() || ''
    const avatarUrl = this.data.pendingAvatarUrl || this.data.user?.avatarUrl || ''
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
      const user = await updateWechatProfile({
        nickname,
        avatarTempFilePath: avatarUrl,
      })
      this.applyUser(user)
      this.setData({ showProfileSetup: false })
      wx.showToast({ title: '资料已保存', icon: 'success' })
    } catch (error) {
      wx.showToast({ title: errorMessage(error), icon: 'none', duration: 2600 })
    } finally {
      wx.hideLoading()
      this.setData({ isSavingProfile: false })
    }
  },

  handleMenu(event: WechatMiniprogram.TouchEvent) {
    const protectedValue = event.currentTarget.dataset.protected
    const requiresLogin = protectedValue === true || protectedValue === 'true'
    if (requiresLogin && !this.data.isLoggedIn) {
      wx.showModal({
        title: '登录后使用',
        content: '登录后可同步你的作品与草稿。',
        confirmText: '登录',
        confirmColor: '#3f6758',
        success: (result) => {
          if (result.confirm) {
            void this.handleLogin()
          }
        },
      })
      return
    }
    const key = String(event.currentTarget.dataset.key)
    if (
      key === 'works'
      || key === 'drafts'
      || key === 'preferences'
      || key === 'feedback'
      || key === 'about'
    ) {
      const pageByKey: Record<string, string> = {
        works: '/pages/my-works/index',
        drafts: '/pages/my-drafts/index',
        preferences: '/pages/preference-settings/index',
        feedback: '/pages/help/index',
        about: '/pages/about/index',
      }
      wx.navigateTo({
        url: pageByKey[key],
      })
      return
    }
    wx.showToast({ title: '二级页面将在下一步接入', icon: 'none' })
  },

  handleLogout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后，本机仍会保留未登录草稿。',
      confirmText: '退出',
      confirmColor: '#8e584c',
      success: (result) => {
        if (result.confirm) {
          void this.performLogout()
        }
      },
    })
  },

  async performLogout() {
    wx.showLoading({ title: '正在退出', mask: true })
    try {
      await logout()
      this.clearUser()
      wx.hideLoading()
      wx.showToast({ title: '已退出登录', icon: 'none' })
    } catch (error) {
      this.clearUser()
      wx.hideLoading()
      wx.showToast({ title: errorMessage(error), icon: 'none' })
    }
  },
})
