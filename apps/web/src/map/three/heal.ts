import * as THREE from 'three'

/**
 * The "heal" moment when a repair is applied: emerald ripples spread over the
 * ground from the repaired curb ramp, a soft glow rises and fades, and a few
 * motes of light lift away. Purely visual; it plays where the engine applied the
 * repair and never changes what the engine computed.
 */
export class HealEffect {
  readonly group = new THREE.Group()
  private ringGeo = new THREE.RingGeometry(0.9, 1, 96).rotateX(-Math.PI / 2)
  private discGeo = new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2)
  private glowTex = radialTexture('rgba(47,196,151,0.85)', 'rgba(47,196,151,0)')
  private moteTex = radialTexture('rgba(220,255,240,1)', 'rgba(47,196,151,0)')
  private live: { t0: number; parts: { obj: THREE.Object3D; mat: THREE.Material & { opacity: number }; step: (k: number) => void }[]; dur: number }[] = []

  /** Starts one heal at local (x, z); returns true while any effect is running. */
  play(x: number, z: number, now = performance.now()) {
    const parts: (typeof this.live)[number]['parts'] = []
    const ring = (delay: number, maxR: number, color: string) => {
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false })
      const m = new THREE.Mesh(this.ringGeo, mat)
      m.position.set(x, 0.6, z)
      m.renderOrder = 40
      this.group.add(m)
      parts.push({
        obj: m,
        mat,
        step: (k) => {
          const u = Math.max(0, Math.min(1, (k - delay) / (1 - delay)))
          const e = 1 - Math.pow(1 - u, 3)
          const r = 1.5 + maxR * e
          m.scale.set(r, 1, r)
          mat.opacity = u <= 0 ? 0 : 0.85 * (1 - u)
        },
      })
    }
    ring(0, 30, '#19b487')
    ring(0.18, 22, '#2fc497')
    ring(0.36, 14, '#7fe0bf')
    // ground glow
    const gmat = new THREE.MeshBasicMaterial({ map: this.glowTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.NormalBlending })
    const glow = new THREE.Mesh(this.discGeo, gmat)
    glow.position.set(x, 0.5, z)
    glow.renderOrder = 39
    this.group.add(glow)
    parts.push({
      obj: glow,
      mat: gmat,
      step: (k) => {
        const s = 10 + 8 * k
        glow.scale.set(s, 1, s)
        gmat.opacity = 0.75 * Math.sin(Math.PI * Math.min(1, k * 1.25))
      },
    })
    // motes lifting away
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + Math.random() * 0.4
      const rad = 2 + Math.random() * 6
      const smat = new THREE.SpriteMaterial({ map: this.moteTex, transparent: true, opacity: 0, depthWrite: false })
      const s = new THREE.Sprite(smat)
      const sx = x + Math.cos(a) * rad
      const sz = z + Math.sin(a) * rad
      const delay = Math.random() * 0.25
      const rise = 8 + Math.random() * 10
      const size = 1.8 + Math.random() * 1.8
      s.renderOrder = 41
      this.group.add(s)
      parts.push({
        obj: s,
        mat: smat,
        step: (k) => {
          const u = Math.max(0, Math.min(1, (k - delay) / (1 - delay)))
          s.position.set(sx, 1 + rise * (1 - Math.pow(1 - u, 2)), sz)
          s.scale.setScalar(size * (1 - 0.4 * u))
          smat.opacity = u <= 0 ? 0 : Math.sin(Math.PI * u) * 0.95
        },
      })
    }
    this.live.push({ t0: now, parts, dur: 1700 })
  }

  /** Advances every running heal; returns true while any is still playing. */
  tick(now = performance.now()) {
    this.live = this.live.filter((h) => {
      const k = Math.min(1, (now - h.t0) / h.dur)
      for (const p of h.parts) p.step(k)
      if (k < 1) return true
      for (const p of h.parts) {
        this.group.remove(p.obj)
        p.mat.dispose()
      }
      return false
    })
    return this.live.length > 0
  }

  dispose() {
    this.tick(Infinity)
    this.ringGeo.dispose()
    this.discGeo.dispose()
    this.glowTex.dispose()
    this.moteTex.dispose()
  }
}

function radialTexture(inner: string, outer: string) {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, inner)
  g.addColorStop(1, outer)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
