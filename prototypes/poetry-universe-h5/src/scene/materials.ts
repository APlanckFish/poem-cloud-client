import * as THREE from 'three'

const GOLD = new THREE.Color('#d7aa5f')
const JADE = new THREE.Color('#72b59d')
const MOON = new THREE.Color('#f4ead7')

export type AnimatedMaterial = THREE.ShaderMaterial & {
  uniforms: {
    uTime: { value: number }
    uWarp: { value: number }
    uCollapse: { value: number }
    [key: string]: THREE.IUniform
  }
}

export function createGlowTexture(size = 256): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D context unavailable')

  const center = size / 2
  const gradient = context.createRadialGradient(center, center, 0, center, center, center)
  gradient.addColorStop(0, 'rgba(255, 250, 231, 1)')
  gradient.addColorStop(0.08, 'rgba(255, 234, 183, .96)')
  gradient.addColorStop(0.2, 'rgba(207, 175, 103, .72)')
  gradient.addColorStop(0.46, 'rgba(103, 179, 151, .22)')
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, size, size)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function mulberry32(seed: number) {
  return () => {
    let value = (seed += 0x6d2b79f5)
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export function createCloudTexture(seed: number, color: string): THREE.CanvasTexture {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D context unavailable')

  const random = mulberry32(seed)
  context.clearRect(0, 0, size, size)
  context.globalCompositeOperation = 'screen'

  for (let index = 0; index < 96; index += 1) {
    const x = size * (0.18 + random() * 0.64)
    const y = size * (0.18 + random() * 0.64)
    const radius = size * (0.045 + random() * 0.15)
    const alpha = 0.018 + random() * 0.058
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius)
    gradient.addColorStop(0, hexToRgba(color, alpha))
    gradient.addColorStop(0.35, hexToRgba(color, alpha * 0.62))
    gradient.addColorStop(1, hexToRgba(color, 0))
    context.fillStyle = gradient
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2)
  }

  context.globalCompositeOperation = 'source-over'
  const vignette = context.createRadialGradient(size / 2, size / 2, size * 0.12, size / 2, size / 2, size * 0.52)
  vignette.addColorStop(0, 'rgba(255,255,255,.15)')
  vignette.addColorStop(0.5, 'rgba(255,255,255,.035)')
  vignette.addColorStop(1, 'rgba(0,0,0,0)')
  context.fillStyle = vignette
  context.fillRect(0, 0, size, size)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace('#', '')
  const red = Number.parseInt(value.slice(0, 2), 16)
  const green = Number.parseInt(value.slice(2, 4), 16)
  const blue = Number.parseInt(value.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

export function createStarField(count: number): {
  points: THREE.Points
  material: AnimatedMaterial
} {
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  const phases = new Float32Array(count)

  for (let index = 0; index < count; index += 1) {
    const offset = index * 3
    const radius = 28 + Math.random() ** 0.58 * 235
    const angle = Math.random() * Math.PI * 2
    positions[offset] = Math.cos(angle) * radius
    positions[offset + 1] = Math.sin(angle) * radius * 0.72
    positions[offset + 2] = Math.random() * 1200 - 1000

    const color = Math.random() > 0.68 ? GOLD : Math.random() > 0.52 ? JADE : MOON
    colors[offset] = color.r
    colors[offset + 1] = color.g
    colors[offset + 2] = color.b
    sizes[index] = 0.7 + Math.random() * 2.5
    phases[index] = Math.random() * Math.PI * 2
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1))

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uWarp: { value: 0 },
      uCollapse: { value: 0 },
      uCollapseZ: { value: -42 },
      uPixelRatio: { value: 1 },
    },
    vertexShader: `
      uniform float uTime;
      uniform float uWarp;
      uniform float uCollapse;
      uniform float uCollapseZ;
      uniform float uPixelRatio;
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aPhase;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        float speed = mix(2.0, 104.0, uWarp);
        float travelZ = mod(position.z + uTime * speed + 1000.0, 1200.0) - 1000.0;
        vec3 transformed = vec3(position.xy * (1.0 + uWarp * 0.28), travelZ);
        transformed = mix(transformed, vec3(0.0, 0.0, uCollapseZ), uCollapse);
        vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
        float twinkle = 0.72 + sin(uTime * 2.2 + aPhase) * 0.28;
        gl_PointSize = aSize * twinkle * uPixelRatio * clamp(220.0 / -mvPosition.z, 0.45, 5.2);
        gl_Position = projectionMatrix * mvPosition;
        vColor = aColor;
        vAlpha = twinkle * (1.0 - uCollapse);
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec2 centered = gl_PointCoord - 0.5;
        float distanceToCenter = length(centered);
        float core = smoothstep(0.5, 0.0, distanceToCenter);
        float glow = pow(core, 2.1);
        if (distanceToCenter > 0.5) discard;
        gl_FragColor = vec4(vColor * (1.1 + glow), glow * vAlpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }) as AnimatedMaterial

  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false
  return { points, material }
}

export function createFlowField(count: number): {
  points: THREE.Points
  material: AnimatedMaterial
} {
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  const phases = new Float32Array(count)

  for (let index = 0; index < count; index += 1) {
    const offset = index * 3
    const depth = Math.random() * 980 - 900
    const normalizedDepth = (depth + 900) / 980
    const baseRadius = 22 + Math.sin(normalizedDepth * Math.PI) * 56
    const angle = normalizedDepth * Math.PI * 9 + Math.random() * Math.PI * 2
    const radius = baseRadius * (0.72 + Math.random() * 0.72)
    positions[offset] = Math.cos(angle) * radius
    positions[offset + 1] = Math.sin(angle) * radius * 0.78
    positions[offset + 2] = depth

    const color = index % 3 === 0 ? GOLD : index % 3 === 1 ? JADE : MOON
    colors[offset] = color.r
    colors[offset + 1] = color.g
    colors[offset + 2] = color.b
    sizes[index] = 1.2 + Math.random() * 3.8
    phases[index] = Math.random() * Math.PI * 2
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1))

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uWarp: { value: 0 },
      uCollapse: { value: 0 },
      uCollapseZ: { value: -40 },
      uPixelRatio: { value: 1 },
    },
    vertexShader: `
      uniform float uTime;
      uniform float uWarp;
      uniform float uCollapse;
      uniform float uCollapseZ;
      uniform float uPixelRatio;
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aPhase;
      varying vec3 vColor;
      varying float vOpacity;

      mat2 rotate2d(float angle) {
        return mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
      }

      void main() {
        float speed = mix(0.8, 122.0, uWarp);
        float travelZ = mod(position.z + uTime * speed + 940.0, 1040.0) - 940.0;
        vec2 spiral = rotate2d(uTime * 0.035 + travelZ * 0.0018) * position.xy;
        vec3 transformed = vec3(spiral * (1.0 + uWarp * 0.42), travelZ);
        transformed = mix(transformed, vec3(0.0, 0.0, uCollapseZ), uCollapse);
        vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
        float pulse = 0.7 + sin(aPhase + uTime * 2.4) * 0.3;
        gl_PointSize = aSize * uPixelRatio * pulse * clamp(260.0 / -mvPosition.z, 0.4, 7.0);
        gl_Position = projectionMatrix * mvPosition;
        vColor = aColor;
        vOpacity = (0.18 + uWarp * 0.82) * (1.0 - uCollapse);
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vOpacity;

      void main() {
        float distanceToCenter = length(gl_PointCoord - 0.5);
        if (distanceToCenter > 0.5) discard;
        float glow = pow(smoothstep(0.5, 0.0, distanceToCenter), 1.65);
        gl_FragColor = vec4(vColor * 1.22, glow * vOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }) as AnimatedMaterial

  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false
  return { points, material }
}

export function createWarpStreaks(count: number): {
  lines: THREE.LineSegments
  material: AnimatedMaterial
} {
  const positions = new Float32Array(count * 2 * 3)
  const colors = new Float32Array(count * 2 * 3)
  const seeds = new Float32Array(count * 2)

  for (let index = 0; index < count; index += 1) {
    const angle = Math.random() * Math.PI * 2
    const radius = 18 + Math.random() ** 0.68 * 205
    const z = Math.random() * 1000 - 920
    const length = 8 + Math.random() * 42
    const color = index % 4 === 0 ? GOLD : index % 4 === 1 ? JADE : MOON

    for (let endpoint = 0; endpoint < 2; endpoint += 1) {
      const vertexIndex = index * 2 + endpoint
      const offset = vertexIndex * 3
      positions[offset] = Math.cos(angle) * radius
      positions[offset + 1] = Math.sin(angle) * radius * 0.74
      positions[offset + 2] = z - endpoint * length
      colors[offset] = color.r
      colors[offset + 1] = color.g
      colors[offset + 2] = color.b
      seeds[vertexIndex] = Math.random()
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1))

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uWarp: { value: 0 },
      uCollapse: { value: 0 },
      uCollapseZ: { value: -38 },
    },
    vertexShader: `
      uniform float uTime;
      uniform float uWarp;
      uniform float uCollapse;
      uniform float uCollapseZ;
      attribute vec3 aColor;
      attribute float aSeed;
      varying vec3 vColor;
      varying float vOpacity;

      void main() {
        float speed = 145.0 + uWarp * 370.0;
        float travelZ = mod(position.z + uTime * speed + 980.0, 1080.0) - 980.0;
        vec3 transformed = vec3(position.xy * (1.0 + uWarp * 0.58), travelZ);
        transformed = mix(transformed, vec3(0.0, 0.0, uCollapseZ), uCollapse);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
        vColor = aColor;
        vOpacity = uWarp * (0.35 + aSeed * 0.65) * (1.0 - uCollapse);
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vOpacity;
      void main() {
        gl_FragColor = vec4(vColor * 1.35, vOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }) as AnimatedMaterial

  const lines = new THREE.LineSegments(geometry, material)
  lines.frustumCulled = false
  return { lines, material }
}

export function createNebulaDome(): {
  mesh: THREE.Mesh
  material: AnimatedMaterial
} {
  const geometry = new THREE.SphereGeometry(540, 36, 24)
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uWarp: { value: 0 },
      uCollapse: { value: 0 },
    },
    vertexShader: `
      varying vec3 vDirection;
      void main() {
        vDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uWarp;
      uniform float uCollapse;
      varying vec3 vDirection;

      float hash(vec3 p) {
        p = fract(p * 0.3183099 + 0.1);
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }

      float noise(vec3 x) {
        vec3 i = floor(x);
        vec3 f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
              mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
          mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
              mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
          f.z
        );
      }

      float fbm(vec3 p) {
        float value = 0.0;
        float amplitude = 0.5;
        for (int i = 0; i < 5; i++) {
          value += amplitude * noise(p);
          p = p * 2.03 + vec3(1.7, 3.2, 2.1);
          amplitude *= 0.5;
        }
        return value;
      }

      void main() {
        vec3 direction = normalize(vDirection);
        float turn = uTime * 0.012 + uWarp * 0.15;
        mat2 rotation = mat2(cos(turn), -sin(turn), sin(turn), cos(turn));
        direction.xz = rotation * direction.xz;
        float cloud = fbm(direction * 3.25 + vec3(0.0, uTime * 0.018, 0.0));
        float detail = fbm(direction * 7.2 - vec3(uTime * 0.012, 0.0, 0.0));
        float band = smoothstep(0.42, 0.82, cloud * 0.72 + detail * 0.35);
        float goldBand = smoothstep(0.58, 0.88, fbm(direction * 4.7 + vec3(3.0, 0.0, uTime * 0.01)));
        vec3 ink = vec3(0.004, 0.018, 0.016);
        vec3 jade = vec3(0.055, 0.28, 0.23);
        vec3 gold = vec3(0.52, 0.30, 0.10);
        vec3 color = ink + jade * band * (0.24 + uWarp * 0.24) + gold * goldBand * 0.18;
        color += vec3(0.025, 0.04, 0.035) * detail;
        color *= 1.0 - uCollapse;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
  }) as AnimatedMaterial

  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  return { mesh, material }
}
