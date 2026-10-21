import * as THREE from 'three'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import type { LocalFrame } from './frame'

export type NetCategory = 'traversable' | 'repaired' | 'blocked' | 'unknown' | 'setting' | 'selected' | 'nearby' | 'gap'

interface CatStyle {
  color: string
  width: number // px
  opacity: number
  dashed?: boolean
  elev: number // metres above ground (draw order + no z-fighting)
}

// Hierarchy: the network is quiet context; only the journey, its gap, repairs
// and the traced route carry strong colour.
export const CAT_STYLE: Record<NetCategory, CatStyle> = {
  traversable: { color: '#7b7f77', width: 1, opacity: 0.28, elev: 0.25 },
  setting: { color: '#c7867e', width: 1.2, opacity: 0.5, dashed: true, elev: 0.3 },
  unknown: { color: '#b98420', width: 1.1, opacity: 0.42, dashed: true, elev: 0.3 },
  blocked: { color: '#da5a50', width: 1.7, opacity: 0.68, dashed: true, elev: 0.4 },
  repaired: { color: '#087f63', width: 4.5, opacity: 1, elev: 0.45 },
  nearby: { color: '#355dd8', width: 3, opacity: 0.85, elev: 0.5 },
  gap: { color: '#da5a50', width: 5, opacity: 1, dashed: true, elev: 0.75 },
  selected: { color: '#355dd8', width: 5, opacity: 1, elev: 0.8 },
}

export interface EdgeGeom {
  id: string
  coords: [number, number][]
}

function segPositions(frame: LocalFrame, edges: EdgeGeom[], elev: number): Float32Array {
  const out: number[] = []
  for (const e of edges) {
    const pts = e.coords.map(([lng, lat]) => frame.toLocal(lng, lat, elev))
    for (let i = 0; i < pts.length - 1; i++) out.push(...pts[i], ...pts[i + 1])
  }
  return Float32Array.from(out)
}

function lineMaterial(style: CatStyle, resolution: THREE.Vector2) {
  const m = new LineMaterial({
    color: new THREE.Color(style.color).getHex(),
    linewidth: style.width * window.devicePixelRatio,
    worldUnits: false,
    transparent: true, // one sorted pass: renderOrder decides halo vs core
    opacity: style.opacity,
    dashed: !!style.dashed,
    dashSize: 2.2,
    gapSize: 1.6,
    depthTest: true,
    depthWrite: false,
  })
  m.resolution.copy(resolution)
  return m
}

/**
 * One network state (before or after repairs) as fat screen-space lines,
 * grouped by category so dashed and solid styles stay separate draw calls.
 */
export class NetworkLayer {
  readonly group = new THREE.Group()
  private frame: LocalFrame
  private resolution: THREE.Vector2
  private cats = new Map<NetCategory, LineSegments2>()
  private materials: LineMaterial[] = []
  private wave: LineSegments2 | null = null
  private waveSegs: { a: number[]; b: number[]; d: number }[] = []
  private route: { glow: Line2; halo: Line2; core: Line2; ghost: Line2; pts: THREE.Vector3[]; cum: number[] } | null = null
  private potential: Line2[] = []

  constructor(frame: LocalFrame, resolution: THREE.Vector2) {
    this.frame = frame
    this.resolution = resolution
  }

  setCategories(byCat: Partial<Record<NetCategory, EdgeGeom[]>>) {
    for (const obj of this.cats.values()) {
      this.group.remove(obj)
      obj.geometry.dispose()
      ;(obj.material as LineMaterial).dispose()
    }
    this.cats.clear()
    const order: NetCategory[] = ['traversable', 'setting', 'unknown', 'blocked', 'repaired', 'nearby', 'gap', 'selected']
    order.forEach((cat, i) => {
      const edges = byCat[cat]
      if (!edges?.length) return
      const style = CAT_STYLE[cat]
      const g = new LineSegmentsGeometry()
      g.setPositions(segPositions(this.frame, edges, style.elev))
      const mat = lineMaterial(style, this.resolution)
      const obj = new LineSegments2(g, mat)
      if (style.dashed) obj.computeLineDistances()
      obj.renderOrder = cat === 'gap' ? 26 : cat === 'selected' ? 27 : 10 + i // the gap sits on top of the journey line
      this.cats.set(cat, obj)
      this.group.add(obj)
    })
  }

  /** Reach wave: segments reachable from the journey origin, revealed by distance. */
  setWave(edges: (EdgeGeom & { d: number })[]) {
    this.clearWave()
    this.waveSegs = []
    for (const e of edges) {
      const pts = e.coords.map(([lng, lat]) => this.frame.toLocal(lng, lat, 0.35))
      for (let i = 0; i < pts.length - 1; i++) this.waveSegs.push({ a: pts[i], b: pts[i + 1], d: e.d })
    }
    this.waveSegs.sort((x, y) => x.d - y.d)
  }

  showWave(upTo: number, opacity: number) {
    if (!this.waveSegs.length) return
    const segs = this.waveSegs.filter((s) => s.d <= upTo)
    if (!this.wave) {
      const mat = lineMaterial({ color: '#2f9e7c', width: 4, opacity, elev: 0.35 }, this.resolution)
      this.wave = new LineSegments2(new LineSegmentsGeometry(), mat)
      this.wave.renderOrder = 8
      this.group.add(this.wave)
    }
    ;(this.wave.material as LineMaterial).opacity = opacity
    const arr = new Float32Array(segs.length * 6)
    segs.forEach((s, i) => arr.set([...s.a, ...s.b], i * 6))
    this.wave.geometry.dispose()
    const g = new LineSegmentsGeometry()
    if (arr.length) g.setPositions(arr)
    this.wave.geometry = g
    this.wave.visible = arr.length > 0
  }

