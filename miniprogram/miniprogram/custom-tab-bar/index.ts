Component({
  data: {
    selected: 0,
    list: [
      {
        pagePath: '/pages/create/index',
        text: '创作',
        iconPath: '/assets/icons/tab-create.svg',
        selectedIconPath: '/assets/icons/tab-create-active.svg',
      },
      {
        pagePath: '/pages/community/index',
        text: '诗词圈',
        iconPath: '/assets/icons/tab-community.svg',
        selectedIconPath: '/assets/icons/tab-community-active.svg',
      },
      {
        pagePath: '/pages/profile/index',
        text: '我的',
        iconPath: '/assets/icons/tab-profile.svg',
        selectedIconPath: '/assets/icons/tab-profile-active.svg',
      },
    ],
  },

  methods: {
    switchTab(event: WechatMiniprogram.TouchEvent) {
      const index = Number(event.currentTarget.dataset.index)
      const pagePath = String(event.currentTarget.dataset.path)
      if (index === this.data.selected) {
        return
      }
      this.setData({ selected: index })
      wx.switchTab({ url: pagePath })
    },
  },
})
