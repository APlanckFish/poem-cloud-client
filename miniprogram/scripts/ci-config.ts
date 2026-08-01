/**
 * miniprogram-ci 共享配置与工具
 *
 * 私钥与敏感配置只通过环境变量注入，不写入仓库。
 * 需要的环境变量：
 *   MP_APPID            小程序 AppID（缺省读取 project.config.json）
 *   MP_PRIVATE_KEY_PATH 上传私钥文件路径（与 MP_PRIVATE_KEY 二选一）
 *   MP_PRIVATE_KEY      上传私钥内容，适合 CI Secret 注入（优先级低于 PATH）
 *   MP_ROBOT            CI 机器人编号 1-30，缺省 1
 */
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

// miniprogram-ci 是 CommonJS 包，需以 require 方式加载才能拿到具名导出
const require = createRequire(import.meta.url)
const ci = require('miniprogram-ci')

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..')

export interface ProjectMeta {
  appid: string
  version: string
  desc: string
  robot: number
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
}

function resolveAppId(): string {
  const fromEnv = process.env.MP_APPID?.trim()
  if (fromEnv) return fromEnv
  const config = readJson<{ appid?: string }>(path.join(PROJECT_ROOT, 'project.config.json'))
  if (!config.appid) {
    throw new Error('未找到 AppID，请设置 MP_APPID 或在 project.config.json 中配置 appid')
  }
  return config.appid
}

/**
 * 解析私钥路径。若使用 MP_PRIVATE_KEY 注入内容，则写入进程私有临时文件，
 * 权限设为 0600，进程退出时删除，避免密钥落盘到仓库或被其他用户读取。
 */
function resolvePrivateKeyPath(): string {
  const keyPath = process.env.MP_PRIVATE_KEY_PATH?.trim()
  if (keyPath) {
    const absolute = path.isAbsolute(keyPath) ? keyPath : path.resolve(PROJECT_ROOT, keyPath)
    if (!fs.existsSync(absolute)) {
      throw new Error(`上传私钥文件不存在：${absolute}`)
    }
    return absolute
  }

  const keyContent = process.env.MP_PRIVATE_KEY
  if (!keyContent?.trim()) {
    throw new Error(
      '缺少上传私钥。请设置 MP_PRIVATE_KEY_PATH（私钥文件路径）或 MP_PRIVATE_KEY（私钥内容）',
    )
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poem-cloud-mp-'))
  const tempFile = path.join(tempDir, 'private.key')
  fs.writeFileSync(tempFile, keyContent, { mode: 0o600 })
  process.once('exit', () => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })
  return tempFile
}

function resolveRobot(): number {
  const raw = process.env.MP_ROBOT?.trim()
  if (!raw) return 1
  const robot = Number(raw)
  if (!Number.isInteger(robot) || robot < 1 || robot > 30) {
    throw new Error(`MP_ROBOT 必须是 1-30 的整数，当前值：${raw}`)
  }
  return robot
}

/** 从 CLI 参数解析 --key=value / --key value 形式的命名参数 */
export function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {}
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item?.startsWith('--')) continue
    const body = item.slice(2)
    const equalIndex = body.indexOf('=')
    if (equalIndex > 0) {
      args[body.slice(0, equalIndex)] = body.slice(equalIndex + 1)
      continue
    }
    const next = argv[index + 1]
    if (next && !next.startsWith('--')) {
      args[body] = next
      index += 1
    } else {
      args[body] = 'true'
    }
  }
  return args
}

export function resolveMeta(args: Record<string, string>): ProjectMeta {
  const packageJson = readJson<{ version?: string }>(path.join(PROJECT_ROOT, 'package.json'))
  return {
    appid: resolveAppId(),
    version: args.version ?? process.env.MP_VERSION ?? packageJson.version ?? '1.0.0',
    desc: args.desc ?? process.env.MP_DESC ?? `CI 上传 ${new Date().toLocaleString('zh-CN')}`,
    robot: args.robot ? Number(args.robot) : resolveRobot(),
  }
}

export function createProject(appid: string, projectPath = PROJECT_ROOT) {
  return new ci.Project({
    appid,
    type: 'miniProgram',
    projectPath,
    privateKeyPath: resolvePrivateKeyPath(),
    ignores: ['node_modules/**/*'],
  })
}

export interface PreparedProject {
  project: ReturnType<typeof createProject>
  cleanup: () => void
}

function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
  if (!diagnostic.file || diagnostic.start === undefined) return message
  const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
  const relativePath = path.relative(PROJECT_ROOT, diagnostic.file.fileName)
  return `${relativePath}:${position.line + 1}:${position.character + 1} ${message}`
}

function collectJavaScriptFiles(directory: string): string[] {
  const files: string[] = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...collectJavaScriptFiles(entryPath))
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(entryPath)
  }
  return files
}

/**
 * 微信 CI 的 TypeScript 插件会保留可选链等 ES2020 语法，但上传侧的语法
 * 校验器仍可能拒绝这些语法。上传前先在临时目录显式编译到 ES2017，再让
 * 微信 CI 只处理 JavaScript 和 Less，避免开发源码目录产生构建文件。
 */
