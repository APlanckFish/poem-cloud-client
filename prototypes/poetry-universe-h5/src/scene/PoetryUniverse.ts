import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import type { QualityProfile, UniverseNode } from '../types'

type EnvironmentName = 'origin' | 'tang' | 'li-bai'

type CinematicShot = {
  startedAt: number
  duration: number
  sample: (progress: number) => void
  resolve: () => void
}

type ClusterVisual = {
  root: THREE.Group
  starMaterial: THREE.ShaderMaterial
  nebulaVolumes: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>[]
  rotationSpeed: THREE.Vector3
  phase: number
  radius: number
}

type TrailLayer = {
  points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
  historyScale: number
  spread: number
  drift: number
  baseSize: number
  warpSize: number
  opacity: number
}

type LiBaiSystemVisual = {
  root: THREE.Group
  star: THREE.Group
  web: THREE.LineSegments<THREE.BufferGeometry, THREE.ShaderMaterial>
  dust: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
  orbitRings: THREE.LineLoop[]
}

type NodeVisual = {
  data: UniverseNode
  object: THREE.Group
  core: THREE.Mesh
  corona: THREE.Mesh
  label: HTMLButtonElement
  basePosition: THREE.Vector3
  anchor: THREE.Vector3
  phase: number
  orbitSpeed: number
}

type PoetryMeteor = {
  group: THREE.Group
  text: THREE.Mesh
  head: THREE.Mesh
  tails: THREE.Sprite[]
  basePosition: THREE.Vector3
  direction: THREE.Vector3
  phase: number
}

const VOID = new THREE.Color('#010406')
const STELLAR_WHITE = new THREE.Color('#fff8db')
const ION_BLUE = new THREE.Color('#7fc5ff')
const PLASMA_JADE = new THREE.Color('#5cc7aa')
const ANCIENT_GOLD = new THREE.Color('#ddb767')

const ORIGIN_CENTER = new THREE.Vector3(0, 0, 0)
const DYNASTY_CENTER = new THREE.Vector3(0, 3, -190)
const TANG_CENTER = new THREE.Vector3(-34, 18, -510)
// 诗人群的视觉中心（李白居中偏上），停泊相机对准此处
const TANG_POET_FOCUS = new THREE.Vector3(-34, 16, -517)
const LI_BAI_CENTER = new THREE.Vector3(48, -8, -835)
const LI_BAI_STATION = new THREE.Vector3(59, -5, -812)
// 作品页停泊焦点抬高，让李白主星落在画面下方，作品星系铺满上半屏
const LI_BAI_WORKS_FOCUS = new THREE.Vector3(48, 12, -835)

const FORWARD = new THREE.Vector3(0, 0, -1)
const WORLD_UP = new THREE.Vector3(0, 1, 0)
const TMP_A = new THREE.Vector3()
const TMP_B = new THREE.Vector3()
const TMP_C = new THREE.Vector3()
const TMP_QUATERNION = new THREE.Quaternion()
const TMP_MATRIX = new THREE.Matrix4()

const ENVIRONMENT_PATHS: Record<EnvironmentName, string[]> = {
  origin: cubePaths('origin'),
  tang: cubePaths('tang'),
  'li-bai': cubePaths('li-bai'),
}

const FLIGHT_PHRASES = [
  '关关雎鸠，在河之洲',
  '路漫漫其修远兮',
  '大风起兮云飞扬',
  '海内存知己',
  '长风破浪会有时',
  '明月松间照',
  '无边落木萧萧下',
  '大漠孤烟直',
  '春江潮水连海平',
  '醉后不知天在水',
  '人生如逆旅',
  '山重水复疑无路',
  '我见青山多妩媚',
  '一蓑烟雨任平生',
  '星垂平野阔',
  '云想衣裳花想容',
]

export class PoetryUniverse {
  readonly renderer: THREE.WebGLRenderer
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  readonly controls: OrbitControls
  readonly quality: QualityProfile
  readonly reducedMotion: boolean
  readonly ready: Promise<void>

  private readonly canvas: HTMLCanvasElement
  private readonly labelsRoot: HTMLElement
  private readonly universeRoot: HTMLElement
  private readonly composer: EffectComposer
  private readonly bloomPass: UnrealBloomPass
  private readonly world = new THREE.Group()
  private readonly nodeRoot = new THREE.Group()
  private readonly clusterRoot = new THREE.Group()
  private readonly traveler = new THREE.Group()
  private readonly travelerCore: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
  private readonly travelerCorona: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
  private readonly accretionDisk: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
  private readonly magneticArcs: THREE.Mesh[] = []
  private readonly skybox: THREE.Mesh<THREE.BoxGeometry, THREE.ShaderMaterial>
  private readonly skyboxTextures: Record<EnvironmentName, THREE.CubeTexture>
  private readonly skyboxUniforms: {
    uFrom: { value: THREE.CubeTexture }
    uTo: { value: THREE.CubeTexture }
    uBlend: { value: number }
    uExposure: { value: number }
    uYaw: { value: number }
  }
  private readonly particleTextures: {
    smoke: THREE.Texture
    flare: THREE.Texture
    glint: THREE.Texture
    spark: THREE.Texture
  }
  private readonly backgroundStars: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
  private readonly warpLines: THREE.LineSegments<THREE.BufferGeometry, THREE.ShaderMaterial>
  private readonly clusters: ClusterVisual[] = []
  private readonly trailRoot = new THREE.Group()
  private readonly trailLayers: TrailLayer[] = []
  private readonly trailHistory: THREE.Vector3[] = []
  private liBaiSystem!: LiBaiSystemVisual
  private readonly poetryMeteorRoot = new THREE.Group()
  private readonly poetryMeteors: PoetryMeteor[] = []
  private meteorGeometry?: THREE.BufferGeometry
  private readonly viewport = new THREE.Vector3()

  private currentEnvironment: EnvironmentName = 'origin'
  private environmentTarget: EnvironmentName = 'origin'
  private nodes: NodeVisual[] = []
  private shot?: CinematicShot
  private onSelect?: (node: UniverseNode) => void
  private frameHandle = 0
  private lastFrameAt = performance.now()
  private elapsed = 0
  private destroyed = false
  private warp = 0
  private collapse = 0
  private skyboxOrientation = 0
  private skyboxOrientationFrom = 0
  private skyboxOrientationTarget = 0
  private skyboxDrift = 0

