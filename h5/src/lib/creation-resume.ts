import type { ClassicalFormCode, PoemCategory } from '../types'

export type ResumableMaterial = {
  id: string
  kind: 'IMAGE' | 'VIDEO'
  file: File
  sourceUrl: string
  previewUrl: string
  durationLabel: string
  status: 'READY' | 'PROCESSING'
  uploadedId?: string
}

export type CreationFormDraft = {
  prompt: string
  materials: ResumableMaterial[]
  selectedCategory: PoemCategory
  selectedForm: ClassicalFormCode
  selectedTuneCode: string
}

let formDraft: CreationFormDraft | null = null
let resumeAfterPreferences = false

export function preserveCreationForm(draft: CreationFormDraft): void {
  formDraft = draft
}

export function currentCreationForm(): CreationFormDraft | null {
  return formDraft
}

export function clearCreationForm(): void {
  formDraft = null
}

export function requestCreationResume(): void {
  resumeAfterPreferences = true
}

export function consumeCreationResume(): boolean {
  const value = resumeAfterPreferences
  resumeAfterPreferences = false
  return value
}
