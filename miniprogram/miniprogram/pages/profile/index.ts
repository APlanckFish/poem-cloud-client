import { hasAccessToken } from '../../services/api'
import {
  cachedUser,
  loginWithWechat,
  logout,
  restoreSession,
  updateWechatProfile,
} from '../../services/auth'
import {
  loadCreationQuota,
  loadProfileDashboard,
  type QuotaResponse,
} from '../../services/profile'
import { getLocalCreationDrafts } from '../../services/creation'
import { loadCommerceCatalog } from '../../services/commerce'
import { ensureInstallation } from '../../services/installation'
import { showErrorToast } from '../../utils/error'

type AvatarChoiceEvent = WechatMiniprogram.CustomEvent<{ avatarUrl: string }>
type ValueChangeEvent = WechatMiniprogram.CustomEvent<{ value: string }>

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

function quotaBreakdown(quota: QuotaResponse): {
  baseRemaining: number | null
  bonusRemaining: number
} {
  if (quota.unlimited) return { baseRemaining: null, bonusRemaining: 0 }
  const allocated = Math.max(0, quota.used) + Math.max(0, quota.reserved)
  const baseLimit = quota.baseLimit ?? Math.max(0, (quota.limit ?? 0) - quota.bonus)
  return {
    baseRemaining: quota.baseRemaining ?? Math.max(0, baseLimit - allocated),
    bonusRemaining:
      quota.bonusRemaining
      ?? Math.max(0, quota.bonus - Math.max(0, allocated - baseLimit)),
  }
}

