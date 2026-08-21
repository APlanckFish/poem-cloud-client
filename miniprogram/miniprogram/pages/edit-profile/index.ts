import { cachedUser, updateWechatProfile } from '../../services/auth'
import { showErrorToast } from '../../utils/error'

type AvatarChoiceEvent = WechatMiniprogram.CustomEvent<{ avatarUrl: string }>
type ValueChangeEvent = WechatMiniprogram.CustomEvent<{ value: string }>

Page({
  data: {
    user: null as PoemCloudUser | null,
    avatarUrl: '',
    nickname: '',
    signature: '',
    signatureLength: 0,
    isSaving: false,
  },

  onLoad() {
    const user = cachedUser()
    if (!user) {
      wx.navigateBack()
      return
    }
    const signature = user.signature?.trim() || ''
    this.setData({
      user,
      avatarUrl: user.avatarUrl || '',
      nickname: user.nickname,
      signature,
      signatureLength: signature.length,
    })
  },

  handleChooseAvatar(event: AvatarChoiceEvent) {
    const avatarUrl = event.detail.avatarUrl
    if (avatarUrl) this.setData({ avatarUrl })
  },

  handleNicknameInput(event: ValueChangeEvent) {
    this.setData({ nickname: event.detail.value || '' })
  },

  handleSignatureInput(event: ValueChangeEvent) {
    const signature = event.detail.value || ''
    this.setData({ signature, signatureLength: signature.length })
  },

  async saveProfile() {
    if (this.data.isSaving) return
    const nickname = this.data.nickname.trim()
    const signature = this.data.signature.trim()
    if (!nickname) {
      wx.showToast({ title: '昵称不能为空', icon: 'none' })
      return
    }

    this.setData({ isSaving: true })
    wx.showLoading({ title: '正在保存', mask: true })
    try {
      const user = await updateWechatProfile({
        nickname,
        signature,
        avatarTempFilePath: this.data.avatarUrl || undefined,
      })
      this.setData({ user, signature, signatureLength: signature.length })
      wx.showToast({ title: '修改已保存', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 450)
    } catch (error) {
      showErrorToast(error, { fallback: '资料保存失败，请稍后重试' })
    } finally {
      wx.hideLoading()
      this.setData({ isSaving: false })
    }
  },
})
