import { reportRealtimeWarn } from '../utils/realtime-log'
import { request } from './api'

export type MembershipVisualTheme = 'DEFAULT' | 'JADE' | 'GILT'

export interface CommerceCatalog {
  paymentProvider: 'WECHAT_VIRTUAL_PAYMENT'
  paymentEnabled: boolean
  currentMembership: {
    level: number
    name: string
    expiresAt: string | null
  }
  memberships: Array<{
    level: number
    name: string
    description: string | null
    visualTheme: MembershipVisualTheme
    dailyCreationQuota: number | null
    priceCents: number
    durationDays: number
    wechatProductId: string
  }>
  creditPackages: Array<{
    id: string
    name: string
    description: string | null
    creditCount: number
    priceCents: number
    originalPriceCents: number | null
    wechatProductId: string
  }>
}

export type CommerceOrderStatus =
  | 'CREATED'
  | 'PAYING'
  | 'PAID'
  | 'FULFILLED'
  | 'CLOSED'
  | 'REFUNDED'
  | 'FAILED'

export interface CommerceOrder {
  id: string
  orderNo: string
  productType: 'MEMBERSHIP' | 'CREATION_CREDIT_PACKAGE'
  productName: string
  wechatProductId: string | null
  totalAmountCents: number
  membershipLevel: number | null
  membershipDurationDays: number | null
  creditCount: number | null
  status: CommerceOrderStatus
  providerTransactionId: string | null
  paidAt: string | null
  fulfilledAt: string | null
  wechatDeliveryConfirmedAt: string | null
  createdAt: string
  updatedAt: string
}

interface CreateOrderResponse {
  order: CommerceOrder
  payment: {
    mode: 'short_series_goods'
    signData: string
    paySig: string
    signature: string
  }
}

type PurchaseTarget =
  | { productType: 'MEMBERSHIP'; membershipLevel: number }
  | { productType: 'CREATION_CREDIT_PACKAGE'; creditPackageId: string }

function idempotencyKey(action: string): string {
  return `${action}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

function getWechatLoginCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.login({
      success(result) {
        if (result.code) resolve(result.code)
        else reject(new Error('微信登录凭证为空'))
      },
      fail(error) {
        reject(new Error(error.errMsg || '微信登录失败'))
      },
    })
  })
}

function requestVirtualPayment(payment: CreateOrderResponse['payment']): Promise<void> {
  const paymentApi = (wx as unknown as {
    requestVirtualPayment?: (options: {
      mode: string
      signData: string
      paySig: string
      signature: string
      success: () => void
      fail: (error: { errMsg?: string; errCode?: number }) => void
    }) => void
  }).requestVirtualPayment
  if (!paymentApi) {
    return Promise.reject(new Error('当前微信版本不支持虚拟支付，请升级微信后重试'))
  }
  return new Promise((resolve, reject) => {
    paymentApi({
      ...payment,
      success: resolve,
      fail: (error) => {
        const errorCode = error.errCode === undefined ? 'unknown' : String(error.errCode)
        const errorMessage = error.errMsg?.trim() || '微信支付调用失败'
        reportRealtimeWarn('client.commerce.virtual_payment_failed', {
          operation: 'request_virtual_payment',
          errorCode,
          errorMessage,
          reasonType: payment.mode,
        })
        reject(new Error(`${errorMessage}（错误码 ${errorCode}）`))
      },
    })
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function loadCommerceCatalog(): Promise<CommerceCatalog> {
  return request<CommerceCatalog>({
    path: '/commerce/catalog',
    includeInstallation: false,
  })
}

export function loadCommerceOrder(id: string): Promise<CommerceOrder> {
  return request<CommerceOrder>({ path: `/commerce/orders/${encodeURIComponent(id)}` })
}

export function syncCommerceOrder(id: string): Promise<CommerceOrder> {
  return request<CommerceOrder>({
    path: `/commerce/orders/${encodeURIComponent(id)}/sync`,
    method: 'POST',
    data: {},
    idempotencyKey: idempotencyKey('sync-order'),
  })
}

export async function purchaseCommerceProduct(target: PurchaseTarget): Promise<CommerceOrder> {
  const wechatLoginCode = await getWechatLoginCode()
  const result = await request<CreateOrderResponse>({
    path: '/commerce/orders',
    method: 'POST',
    data: { ...target, wechatLoginCode },
    idempotencyKey: idempotencyKey('commerce-order'),
  })
  await requestVirtualPayment(result.payment)

  let latest = result.order
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      latest = await syncCommerceOrder(result.order.id)
      if (
        (latest.status === 'FULFILLED' && latest.wechatDeliveryConfirmedAt !== null) ||
        ['CLOSED', 'REFUNDED', 'FAILED'].includes(latest.status)
      ) {
        return latest
      }
    } catch {
      latest = await loadCommerceOrder(result.order.id).catch(() => latest)
      if (latest.status === 'FULFILLED' && latest.wechatDeliveryConfirmedAt !== null) return latest
    }
    await delay(1_500)
  }
  return latest
}
