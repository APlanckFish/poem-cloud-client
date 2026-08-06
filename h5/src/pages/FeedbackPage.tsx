import { type ChangeEvent, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MiniProgramHeader } from '../components/MiniProgramChrome'
import { apiRequest, idempotencyKey } from '../lib/api'
import { uploadAsset } from '../lib/uploads'
import { useAppStore } from '../store/app'

const types = [
  { label: '功能建议', value: 'SUGGESTION' },
  { label: '体验问题', value: 'EXPERIENCE' },
  { label: '内容问题', value: 'CONTENT' },
  { label: '其他', value: 'OTHER' },
] as const

export default function FeedbackPage() {
  const navigate = useNavigate()
  const setToast = useAppStore((state) => state.setToast)
  const [selectedType, setSelectedType] = useState<(typeof types)[number]['value']>('SUGGESTION')
  const [content, setContent] = useState('')
  const [email, setEmail] = useState('')
  const [images, setImages] = useState<Array<{ file: File; url: string }>>([])
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  function chooseImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).slice(0, 3 - images.length)
    setImages((current) => [...current, ...files.map((file) => ({ file, url: URL.createObjectURL(file) }))])
    event.target.value = ''
  }

  function removeImage(index: number) {
    setImages((current) => {
      const target = current[index]
      if (target) URL.revokeObjectURL(target.url)
      return current.filter((_, itemIndex) => itemIndex !== index)
    })
  }

  async function submitFeedback() {
    if (submitting) return
    if (!content.trim()) {
      setToast('请填写反馈内容')
      return
    }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setToast('请填写正确的邮箱地址')
      return
    }
    setSubmitting(true)
    try {
      const imageAssetIds: string[] = []
      for (const image of images) imageAssetIds.push((await uploadAsset(image.file, 'IMAGE', 'FEEDBACK')).id)
      await apiRequest('/feedbacks', {
        method: 'POST',
        body: {
          category: selectedType,
          content: content.trim(),
          ...(email.trim() ? { contact: email.trim() } : {}),
          imageAssetIds,
        },
        idempotencyKey: idempotencyKey('submit-feedback'),
      })
      setSubmitted(true)
    } catch (error) {
      setToast(error instanceof Error ? error.message : '提交失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  function continueFeedback() {
    images.forEach((image) => URL.revokeObjectURL(image.url))
    setSelectedType('SUGGESTION')
    setContent('')
    setEmail('')
    setImages([])
    setSubmitted(false)
  }

  return (
    <div className="mp-page mp-feedback">
      <MiniProgramHeader title="意见反馈" background="#f8f5f1" />
      <main className="feedback-scroll page-scroll">
        {!submitted ? <div className="feedback-page">
          <section className="feedback-section">
            <div className="field-heading"><img className="field-heading__cloud" src="/assets/icons/feedback-cloud.png" alt="" /><h2 className="field-title poem-display">问题类型</h2></div>
            <div className="type-list">{types.map((type) => <button key={type.value} className={`type-chip ${selectedType === type.value ? 'type-chip--selected' : ''}`} onClick={() => setSelectedType(type.value)}>{selectedType === type.value ? <img className="selected-check" src="/assets/icons/feedback-selected.png" alt="" /> : null}<span>{type.label}</span></button>)}</div>
          </section>

          <label className="textarea-shell"><textarea className="feedback-textarea poem-display" maxLength={500} value={content} placeholder="请描述你遇到的问题或建议..." onChange={(event) => setContent(event.target.value)} /><span className="character-count">{content.length}/500</span></label>

          <section className="feedback-section feedback-section--images">
            <div className="field-heading"><img className="field-heading__image" src="/assets/icons/feedback-image.png" alt="" /><h2 className="field-title poem-display">添加截图</h2><span className="field-note poem-display">（最多3张）</span></div>
            <div className="image-list">{images.map((image, index) => <div className="image-item" key={image.url}><button className="image-preview-button" onClick={() => window.open(image.url, '_blank')}><img className="image-preview" src={image.url} alt="反馈截图" /></button><button className="image-remove" onClick={() => removeImage(index)}>×</button></div>)}{images.length < 3 ? <button className="image-picker" onClick={() => fileInput.current?.click()}><img className="image-picker__plus" src="/assets/icons/feedback-add.png" alt="" /></button> : null}<input ref={fileInput} hidden type="file" accept="image/*" multiple onChange={chooseImages} /></div>
          </section>

          <section className="feedback-section feedback-section--email">
            <div className="field-heading"><img className="field-heading__contact" src="/assets/icons/feedback-contact.png" alt="" /><h2 className="field-title poem-display">联系邮箱</h2><span className="field-note poem-display">（选填）</span></div>
            <label className="email-shell"><input className="email-input poem-display" type="email" value={email} maxLength={120} placeholder="邮箱地址（选填）" onChange={(event) => setEmail(event.target.value)} /></label>
          </section>

          <button className={`submit-button ${submitting ? 'submit-button--disabled' : ''}`} onClick={() => void submitFeedback()} disabled={submitting}><img src="/assets/images/feedback-submit-button.jpg" alt="提交反馈" /></button>
          <img className="feedback-landscape" src="/assets/images/feedback-bottom.jpg" alt="" />
        </div> : <div className="success-page">
          <img className="success-landscape" src="/assets/images/feedback-success-bottom.jpg" alt="" />
          <img className="success-image" src="/assets/images/feedback-success.jpg" alt="" />
          <h2 className="success-title poem-display">反馈已提交</h2>
          <p className="success-copy poem-display">感谢你的建议，我们会认真阅读并持续改进。</p>
          <button className="success-primary" onClick={() => navigate('/help')}><img src="/assets/images/feedback-return-button.jpg" alt="返回帮助与反馈" /></button>
          <button className="success-secondary poem-display" onClick={continueFeedback}>继续反馈</button>
        </div>}
      </main>
    </div>
  )
}
