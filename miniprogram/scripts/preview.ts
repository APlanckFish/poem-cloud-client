/**
 * 生成预览二维码，用于开发/测试阶段扫码体验。
 *
 * 用法：
 *   pnpm mp:preview
 *   pnpm mp:preview --page pages/feedback/index
 *   pnpm mp:preview --page pages/publication-detail/index --scene-query "id=123"
 */
import path from 'node:path'
import {
  ci,
  createCompileSettings,
  createPreparedProject,
  createProgressLogger,
  parseArgs,
  PROJECT_ROOT,
  resolveMeta,
} from './ci-config'

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const meta = resolveMeta(args)
  const prepared = createPreparedProject(meta.appid)
  const qrcodeOutputDest = path.resolve(
    PROJECT_ROOT,
    args.output ?? process.env.MP_PREVIEW_OUTPUT ?? '.mp-ci/preview.jpg',
  )

  console.log(`[mp:preview] appid=${meta.appid} robot=${meta.robot}`)
  if (args.page) {
    const query = args['scene-query'] ? `?${args['scene-query']}` : ''
    console.log(`[mp:preview] 指定页面 ${args.page}${query}`)
  }

  try {
    await ci.preview({
      project: prepared.project,
      version: meta.version,
      desc: meta.desc,
      robot: meta.robot,
      setting: createCompileSettings(),
      qrcodeFormat: 'image',
      qrcodeOutputDest,
      ...(args.page
        ? {
            pagePath: args.page,
            ...(args['scene-query'] ? { searchQuery: args['scene-query'] } : {}),
          }
        : {}),
      onProgressUpdate: createProgressLogger('[mp:preview]'),
    })
  } finally {
    prepared.cleanup()
  }

  console.log(`[mp:preview] 二维码已生成：${qrcodeOutputDest}`)
}

main().catch((error: unknown) => {
  console.error('[mp:preview] 预览失败：', error instanceof Error ? error.message : error)
  process.exit(1)
})
