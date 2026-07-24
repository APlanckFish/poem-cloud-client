Page({
  data: {
    expandedFaq: '',
    faqs: [
      {
        key: 'create',
        icon: '/assets/icons/help-create.png',
        question: '如何开始一次创作？',
        answer: '进入“创作”页，上传想写进诗里的图片或视频，选择诗体并补充灵感后即可开始创作。',
      },
      {
        key: 'upload',
        icon: '/assets/icons/help-upload.png',
        question: '素材上传失败怎么办？',
        answer: '请先检查网络和文件大小，再重新选择素材上传。单次最多上传 3 张图片或 1 个视频。',
      },
      {
        key: 'publish',
        icon: '/assets/icons/help-publish.png',
        question: '作品如何发布到诗词圈？',
        answer: '保存作品后，进入“我的作品”，在作品操作中选择“发布到诗词圈”即可。',
      },
    ],
  },

  toggleFaq(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key)
    this.setData({
      expandedFaq: this.data.expandedFaq === key ? '' : key,
    })
  },

  openFeedback() {
    wx.navigateTo({ url: '/pages/feedback/index' })
  },
})
