import * as THREE from 'three'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import type { LocalFrame } from './frame'

export type NetCategory = 'traversable' | 'repaired' | 'blocked' | 'unknown' | 'setting' | 'selected' | 'nearby'

interface CatStyle {
  color: string
  width: number // px
  opacity: number
  dashed?: boolean
  elev: number // metres above ground (draw order + no z-fighting)
}

export const CAT_STYLE: Record<NetCategory, CatStyle> = {
  traversable: { color: '#8f9a94', width: 1.3, opacity: 0.7, elev: 0.25 },
  setting: { color: '#9aa39d', width: 2.2, opacity: 0.9, dashed: true, elev: 0.3 },
  unknown: { color: '#c98f2c', width: 1.8, opacity: 0.75, dashed: true, elev: 0.3 },
  blocked: { color: '#d85e51', width: 3, opacity: 0.95, dashed: true, elev: 0.4 },
  repaired: { color: '#198568', width: 4, opacity: 1, elev: 0.45 },
  nearby: { color: '#3568c8', width: 3, opacity: 0.85, elev: 0.5 },
  selected: { color: '#3568c8', width: 5, opacity: 1, elev: 0.55 },
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
  private route: { halo: Line2; core: Line2; pts: THREE.Vector3[]; cum: number[] } | null = null
  private potential: Line2 | null = null

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
    const order: NetCategory[] = ['traversable', 'setting', 'unknown', 'blocked', 'repaired', 'nearby', 'selected']
    order.forEach((cat, i) => {
      const edges = byCat[cat]
      if (!edges?.length) return
      const style = CAT_STYLE[cat]
      const g = new LineSegmentsGeometry()
      g.setPositions(segPositions(this.frame, edges, style.elev))
      const mat = lineMaterial(style, this.resolution)
      const obj = new LineSegments2(g, mat)
      if (style.dashed) obj.computeLineDistances()
      obj.renderOrder = 10 + i
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
      for (const l of [this.route.halo, this.route.core]) {
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
    const halo = new Line2(new LineGeometry(), lineMaterial({ color: '#ffffff', width: 11, opacity: 0.95, elev: 0.6 }, this.resolution))
    const core = new Line2(new LineGeometry(), lineMaterial({ color: '#198568', width: 5.5, opacity: 1, elev: 0.7 }, this.resolution))
    halo.renderOrder = 30
    core.renderOrder = 31
    this.group.add(halo, core)
    this.route = { halo, core, pts, cum }
    this.revealRoute(1)
  }

  revealRoute(frac: number) {
    if (!this.route) return
    const { pts, cum, halo, core } = this.route
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
    for (const l of [halo, core]) {
      l.geometry.dispose()
      const g = new LineGeometry()
      g.setPositions(out)
      l.geometry = g
    }
  }

  setPotential(coords: [number, number][] | null) {
    if (this.potential) {
      this.group.remove(this.potential)
      this.potential.geometry.dispose()
      ;(this.potential.material as LineMaterial).dispose()
      this.potential = null
    }
    if (!coords || coords.length < 2) return
    const g = new LineGeometry()
    g.setPositions(coords.flatMap(([lng, lat]) => this.frame.toLocal(lng, lat, 0.6)))
    const l = new Line2(g, lineMaterial({ color: '#3568c8', width: 2.6, opacity: 0.8, dashed: true, elev: 0.6 }, this.resolution))
    ;(l.material as LineMaterial).dashSize = 3
    ;(l.material as LineMaterial).gapSize = 3
    l.computeLineDistances()
    l.renderOrder = 25
    this.potential = l
    this.group.add(l)
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
