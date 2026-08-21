import { getApiBaseUrl } from '../config/api'
import { errorLogFields, reportRealtimeError } from '../utils/realtime-log'
import {
  ApiError,
  createApiHeaders,
  currentAccessToken,
  handleSessionInvalidStatus,
} from './api'

export interface SseEvent<T = Record<string, unknown>> {
  id: string
  event: string
  data: T
}

export interface SseSubscription {
  abort(): void
}

interface OpenSseOptions {
  path: string
  cursor?: string
  onEvent: (event: SseEvent) => void
  onError: (error: ApiError) => void
  onClosed?: () => void
}

interface ChunkReceivedResult {
  data: ArrayBuffer
}

interface ChunkedRequestTask extends WechatMiniprogram.RequestTask {
  onChunkReceived(callback: (result: ChunkReceivedResult) => void): void
}

class Utf8ChunkDecoder {
  private pending: number[] = []

  decode(buffer: ArrayBuffer): string {
    const bytes = [...this.pending, ...new Uint8Array(buffer)]
    this.pending = []
    let output = ''
    let index = 0
    while (index < bytes.length) {
      const first = bytes[index]
      if (first === undefined) break
      let length = 1
      let codePoint = first
      if ((first & 0xe0) === 0xc0) {
        length = 2
        codePoint = first & 0x1f
      } else if ((first & 0xf0) === 0xe0) {
        length = 3
        codePoint = first & 0x0f
      } else if ((first & 0xf8) === 0xf0) {
        length = 4
        codePoint = first & 0x07
      } else if (first >= 0x80) {
        output += '\uFFFD'
        index += 1
        continue
      }
      if (index + length > bytes.length) {
        this.pending = bytes.slice(index)
        break
      }
      let valid = true
      for (let offset = 1; offset < length; offset += 1) {
        const continuation = bytes[index + offset]
        if (continuation === undefined || (continuation & 0xc0) !== 0x80) {
          valid = false
          break
        }
        codePoint = (codePoint << 6) | (continuation & 0x3f)
      }
      output += valid ? String.fromCodePoint(codePoint) : '\uFFFD'
      index += valid ? length : 1
    }
    return output
  }
}

class SseFrameParser {
  private buffer = ''

  push(text: string): SseEvent[] {
    this.buffer += text.replace(/\r\n/g, '\n')
    const events: SseEvent[] = []
    let boundary = this.buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const frame = this.buffer.slice(0, boundary)
      this.buffer = this.buffer.slice(boundary + 2)
      boundary = this.buffer.indexOf('\n\n')
      let id = ''
      let event = 'message'
      const dataLines: string[] = []
      for (const line of frame.split('\n')) {
        if (line.startsWith(':')) continue
        const colon = line.indexOf(':')
        const field = colon >= 0 ? line.slice(0, colon) : line
        const value = colon >= 0 ? line.slice(colon + 1).replace(/^ /, '') : ''
        if (field === 'id') id = value
        else if (field === 'event') event = value
        else if (field === 'data') dataLines.push(value)
      }
      if (dataLines.length === 0) continue
      try {
        const data = JSON.parse(dataLines.join('\n'))
        if (data && typeof data === 'object' && !Array.isArray(data)) {
          events.push({ id, event, data: data as Record<string, unknown> })
        }
      } catch {
        // Ignore a malformed frame and rely on the task snapshot during reconnect.
      }
    }
    return events
  }
}

export function openSseStream(options: OpenSseOptions): SseSubscription {
  const cursor = options.cursor || '0-0'
  const separator = options.path.includes('?') ? '&' : '?'
  const decoder = new Utf8ChunkDecoder()
  const parser = new SseFrameParser()
  let aborted = false
  let statusCode = 0
  let requestId: string | null = null
  const requestAccessToken = currentAccessToken()
  const reportStreamError = (error: ApiError): void => {
    reportRealtimeError('client.sse.stream_failed', {
      ...errorLogFields(error),
      operation: 'creation_progress_stream',
      method: 'GET',
      path: options.path.split(/[?#]/, 1)[0] ?? options.path,
    })
    options.onError(error)
  }
  const requestOptions = {
    url: `${getApiBaseUrl()}${options.path}${separator}cursor=${encodeURIComponent(cursor)}`,
    method: 'GET',
    header: {
      ...createApiHeaders({
        accept: 'text/event-stream',
        contentType: '',
      }),
      'Last-Event-ID': cursor,
    },
    enableChunked: true,
    responseType: 'arraybuffer',
    timeout: 10 * 60 * 1000,
    success(response: { statusCode: number }) {
      statusCode = response.statusCode
      if (!aborted && (statusCode < 200 || statusCode >= 300)) {
        handleSessionInvalidStatus(statusCode, requestAccessToken)
        reportStreamError(
          new ApiError(
            `事件流请求失败（${statusCode}）`,
            'STREAM_FAILED',
            statusCode,
            undefined,
            requestId,
          ),
        )
      }
    },
    fail(error: { errMsg: string }) {
      if (!aborted) {
        reportStreamError(
          new ApiError(
            error.errMsg || '创作进度连接已断开',
            'STREAM_DISCONNECTED',
            statusCode,
            undefined,
            requestId,
          ),
        )
      }
    },
    complete() {
      if (!aborted && statusCode >= 200 && statusCode < 300) {
        options.onClosed?.()
      }
    },
  }
  const task = wx.request(
    requestOptions as unknown as WechatMiniprogram.RequestOption,
  ) as ChunkedRequestTask

  task.onHeadersReceived((response) => {
    const headers = response as unknown as {
      statusCode?: number
      header?: Record<string, string>
    }
    statusCode = headers.statusCode ?? 200
    const requestIdHeader = Object.entries(headers.header ?? {}).find(
      ([name]) => name.toLowerCase() === 'x-request-id',
    )
    requestId = requestIdHeader?.[1] ?? null
  })
  task.onChunkReceived((response) => {
    if (aborted) return
    for (const event of parser.push(decoder.decode(response.data))) {
      options.onEvent(event)
    }
  })

  return {
    abort() {
      aborted = true
      task.abort()
    },
  }
}
