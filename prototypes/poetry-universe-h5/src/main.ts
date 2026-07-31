import './style.css'
import { DYNASTY_NODES, LI_BAI_POEMS, TANG_POETS } from './data/mock'
import { PoetryUniverse } from './scene/PoetryUniverse'
import { detectQuality } from './scene/quality'
import type { MockPoem, UniverseNode, UniverseStage } from './types'

const $ = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`Missing element: ${selector}`)
  return element
}

const app = $('#app')
const universeSection = $('#universe')
const canvas = $<HTMLCanvasElement>('#universe-canvas')
const labelsRoot = $('#star-labels')
const chapterLabel = $('#chapter-label')
const stageCopy = $('#stage-copy')
const stageKicker = $('#stage-kicker')
const stageTitle = $('#stage-title')
const stageDescription = $('#stage-description')
const guideText = $('#guide-text')
const guideHint = $('#guide-hint')
const guide = $<HTMLElement>('.universe-guide')
const primaryAction = $<HTMLButtonElement>('#primary-action')
const primaryActionLabel = $('#primary-action-label')
const transitionCopy = $('#transition-copy')
const transitionTitle = $('#transition-title')
const transitionSubtitle = $('#transition-subtitle')
const poemSheet = $('#poem-sheet')
const poemTitle = $('#poem-title')
const poemContent = $('#poem-content')
const closePoem = $<HTMLButtonElement>('#close-poem')
const collapseAction = $<HTMLButtonElement>('#collapse-action')
const singularity = $('#singularity')
const creationHome = $('#creation-home')
const replayUniverse = $<HTMLButtonElement>('#replay-universe')
const unsupported = $('#unsupported')
const unsupportedContinue = $<HTMLButtonElement>('#unsupported-continue')

let universe: PoetryUniverse | undefined
let stage: UniverseStage = 'intro'
let activePoem: MockPoem | undefined
let actionLocked = false
const poemsById = new Map(LI_BAI_POEMS.map((poem) => [poem.id, poem]))

function poemToNode(poem: MockPoem): UniverseNode {
  return {
    id: poem.id,
    kind: 'work',
    name: poem.title,
    subtitle: poem.form,
    position: poem.position,
    color: poem.color,
    scale: poem.featured ? 3.5 : 2.55,
    featured: poem.featured,
  }
}

function setStageCopy(copy: {
  chapter: string
  kicker: string
  title: string
  description: string[]
  guide: string
  hint: string
  action?: string
}): void {
  chapterLabel.textContent = copy.chapter
  stageKicker.textContent = copy.kicker
  stageTitle.textContent = copy.title
  const descriptionNodes: Node[] = []
  copy.description.forEach((line, index) => {
    if (index > 0) descriptionNodes.push(document.createElement('br'))
    descriptionNodes.push(document.createTextNode(line))
  })
  stageDescription.replaceChildren(...descriptionNodes)
  guideText.textContent = copy.guide
  guideHint.textContent = copy.hint
  if (copy.action) primaryActionLabel.textContent = copy.action
  stageCopy.classList.remove('is-visible')
  window.setTimeout(() => stageCopy.classList.add('is-visible'), 100)
}

function showTransition(title: string, subtitle: string): void {
  transitionTitle.textContent = title
  transitionSubtitle.textContent = subtitle
  transitionCopy.classList.add('is-visible')
}

function hideTransition(): void {
  transitionCopy.classList.remove('is-visible')
}

async function awakenPoetryLight(): Promise<void> {
  if (!universe || actionLocked || stage !== 'intro') return
  actionLocked = true
  guide.classList.add('is-quiet')
  primaryAction.disabled = true
  stageCopy.classList.remove('is-visible')
  showTransition('诗光正在醒来', '镜头将环绕你，看见第一束尾迹')

  await universe.playAwakening()

  stage = 'awakened'
  universeSection.dataset.stage = stage
  hideTransition()
  setStageCopy({
    chapter: '序章 · 你已成为诗云中的一束光',
    kicker: '视角已开放',
    title: '现在，环顾你的宇宙',
    description: ['拖动屏幕，云海会从四面展开。', '你看向的每个方向，都不是同一张画。'],
    guide: '环顾之后，随诗光驶向群星',
    hint: '单指拖动环顾 360° · 双指缩放远近',
    action: '驶向群星',
  })
  guide.classList.remove('is-quiet')
  primaryAction.hidden = false
  primaryAction.disabled = false
  actionLocked = false
}

