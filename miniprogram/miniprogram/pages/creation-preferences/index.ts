import { STORAGE_KEYS } from '../../config/api'
import type { PoemCategory } from '../../services/creation'
import { ensureInstallation } from '../../services/installation'
import {
  loadCreationPreferences,
  type PreferenceQuestion,
  saveCreationPreferences,
} from '../../services/preferences'
import { showErrorToast } from '../../utils/error'
import { parseCustomPreferenceValues } from '../../utils/preference-values'

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

Page({
  data: {
    isLoading: true,
    isSaving: false,
    loadFailed: false,
    returnToCreate: false,
    requestedCategory: '' as PoemCategory | '',
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
    safeAreaBottom: 0,
  },

  onLoad(options: Record<string, string | undefined>) {
    const systemInfo = wx.getSystemInfoSync()
    const safeAreaBottom = Math.max(
      0,
      systemInfo.screenHeight - (systemInfo.safeArea?.bottom ?? systemInfo.screenHeight),
    )
    const requestedCategory = String(options.requestedCategory || '')
    this.setData({
      safeAreaBottom,
      returnToCreate: options.returnTo === 'create',
      requestedCategory: ['CLASSICAL', 'MODERN', 'CI'].includes(requestedCategory)
        ? requestedCategory as PoemCategory
        : '',
    })
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
      showErrorToast(error, { fallback: '偏好加载失败，请稍后重试' })
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
    const values = parseCustomPreferenceValues(this.data.customInput)
    if (!question || !question.allowCustom || values.length === 0) return
    const current = this.data.answers[question.key] ?? []
    const next = [...new Set([...current, ...values])]
    if (next.length > 20) {
      wx.showToast({ title: '最多选择 20 项', icon: 'none' })
      return
    }
    this.setData({
      answers: {
        ...this.data.answers,
        [question.key]: next,
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
          answers: this.data.answers,
          requestedCategory: this.data.requestedCategory,
        })
      }
      wx.hideLoading()
      wx.showToast({ title: '偏好已保存', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 450)
    } catch (error) {
      wx.hideLoading()
      showErrorToast(error, { fallback: '偏好保存失败，请稍后重试' })
    } finally {
      this.setData({ isSaving: false })
    }
  },

  retryLoad() {
    void this.loadPreferences()
  },
})
