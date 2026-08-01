import { getApiBaseUrl, STORAGE_KEYS } from '../config/api'

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

interface ApiEnvelope<T> {
  data: T
  requestId: string
}

interface ApiErrorEnvelope {
  error?: {
    code?: string
    message?: string
    details?: unknown
  }
  requestId?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

interface RequestOptions {
  path: string
  method?: HttpMethod
  data?: WechatMiniprogram.IAnyObject
  authenticated?: boolean
  includeInstallation?: boolean
  idempotencyKey?: string
}

export class ApiError extends Error {
  readonly code: string
  readonly statusCode: number
  readonly details: unknown

  constructor(message: string, code = 'NETWORK_ERROR', statusCode = 0, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.statusCode = statusCode
    this.details = details
  }
}

function storedString(key: string): string | null {
  const value = wx.getStorageSync(key)
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function createApiHeaders(options: {
  accept?: string
  contentType?: string
  authenticated?: boolean
  includeInstallation?: boolean
  idempotencyKey?: string
} = {}): Record<string, string> {
  const accessToken = storedString(STORAGE_KEYS.accessToken)
  const installationToken = storedString(STORAGE_KEYS.installationToken)
  const header: Record<string, string> = {
    Accept: options.accept ?? 'application/json',
    ...(options.contentType === undefined
      ? { 'Content-Type': 'application/json' }
      : options.contentType
        ? { 'Content-Type': options.contentType }
        : {}),
  }
  if (options.authenticated !== false && accessToken) {
    header.Authorization = `Bearer ${accessToken}`
  }
  if (options.includeInstallation !== false && installationToken) {
    header['X-Installation-Token'] = installationToken
  }
  if (options.idempotencyKey) {
    header['Idempotency-Key'] = options.idempotencyKey
  }
  return header
}

export function hasAccessToken(): boolean {
  return storedString(STORAGE_KEYS.accessToken) !== null
}

export function clearSessionStorage(): void {
  wx.removeStorageSync(STORAGE_KEYS.accessToken)
  wx.removeStorageSync(STORAGE_KEYS.tokenExpiresAt)
  wx.removeStorageSync(STORAGE_KEYS.currentUser)
}

export function getUrlOrigin(url: string): string {
  const match = /^https?:\/\/[^/?#]+/i.exec(url)
  return match ? match[0] : url.split(/[/?#]/, 1)[0]
}

export function request<T>(options: RequestOptions): Promise<T> {
  const header = createApiHeaders(options)
  const url = `${getApiBaseUrl()}${options.path}`

  return new Promise<T>((resolve, reject) => {
    wx.request({
      url,
      method: options.method ?? 'GET',
      data: options.data,
      header,
      timeout: 15000,
      success(response) {
        if (response.statusCode === 204 || response.statusCode === 205) {
          resolve(undefined as T)
          return
        }

        if (response.statusCode >= 200 && response.statusCode < 300) {
          if (
            response.data === ''
            || response.data === null
            || response.data === undefined
          ) {
            resolve(undefined as T)
            return
          }
          if (isRecord(response.data) && 'data' in response.data) {
            const envelope = response.data as unknown as ApiEnvelope<T>
            resolve(envelope.data)
            return
          }
          reject(
            new ApiError(
              '服务返回格式异常，请稍后重试',
              'INVALID_RESPONSE',
              response.statusCode,
            ),
          )
          return
        }

        const envelope = isRecord(response.data)
          ? response.data as ApiErrorEnvelope
          : {}
        const message = envelope.error?.message ?? `请求失败（${response.statusCode}）`
        reject(
          new ApiError(
            message,
            envelope.error?.code ?? 'REQUEST_FAILED',
            response.statusCode,
            envelope.error?.details,
          ),
        )
      },
      fail(error) {
        const message = error.errMsg || '无法连接到诗云服务'
        reject(
          new ApiError(
            message.includes('url not in domain list')
              ? `API域名未生效，请检查 request 合法域名：${getUrlOrigin(url)}`
              : message,
          ),
        )
      },
    })
  })
}
