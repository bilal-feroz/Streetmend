import * as THREE from 'three'
import type { LocalFrame } from './frame'

/** [lng, lat, crown radius m, height m, source (1 = OSM-mapped tree, 0 = generated position)] */
export type TreeRow = [number, number, number, number, number]
export interface TreeData {
  metadata: { count: number; counts: { osm: number; generated: number }; method: string }
  trees: TreeRow[]
}

const GREENS = ['#79a65a', '#86b166', '#6e9b52', '#93ba70', '#7faa5f', '#9cc27a', '#679449', '#8ab468'].map((c) => new THREE.Color(c))

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

/**
 * The tree canopy as two instanced meshes (crowns and trunks): thousands of
 * trees in two draw calls. Instances live in metres in the local frame; the
 * owner scales them with the buildings for the 2D/3D transition.
 */
export function buildTrees(data: TreeData, frame: LocalFrame) {
  const n = data.trees.length
  const crownGeo = crownGeometry()
  const trunkGeo = new THREE.CylinderGeometry(0.2, 0.32, 1, 6).translate(0, 0.5, 0)
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshLambertMaterial({ color: '#ffffff' }), n)
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: '#7d6a55' }), n)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const s = new THREE.Vector3()
  const t = new THREE.Vector3()
  const c = new THREE.Color()
  let h32 = 2166136261
  const rand = () => {
    h32 = Math.imul(h32 ^ (h32 >>> 15), 2246822507) >>> 0
    h32 = Math.imul(h32 ^ (h32 >>> 13), 3266489909) >>> 0
    return ((h32 ^= h32 >>> 16) >>> 0) / 4294967296
  }
  data.trees.forEach(([lng, lat, r, h], i) => {
    const [x, , z] = frame.toLocal(lng, lat)
    const cy = Math.max(r * 0.9, h - r * 0.85)
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2)
    crowns.setMatrixAt(i, m.compose(t.set(x, cy, z), q, s.set(r, r * 0.86, r)))
    c.copy(GREENS[Math.floor(rand() * GREENS.length)]).multiplyScalar(0.92 + rand() * 0.14)
    crowns.setColorAt(i, c)
    trunks.setMatrixAt(i, m.compose(t.set(x, 0, z), q, s.set(1, Math.max(1.5, cy - r * 0.5), 1)))
  })
  crowns.instanceMatrix.needsUpdate = true
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true
  trunks.instanceMatrix.needsUpdate = true
  crowns.castShadow = true
  trunks.castShadow = false
  crowns.renderOrder = 1
  crowns.computeBoundingSphere()
  trunks.computeBoundingSphere()
  return { crowns, trunks }
}
