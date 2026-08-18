Component({
  data: {
    selected: 0,
    skylineMode: false,
    list: [
      {
        pagePath: '/pages/create/index',
        text: '创作',
        iconPath: '/assets/icons/tab-create.png',
        selectedIconPath: '/assets/icons/tab-create-active.png',
      },
      {
        pagePath: '/pages/community/index',
        text: '诗词圈',
        iconPath: '/assets/icons/tab-community.png',
        selectedIconPath: '/assets/icons/tab-community-active.png',
      },
      {
        pagePath: '/pages/profile/index',
        text: '我的',
        iconPath: '/assets/icons/tab-profile.png',
        selectedIconPath: '/assets/icons/tab-profile-active.png',
      },
    ],
  },

  pageLifetimes: {
    show() {
      const pages = getCurrentPages()
      const currentPage = pages[pages.length - 1]
      this.setData({ skylineMode: currentPage?.route === 'pages/community/index' })
    },
  },

  methods: {
    preventTouch() {},

    switchTab(event: WechatMiniprogram.TouchEvent) {
      const index = Number(event.currentTarget.dataset.index)
      const pagePath = String(event.currentTarget.dataset.path)
      const pages = getCurrentPages()
      const currentPage = pages[pages.length - 1] as unknown as {
        route?: string
        handleCommunityTabRetap?: () => void
      }
      if (index === 1 && currentPage?.route === 'pages/community/index') {
        currentPage.handleCommunityTabRetap?.()
        return
      }
      if (index === this.data.selected) {
        return
      }
      this.setData({ selected: index })
      wx.switchTab({ url: pagePath })
    },
  },
})
