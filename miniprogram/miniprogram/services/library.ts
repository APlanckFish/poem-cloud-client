import { request } from './api'
import {
  type CreationPreferences,
  loadPoemTaxonomies,
  type PoemCategory,
  type PoemResult,
} from './creation'
import type { PublicationCoverSource } from './community'

export interface WorkPublication {
  id: string
  status: 'PUBLISHED' | 'PENDING_REVIEW' | 'HIDDEN' | 'REJECTED'
  visibility: 'PUBLIC' | 'UNLISTED'
  likeCount: number
  creationJournalPublic: boolean
  coverSource: PublicationCoverSource
}

export interface WorkPoster {
  id?: string
  status: 'NOT_CREATED' | 'QUEUED' | 'GENERATING_BACKGROUND' | 'COMPOSING' | 'READY' | 'FAILED'
  url: string
  backgroundUrl?: string | null
  isDefault: boolean
}

export interface LibraryWork {
  id: string
  status: 'DRAFT' | 'FINAL'
  title: string | null
  content: string | null
  prompt: string
  category: PoemCategory
  classicalFormCode: string | null
  tunePatternCode: string | null
  preferences?: CreationPreferences
  generationCount: number
  selectedGenerationId?: string | null
  version: number
  publication: WorkPublication | null
  latestActivityAt?: string
  createdAt: string
  updatedAt: string
  assetIds?: string[]
  defaultCoverUrl?: string
  assets?: Array<{
    id?: string
    kind: 'IMAGE' | 'VIDEO'
    accessUrl?: string | null
    thumbnailUrl?: string | null
  }>
  latestGeneration?: {
    id: string
    status:
      | 'QUEUED'
      | 'ANALYZING_MATERIALS'
      | 'RETRIEVING_KNOWLEDGE'
      | 'GENERATING'
      | 'SUCCEEDED'
      | 'FAILED'
      | 'CANCELED'
      | 'REJECTED'
    result: PoemResult | null
  }
}

export type TunePatternNames = Record<string, string>

interface ListResponse<T> {
  items: T[]
  nextCursor: string | null
}

export type WorkListFilter = 'ALL' | 'PUBLISHED' | 'UNPUBLISHED' | 'HIDDEN'

const CLASSICAL_FORM_NAMES: Record<string, string> = {
  WUYAN_JUEJU: '五言绝句',
  QIYAN_JUEJU: '七言绝句',
  WUYAN_LVSHI: '五言律诗',
  QIYAN_LVSHI: '七言律诗',
  DAYOU_SHI: '打油诗',
}

const STYLE_TAG_NAMES: Record<string, string> = {
  SCENERY: '写景',
  LANDSCAPE: '写景',
  EMOTION: '抒情',
  LYRIC: '抒情',
  NARRATIVE: '叙事',
  PHILOSOPHICAL: '哲思',
  HOMESICKNESS: '思乡',
}

function styleTagName(tag: string | undefined): string {
  if (!tag) return ''
  if (/[\u3400-\u9fff]/.test(tag)) return tag
  return STYLE_TAG_NAMES[tag.toUpperCase()] || ''
}

export function describeWorkType(
  work: Pick<
    LibraryWork,
    'category' | 'classicalFormCode' | 'tunePatternCode' | 'preferences'
  >,
  tunePatternNames: TunePatternNames = {},
): string {
  let typeName = '古体诗'
  if (work.category === 'MODERN') {
    typeName = '现代诗'
  } else if (work.category === 'CI') {
    typeName = tunePatternNames[work.tunePatternCode || ''] || '词'
  } else if (work.classicalFormCode) {
    typeName = CLASSICAL_FORM_NAMES[work.classicalFormCode] || '古体诗'
  }
  const styleName = styleTagName(work.preferences?.styleTags?.[0])
  return styleName ? `${typeName} · ${styleName}` : typeName
}

export async function loadTunePatternNames(): Promise<TunePatternNames> {
  const taxonomies = await loadPoemTaxonomies()
  const ci = taxonomies.categories.find((category) => category.code === 'CI')
  return Object.fromEntries(
    (ci?.tunePatterns || []).map((pattern) => [pattern.code, pattern.name]),
  )
}

function idempotencyKey(action: string): string {
  return `${action}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

export function loadMyWorks(options: {
  cursor?: string
  filter?: WorkListFilter
} = {}): Promise<ListResponse<LibraryWork>> {
  const query = [
    'limit=10',
    `filter=${encodeURIComponent(options.filter ?? 'ALL')}`,
    ...(options.cursor ? [`cursor=${encodeURIComponent(options.cursor)}`] : []),
  ].join('&')
  return request<ListResponse<LibraryWork>>({
    path: `/me/works?${query}`,
  })
}

export function getLibraryWork(id: string): Promise<LibraryWork> {
  return request<LibraryWork>({
    path: `/works/${encodeURIComponent(id)}`,
  })
}

export function getWorkPoster(id: string): Promise<WorkPoster> {
  return request<WorkPoster>({
    path: `/works/${encodeURIComponent(id)}/poster`,
  })
}

export function loadMyDrafts(cursor?: string): Promise<ListResponse<LibraryWork>> {
  const query = [
    'status=DRAFT',
    'limit=10',
    ...(cursor ? [`cursor=${encodeURIComponent(cursor)}`] : []),
  ].join('&')
  return request<ListResponse<LibraryWork>>({
    path: `/me/creations?${query}`,
  })
}

export function deleteLibraryWork(id: string): Promise<void> {
  return request<void>({
    path: `/works/${encodeURIComponent(id)}`,
    method: 'DELETE',
  })
}

export function publishLibraryWork(id: string): Promise<WorkPublication> {
  return request<WorkPublication>({
    path: `/works/${encodeURIComponent(id)}/publications`,
    method: 'POST',
    data: {
      workId: id,
      visibility: 'PUBLIC',
      acceptedCommunityRules: true,
    },
    idempotencyKey: idempotencyKey('publish-work'),
  })
}

export function shareLibraryWork(id: string): Promise<WorkPublication> {
  return request<WorkPublication>({
    path: `/works/${encodeURIComponent(id)}/publications`,
    method: 'POST',
    data: {
      workId: id,
      visibility: 'UNLISTED',
      acceptedCommunityRules: true,
    },
    idempotencyKey: idempotencyKey('share-work'),
  })
}

export function hideLibraryWork(id: string): Promise<void> {
  return request<void>({
    path: `/works/${encodeURIComponent(id)}/publication/hide`,
    method: 'POST',
    data: {},
    idempotencyKey: idempotencyKey('hide-work'),
  })
}

export function restoreLibraryWork(id: string): Promise<void> {
  return request<void>({
    path: `/works/${encodeURIComponent(id)}/publication/restore`,
    method: 'POST',
    data: {},
    idempotencyKey: idempotencyKey('restore-work'),
  })
}
