/**
 * 上传小程序代码到微信后台，生成一个可在后台提交审核的版本。
 *
 * 用法：
 *   pnpm mp:upload
 *   pnpm mp:upload --version 1.2.0 --desc "修复反馈提交"
 *   pnpm mp:upload --robot 3
 */
import {
  ci,
  createCompileSettings,
  createPreparedProject,
  createProgressLogger,
  parseArgs,
  resolveMeta,
} from './ci-config'

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const meta = resolveMeta(args)
  const prepared = createPreparedProject(meta.appid)

  console.log(
    `[mp:upload] appid=${meta.appid} version=${meta.version} robot=${meta.robot}\n` +
      `[mp:upload] desc=${meta.desc}`,
  )

  try {
    const result = await ci.upload({
      project: prepared.project,
      version: meta.version,
      desc: meta.desc,
      robot: meta.robot,
      setting: createCompileSettings(),
      onProgressUpdate: createProgressLogger('[mp:upload]'),
    })

    const subPackages: Array<{ name: string; size: number }> = result.subPackageInfo ?? []
    for (const item of subPackages) {
      console.log(`[mp:upload] 包体积 ${item.name}: ${(item.size / 1024).toFixed(1)} KB`)
    }
    console.log('[mp:upload] 上传成功，请到微信后台「版本管理」提交审核')
  } finally {
    prepared.cleanup()
  }
}

main().catch((error: unknown) => {
  console.error('[mp:upload] 上传失败：', error instanceof Error ? error.message : error)
  process.exit(1)
})
