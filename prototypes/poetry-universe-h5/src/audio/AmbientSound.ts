export class AmbientSound {
  private context?: AudioContext
  private master?: GainNode
  private oscillators: OscillatorNode[] = []
  private enabled = true

  get isEnabled(): boolean {
    return this.enabled
  }

  async start(): Promise<void> {
    if (!this.context) this.buildGraph()
    if (!this.context || !this.master) return

    await this.context.resume()
    const now = this.context.currentTime
    this.master.gain.cancelScheduledValues(now)
    this.master.gain.setValueAtTime(this.master.gain.value, now)
    this.master.gain.linearRampToValueAtTime(this.enabled ? 0.16 : 0, now + 1.4)
  }

  async toggle(): Promise<boolean> {
    this.enabled = !this.enabled
    if (!this.context || !this.master) {
      if (this.enabled) await this.start()
      return this.enabled
    }

    await this.context.resume()
    const now = this.context.currentTime
    this.master.gain.cancelScheduledValues(now)
    this.master.gain.setValueAtTime(this.master.gain.value, now)
    this.master.gain.linearRampToValueAtTime(this.enabled ? 0.16 : 0, now + 0.42)
    return this.enabled
  }

  playWarp(durationMs = 2400): void {
    if (!this.enabled || !this.context || !this.master) return
    const context = this.context
    const duration = Math.max(0.8, durationMs / 1000)
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate)
    const data = buffer.getChannelData(0)
    let previous = 0

    for (let index = 0; index < data.length; index += 1) {
      const white = Math.random() * 2 - 1
      previous = previous * 0.965 + white * 0.035
      const envelope = Math.sin((index / data.length) * Math.PI)
      data[index] = previous * envelope
    }

    const source = context.createBufferSource()
    const filter = context.createBiquadFilter()
    const gain = context.createGain()
    source.buffer = buffer
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(320, context.currentTime)
    filter.frequency.exponentialRampToValueAtTime(1600, context.currentTime + duration * 0.52)
    filter.frequency.exponentialRampToValueAtTime(260, context.currentTime + duration)
    filter.Q.value = 0.72
    gain.gain.setValueAtTime(0.0001, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.14, context.currentTime + duration * 0.36)
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration)
    source.connect(filter).connect(gain).connect(this.master)
    source.start()
    source.stop(context.currentTime + duration)
  }

  playChime(pitch = 523.25): void {
    if (!this.enabled || !this.context || !this.master) return
    const now = this.context.currentTime
    const notes = [pitch, pitch * 1.5, pitch * 2]

    notes.forEach((frequency, index) => {
      const oscillator = this.context!.createOscillator()
      const gain = this.context!.createGain()
      oscillator.type = index === 0 ? 'sine' : 'triangle'
      oscillator.frequency.value = frequency
      gain.gain.setValueAtTime(0.0001, now + index * 0.08)
      gain.gain.exponentialRampToValueAtTime(0.045 / (index + 1), now + 0.05 + index * 0.08)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.35 + index * 0.12)
      oscillator.connect(gain).connect(this.master!)
      oscillator.start(now + index * 0.08)
      oscillator.stop(now + 1.6 + index * 0.12)
    })
  }

  dispose(): void {
    this.oscillators.forEach((oscillator) => oscillator.stop())
    this.oscillators = []
    void this.context?.close()
    this.context = undefined
  }

  private buildGraph(): void {
    const AudioContextConstructor = window.AudioContext
    if (!AudioContextConstructor) return

    const context = new AudioContextConstructor()
    const master = context.createGain()
    const ambience = context.createGain()
    const filter = context.createBiquadFilter()
    const compressor = context.createDynamicsCompressor()

    master.gain.value = 0
    ambience.gain.value = 0.14
    filter.type = 'lowpass'
    filter.frequency.value = 680
    filter.Q.value = 0.7
    compressor.threshold.value = -24
    compressor.knee.value = 18
    compressor.ratio.value = 5
    compressor.attack.value = 0.01
    compressor.release.value = 0.32

    ambience.connect(filter).connect(compressor).connect(master).connect(context.destination)

    ;[
      { frequency: 55, detune: -4, type: 'sine' as OscillatorType, gain: 0.22 },
      { frequency: 82.41, detune: 5, type: 'sine' as OscillatorType, gain: 0.095 },
      { frequency: 110, detune: -9, type: 'triangle' as OscillatorType, gain: 0.025 },
    ].forEach((voice) => {
      const oscillator = context.createOscillator()
      const voiceGain = context.createGain()
      oscillator.type = voice.type
      oscillator.frequency.value = voice.frequency
      oscillator.detune.value = voice.detune
      voiceGain.gain.value = voice.gain
      oscillator.connect(voiceGain).connect(ambience)
      oscillator.start()
      this.oscillators.push(oscillator)
    })

    this.context = context
    this.master = master
  }
}
