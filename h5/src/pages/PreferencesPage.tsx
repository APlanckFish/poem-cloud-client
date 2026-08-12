import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { MiniProgramHeader } from '../components/MiniProgramChrome'
import { apiRequest, ensureInstallation } from '../lib/api'
import { requestCreationResume } from '../lib/creation-resume'
import { setStoredJson, storageKeys } from '../lib/storage'
import { useAppStore } from '../store/app'
import type { PoemCategory, PoemPreferences } from '../types'

type Option = { value: string; label: string; description?: string }
type Question = { key: string; title: string; type: 'single' | 'multiple'; allowCustom: boolean; customPlaceholder?: string; options: Option[] }
type PreferenceState = { questionnaire: { id: string; version: number; title: string; questions: Question[] }; preference: { answers: Record<string, string[]> } | null }

const fallbackQuestions: Question[] = [
  { key: 'poemType', title: '你更喜欢哪种诗词？', type: 'single', allowCustom: false, options: [{ value: 'CLASSICAL', label: '古体诗', description: '讲究格律与古典意境' }, { value: 'MODERN', label: '现代诗', description: '自由表达当下感受' }, { value: 'CI', label: '词', description: '依词牌铺展情思' }] },
  { key: 'rhymeScheme', title: '你偏好的韵律方式？', type: 'single', allowCustom: false, options: [{ value: 'NEW_CHINESE', label: '中华新韵', description: '更贴近现代普通话读音' }, { value: 'TRADITIONAL', label: '传统韵表', description: '古体诗使用平水韵，词使用词林正韵' }] },
  { key: 'poets', title: '你喜欢哪些诗人？', type: 'multiple', allowCustom: true, customPlaceholder: '输入其他诗人', options: [{ value: '李白', label: '李白' }, { value: '杜甫', label: '杜甫' }, { value: '苏轼', label: '苏轼' }, { value: '李清照', label: '李清照' }] },
  { key: 'styles', title: '你偏爱怎样的表达？', type: 'multiple', allowCustom: true, customPlaceholder: '输入其他风格', options: [{ value: 'SCENERY', label: '写景' }, { value: 'LYRIC', label: '抒情' }, { value: 'NARRATIVE', label: '叙事' }, { value: 'PHILOSOPHICAL', label: '哲思' }] },
]

function localPreferences(answers: Record<string, string[]>): PoemPreferences {
  return {
    category: (answers.poemType?.[0] as PoemCategory) || 'CLASSICAL',
    classicalFormCode: 'WUYAN_JUEJU', tunePatternCode: null,
    rhymeScheme: answers.rhymeScheme?.[0] === 'TRADITIONAL' ? 'TRADITIONAL' : 'NEW_CHINESE',
    preferredPoets: answers.poets || [], styleTags: answers.styles || [], themeTags: answers.themes || [],
    autoGeneratePoster: (answers.autoGeneratePoster?.[0] || 'true') !== 'false', lengthHint: null,
  }
}

