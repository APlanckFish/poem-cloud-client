import { randomId, storageKeys } from './storage'

interface ApiEnvelope<T> {
  data: T
  requestId: string
}

interface ApiErrorEnvelope {
  error?: { code?: string; message?: string; details?: unknown }
  requestId?: string
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  authenticated?: boolean
  includeInstallation?: boolean
  idempotencyKey?: string
  signal?: AbortSignal
  retryInstallation?: boolean
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code = 'NETWORK_ERROR',
    readonly statusCode = 0,
    readonly details?: unknown,
    readonly requestId: string | null = null,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

function normalizeApiBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/$/, '')
  if (!trimmed) return '/api/v1'

  if (/^https?:\/\//i.test(trimmed)) {
    const url = new URL(trimmed)
    const pathname = url.pathname.replace(/\/$/, '')
    if (!pathname || pathname === '/') url.pathname = '/v1'
    return url.toString().replace(/\/$/, '')
  }

  const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return normalized.endsWith('/v1') ? normalized : `${normalized}/v1`
}

export const apiBaseUrl = normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL || '/api/v1')

let installationPromise: Promise<void> | null = null

export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  const normalized = path.startsWith('/v1/') ? path.slice(3) : path
  return `${apiBaseUrl}${normalized.startsWith('/') ? normalized : `/${normalized}`}`
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' })
  if (options.body !== undefined) headers.set('Content-Type', 'application/json')
  const token = localStorage.getItem(storageKeys.accessToken)
  const installationToken = localStorage.getItem(storageKeys.installationToken)
  if (options.authenticated !== false && token) headers.set('Authorization', `Bearer ${token}`)
  if (options.includeInstallation !== false && installationToken) {
    headers.set('X-Installation-Token', installationToken)
  }
  if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey)

  let response: Response
  try {
    response = await fetch(resolveApiUrl(path), {
      method: options.method ?? 'GET',
      headers,
      credentials: 'include',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError('无法连接到诗云服务', 'NETWORK_ERROR')
  }

  if (response.status === 204 || response.status === 205) return undefined as T
  const payload = (await response.json().catch(() => ({}))) as ApiEnvelope<T> & ApiErrorEnvelope
  if (response.ok && payload && 'data' in payload) return payload.data

  const canRenewInstallation =
    response.status === 401 &&
    options.retryInstallation !== false &&
    options.includeInstallation !== false &&
    !localStorage.getItem(storageKeys.accessToken) &&
    Boolean(installationToken) &&
    !path.startsWith('/installations')
  if (canRenewInstallation) {
    clearInstallationSession()
    await ensureInstallation()
    return apiRequest<T>(path, { ...options, retryInstallation: false })
  }

  throw new ApiError(
    payload.error?.message ?? (response.status === 404
      ? `接口不存在：${new URL(response.url).pathname}`
      : `请求失败（${response.status}）`),
    payload.error?.code ?? 'REQUEST_FAILED',
    response.status,
    payload.error?.details,
    payload.requestId ?? null,
  )
}

export function idempotencyKey(action: string): string {
  return randomId(action)
}

function clearInstallationSession(): void {
  localStorage.removeItem(storageKeys.installationId)
  localStorage.removeItem(storageKeys.installationToken)
}

async function registerInstallation(): Promise<void> {
  let installationKey = localStorage.getItem(storageKeys.installationKey)
  if (!installationKey) {
    installationKey = randomId('web').slice(0, 128)
    localStorage.setItem(storageKeys.installationKey, installationKey)
  }
  try {
    const installation = await apiRequest<{
      installationId: string
      installationToken: string
    }>('/installations', {
      method: 'POST',
      authenticated: false,
      includeInstallation: false,
      retryInstallation: false,
      body: { installationKey },
    })
    localStorage.setItem(storageKeys.installationId, installation.installationId)
    localStorage.setItem(storageKeys.installationToken, installation.installationToken)
  } catch (error) {
    if (import.meta.env.DEV && error instanceof ApiError && error.code === 'NETWORK_ERROR') {
      return
    }
    throw error
  }
}

async function registerInstallationOnce(): Promise<void> {
  if (localStorage.getItem(storageKeys.installationToken)) return
  if (navigator.locks) {
    await navigator.locks.request('poem-cloud-installation', async () => {
      if (!localStorage.getItem(storageKeys.installationToken)) {
        await registerInstallation()
      }
    })
    return
  }
  await registerInstallation()
}

export async function ensureInstallation(): Promise<void> {
  if (localStorage.getItem(storageKeys.installationToken)) return
  if (!installationPromise) {
    installationPromise = registerInstallationOnce().finally(() => {
      installationPromise = null
    })
  }
  return installationPromise
}
