import * as THREE from 'three'
import type { LocalFrame } from './frame'

/** [lng, lat, crown radius m, height m, source (1 = OSM-mapped tree, 0 = generated position)] */
export type TreeRow = [number, number, number, number, number]
export interface TreeData {
  metadata: { count: number; counts: { osm: number; generated: number }; method: string }
  trees: TreeRow[]
}

/**
 * How the canopy is drawn. The data holds the measured canopy amount; the 3D view
 * draws a lighter version so buildings stay the subject: every OSM-mapped tree,
 * a share of the generated ones, smaller crowns, and heights kept below most roofs.
 */
export const TREE_STYLE = { generatedShare: 0.42, crownScale: 0.7, maxHeight: 12 }

// Muted sage greens: the canopy reads as landscape, not as the main colour of the map.
const GREENS = ['#8fae7a', '#9ab884', '#86a571', '#a3bf8d', '#94b17f', '#7f9e6c', '#a9c495', '#8aa875'].map((c) => new THREE.Color(c))

/** A soft, slightly irregular crown: an icosphere nudged by a fixed pseudo-noise. */
function crownGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 1) // 80 triangles: tens of thousands stay cheap
  const p = g.getAttribute('position') as THREE.BufferAttribute
  const v = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    const n = Math.sin(v.x * 5.1 + v.y * 2.3) * 0.5 + Math.sin(v.z * 4.7 - v.x * 3.1) * 0.5
    v.multiplyScalar(1 + n * 0.09)
    if (v.y < -0.35) v.y = -0.35 + (v.y + 0.35) * 0.4 // flatter underside
    p.setXYZ(i, v.x, v.y, v.z)
  }
  g.computeVertexNormals()
  return g
}

export interface TreeMeshes {
  crowns: THREE.InstancedMesh
  trunks: THREE.InstancedMesh
  /** untouched instance matrices, so clearings can be applied and undone */
  baseCrowns: Float32Array
  baseTrunks: Float32Array
  /** local x, z per instance (for clearings) */
  xz: Float32Array
  drawn: number
}

/**
 * The tree canopy as two instanced meshes (crowns and trunks): thousands of
 * trees in two draw calls. Instances live in metres in the local frame; the
 * owner scales them with the buildings for the 2D/3D transition.
 */
export function buildTrees(data: TreeData, frame: LocalFrame): TreeMeshes {
  let h32 = 2166136261
  const rand = () => {
    h32 = Math.imul(h32 ^ (h32 >>> 15), 2246822507) >>> 0
    h32 = Math.imul(h32 ^ (h32 >>> 13), 3266489909) >>> 0
    return ((h32 ^= h32 >>> 16) >>> 0) / 4294967296
  }
  const keep = data.trees.filter(([, , , , src]) => src === 1 || rand() < TREE_STYLE.generatedShare)
  const n = keep.length
  const crownGeo = crownGeometry()
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 1, 6).translate(0, 0.5, 0)
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshLambertMaterial({ color: '#ffffff' }), n)
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: '#86745f' }), n)
  const xz = new Float32Array(n * 2)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const s = new THREE.Vector3()
  const t = new THREE.Vector3()
  const c = new THREE.Color()
  keep.forEach(([lng, lat, r0, h0], i) => {
    const [x, , z] = frame.toLocal(lng, lat)
    const r = r0 * TREE_STYLE.crownScale
    const h = Math.min(h0, TREE_STYLE.maxHeight, 3.5 + r * 2)
    const cy = Math.max(r * 0.95, h - r * 0.85)
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2)
    crowns.setMatrixAt(i, m.compose(t.set(x, cy, z), q, s.set(r, r * 0.86, r)))
    c.copy(GREENS[Math.floor(rand() * GREENS.length)]).multiplyScalar(0.94 + rand() * 0.1)
    crowns.setColorAt(i, c)
    trunks.setMatrixAt(i, m.compose(t.set(x, 0, z), q, s.set(1, Math.max(1.4, cy - r * 0.5), 1)))
    xz[i * 2] = x
    xz[i * 2 + 1] = z
  })
  crowns.instanceMatrix.needsUpdate = true
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true
  trunks.instanceMatrix.needsUpdate = true
  crowns.castShadow = true
  trunks.castShadow = false
  crowns.renderOrder = 1
  crowns.computeBoundingSphere()
  trunks.computeBoundingSphere()
  return {
    crowns,
    trunks,
    baseCrowns: Float32Array.from(crowns.instanceMatrix.array),
    baseTrunks: Float32Array.from(trunks.instanceMatrix.array),
    xz,
    drawn: n,
  }
}

/**
 * Hides trees within `radius` metres of the given local polylines (the selected
 * journey), so the route and its crossing are never buried under canopy.
 */
export function applyClearing(t: TreeMeshes, paths: [number, number][][], radius: number) {
  const cm = t.crowns.instanceMatrix.array as Float32Array
  const tm = t.trunks.instanceMatrix.array as Float32Array
  cm.set(t.baseCrowns)
  tm.set(t.baseTrunks)
  const r2 = radius * radius
  const segs: number[][] = []
  for (const p of paths) for (let i = 0; i < p.length - 1; i++) segs.push([p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]])
  for (const p of paths) if (p.length === 1) segs.push([p[0][0], p[0][1], p[0][0], p[0][1]])
  if (segs.length) {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity
    for (const [ax, az, bx, bz] of segs) {
      minX = Math.min(minX, ax, bx); maxX = Math.max(maxX, ax, bx)
      minZ = Math.min(minZ, az, bz); maxZ = Math.max(maxZ, az, bz)
    }
    const n = t.drawn
    for (let i = 0; i < n; i++) {
      const x = t.xz[i * 2]
      const z = t.xz[i * 2 + 1]
      if (x < minX - radius || x > maxX + radius || z < minZ - radius || z > maxZ + radius) continue
      for (const [ax, az, bx, bz] of segs) {
        const dx = bx - ax
        const dz = bz - az
        const l2 = dx * dx + dz * dz
        const u = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0
        const ex = ax + u * dx - x
        const ez = az + u * dz - z
        if (ex * ex + ez * ez < r2) {
          cm.fill(0, i * 16, i * 16 + 16)
          tm.fill(0, i * 16, i * 16 + 16)
          break
        }
      }
    }
  }
  t.crowns.instanceMatrix.needsUpdate = true
  t.trunks.instanceMatrix.needsUpdate = true
}
