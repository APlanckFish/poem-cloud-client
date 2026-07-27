import { ApiError } from '../../services/api'
import { ensureInstallation } from '../../services/installation'
import {
  loadCreationPreferences,
  type PreferenceOption,
  type PreferenceQuestion,
  saveCreationPreferences,
} from '../../services/preferences'

type SettingOption = PreferenceOption & {
  selected: boolean
  custom?: boolean
}

type SwitchEvent = WechatMiniprogram.CustomEvent<{ value: boolean }>

const POSTER_PREFERENCE_KEY = 'autoGeneratePoster'

function messageFor(error: unknown): string {
  return error instanceof ApiError ? error.message : '偏好加载失败，请稍后重试'
}

function questionOptions(
  question: PreferenceQuestion | undefined,
  answers: Record<string, string[]>,
): SettingOption[] {
  if (!question) return []
  const values = answers[question.key] ?? []
  const configured = new Set(question.options.map((option) => option.value))
  return [
    ...question.options.map((option) => ({
      ...option,
      selected: values.includes(option.value),
    })),
    ...values
      .filter((value) => !configured.has(value))
      .map((value) => ({
        value,
        label: value,
        selected: true,
        custom: true,
      })),
  ]
}

function orderedOptions(options: SettingOption[], order: string[]): SettingOption[] {
  const rank = new Map(order.map((value, index) => [value, index]))
  return [...options].sort(
    (left, right) => (rank.get(left.value) ?? order.length) - (rank.get(right.value) ?? order.length),
  )
}

Page({
  data: {
    isLoading: true,
    isSaving: false,
    loadFailed: false,
    questionnaireId: '',
    questionnaireVersion: 0,
    questions: [] as PreferenceQuestion[],
    answers: {} as Record<string, string[]>,
    poemTypeOptions: [] as SettingOption[],
    rhymeSchemeOptions: [] as SettingOption[],
    selectedRhymeDescription: '',
    poetOptions: [] as SettingOption[],
    styleOptions: [] as SettingOption[],
    autoGeneratePoster: true,
  },

  onLoad() {
    void this.loadPreferences()
  },

  async loadPreferences() {
    this.setData({ isLoading: true, loadFailed: false })
    try {
      await ensureInstallation()
      const state = await loadCreationPreferences()
      const answers = {
        ...(state.preference?.answers ?? {}),
        [POSTER_PREFERENCE_KEY]:
          state.preference?.answers[POSTER_PREFERENCE_KEY] ?? ['true'],
      }
      this.setData({
        isLoading: false,
        questionnaireId: state.questionnaire.id,
        questionnaireVersion: state.questionnaire.version,
        questions: state.questionnaire.questions,
        answers,
        autoGeneratePoster: answers[POSTER_PREFERENCE_KEY]?.[0] !== 'false',
      })
      this.refreshOptions()
    } catch (error) {
      this.setData({ isLoading: false, loadFailed: true })
      wx.showToast({ title: messageFor(error), icon: 'none' })
    }
  },

  refreshOptions() {
    const questionByKey = Object.fromEntries(
      this.data.questions.map((question) => [question.key, question]),
    )
    const rhymeSchemeOptions = questionOptions(questionByKey.rhymeScheme, this.data.answers)
    this.setData({
      poemTypeOptions: orderedOptions(
        questionOptions(questionByKey.poemType, this.data.answers),
        ['CLASSICAL', 'MODERN', 'CI'],
      ),
      rhymeSchemeOptions,
      selectedRhymeDescription:
        rhymeSchemeOptions.find((option) => option.selected)?.description
        ?? '设定古体诗与词的默认用韵方式',
      poetOptions: questionOptions(questionByKey.poets, this.data.answers),
      styleOptions: questionOptions(questionByKey.styles, this.data.answers),
    })
  },

  selectOption(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key)
    const value = String(event.currentTarget.dataset.value)
    const question = this.data.questions.find((item) => item.key === key)
    if (!question) return
    const current = this.data.answers[key] ?? []
    const next = question.type === 'single'
      ? [value]
      : current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value]
    this.setData({
      answers: {
        ...this.data.answers,
        [key]: next,
      },
    })
    this.refreshOptions()
  },

  addCustomOption(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key)
    const question = this.data.questions.find((item) => item.key === key)
    if (!question?.allowCustom) return
    wx.showModal({
      title: key === 'poets' ? '添加喜欢的诗人' : '添加喜欢的风格',
      editable: true,
      placeholderText: question.customPlaceholder || '请输入自定义选项',
      confirmText: '添加',
      confirmColor: '#3f6758',
      success: (result) => {
        if (!result.confirm) return
        const value = String(result.content ?? '').trim()
        if (!value) return
        const current = this.data.answers[key] ?? []
        if (current.includes(value)) return
        this.setData({
          answers: {
            ...this.data.answers,
            [key]: [...current, value],
          },
        })
        this.refreshOptions()
      },
    })
  },

  toggleAutoPoster(event: SwitchEvent) {
    const enabled = event.detail.value
    this.setData({
      autoGeneratePoster: enabled,
      answers: {
        ...this.data.answers,
        [POSTER_PREFERENCE_KEY]: [String(enabled)],
      },
    })
  },

  async savePreferences() {
    if (this.data.isSaving) return
    const incomplete = this.data.questions.some(
      (question) => (this.data.answers[question.key] ?? []).length === 0,
    )
    if (incomplete) {
      wx.showToast({ title: '请完成全部偏好设置', icon: 'none' })
      return
    }

    this.setData({ isSaving: true })
    wx.showLoading({ title: '正在保存', mask: true })
    try {
      await saveCreationPreferences({
        questionnaireId: this.data.questionnaireId,
        questionnaireVersion: this.data.questionnaireVersion,
        answers: this.data.answers,
      })
      wx.hideLoading()
      wx.showToast({ title: '偏好已保存', icon: 'success' })
    } catch (error) {
      wx.hideLoading()
      wx.showToast({ title: messageFor(error), icon: 'none' })
    } finally {
      this.setData({ isSaving: false })
    }
  },

  retryLoad() {
    void this.loadPreferences()
  },
})
