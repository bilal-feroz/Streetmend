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
const ROOF = new THREE.Color('#fdfcf8')
const WALL = new THREE.Color('#d9d4c9')
const TALL_ROOF = new THREE.Color('#eef2f3')
const TALL_WALL = new THREE.Color('#c3cfd6') // towers read as glass

// Gentle material families by OSM building type (visual only): warm homes,
// cool offices and shops, stone institutions, darker outbuildings.
const FAMILY: Record<string, [string, string]> = {
  house: ['#ded6c8', '#fdfbf6'], detached: ['#ded6c8', '#fdfbf6'], semidetached_house: ['#ded6c8', '#fdfbf6'], bungalow: ['#ded6c8', '#fdfbf6'],
  terrace: ['#dad1c2', '#fbf8f1'], residential: ['#dbd4c7', '#fcfaf4'], apartments: ['#d6cfc2', '#f9f7f1'], dormitory: ['#d6cfc2', '#f9f7f1'],
  commercial: ['#d2d7d7', '#f6f7f6'], retail: ['#d2d7d7', '#f6f7f6'], office: ['#cdd5d9', '#f4f6f7'], hotel: ['#cdd5d9', '#f4f6f7'],
  hospital: ['#d9d6ce', '#fbfaf6'], school: ['#dbd2c4', '#faf7ef'], college: ['#dbd2c4', '#faf7ef'], university: ['#dbd2c4', '#faf7ef'],
  church: ['#d9d0c0', '#f8f4eb'], civic: ['#d6d4cd', '#f7f7f4'], public: ['#d6d4cd', '#f7f7f4'],
  garage: ['#cfcbc2', '#ebe9e2'], garages: ['#cfcbc2', '#ebe9e2'], shed: ['#cfcbc2', '#ebe9e2'], carport: ['#cfcbc2', '#ebe9e2'], parking: ['#cdcecb', '#e6e7e4'],
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
  const skirt: number[] = [] // ground contact shadow around each footprint (x, y, z) ...
  const skirtA: number[] = [] // ... with an RGBA colour that fades outward
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
          const lo = 0.6
          const shadeTop = Math.min(1, lo + (h / 30) * 0.24 + 0.24)
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
          if (ring === rings[0] && mh < 0.5 && len > 0.2) {
            // outward normal (rings are CCW in east-north space; local z points south)
            const nx = (b.y - a.y) / len
            const nn = -(b.x - a.x) / len
            const W2 = 2.6
            const a2x = ax + nx * W2, a2z = az - nn * W2, b2x = bx + nx * W2, b2z = bz - nn * W2
            skirt.push(ax, 0.06, az, bx, 0.06, bz, b2x, 0.06, b2z, ax, 0.06, az, b2x, 0.06, b2z, a2x, 0.06, a2z)
            const k0 = [0.11, 0.13, 0.12, 0.2]
            const k1 = [0.11, 0.13, 0.12, 0]
            skirtA.push(...k0, ...k0, ...k1, ...k0, ...k1, ...k1)
          }
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
  const contact = new THREE.BufferGeometry()
  contact.setAttribute('position', new THREE.Float32BufferAttribute(skirt, 3))
  contact.setAttribute('color', new THREE.Float32BufferAttribute(skirtA, 4))
  const index: BuildingIndex = { ids, props, centroids, starts: Int32Array.from(starts), counts: Int32Array.from(counts) }
  return { geo, lines, contact, index, baseColors: Float32Array.from(col), shades: Float32Array.from(shades) }
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
