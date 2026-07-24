import { ApiError, request } from './api'
import { ensureInstallation } from './installation'

type ImageAssetKind = 'IMAGE' | 'AVATAR'
type AssetKind = ImageAssetKind | 'VIDEO'
export type AssetPurpose = 'FEEDBACK'

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024

interface UploadIntent {
  assetId: string
  upload: {
    method: 'PUT'
    url: string
    headers: Record<string, string>
    expiresAt: string
  }
}

export interface AssetResponse {
  id: string
  kind: string
  status: string
  fileName?: string
  contentType?: string
  size?: number
  width?: number | null
  height?: number | null
  durationMs?: number | null
  accessUrl: string | null
  thumbnailUrl?: string | null
}

interface UploadMetadata {
  width: number
  height: number
  durationMs?: number
  thumbnailAssetId?: string
}

function getFileInfo(filePath: string): Promise<WechatMiniprogram.WxGetFileInfoSuccessCallbackResult> {
  return new Promise((resolve, reject) => {
    wx.getFileInfo({
      filePath,
      success: resolve,
      fail(error) {
        reject(new ApiError(error.errMsg || '无法读取待上传文件', 'FILE_READ_FAILED'))
      },
    })
  })
}

function getImageInfo(
  filePath: string,
): Promise<WechatMiniprogram.GetImageInfoSuccessCallbackResult> {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({
      src: filePath,
      success: resolve,
      fail(error) {
        reject(new ApiError(error.errMsg || '无法读取图片信息', 'IMAGE_READ_FAILED'))
      },
    })
  })
}

function readFile(filePath: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      success(result) {
        if (typeof result.data === 'string') {
          reject(new ApiError('读取到的文件格式不正确', 'FILE_READ_FAILED'))
          return
        }
        resolve(result.data)
      },
      fail(error) {
        reject(new ApiError(error.errMsg || '无法读取待上传文件', 'FILE_READ_FAILED'))
      },
    })
  })
}

function imageFormat(type: string): { extension: string; contentType: string } {
  const normalized = type.trim().toLowerCase().replace(/^image\//, '')
  if (normalized === 'jpg' || normalized === 'jpeg') {
    return { extension: 'jpg', contentType: 'image/jpeg' }
  }
  if (normalized === 'png' || normalized === 'webp' || normalized === 'gif') {
    return { extension: normalized, contentType: `image/${normalized}` }
  }
  return { extension: 'jpg', contentType: 'image/jpeg' }
}

function videoFormat(filePath: string): { extension: string; contentType: string } {
  const pathWithoutQuery = filePath.split(/[?#]/, 1)[0]?.toLowerCase() ?? ''
  return pathWithoutQuery.endsWith('.mov')
    ? { extension: 'mov', contentType: 'video/quicktime' }
    : { extension: 'mp4', contentType: 'video/mp4' }
}

function putFile(url: string, headers: Record<string, string>, data: ArrayBuffer): Promise<void> {
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: 'PUT',
      header: headers,
      data,
      timeout: 60_000,
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve()
          return
        }
        reject(
          new ApiError(`COS 上传失败（${response.statusCode}）`, 'COS_UPLOAD_FAILED', response.statusCode),
        )
      },
      fail(error) {
        reject(new ApiError(error.errMsg || '无法连接到 COS', 'COS_UPLOAD_FAILED'))
      },
    })
  })
}

export async function uploadImageAsset(
  filePath: string,
  kind: ImageAssetKind,
  purpose?: AssetPurpose,
): Promise<AssetResponse> {
  const [file, image] = await Promise.all([getFileInfo(filePath), getImageInfo(filePath)])
  const format = imageFormat(image.type)
  return uploadAsset({
    filePath,
    kind,
    fileName: `${kind === 'AVATAR' ? 'avatar' : 'image'}.${format.extension}`,
    contentType: format.contentType,
    size: file.size,
    metadata: { width: image.width, height: image.height },
    purpose,
  })
}

export async function uploadVideoAsset(options: {
  filePath: string
  thumbnailFilePath?: string
  width: number
  height: number
  durationSeconds: number
}): Promise<AssetResponse> {
  const durationMs = Math.round(options.durationSeconds * 1000)
  if (durationMs > 15_000) {
    throw new ApiError('请选择15秒以内的视频', 'VIDEO_TOO_LONG')
  }
  let thumbnailAsset: AssetResponse | null = null
  if (options.thumbnailFilePath) {
    thumbnailAsset = await uploadImageAsset(options.thumbnailFilePath, 'IMAGE')
  }
  const file = await getFileInfo(options.filePath)
  const format = videoFormat(options.filePath)
  try {
    return await uploadAsset({
      filePath: options.filePath,
      kind: 'VIDEO',
      fileName: `video.${format.extension}`,
      contentType: format.contentType,
      size: file.size,
      metadata: {
        width: options.width,
        height: options.height,
        durationMs,
        ...(thumbnailAsset ? { thumbnailAssetId: thumbnailAsset.id } : {}),
      },
    })
  } catch (error) {
    if (thumbnailAsset) {
      void deleteAsset(thumbnailAsset.id).catch(() => undefined)
    }
    throw error
  }
}

async function uploadAsset(options: {
  filePath: string
  kind: AssetKind
  fileName: string
  contentType: string
  size: number
  metadata: UploadMetadata
  purpose?: AssetPurpose
}): Promise<AssetResponse> {
  if (options.size < 1 || options.size > MAX_UPLOAD_BYTES) {
    throw new ApiError('素材文件不能超过200MB', 'FILE_TOO_LARGE')
  }
  await ensureInstallation()
  const intent = await request<UploadIntent>({
    path: '/assets/upload-intents',
    method: 'POST',
    data: {
      kind: options.kind,
      fileName: options.fileName,
      contentType: options.contentType,
      size: options.size,
      ...(options.purpose ? { purpose: options.purpose } : {}),
    },
  })
  try {
    const bytes = await readFile(options.filePath)
    await putFile(intent.upload.url, intent.upload.headers, bytes)
    const asset = await request<AssetResponse>({
      path: `/assets/${intent.assetId}/complete`,
      method: 'POST',
      data: options.metadata,
    })
    if (asset.status !== 'READY') {
      throw new ApiError(
        asset.status === 'REJECTED' ? '素材不符合上传要求' : '素材尚未处理完成',
        'ASSET_NOT_READY',
      )
    }
    return asset
  } catch (error) {
    void deleteAsset(intent.assetId).catch(() => undefined)
    throw error
  }
}

export function deleteAsset(assetId: string): Promise<void> {
  return request<void>({ path: `/assets/${assetId}`, method: 'DELETE' })
}
