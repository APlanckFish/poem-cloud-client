import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const cdpUrl = process.env.CDP_URL
const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:4178'
const artifactDirectory = new URL('../artifacts/', import.meta.url)
const defaultChromePath =
  process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : process.platform === 'win32'
      ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      : '/usr/bin/google-chrome'
const chromePath = process.env.CHROME_PATH ?? defaultChromePath

await mkdir(artifactDirectory, { recursive: true })

if (!cdpUrl && !existsSync(chromePath)) {
  throw new Error(`未找到 Chrome，请通过 CHROME_PATH 指定浏览器路径：${chromePath}`)
}

let previewProcess
if (!(await isReachable(appUrl))) {
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  previewProcess = spawn(command, ['preview', '--host', '127.0.0.1'], {
    cwd: new URL('../', import.meta.url),
    stdio: 'ignore',
  })
  process.on('exit', () => previewProcess?.kill())
  await waitForServer(appUrl)
}

const browser = cdpUrl
  ? await chromium.connectOverCDP(cdpUrl)
  : await chromium.launch({
      executablePath: chromePath,
      headless: true,
      args: ['--enable-unsafe-swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
    })
const context = browser.contexts()[0] ?? (await browser.newContext({ reducedMotion: 'reduce' }))
const page = await context.newPage()
const runtimeErrors = []
const stageSummaries = {}

page.on('pageerror', (error) => runtimeErrors.push(error.message))
page.on('console', (message) => {
  if (message.type() === 'error') runtimeErrors.push(message.text())
})
page.on('response', (response) => {
  if (response.status() >= 400) runtimeErrors.push(`${response.status()} ${response.url()}`)
})

await page.setViewportSize({ width: 390, height: 844 })
await page.goto(appUrl, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
await capture('01-intro')

await page.locator('#primary-action').click()
await page.locator('#universe[data-stage="awakened"]').waitFor({ timeout: 6_000 })
await page.waitForTimeout(350)
await capture('02-third-person-meteor-reveal')
const orbitHashes = []
for (const yaw of [0, 90, 180, 270]) {
  await page.evaluate((degrees) => window.__POETRY_UNIVERSE_DEBUG__.orbit(degrees, 78), yaw)
  await page.waitForTimeout(220)
  const name = `03-orbit-${yaw}`
  const screenshotPath = await capture(name)
  orbitHashes.push(createHash('sha256').update(await readFile(screenshotPath)).digest('hex'))
}

await page.locator('#primary-action').click()
await page.locator('.star-node--dynasty.is-on-screen').first().waitFor({ timeout: 10_000 })
await page.waitForTimeout(850)
stageSummaries.dynasties = await readNodeSummary('.star-node--dynasty')
await capture('04-dynasties')

await page.locator('.star-node--dynasty', { hasText: '唐' }).click({ force: true })
await page.waitForTimeout(1900)
await capture('05-tang-cloud-dive')
await page.locator('.star-node--poet.is-on-screen').first().waitFor({ timeout: 12_000 })
await page.waitForTimeout(850)
stageSummaries.poets = await readNodeSummary('.star-node--poet')
await capture('06-tang-poets')

await page.locator('.star-node--poet', { hasText: '李白' }).click({ force: true })
await page.waitForTimeout(1800)
await capture('07-li-bai-approach')
await page.locator('.star-node--work.is-on-screen').first().waitFor({ timeout: 10_000 })
await page.waitForTimeout(850)
stageSummaries.works = await readNodeSummary('.star-node--work')
await capture('08-li-bai-works')

await page.locator('.star-node--work.is-on-screen').first().click({ force: true })
await page.locator('#poem-sheet.is-visible').waitFor()
await capture('09-poem-sheet')

await page.locator('#collapse-action').click()
await page.waitForTimeout(1050)
await capture('10-singularity-collapse')
await page.locator('#creation-home.is-visible').waitFor({ timeout: 7_000 })
await page.waitForTimeout(500)
await capture('11-creation-home')

const result = {
  title: await page.title(),
  screenshots: 14,
  runtimeErrors,
  stageSummaries,
  orbitHashes,
  orbitDirectionsAreDistinct: new Set(orbitHashes).size === orbitHashes.length,
  navigationNodesVisible:
    stageSummaries.dynasties.some((node) => node.text?.startsWith('唐') && node.onScreen) &&
    stageSummaries.poets.some((node) => node.text?.startsWith('李白') && node.onScreen) &&
    stageSummaries.works.some((node) => node.onScreen),
  finalStageVisible: await page.locator('#creation-home.is-visible').isVisible(),
}

console.log(JSON.stringify(result, null, 2))
await page.close()
await browser.close()
previewProcess?.kill()

if (
  runtimeErrors.length > 0 ||
  !result.finalStageVisible ||
  !result.orbitDirectionsAreDistinct ||
  !result.navigationNodesVisible
) {
  process.exitCode = 1
}

async function capture(name) {
  const path = new URL(`${name}.png`, artifactDirectory).pathname
  await page.screenshot({
    path,
    type: 'png',
  })
  return path
}

async function readNodeSummary(selector) {
  return page.locator(selector).evaluateAll((nodes) =>
    nodes.map((node) => ({
      text: node.textContent?.trim(),
      onScreen: node.classList.contains('is-on-screen'),
      x: node.style.getPropertyValue('--screen-x'),
      y: node.style.getPropertyValue('--screen-y'),
    })),
  )
}

async function isReachable(url) {
  try {
    const response = await fetch(url)
    return response.ok
  } catch {
    return false
  }
}

async function waitForServer(url) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 8_000) {
    if (await isReachable(url)) return
    await new Promise((resolve) => setTimeout(resolve, 120))
  }
  throw new Error(`本地预览服务启动超时：${url}`)
}
