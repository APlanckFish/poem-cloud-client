import { cachedUser } from '../../services/auth'
import {
  followUser,
  loadUserFollowing,
  type PublicUser,
  unfollowUser,
} from '../../services/community'
import { showErrorToast } from '../../utils/error'

interface SocialUser extends PublicUser {
  displayAvatarUrl: string
}

const FALLBACK_AVATARS = [
  '/assets/images/cover-mountain.jpg',
  '/assets/images/cover-ridge.jpg',
  '/assets/images/cover-sunrise.jpg',
  '/assets/images/cover-alley.jpg',
]

Page({
  data: {
    user: null as PoemCloudUser | null,
    items: [] as SocialUser[],
    nextCursor: null as string | null,
    isLoading: false,
    hasLoaded: false,
    operatingId: '',
  },

  onLoad() {
    const user = cachedUser()
    if (!user) {
      wx.navigateBack()
      return
    }
    this.setData({ user })
    void this.loadFollowing(true)
  },

  async loadFollowing(reset = false) {
    const user = this.data.user
    if (!user || this.data.isLoading || (!reset && !this.data.nextCursor)) return
    this.setData({ isLoading: true })
    try {
      const response = await loadUserFollowing(
        user.id,
        reset ? undefined : this.data.nextCursor || undefined,
      )
      const mappedItems = response.items.map((item, index) => ({
        ...item,
        displayAvatarUrl:
          item.avatarUrl || FALLBACK_AVATARS[(this.data.items.length + index) % FALLBACK_AVATARS.length],
      }))
      const items = reset ? mappedItems : [...this.data.items, ...mappedItems]
      this.setData({ items, nextCursor: response.nextCursor, hasLoaded: true })
    } catch (error) {
      this.setData({ hasLoaded: true })
      showErrorToast(error, { fallback: '关注列表加载失败，请稍后重试' })
    } finally {
      this.setData({ isLoading: false })
    }
  },

  loadMore() {
    void this.loadFollowing(false)
  },

  goCommunity() {
    wx.switchTab({ url: '/pages/community/index' })
  },

  openUserWorks(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || '')
    if (!id) return
    wx.navigateTo({
      url: `/pages/my-works/index?userId=${encodeURIComponent(id)}`,
    })
  },

  async toggleFollow(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id)
    if (!id || this.data.operatingId) return
    const target = this.data.items.find((item) => item.id === id)
    if (!target) return
    this.setData({ operatingId: id })
    try {
      if (target.followedByMe) await unfollowUser(id)
      else await followUser(id)
      const followedByMe = !target.followedByMe
      const user = this.data.user
      this.setData({
        items: this.data.items.map((item) => (
          item.id === id ? { ...item, followedByMe } : item
        )),
        ...(user
          ? {
              user: {
                ...user,
                followingCount: Math.max(0, user.followingCount + (followedByMe ? 1 : -1)),
              },
            }
          : {}),
      })
    } catch (error) {
      showErrorToast(error, { fallback: '关注状态更新失败，请稍后重试' })
    } finally {
      this.setData({ operatingId: '' })
    }
  },
})
