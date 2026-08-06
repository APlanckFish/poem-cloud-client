import { type ChangeEvent, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MiniProgramHeader, MiniProgramTabBar } from '../components/MiniProgramChrome'
import { WechatDialog } from '../components/WechatDialog'
import { apiRequest, ensureInstallation } from '../lib/api'
import { getStoredJson, storageKeys } from '../lib/storage'
import { uploadAsset } from '../lib/uploads'
import { useAppStore } from '../store/app'
import type { Dashboard, Quota, User } from '../types'

type MenuItem = { key: string; label: string; protected: boolean }

function quotaRingClass(remaining: number | null, limit: number | null, unlimited = false) {
  if (unlimited) return 'quota-ring--3'
  if (limit === null || remaining === null || limit <= 0 || remaining <= 0) return 'quota-ring--0'
  const progress = Math.min(1, remaining / limit)
  if (progress <= 1 / 3) return 'quota-ring--1'
  if (progress <= 2 / 3) return 'quota-ring--2'
  return 'quota-ring--3'
}

const libraryMenus: MenuItem[] = [
  { key: 'works', label: '我的作品', protected: true },
  { key: 'drafts', label: '我的草稿', protected: false },
  { key: 'followers', label: '我的粉丝', protected: true },
  { key: 'following', label: '我的关注', protected: true },
]
const accountMenus: MenuItem[] = [
  { key: 'preferences', label: '创作偏好', protected: false },
  { key: 'edit-profile', label: '编辑资料', protected: true },
]
const supportMenus: MenuItem[] = [
  { key: 'feedback', label: '帮助与反馈', protected: false },
  { key: 'about', label: '关于诗云', protected: false },
]

