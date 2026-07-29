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

export function request<T>(options: RequestOptions): Promise<T> {
  const header = createApiHeaders(options)

  return new Promise<T>((resolve, reject) => {
    wx.request({
      url: `${getApiBaseUrl()}${options.path}`,
      method: options.method ?? 'GET',
      data: options.data,
      header,
      timeout: 15000,
      success(response) {
        if (response.statusCode === 204) {
          resolve(undefined as T)
          return
        }

        if (response.statusCode >= 200 && response.statusCode < 300) {
          const envelope = response.data as ApiEnvelope<T>
          resolve(envelope.data)
          return
        }

        const envelope = response.data as ApiErrorEnvelope
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
        reject(new ApiError(error.errMsg || '无法连接到诗云服务'))
      },
    })
  })
}