async function enterDynasties(): Promise<void> {
  if (!universe || actionLocked || stage !== 'awakened') return
  actionLocked = true
  guide.classList.add('is-quiet')
  primaryAction.disabled = true
  stageCopy.classList.remove('is-visible')
  showTransition('开始常规航行', '诗光正驶向千年云海')

  await universe.playDeparture(() => universe?.setNodes(DYNASTY_NODES, { reveal: false }))

  stage = 'dynasties'
  universeSection.dataset.stage = stage
  hideTransition()
  setStageCopy({
    chapter: '第一章 · 时间在前方聚成云',
    kicker: '千年诗脉',
    title: '群朝在远处呼吸',
    description: ['唐，是今夜最明亮的一片云。', '靠近它，群星便有了姓名。'],
    guide: '轻触「唐」，跟随诗光进入盛唐',
    hint: '拖动环顾 360°，其他朝代分布在不同方向',
  })
  guide.classList.remove('is-quiet')
  primaryAction.hidden = true
  actionLocked = false
}

async function enterTang(): Promise<void> {
  if (!universe || actionLocked || stage !== 'dynasties') return
  actionLocked = true
  stageCopy.classList.remove('is-visible')
  guide.classList.add('is-quiet')
  showTransition('正在穿越唐云', '前往李白星云')

  await universe.playTangDive(() => universe?.setNodes(TANG_POETS, { reveal: false }))

  stage = 'poets'
  universeSection.dataset.stage = stage
  hideTransition()
  setStageCopy({
    chapter: '第二章 · 盛唐的群星有了姓名',
    kicker: '唐云深处',
    title: '有人举杯，月光便亮了',
    description: ['杜甫、王维、白居易从云后浮现。', '而最亮的那颗星，正等你靠近。'],
    guide: '轻触「李白」，进入诗仙的星云',
    hint: '拖动环顾 360°，杜甫、王维与其他诗人在不同方位',
  })
  guide.classList.remove('is-quiet')
  actionLocked = false
}

async function enterLiBai(): Promise<void> {
  if (!universe || actionLocked || stage !== 'poets') return
  actionLocked = true
  stageCopy.classList.remove('is-visible')
  guide.classList.add('is-quiet')
  showTransition('正在靠近李白', '一颗星，展开为一座诗的宇宙')

  await universe.playLiBaiApproach(() => {
    universe?.setNodes(LI_BAI_POEMS.map(poemToNode), { reveal: false })
  })

  stage = 'works'
  universeSection.dataset.stage = stage
  hideTransition()
  setStageCopy({
    chapter: '第三章 · 一人自成宇宙',
    kicker: '李白星云',
    title: '每首诗，都是一颗仍在发光的星',
    description: ['从月下故乡，到黄河天上来。', '靠近一束光，听见它重新被写下。'],
    guide: '轻触任一诗作，展开诗笺',
    hint: '拖动环顾 360°，诗作环绕在李白星云各处',
  })
  guide.classList.remove('is-quiet')
  actionLocked = false
}

function openPoem(poem: MockPoem): void {
  if (!universe || stage !== 'works' || actionLocked) return
  activePoem = poem
  stage = 'poem'
  universeSection.dataset.stage = stage
  poemTitle.textContent = poem.title
  poemContent.replaceChildren(
    ...poem.lines.map((line) => {
      const paragraph = document.createElement('p')
      paragraph.textContent = line
      return paragraph
    }),
  )
  universe.hideNodes()
  universe.setExplorationEnabled(false)
  stageCopy.classList.remove('is-visible')
  guide.classList.add('is-quiet')
  poemSheet.classList.add('is-visible')
  poemSheet.setAttribute('aria-hidden', 'false')
}

function dismissPoem(): void {
  if (!universe || stage !== 'poem' || actionLocked) return
  activePoem = undefined
  stage = 'works'
  universeSection.dataset.stage = stage
  poemSheet.classList.remove('is-visible')
  poemSheet.setAttribute('aria-hidden', 'true')
  universe.setExplorationEnabled(true)
  universe.revealNodes()
  stageCopy.classList.add('is-visible')
  guide.classList.remove('is-quiet')
}

async function collapseUniverse(): Promise<void> {
  if (!universe || !activePoem || actionLocked || stage !== 'poem') return
  actionLocked = true
  stage = 'collapsing'
  universeSection.dataset.stage = stage
  poemSheet.classList.remove('is-visible')
  poemSheet.setAttribute('aria-hidden', 'true')
  showTransition('万千诗句，归于一念', '这一刻，将成为你自己的诗')
  transitionCopy.classList.add('is-collapse-copy')
  singularity.classList.add('is-visible')
  singularity.setAttribute('aria-hidden', 'false')
  app.classList.add('is-collapsing')

  await universe.collapseToSingularity(2300)
  app.classList.add('is-melting')
  await wait(1100)

  stage = 'home'
  universeSection.dataset.stage = stage
  universeSection.classList.add('is-hidden')
  universeSection.setAttribute('aria-hidden', 'true')
  creationHome.classList.add('is-visible')
  creationHome.setAttribute('aria-hidden', 'false')
  document.documentElement.style.colorScheme = 'light'
  actionLocked = false
}