export default function ProfilePage() {
  const navigate = useNavigate()
  const user = useAppStore((state) => state.user)
  const dashboard = useAppStore((state) => state.dashboard)
  const restoreSession = useAppStore((state) => state.restoreSession)
  const logout = useAppStore((state) => state.logout)
  const setUser = useAppStore((state) => state.setUser)
  const setToast = useAppStore((state) => state.setToast)
  const [guestQuota, setGuestQuota] = useState<Quota | null>(null)
  const [loading, setLoading] = useState(false)
  const [showLoginDialog, setShowLoginDialog] = useState(false)
  const [showLogoutDialog, setShowLogoutDialog] = useState(false)
  const [showProfileSetup, setShowProfileSetup] = useState(false)
  const [pendingAvatarUrl, setPendingAvatarUrl] = useState('')
  const [pendingAvatarFile, setPendingAvatarFile] = useState<File | null>(null)
  const [pendingNickname, setPendingNickname] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const avatarInput = useRef<HTMLInputElement>(null)
  const localDraftCount = (getStoredJson<unknown[]>(storageKeys.localDrafts) ?? []).length

  useEffect(() => {
    setLoading(true)
    if (user) void restoreSession().finally(() => setLoading(false))
    else void ensureInstallation().then(() => apiRequest<Quota>('/me/quota')).then(setGuestQuota).catch(() => undefined).finally(() => setLoading(false))
  }, [user?.id, restoreSession])

  const stats = {
    works: dashboard?.workCount ?? 0,
    drafts: (dashboard?.draftCount ?? 0) + localDraftCount,
    likes: dashboard?.receivedLikes ?? 0,
    followers: user?.followerCount ?? 0,
  }
  const quota = dashboard?.quota ?? guestQuota
  const isLevelZeroVip = user?.level === 0
  const rankLabel = isLevelZeroVip ? '诗云黑金 SVIP' : `诗云 · 等级 ${user?.level ?? 1}`

  function openProfileSetup() {
    if (!user) return
    setPendingAvatarUrl(user.avatarUrl || '')
    setPendingAvatarFile(null)
    setPendingNickname(user.nickname)
    setShowProfileSetup(true)
  }

  function chooseAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setPendingAvatarFile(file)
    setPendingAvatarUrl(URL.createObjectURL(file))
    event.target.value = ''
  }

  async function saveProfileSetup() {
    if (!user || savingProfile) return
    const nickname = pendingNickname.trim() || user.nickname.trim()
    if (!pendingAvatarUrl) {
      setToast('请选择微信头像')
      return
    }
    if (!nickname) {
      setToast('请选择或填写微信昵称')
      return
    }
    setSavingProfile(true)
    try {
      let avatarAssetId = user.avatarAssetId
      if (pendingAvatarFile) avatarAssetId = (await uploadAsset(pendingAvatarFile, 'AVATAR')).id
      const updated = await apiRequest<User>('/me', {
        method: 'PATCH',
        body: { nickname, avatarAssetId },
      })
      setUser({ ...updated, avatarUrl: pendingAvatarUrl })
      setShowProfileSetup(false)
      setToast('资料已保存')
    } catch (error) {
      setToast(error instanceof Error ? error.message : '资料保存失败，请稍后重试')
    } finally {
      setSavingProfile(false)
    }
  }

  function handleMenu(item: MenuItem) {
    if (item.protected && !user) {
      setShowLoginDialog(true)
      return
    }
    const route: Record<string, string> = {
      works: '/works', drafts: '/drafts', followers: '/followers', following: '/following',
      preferences: '/preferences', 'edit-profile': '/edit-profile', feedback: '/help', about: '/about',
    }
    navigate(route[item.key] || '/profile')
  }

  async function performLogout() {
    setShowLogoutDialog(false)
    setLoading(true)
    try {
      await logout()
      setToast('已退出登录')
    } catch (error) {
      setToast(error instanceof Error ? error.message : '退出登录失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  function menuValue(item: MenuItem) {
    if (item.key === 'works' && user) return stats.works
    if (item.key === 'drafts' && (user || stats.drafts > 0)) return stats.drafts
    if (item.key === 'followers' && user) return user.followerCount
    if (item.key === 'following' && user) return user.followingCount
    return null
  }

  function MenuCard({ items }: { items: MenuItem[] }) {
    return <section className="menu-card">{items.map((item) => <button className="menu-row" key={item.key} onClick={() => handleMenu(item)}><img className="menu-icon" src={`/assets/icons/menu-${item.key}.svg`} alt="" /><span className="menu-label">{item.label}</span>{menuValue(item) !== null ? <span className="menu-value">{menuValue(item)}</span> : null}<img className="menu-arrow" src="/assets/icons/common-chevron-right.svg" alt="" /></button>)}</section>
  }

  return (
    <div className="mp-page mp-profile app-viewport profile-viewport">
      <MiniProgramHeader title="我的" back={false} loading={loading} background="#fbfaf7" />
      <main className="page-scroll">
        <div className="page-content profile-page">
          <section className="identity-section">
            <div className={`profile-main ${user ? 'profile-main--logged' : 'profile-main--guest'}`}>
              <div className="avatar-shell">{user?.avatarUrl ? <img className="avatar-image" src={user.avatarUrl} alt="" /> : <div className="avatar-default"><span className="default-head" /><span className="default-body" /></div>}</div>
              <div className="profile-copy">{user ? <><div className="profile-name-row"><strong className="profile-name poem-display">{user.nickname}</strong><button className="profile-edit-button" onClick={openProfileSetup} aria-label="编辑个人资料"><img className="edit-mark" src="/assets/icons/common-edit.svg" alt="" /></button></div><div className={`account-tag ${isLevelZeroVip ? 'account-tag--black-gold' : ''}`}><span className="account-tag__copy">{rankLabel}</span></div></> : <><strong className="profile-name poem-display">诗云访客</strong><span className="profile-subtitle">登录后同步作品与草稿</span><button className="login-button" onClick={() => navigate('/login?returnTo=/profile')}>登录</button></>}</div>
              {user ? <button className="logout-button" onClick={() => setShowLogoutDialog(true)}>登出</button> : null}
            </div>
            {user ? <div className="stats-row"><button className="stat-item" onClick={() => navigate('/works')}><strong className="stat-value poem-display">{stats.works}</strong><span className="stat-label">作品</span></button><span className="stat-divider" /><button className="stat-item" onClick={() => navigate('/drafts')}><strong className="stat-value poem-display">{stats.drafts}</strong><span className="stat-label">草稿</span></button><span className="stat-divider" /><div className="stat-item"><strong className="stat-value poem-display">{stats.likes}</strong><span className="stat-label">获赞</span></div><span className="stat-divider" /><button className="stat-item" onClick={() => navigate('/followers')}><strong className="stat-value poem-display">{stats.followers}</strong><span className="stat-label">粉丝</span></button></div> : null}
          </section>

          <section className={`quota-card ${isLevelZeroVip ? 'quota-card--black-gold' : ''}`}>{isLevelZeroVip ? <><div className="vip-copy"><div className="vip-eyebrow"><span className="vip-eyebrow__mark">SVIP</span><span className="vip-eyebrow__name">诗云黑金会员</span></div><strong className="vip-title poem-display">无限创作特权</strong><span className="vip-caption">至臻等级 · 尊享不限次数创作</span></div><div className="vip-emblem"><span className="vip-emblem__label">SVIP</span><span className="vip-emblem__infinity">∞</span></div></> : <><div className="quota-copy"><span className="quota-label poem-display">今日可创作</span><div className="quota-value-row"><strong className="quota-value">{quota ? quota.unlimited ? '不限' : quota.remaining : '—'}</strong>{!quota?.unlimited ? <span className="quota-unit">次</span> : null}</div></div><div className="quota-meter"><div className={`quota-ring ${quotaRingClass(quota?.remaining ?? null, quota?.limit ?? null, quota?.unlimited)}`}><div className="quota-ring__inner"><span className="quota-ring__value">{quota ? quota.unlimited ? '∞' : `${quota.remaining}/${quota.limit}` : '—/—'}</span></div></div><span className="quota-ring__label">{quota ? quota.unlimited ? '无限创作' : `每日 ${quota.limit} 次` : '正在同步'}</span></div></>}</section>
          <MenuCard items={libraryMenus} />
          <MenuCard items={accountMenus} />
          <MenuCard items={supportMenus} />
        </div>
      </main>

      {showProfileSetup ? <div className="profile-setup-overlay"><section className="profile-setup-dialog"><h2 className="profile-setup-title poem-display">完善微信资料</h2><p className="profile-setup-copy poem-display">让诗友更好地认识你</p><button className="avatar-picker" onClick={() => avatarInput.current?.click()}>{pendingAvatarUrl ? <img className="avatar-picker__image" src={pendingAvatarUrl} alt="" /> : <span className="avatar-picker__placeholder"><span className="avatar-picker__placeholder-head" /><span className="avatar-picker__placeholder-body" /></span>}<span className="avatar-picker__camera"><span className="avatar-picker__camera-body"><span className="avatar-picker__camera-lens" /></span></span></button><input ref={avatarInput} hidden type="file" accept="image/*" onChange={chooseAvatar} /><span className="avatar-picker__label poem-display">点击更换头像</span><label className="nickname-field"><span className="nickname-field__label poem-display">昵称</span><span className="nickname-field__control"><input className="nickname-field__input poem-display" maxLength={24} value={pendingNickname} placeholder="请输入昵称" onChange={(event) => setPendingNickname(event.target.value)} /></span></label><div className="profile-setup-actions"><button className="profile-setup-skip" disabled={savingProfile} onClick={() => setShowProfileSetup(false)}>稍后再说</button><button className={`profile-setup-save ${savingProfile ? 'profile-setup-save--disabled' : ''}`} disabled={savingProfile} onClick={() => void saveProfileSetup()}>{savingProfile ? '保存中…' : '保存资料'}</button></div></section></div> : null}

      <MiniProgramTabBar />
      <WechatDialog open={showLoginDialog} title="登录后使用" content="登录后可同步你的作品与草稿。" confirmText="登录" onCancel={() => setShowLoginDialog(false)} onConfirm={() => navigate('/login?returnTo=/profile')} />
      <WechatDialog open={showLogoutDialog} title="退出登录" content="退出后，本机仍会保留未登录草稿。" confirmText="退出" onCancel={() => setShowLogoutDialog(false)} onConfirm={performLogout} />
    </div>
  )
}
