import { uploadImageAsset } from '../../services/assets'
import { type FeedbackCategory, submitFeedback } from '../../services/feedback'
import { showErrorToast } from '../../utils/error'

type InputEvent = WechatMiniprogram.CustomEvent<{ value: string }>

const TYPE_CATEGORY_MAP: Record<string, FeedbackCategory> = {
  功能建议: 'SUGGESTION',
  体验问题: 'EXPERIENCE',
  内容问题: 'CONTENT',
  其他: 'OTHER',
}

Page({
  data: {
    types: ['功能建议', '体验问题', '内容问题', '其他'],
    selectedType: '功能建议',
    content: '',
    email: '',
    images: [] as string[],
    submitted: false,
    submitting: false,
  },

  selectType(event: WechatMiniprogram.TouchEvent) {
    this.setData({ selectedType: String(event.currentTarget.dataset.type) })
  },

  handleContentInput(event: InputEvent) {
    this.setData({ content: event.detail.value })
  },

  handleEmailInput(event: InputEvent) {
    this.setData({ email: event.detail.value })
  },

  chooseImages() {
    const remaining = 3 - this.data.images.length
    if (remaining <= 0) return
    wx.chooseMedia({
      count: remaining,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (result) => {
        const paths = result.tempFiles.map((file) => file.tempFilePath)
        this.setData({ images: this.data.images.concat(paths).slice(0, 3) })
      },
    })
  },

  previewImage(event: WechatMiniprogram.TouchEvent) {
    const current = String(event.currentTarget.dataset.src)
    wx.previewImage({ current, urls: this.data.images })
  },

  removeImage(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index)
    this.setData({ images: this.data.images.filter((_item, itemIndex) => itemIndex !== index) })
  },

  async submitFeedback() {
    if (this.data.submitting) return
    const content = this.data.content.trim()
    const email = this.data.email.trim()
    if (!content) {
      wx.showToast({ title: '请填写反馈内容', icon: 'none' })
      return
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      wx.showToast({ title: '请填写正确的邮箱地址', icon: 'none' })
      return
    }
    this.setData({ submitting: true })
    wx.showLoading({ title: '提交中...', mask: true })
    try {
      const imageAssetIds: string[] = []
      for (const filePath of this.data.images) {
        const asset = await uploadImageAsset(filePath, 'IMAGE', 'FEEDBACK')
        imageAssetIds.push(asset.id)
      }
      await submitFeedback({
        category: TYPE_CATEGORY_MAP[this.data.selectedType] ?? 'OTHER',
        content,
        ...(email ? { contact: email } : {}),
        imageAssetIds,
      })
      this.setData({ submitting: false, submitted: true })
    } catch (error) {
      showErrorToast(error, { fallback: '提交失败，请稍后重试' })
      this.setData({ submitting: false })
    } finally {
      wx.hideLoading()
    }
  },

  returnToHelp() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack()
      return
    }
    wx.redirectTo({ url: '/pages/help/index' })
  },

  continueFeedback() {
    this.setData({
      selectedType: '功能建议',
      content: '',
      email: '',
      images: [],
      submitted: false,
      submitting: false,
    })
  },
})
