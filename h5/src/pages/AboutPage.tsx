import { MiniProgramHeader } from '../components/MiniProgramChrome'
import { useAppStore } from '../store/app'

const documents = [
  { icon: '/assets/icons/about-agreement.png', label: '用户协议' },
  { icon: '/assets/icons/about-privacy.png', label: '隐私政策' },
  { icon: '/assets/icons/about-sharing.png', label: '第三方信息共享清单' },
]

export default function AboutPage() {
  const setToast = useAppStore((state) => state.setToast)
  return (
    <div className="mp-page mp-about">
      <MiniProgramHeader title="关于诗云" background="#f5f1ea" />
      <main className="about-scroll page-scroll">
        <div className="about-stage">
          <div className="about-page">
            <div className="brand-block"><img className="brand-mark" src="/assets/images/brand-icon.png" alt="诗云" /><span className="brand-version">VERSION 1.0.0</span></div>
            <section className="document-card">{documents.map((item) => <button className="document-row" key={item.label} onClick={() => setToast('相关内容正在整理')}><img className="document-icon" src={item.icon} alt="" /><span className="document-label poem-display">{item.label}</span><img className="document-arrow" src="/assets/icons/common-chevron-right.png" alt="" /></button>)}</section>
          </div>
          <img className="about-bottom" src="/assets/images/about-bottom.jpg" alt="" />
        </div>
      </main>
    </div>
  )
}