  constructor(
    canvas: HTMLCanvasElement,
    labelsRoot: HTMLElement,
    universeRoot: HTMLElement,
    quality: QualityProfile,
  ) {
    this.canvas = canvas
    this.labelsRoot = labelsRoot
    this.universeRoot = universeRoot
    this.quality = quality
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    this.scene = new THREE.Scene()
    this.scene.background = VOID
    this.scene.fog = new THREE.FogExp2(VOID, 0.00125)

    this.camera = new THREE.PerspectiveCamera(56, 1, 0.1, 2600)
    this.camera.position.set(9, 4.2, 18)
    this.camera.lookAt(ORIGIN_CENTER)

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: quality.tier !== 'low',
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    })
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.15
    this.renderer.setClearColor(VOID, 1)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatio))

    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(1, 1),
      quality.tier === 'low' ? 0.42 : 0.56,
      0.62,
      0.72,
    )
    this.composer.addPass(this.bloomPass)
    this.composer.addPass(new OutputPass())

    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enablePan = false
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.055
    this.controls.rotateSpeed = 0.32
    this.controls.zoomSpeed = 0.48
    this.controls.minDistance = 10
    this.controls.maxDistance = 72
    this.controls.minPolarAngle = 0.06
    this.controls.maxPolarAngle = Math.PI - 0.06
    this.controls.target.copy(ORIGIN_CENTER)
    this.controls.enabled = false

    const loadingManager = new THREE.LoadingManager()
    this.ready = new Promise<void>((resolve) => {
      loadingManager.onLoad = () => resolve()
    })
    const textureLoader = new THREE.TextureLoader(loadingManager)
    const cubeTextureLoader = new THREE.CubeTextureLoader(loadingManager)
    const gltfLoader = new GLTFLoader(loadingManager)
    this.particleTextures = {
      smoke: textureLoader.load('/assets/universe-v6/particles/ion-smoke.webp'),
      flare: textureLoader.load('/assets/universe-v6/particles/core-flare.webp'),
      glint: textureLoader.load('/assets/universe-v6/particles/star-glint.webp'),
      spark: textureLoader.load('/assets/universe-v6/particles/plasma-spark.webp'),
    }
    Object.values(this.particleTextures).forEach((texture) => {
      texture.minFilter = THREE.LinearMipmapLinearFilter
      texture.magFilter = THREE.LinearFilter
      texture.generateMipmaps = true
      texture.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy())
    })
    this.skyboxTextures = {
      origin: cubeTextureLoader.load(ENVIRONMENT_PATHS.origin),
      tang: cubeTextureLoader.load(ENVIRONMENT_PATHS.tang),
      'li-bai': cubeTextureLoader.load(ENVIRONMENT_PATHS['li-bai']),
    }
    Object.values(this.skyboxTextures).forEach((texture) => {
      texture.colorSpace = THREE.SRGBColorSpace
    })

    const skyboxResult = createBlendSkybox(this.skyboxTextures.origin)
    this.skybox = skyboxResult.mesh
    this.skyboxUniforms = skyboxResult.uniforms

    const travelerResult = createNewbornStar(this.particleTextures.flare, quality, this.skyboxTextures.origin)
    this.travelerCore = travelerResult.core
    this.travelerCorona = travelerResult.corona
    this.accretionDisk = travelerResult.accretionDisk
    this.magneticArcs.push(...travelerResult.magneticArcs)
    this.traveler.add(
      travelerResult.core,
      travelerResult.corona,
      travelerResult.accretionDisk,
      ...travelerResult.magneticArcs,
    )

    this.backgroundStars = createBackgroundStarField(quality.backgroundStars * 2)
    this.warpLines = createWarpField(18)
    this.warpLines.visible = false

    this.createClusters()
    this.createTrail()
    this.createPoetryMeteors()
    gltfLoader.load(
      '/assets/universe-v5/models/bennu.glb',
      (gltf) => this.installMeteorGeometry(gltf.scene),
      undefined,
      (error) => console.error('Unable to load NASA Bennu geometry', error),
    )
    this.createLights()

    this.world.add(
      this.clusterRoot,
      this.backgroundStars,
      this.warpLines,
      this.trailRoot,
      this.poetryMeteorRoot,
      this.nodeRoot,
      this.traveler,
    )
    this.scene.add(this.skybox, this.world)

    this.reset()
    this.resize()
    window.addEventListener('resize', this.resize)
    this.frameHandle = requestAnimationFrame(this.render)
  }

  setNodeSelectionHandler(handler: (node: UniverseNode) => void): void {
    this.onSelect = handler
  }

  setExplorationEnabled(enabled: boolean): void {
    this.controls.enabled = enabled
    this.canvas.classList.toggle('is-interactive', enabled)
  }

  setNodes(nodes: UniverseNode[], options: { reveal?: boolean } = {}): void {
    this.clearNodes()
    const reveal = options.reveal ?? true
    const isLiBaiSystem = nodes.some((node) => node.kind === 'work')
    const liBaiWasVisible = this.liBaiSystem.root.visible
    this.liBaiSystem.root.visible = isLiBaiSystem
    this.liBaiSystem.root.userData.targetOpacity = isLiBaiSystem ? 1 : 0
    if (isLiBaiSystem && !liBaiWasVisible) this.liBaiSystem.root.scale.setScalar(0.04)

    nodes.forEach((node, index) => {
      const object = createNodeStar(node, this.quality)
      object.position.fromArray(node.position)
      object.scale.setScalar(reveal ? 1 : 0.025)
      object.userData.targetScale = 1
      this.nodeRoot.add(object)

      const core = object.getObjectByName('node-core')
      const corona = object.getObjectByName('node-corona')
      if (!(core instanceof THREE.Mesh) || !(corona instanceof THREE.Mesh)) {
        throw new Error(`Node star is incomplete: ${node.id}`)
      }

      const label = document.createElement('button')
      label.type = 'button'
      label.className = [
        'star-node',
        `star-node--${node.kind}`,
        node.featured ? 'is-featured' : '',
        reveal ? 'is-revealed' : '',
      ]
        .filter(Boolean)
        .join(' ')
      label.dataset.nodeId = node.id
      label.setAttribute('aria-label', node.subtitle ? `${node.name}，${node.subtitle}` : node.name)

      const name = document.createElement('strong')
      name.textContent = node.name
      label.appendChild(name)
      if (node.subtitle) {
        const subtitle = document.createElement('span')
        subtitle.textContent = node.subtitle
        label.appendChild(subtitle)
      }
      label.addEventListener('click', () => {
        if (this.shot || this.collapse > 0) return
        this.onSelect?.(node)
      })
      this.labelsRoot.appendChild(label)

      this.nodes.push({
        data: node,
        object,
        core,
        corona,
        label,
        basePosition: object.position.clone(),
        anchor: nodeAnchor(node.kind),
        phase: index * 1.47 + seededRandom(index + 17) * 2,
        orbitSpeed: (node.kind === 'work' ? 0.022 : node.kind === 'poet' ? 0.012 : 0.006) *
          (index % 2 === 0 ? 1 : -1),
      })
    })
  }

  revealNodes(): void {
    this.nodes.forEach((node, index) => {
      window.setTimeout(() => node.label.classList.add('is-revealed'), index * 105)
    })
  }

  hideNodes(): void {
    this.nodes.forEach((node) => node.label.classList.remove('is-revealed'))
  }

  async playAwakening(): Promise<void> {
    await this.ready
    this.prepareShot('awakening')
    const target = this.traveler.position.clone()
    const start = new THREE.Vector3(9, 4.2, 18)
    const end = new THREE.Vector3(-11.5, 5.2, 15.5)
    this.camera.position.copy(start)
    this.camera.lookAt(target)

    await this.runShot(5200, (progress) => {
      const eased = easeInOutCubic(progress)
      const angle = THREE.MathUtils.lerp(0.18, Math.PI * 1.18, eased)
      const radius = THREE.MathUtils.lerp(20.5, 18.6, eased)
      this.camera.position.set(
        target.x + Math.sin(angle) * radius,
        target.y + THREE.MathUtils.lerp(4.2, 5.2, progress),
        target.z + Math.cos(angle) * radius,
      )
      this.camera.lookAt(target)
      this.controls.target.copy(target)
      this.bloomPass.strength = THREE.MathUtils.lerp(0.22, 0.56, easeOutCubic(progress))
      this.skyboxUniforms.uExposure.value = THREE.MathUtils.lerp(0.42, 0.82, progress)
      this.traveler.scale.setScalar(THREE.MathUtils.lerp(0.72, 1, easeOutBack(progress)))
      if (progress > 0.78) {
        this.camera.position.lerp(end, smoothstep(0.78, 1, progress) * 0.16)
      }
    })

    this.camera.position.copy(end)
    this.controls.target.copy(target)
    this.camera.lookAt(target)
    this.finishShot('awakened')
  }

  async playDeparture(midpoint?: () => void): Promise<void> {
    const path = new THREE.CatmullRomCurve3([
      this.traveler.position.clone(),
      new THREE.Vector3(-18, 9, -48),
      new THREE.Vector3(24, -7, -112),
      DYNASTY_CENTER.clone(),
    ])
    await this.flyPath({
      name: 'departure',
      path,
      duration: 7600,
      environment: 'origin',
      midpoint,
      midpointAt: 0.64,
      poemDensity: 0.72,
    })
    this.finishShot('dynasties')
  }

  async playTangDive(midpoint?: () => void): Promise<void> {
    const path = new THREE.CatmullRomCurve3([
      this.traveler.position.clone(),
      new THREE.Vector3(-38, 26, -264),
      new THREE.Vector3(30, -16, -368),
      new THREE.Vector3(-54, 24, -448),
      TANG_CENTER.clone(),
    ])
    await this.flyPath({
      name: 'tang-dive',
      path,
      duration: 10800,
      environment: 'tang',
      midpoint,
      midpointAt: 0.61,
      poemDensity: 1,
      focusTarget: TANG_POET_FOCUS,
      standoff: 40,
      stationSideOffset: 0,
      stationUpOffset: 2.4,
    })
    this.finishShot('poets', TANG_POET_FOCUS)
  }

  async playLiBaiApproach(midpoint?: () => void): Promise<void> {
    const path = new THREE.CatmullRomCurve3([
      this.traveler.position.clone(),
      new THREE.Vector3(-10, 34, -586),
      new THREE.Vector3(66, -24, -684),
      new THREE.Vector3(16, 18, -760),
      LI_BAI_STATION.clone(),
    ])
    await this.flyPath({
      name: 'li-bai',
      path,
      duration: 9400,
      environment: 'li-bai',
      midpoint,
      midpointAt: 0.58,
      poemDensity: 0.9,
      focusTarget: LI_BAI_WORKS_FOCUS,
      standoff: 62,
      stationSideOffset: 4,
      stationUpOffset: 14,
    })
    this.finishShot('works', LI_BAI_WORKS_FOCUS)
  }

  async collapseToSingularity(duration = 2300): Promise<void> {
    this.prepareShot('collapse')
    const travelerStart = this.traveler.position.clone()
    const cameraStart = this.camera.position.clone()
    await this.runShot(duration, (progress) => {
      this.collapse = easeInExpo(progress)
      this.traveler.position.lerpVectors(travelerStart, this.controls.target, this.collapse)
      this.traveler.scale.setScalar(1 - this.collapse * 0.94)
      this.trailRoot.scale.setScalar(1 - this.collapse * 0.88)
      this.nodeRoot.scale.setScalar(1 - this.collapse * 0.94)
      this.clusterRoot.scale.setScalar(1 - this.collapse * 0.8)
      this.camera.position.lerpVectors(cameraStart, this.controls.target, this.collapse * 0.72)
      this.camera.lookAt(this.controls.target)
      this.skyboxUniforms.uExposure.value = 0.82 + this.collapse * 2.2
      this.bloomPass.strength = 0.56 + this.collapse * 1.2
    })
  }

  debugTangKeyframe(): void {
    this.shot = undefined
    this.clearNodes()
    this.traveler.position.set(-12, 11, -350)
    this.resetTrailHistory(this.traveler.position)
    this.camera.position.set(-4, 16, -326)
    this.controls.target.set(-18, 8, -380)
    this.camera.lookAt(this.controls.target)
    this.warp = 0.86
    this.warpLines.visible = false
    this.poetryMeteorRoot.visible = true
    this.setEnvironmentImmediate('tang')
    this.skyboxUniforms.uExposure.value = 0.82
    this.universeRoot.dataset.cinematic = 'tang-keyframe'
  }

  debugStation(
    environment: EnvironmentName,
    position: [number, number, number],
    cameraOffset: [number, number, number],
    focus?: [number, number, number],
  ): void {
    this.shot = undefined
    this.traveler.position.fromArray(position)
    this.traveler.scale.setScalar(0.54)
    this.resetTrailHistory(this.traveler.position)
    this.camera.position.copy(this.traveler.position).add(new THREE.Vector3().fromArray(cameraOffset))
    this.controls.target.copy(focus ? new THREE.Vector3().fromArray(focus) : this.traveler.position)
    this.camera.up.copy(WORLD_UP)
    this.camera.fov = 56
    this.camera.updateProjectionMatrix()
    this.camera.lookAt(this.controls.target)
    this.warp = 0
    this.poetryMeteorRoot.visible = false
    this.setEnvironmentImmediate(environment)
    this.skyboxUniforms.uExposure.value = 0.82
    this.controls.enabled = true
    this.universeRoot.dataset.cinematic = `debug-${environment}`
  }

  debugOrbit(yawDegrees: number, pitchDegrees = 78): void {
    const target = this.controls.target
    const distance = this.camera.position.distanceTo(target)
    const spherical = new THREE.Spherical(
      distance,
      THREE.MathUtils.degToRad(pitchDegrees),
      THREE.MathUtils.degToRad(yawDegrees),
    )
    this.camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(spherical))
    this.camera.lookAt(target)
    this.controls.update()
  }

  reset(): void {
    this.shot = undefined
    this.warp = 0
    this.collapse = 0
    this.elapsed = 0
    this.skyboxDrift = 0
    this.world.scale.setScalar(1)
    this.clusterRoot.scale.setScalar(1)
    this.nodeRoot.scale.setScalar(1)
    this.trailRoot.scale.setScalar(1)
    this.traveler.position.copy(ORIGIN_CENTER)
    this.traveler.rotation.set(0, 0, 0)
    this.traveler.scale.setScalar(0.72)
    this.camera.position.set(9, 4.2, 18)
    this.camera.fov = 56
    this.camera.up.copy(WORLD_UP)
    this.camera.updateProjectionMatrix()
    this.controls.target.copy(ORIGIN_CENTER)
    this.controls.enabled = false
    this.controls.update()
    this.camera.lookAt(ORIGIN_CENTER)
    this.warpLines.visible = false
    this.poetryMeteorRoot.visible = false
    this.liBaiSystem.root.visible = false
    this.liBaiSystem.root.userData.targetOpacity = 0
    this.skyboxUniforms.uExposure.value = 0.42
    this.bloomPass.strength = 0.22
    this.setEnvironmentImmediate('origin')
    this.resetTrailHistory(ORIGIN_CENTER)
    this.universeRoot.dataset.cinematic = 'intro'
  }

  dispose(): void {
    this.destroyed = true
    cancelAnimationFrame(this.frameHandle)
    window.removeEventListener('resize', this.resize)
    this.clearNodes()
    this.controls.dispose()
    this.composer.dispose()
    Object.values(this.particleTextures).forEach((texture) => texture.dispose())
    this.meteorGeometry?.dispose()
    Object.values(this.skyboxTextures).forEach((texture) => texture.dispose())
    this.scene.traverse((object) => {
      if (
        !(
          object instanceof THREE.Mesh ||
          object instanceof THREE.Points ||
          object instanceof THREE.Line ||
          object instanceof THREE.LineSegments ||
          object instanceof THREE.Sprite
        )
      ) {
        return
      }
      object.geometry?.dispose()
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      materials.forEach((material) => material.dispose())
    })
    this.renderer.dispose()
  }

  private createClusters(): void {
    this.clusters.push(
      this.createCluster({
        center: DYNASTY_CENTER,
        radius: 54,
        count: this.quality.tier === 'low' ? 2200 : 5200,
        colors: ['#e9c46f', '#8ee1c8', '#fff0bd'],
        phase: 0.3,
        opacity: 0.72,
        featured: true,
      }),
      this.createCluster({
        center: TANG_CENTER,
        radius: 138,
        count: this.quality.tier === 'low' ? 2500 : 6200,
        colors: ['#fff0b8', '#d69b4d', '#69d5b5'],
        phase: 2.1,
        opacity: 0.72,
        featured: true,
      }),
      this.createCluster({
        center: LI_BAI_CENTER,
        radius: 126,
        count: this.quality.tier === 'low' ? 2200 : 5200,
        colors: ['#dff5ef', '#7dbbd5', '#d6ac65'],
        phase: 4.2,
        opacity: 0.68,
        featured: false,
      }),
    )
    this.liBaiSystem = this.createLiBaiSystem()
    this.clusterRoot.add(this.liBaiSystem.root)

    this.createAmbientPoetry(
      TANG_CENTER,
      ['大漠孤烟直', '明月松间照', '江流天地外', '同是天涯沦落人', '无边落木萧萧下'],
      14,
      74,
    )
    this.createAmbientPoetry(
      LI_BAI_CENTER,
      ['黄河之水天上来', '举杯邀明月', '天生我材必有用', '飞流直下三千尺', '孤帆远影碧空尽'],
      18,
      68,
    )
  }

  private createCluster(config: {
    center: THREE.Vector3
    radius: number
    count: number
    colors: string[]
    phase: number
    opacity: number
    featured: boolean
  }): ClusterVisual {
    const root = new THREE.Group()
    root.position.copy(config.center)

    const positions = new Float32Array(config.count * 3)
    const colors = new Float32Array(config.count * 3)
    const sizes = new Float32Array(config.count)
    const phases = new Float32Array(config.count)
    const rng = mulberry32(Math.floor(config.phase * 1000) + config.count)
    const palette = config.colors.map((color) => new THREE.Color(color))

    for (let index = 0; index < config.count; index += 1) {
      const offset = index * 3
      const armCount = config.featured ? 5 : 4
      const arm = index % armCount
      const normalized = Math.pow(rng(), config.featured ? 0.78 : 0.68)
      const angle =
        normalized * Math.PI * (config.featured ? 7.4 : 5.4) +
        arm * ((Math.PI * 2) / armCount) +
        rng() * (config.featured ? 0.28 : 0.42)
      const radius = 4 + normalized * config.radius
      const vertical = (rng() - 0.5) * (config.featured ? 8 + radius * 0.1 : 12 + radius * 0.16)
      positions[offset] = Math.cos(angle) * radius + (rng() - 0.5) * (config.featured ? 4 : 7)
      positions[offset + 1] = vertical
      positions[offset + 2] = Math.sin(angle) * radius + (rng() - 0.5) * (config.featured ? 4 : 7)
      const color = palette[Math.floor(rng() * palette.length)]
      colors[offset] = color.r
      colors[offset + 1] = color.g
      colors[offset + 2] = color.b
      sizes[index] = (config.featured ? 0.68 : 0.45) + rng() ** 3 * (config.featured ? 4.6 : 2.8)
      phases[index] = rng() * Math.PI * 2
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1))
    const starMaterial = createClusterStarMaterial(config.opacity)
    const points = new THREE.Points(geometry, starMaterial)
    points.frustumCulled = false
    root.add(points)

    const nebulaVolumes: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>[] = []
    const volumeCount = this.quality.tier === 'low' ? 1 : config.featured ? 3 : 2
    for (let index = 0; index < volumeCount; index += 1) {
      const material = createVolumetricNebulaMaterial({
        colorA: config.colors[index % config.colors.length],
        colorB: config.colors[(index + 1) % config.colors.length],
        phase: config.phase + index * 3.17,
        steps: this.quality.tier === 'low' ? 18 : 30,
        density: (index === 0 ? 0.88 : 0.52) * (config.featured ? 1.16 : 1),
        emission: config.featured ? (index === 0 ? 1.28 : 0.72) : 0.54,
      })
      const volume = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), material)
      const volumeRadius = config.radius * (index === 0 ? 0.92 : 0.58)
      volume.scale.set(
        volumeRadius * (index === 0 ? 1.12 : 0.78),
        volumeRadius * (index === 0 ? 0.46 : 0.34),
        volumeRadius,
      )
      volume.position.set(
        (rng() - 0.5) * config.radius * (index === 0 ? 0.18 : 0.52),
        (rng() - 0.5) * config.radius * 0.16,
        (rng() - 0.5) * config.radius * (index === 0 ? 0.18 : 0.52),
      )
      volume.rotation.set(config.phase * 0.11, config.phase * 0.27 + index, config.phase * 0.08)
      root.add(volume)
      nebulaVolumes.push(volume)
    }

    if (config.featured) {
      const halo = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.particleTextures.flare,
          color: config.colors[0],
          transparent: true,
          opacity: 0.54,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      )
      halo.scale.setScalar(config.radius * 0.72)
      halo.renderOrder = 3
      halo.userData.baseOpacity = 0.54
      const nucleus = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.particleTextures.glint,
          color: '#fff5cf',
          transparent: true,
          opacity: 0.86,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      )
      nucleus.scale.setScalar(config.radius * 0.2)
      nucleus.renderOrder = 4
      nucleus.userData.baseOpacity = 0.86
      root.add(halo, nucleus)
    }

    const visual: ClusterVisual = {
      root,
      starMaterial,
      nebulaVolumes,
      rotationSpeed: new THREE.Vector3(0.00004, 0.00012 + config.phase * 0.00001, 0.00003),
      phase: config.phase,
      radius: config.radius,
    }
    this.clusterRoot.add(root)
    return visual
  }

  private createLiBaiSystem(): LiBaiSystemVisual {
    const root = new THREE.Group()
    root.position.copy(LI_BAI_CENTER)
    root.visible = false
    root.userData.targetOpacity = 0

    const star = createNodeStar(
      {
        id: 'li-bai-system-core',
        kind: 'poet',
        name: '李白',
        position: [0, 0, 0],
        color: '#fff0ba',
        scale: 6.4,
        featured: true,
      },
      this.quality,
    )
    star.scale.setScalar(1.0)
    root.add(star)

    const orbitRings: THREE.LineLoop[] = []
    const ringRadii = [15, 23, 33, 46, 62, 82, 106]
    ringRadii.forEach((radius, index) => {
      const points: THREE.Vector3[] = []
      const segments = 160
      for (let pointIndex = 0; pointIndex < segments; pointIndex += 1) {
        const angle = (pointIndex / segments) * Math.PI * 2
        points.push(
          new THREE.Vector3(
            Math.cos(angle) * radius,
            Math.sin(angle) * radius * (0.2 + (index % 3) * 0.055),
            Math.sin(angle) * radius,
          ),
        )
      }
      const geometry = new THREE.BufferGeometry().setFromPoints(points)
      const ring = new THREE.LineLoop(
        geometry,
        new THREE.LineBasicMaterial({
          color: index % 2 === 0 ? '#72d5bb' : '#e5bd68',
          transparent: true,
          opacity: 0.075,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      )
      ring.rotation.set(index * 0.21 - 0.34, index * 0.37, index * 0.13)
      root.add(ring)
      orbitRings.push(ring)
    })

    const webGeometry = createLiBaiWebGeometry(this.quality.tier === 'low' ? 120 : 320)
    const web = new THREE.LineSegments(webGeometry, createLiBaiWebMaterial())
    web.frustumCulled = false
    root.add(web)

    const dust = createLiBaiWorkDust(
      this.quality.tier === 'low' ? 1600 : 4800,
      this.particleTextures.glint,
    )
    root.add(dust)

    return { root, star, web, dust, orbitRings }
  }

  private createAmbientPoetry(
    center: THREE.Vector3,
    phrases: string[],
    count: number,
    radius: number,
  ): void {
    for (let index = 0; index < count; index += 1) {
      const phrase = phrases[index % phrases.length]
      const texture = createTextTexture(phrase, 1024, 128)
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        color: index % 3 === 0 ? '#d7b165' : '#88c9b3',
        transparent: true,
        opacity: 0.26,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      })
      const width = Math.max(8, phrase.length * 1.55)
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, 1.5), material)
      const angle = (index / count) * Math.PI * 2 + (index % 4) * 0.19
      const localRadius = radius + (index % 4) * 11
      mesh.position.set(
        center.x + Math.cos(angle) * localRadius,
        center.y + ((index * 17) % 42) - 21,
        center.z + Math.sin(angle) * localRadius,
      )
      mesh.lookAt(center)
      mesh.rotation.z += (index % 5 - 2) * 0.11
      mesh.userData.orbitCenter = center.clone()
      mesh.userData.orbitSpeed = (0.0004 + (index % 3) * 0.00018) * (index % 2 ? -1 : 1)
      this.clusterRoot.add(mesh)
    }
  }

  private createTrail(): void {
    const addLayer = (config: {
      count: number
      texture: THREE.Texture
      colorA: string
      colorB: string
      historyScale: number
      spread: number
      drift: number
      baseSize: number
      warpSize: number
      opacity: number
      soft: boolean
    }): void => {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(config.count * 3), 3))
      geometry.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(config.count), 1))
      geometry.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(config.count), 1))
      geometry.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(config.count), 1))
      const phase = geometry.getAttribute('aPhase') as THREE.BufferAttribute
      for (let index = 0; index < config.count; index += 1) phase.setX(index, seededRandom(index * 31 + config.count) * Math.PI * 2)
      const points = new THREE.Points(
        geometry,
        createTexturedTrailMaterial(
          config.texture,
          config.colorA,
          config.colorB,
          config.soft,
        ),
      )
      points.frustumCulled = false
      points.renderOrder = config.soft ? 1 : 2
      this.trailRoot.add(points)
      this.trailLayers.push({
        points,
        historyScale: config.historyScale,
        spread: config.spread,
        drift: config.drift,
        baseSize: config.baseSize,
        warpSize: config.warpSize,
        opacity: config.opacity,
      })
    }

    addLayer({
      count: this.quality.tier === 'low' ? 110 : 230,
      texture: this.particleTextures.smoke,
      colorA: '#2e8f87',
      colorB: '#8bc8bf',
      historyScale: 1,
      spread: 1.9,
      drift: 0.34,
      baseSize: 5.8,
      warpSize: 5.4,
      opacity: 0.2,
      soft: true,
    })
    addLayer({
      count: this.quality.tier === 'low' ? 220 : 520,
      texture: this.particleTextures.flare,
      colorA: '#8ef3d4',
      colorB: '#f5d486',
      historyScale: 0.63,
      spread: 0.8,
      drift: 0.62,
      baseSize: 1.35,
      warpSize: 2.2,
      opacity: 0.64,
      soft: false,
    })
    addLayer({
      count: this.quality.tier === 'low' ? 90 : 210,
      texture: this.particleTextures.spark,
      colorA: '#c2fff1',
      colorB: '#efbf65',
      historyScale: 0.82,
      spread: 1.3,
      drift: 1.08,
      baseSize: 0.82,
      warpSize: 1.75,
      opacity: 0.5,
      soft: false,
    })
  }

  private createPoetryMeteors(): void {
    for (let index = 0; index < 18; index += 1) {
      const phrase = FLIGHT_PHRASES[index % FLIGHT_PHRASES.length]
      const texture = createTextTexture(phrase, 1024, 144)
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        color: index % 4 === 0 ? '#f2ca75' : index % 4 === 1 ? '#77c9b0' : '#d8ecdf',
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
      const width = Math.max(8, phrase.length * 1.45)
      const text = new THREE.Mesh(new THREE.PlaneGeometry(width, 1.7), material)
      const group = new THREE.Group()
      text.position.set(-width * 0.66 - 4.6, index % 2 === 0 ? 1.35 : -1.35, 0)
      const head = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.5, 1),
        createCometMaterial(index),
      )
      head.scale.set(0.82, 0.56, 0.64)
      group.add(head, text)

      const tails: THREE.Sprite[] = []
      for (let tailIndex = 0; tailIndex < 7; tailIndex += 1) {
        const tail = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: tailIndex < 5 ? this.particleTextures.smoke : this.particleTextures.flare,
            color: tailIndex % 3 === 0 ? '#d8b465' : '#65c8b1',
            transparent: true,
            opacity: 0,
            depthWrite: false,
            blending: tailIndex < 5 ? THREE.NormalBlending : THREE.AdditiveBlending,
            toneMapped: false,
          }),
        )
        const progress = tailIndex / 6
        tail.position.set(
          -2.4 - progress * width * 1.36,
          Math.sin(tailIndex * 2.1) * (0.16 + progress * 0.52),
          Math.cos(tailIndex * 1.7) * progress * 0.32,
        )
        const tailSize = THREE.MathUtils.lerp(2.3, 5.6, progress)
        tail.scale.set(tailSize * 2.1, tailSize, 1)
        group.add(tail)
        tails.push(tail)
      }

      group.visible = false
      this.poetryMeteorRoot.add(group)
      this.poetryMeteors.push({
        group,
        text,
        head,
        tails,
        basePosition: new THREE.Vector3(),
        direction: FORWARD.clone(),
        phase: index * 0.91,
      })
    }
    this.poetryMeteorRoot.visible = false
  }

  private installMeteorGeometry(model: THREE.Object3D): void {
    model.updateMatrixWorld(true)
    let source: THREE.Mesh | undefined
    model.traverse((object) => {
      if (!source && object instanceof THREE.Mesh) source = object
    })
    if (!source) return

    const geometry = source.geometry.clone()
    geometry.applyMatrix4(source.matrixWorld)
    geometry.computeBoundingBox()
    const box = geometry.boundingBox
    if (!box) return
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    geometry.translate(-center.x, -center.y, -center.z)
    geometry.scale(1 / Math.max(size.x, size.y, size.z), 1 / Math.max(size.x, size.y, size.z), 1 / Math.max(size.x, size.y, size.z))
    geometry.rotateZ(Math.PI * 0.5)
    geometry.computeVertexNormals()
    this.meteorGeometry = geometry

    this.poetryMeteors.forEach((meteor) => {
      meteor.head.geometry.dispose()
      meteor.head.geometry = geometry
      meteor.head.scale.set(1.05, 0.72, 0.82)
    })
  }

  private createLights(): void {
    this.scene.add(new THREE.AmbientLight('#17382f', 0.9))
    const cool = new THREE.DirectionalLight('#b7e8dc', 1.4)
    cool.position.set(-5, 8, 12)
    this.scene.add(cool)
  }

  private async flyPath(config: {
    name: string
    path: THREE.CatmullRomCurve3
    duration: number
    environment: EnvironmentName
    midpoint?: () => void
    midpointAt: number
    poemDensity: number
    focusTarget?: THREE.Vector3
    standoff?: number
    stationSideOffset?: number
    stationUpOffset?: number
  }): Promise<void> {
    await this.ready
    this.prepareShot(config.name)
    this.beginEnvironmentTransition(config.environment)
    this.preparePoetryCorridor(config.path, config.poemDensity)
    this.warpLines.visible = false
    this.poetryMeteorRoot.visible = true
    let midpointFired = false
    const cameraLateral = new THREE.Vector3()
    const shotStartCamera = this.camera.position.clone()
    const shotStartTarget = this.controls.target.clone()
    const shotStartUp = this.camera.up.clone()
    const shotStartFov = this.camera.fov
    const shotStartTravelerScale = this.traveler.scale.x
    const stationTarget = config.path.getPointAt(1)
    const stationFocus = config.focusTarget?.clone() ?? stationTarget.clone()
    const stationTangent = config.path.getTangentAt(0.999).normalize()
    const stationSide = new THREE.Vector3().crossVectors(stationTangent, WORLD_UP).normalize()
    const stationUp = new THREE.Vector3().crossVectors(stationSide, stationTangent).normalize()
    const stationCamera = stationTarget
      .clone()
      .addScaledVector(stationTangent, -(config.standoff ?? 21))
      .addScaledVector(stationUp, config.stationUpOffset ?? 5.4)
      .addScaledVector(stationSide, config.stationSideOffset ?? 7.2)
    const flightCamera = new THREE.Vector3()
    const flightTarget = new THREE.Vector3()
    const flightUp = new THREE.Vector3()

    await this.runShot(config.duration, (progress) => {
      const travel = easeInOutSine(progress)
      const travelerPosition = config.path.getPointAt(travel)
      const tangent = config.path.getTangentAt(Math.min(0.999, travel)).normalize()
      const side = TMP_A.crossVectors(tangent, WORLD_UP).normalize()
      const up = TMP_B.crossVectors(side, tangent).normalize()
      const speedEnvelope = Math.sin(progress * Math.PI)
      const entryBlend = smoothstep(0, 0.13, progress)
      const exitBlend = smoothstep(0.82, 1, progress)

      this.traveler.position.copy(travelerPosition)
      const flightTravelerScale = THREE.MathUtils.lerp(0.54, 0.92, speedEnvelope)
      this.traveler.scale.setScalar(
        THREE.MathUtils.lerp(shotStartTravelerScale, flightTravelerScale, entryBlend),
      )
      TMP_QUATERNION.setFromUnitVectors(FORWARD, tangent)
      this.traveler.quaternion.slerp(TMP_QUATERNION, 0.13)

      cameraLateral
        .copy(side)
        .multiplyScalar(Math.sin(progress * Math.PI * 3.2) * 2.2 * speedEnvelope)
      flightCamera
        .copy(travelerPosition)
        .addScaledVector(tangent, -THREE.MathUtils.lerp(18, 25, speedEnvelope))
        .addScaledVector(up, THREE.MathUtils.lerp(5.6, 3.8, speedEnvelope))
        .addScaledVector(side, 8.8)
        .add(cameraLateral)
      flightTarget.copy(travelerPosition).addScaledVector(tangent, 28 + speedEnvelope * 24)
      flightUp.copy(up).lerp(WORLD_UP, 0.56).normalize()

      this.camera.position.lerpVectors(shotStartCamera, flightCamera, entryBlend)
      this.controls.target.lerpVectors(shotStartTarget, flightTarget, entryBlend)
      this.camera.up.copy(shotStartUp).lerp(flightUp, entryBlend).normalize()
      if (exitBlend > 0) {
        this.camera.position.lerp(stationCamera, exitBlend)
        this.controls.target.lerp(stationFocus, exitBlend)
        this.camera.up.lerp(WORLD_UP, exitBlend).normalize()
      }
      this.camera.lookAt(this.controls.target)

      this.warp = speedEnvelope
      const flightFov = 56 + speedEnvelope * 12
      this.camera.fov = THREE.MathUtils.lerp(shotStartFov, flightFov, entryBlend)
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, 56, exitBlend)
      this.camera.updateProjectionMatrix()
      this.updateEnvironmentTransition(smoothstep(0.13, 0.9, progress))
      this.skyboxUniforms.uExposure.value = 0.82 + speedEnvelope * 0.22

      const oldWorldFade = 1 - smoothstep(0.04, Math.min(0.42, config.midpointAt - 0.08), progress)
      const newWorldReveal = smoothstep(config.midpointAt, Math.min(0.94, config.midpointAt + 0.28), progress)
      this.nodeRoot.scale.setScalar(
        progress < config.midpointAt
          ? THREE.MathUtils.lerp(0.025, 1, oldWorldFade)
          : THREE.MathUtils.lerp(0.025, 1, newWorldReveal),
      )

      if (progress >= config.midpointAt && !midpointFired) {
        midpointFired = true
        config.midpoint?.()
      }
    })

    this.completeEnvironmentTransition()
    this.warp = 0
    this.warpLines.visible = false
    this.poetryMeteorRoot.visible = false
    this.camera.fov = 56
    this.nodeRoot.scale.setScalar(1)
    this.camera.up.copy(WORLD_UP)
    this.camera.updateProjectionMatrix()
    this.camera.position.copy(stationCamera)
    this.controls.target.copy(stationFocus)
    this.camera.lookAt(this.controls.target)
  }

  private preparePoetryCorridor(curve: THREE.CatmullRomCurve3, density: number): void {
    this.poetryMeteors.forEach((meteor, index) => {
      const progress = 0.08 + ((index * 0.071) % 0.86)
      const center = curve.getPointAt(progress)
      const tangent = curve.getTangentAt(progress).normalize()
      const side = TMP_A.crossVectors(tangent, WORLD_UP).normalize()
      const up = TMP_B.crossVectors(side, tangent).normalize()
      const lateral = ((index * 17) % 29) - 14
      const vertical = ((index * 11) % 21) - 10
      meteor.basePosition
        .copy(center)
        .addScaledVector(side, lateral * density)
        .addScaledVector(up, vertical * density)
      meteor.direction
        .copy(tangent)
        .multiplyScalar(0.72)
        .addScaledVector(side, (index % 2 === 0 ? 1 : -1) * (0.34 + (index % 5) * 0.055))
        .addScaledVector(up, ((index % 3) - 1) * 0.09)
        .normalize()
      meteor.group.position.copy(meteor.basePosition)
      meteor.group.visible = true
      ;(meteor.text.material as THREE.MeshBasicMaterial).opacity = 0
    })
  }

  private beginEnvironmentTransition(target: EnvironmentName): void {
    this.environmentTarget = target
    this.skyboxOrientationFrom = this.skyboxOrientation
    this.skyboxOrientationTarget = environmentRotation(target)
    this.skyboxUniforms.uFrom.value = this.skyboxTextures[this.currentEnvironment]
    this.skyboxUniforms.uTo.value = this.skyboxTextures[target]
    this.skyboxUniforms.uBlend.value = 0
  }

  private updateEnvironmentTransition(progress: number): void {
    const eased = easeInOutCubic(progress)
    this.skyboxUniforms.uBlend.value = eased
    this.skyboxOrientation = THREE.MathUtils.lerp(
      this.skyboxOrientationFrom,
      this.skyboxOrientationTarget,
      eased,
    )
  }

  private completeEnvironmentTransition(): void {
    this.currentEnvironment = this.environmentTarget
    this.skyboxOrientation = this.skyboxOrientationTarget
    this.skyboxUniforms.uFrom.value = this.skyboxTextures[this.currentEnvironment]
    this.skyboxUniforms.uTo.value = this.skyboxTextures[this.currentEnvironment]
    this.skyboxUniforms.uBlend.value = 0
  }

  private setEnvironmentImmediate(environment: EnvironmentName): void {
    this.currentEnvironment = environment
    this.environmentTarget = environment
    this.skyboxOrientation = environmentRotation(environment)
    this.skyboxOrientationFrom = this.skyboxOrientation
    this.skyboxOrientationTarget = this.skyboxOrientation
    this.skyboxUniforms.uFrom.value = this.skyboxTextures[environment]
    this.skyboxUniforms.uTo.value = this.skyboxTextures[environment]
    this.skyboxUniforms.uBlend.value = 0
  }

  private prepareShot(name: string): void {
    this.controls.enabled = false
    this.canvas.classList.remove('is-interactive')
    this.hideNodes()
    this.universeRoot.dataset.cinematic = name
  }

  private finishShot(name: string, focusTarget?: THREE.Vector3): void {
    this.universeRoot.dataset.cinematic = name
    this.controls.target.copy(focusTarget ?? this.traveler.position)
    this.controls.enabled = true
    this.canvas.classList.add('is-interactive')
    this.controls.update()
    this.revealNodes()
  }

  private runShot(duration: number, sample: (progress: number) => void): Promise<void> {
    if (this.shot) return Promise.resolve()
    return new Promise((resolve) => {
      this.shot = {
        startedAt: performance.now(),
        duration: this.reducedMotion ? Math.max(1200, duration * 0.34) : duration,
        sample,
        resolve,
      }
    })
  }

  private clearNodes(): void {
    this.nodes.forEach((node) => {
      node.label.remove()
      node.object.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Line) {
          object.geometry?.dispose()
          if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose())
          else object.material.dispose()
        }
      })
      this.nodeRoot.remove(node.object)
    })
    this.nodes = []
  }

  private resetTrailHistory(position: THREE.Vector3): void {
    this.trailHistory.length = 0
    for (let index = 0; index < 112; index += 1) {
      this.trailHistory.push(position.clone())
    }
  }

  private readonly resize = (): void => {
    const width = this.canvas.clientWidth || window.innerWidth
    const height = this.canvas.clientHeight || window.innerHeight
    this.camera.aspect = width / Math.max(1, height)
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height, false)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.pixelRatio))
    this.composer.setSize(width, height)
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.pixelRatio))
  }

  private readonly render = (timestamp: number): void => {
    if (this.destroyed) return
    this.frameHandle = requestAnimationFrame(this.render)
    const delta = Math.min(0.05, Math.max(0.001, (timestamp - this.lastFrameAt) / 1000))
    this.lastFrameAt = timestamp
    this.elapsed += delta

    if (this.shot) {
      const shot = this.shot
      const progress = THREE.MathUtils.clamp((performance.now() - shot.startedAt) / shot.duration, 0, 1)
      shot.sample(progress)
      if (progress >= 1) {
        this.shot = undefined
        shot.resolve()
      }
    }

    this.updateSkybox(delta)
    this.updateTraveler(delta)
    this.updateTrail(delta)
    this.updateClusters(delta)
    this.updatePoetryMeteors()
    this.updateNodes(delta)
    this.updateWarpField()
    if (!this.shot) this.controls.update()
    this.composer.render()
  }

  private updateSkybox(delta: number): void {
    this.skybox.position.copy(this.camera.position)
    this.skyboxDrift += delta * (0.004 + this.warp * 0.007)
    this.skyboxUniforms.uYaw.value = this.skyboxOrientation + this.skyboxDrift
    this.skybox.rotation.x = Math.sin(this.elapsed * 0.018) * 0.025
  }

  private updateTraveler(delta: number): void {
    const coreMaterial = this.travelerCore.material
    const coronaMaterial = this.travelerCorona.material
    coreMaterial.uniforms.uTime.value = this.elapsed
    coreMaterial.uniforms.uWarp.value = this.warp
    coronaMaterial.uniforms.uTime.value = this.elapsed
    coronaMaterial.uniforms.uWarp.value = this.warp
    this.travelerCore.rotation.z += delta * 0.045
    this.travelerCorona.rotation.z -= delta * 0.028
    this.accretionDisk.rotation.z += delta * 0.06
    this.accretionDisk.material.uniforms.uTime.value = this.elapsed
    this.accretionDisk.material.uniforms.uWarp.value = this.warp
    this.magneticArcs.forEach((arc, index) => {
      arc.rotation.x += delta * (0.05 + index * 0.012) * (index % 2 ? -1 : 1)
      arc.rotation.z += delta * (0.026 + index * 0.008)
      const material = arc.material as THREE.MeshBasicMaterial
      material.opacity = 0.045 + this.warp * 0.075 + Math.sin(this.elapsed * 0.8 + index) * 0.012
    })
  }

  private updateTrail(delta: number): void {
    const head = this.trailHistory[0]
    if (!head || head.distanceToSquared(this.traveler.position) > 0.0025) {
      this.trailHistory.unshift(this.traveler.position.clone())
      if (this.trailHistory.length > 112) this.trailHistory.pop()
    } else {
      this.trailHistory[0].copy(this.traveler.position)
      for (let index = 1; index < this.trailHistory.length; index += 1) {
        this.trailHistory[index].lerp(
          this.trailHistory[index - 1],
          Math.min(1, delta * (0.52 + index / this.trailHistory.length)),
        )
      }
    }

    this.trailLayers.forEach((layer, layerIndex) => {
      const particlePosition = layer.points.geometry.getAttribute('position') as THREE.BufferAttribute
      const particleSize = layer.points.geometry.getAttribute('aSize') as THREE.BufferAttribute
      const particleAlpha = layer.points.geometry.getAttribute('aAlpha') as THREE.BufferAttribute
      for (let index = 0; index < particlePosition.count; index += 1) {
        const scrambled = ((index * (37 + layerIndex * 14)) % particlePosition.count) / particlePosition.count
        const normalized = Math.pow(scrambled, layer.historyScale)
        const historyIndex = Math.min(
          this.trailHistory.length - 1,
          Math.floor(normalized * (this.trailHistory.length - 1)),
        )
        const source = this.trailHistory[historyIndex]
        const envelope = Math.sin(Math.min(1, normalized) * Math.PI)
        const spread =
          (0.04 + envelope * layer.spread + normalized * layer.spread * 0.34) *
          (1 + this.warp * 1.55)
        const phase =
          index * 2.399 +
          this.elapsed * (layer.drift + (index % 7) * 0.019) +
          layerIndex * 1.71
        particlePosition.setXYZ(
          index,
          source.x + Math.cos(phase) * spread,
          source.y + Math.sin(phase * 1.17) * spread * 0.66,
          source.z + Math.cos(phase * 0.73) * spread * 0.48,
        )
        const sizeNoise = 0.72 + seededRandom(index * 17 + layerIndex * 997) * 0.72
        particleSize.setX(index, (layer.baseSize + this.warp * layer.warpSize) * sizeNoise)
        const tailFade = Math.pow(1 - normalized, layerIndex === 0 ? 0.72 : 1.36)
        particleAlpha.setX(index, tailFade * layer.opacity * (0.64 + this.warp * 0.62))
      }
      particlePosition.needsUpdate = true
      particleSize.needsUpdate = true
      particleAlpha.needsUpdate = true
      layer.points.material.uniforms.uPixelRatio.value = Math.min(
        window.devicePixelRatio,
        this.quality.pixelRatio,
      )
      layer.points.material.uniforms.uTime.value = this.elapsed
    })
    this.trailRoot.rotation.y += delta * 0.0001
  }

  private updateClusters(delta: number): void {
    this.backgroundStars.material.uniforms.uTime.value = this.elapsed
    this.clusters.forEach((cluster) => {
      const clusterDistance = this.camera.position.distanceTo(cluster.root.position)
      const clusterInsideFade =
        0.001 +
        smoothstep(cluster.radius * 0.48, cluster.radius * 1.16, clusterDistance) * 0.999
      cluster.root.rotation.x += cluster.rotationSpeed.x * delta * 60
      cluster.root.rotation.y += cluster.rotationSpeed.y * delta * 60
      cluster.root.rotation.z += cluster.rotationSpeed.z * delta * 60
      cluster.starMaterial.uniforms.uTime.value = this.elapsed + cluster.phase
      cluster.nebulaVolumes.forEach((volume, index) => {
        volume.rotation.y += delta * (0.004 + index * 0.0018) * (index % 2 ? -1 : 1)
        volume.rotation.z += delta * (0.0014 + index * 0.0007)
        volume.material.uniforms.uTime.value = this.elapsed
        volume.material.uniforms.uCameraLocal.value.copy(this.camera.position)
        volume.worldToLocal(volume.material.uniforms.uCameraLocal.value)
        volume.material.uniforms.uInsideFade.value = clusterInsideFade
      })
      cluster.root.children.forEach((child) => {
        if (!(child instanceof THREE.Sprite)) return
        const baseOpacity = (child.userData.baseOpacity as number | undefined) ?? 0
        ;(child.material as THREE.SpriteMaterial).opacity =
          baseOpacity * (0.025 + clusterInsideFade * 0.975)
      })
    })

    if (this.liBaiSystem.root.visible) {
      const targetOpacity = (this.liBaiSystem.root.userData.targetOpacity as number | undefined) ?? 1
      const currentScale = this.liBaiSystem.root.scale.x
      this.liBaiSystem.root.scale.setScalar(
        THREE.MathUtils.lerp(currentScale, 1, Math.min(1, delta * 0.58)),
      )
      const webMaterial = this.liBaiSystem.web.material
      const dustMaterial = this.liBaiSystem.dust.material
      webMaterial.uniforms.uTime.value = this.elapsed
      dustMaterial.uniforms.uTime.value = this.elapsed
      webMaterial.uniforms.uOpacity.value = THREE.MathUtils.lerp(
        webMaterial.uniforms.uOpacity.value,
        targetOpacity,
        Math.min(1, delta * 0.82),
      )
      dustMaterial.uniforms.uOpacity.value = THREE.MathUtils.lerp(
        dustMaterial.uniforms.uOpacity.value,
        targetOpacity,
        Math.min(1, delta * 0.72),
      )
      this.liBaiSystem.star.traverse((object) => {
        if (!(object instanceof THREE.Mesh) || !(object.material instanceof THREE.ShaderMaterial)) return
        if (object.material.uniforms.uTime) object.material.uniforms.uTime.value = this.elapsed
      })
      this.liBaiSystem.orbitRings.forEach((ring, index) => {
        ring.rotation.z += delta * (0.0015 + index * 0.00024) * (index % 2 ? -1 : 1)
        ;(ring.material as THREE.LineBasicMaterial).opacity = THREE.MathUtils.lerp(
          (ring.material as THREE.LineBasicMaterial).opacity,
          0.055 + index * 0.006,
          Math.min(1, delta * 0.7),
        )
      })
    }

    this.clusterRoot.children.forEach((child) => {
      if (!(child instanceof THREE.Mesh) || !child.userData.orbitCenter) return
      const center = child.userData.orbitCenter as THREE.Vector3
      TMP_A.copy(child.position).sub(center)
      TMP_A.applyAxisAngle(WORLD_UP, (child.userData.orbitSpeed as number) * delta * 60)
      child.position.copy(center).add(TMP_A)
    })
  }

  private updatePoetryMeteors(): void {
    if (!this.poetryMeteorRoot.visible) return
    this.poetryMeteors.forEach((meteor) => {
      if (!meteor.group.visible) return
      meteor.group.position
        .copy(meteor.basePosition)
        .addScaledVector(meteor.direction, Math.sin(this.elapsed * 0.34 + meteor.phase) * 2.6)
      const cameraDirection = TMP_A.copy(this.camera.position).sub(meteor.group.position).normalize()
      const textNormal = TMP_B
        .copy(cameraDirection)
        .addScaledVector(meteor.direction, -cameraDirection.dot(meteor.direction))
        .normalize()
      const textUp = TMP_C.crossVectors(textNormal, meteor.direction).normalize()
      TMP_MATRIX.makeBasis(meteor.direction, textUp, textNormal)
      meteor.group.quaternion.setFromRotationMatrix(TMP_MATRIX)
      const distance = meteor.group.position.distanceTo(this.camera.position)
      const alpha =
        smoothstep(145, 72, distance) *
        smoothstep(5, 18, distance) *
        smoothstep(0.02, 0.22, this.warp) *
        (0.42 + this.warp * 0.34)
      ;(meteor.text.material as THREE.MeshBasicMaterial).opacity = alpha * 0.82
      meteor.group.scale.setScalar(0.72 + Math.min(1.5, distance / 110))
      meteor.tails.forEach((tail, tailIndex) => {
        const material = tail.material as THREE.SpriteMaterial
        material.opacity = alpha * (0.18 + (1 - tailIndex / meteor.tails.length) * 0.24)
        tail.material.rotation = Math.sin(this.elapsed * 0.16 + meteor.phase + tailIndex) * 0.16
      })
      const headMaterial = meteor.head.material as THREE.ShaderMaterial
      headMaterial.uniforms.uTime.value = this.elapsed + meteor.phase
      headMaterial.uniforms.uOpacity.value = alpha
    })
  }

  private updateNodes(delta: number): void {
    const width = this.canvas.clientWidth
    const height = this.canvas.clientHeight
    this.nodes.forEach((node) => {
      const targetScale = (node.object.userData.targetScale as number | undefined) ?? 1
      node.object.scale.setScalar(
        THREE.MathUtils.lerp(node.object.scale.x, targetScale, Math.min(1, delta * 1.16)),
      )
      TMP_A.copy(node.basePosition).sub(node.anchor)
      TMP_A.applyAxisAngle(WORLD_UP, node.orbitSpeed * delta)
      node.basePosition.copy(node.anchor).add(TMP_A)
      node.object.position.copy(node.basePosition)

      // 星芒面板始终朝向相机，恒星光芒才成立
      const glow = node.object.getObjectByName('star-glow')
      if (glow) glow.quaternion.copy(this.camera.quaternion)

      node.core.rotation.y += delta * (0.16 + Math.abs(node.orbitSpeed) * 2)
      node.corona.rotation.y -= delta * 0.07
      node.corona.rotation.z += delta * 0.03
      const coreMaterial = node.core.material as THREE.ShaderMaterial
      const coronaMaterial = node.corona.material as THREE.ShaderMaterial
      if (coreMaterial.uniforms.uTime) coreMaterial.uniforms.uTime.value = this.elapsed + node.phase
      if (coronaMaterial.uniforms.uTime) coronaMaterial.uniforms.uTime.value = this.elapsed + node.phase

      node.object.getWorldPosition(this.viewport)
      this.viewport.project(this.camera)
      const x = (this.viewport.x * 0.5 + 0.5) * width
      const y = (-this.viewport.y * 0.5 + 0.5) * height
      const visible =
        this.viewport.z > -1 &&
        this.viewport.z < 1 &&
        x > 34 &&
        x < width - 34 &&
        y > 84 &&
        y < height - 92 &&
        !this.shot &&
        node.label.classList.contains('is-revealed')

      node.label.style.setProperty('--screen-x', `${x}px`)
      node.label.style.setProperty('--screen-y', `${y}px`)
      node.label.classList.toggle('is-on-screen', visible)
      node.label.style.opacity = visible ? '1' : '0'
      node.label.style.pointerEvents = visible && this.controls.enabled ? 'auto' : 'none'
    })
  }

  private updateWarpField(): void {
    const material = this.warpLines.material
    material.uniforms.uTime.value = this.elapsed
    material.uniforms.uWarp.value = this.warp
    material.uniforms.uOpacity.value = this.warpLines.visible ? this.warp * 0.06 : 0
    this.warpLines.position.copy(this.camera.position)
    this.warpLines.quaternion.copy(this.camera.quaternion)
  }
}

