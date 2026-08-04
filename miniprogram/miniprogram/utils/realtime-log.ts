type RealtimeLogLevel = 'info' | 'warn' | 'error'

export interface RealtimeLogFields {
  operation?: string
  page?: string
  method?: string
  path?: string
  errorType?: string
  errorCode?: string
  errorMessage?: string
  statusCode?: number
  requestId?: string | null
  assetKind?: string
  sizeBytes?: number
  durationMs?: number
  reasonType?: string
}

const MAX_STRING_LENGTH = 600

function sanitizeString(value: string): string {
  return value
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/(access_token|token|authorization|cookie|secret|password|code)=[^\s&#]+/gi, '$1=[REDACTED]')
    .replace(/wxfile:\/\/[^\s"'<>]+/gi, '[FILE]')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[URL]')
    .replace(/(?:\/var\/|\/tmp\/|\/private\/|\/Users\/)[^\s"'<>]+/g, '[FILE]')
    .slice(0, MAX_STRING_LENGTH)
}

function currentPageRoute(): string | undefined {
  try {
    const pages = getCurrentPages()
    return pages.length > 0 ? pages[pages.length - 1]?.route : undefined
  } catch {
    return undefined
  }
}

function sanitizedFields(fields: RealtimeLogFields): Record<string, string | number> {
  const payload: Record<string, string | number> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === 'string' && value.length > 0) {
      payload[key] = sanitizeString(value)
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      payload[key] = value
    }
  }
  return payload
}

function writeRealtimeLog(
  level: RealtimeLogLevel,
  event: string,
  fields: RealtimeLogFields = {},
): void {
  if (typeof wx === 'undefined' || typeof wx.getRealtimeLogManager !== 'function') {
    return
  }
  try {
    wx.getRealtimeLogManager()[level]({
      event: sanitizeString(event),
      ...sanitizedFields(fields),
    })
  } catch {
    // Logging must never interrupt a user flow, including on an older base library.
  }
}

export function reportRealtimeInfo(event: string, fields: RealtimeLogFields = {}): void {
  writeRealtimeLog('info', event, fields)
}

export function reportRealtimeWarn(event: string, fields: RealtimeLogFields = {}): void {
  writeRealtimeLog('warn', event, fields)
}

export function reportRealtimeError(event: string, fields: RealtimeLogFields = {}): void {
  writeRealtimeLog('error', event, fields)
}

export function errorLogFields(error: unknown): RealtimeLogFields {
  if (error instanceof Error) {
    const value = error as Error & {
      code?: unknown
      statusCode?: unknown
      requestId?: unknown
    }
    return {
      errorType: error.name,
      errorMessage: error.message,
      ...(typeof value.code === 'string' ? { errorCode: value.code } : {}),
      ...(typeof value.statusCode === 'number' ? { statusCode: value.statusCode } : {}),
      ...(typeof value.requestId === 'string' ? { requestId: value.requestId } : {}),
    }
  }
  if (typeof error === 'string') {
    return { errorType: 'string', errorMessage: error }
  }
  return { errorType: typeof error, errorMessage: 'Unknown client error' }
}

export function reportGlobalRuntimeError(error: unknown, reasonType: string): void {
  reportRealtimeError('client.runtime.failed', {
    ...errorLogFields(error),
    page: currentPageRoute(),
    reasonType,
  })
}
