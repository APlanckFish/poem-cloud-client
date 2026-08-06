import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MiniProgramHeader } from '../components/MiniProgramChrome'
import { apiRequest } from '../lib/api'
import { useAppStore } from '../store/app'
import type { PublicUser } from '../types'

type SocialUser = PublicUser & { displayAvatarUrl: string }
const followersFallback = ['/assets/images/cover-ridge.jpg', '/assets/images/cover-mountain.jpg', '/assets/images/cover-alley.jpg', '/assets/images/cover-sunrise.jpg']
const followingFallback = ['/assets/images/cover-mountain.jpg', '/assets/images/cover-ridge.jpg', '/assets/images/cover-sunrise.jpg', '/assets/images/cover-alley.jpg']

export default function SocialPage({ mode }: { mode: 'followers' | 'following' }) {
  const navigate = useNavigate()
  const storedUser = useAppStore((state) => state.user)!
  const setUser = useAppStore((state) => state.setUser)
  const setToast = useAppStore((state) => state.setToast)
  const [user, updateLocalUser] = useState(storedUser)
  const [items, setItems] = useState<SocialUser[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [operatingId, setOperatingId] = useState('')

  async function load(reset = false) {
    if (loading || (!reset && !nextCursor)) return
    setLoading(true)
    try {
      const query = `limit=30${!reset && nextCursor ? `&cursor=${encodeURIComponent(nextCursor)}` : ''}`
      const response = await apiRequest<{ items: PublicUser[]; nextCursor: string | null }>(`/users/${user.id}/${mode}?${query}`)
      const fallback = mode === 'followers' ? followersFallback : followingFallback
      const offset = reset ? 0 : items.length
      const mapped = response.items.map((item, index) => ({ ...item, displayAvatarUrl: item.avatarUrl || fallback[(offset + index) % fallback.length]! }))
      setItems((current) => reset ? mapped : [...current, ...mapped])
      setNextCursor(response.nextCursor)
    } catch (error) {
      setToast(error instanceof Error ? error.message : mode === 'followers' ? '粉丝列表加载失败，请稍后重试' : '关注列表加载失败，请稍后重试')
    } finally {
      setLoading(false)
      setLoaded(true)
    }
  }

  useEffect(() => { void load(true) }, [mode, user.id])

  async function toggleFollow(target: SocialUser) {
    if (operatingId) return
    setOperatingId(target.id)
    try {
      if (target.followedByMe) await apiRequest(`/users/${target.id}/follow`, { method: 'DELETE' })
      else await apiRequest(`/users/${target.id}/follow`, { method: 'PUT' })
      const followedByMe = !target.followedByMe
      setItems((current) => current.map((item) => item.id === target.id ? { ...item, followedByMe } : item))
      if (mode === 'following') {
        const updated = { ...user, followingCount: Math.max(0, user.followingCount + (followedByMe ? 1 : -1)) }
        updateLocalUser(updated)
        setUser(updated)
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : '关注状态更新失败，请稍后重试')
    } finally {
      setOperatingId('')
    }
  }

  const scope = mode === 'followers' ? 'mp-followers' : 'mp-following'
  return (
    <div className={`mp-page ${scope} app-viewport social-viewport`}>
      <MiniProgramHeader title={mode === 'followers' ? '我的粉丝' : '我的关注'} loading={loading} background="#fbfaf7" color="#161c19" />
      <main className="social-scroll page-scroll" onScroll={(event) => { const element = event.currentTarget; if (element.scrollTop + element.clientHeight >= element.scrollHeight - 180) void load(false) }}>
        <div className={`social-page ${loaded && !items.length ? 'social-page--empty' : ''}`}>
          <section className={`social-hero social-hero--${mode}`}>
            <img className="hero-art" src={`/assets/images/social-${mode}-hero-v6.png`} alt="" />
            {mode === 'followers' ? <div className="hero-avatar">{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <img src="/assets/images/cover-ridge.jpg" alt="" />}</div> : null}
            <div className={`hero-copy ${mode === 'following' ? 'hero-copy--following' : ''}`}><div className="hero-number-line poem-display"><strong className="hero-number">{mode === 'followers' ? user.followerCount : user.followingCount}</strong><span className="hero-unit">人</span></div>{mode === 'followers' ? <div className="hero-caption-line"><span className="hero-caption">关注你的人</span><span className="hero-cloud-line" /></div> : <span className="hero-caption">关注诗友，发现更多美好诗意</span>}</div>
          </section>

          {items.length ? <div className="social-list">{items.map((item) => <div className="person-card" key={item.id} role="button" tabIndex={0} onClick={() => navigate(`/works/user/${item.id}`)} onKeyDown={(event) => { if (event.key === 'Enter') navigate(`/works/user/${item.id}`) }}><span className="person-avatar"><img src={item.displayAvatarUrl} alt="" /></span><span className="person-copy"><strong className="person-name poem-display">{item.nickname}</strong><span className="person-signature">{item.signature || '这个人很神秘，什么都没有留下'}</span></span><button className={`follow-button poem-display ${item.followedByMe ? 'follow-button--mutual' : mode === 'followers' ? 'follow-button--primary' : 'follow-button--idle'} ${operatingId === item.id ? 'follow-button--busy' : ''}`} disabled={Boolean(operatingId)} onClick={(event) => { event.stopPropagation(); void toggleFollow(item) }}>{item.followedByMe ? mode === 'followers' ? '互相关注' : '已关注' : mode === 'followers' ? '回关' : '关注'}</button></div>)}</div> : loaded && !loading ? <div className="social-empty"><img className="empty-illustration" src={`/assets/images/empty-${mode}-v4.png`} alt="" /><strong className="empty-title poem-display">{mode === 'followers' ? '暂无粉丝' : '暂无关注'}</strong><span className="empty-copy">{mode === 'followers' ? '发布你的诗作，让更多诗友认识你' : '去诗词圈走走，遇见与你同频的诗友'}</span><button className="empty-outline poem-display" onClick={() => navigate(mode === 'followers' ? '/create' : '/community')}>{mode === 'followers' ? '开始创作' : '逛逛诗词圈'}</button></div> : null}
        </div>
      </main>
    </div>
  )
}