function resetPrototype(): void {
  if (!universe || actionLocked) return
  stage = 'intro'
  activePoem = undefined
  universeSection.dataset.stage = stage
  document.documentElement.style.colorScheme = 'dark'
  app.classList.remove('is-collapsing', 'is-melting')
  universeSection.classList.remove('is-hidden')
  universeSection.setAttribute('aria-hidden', 'false')
  creationHome.classList.remove('is-visible')
  creationHome.setAttribute('aria-hidden', 'true')
  singularity.classList.remove('is-visible')
  singularity.setAttribute('aria-hidden', 'true')
  transitionCopy.classList.remove('is-visible', 'is-collapse-copy')
  poemSheet.classList.remove('is-visible')
  poemSheet.setAttribute('aria-hidden', 'true')
  guide.classList.remove('is-quiet')
  primaryAction.hidden = false
  primaryAction.disabled = false
  universe.reset()
  universe.setNodes([], { reveal: false })
  setStageCopy({
    chapter: '序章 · 光从一首诗里醒来',
    kicker: '一粒诗光',
    title: '从此刻醒来',
    description: ['你写下的每一个此刻，', '都曾在更早的星光里发生。'],
    guide: '你，就是这团即将醒来的诗光',
    hint: '先让镜头看见你，再把视角交还给你',
    action: '唤醒诗光',
  })
}

function showRegularHome(): void {
  universeSection.classList.add('is-hidden')
  universeSection.setAttribute('aria-hidden', 'true')
  creationHome.classList.add('is-visible')
  creationHome.setAttribute('aria-hidden', 'false')
  document.documentElement.style.colorScheme = 'light'
}

function onNodeSelected(node: UniverseNode): void {
  if (node.kind === 'dynasty') {
    if (node.id === 'tang') void enterTang()
    else nudgeUnavailable(node.name)
    return
  }
  if (node.kind === 'poet') {
    if (node.id === 'li-bai') void enterLiBai()
    else nudgeUnavailable(node.name)
    return
  }
  const poem = poemsById.get(node.id)
  if (poem) openPoem(poem)
}

function nudgeUnavailable(name: string): void {
  guideText.textContent = `${name}的星云将在完整版本开放，请沿高亮星体继续`
  guide.classList.add('is-nudging')
  window.setTimeout(() => guide.classList.remove('is-nudging'), 520)
}

function wait(duration: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, duration))
}

function canUseWebGL(): boolean {
  try {
    const testCanvas = document.createElement('canvas')
    return Boolean(testCanvas.getContext('webgl2') || testCanvas.getContext('webgl'))
  } catch {
    return false
  }
}

if (canUseWebGL()) {
  try {
    universe = new PoetryUniverse(canvas, labelsRoot, universeSection, detectQuality())
    universe.setNodeSelectionHandler(onNodeSelected)
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault()
      unsupported.hidden = false
    })
  } catch (error) {
    console.error('Poetry universe initialization failed', error)
    unsupported.hidden = false
  }
} else {
  unsupported.hidden = false
}

primaryAction.addEventListener('click', () => {
  if (stage === 'intro') {
    void awakenPoetryLight()
    return
  }
  if (stage === 'awakened') void enterDynasties()
})
closePoem.addEventListener('click', dismissPoem)
collapseAction.addEventListener('click', () => void collapseUniverse())
replayUniverse.addEventListener('click', resetPrototype)
unsupportedContinue.addEventListener('click', showRegularHome)

const debugShot = new URLSearchParams(window.location.search).get('shot')
if (debugShot === 'tang' && universe) {
  stageCopy.classList.remove('is-visible')
  guide.classList.add('is-quiet')
  showTransition('正在穿越唐云', '前往李白星云')
  universe.debugTangKeyframe()
}
if (debugShot === 'dynasties' && universe) {
  stageCopy.classList.remove('is-visible')
  guide.classList.add('is-quiet')
  universe.setNodes(DYNASTY_NODES)
  universe.debugStation('origin', [0, 3, -190], [19, 8, 24])
}
if (debugShot === 'poets' && universe) {
  stageCopy.classList.remove('is-visible')
  guide.classList.add('is-quiet')
  universe.setNodes(TANG_POETS)
  universe.debugStation('tang', [-34, 18, -510], [27, 12, 31])
}
if (debugShot === 'works' && universe) {
  stageCopy.classList.remove('is-visible')
  guide.classList.add('is-quiet')
  universe.setNodes(LI_BAI_POEMS.map(poemToNode))
  universe.debugStation('li-bai', [59, -5, -812], [32, 14, 36], [48, -8, -835])
}

Object.assign(window, {
  __POETRY_UNIVERSE_DEBUG__: {
    tang: () => {
      if (!universe) return
      stageCopy.classList.remove('is-visible')
      guide.classList.add('is-quiet')
      showTransition('正在穿越唐云', '前往李白星云')
      universe.debugTangKeyframe()
    },
    orbit: (yawDegrees: number, pitchDegrees?: number) => {
      universe?.debugOrbit(yawDegrees, pitchDegrees)
    },
    reset: resetPrototype,
  },
})

window.addEventListener('beforeunload', () => universe?.dispose())