function cubePaths(_environment: EnvironmentName): string[] {
  const folder = 'deep-stars'
  const root = `/assets/universe-v5/${folder}`
  const extension = 'jpg'
  return [
    `${root}/posx.${extension}`,
    `${root}/negx.${extension}`,
    `${root}/posy.${extension}`,
    `${root}/negy.${extension}`,
    `${root}/posz.${extension}`,
    `${root}/negz.${extension}`,
  ]
}

function environmentRotation(environment: EnvironmentName): number {
  if (environment === 'tang') return Math.PI * 0.5
  if (environment === 'li-bai') return -Math.PI * 0.22
  return 0
}

function createBlendSkybox(initial: THREE.CubeTexture): {
  mesh: THREE.Mesh<THREE.BoxGeometry, THREE.ShaderMaterial>
  uniforms: {
    uFrom: { value: THREE.CubeTexture }
    uTo: { value: THREE.CubeTexture }
    uBlend: { value: number }
    uExposure: { value: number }
    uYaw: { value: number }
  }
} {
  const uniforms = {
    uFrom: { value: initial },
    uTo: { value: initial },
    uBlend: { value: 0 },
    uExposure: { value: 0.42 },
    uYaw: { value: 0 },
  }
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      varying vec3 vDirection;
      void main() {
        vDirection = mat3(modelMatrix) * position;
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = clip.xyww;
      }
    `,
    fragmentShader: `
      uniform samplerCube uFrom;
      uniform samplerCube uTo;
      uniform float uBlend;
      uniform float uExposure;
      uniform float uYaw;
      varying vec3 vDirection;
      void main() {
        vec3 direction = normalize(vDirection);
        float yawSine = sin(uYaw);
        float yawCosine = cos(uYaw);
        direction.xz = mat2(yawCosine, -yawSine, yawSine, yawCosine) * direction.xz;
        vec3 fromColor = textureCube(uFrom, direction).rgb;
        vec3 toColor = textureCube(uTo, direction).rgb;
        float blend = smoothstep(0.0, 1.0, uBlend);
        vec3 color = mix(fromColor, toColor, blend);
        color *= uExposure;
        color = color / (color + vec3(0.42));
        gl_FragColor = vec4(color, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: false,
  })
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1800, 1800, 1800), material)
  mesh.frustumCulled = false
  mesh.renderOrder = -1000
  return { mesh, uniforms }
}

