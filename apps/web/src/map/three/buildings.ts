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

// Architectural massing palette: bright roofs over warm stone walls; towers a
// touch cooler. A small per-building variation keeps blocks from merging.
const ROOF = new THREE.Color('#fcfbf7')
const WALL = new THREE.Color('#e6e3db')
const TALL_ROOF = new THREE.Color('#eef2f3')
const TALL_WALL = new THREE.Color('#cfd9de') // towers read as glass

// Gentle material families by OSM building type (visual only): warm homes,
// cool offices and shops, stone institutions, darker outbuildings.
const FAMILY: Record<string, [string, string]> = {
  house: ['#ece7dd', '#fbf9f4'], detached: ['#ece7dd', '#fbf9f4'], semidetached_house: ['#ece7dd', '#fbf9f4'], bungalow: ['#ece7dd', '#fbf9f4'],
  terrace: ['#e9e3d8', '#f8f5ee'], residential: ['#e9e4da', '#f9f7f1'], apartments: ['#e5e0d5', '#f6f3ec'], dormitory: ['#e5e0d5', '#f6f3ec'],
  commercial: ['#e1e4e3', '#f3f4f3'], retail: ['#e1e4e3', '#f3f4f3'], office: ['#dde3e5', '#f1f4f5'], hotel: ['#dde3e5', '#f1f4f5'],
  hospital: ['#e7e5df', '#f8f7f3'], school: ['#e9e2d6', '#f7f3ea'], college: ['#e9e2d6', '#f7f3ea'], university: ['#e9e2d6', '#f7f3ea'],
  church: ['#e8e1d4', '#f5f1e8'], civic: ['#e4e3df', '#f4f4f1'], public: ['#e4e3df', '#f4f4f1'],
  garage: ['#dbd8d0', '#e8e6df'], garages: ['#dbd8d0', '#e8e6df'], shed: ['#dbd8d0', '#e8e6df'], carport: ['#dbd8d0', '#e8e6df'], parking: ['#d9dad6', '#e4e5e2'],
}
const familyCache = new Map<string, [THREE.Color, THREE.Color]>()
function family(type: string | undefined): [THREE.Color, THREE.Color] {
  const k = type ?? 'yes'
  let f = familyCache.get(k)
  if (!f) {
    const hex = FAMILY[k]
    f = hex ? [new THREE.Color(hex[0]), new THREE.Color(hex[1])] : [WALL, ROOF]
    familyCache.set(k, f)
  }
  return f
}

function vary(id: string | number, c: THREE.Color, out: THREE.Color) {
  let h = 2166136261
  for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  const k = 1 + (((h >>> 0) % 1000) / 1000 - 0.5) * 0.06 // +-3% brightness
  return out.copy(c).multiplyScalar(k)
}

/**
 * Extrude real footprints into one merged, non-indexed mesh (one draw call)
 * plus a linework layer. Walls and roofs only (no hidden floor faces).
 * Vertex colours carry a cheap height-based occlusion term and allow
 * per-building highlighting without extra materials.
 */
/** Builds the merged footprint mesh. Time-sliced: it yields to the browser every
 * few milliseconds so animations (the opening flight) never stall on it. */
export async function buildBuildingGeometry(fc: BuildingCollection, frame: LocalFrame, sliceMs = 6) {
  let tSlice = performance.now()
  const pos: number[] = []
  const col: number[] = []
  const shades: number[] = []
  const wall: number[] = [] // per vertex: metres along the facade, metres up, is-wall, is-tower (facade shader)
  const edge: number[] = []
  const ids: string[] = []
  const props: BuildingProps[] = []
  const centroids: [number, number][] = []
  const starts: number[] = []
  const counts: number[] = []
  const c = new THREE.Color()

  let wu = 0
  let wv = 0
  let wIs = 0
  let wTall = 0
  const pushV = (x: number, y: number, z: number, shade: number, base: THREE.Color) => {
    pos.push(x, y, z)
    wall.push(wu, wv, wIs, wTall)
    shades.push(shade)
    c.copy(base).multiplyScalar(shade)
    col.push(c.r, c.g, c.b)
  }

  for (const f of fc.features) {
    if (performance.now() - tSlice > sliceMs) {
      await new Promise((r) => setTimeout(r, 0))
      tSlice = performance.now()
    }
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
    const h = Math.max(2.5, f.properties.h)
    const mh = Math.max(0, Math.min(f.properties.mh || 0, h - 1))
    const tall = h > 40
    const [famWall, famRoof] = family(f.properties.b)
    const wallC = vary(f.id, tall ? TALL_WALL : famWall, new THREE.Color())
    const roofC = vary(f.id, tall ? TALL_ROOF : famRoof, new THREE.Color())
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
      let runU = 0
      for (const ring of rings) {
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i]
          const b = ring[(i + 1) % ring.length]
          const ax = a.x, az = -a.y, bx = b.x, bz = -b.y
          // ambient occlusion: walls darken toward the ground
          const lo = 0.7
          const shadeTop = Math.min(1, lo + (h / 30) * 0.22 + 0.16)
          const len = Math.hypot(bx - ax, bz - az)
          wIs = 1
          wTall = tall ? 1 : 0
          const W = (u: number, v: number) => {
            wu = u
            wv = v
          }
          // two triangles (a,b,c),(a,c,d): outward normals for CCW outer rings
          W(runU, mh); pushV(ax, mh, az, lo, wallC); W(runU + len, mh); pushV(bx, mh, bz, lo, wallC); W(runU + len, h); pushV(bx, h, bz, shadeTop, wallC)
          W(runU, mh); pushV(ax, mh, az, lo, wallC); W(runU + len, h); pushV(bx, h, bz, shadeTop, wallC); W(runU, h); pushV(ax, h, az, shadeTop, wallC)
          runU += len
          edge.push(ax, h, az, bx, h, bz)
          // vertical corner lines where the outline turns
          const p = ring[(i - 1 + ring.length) % ring.length]
          const d1 = new THREE.Vector2(a.x - p.x, a.y - p.y).normalize()
          const d2 = new THREE.Vector2(b.x - a.x, b.y - a.y).normalize()
          if (d1.dot(d2) < 0.9) edge.push(ax, mh, az, ax, h, az)
        }
      }
      // Roof
      wIs = 0
      const tris = THREE.ShapeUtils.triangulateShape(rings[0], rings.slice(1))
      const all = rings.flat()
      for (const [i0, i1, i2] of tris) {
        const A = all[i0], B = all[i1], C = all[i2]
        const cross = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x)
        const tri = cross >= 0 ? [A, B, C] : [A, C, B]
        for (const v of tri) pushV(v.x, h, -v.y, 1.0, roofC)
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
  geo.setAttribute('aWall', new THREE.Float32BufferAttribute(wall, 4))
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
