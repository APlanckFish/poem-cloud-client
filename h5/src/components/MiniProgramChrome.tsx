import type { CSSProperties, ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'

export function MiniProgramHeader({
  title = '',
  back = true,
  loading = false,
  center,
  onBack,
  background = 'var(--mp-page-background, #fbfaf7)',
  color = '#202824',
}: {
  title?: string
  back?: boolean
  loading?: boolean
  center?: ReactNode
  onBack?: () => void
  background?: string
  color?: string
}) {
  const navigate = useNavigate()
  const isAndroid = /Android/i.test(navigator.userAgent)
  const style = {
    '--mp-nav-background': background,
    '--mp-nav-color': color,
  } as CSSProperties
  return (
    <div className="weui-navigation-bar" style={style}>
      <div className={`weui-navigation-bar__inner ${isAndroid ? 'android' : 'ios'}`}>
        <div className="weui-navigation-bar__left">
          {back ? (
            <div className="weui-navigation-bar__buttons weui-navigation-bar__buttons_goback">
              <button
                className="weui-navigation-bar__btn_goback_wrapper"
                aria-label="返回"
                onClick={() => onBack ? onBack() : navigate(-1)}
              >
                <img className="weui-navigation-bar__button weui-navigation-bar__btn_goback" src="/assets/icons/nav-back.svg" alt="" />
              </button>
            </div>
          ) : null}
        </div>
        <div className="weui-navigation-bar__center">
          {loading ? <span className="weui-navigation-bar__loading"><img className="weui-loading" src="/assets/icons/nav-loading.svg" alt="加载中" /></span> : null}
          {title || center}
        </div>
        <div className="weui-navigation-bar__right" />
      </div>
    </div>
  )
}

const tabs = [
  { to: '/create', label: '创作', icon: 'tab-create.svg', active: 'tab-create-active.svg' },
  { to: '/community', label: '诗词圈', icon: 'tab-community.svg', active: 'tab-community-active.svg' },
  { to: '/profile', label: '我的', icon: 'tab-profile.svg', active: 'tab-profile-active.svg' },
]

export function MiniProgramTabBar() {
  return (
    <nav className="tab-bar" aria-label="主导航">
      {tabs.map((tab) => (
        <NavLink key={tab.to} to={tab.to} className={({ isActive }) => `tab-item ${isActive ? 'tab-item--active' : ''}`}>
          {({ isActive }) => (
            <>
              <img className="tab-icon" src={`/assets/icons/${isActive ? tab.active : tab.icon}`} alt="" />
              <span className="tab-label">{tab.label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
