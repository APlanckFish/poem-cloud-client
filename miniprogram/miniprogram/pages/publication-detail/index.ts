import { hasAccessToken } from '../../services/api'
import { cachedUser, loginWithWechat } from '../../services/auth'
import {
  type CommunityPublication,
  followUser,
  getPublication,
  getPublicUser,
  likePublication,
  unfollowUser,
  unlikePublication,
} from '../../services/community'
import type { PoemCategory } from '../../services/creation'
import {
  getLibraryWork,
  loadTunePatternNames,
  type TunePatternNames,
} from '../../services/library'

interface PublicationView {
  id: string
  title: string
  content: string
  category: PoemCategory
  classicalFormCode: string | null
  tunePatternCode: string | null
  likeCount: number
  likedByMe: boolean
  posterUrl: string
  coverUrl: string | null
  publishedAt: string | null
  createdAt: string
  author: {
    id: string
    nickname: string
    avatarAssetId?: string | null
    avatarUrl: string | null
  }
}

const CLASSICAL_FORM_NAMES: Record<string, string> = {
  WUYAN_JUEJU: '五言绝句',
  QIYAN_JUEJU: '七言绝句',
  WUYAN_LVSHI: '五言律诗',
  QIYAN_LVSHI: '七言律诗',
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

function normalizePoemContent(value: string): string {
  return value.replace(/\\n/g, '\n').replace(/\r\n?/g, '\n')
}

function usablePoster(publication: PublicationView): string {
  return publication.coverUrl || fallbackCover(publication.category)
}

function confirmLogin(): Promise<boolean> {
  return new Promise((resolve) => {
    wx.showModal({
      title: '登录后继续',
      content: '登录后可以点赞、关注并同步互动状态。',
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
    categoryName: '',
    publishedDate: '',
    coverUrl: '',
    authorInitial: '诗',
    isLoading: true,
    isPublic: false,
    isLiking: false,
    canFollow: false,
    followedByMe: false,
    isFollowing: false,
    showLikeBurst: false,
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
      wx.showToast({
        title: error instanceof Error ? error.message : '作品加载失败',
        icon: 'none',
      })
    } finally {
      this.setData({ isLoading: false })
    }
  },

  async loadPrivateWork(workId: string) {
    try {
      const [work, user, tunePatternNames] = await Promise.all([
        getLibraryWork(workId),
        Promise.resolve(cachedUser()),
        loadTunePatternNames().catch(() => ({})),
      ])
      this.applyPublication({
        id: '',
        workId: work.id,
        title: work.title || '未命名作品',
        content: work.content || '',
        category: work.category,
        classicalFormCode: work.classicalFormCode,
        tunePatternCode: work.tunePatternCode,
        likeCount: work.publication?.likeCount || 0,
        likedByMe: false,
        posterUrl: '',
        coverUrl:
          work.assets?.find((asset) => asset.kind === 'IMAGE' && asset.accessUrl)?.accessUrl ||
          work.assets?.find((asset) => asset.kind === 'VIDEO' && asset.thumbnailUrl)?.thumbnailUrl ||
          null,
        publishedAt: null,
        createdAt: work.createdAt,
        author: {
          id: user?.id || '',
          nickname: user?.nickname || '我',
          avatarUrl: user?.avatarUrl || null,
        },
      }, false, tunePatternNames)
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : '作品加载失败',
        icon: 'none',
      })
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
    const normalizedPublication = {
      ...publication,
      content: normalizePoemContent(publication.content),
      author: {
        ...publication.author,
        avatarUrl: authorAvatarUrl,
      },
    }
    this.setData({
      publication: normalizedPublication,
      isPublic,
      categoryName: publicationTypeName(normalizedPublication, tunePatternNames),
      publishedDate: displayDate(
        normalizedPublication.publishedAt || normalizedPublication.createdAt,
      ),
      coverUrl: usablePoster(normalizedPublication),
      authorInitial: normalizedPublication.author.nickname.slice(0, 1) || '诗',
    })
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
        wx.showToast({
          title: error instanceof Error ? error.message : '登录失败',
          icon: 'none',
        })
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
      wx.showToast({
        title: error instanceof Error ? error.message : '操作失败',
        icon: 'none',
      })
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
        wx.showToast({
          title: error instanceof Error ? error.message : '登录失败',
          icon: 'none',
        })
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
      wx.showToast({
        title: error instanceof Error ? error.message : '操作失败',
        icon: 'none',
      })
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
