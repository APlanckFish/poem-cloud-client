import { request } from './api'

export interface PreferenceOption {
  value: string
  label: string
  description?: string
}

export interface PreferenceQuestion {
  key: string
  title: string
  type: 'single' | 'multiple'
  allowCustom: boolean
  customPlaceholder?: string
  options: PreferenceOption[]
}

export interface PreferenceQuestionnaire {
  id: string
  version: number
  title: string
  questions: PreferenceQuestion[]
}

export interface CreationPreferenceState {
  questionnaire: PreferenceQuestionnaire
  preference: {
    answers: Record<string, string[]>
    questionnaireVersion: number
    completedAt: string
  } | null
  completed: boolean
}

export function loadCreationPreferences(): Promise<CreationPreferenceState> {
  return request<CreationPreferenceState>({ path: '/creation-preferences' })
}

export function saveCreationPreferences(input: {
  questionnaireId: string
  questionnaireVersion: number
  answers: Record<string, string[]>
}): Promise<{
  answers: Record<string, string[]>
  questionnaireVersion: number
  completedAt: string
}> {
  return request({
    path: '/creation-preferences',
    method: 'PUT',
    data: input,
  })
}