  setWaveOpacity(o: number) {
    if (this.wave) (this.wave.material as LineMaterial).opacity = o
  }

  maxWave() {
    return this.waveSegs.length ? this.waveSegs[this.waveSegs.length - 1].d : 0
  }

  clearWave() {
    if (this.wave) {
      this.group.remove(this.wave)
      this.wave.geometry.dispose()
      ;(this.wave.material as LineMaterial).dispose()
      this.wave = null
    }
  }

  /** Route polyline; `frac` reveals a prefix (0..1) for the tracing animation. */
  setRoute(coords: [number, number][] | null) {
    if (this.route) {
      for (const l of [this.route.glow, this.route.halo, this.route.core, this.route.ghost]) {
        this.group.remove(l)
        l.geometry.dispose()
        ;(l.material as LineMaterial).dispose()
      }
      this.route = null
    }
    if (!coords || coords.length < 2) return
    const pts = coords.map(([lng, lat]) => new THREE.Vector3(...this.frame.toLocal(lng, lat, 0.7)))
    const cum = [0]
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]))
    // a soft emerald glow, a crisp white halo, then the route itself
    const glow = new Line2(new LineGeometry(), lineMaterial({ color: '#2fc497', width: 16, opacity: 0.16, elev: 0.55 }, this.resolution))
    const halo = new Line2(new LineGeometry(), lineMaterial({ color: '#ffffff', width: 12, opacity: 0.95, elev: 0.6 }, this.resolution))
    const core = new Line2(new LineGeometry(), lineMaterial({ color: '#06805f', width: 6.5, opacity: 1, elev: 0.7 }, this.resolution))
    // a faint copy that ignores depth: the route stays traceable under tree canopy
    const ghost = new Line2(new LineGeometry(), lineMaterial({ color: '#06805f', width: 4, opacity: 0.22, elev: 0.7 }, this.resolution))
    ;(ghost.material as LineMaterial).depthTest = false
    ghost.renderOrder = 28
    glow.renderOrder = 29
    halo.renderOrder = 30
    core.renderOrder = 31
    this.group.add(ghost, glow, halo, core)
    this.route = { glow, halo, core, ghost, pts, cum }
    this.revealRoute(1)
  }

  revealRoute(frac: number) {
    if (!this.route) return
    const { pts, cum, glow, halo, core, ghost } = this.route
    const total = cum[cum.length - 1]
    const target = Math.max(0, Math.min(1, frac)) * total
    const out: number[] = [pts[0].x, pts[0].y, pts[0].z]
    for (let i = 1; i < pts.length; i++) {
      if (cum[i] <= target) {
        out.push(pts[i].x, pts[i].y, pts[i].z)
        continue
      }
      const t = (target - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1])
      const p = pts[i - 1].clone().lerp(pts[i], t)
      out.push(p.x, p.y, p.z)
      break
    }
    if (out.length < 6) out.push(...out.slice(0, 3))
    for (const l of [ghost, glow, halo, core]) {
      l.geometry.dispose()
      const g = new LineGeometry()
      g.setPositions(out)
      l.geometry = g
    }
  }

  /** The selected journey while it is broken: an ink line with a soft halo
   * (the blocked gap is drawn on top as the 'gap' category). */
  setPotential(coords: [number, number][] | null) {
    for (const l of this.potential) {
      this.group.remove(l)
      l.geometry.dispose()
      ;(l.material as LineMaterial).dispose()
    }
    this.potential = []
    if (!coords || coords.length < 2) return
    const pts = coords.flatMap(([lng, lat]) => this.frame.toLocal(lng, lat, 0.6))
    for (const [style, order, ghost] of [
      // a broken journey reads as a plain ink line: the planned path, not yet usable
      [{ color: '#192c28', width: 3, opacity: 0.2, elev: 0.6 }, 21, true],
      [{ color: '#ffffff', width: 9, opacity: 0.95, elev: 0.55 }, 23, false],
      [{ color: '#22302c', width: 3.8, opacity: 1, elev: 0.6 }, 24, false],
    ] as const) {
      const g = new LineGeometry()
      g.setPositions(pts)
      const l = new Line2(g, lineMaterial(style, this.resolution))
      if (ghost) (l.material as LineMaterial).depthTest = false // visible under canopy
      l.renderOrder = order
      this.potential.push(l)
      this.group.add(l)
    }
  }

  /** Brief widening of one category's lines (the heal moment), k in 0..1. */
  pulse(cat: NetCategory, k: number) {
    const obj = this.cats.get(cat)
    if (!obj) return
    ;(obj.material as LineMaterial).linewidth = CAT_STYLE[cat].width * window.devicePixelRatio * (1 + 1.8 * Math.sin(Math.PI * Math.min(1, k)))
  }

  updateResolution() {
    this.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as LineMaterial | undefined
      if (m && 'resolution' in m) m.resolution.copy(this.resolution)
    })
  }

  dispose() {
    this.setCategories({})
    this.clearWave()
    this.setRoute(null)
    this.setPotential(null)
    this.materials.forEach((m) => m.dispose())
  }
}