export function createPreparedProject(appid: string): PreparedProject {
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'poem-cloud-mp-build-'))
  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    fs.rmSync(stagingRoot, { recursive: true, force: true })
  }

  try {
    fs.cpSync(PROJECT_ROOT, stagingRoot, {
      recursive: true,
      filter(source) {
        const relativePath = path.relative(PROJECT_ROOT, source)
        if (!relativePath) return true
        const topLevel = relativePath.split(path.sep)[0]
        if (['node_modules', 'scripts', 'typings', '.git', '.mp-ci'].includes(topLevel)) {
          return false
        }
        return !source.endsWith('.ts')
      },
    })

    const configPath = path.join(PROJECT_ROOT, 'tsconfig.json')
    const configResult = ts.readConfigFile(configPath, ts.sys.readFile)
    if (configResult.error) throw new Error(formatDiagnostic(configResult.error))
    const sourceRoot = path.join(PROJECT_ROOT, 'miniprogram')
    const outputRoot = path.join(stagingRoot, 'miniprogram')
    const parsedConfig = ts.parseJsonConfigFileContent(
      configResult.config,
      ts.sys,
      PROJECT_ROOT,
      {
        noEmit: false,
        sourceMap: false,
        inlineSourceMap: false,
        declaration: false,
        target: ts.ScriptTarget.ES2017,
        rootDir: sourceRoot,
        outDir: outputRoot,
      },
      configPath,
    )
    const sourceFiles = parsedConfig.fileNames.filter(
      (fileName) => fileName.startsWith(sourceRoot) && !fileName.endsWith('.d.ts'),
    )
    const program = ts.createProgram(parsedConfig.fileNames, parsedConfig.options)
    const emitResult = program.emit()
    const diagnostics = ts
      .getPreEmitDiagnostics(program)
      .concat(emitResult.diagnostics)
      .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    if (diagnostics.length > 0 || emitResult.emitSkipped) {
      throw new Error(`小程序兼容构建失败：\n${diagnostics.map(formatDiagnostic).join('\n')}`)
    }

    const incompatibleFiles = collectJavaScriptFiles(outputRoot).filter((fileName) => {
      const content = fs.readFileSync(fileName, 'utf8')
      return content.includes('?.') || content.includes('??')
    })
    if (incompatibleFiles.length > 0) {
      throw new Error(
        `兼容构建后仍包含可选链或空值合并语法：${incompatibleFiles
          .map((fileName) => path.relative(outputRoot, fileName))
          .join(', ')}`,
      )
    }

    const stagedConfigPath = path.join(stagingRoot, 'project.config.json')
    const stagedConfig = readJson<{
      setting?: { useCompilerPlugins?: string[] }
    }>(stagedConfigPath)
    if (stagedConfig.setting?.useCompilerPlugins) {
      stagedConfig.setting.useCompilerPlugins = stagedConfig.setting.useCompilerPlugins.filter(
        (plugin) => plugin !== 'typescript',
      )
    }
    fs.writeFileSync(stagedConfigPath, `${JSON.stringify(stagedConfig, null, 2)}\n`)

    console.log(`[mp-ci] 已生成 ES2017 兼容上传产物（${sourceFiles.length} 个 TypeScript 文件）`)
    process.once('exit', cleanup)
    return { project: createProject(appid, stagingRoot), cleanup }
  } catch (error) {
    cleanup()
    throw error
  }
}

/**
 * 是否跳过合法域名 / TLS / HTTPS 证书校验。
 *
 * 仅在域名尚未备案、需要用体验版连测试环境时开启：
 * 开启后上传的体验版必须在手机上「打开调试」才能跳过校验发起请求。
 * 正式版无论如何都会强制校验，务必在发布正式版时保持关闭。
 *
 * 用法：MP_SKIP_URL_CHECK=1 pnpm mp:upload
 */
function resolveSkipUrlCheck(): boolean {
  const raw = process.env.MP_SKIP_URL_CHECK?.trim().toLowerCase()
  return raw === '1' || raw === 'true'
}

/** 与微信开发者工具 project.config.json 对齐的编译设置 */
export function createCompileSettings() {
  const skipUrlCheck = resolveSkipUrlCheck()
  if (skipUrlCheck) {
    console.warn(
      '[mp-ci] 已开启 MP_SKIP_URL_CHECK：跳过合法域名校验，仅适用于体验版调试，请勿用于正式发布',
    )
  }
  return {
    es6: true,
    es7: true,
    minify: true,
    minifyJS: true,
    minifyWXML: true,
    minifyWXSS: true,
    codeProtect: false,
    autoPrefixWXSS: true,
    urlCheck: !skipUrlCheck,
  }
}

/** 编译进度回调的任务信息 */
export type ProgressTask = string | { status?: string; message?: string }

/** 统一的进度日志输出 */
export function createProgressLogger(prefix: string) {
  return (task: ProgressTask) => {
    if (typeof task === 'string') {
      console.log(`${prefix} ${task}`)
      return
    }
    const status = task.status === 'done' ? '完成' : task.status
    console.log(`${prefix} ${task.message ?? ''} ${status ?? ''}`.trim())
  }
}

export { ci, PROJECT_ROOT }
