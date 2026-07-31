import type { QualityProfile } from '../types'

type NavigatorWithHints = Navigator & {
  deviceMemory?: number
}

export function detectQuality(): QualityProfile {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const memory = (navigator as NavigatorWithHints).deviceMemory ?? 4
  const cores = navigator.hardwareConcurrency ?? 4
  const smallViewport = Math.min(window.innerWidth, window.innerHeight) < 430

  if (reducedMotion || memory <= 2 || cores <= 4) {
    return {
      tier: 'low',
      pixelRatio: 1.15,
      backgroundStars: 1000,
      flowParticles: 1300,
      tunnelStreaks: 860,
      cloudPlanes: 6,
    }
  }

  if (memory <= 4 || cores <= 6 || smallViewport) {
    return {
      tier: 'medium',
      pixelRatio: 1.45,
      backgroundStars: 1700,
      flowParticles: 2400,
      tunnelStreaks: 1200,
      cloudPlanes: 9,
    }
  }

  return {
    tier: 'high',
    pixelRatio: 1.75,
    backgroundStars: 2400,
    flowParticles: 3600,
    tunnelStreaks: 1680,
    cloudPlanes: 12,
  }
}
