import { useEffect, useRef } from 'react'

export function WechatDialog({
  open,
  title,
  content,
  cancelText = '取消',
  confirmText = '确定',
  showCancel = true,
  onCancel,
  onConfirm,
}: {
  open: boolean
  title: string
  content: string
  cancelText?: string
  confirmText?: string
  showCancel?: boolean
  onCancel: () => void
  onConfirm: () => void | Promise<void>
}) {
  const confirmRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (open) confirmRef.current?.focus()
  }, [open])
  if (!open) return null
  return (
    <div className="wechat-dialog-overlay" role="presentation">
      <section className="wechat-dialog" role="alertdialog" aria-modal="true" aria-labelledby="wechat-dialog-title" aria-describedby="wechat-dialog-content">
        <div className="wechat-dialog__body">
          <h2 id="wechat-dialog-title">{title}</h2>
          <p id="wechat-dialog-content">{content}</p>
        </div>
        <div className="wechat-dialog__actions">
          {showCancel ? <button onClick={onCancel}>{cancelText}</button> : null}
          <button ref={confirmRef} className="wechat-dialog__confirm" onClick={() => void onConfirm()}>{confirmText}</button>
        </div>
      </section>
    </div>
  )
}
