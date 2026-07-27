import { STORAGE_KEYS } from '../../config/api'
import { ApiError } from '../../services/api'
import { ensureInstallation } from '../../services/installation'
import {
  loadCreationPreferences,
  type PreferenceQuestion,
  saveCreationPreferences,
} from '../../services/preferences'

type ValueEvent = WechatMiniprogram.CustomEvent<{ value: string }>

type DisplayOption = {
  value: string
  label: string
  description?: string
  selected: boolean
}

type DisplayQuestion = Omit<PreferenceQuestion, 'options'> & {
  options: DisplayOption[]
}

function messageFor(error: unknown): string {
  return error instanceof ApiError ? error.message : '偏好加载失败，请稍后重试'
}

Page({
  data: {
    isLoading: true,
    isSaving: false,
    loadFailed: false,
    returnToCreate: false,
    questionnaireId: '',
    questionnaireVersion: 0,
    questions: [] as PreferenceQuestion[],
    currentIndex: 0,
    currentQuestion: null as DisplayQuestion | null,
    answers: {} as Record<string, string[]>,
    customInput: '',
    customValues: [] as string[],
    expandedOption: '',
    progressText: '1 / 4',
    progressWidth: '25%',
    isLastQuestion: false,
    primaryText: '下一步',
  },

  onLoad(options: Record<string, string | undefined>) {
    this.setData({ returnToCreate: options.returnTo === 'create' })
    void this.loadPreferences()
  },

  async loadPreferences() {
    this.setData({ isLoading: true, loadFailed: false })
    try {
      await ensureInstallation()
      const state = await loadCreationPreferences()
      this.setData({
        questionnaireId: state.questionnaire.id,
        questionnaireVersion: state.questionnaire.version,
        questions: state.questionnaire.questions,
        answers: state.preference?.answers ?? {},
        isLoading: false,
      })
      this.refreshQuestion()
    } catch (error) {
      this.setData({ isLoading: false, loadFailed: true })
      wx.showToast({ title: messageFor(error), icon: 'none' })
    }
  },

  refreshQuestion() {
    const question = this.data.questions[this.data.currentIndex]
    if (!question) return
    const values = this.data.answers[question.key] ?? []
    const configured = new Set(question.options.map((option) => option.value))
    const isLastQuestion = this.data.currentIndex === this.data.questions.length - 1
    this.setData({
      currentQuestion: {
        ...question,
        options: question.options.map((option) => ({
          ...option,
          selected: values.includes(option.value),
        })),
      },
      customValues: values.filter((value) => !configured.has(value)),
      customInput: '',
      expandedOption: question.key === 'rhymeScheme' ? (values[0] ?? '') : '',
      progressText: `${this.data.currentIndex + 1} / ${this.data.questions.length}`,
      progressWidth: `${((this.data.currentIndex + 1) / this.data.questions.length) * 100}%`,
      isLastQuestion,
      primaryText: isLastQuestion
        ? (this.data.returnToCreate ? '完成并开始创作' : '保存偏好')
        : '下一步',
    })
  },

  selectOption(event: WechatMiniprogram.TouchEvent) {
    const question = this.data.currentQuestion
    if (!question) return
    const value = String(event.currentTarget.dataset.value)
    const current = this.data.answers[question.key] ?? []
    const next = question.type === 'single'
      ? [value]
      : current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value]
    this.setData({
      answers: {
        ...this.data.answers,
        [question.key]: next,
      },
    })
    this.refreshQuestion()
  },

  handleCustomInput(event: ValueEvent) {
    this.setData({ customInput: event.detail.value })
  },

  addCustomValue() {
    const question = this.data.currentQuestion
    const value = this.data.customInput.trim()
    if (!question || !question.allowCustom || !value) return
    const current = this.data.answers[question.key] ?? []
    if (current.includes(value)) {
      this.setData({ customInput: '' })
      return
    }
    this.setData({
      answers: {
        ...this.data.answers,
        [question.key]: [...current, value],
      },
    })
    this.refreshQuestion()
  },

  removeCustomValue(event: WechatMiniprogram.TouchEvent) {
    const question = this.data.currentQuestion
    if (!question) return
    const value = String(event.currentTarget.dataset.value)
    this.setData({
      answers: {
        ...this.data.answers,
        [question.key]: (this.data.answers[question.key] ?? [])
          .filter((item) => item !== value),
      },
    })
    this.refreshQuestion()
  },

  previousQuestion() {
    if (this.data.currentIndex <= 0) return
    this.setData({ currentIndex: this.data.currentIndex - 1 })
    this.refreshQuestion()
  },

  async nextQuestion() {
    const question = this.data.currentQuestion
    if (!question || this.data.isSaving) return
    if ((this.data.answers[question.key] ?? []).length === 0) {
      wx.showToast({ title: '请选择至少一项', icon: 'none' })
      return
    }
    if (!this.data.isLastQuestion) {
      this.setData({ currentIndex: this.data.currentIndex + 1 })
      this.refreshQuestion()
      return
    }
    await this.savePreferences()
  },

  async savePreferences() {
    this.setData({ isSaving: true })
    wx.showLoading({ title: '正在保存', mask: true })
    try {
      await saveCreationPreferences({
        questionnaireId: this.data.questionnaireId,
        questionnaireVersion: this.data.questionnaireVersion,
        answers: this.data.answers,
      })
      if (this.data.returnToCreate) {
        wx.setStorageSync(STORAGE_KEYS.creationResumeAfterPreferences, {
          poemType: this.data.answers.poemType?.[0] ?? '',
          styles: this.data.answers.styles ?? [],
        })
      }
      wx.hideLoading()
      wx.showToast({ title: '偏好已保存', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 450)
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
