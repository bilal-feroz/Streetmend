import * as THREE from 'three'
import type { LocalFrame } from './frame'

export interface MarkerSpec {
  key: string
  lng: number
  lat: number
  alt: number // metres
  px: number // on-screen size (CSS px)
  iconKey: string
  icon: () => HTMLCanvasElement
  stem?: boolean
  order?: number
}

interface Entry {
  sprite: THREE.Sprite
  spec: MarkerSpec
  local: THREE.Vector3
}

/**
 * Georeferenced markers as depth-tested sprites: they keep a constant screen
 * size, sit at a real lon/lat, and are correctly hidden behind buildings.
 */
export class MarkerLayer {
  readonly group = new THREE.Group()
  private frame: LocalFrame
  private entries = new Map<string, Entry>()
  private textures = new Map<string, THREE.CanvasTexture>()
  private stems: THREE.LineSegments | null = null
  private scaleK = 0

  constructor(frame: LocalFrame) {
    this.frame = frame
  }

  private texture(spec: MarkerSpec) {
    let t = this.textures.get(spec.iconKey)
    if (!t) {
      t = new THREE.CanvasTexture(spec.icon())
      t.colorSpace = THREE.SRGBColorSpace
      t.anisotropy = 4
      this.textures.set(spec.iconKey, t)
    }
    return t
  }

  set(specs: MarkerSpec[]) {
    const keep = new Set(specs.map((s) => s.key))
    for (const [k, e] of this.entries) {
      if (!keep.has(k)) {
        this.group.remove(e.sprite)
        e.sprite.material.dispose()
        this.entries.delete(k)
      }
    }
    for (const spec of specs) {
      let e = this.entries.get(spec.key)
      const local = new THREE.Vector3(...this.frame.toLocal(spec.lng, spec.lat, spec.alt))
      if (!e) {
        const mat = new THREE.SpriteMaterial({ map: this.texture(spec), sizeAttenuation: false, depthTest: true, depthWrite: false, transparent: true })
        const sprite = new THREE.Sprite(mat)
        this.group.add(sprite)
        e = { sprite, spec, local }
        this.entries.set(spec.key, e)
      } else if (e.spec.iconKey !== spec.iconKey) {
        e.sprite.material.map = this.texture(spec)
        e.sprite.material.needsUpdate = true
      }
      e.spec = spec
      e.local = local
      e.sprite.position.copy(local)
      e.sprite.renderOrder = 100 + (spec.order ?? 0)
    }
    this.rebuildStems()
    this.applyScale()
  }

  private rebuildStems() {
    if (this.stems) {
      this.group.remove(this.stems)
      this.stems.geometry.dispose()
      ;(this.stems.material as THREE.Material).dispose()
      this.stems = null
    }
    const pts: number[] = []
    for (const e of this.entries.values()) {
      if (!e.spec.stem) continue
      pts.push(e.local.x, 0.2, e.local.z, e.local.x, e.local.y, e.local.z)
    }
    if (!pts.length) return
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    this.stems = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#5d6c64', transparent: true, opacity: 0.7 }))
    this.stems.renderOrder = 99
    this.group.add(this.stems)
  }

  /** Constant on-screen size: scale = 2 * px * dpr / (P11 * viewportHeight). */
  updateScale(p11: number, viewportHeight: number) {
    const k = (2 * window.devicePixelRatio) / (p11 * viewportHeight)
    if (Math.abs(k - this.scaleK) / (this.scaleK || 1) < 1e-4) return
    this.scaleK = k
    this.applyScale()
  }

  private applyScale() {
    for (const e of this.entries.values()) e.sprite.scale.set(e.spec.px * this.scaleK, e.spec.px * this.scaleK, 1)
  }

  list() {
    return [...this.entries.values()].map((e) => ({ key: e.spec.key, local: e.local, px: e.spec.px }))
  }

  dispose() {
    this.set([])
    for (const t of this.textures.values()) t.dispose()
    this.textures.clear()
  }
}
