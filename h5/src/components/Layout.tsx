import type { PropsWithChildren } from 'react'
import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAppStore } from '../store/app'

export function AppFrame({ children }: PropsWithChildren) {
  const toast = useAppStore((state) => state.toast)
  const clearToast = useAppStore((state) => state.clearToast)
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(clearToast, 2_200)
    return () => window.clearTimeout(timer)
  }, [toast, clearToast])
  return <div className="app-frame"><div className="phone-shell">{children}</div>{toast ? <div className="toast" role="status">{toast}</div> : null}</div>
}

export function LoadingState({ label = '正在加载…' }: { label?: string }) {
  return <div className="loading-state"><img className="weui-loading" src="/assets/icons/nav-loading.svg" alt="" /><span>{label}</span></div>
}

export function RequireLogin({ children }: PropsWithChildren) {
  const location = useLocation()
  const user = useAppStore((state) => state.user)
  const navigate = useNavigate()
  useEffect(() => {
    if (!user) navigate(`/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`, { replace: true })
  }, [user, navigate, location.pathname, location.search])
  return user ? children : <LoadingState label="正在前往登录…" />
}
