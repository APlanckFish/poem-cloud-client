import { type ChangeEvent, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MiniProgramHeader } from '../components/MiniProgramChrome'
import { apiRequest } from '../lib/api'
import { uploadAsset } from '../lib/uploads'
import { useAppStore } from '../store/app'
import type { User } from '../types'

const DEFAULT_SIGNATURE = '这个人很神秘，什么都没有留下'

export default function EditProfilePage() {
  const navigate = useNavigate()
  const user = useAppStore((state) => state.user)!
  const setUser = useAppStore((state) => state.setUser)
  const setToast = useAppStore((state) => state.setToast)
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl || '')
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [nickname, setNickname] = useState(user.nickname)
  const [signature, setSignature] = useState(user.signature?.trim() || DEFAULT_SIGNATURE)
  const [saving, setSaving] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  function chooseAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setAvatarFile(file)
    setAvatarUrl(URL.createObjectURL(file))
    event.target.value = ''
  }

  async function saveProfile() {
    if (saving) return
    const cleanNickname = nickname.trim()
    const cleanSignature = signature.trim() || DEFAULT_SIGNATURE
    if (!cleanNickname) {
      setToast('昵称不能为空')
      return
    }
    setSaving(true)
    try {
      let avatarAssetId = user.avatarAssetId
      if (avatarFile) avatarAssetId = (await uploadAsset(avatarFile, 'AVATAR')).id
      const updated = await apiRequest<User>('/me', {
        method: 'PATCH',
        body: { nickname: cleanNickname, signature: cleanSignature, avatarAssetId },
      })
      setUser({ ...updated, avatarUrl })
      setSignature(cleanSignature)
      setToast('修改已保存')
      window.setTimeout(() => navigate(-1), 450)
    } catch (error) {
      setToast(error instanceof Error ? error.message : '资料保存失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mp-page mp-edit-profile app-viewport edit-viewport">
      <MiniProgramHeader title="编辑资料" loading={saving} background="#fbfaf7" color="#161c19" />
      <main className="edit-scroll page-scroll">
        <div className="edit-page">
          <section className="profile-card">
            <button className="profile-row avatar-row" onClick={() => fileInput.current?.click()}><span className="row-label poem-display">头像</span><span className="avatar-preview">{avatarUrl ? <img src={avatarUrl} alt="" /> : <span className="poem-display">{nickname[0] || '云'}</span>}</span><span className="row-action poem-display">点击更换</span><img className="row-arrow" src="/assets/icons/common-chevron-right.svg" alt="" /></button>
            <input ref={fileInput} hidden type="file" accept="image/*" onChange={chooseAvatar} />
            <div className="profile-divider" />
            <label className="profile-row nickname-row"><span className="row-label poem-display">昵称</span><input className="row-input poem-display" maxLength={24} value={nickname} placeholder="请输入昵称" onChange={(event) => setNickname(event.target.value)} /><img className="row-arrow" src="/assets/icons/common-chevron-right.svg" alt="" /></label>
            <div className="profile-divider" />
            <label className="signature-row"><span className="signature-heading"><span className="row-label poem-display">个性签名</span><span className="signature-count">{signature.length}/30</span></span><textarea className="signature-input" maxLength={30} value={signature} placeholder="写一句话，让诗友认识你" onChange={(event) => setSignature(event.target.value)} /></label>
          </section>
          <p className="profile-note">头像、昵称和个性签名将展示在你的作品与诗词圈中</p>
        </div>
      </main>
      <footer className="save-dock"><button className={`save-button poem-display ${saving ? 'save-button--disabled' : ''}`} disabled={saving} onClick={() => void saveProfile()}>{saving ? '保存中…' : '保存修改'}</button></footer>
    </div>
  )
}
