import { recordPublicationShareOpen, type ShareOpenResult } from './community'
import { ensureInstallation } from './installation'
import {
  errorLogFields,
  reportRealtimeInfo,
  reportRealtimeWarn,
} from '../utils/realtime-log'

const SHARE_CODE_PATTERN = /^[A-Za-z0-9_-]{16,32}$/
const SHARE_OPEN_RETRY_DELAYS_MS = [0, 400, 1_200] as const
const MAX_TRACKED_CODES = 32
const trackedOpenTasks = new Map<string, Promise<ShareOpenResult>>()

function normalizedShareCode(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  let decoded = value
  try {
    decoded = decodeURIComponent(value)
  } catch {
    return null
  }
  return SHARE_CODE_PATTERN.test(decoded) ? decoded : null
}

export function shareCodeFromEnterOptions(options: {
  path?: string
  query?: WechatMiniprogram.IAnyObject
}): string | null {
  const path = options.path?.replace(/^\//, '')
  if (path !== 'pages/publication-detail/index') return null
  return normalizedShareCode(options.query?.s) || normalizedShareCode(options.query?.scene)
}

async function recordShareOpenWithRetry(code: string): Promise<ShareOpenResult> {
  let lastError: unknown
  for (const delayMs of SHARE_OPEN_RETRY_DELAYS_MS) {
    if (delayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
    }
    try {
      return await recordPublicationShareOpen(code)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

async function recordShareOpen(code: string, operation: string): Promise<ShareOpenResult> {
  await ensureInstallation().catch((error) => {
    reportRealtimeWarn('client.share.installation_prepare_failed', {
      ...errorLogFields(error),
      operation,
    })
  })
  const result = await recordShareOpenWithRetry(code)
  reportRealtimeInfo('client.share.open_recorded', {
    operation,
    path: '/community/share-links/:code/open',
    reasonType: result.rewardGranted ? 'reward_granted' : 'reward_not_granted',
  })
  return result
}

export function trackPublicationShareOpen(
  code: string,
  operation: string,
): Promise<ShareOpenResult> {
  const normalizedCode = normalizedShareCode(code)
  if (!normalizedCode) return Promise.reject(new Error('分享码无效'))
  const existing = trackedOpenTasks.get(normalizedCode)
  if (existing) return existing

  if (trackedOpenTasks.size >= MAX_TRACKED_CODES) {
    const oldestCode = trackedOpenTasks.keys().next().value as string | undefined
    if (oldestCode) trackedOpenTasks.delete(oldestCode)
  }
  const task = recordShareOpen(normalizedCode, operation).catch((error: unknown) => {
    trackedOpenTasks.delete(normalizedCode)
    reportRealtimeWarn('client.share.open_failed', {
      ...errorLogFields(error),
      operation,
      path: '/community/share-links/:code/open',
    })
    throw error
  })
  trackedOpenTasks.set(normalizedCode, task)
  return task
}
