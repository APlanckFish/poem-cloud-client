Page({
  data: {
    version: '1.0.0',
    showLegalDocuments: false,
    documents: [
      { key: 'agreement', icon: '/assets/icons/about-agreement.png', label: '用户协议' },
      { key: 'privacy', icon: '/assets/icons/about-privacy.png', label: '隐私政策' },
      { key: 'sharing', icon: '/assets/icons/about-sharing.png', label: '第三方信息共享清单' },
    ],
  },

  openDeveloperMessage() {
    wx.navigateTo({ url: '/pages/developer-message/index' })
  },

  handleDocumentTap() {
    wx.showToast({ title: '相关内容正在整理', icon: 'none' })
  },
})
