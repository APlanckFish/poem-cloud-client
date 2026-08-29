import { hasAccessToken } from '../../services/api'
import { cachedUser, restoreSession } from '../../services/auth'
import {
  loadCommerceCatalog,
  purchaseCommerceProduct,
  type CommerceCatalog,
  type MembershipVisualTheme,
} from '../../services/commerce'
import { loadCreationQuota } from '../../services/profile'
import { showErrorToast } from '../../utils/error'

interface PriceParts {
  integer: string
  decimal: string
}

type MembershipView = CommerceCatalog['memberships'][number] & PriceParts & {
  themeClass: string
  themeMark: string
  purchaseDisabled: boolean
  purchaseLabel: string
}

type CreditPackageView = CommerceCatalog['creditPackages'][number] & PriceParts & {
  originalPriceText: string
}

function priceParts(priceCents: number): PriceParts {
  const integer = Math.floor(priceCents / 100).toString()
  const cents = priceCents % 100
  return {
    integer,
    decimal: cents === 0 ? '' : `.${cents.toString().padStart(2, '0')}`,
  }
}

function priceText(priceCents: number): string {
  const price = priceParts(priceCents)
  return `¥${price.integer}${price.decimal}`
}

function membershipTheme(theme: MembershipVisualTheme): {
  themeClass: string
  themeMark: string
} {
  if (theme === 'JADE') return { themeClass: 'membership-card--jade', themeMark: '玉' }
  if (theme === 'GILT') return { themeClass: 'membership-card--gilt', themeMark: '金' }
  return { themeClass: 'membership-card--default', themeMark: '诗' }
}

function membershipRank(level: number): number {
  return level === 0 ? Number.MAX_SAFE_INTEGER : level
}

Page({
  data: {
    loading: true,
    paymentEnabled: false,
    purchasingKey: '',
    memberships: [] as MembershipView[],
    creditPackages: [] as CreditPackageView[],
    purchasedCreditBalance: 0,
    currentLevel: 1,
    currentMembershipName: '普通会员',
    membershipExpiresText: '',
    upgradeTarget: null as MembershipView | null,
  },

  onShow() {
    if (!hasAccessToken()) {
      wx.showModal({
        title: '请先登录',
        content: '购买会员或创作额度前，需要先登录微信账号。',
        showCancel: false,
        success: () => wx.switchTab({ url: '/pages/profile/index' }),
      })
      return
    }
    this.applyCurrentUser()
    void this.loadCatalog()
  },

  applyCurrentUser() {
    const user = cachedUser()
    this.setData({
      currentLevel: user?.level ?? 1,
      membershipExpiresText: user?.membershipExpiresAt
        ? new Date(user.membershipExpiresAt).toLocaleDateString('zh-CN')
        : '',
    })
  },

  async loadCatalog() {
    this.setData({ loading: true })
    try {
      const [catalog, quota] = await Promise.all([
        loadCommerceCatalog(),
        loadCreationQuota().catch(() => null),
      ])
      const currentRank = membershipRank(catalog.currentMembership.level)
      const currentIsPermanent =
        catalog.currentMembership.level > 1 && catalog.currentMembership.expiresAt === null
      this.setData({
        paymentEnabled: catalog.paymentEnabled,
        memberships: catalog.memberships.map((item) => ({
          ...item,
          ...priceParts(item.priceCents),
          ...membershipTheme(item.visualTheme),
          purchaseDisabled:
            membershipRank(item.level) < currentRank ||
            (item.level === catalog.currentMembership.level && currentIsPermanent),
          purchaseLabel:
            membershipRank(item.level) < currentRank
              ? '暂不支持降级'
              : item.level === catalog.currentMembership.level && currentIsPermanent
                ? '会籍长期有效'
                : item.level === catalog.currentMembership.level
                  ? `续费${item.name}`
                  : `开通${item.name}`,
        })),
        creditPackages: catalog.creditPackages.map((item) => ({
          ...item,
          ...priceParts(item.priceCents),
          originalPriceText: item.originalPriceCents
            ? priceText(item.originalPriceCents)
            : '',
        })),
        purchasedCreditBalance: quota?.purchasedCredits.remaining ?? 0,
        currentLevel: catalog.currentMembership.level,
        currentMembershipName: catalog.currentMembership.name,
        membershipExpiresText: catalog.currentMembership.expiresAt
          ? new Date(catalog.currentMembership.expiresAt).toLocaleDateString('zh-CN')
          : '',
      })
    } catch (error) {
      showErrorToast(error, { fallback: '商品加载失败，请稍后重试' })
    } finally {
      this.setData({ loading: false })
    }
  },

  handlePurchase(event: WechatMiniprogram.TouchEvent) {
    if (this.data.purchasingKey) return
    if (!this.data.paymentEnabled) {
      wx.showToast({ title: '支付暂未开放', icon: 'none' })
      return
    }
    const type = String(event.currentTarget.dataset.type)
    const id = String(event.currentTarget.dataset.id)
    if (type === 'membership') {
      const membership = this.data.memberships.find((item) => item.level === Number(id))
      if (!membership || membership.purchaseDisabled) return
      if (
        membershipRank(membership.level) > membershipRank(this.data.currentLevel) &&
        (this.data.currentLevel > 1 || this.data.currentLevel === 0)
      ) {
        this.setData({ upgradeTarget: membership })
        return
      }
    }
    void this.purchaseProduct(type, id)
  },

  handleUpgradeCancel() {
    if (this.data.purchasingKey) return
    this.setData({ upgradeTarget: null })
  },

  handleUpgradeConfirm() {
    const membership = this.data.upgradeTarget
    if (!membership || this.data.purchasingKey) return
    this.setData({ upgradeTarget: null })
    void this.purchaseProduct('membership', String(membership.level))
  },

  noop() {},

  handleEmptyBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack({ delta: 1 })
      return
    }
    wx.switchTab({ url: '/pages/profile/index' })
  },

  async purchaseProduct(type: string, id: string) {
    const key = `${type}:${id}`
    this.setData({ purchasingKey: key })
    wx.showLoading({ title: '正在唤起支付', mask: true })
    try {
      const order = await purchaseCommerceProduct(
        type === 'membership'
          ? { productType: 'MEMBERSHIP', membershipLevel: Number(id) }
          : { productType: 'CREATION_CREDIT_PACKAGE', creditPackageId: id },
      )
      wx.hideLoading()
      if (order.status === 'FULFILLED') {
        await restoreSession()
        this.applyCurrentUser()
        await this.loadCatalog()
        wx.showModal({
          title: '购买成功',
          content:
            order.productType === 'MEMBERSHIP'
              ? `${order.productName}已生效。`
              : `${order.creditCount ?? 0} 次创作额度已到账，不受每日限额影响。`,
          showCancel: false,
          confirmText: '知道了',
          confirmColor: '#315f4d',
        })
      } else {
        wx.showModal({
          title: '支付结果确认中',
          content: `订单 ${order.orderNo} 已提交，微信确认后权益会自动到账，可稍后回到“我的”查看。`,
          showCancel: false,
        })
      }
    } catch (error) {
      wx.hideLoading()
      const message = error instanceof Error ? error.message : ''
      if (/cancel/i.test(message) || message.includes('取消')) {
        wx.showToast({ title: '已取消支付', icon: 'none' })
      } else {
        showErrorToast(error, { fallback: '支付失败，请稍后重试' })
      }
    } finally {
      wx.hideLoading()
      this.setData({ purchasingKey: '' })
    }
  },
})
