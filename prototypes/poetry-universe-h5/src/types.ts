import type { Vector3Tuple } from 'three'

export type UniverseStage =
  | 'intro'
  | 'awakened'
  | 'dynasties'
  | 'poets'
  | 'works'
  | 'poem'
  | 'collapsing'
  | 'home'

export type UniverseNodeKind = 'dynasty' | 'poet' | 'work'

export type UniverseNode = {
  id: string
  kind: UniverseNodeKind
  name: string
  subtitle?: string
  position: Vector3Tuple
  color: string
  scale: number
  featured?: boolean
}

export type MockPoem = {
  id: string
  title: string
  lines: string[]
  form: string
  position: Vector3Tuple
  color: string
  featured?: boolean
}

export type QualityProfile = {
  tier: 'low' | 'medium' | 'high'
  pixelRatio: number
  backgroundStars: number
  flowParticles: number
  tunnelStreaks: number
  cloudPlanes: number
}