function createVolumetricNebulaMaterial(config: {
  colorA: string
  colorB: string
  phase: number
  steps: number
  density: number
  emission: number
}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    defines: {
      VOLUME_STEPS: Math.max(12, Math.floor(config.steps)),
    },
    uniforms: {
      uTime: { value: 0 },
      uPhase: { value: config.phase },
      uDensity: { value: config.density },
      uEmission: { value: config.emission },
      uInsideFade: { value: 1 },
      uColorA: { value: new THREE.Color(config.colorA) },
      uColorB: { value: new THREE.Color(config.colorB) },
      uCameraLocal: { value: new THREE.Vector3() },
    },
    vertexShader: `
      varying vec3 vLocalPosition;
      void main() {
        vLocalPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uPhase;
      uniform float uDensity;
      uniform float uEmission;
      uniform float uInsideFade;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform vec3 uCameraLocal;
      varying vec3 vLocalPosition;

      float hash31(vec3 p) {
        p = fract(p * 0.1031);
        p += dot(p, p.yzx + 33.33);
        return fract((p.x + p.y) * p.z);
      }

      float noise3(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mix(hash31(i), hash31(i + vec3(1,0,0)), f.x), mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),
          mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x), mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y),
          f.z
        );
      }

      float fbm(vec3 p) {
        float value = 0.0;
        float amplitude = 0.54;
        mat3 rotation = mat3(
          0.00, 0.80, 0.60,
         -0.80, 0.36,-0.48,
         -0.60,-0.48, 0.64
        );
        for (int octave = 0; octave < 4; octave++) {
          value += noise3(p) * amplitude;
          p = rotation * p * 2.03 + vec3(0.17, 0.11, 0.23);
          amplitude *= 0.48;
        }
        return value;
      }

      mat2 rotate2d(float angle) {
        float s = sin(angle);
        float c = cos(angle);
        return mat2(c, -s, s, c);
      }

      float nebulaDensity(vec3 p) {
        float radius = length(p);
        float envelope = 1.0 - smoothstep(0.46, 1.0, radius);
        float twist = (0.52 - radius) * 2.6 + uTime * 0.018 + uPhase;
        p.xz = rotate2d(twist) * p.xz;
        p += vec3(uTime * 0.010, -uTime * 0.006, uTime * 0.008);
        float broad = fbm(p * 2.15 + vec3(uPhase, 0.0, -uPhase));
        float filament = fbm(p * 5.4 - vec3(uTime * 0.018, 0.0, uTime * 0.011));
        float erosion = fbm(p * 9.2 + vec3(-uTime * 0.014, uPhase, uTime * 0.009));
        float planarRadius = length(p.xz);
        float angle = atan(p.z, p.x);
        float spiral = 0.5 + 0.5 * cos(angle * 3.0 - planarRadius * 11.0 + uTime * 0.025);
        spiral = pow(spiral, 4.2);
        float ribbon = 1.0 - smoothstep(0.08, 0.58, abs(p.y + sin(p.x * 3.2 + p.z * 2.1) * 0.11));
        float structure = broad * 0.62 + filament * 0.28 + spiral * 0.22 + ribbon * 0.08;
        float cloudBody = smoothstep(0.44, 0.77, structure);
        float fineVeins = smoothstep(0.52, 0.8, filament * 0.6 + erosion * 0.52 + spiral * 0.18);
        float brokenBody = cloudBody * smoothstep(0.34, 0.72, erosion + broad * 0.32);
        return mix(brokenBody, fineVeins, 0.58) * envelope;
      }

      void main() {
        vec3 rayOrigin = uCameraLocal;
        vec3 rayDirection = normalize(vLocalPosition - rayOrigin);
        float b = dot(rayOrigin, rayDirection);
        float c = dot(rayOrigin, rayOrigin) - 1.0;
        float h = b * b - c;
        if (h < 0.0) discard;
        h = sqrt(h);
        float nearDistance = max(0.0, -b - h);
        float farDistance = -b + h;
        if (farDistance <= nearDistance) discard;

        float stepLength = (farDistance - nearDistance) / float(VOLUME_STEPS);
        float jitter = hash31(vec3(gl_FragCoord.xy, uPhase)) * stepLength;
        float distanceAlongRay = nearDistance + jitter;
        vec4 accumulated = vec4(0.0);

        for (int stepIndex = 0; stepIndex < VOLUME_STEPS; stepIndex++) {
          vec3 samplePosition = rayOrigin + rayDirection * distanceAlongRay;
          float density = nebulaDensity(samplePosition);
          float heightMix = clamp(samplePosition.y * 0.75 + 0.5, 0.0, 1.0);
          vec3 sampleColor = mix(uColorA, uColorB, heightMix);
          float coreLight = exp(-length(samplePosition.xz) * 4.2) * exp(-abs(samplePosition.y) * 5.4);
          float forwardScatter = pow(max(0.0, dot(-rayDirection, normalize(vec3(0.18, 0.26, 1.0)))), 6.0);
          sampleColor *= 0.42 + density * (1.85 + uEmission * 0.6);
          sampleColor += mix(uColorB, vec3(1.0, 0.91, 0.68), 0.64) *
            (coreLight * (1.15 + uEmission * 1.5) + forwardScatter * density * 0.24);
          float sampleAlpha = density * uDensity * uInsideFade * stepLength * 1.72;
          accumulated.rgb += (1.0 - accumulated.a) * sampleColor * sampleAlpha;
          accumulated.a += (1.0 - accumulated.a) * sampleAlpha;
          distanceAlongRay += stepLength;
        }

        accumulated.rgb += mix(uColorA, uColorB, 0.5) * accumulated.a * (0.1 + uEmission * 0.12);
        if (accumulated.a < 0.008) discard;
        gl_FragColor = vec4(accumulated.rgb, accumulated.a * 0.94);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.BackSide,
    blending: THREE.NormalBlending,
    toneMapped: false,
  })
}

function createCometMaterial(index: number): THREE.ShaderMaterial {
  const tint = index % 4 === 0 ? '#f1cf82' : index % 4 === 1 ? '#77d0bc' : '#b9e7ee'
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uTint: { value: new THREE.Color(tint) },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vWorldPosition;
      varying vec3 vLocalPosition;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vLocalPosition = position;
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uOpacity;
      uniform vec3 uTint;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;
      varying vec3 vLocalPosition;
      void main() {
        vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
        float fresnel = pow(1.0 - max(0.0, dot(vNormal, viewDirection)), 2.6);
        float facets = 0.72 + 0.28 * sin(
          vLocalPosition.x * 19.0 +
          vLocalPosition.y * 13.0 -
          vLocalPosition.z * 17.0 +
          uTime * 0.22
        );
        float directional = max(0.12, dot(vNormal, normalize(vec3(-0.32, 0.74, 0.58))) * 0.52 + 0.48);
        vec3 rock = mix(uTint * 0.22, uTint * 0.78, facets * directional);
        vec3 color = rock + vec3(0.72, 0.91, 0.96) * fresnel * 0.58;
        gl_FragColor = vec4(color, uOpacity * (0.76 + fresnel * 0.24));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  })
}

function createNewbornStar(
  flare: THREE.Texture,
  quality: QualityProfile,
  envMap: THREE.CubeTexture,
): {
  core: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
  corona: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
  accretionDisk: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>
  magneticArcs: THREE.Mesh[]
} {
  const segments = quality.tier === 'low' ? 48 : 96
  const coreMaterial = createTravelerCoreMaterial(envMap)
  const core = new THREE.Mesh(createWaterdropGeometry(1.46, segments), coreMaterial)
  core.name = 'traveler-core'

  // 贴体薄晕：只在轮廓边缘发光的能量壳，不覆盖整颗主体
  const coronaMaterial = createCoronaMaterial('#9ff0d8', 0.5)
  const corona = new THREE.Mesh(
    createWaterdropGeometry(1.62, quality.tier === 'low' ? 32 : 60),
    coronaMaterial,
  )
  corona.name = 'traveler-corona'

  const accretionDisk = createAccretionDisk(quality.tier === 'low' ? 320 : 720, flare)
  const magneticArcs: THREE.Mesh[] = []
  return { core, corona, accretionDisk, magneticArcs }
}

function createWaterdropGeometry(radius: number, segments: number): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(radius, segments, Math.max(20, Math.floor(segments * 0.66)))
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index)
    const y = position.getY(index)
    const z = position.getZ(index)
    const normalizedZ = THREE.MathUtils.clamp(z / radius, -1, 1)
    const rearTaper =
      normalizedZ < -0.08
        ? 1
        : Math.pow(THREE.MathUtils.clamp((1 - normalizedZ) / 1.08, 0.028, 1), 0.92)
    const shoulder = 0.78 + Math.exp(-Math.pow((normalizedZ + 0.18) * 2.2, 2)) * 0.24
    position.setXYZ(
      index,
      x * rearTaper * shoulder * 0.82,
      y * rearTaper * shoulder * 0.82,
      z * 2.04 + radius * 0.28,
    )
  }
  position.needsUpdate = true
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

function createTravelerCoreMaterial(envMap: THREE.CubeTexture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uWarp: { value: 0 },
      uEnv: { value: envMap },
    },
    vertexShader: `
      uniform float uTime;
      uniform float uWarp;
      varying vec3 vNormal;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;
      varying vec3 vLocalPosition;

      void main() {
        vLocalPosition = position;
        // 极轻微的能量呼吸，保持水滴光洁的镜面轮廓，不做噪波起伏
        float breathe = sin(uTime * 1.1 + position.z * 1.6) * 0.012;
        vec3 displaced = position + normal * breathe;
        vec4 world = modelMatrix * vec4(displaced, 1.0);
        vWorldPosition = world.xyz;
        vNormal = normalize(normalMatrix * normal);
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform samplerCube uEnv;
      uniform float uTime;
      uniform float uWarp;
      varying vec3 vNormal;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;
      varying vec3 vLocalPosition;

      void main() {
        vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
        // 镜面反射星空环境——三体水滴的核心质感
        vec3 reflectDir = reflect(-viewDirection, normalize(vWorldNormal));
        vec3 envColor = textureCube(uEnv, reflectDir).rgb;

        // 菲涅尔边缘：视线越掠射越亮，勾出光洁水滴轮廓
        float fresnel = pow(1.0 - abs(dot(normalize(vNormal), viewDirection)), 3.0);

        // 头部（-z 前进方向，几何尖端）聚能核心
        float head = smoothstep(0.2, 1.6, -vLocalPosition.z);
        float nucleus = exp(-length(vLocalPosition.xy) * 1.9) * head;

        // 内部沿轴向流动的能量流线
        float stream = pow(0.5 + 0.5 * sin(
          -vLocalPosition.z * 6.0 - uTime * (2.2 + uWarp * 2.4) +
          atan(vLocalPosition.y, vLocalPosition.x) * 2.0
        ), 4.0);

        vec3 jade = vec3(0.24, 0.78, 0.62);
        vec3 moon = vec3(0.86, 0.92, 0.84);
        vec3 gold = vec3(0.92, 0.68, 0.28);

        // 玉色能量基底（自发光，读作"一束光"而非暗玻璃）+ 反射星空
        vec3 color = mix(jade * 0.9, moon * 1.15, fresnel);
        color += envColor * (0.4 + fresnel * 0.7);
        color += gold * nucleus * (1.4 + uWarp * 0.9);
        color += moon * stream * (0.3 + uWarp * 0.5) * head;
        color += jade * 0.35; // 通体柔和自发光

        float alpha = 0.8 + fresnel * 0.2 + nucleus * 0.3;
        gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
      }
    `,
    transparent: true,
    depthWrite: true,
    blending: THREE.NormalBlending,
    side: THREE.FrontSide,
    toneMapped: true,
  })
}

function createNodeStar(
  node: UniverseNode,
  quality: QualityProfile,
): THREE.Group {
  const root = new THREE.Group()
  const radius =
    node.kind === 'dynasty'
      ? node.scale * 0.32
      : node.kind === 'poet'
        ? node.scale * (node.featured ? 0.34 : 0.26)
        : node.scale * 0.16
  const segments = quality.tier === 'low' ? 20 : 36
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(radius, segments, Math.floor(segments * 0.66)),
    createProceduralStarMaterial(
      node.color,
      node.kind === 'poet' && node.featured ? 1.7 : node.featured ? 1.2 : node.kind === 'poet' ? 1.15 : 0.85,
    ),
  )
  core.name = 'node-core'
  const corona = new THREE.Mesh(
    new THREE.SphereGeometry(
      radius * 1.34,
      quality.tier === 'low' ? 18 : 30,
      quality.tier === 'low' ? 12 : 20,
    ),
    createCoronaMaterial(
      node.color,
      node.kind === 'dynasty' ? (node.featured ? 0.24 : 0.16) : node.featured ? 0.48 : 0.3,
    ),
  )
  corona.name = 'node-corona'
  root.add(core, corona)

  if (node.kind === 'work') {
    const orbit = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 2.1, Math.max(0.018, radius * 0.026), 6, 96),
      new THREE.MeshBasicMaterial({
        color: node.color,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    )
    orbit.rotation.set(Math.PI / 2.7, node.scale * 0.19, node.scale * 0.11)
    root.add(orbit)
  } else {
    createProminenceArcs(radius * 1.08, node.color, node.scale).forEach((arc) => root.add(arc))
    const glowSize =
      radius *
      (node.kind === 'poet'
        ? node.featured
          ? 11.0
          : 7.2
        : node.featured
          ? 9.4
          : 4.6)
    const glowOpacity =
      node.kind === 'poet' ? (node.featured ? 0.98 : 0.66) : node.featured ? 0.92 : 0.4
    const glow = createStarGlow(glowSize, node.color, glowOpacity)
    root.add(glow)
  }
  return root
}

function createStarGlow(size: number, color: string, opacity: number): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        vec2 p = vUv - 0.5;
        float radius = length(p);
        float halo = exp(-radius * 6.0);
        // 四向星芒：主十字更锐更长，读作真实恒星光芒
        float rays = pow(max(0.0, 1.0 - abs(p.x) * 34.0), 3.2) * exp(-abs(p.y) * 3.4);
        rays += pow(max(0.0, 1.0 - abs(p.y) * 44.0), 3.4) * exp(-abs(p.x) * 4.0);
        // 斜向次光刺
        vec2 d = vec2(p.x + p.y, p.x - p.y) * 0.7071;
        rays += 0.5 * pow(max(0.0, 1.0 - abs(d.x) * 66.0), 3.4) * exp(-abs(d.y) * 6.0);
        rays += 0.5 * pow(max(0.0, 1.0 - abs(d.y) * 66.0), 3.4) * exp(-abs(d.x) * 6.0);
        float alpha = (halo * 0.8 + rays * 0.7) * uOpacity;
        if (alpha < 0.006) discard;
        gl_FragColor = vec4(uColor * (0.9 + halo * 1.6 + rays * 0.8), alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  })
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material)
  glow.renderOrder = 4
  glow.name = 'star-glow'
  return glow
}

function createLiBaiWebGeometry(connectionCount: number): THREE.BufferGeometry {
  const segmentsPerThread = 6
  const positions = new Float32Array(connectionCount * segmentsPerThread * 6)
  const phases = new Float32Array(connectionCount * segmentsPerThread * 2)
  const rng = mulberry32(20240612)
  for (let index = 0; index < connectionCount; index += 1) {
    const shell = 15 + Math.pow(rng(), 0.66) * 98
    const angle = rng() * Math.PI * 2
    const latitude = (rng() - 0.5) * Math.PI * 0.58
    const endpoint = new THREE.Vector3(
      Math.cos(angle) * Math.cos(latitude) * shell,
      Math.sin(latitude) * shell * 0.54,
      Math.sin(angle) * Math.cos(latitude) * shell,
    )
    const startRadius = rng() < 0.72 ? 4 + rng() * 7 : shell * (0.35 + rng() * 0.35)
    const start = endpoint.clone().normalize().multiplyScalar(startRadius)
    if (rng() > 0.78) {
      const twist = (rng() - 0.5) * 1.7
      start.applyAxisAngle(WORLD_UP, twist)
    }
    const tangent = endpoint.clone().sub(start)
    const bend = new THREE.Vector3(-tangent.z, tangent.y * 0.2, tangent.x)
      .normalize()
      .multiplyScalar((rng() - 0.5) * shell * 0.34)
    const control = start.clone().lerp(endpoint, 0.48).add(bend)
    const curve = new THREE.QuadraticBezierCurve3(start, control, endpoint)
    const phase = rng() * Math.PI * 2
    for (let segment = 0; segment < segmentsPerThread; segment += 1) {
      const a = curve.getPoint(segment / segmentsPerThread)
      const b = curve.getPoint((segment + 1) / segmentsPerThread)
      const offset = (index * segmentsPerThread + segment) * 6
      const phaseOffset = (index * segmentsPerThread + segment) * 2
      positions.set([a.x, a.y, a.z, b.x, b.y, b.z], offset)
      phases[phaseOffset] = phase + segment * 0.28
      phases[phaseOffset + 1] = phase + segment * 0.28 + 0.22
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1))
  return geometry
}

function createLiBaiWebMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0 },
    },
    vertexShader: `
      attribute float aPhase;
      varying float vPulse;
      varying float vDistance;
      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        vPulse = 0.38 + 0.62 * pow(0.5 + 0.5 * sin(aPhase), 5.0);
        vDistance = clamp(length(position) / 88.0, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uOpacity;
      varying float vPulse;
      varying float vDistance;
      void main() {
        float shimmer = 0.58 + 0.42 * sin(uTime * 0.52 + vDistance * 18.0);
        vec3 color = mix(vec3(0.34, 0.82, 0.72), vec3(0.94, 0.72, 0.34), vDistance);
        gl_FragColor = vec4(color * (0.72 + vPulse), uOpacity * (0.08 + vPulse * 0.22) * shimmer);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
}

function createLiBaiWorkDust(
  count: number,
  texture: THREE.Texture,
): THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const positions = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  const phases = new Float32Array(count)
  const colors = new Float32Array(count * 3)
  const rng = mulberry32(701762)
  const jade = new THREE.Color('#86e4c8')
  const gold = new THREE.Color('#f2c66e')
  const white = new THREE.Color('#eefef8')
  for (let index = 0; index < count; index += 1) {
    const offset = index * 3
    const arm = index % 7
    const normalized = Math.pow(rng(), 0.72)
    const radius = 10 + normalized * 108
    const angle = normalized * Math.PI * 5.8 + arm * ((Math.PI * 2) / 7) + rng() * 0.38
    positions[offset] = Math.cos(angle) * radius + (rng() - 0.5) * 3.5
    positions[offset + 1] = (rng() - 0.5) * (4 + radius * 0.14)
    positions[offset + 2] = Math.sin(angle) * radius + (rng() - 0.5) * 3.5
    sizes[index] = 0.38 + rng() ** 4 * 2.8
    phases[index] = rng() * Math.PI * 2
    const color = index % 9 === 0 ? gold : index % 5 === 0 ? white : jade
    colors[offset] = color.r
    colors[offset + 1] = color.g
    colors[offset + 2] = color.b
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uTexture: { value: texture },
    },
    vertexShader: `
      uniform float uTime;
      attribute float aSize;
      attribute float aPhase;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec3 transformed = position;
        float angle = uTime * 0.009 * (0.65 + mod(aPhase, 1.2));
        transformed.xz = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * transformed.xz;
        vec4 viewPosition = modelViewMatrix * vec4(transformed, 1.0);
        gl_PointSize = aSize * clamp(138.0 / max(16.0, -viewPosition.z), 0.46, 4.2);
        gl_Position = projectionMatrix * viewPosition;
        vColor = color;
        vAlpha = 0.55 + 0.45 * sin(uTime * 0.7 + aPhase);
      }
    `,
    fragmentShader: `
      uniform sampler2D uTexture;
      uniform float uOpacity;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec4 sprite = texture2D(uTexture, gl_PointCoord);
        float alpha = sprite.a * vAlpha * uOpacity;
        if (alpha < 0.008) discard;
        gl_FragColor = vec4(vColor * (0.75 + sprite.rgb * 1.4), alpha);
      }
    `,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
  const dust = new THREE.Points(geometry, material)
  dust.frustumCulled = false
  return dust
}

function createProceduralStarMaterial(tint: string, intensity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTint: { value: new THREE.Color(tint) },
      uTime: { value: 0 },
      uWarp: { value: 0 },
      uIntensity: { value: intensity },
    },
    vertexShader: `
      uniform float uTime;
      uniform float uWarp;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;
      varying float vPulse;

      float hash(vec3 p) {
        p = fract(p * 0.3183099 + vec3(.13, .27, .51));
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }

      float noise(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
          mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
          f.z
        );
      }

      void main() {
        vPulse = noise(normal * 4.8 + vec3(uTime * 0.08, -uTime * 0.05, uTime * 0.03));
        float displacement = (vPulse - 0.5) * (0.16 + uWarp * 0.08);
        vec3 displaced = position + normal * displacement;
        vec4 world = modelMatrix * vec4(displaced, 1.0);
        vWorldPosition = world.xyz;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform vec3 uTint;
      uniform float uTime;
      uniform float uWarp;
      uniform float uIntensity;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;
      varying float vPulse;

      void main() {
        vec3 viewDir = normalize(cameraPosition - vWorldPosition);
        float fresnel = pow(1.0 - abs(dot(normalize(vNormal), viewDir)), 2.4);
        float lightFacing = max(0.18, dot(normalize(vNormal), normalize(vec3(-0.4, 0.7, 0.5))) * 0.5 + 0.62);
        float bands = pow(0.5 + 0.5 * sin(vPulse * 18.0 + uTime * 0.42), 2.4);
        vec3 whiteHot = mix(vec3(1.0, 0.91, 0.68), vec3(0.88, 1.0, 0.97), fresnel);
        vec3 plasma = mix(uTint * 0.62, whiteHot, 0.44 + bands * 0.28);
        plasma *= (0.64 + lightFacing * 0.34 + vPulse * 0.28) * uIntensity;
        plasma += uTint * fresnel * (0.34 + uWarp * 0.18);
        gl_FragColor = vec4(plasma, 1.0);
      }
    `,
    toneMapped: true,
  })
}

