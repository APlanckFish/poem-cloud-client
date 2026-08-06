import { apiRequest, ensureInstallation } from './api'

export interface UploadedAsset {
  id: string
  kind: 'IMAGE' | 'VIDEO' | 'AVATAR'
  status: string
  accessUrl: string | null
  thumbnailUrl?: string | null
}

function uploadUrl(url: string): string {
  if (!import.meta.env.DEV || !import.meta.env.VITE_COS_PROXY_TARGET) return url
  const signed = new URL(url)
  const proxyTarget = new URL(import.meta.env.VITE_COS_PROXY_TARGET)
  if (signed.origin !== proxyTarget.origin) return url
  return `/cos-upload${signed.pathname}${signed.search}`
}

function readImageSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const url = URL.createObjectURL(file)
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight })
      URL.revokeObjectURL(url)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('无法读取图片信息'))
    }
    image.src = url
  })
}

function readVideoSize(file: File): Promise<{ width: number; height: number; durationMs: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    const url = URL.createObjectURL(file)
    video.onloadedmetadata = () => {
      resolve({
        width: video.videoWidth,
        height: video.videoHeight,
        durationMs: Math.round(video.duration * 1000),
      })
      URL.revokeObjectURL(url)
    }
    video.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('无法读取视频信息'))
    }
    video.src = url
  })
}

export async function uploadAsset(
  file: File,
  kind: 'IMAGE' | 'VIDEO' | 'AVATAR',
  purpose?: 'FEEDBACK',
): Promise<UploadedAsset> {
  await ensureInstallation()
  if (file.size > 200 * 1024 * 1024) throw new Error('素材文件不能超过200MB')
  const metadata = kind === 'VIDEO' ? await readVideoSize(file) : await readImageSize(file)
  if ('durationMs' in metadata && Number(metadata.durationMs) > 5_000) {
    throw new Error('请选择5秒以内的视频')
  }
  const intent = await apiRequest<{
    assetId: string
    upload: { url: string; headers: Record<string, string> }
  }>('/assets/upload-intents', {
    method: 'POST',
    body: {
      kind,
      fileName: file.name || `${kind.toLowerCase()}.${kind === 'VIDEO' ? 'mp4' : 'jpg'}`,
      contentType: file.type || (kind === 'VIDEO' ? 'video/mp4' : 'image/jpeg'),
      size: file.size,
      ...(purpose ? { purpose } : {}),
    },
  })
  const uploadResponse = await fetch(uploadUrl(intent.upload.url), {
    method: 'PUT',
    headers: intent.upload.headers,
    body: file,
  })
  if (!uploadResponse.ok) throw new Error(`素材上传失败（${uploadResponse.status}）`)
  return apiRequest<UploadedAsset>(`/assets/${intent.assetId}/complete`, {
    method: 'POST',
    body: metadata,
  })
}
