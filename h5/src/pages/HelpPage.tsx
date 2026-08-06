import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MiniProgramHeader } from '../components/MiniProgramChrome'

const faqs = [
  { key: 'create', icon: '/assets/icons/help-create.png', question: '如何开始一次创作？', answer: '进入“创作”页，上传想写进诗里的图片或视频，选择诗体并补充灵感后即可开始创作。' },
  { key: 'upload', icon: '/assets/icons/help-upload.png', question: '素材上传失败怎么办？', answer: '请先检查网络和文件大小，再重新选择素材上传。单次最多上传 3 张图片或 1 个视频。' },
  { key: 'publish', icon: '/assets/icons/help-publish.png', question: '作品如何发布到诗词圈？', answer: '保存作品后，进入“我的作品”，在作品操作中选择“发布到诗词圈”即可。' },
]

export default function HelpPage() {
  const navigate = useNavigate()
  const [expandedFaq, setExpandedFaq] = useState('')
  return (
    <div className="mp-page mp-help">
      <MiniProgramHeader title="帮助与反馈" background="#f8f5f3" />
      <main className="help-scroll page-scroll">
        <div className="help-stage">
          <div className="help-page">
            <div className="section-title"><img className="section-icon section-icon--cloud" src="/assets/icons/feedback-cloud.png" alt="" /><h2 className="section-title__text poem-display">常见问题</h2></div>
            <section className="support-card">{faqs.map((faq) => <button key={faq.key} className={`faq-item ${expandedFaq === faq.key ? 'faq-item--expanded' : ''}`} onClick={() => setExpandedFaq(expandedFaq === faq.key ? '' : faq.key)}><span className="support-row"><img className="row-icon" src={faq.icon} alt="" /><span className="row-label poem-display">{faq.question}</span><img className={`row-arrow ${expandedFaq === faq.key ? 'row-arrow--open' : ''}`} src="/assets/icons/common-chevron-right.png" alt="" /></span>{expandedFaq === faq.key ? <span className="faq-answer">{faq.answer}</span> : null}</button>)}</section>
            <div className="section-title section-title--feedback"><img className="section-icon section-icon--leaf" src="/assets/icons/help-leaf.png" alt="" /><h2 className="section-title__text poem-display">联系我们</h2></div>
            <section className="support-card"><button className="support-row feedback-row" onClick={() => navigate('/feedback')}><img className="row-icon" src="/assets/icons/help-feedback.png" alt="" /><span className="row-label poem-display">意见反馈</span><img className="row-arrow" src="/assets/icons/common-chevron-right.png" alt="" /></button></section>
          </div>
          <img className="help-landscape" src="/assets/images/help-bottom.jpg" alt="" />
        </div>
      </main>
    </div>
  )
}