function createCoronaMaterial(color: string, opacity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uWarp: { value: 0 },
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
    },
    vertexShader: `
      uniform float uTime;
      uniform float uWarp;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;
      varying float vNoise;
      float hash(vec3 p) {
        p = fract(p * 0.3183099 + vec3(.11, .37, .61));
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }
      void main() {
        float grain = hash(normal * 8.0 + uTime * 0.06);
        float wave = sin(position.y * 6.0 + uTime * 0.8) * 0.5 + 0.5;
        vNoise = grain * 0.66 + wave * 0.34;
        vec3 displaced = position + normal * vNoise * (0.14 + uWarp * 0.12);
        vec4 world = modelMatrix * vec4(displaced, 1.0);
        vWorldPosition = world.xyz;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uWarp;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;
      varying float vNoise;
      void main() {
        vec3 viewDir = normalize(cameraPosition - vWorldPosition);
        float fresnel = pow(1.0 - abs(dot(normalize(vNormal), viewDir)), 4.6);
        float filament = smoothstep(0.58, 0.96, vNoise + fresnel * 0.22);
        float rim = smoothstep(0.18, 0.82, fresnel);
        float alpha = rim * filament * uOpacity * (0.38 + uWarp * 0.22);
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(uColor * (0.72 + fresnel * 1.1), alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
}

function createAccretionDisk(
  count: number,
  texture: THREE.Texture,
): THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const positions = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  const phases = new Float32Array(count)
  const colors = new Float32Array(count * 3)
  const rng = mulberry32(9417)
  for (let index = 0; index < count; index += 1) {
    const offset = index * 3
    const radius = 0.5 + Math.pow(rng(), 0.72) * 2.2
    const angle = rng() * Math.PI * 2
    const axial = (rng() - 0.35) * 4.8
    const taper = 0.28 + Math.max(0, 1 - Math.abs(axial) / 4.8)
    positions[offset] = Math.cos(angle) * radius * taper
    positions[offset + 1] = Math.sin(angle) * radius * taper
    positions[offset + 2] = axial
    sizes[index] = 0.26 + rng() * 0.88
    phases[index] = angle
    const color = index % 4 === 0 ? ANCIENT_GOLD : index % 4 === 1 ? ION_BLUE : PLASMA_JADE
    colors[offset] = color.r
    colors[offset + 1] = color.g
    colors[offset + 2] = color.b
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uWarp: { value: 0 },
      uTexture: { value: texture },
    },
    vertexShader: `
      uniform float uTime;
      uniform float uWarp;
      attribute float aSize;
      attribute float aPhase;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float angle = uTime * (0.16 + aSize * 0.03) + aPhase;
        vec3 transformed = position;
        transformed.xy = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * transformed.xy;
        transformed.z += sin(angle * 2.0) * 0.08;
        vec4 viewPosition = modelViewMatrix * vec4(transformed, 1.0);
        gl_PointSize = aSize * (1.2 + uWarp * 0.8) * clamp(90.0 / max(12.0, -viewPosition.z), 0.5, 3.0);
        gl_Position = projectionMatrix * viewPosition;
        vColor = color;
        vAlpha = 0.48 + uWarp * 0.18;
      }
    `,
    fragmentShader: `
      uniform sampler2D uTexture;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec4 sprite = texture2D(uTexture, gl_PointCoord);
        float alpha = sprite.a * vAlpha;
        if (alpha < 0.015) discard;
        gl_FragColor = vec4(vColor * (0.76 + sprite.rgb * 1.42), alpha);
      }
    `,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const points = new THREE.Points(geometry, material)
  return points
}

function createProminenceArcs(radius: number, color: string, seed: number): THREE.Mesh[] {
  return [0, 1].map((index) => {
    const points: THREE.Vector3[] = []
    for (let pointIndex = 0; pointIndex <= 28; pointIndex += 1) {
      const progress = pointIndex / 28
      const angle = THREE.MathUtils.lerp(-0.72, 0.72, progress)
      const lift = Math.sin(progress * Math.PI) * radius * (0.3 + index * 0.12)
      points.push(
        new THREE.Vector3(
          Math.cos(angle) * (radius + lift),
          Math.sin(angle) * radius * 0.72,
          Math.sin(progress * Math.PI) * radius * 0.08,
        ),
      )
    }
    const curve = new THREE.CatmullRomCurve3(points)
    const mesh = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 42, Math.max(0.012, radius * 0.024), 6, false),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    )
    mesh.rotation.set(seed * 0.31 + index, seed * 0.73 + index * 1.2, seed * 0.17)
    return mesh
  })
}

function createBackgroundStarField(
  count: number,
): THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const positions = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  const phases = new Float32Array(count)
  const colors = new Float32Array(count * 3)
  const rng = mulberry32(1729)
  for (let index = 0; index < count; index += 1) {
    const offset = index * 3
    const radius = 120 + Math.pow(rng(), 0.24) * 980
    const theta = rng() * Math.PI * 2
    const phi = Math.acos(THREE.MathUtils.clamp(rng() * 2 - 1, -1, 1))
    positions[offset] = Math.sin(phi) * Math.cos(theta) * radius
    positions[offset + 1] = Math.cos(phi) * radius
    positions[offset + 2] = Math.sin(phi) * Math.sin(theta) * radius - 340
    sizes[index] = 0.36 + rng() ** 4 * 2.2
    phases[index] = rng() * Math.PI * 2
    const color = index % 7 === 0 ? ION_BLUE : index % 7 === 1 ? ANCIENT_GOLD : STELLAR_WHITE
    colors[offset] = color.r
    colors[offset + 1] = color.g
    colors[offset + 2] = color.b
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const material = createClusterStarMaterial(0.48)
  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false
  return points
}

function createClusterStarMaterial(opacity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: opacity },
    },
    vertexShader: `
      uniform float uTime;
      attribute float aSize;
      attribute float aPhase;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec3 transformed = position;
        transformed.y += sin(uTime * 0.12 + aPhase) * 0.18;
        vec4 viewPosition = modelViewMatrix * vec4(transformed, 1.0);
        float perspective = clamp(120.0 / max(18.0, -viewPosition.z), 0.32, 3.2);
        gl_PointSize = aSize * perspective;
        gl_Position = projectionMatrix * viewPosition;
        vColor = color;
        vAlpha = 0.72 + sin(uTime * 0.8 + aPhase) * 0.28;
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec2 p = gl_PointCoord - 0.5;
        float radius = length(p);
        if (radius > 0.5) discard;
        float core = smoothstep(0.12, 0.0, radius);
        float glow = pow(smoothstep(0.5, 0.0, radius), 2.1);
        gl_FragColor = vec4(vColor * (0.72 + core * 1.8), glow * uOpacity * vAlpha);
      }
    `,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
}

function createWarpField(
  count: number,
): THREE.LineSegments<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const positions = new Float32Array(count * 6)
  const colors = new Float32Array(count * 6)
  const rng = mulberry32(83291)
  for (let index = 0; index < count; index += 1) {
    const offset = index * 6
    const angle = rng() * Math.PI * 2
    const radius = 8 + Math.pow(rng(), 0.58) * 96
    const x = Math.cos(angle) * radius
    const y = Math.sin(angle) * radius
    const z = -220 + rng() * 320
    const length = 5 + rng() * 46
    positions.set([x, y, z, x * 1.006, y * 1.006, z + length], offset)
    const color = index % 5 === 0 ? ANCIENT_GOLD : index % 5 === 1 ? PLASMA_JADE : ION_BLUE
    colors.set([color.r, color.g, color.b, color.r, color.g, color.b], offset)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uWarp: { value: 0 },
      uOpacity: { value: 0 },
    },
    vertexShader: `
      uniform float uTime;
      uniform float uWarp;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec3 transformed = position;
        transformed.z = mod(position.z + uTime * (18.0 + uWarp * 120.0) + 260.0, 320.0) - 220.0;
        transformed.xy *= 1.0 + uWarp * 0.12;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
        vColor = color;
        vAlpha = uWarp;
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        gl_FragColor = vec4(vColor, uOpacity * vAlpha);
      }
    `,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const lines = new THREE.LineSegments(geometry, material)
  lines.frustumCulled = false
  return lines
}

function createTexturedTrailMaterial(
  texture: THREE.Texture,
  colorA: string,
  colorB: string,
  soft: boolean,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uPixelRatio: { value: 1 },
      uTime: { value: 0 },
      uTexture: { value: texture },
      uColorA: { value: new THREE.Color(colorA) },
      uColorB: { value: new THREE.Color(colorB) },
    },
    vertexShader: `
      uniform float uPixelRatio;
      uniform float uTime;
      attribute float aSize;
      attribute float aAlpha;
      attribute float aPhase;
      varying float vAlpha;
      varying float vBlend;
      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uPixelRatio * clamp(96.0 / max(10.0, -viewPosition.z), 0.5, 4.6);
        gl_Position = projectionMatrix * viewPosition;
        vAlpha = aAlpha;
        vBlend = sin(uTime * 0.42 + aPhase + position.z * 0.025) * 0.5 + 0.5;
      }
    `,
    fragmentShader: `
      uniform sampler2D uTexture;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      varying float vAlpha;
      varying float vBlend;
      void main() {
        vec4 sprite = texture2D(uTexture, gl_PointCoord);
        float alpha = sprite.a * vAlpha;
        if (alpha < 0.008) discard;
        vec3 color = mix(uColorA, uColorB, vBlend);
        gl_FragColor = vec4(color * (0.62 + sprite.rgb * 1.58), alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: soft ? THREE.NormalBlending : THREE.AdditiveBlending,
    toneMapped: false,
  })
}