function membershipThemeClasses(user: PoemCloudUser): {
  accountThemeClass: string
  quotaThemeClass: string
} {
  if (user.level <= 1) {
    return { accountThemeClass: '', quotaThemeClass: '' }
  }
  if (user.membership?.visualTheme === 'JADE') {
    return {
      accountThemeClass: 'account-tag--jade',
      quotaThemeClass: 'quota-card--jade',
    }
  }
  if (user.membership?.visualTheme === 'GILT') {
    return {
      accountThemeClass: 'account-tag--gilt',
      quotaThemeClass: 'quota-card--gilt',
    }
  }
  return {
    accountThemeClass: 'account-tag--member-default',
    quotaThemeClass: 'quota-card--member-default',
  }
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
    accountThemeClass: '',
    quotaThemeClass: '',
    avatarInitial: '云',
    displayAvatarUrl: '',
    rankLabel: '小诗弟',
    stats: {
      works: 0,
      drafts: 0,
      likes: 0,
      followers: 0,
    },
    quota: {
      baseLimit: null as number | null,
      baseRemaining: null as number | null,
      bonus: 0,
      bonusRemaining: 0,
      bonusLimit: 0,
      limit: null as number | null,
      used: 0,
      remaining: null as number | null,
      totalRemaining: null as number | null,
      purchasedCredits: {
        balance: 0,
        reserved: 0,
        remaining: 0,
      },
      unlimited: false,
    },
    quotaLoaded: false,
    commerceEnabled: false,
    quotaRingClass: 'quota-ring--0',
    libraryMenus: [
      { key: 'works', icon: '册', label: '我的作品', protected: true },
      { key: 'drafts', icon: '笺', label: '我的草稿', protected: false },
      { key: 'followers', icon: '友', label: '我的粉丝', protected: true },
      { key: 'following', icon: '伴', label: '我的关注', protected: true },
    ],
    accountMenus: [
      { key: 'commerce', icon: '购', label: '会员与创作额度', protected: true },
      { key: 'preferences', icon: '调', label: '创作偏好', protected: false },
      { key: 'edit-profile', icon: '编', label: '编辑资料', protected: true },
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
    void this.refreshCommerceAvailability()
    void this.refreshProfile(false)
  },

  async refreshCommerceAvailability() {
    if (!hasAccessToken()) {
      this.setData({ commerceEnabled: false })
      return
    }
    try {
      const catalog = await loadCommerceCatalog()
      this.setData({ commerceEnabled: catalog.paymentEnabled })
    } catch {
      this.setData({ commerceEnabled: false })
    }
  },

  applyUser(user: PoemCloudUser) {
    const themeClasses = membershipThemeClasses(user)
    this.setData({
      isLoggedIn: true,
      user,
      isLevelZeroVip: user.level === 0,
      ...themeClasses,
      avatarInitial: user.nickname.slice(0, 1) || '云',
      displayAvatarUrl: user.avatarUrl || '',
      rankLabel: user.level === 0
        ? '诗云黑金 SVIP'
        : user.membership?.name
          ? `诗云 · ${user.membership.name}`
          : `诗云 · 等级 ${user.level}`,
      'stats.followers': user.followerCount,
    })
  },

  clearUser() {
    this.setData({
      isLoggedIn: false,
      user: null,
      isLevelZeroVip: false,
      accountThemeClass: '',
      quotaThemeClass: '',
      avatarInitial: '云',
      displayAvatarUrl: '',
      rankLabel: '小诗弟',
      stats: {
        works: 0,
        drafts: getLocalCreationDrafts().length,
        likes: 0,
        followers: 0,
      },
      quota: {
        baseLimit: null as number | null,
        baseRemaining: null as number | null,
        bonus: 0,
        bonusRemaining: 0,
        bonusLimit: 0,
        limit: null as number | null,
        used: 0,
        remaining: null as number | null,
        totalRemaining: null as number | null,
        purchasedCredits: {
          balance: 0,
          reserved: 0,
          remaining: 0,
        },
        unlimited: false,
      },
      quotaLoaded: false,
      commerceEnabled: false,
      quotaRingClass: 'quota-ring--0',
    })
  },

  async refreshGuestProfile() {
    this.clearUser()
    try {
      await ensureInstallation()
      const quota = await loadCreationQuota()
      const breakdown = quotaBreakdown(quota)
      this.setData({
        quota: {
          baseLimit: quota.baseLimit ?? quota.limit,
          baseRemaining: breakdown.baseRemaining,
          bonus: quota.bonus ?? 0,
          bonusRemaining: breakdown.bonusRemaining,
          bonusLimit: quota.bonusLimit ?? 0,
          limit: quota.limit,
          used: quota.used,
          remaining: quota.remaining,
          totalRemaining: quota.totalRemaining,
          purchasedCredits: quota.purchasedCredits,
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
      const breakdown = quotaBreakdown(dashboard.quota)
      this.setData({
        stats: {
          works: dashboard.workCount,
          drafts: dashboard.draftCount + getLocalCreationDrafts().length,
          likes: dashboard.receivedLikes,
          followers: user.followerCount,
        },
        quota: {
          baseLimit: dashboard.quota.baseLimit ?? dashboard.quota.limit,
          baseRemaining: breakdown.baseRemaining,
          bonus: dashboard.quota.bonus ?? 0,
          bonusRemaining: breakdown.bonusRemaining,
          bonusLimit: dashboard.quota.bonusLimit ?? 0,
          limit: dashboard.quota.limit,
          used: dashboard.quota.used,
          remaining: dashboard.quota.remaining,
          totalRemaining: dashboard.quota.totalRemaining,
          purchasedCredits: dashboard.quota.purchasedCredits,
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
        showErrorToast(error)
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
      await Promise.all([this.refreshProfile(false), this.refreshCommerceAvailability()])
      loggedInUser = this.data.user
    } catch (error) {
      showErrorToast(error, { fallback: '登录失败，请稍后重试' })
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

  openEditProfile() {
    if (!this.data.isLoggedIn) return
    wx.navigateTo({ url: '/pages/edit-profile/index' })
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
      showErrorToast(error, { fallback: '资料保存失败，请稍后重试' })
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
      || key === 'followers'
      || key === 'following'
      || key === 'preferences'
      || key === 'commerce'
      || key === 'edit-profile'
      || key === 'feedback'
      || key === 'about'
    ) {
      const pageByKey: Record<string, string> = {
        works: '/pages/my-works/index',
        drafts: '/pages/my-drafts/index',
        followers: '/pages/followers/index',
        following: '/pages/following/index',
        preferences: '/pages/preference-settings/index',
        commerce: '/pages/commerce/index',
        'edit-profile': '/pages/edit-profile/index',
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
      void this.refreshGuestProfile()
    } catch (error) {
      this.clearUser()
      wx.hideLoading()
      showErrorToast(error, { fallback: '退出登录失败，请稍后重试' })
      void this.refreshGuestProfile()
    }
  },
})
