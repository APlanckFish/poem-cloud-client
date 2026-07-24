import { request } from './api'

export type FeedbackCategory = 'SUGGESTION' | 'EXPERIENCE' | 'CONTENT' | 'OTHER'

export interface SubmitFeedbackOptions {
  category: FeedbackCategory
  content: string
  contact?: string
  imageAssetIds?: string[]
}

export interface FeedbackResponse {
  id: string
  category: FeedbackCategory
  content: string
  contact: string | null
  status: string
  imageAssetIds: string[]
  createdAt: string
}

function idempotencyKey(action: string): string {
  const random = Math.random().toString(36).slice(2, 12)
  return `${action}-${Date.now().toString(36)}-${random}`
}

export function submitFeedback(options: SubmitFeedbackOptions): Promise<FeedbackResponse> {
  return request<FeedbackResponse>({
    path: '/feedbacks',
    method: 'POST',
    data: {
      category: options.category,
      content: options.content,
      ...(options.contact ? { contact: options.contact } : {}),
      imageAssetIds: options.imageAssetIds ?? [],
    },
    idempotencyKey: idempotencyKey('submit-feedback'),
  })
}
