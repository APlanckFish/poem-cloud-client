import { ApiError } from '../services/api'

interface ErrorToastOptions {
  fallback?: string
  duration?: number
}

const DEFAULT_ERROR_MESSAGE = '服务暂时不可用，请稍后重试'

function rawErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === 'object' && 'errMsg' in error) {
    const errMsg = String(error.errMsg)
    return errMsg === '[object Object]' ? '' : errMsg
  }
  return ''
}

export function getErrorMessage(
  error: unknown,
  fallback = DEFAULT_ERROR_MESSAGE,
): string {
  const message = rawErrorMessage(error)
  if (error instanceof ApiError) {
    if (/timeout/i.test(message)) return '请求超时，请稍后重试'
    if (
      error.code === 'NETWORK_ERROR'
      && /request:fail|network|failed to fetch|connection/i.test(message)
    ) {
      return '网络连接失败，请检查网络后重试'
    }
    return message || fallback
  }
  if (/timeout/i.test(message)) return '操作超时，请稍后重试'
  return message || fallback
}

export function showErrorToast(
  error: unknown,
  options: ErrorToastOptions = {},
): void {
  wx.showToast({
    title: getErrorMessage(error, options.fallback),
    icon: 'none',
    duration: options.duration ?? 2600,
  })
}
