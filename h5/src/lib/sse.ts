import { ApiError, handleSessionInvalidStatus, resolveApiUrl } from './api'
import { storageKeys } from './storage'

export type BrowserSseEvent = {
  id: string
  event: string
  data: Record<string, unknown>
}

type OpenSseOptions = {
  path: string
  cursor?: string
  signal: AbortSignal
  onEvent: (event: BrowserSseEvent) => void
}

function parseFrames(buffer: string): { events: BrowserSseEvent[]; remaining: string } {
  const normalized = buffer.replace(/\r\n/g, '\n')
  const frames = normalized.split('\n\n')
  const remaining = frames.pop() ?? ''
  const events: BrowserSseEvent[] = []
  for (const frame of frames) {
    let id = ''
    let event = 'message'
    const dataLines: string[] = []
    for (const line of frame.split('\n')) {
      if (!line || line.startsWith(':')) continue
      const separator = line.indexOf(':')
      const field = separator >= 0 ? line.slice(0, separator) : line
      const value = separator >= 0 ? line.slice(separator + 1).replace(/^ /, '') : ''
      if (field === 'id') id = value
      else if (field === 'event') event = value
      else if (field === 'data') dataLines.push(value)
    }
    if (!dataLines.length) continue
    try {
      const data = JSON.parse(dataLines.join('\n'))
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        events.push({ id, event, data: data as Record<string, unknown> })
      }
    } catch {
      // A reconnect snapshot remains the fallback for malformed transient frames.
    }
  }
  return { events, remaining }
}

export async function openBrowserSse(options: OpenSseOptions): Promise<void> {
  const cursor = options.cursor || '0-0'
  const separator = options.path.includes('?') ? '&' : '?'
  const headers = new Headers({
    Accept: 'text/event-stream',
    'Last-Event-ID': cursor,
  })
  const accessToken = localStorage.getItem(storageKeys.accessToken)
  const installationToken = localStorage.getItem(storageKeys.installationToken)
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
  if (installationToken) headers.set('X-Installation-Token', installationToken)

  const response = await fetch(
    resolveApiUrl(`${options.path}${separator}cursor=${encodeURIComponent(cursor)}`),
    { headers, credentials: 'include', signal: options.signal },
  )
  if (!response.ok || !response.body) {
    handleSessionInvalidStatus(response.status, accessToken)
    throw new ApiError(
      `事件流请求失败（${response.status}）`,
      'STREAM_FAILED',
      response.status,
    )
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (!options.signal.aborted) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parsed = parseFrames(buffer)
    buffer = parsed.remaining
    for (const event of parsed.events) options.onEvent(event)
  }
}
