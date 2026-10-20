import * as THREE from 'three'
import type { LocalFrame } from './frame'

export interface BuildingProps {
  b: string // OSM building tag
  name: string | null
  h: number // height (m)
  mh: number // min height (m)
  hs: 'height' | 'levels' | 'estimate'
  lv?: string | null
  amenity?: string | null
}

export interface BuildingFeature {
  type: 'Feature'
  id: string
  geometry: { type: 'Polygon'; coordinates: number[][][] } | { type: 'MultiPolygon'; coordinates: number[][][][] }
  properties: BuildingProps
}

export interface BuildingCollection {
  type: 'FeatureCollection'
  metadata: { source: string; license: string; retrieved_at: string; count: number; height_sources: Record<string, number>; note: string }
  features: BuildingFeature[]
}

export interface BuildingIndex {
  ids: string[]
  props: BuildingProps[]
  centroids: [number, number][] // lon/lat
  starts: Int32Array // first vertex of each building in the merged mesh
  counts: Int32Array
}

const BASE = new THREE.Color('#f7f6f2')
const TALL = new THREE.Color('#eef0ee')

/**
 * Extrude real footprints into one merged, non-indexed mesh (one draw call)
 * plus a linework layer. Walls and roofs only (no hidden floor faces).
 * Vertex colours carry a cheap height-based occlusion term and allow
 * per-building highlighting without extra materials.
 */
export function buildBuildingGeometry(fc: BuildingCollection, frame: LocalFrame) {
  const pos: number[] = []
  const col: number[] = []
  const shades: number[] = []
  const edge: number[] = []
  const ids: string[] = []
  const props: BuildingProps[] = []
  const centroids: [number, number][] = []
  const starts: number[] = []
  const counts: number[] = []
  const c = new THREE.Color()

  const pushV = (x: number, y: number, z: number, shade: number, base: THREE.Color) => {
    pos.push(x, y, z)
    shades.push(shade)
    c.copy(base).multiplyScalar(shade)
    col.push(c.r, c.g, c.b)
  }

  for (const f of fc.features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
    const h = Math.max(2.5, f.properties.h)
    const mh = Math.max(0, Math.min(f.properties.mh || 0, h - 1))
    const base = h > 40 ? TALL : BASE
    const start = pos.length / 3
    let cx = 0
    let cy = 0
    let cn = 0
    for (const poly of polys) {
      // Rings in (east, north) metres; outer counter-clockwise, holes clockwise.
      const rings = poly.map((ring, k) => {
        const pts = ring.slice(0, -1).map(([lng, lat]) => {
          const [x, , z] = frame.toLocal(lng, lat)
          return new THREE.Vector2(x, -z)
        })
        const ccw = !THREE.ShapeUtils.isClockWise(pts)
        if ((k === 0) !== ccw) pts.reverse()
        return pts
      })
      if (!rings[0] || rings[0].length < 3) continue
      for (const p of rings[0]) {
        cx += p.x
        cy += p.y
        cn++
      }
      // Walls
      for (const ring of rings) {
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i]
          const b = ring[(i + 1) % ring.length]
          const ax = a.x, az = -a.y, bx = b.x, bz = -b.y
          const lo = 0.8
          const hi = 1.0
          const shadeTop = Math.min(hi, lo + (h / 30) * 0.2 + 0.12)
          // two triangles (a,b,c),(a,c,d): outward normals for CCW outer rings
          pushV(ax, mh, az, lo, base); pushV(bx, mh, bz, lo, base); pushV(bx, h, bz, shadeTop, base)
          pushV(ax, mh, az, lo, base); pushV(bx, h, bz, shadeTop, base); pushV(ax, h, az, shadeTop, base)
          edge.push(ax, h, az, bx, h, bz)
          // vertical corner lines where the outline turns
          const p = ring[(i - 1 + ring.length) % ring.length]
          const d1 = new THREE.Vector2(a.x - p.x, a.y - p.y).normalize()
          const d2 = new THREE.Vector2(b.x - a.x, b.y - a.y).normalize()
          if (d1.dot(d2) < 0.9) edge.push(ax, mh, az, ax, h, az)
        }
      }
      // Roof
      const tris = THREE.ShapeUtils.triangulateShape(rings[0], rings.slice(1))
      const all = rings.flat()
      for (const [i0, i1, i2] of tris) {
        const A = all[i0], B = all[i1], C = all[i2]
        const cross = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x)
        const tri = cross >= 0 ? [A, B, C] : [A, C, B]
        for (const v of tri) pushV(v.x, h, -v.y, 1.0, base)
      }
    }
    const count = pos.length / 3 - start
    if (count === 0) continue
    ids.push(f.id)
    props.push(f.properties)
    starts.push(start)
    counts.push(count)
    centroids.push(cn ? frame.toLngLat(cx / cn, -cy / cn) : [frame.lng, frame.lat])
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  const lines = new THREE.BufferGeometry()
  lines.setAttribute('position', new THREE.Float32BufferAttribute(edge, 3))
  const index: BuildingIndex = { ids, props, centroids, starts: Int32Array.from(starts), counts: Int32Array.from(counts) }
  return { geo, lines, index, baseColors: Float32Array.from(col), shades: Float32Array.from(shades) }
}

/** Index of the building owning a vertex (binary search over starts). */
export function buildingOfVertex(index: BuildingIndex, v: number): number {
  let lo = 0
  let hi = index.starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (index.starts[mid] <= v) lo = mid
    else hi = mid - 1
  }
  return lo
}
