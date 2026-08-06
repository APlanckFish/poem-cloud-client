import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { MiniProgramHeader } from '../components/MiniProgramChrome'
import { WechatDialog } from '../components/WechatDialog'
import { apiRequest, idempotencyKey } from '../lib/api'
import { useAppStore } from '../store/app'
import type { CommunityPublication } from '../types'

type Comment = {
  id: string
  publicationId: string
  parentCommentId: string | null
  rootCommentId: string | null
  content: string
  moderationStatus: 'PENDING' | 'PASSED' | 'REJECTED' | 'REVIEW'
  createdAt: string
  canDelete: boolean
  isPublicationAuthor: boolean
  replyCount: number
  replies: Comment[]
  hasMoreReplies: boolean
  author: { id: string; nickname: string; avatarUrl: string | null }
  replyToUser: { id: string; nickname: string } | null
}

type LoginAction = 'LIKE' | 'FOLLOW' | 'COMMENT'

function fallbackCover(category: CommunityPublication['category']) {
  if (category === 'MODERN') return '/assets/images/cover-alley.jpg'
  if (category === 'CI') return '/assets/images/cover-sunrise.jpg'
  return '/assets/images/cover-mountain.jpg'
}

function categoryName(publication: CommunityPublication) {
  const forms: Record<string, string> = {
    WUYAN_JUEJU: '五言绝句', QIYAN_JUEJU: '七言绝句',
    WUYAN_LVSHI: '五言律诗', QIYAN_LVSHI: '七言律诗', DAYOU_SHI: '打油诗',
  }
  if (publication.category === 'MODERN') return '现代诗'
  if (publication.category === 'CI') return '词'
  return forms[publication.classicalFormCode || ''] || '古体诗'
}

function poemCardHeight(content: string) {
  const lineCount = content.replace(/\\n/g, '\n').split('\n').filter(Boolean).length
  return Math.max(1040, Math.min(1460, 900 + lineCount * 62))
}

function displayTime(value: string) {
  const date = new Date(value)
  const now = Date.now()
  const delta = now - date.getTime()
  if (delta < 60_000) return '刚刚'
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}分钟前`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}小时前`
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
}