export default function PreferencesPage({ questionnaire = false }: { questionnaire?: boolean }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const setToast = useAppStore((state) => state.setToast)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [questionnaireId, setQuestionnaireId] = useState('local')
  const [questionnaireVersion, setQuestionnaireVersion] = useState(1)
  const [questions, setQuestions] = useState(fallbackQuestions)
  const [answers, setAnswers] = useState<Record<string, string[]>>({})
  const [index, setIndex] = useState(0)
  const [customInput, setCustomInput] = useState('')
  const [expandedOption, setExpandedOption] = useState('')
  const [customEditorKey, setCustomEditorKey] = useState('')

  async function load() {
    setLoading(true)
    setLoadFailed(false)
    try {
      await ensureInstallation()
      const state = await apiRequest<PreferenceState>('/creation-preferences')
      setQuestionnaireId(state.questionnaire.id)
      setQuestionnaireVersion(state.questionnaire.version)
      setQuestions(state.questionnaire.questions)
      setAnswers({ ...(state.preference?.answers || {}), autoGeneratePoster: state.preference?.answers.autoGeneratePoster || ['true'] })
    } catch {
      setQuestions(fallbackQuestions)
      setLoadFailed(false)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [])

  const question = questions[index]
  const configuredValues = new Set(question?.options.map((item) => item.value) || [])
  const customValues = (answers[question?.key || ''] || []).filter((value) => !configuredValues.has(value))
  const isLast = index === questions.length - 1
  const returnToCreate = params.get('returnTo') === '/create'

  function select(key: string, value: string, type: Question['type']) {
    setAnswers((current) => {
      const values = current[key] || []
      return { ...current, [key]: type === 'single' ? [value] : values.includes(value) ? values.filter((item) => item !== value) : [...values, value] }
    })
    if (key === 'rhymeScheme') setExpandedOption(value)
  }

  function addCustom(key: string, value = customInput) {
    const clean = value.trim()
    if (!clean) return
    setAnswers((current) => ({ ...current, [key]: [...new Set([...(current[key] || []), clean])] }))
    setCustomInput('')
    setCustomEditorKey('')
  }

  async function save() {
    if (saving) return
    if (questions.some((item) => !(answers[item.key]?.length))) {
      setToast(questionnaire ? '请选择至少一项' : '请完成全部偏好设置')
      return
    }
    setSaving(true)
    setStoredJson(storageKeys.preferences, localPreferences(answers))
    try {
      if (questionnaireId !== 'local') await apiRequest('/creation-preferences', { method: 'PUT', body: { questionnaireId, questionnaireVersion, answers } })
      if (returnToCreate) requestCreationResume()
      setToast('偏好已保存')
      window.setTimeout(() => navigate(params.get('returnTo') || '/profile'), 450)
    } catch (error) {
      setToast(error instanceof Error ? error.message : '偏好保存失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  if (questionnaire) return (
    <div className="mp-page mp-creation-preferences">
      <MiniProgramHeader title="创作偏好" loading={loading || saving} background="#faf9f5" />
      <main className="preference-page">
        {loading ? <div className="state-view">正在加载…</div> : loadFailed || !question ? <div className="state-view"><span>暂时无法加载偏好问卷</span><button className="retry-button" onClick={() => void load()}>重新加载</button></div> : <>
          <div className="progress"><span className="progress__text">{index + 1} / {questions.length}</span><span className="progress__track"><span className="progress__value" style={{ width: `${((index + 1) / questions.length) * 100}%` }} /></span></div>
          <div className="question-scroll page-scroll"><section className="question"><h2 className="question__title poem-display">{question.title}</h2><div className={`option-list ${question.type === 'multiple' ? 'option-list--grid' : ''}`}>{question.options.map((option) => { const selected = (answers[question.key] || []).includes(option.value); return <div className={`option-slot ${option.description ? 'option-slot--described' : ''}`} key={option.value}><button className={`option ${selected ? 'option--selected' : ''} ${option.description ? 'option--described' : ''}`} onClick={() => select(question.key, option.value, question.type)}><span className="option__main"><strong className="option__label">{option.label}</strong>{selected ? <span className="option__check">✓</span> : null}</span>{option.description ? <span className={`option__description-shell ${expandedOption === option.value ? 'option__description-shell--open' : ''}`}><span className="option__description">{option.description}</span></span> : null}</button></div> })}</div>{question.allowCustom ? <div className="custom"><div className="custom__row"><input className="custom__input" value={customInput} maxLength={40} placeholder={question.customPlaceholder || '输入其他选项'} onChange={(event) => setCustomInput(event.target.value)} /><button className="custom__add" onClick={() => addCustom(question.key)}>添加</button></div>{customValues.length ? <div className="custom__tags">{customValues.map((value) => <button className="custom__tag" key={value} onClick={() => setAnswers((current) => ({ ...current, [question.key]: (current[question.key] || []).filter((item) => item !== value) }))}><span>{value}</span><span className="custom__remove">×</span></button>)}</div> : null}</div> : null}</section></div>
          <footer className="footer"><div className="footer__actions">{index > 0 ? <button className="footer__previous" onClick={() => { setIndex(index - 1); setCustomInput('') }}>上一步</button> : null}<button className={`footer__primary ${index === 0 ? 'footer__primary--full' : ''} ${saving ? 'footer__primary--disabled' : ''}`} onClick={() => { if (!(answers[question.key]?.length)) return setToast('请选择至少一项'); if (!isLast) { setIndex(index + 1); setCustomInput('') } else void save() }}>{isLast ? returnToCreate ? '完成并开始创作' : '保存偏好' : '下一步'}</button></div><div className="footer__safe-area" /></footer>
        </>}
      </main>
    </div>
  )

  const questionByKey = Object.fromEntries(questions.map((item) => [item.key, item]))
  return (
    <div className="mp-page mp-preference-settings">
      <MiniProgramHeader title="创作偏好" loading={loading || saving} background="#faf9f5" />
      <main className="settings-page">{loading ? <div className="state-view">正在加载…</div> : <div className="settings-scroll page-scroll"><div className="settings-content">
        <SettingCard icon="preference-type.png" title="默认诗词类型"><div className="segment-control">{questionByKey.poemType?.options.map((option) => <button className={`segment-control__item ${(answers.poemType || []).includes(option.value) ? 'segment-control__item--selected' : ''}`} key={option.value} onClick={() => select('poemType', option.value, 'single')}>{option.label}</button>)}</div><span className="setting-card__hint">设定默认的诗词类型，创作时可随时切换</span></SettingCard>
        <SettingCard icon="preference-rhyme.png" title="默认韵表"><div className="segment-control segment-control--rhyme">{questionByKey.rhymeScheme?.options.map((option) => <button className={`segment-control__item segment-control__item--rhyme ${(answers.rhymeScheme || []).includes(option.value) ? 'segment-control__item--selected' : ''}`} key={option.value} onClick={() => select('rhymeScheme', option.value, 'single')}>{option.label}</button>)}</div><span className="setting-card__hint">{questionByKey.rhymeScheme?.options.find((item) => (answers.rhymeScheme || []).includes(item.value))?.description || '设定古体诗与词的默认用韵方式'}</span></SettingCard>
        <PreferenceChoiceCard icon="preference-poets.png" title="喜欢的诗人" preferenceKey="poets" hint="可多选，用于理解你偏好的表达方式" question={questionByKey.poets} answers={answers} editorOpen={customEditorKey === 'poets'} customInput={customInput} onCustomInput={setCustomInput} onSelect={select} onToggleEditor={() => { setCustomInput(''); setCustomEditorKey((current) => current === 'poets' ? '' : 'poets') }} onAddCustom={addCustom} />
        <PreferenceChoiceCard icon="preference-style.png" title="默认风格" preferenceKey="styles" hint="设定默认的风格倾向，创作时仍可调整" question={questionByKey.styles} answers={answers} editorOpen={customEditorKey === 'styles'} customInput={customInput} onCustomInput={setCustomInput} onSelect={select} onToggleEditor={() => { setCustomInput(''); setCustomEditorKey((current) => current === 'styles' ? '' : 'styles') }} onAddCustom={addCustom} />
        <PreferenceChoiceCard icon="preference-style.png" title="偏爱题材" preferenceKey="themes" hint="题材与语言风格分开保存，可多选" question={questionByKey.themes} answers={answers} editorOpen={customEditorKey === 'themes'} customInput={customInput} onCustomInput={setCustomInput} onSelect={select} onToggleEditor={() => { setCustomInput(''); setCustomEditorKey((current) => current === 'themes' ? '' : 'themes') }} onAddCustom={addCustom} />
        <SettingCard icon="preference-generation.png" title="生成偏好" extraClass="setting-card--generation"><label className="switch-row"><span className="switch-row__label">自动生成作品海报图</span><input className="mp-switch" type="checkbox" checked={(answers.autoGeneratePoster?.[0] || 'true') !== 'false'} onChange={(event) => setAnswers((current) => ({ ...current, autoGeneratePoster: [String(event.target.checked)] }))} /></label><span className="setting-card__hint setting-card__hint--generation">开启后，将自动为作品生成便于分享的海报图</span></SettingCard>
        <span className="settings-note">偏好仅作为默认选项，创作时仍可调整</span><button className={`save-button ${saving ? 'save-button--disabled' : ''}`} onClick={() => void save()}>{saving ? '正在保存…' : '保存偏好'}</button><div className="bottom-safe-area" />
      </div></div>}</main>
    </div>
  )
}

function PreferenceChoiceCard({ icon, title, preferenceKey, hint, question, answers, editorOpen, customInput, onCustomInput, onSelect, onToggleEditor, onAddCustom }: { icon: string; title: string; preferenceKey: string; hint: string; question?: Question; answers: Record<string, string[]>; editorOpen: boolean; customInput: string; onCustomInput: (value: string) => void; onSelect: (key: string, value: string, type: Question['type']) => void; onToggleEditor: () => void; onAddCustom: (key: string, value?: string) => void }) {
  const configured = question?.options || []
  const configuredValues = new Set(configured.map((item) => item.value))
  const options = [...configured, ...(answers[preferenceKey] || []).filter((value) => !configuredValues.has(value)).map((value) => ({ value, label: value }))]
  return <SettingCard icon={icon} title={title}><div className="chip-grid">{options.map((option) => <button className={`preference-chip ${(answers[preferenceKey] || []).includes(option.value) ? 'preference-chip--selected' : ''}`} key={option.value} onClick={() => onSelect(preferenceKey, option.value, 'multiple')}>{option.label}</button>)}<button className="preference-chip preference-chip--add" onClick={onToggleEditor}>{editorOpen ? '收起输入' : '＋ 自定义'}</button></div>{editorOpen ? <div className="custom"><div className="custom__row"><input className="custom__input" autoFocus maxLength={40} value={customInput} placeholder={question?.customPlaceholder || '请输入自定义选项'} onChange={(event) => onCustomInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onAddCustom(preferenceKey) }} /><button className="custom__add" onClick={() => onAddCustom(preferenceKey)}>添加</button></div></div> : null}<span className="setting-card__hint">{hint}</span></SettingCard>
}

function SettingCard({ icon, title, extraClass = '', children }: { icon: string; title: string; extraClass?: string; children: React.ReactNode }) {
  return <section className={`setting-card ${extraClass}`}><h2 className="setting-card__title"><img className="setting-card__icon" src={`/assets/icons/${icon}`} alt="" /><span className="poem-display">{title}</span></h2>{children}</section>
}
