import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { MiniProgramHeader } from '../components/MiniProgramChrome'
import { ApiError, apiRequest } from '../lib/api'
import { useAppStore } from '../store/app'
import type { User } from '../types'

type LoginMode = 'phone' | 'email'

const phonePattern = /^1\d{10}$/
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function LoginPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const existingUser = useAppStore((state) => state.user)
  const setSession = useAppStore((state) => state.setSession)
  const setToast = useAppStore((state) => state.setToast)
  const [mode, setMode] = useState<LoginMode>('phone')
  const [account, setAccount] = useState('')
  const [code, setCode] = useState('')
  const [seconds, setSeconds] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const returnTo = params.get('returnTo') || '/profile'
  const isValidAccount = useMemo(
    () => (mode === 'phone' ? phonePattern.test(account.trim()) : emailPattern.test(account.trim())),
    [mode, account],
  )

  useEffect(() => {
    if (existingUser) navigate(returnTo, { replace: true })
  }, [existingUser, navigate, returnTo])

  useEffect(() => {
    if (seconds <= 0) return
    const timer = window.setInterval(() => setSeconds((value) => Math.max(0, value - 1)), 1_000)
    return () => window.clearInterval(timer)
  }, [seconds])

  function switchMode(next: LoginMode) {
    setMode(next)
    setAccount('')
    setCode('')
    setError('')
  }

  function sendCode() {
    if (!isValidAccount) {
      setError(mode === 'phone' ? '请输入正确的手机号' : '请输入正确的邮箱地址')
      return
    }
    setError('')
    setSeconds(60)
    setToast('验证码发送能力将在后端接入后开放')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!isValidAccount) {
      setError(mode === 'phone' ? '请输入正确的手机号' : '请输入正确的邮箱地址')
      return
    }
    if (!/^\d{4,6}$/.test(code)) {
      setError('请输入 4 至 6 位验证码')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const response = await apiRequest<{ user: User; accessToken: string; expiresAt: string }>(
        '/auth/verification-code/login',
        {
          method: 'POST',
          body: { channel: mode.toUpperCase(), account: account.trim(), code },
        },
      )
      setSession(response.user, response.accessToken, response.expiresAt)
      setToast('登录成功')
      navigate(returnTo, { replace: true })
    } catch (requestError) {
      if (
        requestError instanceof ApiError &&
        (requestError.statusCode === 404 || requestError.statusCode === 503)
      ) {
        setError('验证码登录服务尚未配置')
      } else {
        setError(requestError instanceof Error ? requestError.message : '登录失败，请稍后重试')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="page login-page">
      <MiniProgramHeader title="登录诗云" background="#f7f5ef" />
      <main className="login-content">
        <div className="login-brand">
          <img src="/assets/images/brand-icon.png" alt="诗云" />
          <h2 className="poem-display">让每一刻，都能写成诗</h2>
          <p>登录后同步作品、草稿与创作偏好</p>
        </div>

        <form className="login-form" onSubmit={submit}>
          <div className="segmented-control" aria-label="登录方式">
            <button type="button" className={mode === 'phone' ? 'is-active' : ''} onClick={() => switchMode('phone')}>
              手机号
            </button>
            <button type="button" className={mode === 'email' ? 'is-active' : ''} onClick={() => switchMode('email')}>
              邮箱
            </button>
          </div>

          <label className="form-field">
            <span>{mode === 'phone' ? '手机号' : '邮箱地址'}</span>
            <div className="input-shell">
              <input
                type={mode === 'phone' ? 'tel' : 'email'}
                inputMode={mode === 'phone' ? 'numeric' : 'email'}
                autoComplete={mode === 'phone' ? 'tel' : 'email'}
                placeholder={mode === 'phone' ? '请输入手机号' : '请输入邮箱地址'}
                value={account}
                maxLength={mode === 'phone' ? 11 : 254}
                onChange={(event) => setAccount(event.target.value)}
              />
              {isValidAccount ? <span className="valid-mark">✓</span> : null}
            </div>
          </label>

          <label className="form-field">
            <span>验证码</span>
            <div className="input-shell input-shell--code">
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="请输入验证码"
                value={code}
                maxLength={6}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
              />
              <button type="button" className="code-button" disabled={seconds > 0} onClick={sendCode}>
                {seconds > 0 ? `${seconds}s` : '获取验证码'}
              </button>
            </div>
          </label>

          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="primary-button" disabled={submitting} type="submit">
            {submitting ? '正在登录…' : '登录 / 注册'}
          </button>
          <p className="login-consent">登录即表示你已阅读并同意《用户协议》和《隐私政策》</p>
        </form>
      </main>
    </div>
  )
}