export default function PublicationPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const user = useAppStore((state) => state.user)
  const setToast = useAppStore((state) => state.setToast)
  const [publication, setPublication] = useState<CommunityPublication | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [isCardFlipped, setCardFlipped] = useState(false)
  const [isCardHinting, setCardHinting] = useState(false)
  const [showLikeBurst, setShowLikeBurst] = useState(false)
  const [isLiking, setLiking] = useState(false)
  const [followedByMe, setFollowedByMe] = useState(false)
  const [isFollowing, setFollowing] = useState(false)
  const [comments, setComments] = useState<Comment[]>([])
  const [commentsLoaded, setCommentsLoaded] = useState(false)
  const [commentsError, setCommentsError] = useState('')
  const [commentDraft, setCommentDraft] = useState('')
  const [replyingTo, setReplyingTo] = useState<Comment | null>(null)
  const [isSubmittingComment, setSubmittingComment] = useState(false)
  const [deletingComment, setDeletingComment] = useState<Comment | null>(null)
  const [loginAction, setLoginAction] = useState<LoginAction | null>(null)

  async function load() {
    if (!id) return
    setLoading(true)
    setNotFound(false)
    try {
      const [item, commentResponse] = await Promise.all([
        apiRequest<CommunityPublication>(`/community/publications/${id}`),
        apiRequest<{ items: Comment[] }>(`/community/publications/${id}/comments?limit=20`).catch(() => ({ items: [] })),
      ])
      setPublication(item)
      setComments(commentResponse.items)
      setCommentsLoaded(true)
      if (item.author.id !== user?.id) {
        void apiRequest<{ followedByMe: boolean }>(`/users/${item.author.id}`)
          .then((author) => setFollowedByMe(author.followedByMe))
          .catch(() => undefined)
      }
      const hintKey = `poem_cloud_publication_flip_hint:${user?.id || 'guest'}:${item.id}`
      if (item.canViewCreationJournal && localStorage.getItem(hintKey) !== '1') {
        localStorage.setItem(hintKey, '1')
        setCardHinting(true)
        window.setTimeout(() => setCardHinting(false), 5_200)
      }
    } catch {
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [id, user?.id])

  const contentLines = useMemo(
    () => publication?.content.replace(/\\n/g, '\n').split('\n') ?? [],
    [publication?.content],
  )
  const isOwner = Boolean(user && publication?.author.id === user.id)
  const isPublic = publication?.visibility === 'PUBLIC' && publication.status === 'PUBLISHED'

  function requireLogin(action: LoginAction) {
    if (user) return true
    setLoginAction(action)
    return false
  }

  function confirmLogin() {
    const action = loginAction
    setLoginAction(null)
    navigate(`/login?returnTo=${encodeURIComponent(`/publication/${id}?resume=${action || ''}`)}`)
  }

  function triggerLikeBurst() {
    setShowLikeBurst(false)
    window.requestAnimationFrame(() => {
      setShowLikeBurst(true)
      window.setTimeout(() => setShowLikeBurst(false), 760)
    })
  }

  async function toggleLike() {
    if (!publication?.id || isLiking || !requireLogin('LIKE')) return
    const previous = publication
    const likedByMe = !publication.likedByMe
    setLiking(true)
    setPublication({ ...publication, likedByMe, likeCount: Math.max(0, publication.likeCount + (likedByMe ? 1 : -1)) })
    if (likedByMe) triggerLikeBurst()
    try {
      await apiRequest(`/community/publications/${publication.id}/like`, { method: likedByMe ? 'PUT' : 'DELETE' })
    } catch (error) {
      setPublication(previous)
      setShowLikeBurst(false)
      setToast(error instanceof Error ? error.message : '操作失败')
    } finally {
      setLiking(false)
    }
  }

  async function toggleFollow() {
    if (!publication || isOwner || isFollowing || !requireLogin('FOLLOW')) return
    const next = !followedByMe
    setFollowing(true)
    setFollowedByMe(next)
    try {
      await apiRequest(`/users/${publication.author.id}/follow`, { method: next ? 'PUT' : 'DELETE' })
    } catch (error) {
      setFollowedByMe(!next)
      setToast(error instanceof Error ? error.message : '操作失败')
    } finally {
      setFollowing(false)
    }
  }

  async function submitComment(event: FormEvent) {
    event.preventDefault()
    if (!publication?.id || isSubmittingComment || !requireLogin('COMMENT')) return
    const content = commentDraft.trim()
    if (!content) {
      setToast('请先写下评论')
      return
    }
    setSubmittingComment(true)
    try {
      const result = await apiRequest<{ comment: Comment; commentCount: number }>(
        `/community/publications/${publication.id}/comments`,
        {
          method: 'POST',
          body: { content, ...(replyingTo ? { parentCommentId: replyingTo.id } : {}) },
          idempotencyKey: idempotencyKey('comment'),
        },
      )
      if (result.comment.moderationStatus === 'PASSED') {
        setComments((current) => result.comment.rootCommentId
          ? current.map((comment) => comment.id === result.comment.rootCommentId
            ? { ...comment, replies: [...comment.replies, result.comment], replyCount: comment.replyCount + 1 }
            : comment)
          : [result.comment, ...current])
        setToast('评论已发布')
      } else setToast('评论已提交审核')
      setPublication((current) => current ? { ...current, commentCount: result.commentCount } : current)
      setCommentDraft('')
      setReplyingTo(null)
    } catch (error) {
      setToast(error instanceof Error ? error.message : '评论发布失败')
    } finally {
      setSubmittingComment(false)
    }
  }

  async function confirmDeleteComment() {
    if (!publication || !deletingComment) return
    const target = deletingComment
    setDeletingComment(null)
    try {
      const result = await apiRequest<{ commentCount: number; visibleDeletedCount: number }>(
        `/community/publications/${publication.id}/comments/${target.id}`,
        { method: 'DELETE' },
      )
      setComments((current) => target.rootCommentId
        ? current.map((comment) => comment.id === target.rootCommentId
          ? { ...comment, replies: comment.replies.filter((reply) => reply.id !== target.id), replyCount: Math.max(0, comment.replyCount - result.visibleDeletedCount) }
          : comment)
        : current.filter((comment) => comment.id !== target.id))
      setPublication({ ...publication, commentCount: result.commentCount })
      setToast('评论已删除')
    } catch (error) {
      setToast(error instanceof Error ? error.message : '评论删除失败')
    }
  }

  function pendingWechatCapability() {
    setToast('微信 JSSDK 能力待接入')
  }

  return (
    <div className="mp-page mp-publication-detail app-viewport detail-viewport">
      <MiniProgramHeader title="作品详情" loading={loading} background={notFound ? '#f6f4f2' : '#fffefa'} />
      <main className="detail-scroll page-scroll">
        {publication ? <div className="detail-page">
          <div className="detail-card-scene" style={{ height: `${poemCardHeight(publication.content) / 7.5}cqw` }}>
            <div className={`detail-flip-card ${isCardFlipped ? 'detail-flip-card--back' : ''} ${isCardHinting ? 'detail-flip-card--hinting' : ''}`} onAnimationEnd={() => setCardHinting(false)}>
              <article className="detail-paper detail-card-face detail-card-front" onClick={() => publication.canViewCreationJournal && setCardFlipped(true)}>
                <div className="detail-paper__scene"><img className="detail-paper__scene-image" src={publication.displayCoverUrl || publication.coverUrl || fallbackCover(publication.category)} alt="" /><div className="detail-paper__scene-fade" /></div>
                <h2 className="detail-title poem-display">{publication.title}</h2>
                <div className="detail-badges"><span className="detail-type poem-display">{categoryName(publication)}</span></div>
                <div className="detail-author"><span className="detail-author__avatar poem-display">{publication.author.avatarUrl ? <img src={publication.author.avatarUrl} alt="" /> : publication.author.nickname.slice(0, 1)}</span><span className="detail-author__copy"><strong className="detail-author__name poem-display">{publication.author.nickname}</strong>{publication.publishedAt ? <time className="detail-author__date">{displayTime(publication.publishedAt)}</time> : null}</span></div>
                <div className="detail-content poem-display">{contentLines.map((line, index) => <p key={`${index}-${line}`}>{line || '\u00a0'}</p>)}</div>
              </article>

              <article className="detail-card-face detail-journal">
                <button className="detail-journal__header" onClick={() => setCardFlipped(false)}><strong className="detail-journal__title poem-display">创作手记</strong><span className="detail-journal__subtitle poem-display">从一束光影，到一首诗</span></button>
                <div className="detail-journal__scroll">
                  <div className="detail-timeline">
                    {publication.materials.length ? <div className="detail-materials"><div className="detail-timeline__rail"><span className="detail-timeline__node" /><span className="detail-timeline__line" /></div><div className="detail-materials__body"><strong className="detail-timeline__label poem-display">查看原始素材</strong><span className="detail-timeline__description">创作这首诗时使用的图片与视频</span><div className="detail-materials__list">{publication.materials.map((material) => <button className="detail-materials__item" key={material.id} onClick={() => window.open(material.url, '_blank')}><img className="detail-materials__image" src={material.thumbnailUrl || material.url} alt="" /></button>)}</div></div></div> : null}
                    <div className="detail-timeline__moment"><div className="detail-timeline__rail"><span className="detail-timeline__node" /><span className="detail-timeline__line" /></div><div className="detail-timeline__body"><strong className="detail-timeline__label poem-display">理解素材</strong><span className="detail-timeline__description">从画面与文字中提取意象</span></div></div>
                    <div className="detail-timeline__moment detail-timeline__moment--last"><div className="detail-timeline__rail"><span className="detail-timeline__node" /></div><div className="detail-timeline__body"><strong className="detail-timeline__label poem-display">生成诗词</strong><span className="detail-timeline__description">让选定的意象在句间成形</span></div></div>
                  </div>
                </div>
              </article>
            </div>
          </div>

          {isPublic ? <button className={`detail-action detail-action--like ${publication.likedByMe ? 'detail-action--liked' : ''}`} onClick={() => void toggleLike()}>
            <span className="detail-like__summary"><span className="like-anchor"><img className={`heart-icon ${showLikeBurst ? 'heart-icon--pop' : ''}`} src={publication.likedByMe ? '/assets/icons/heart-filled.png' : '/assets/icons/heart-outline.png'} alt="" />{showLikeBurst ? <span className="like-burst"><span className="like-burst__ring" />{[1, 2, 3, 4, 5, 6].map((index) => <span key={index} className={`like-burst__particle like-burst__particle--${index}`} />)}</span> : null}</span><span className="detail-like-count">{publication.likeCount}</span></span>
            <span className="detail-like__state">{publication.likedByMe ? '已点赞' : '点赞'}</span>
          </button> : null}

          <div className="detail-actions">
            <div className="detail-actions__secondary">
              <button className={`detail-action detail-action--save ${!publication.posterReady ? 'detail-action--disabled' : ''}`} disabled={!publication.posterReady} onClick={() => window.open(publication.posterUrl, '_blank')}><img className="detail-action__download-icon" src="/assets/icons/action-download.svg" alt="" /><span>保存到手机</span></button>
              <button className={`detail-action detail-action--share ${!isPublic ? 'detail-action--disabled' : ''}`} disabled={!isPublic} onClick={pendingWechatCapability}><img src="/assets/icons/result-share.png" alt="" /><span>分享给好友</span></button>
            </div>
            {isPublic && !isOwner ? <button className={`detail-action detail-action--follow ${followedByMe ? 'detail-action--followed' : ''}`} onClick={() => void toggleFollow()}><img src="/assets/icons/action-follow.png" alt="" /><span>{followedByMe ? '已关注' : '关注作者'}</span></button> : null}
          </div>

          {isPublic ? <section className="detail-comments">
            <header className="detail-comments__header"><h2 className="detail-comments__title poem-display">评论</h2><span className="detail-comments__count">共 {publication.commentCount} 条</span></header>
            <div className={`detail-comment-composer ${replyingTo ? 'detail-comment-composer--focused' : ''}`}>
              {replyingTo ? <div className="detail-comment-composer__replying"><span>回复 {replyingTo.author.nickname}</span><button className="detail-comment-composer__cancel" onClick={() => setReplyingTo(null)}>取消</button></div> : null}
              <form className="detail-comment-composer__row" onSubmit={submitComment}><textarea className="detail-comment-composer__input poem-display" value={commentDraft} maxLength={300} placeholder={replyingTo ? `回复 ${replyingTo.author.nickname}…` : '写下此刻的感受…'} onFocus={() => { if (!user) setLoginAction('COMMENT') }} onChange={(event) => setCommentDraft(event.target.value)} /><button className={`detail-comment-composer__send ${!commentDraft.trim() || isSubmittingComment ? 'detail-comment-composer__send--disabled' : ''}`} disabled={!commentDraft.trim() || isSubmittingComment}>{isSubmittingComment ? '发送中' : '发送'}</button></form>
            </div>
            {commentsError ? <div className="detail-comments-state"><span className="detail-comments-state__text poem-display">{commentsError}</span><button className="detail-comments-state__action poem-display" onClick={() => void load()}>重新加载</button></div> : commentsLoaded && !comments.length ? <div className="detail-comments-state detail-comments-state--empty"><span className="detail-comments-state__text poem-display">还没有评论，写下第一句共鸣</span></div> : <div className="detail-comment-list">{comments.map((comment) => <article className="detail-comment-item" key={comment.id}><span className="detail-comment-item__avatar poem-display">{comment.author.avatarUrl ? <img src={comment.author.avatarUrl} alt="" /> : comment.author.nickname.slice(0, 1)}</span><div className="detail-comment-item__body"><div className="detail-comment-item__meta"><span className="detail-comment-item__identity"><strong className="detail-comment-item__name poem-display">{comment.author.nickname}</strong>{comment.isPublicationAuthor ? <span className="detail-comment-item__author-tag poem-display">作者</span> : null}</span><time className="detail-comment-item__time">{displayTime(comment.createdAt)}</time></div><p className="detail-comment-item__content poem-display">{comment.content}</p><div className="detail-comment-item__actions"><button className="detail-comment-item__action poem-display" onClick={() => setReplyingTo(comment)}>回复</button>{comment.canDelete ? <button className="detail-comment-item__action detail-comment-item__action--delete poem-display" onClick={() => setDeletingComment(comment)}>删除</button> : null}</div>{comment.replies?.length ? <div className="detail-comment-replies">{comment.replies.map((reply) => <div className="detail-comment-reply" key={reply.id}><p className="detail-comment-reply__line poem-display"><strong className="detail-comment-reply__name">{reply.author.nickname}</strong>{reply.replyToUser ? <span className="detail-comment-reply__target"> 回复 {reply.replyToUser.nickname}</span> : null}<span>：{reply.content}</span></p><div className="detail-comment-reply__meta"><time className="detail-comment-item__time">{displayTime(reply.createdAt)}</time><button className="detail-comment-item__action poem-display" onClick={() => setReplyingTo(reply)}>回复</button>{reply.canDelete ? <button className="detail-comment-item__action detail-comment-item__action--delete poem-display" onClick={() => setDeletingComment(reply)}>删除</button> : null}</div></div>)}</div> : null}</div></article>)}</div>}
          </section> : null}
        </div> : loading ? <div className="detail-empty poem-display">正在展开诗笺…</div> : notFound ? <div className="publication-unavailable"><img className="publication-unavailable__illustration" src="/assets/images/empty-works.jpg" alt="" /><h2 className="publication-unavailable__title poem-display">暂无作品</h2><p className="publication-unavailable__copy">这篇作品暂时无法查看</p><button className="publication-unavailable__action poem-display" onClick={() => navigate('/community')}>去诗词圈看看</button><img className="publication-unavailable__mountain" src="/assets/images/mountain-wash.jpg" alt="" /></div> : null}
      </main>

      <WechatDialog open={loginAction !== null} title="登录后继续" content="登录后可以评论、点赞、关注并同步互动状态。" confirmText="登录" onCancel={() => setLoginAction(null)} onConfirm={confirmLogin} />
      <WechatDialog open={deletingComment !== null} title="删除评论" content={deletingComment?.rootCommentId ? '确认删除这条回复吗？' : '该评论下的回复也会一并隐藏，确认删除吗？'} confirmText="删除" onCancel={() => setDeletingComment(null)} onConfirm={confirmDeleteComment} />
    </div>
  )
}