function createTextTexture(text: string, width: number, height: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D context unavailable')
  context.clearRect(0, 0, width, height)
  context.font = `${Math.floor(height * 0.42)}px "STKaiti", "KaiTi", serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.shadowColor = 'rgba(104, 201, 172, .62)'
  context.shadowBlur = 14
  context.fillStyle = 'rgba(244, 229, 192, .96)'
  context.fillText(text, width / 2, height / 2 + 2)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

function nodeAnchor(kind: UniverseNode['kind']): THREE.Vector3 {
  if (kind === 'dynasty') return DYNASTY_CENTER
  if (kind === 'poet') return TANG_CENTER
  return LI_BAI_CENTER
}

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function seededRandom(seed: number): number {
  return mulberry32(seed)()
}

function easeInOutCubic(value: number): number {
  return value < 0.5 ? 4 * value ** 3 : 1 - Math.pow(-2 * value + 2, 3) / 2
}

function easeInOutSine(value: number): number {
  return -(Math.cos(Math.PI * value) - 1) / 2
}

function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - value, 3)
}

function easeOutBack(value: number): number {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(value - 1, 3) + c1 * Math.pow(value - 1, 2)
}

function easeInExpo(value: number): number {
  if (value === 0) return 0
  if (value === 1) return 1
  return 2 ** (10 * value - 10)
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const normalized = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1)
  return normalized * normalized * (3 - 2 * normalized)
}
