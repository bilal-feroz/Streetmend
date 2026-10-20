import type { CustomLayerInterface, CustomRenderMethodInput, Map as MLMap } from 'maplibre-gl'
import * as THREE from 'three'
import { buildBuildingGeometry, buildingOfVertex, type BuildingCollection, type BuildingIndex } from './buildings'
import type { LocalFrame } from './frame'
import { MarkerLayer, type MarkerSpec } from './markers'
import { NetworkLayer, type EdgeGeom, type NetCategory } from './network'

export type Side = 'before' | 'after'

const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3)

interface Anim {
  t0: number
  dur: number
  step: (k: number) => void
  done?: () => void
}

/**
 * Three.js city rendered inside MapLibre's WebGL context (custom 3D layer).
 *
 * Camera: MapLibre provides the perspective matrix P and the mercator
 * view-projection M. The Three.js view matrix is P^-1 * M * L (L = local
 * metres -> mercator), so Three.js renders with a standard perspective camera
 * that is exactly MapLibre's camera: geometry stays glued to the basemap at
 * every zoom, pitch and bearing, and lighting/shadows/line widths behave
 * normally. Nothing is positioned with CSS.
 */
export class CityLayer implements CustomLayerInterface {
  readonly id = 'streetmend-city'
  readonly type = 'custom' as const
  readonly renderingMode = '3d' as const

  frame: LocalFrame
  private map!: MLMap
  private renderer!: THREE.WebGLRenderer
  private camera = new THREE.Camera()
  private sceneMain = new THREE.Scene()
  private scenes: Record<Side, THREE.Scene> = { before: new THREE.Scene(), after: new THREE.Scene() }
  readonly networks: Record<Side, NetworkLayer>
  readonly markers: Record<Side, MarkerLayer>
  private resolution = new THREE.Vector2(1, 1)
  private P = new THREE.Matrix4()
  private M = new THREE.Matrix4()
  private VP = new THREE.Matrix4()
  private VPinv = new THREE.Matrix4()
  private buildingGroup = new THREE.Group()
  private buildingMesh: THREE.Mesh | null = null
  private buildingLines: THREE.LineSegments | null = null
  private baseColors: Float32Array | null = null
  private shades: Float32Array | null = null
  index: BuildingIndex | null = null
  private ground: THREE.Mesh | null = null
  private sun = new THREE.DirectionalLight('#fffaf0', 2.1)
  private anims = new Map<string, Anim>()
  private shadowDirty = true
  private height = 1 // building height scale (0 = flat, 2D)
  private view: Side | { split: number } = 'after'
  private ready = false
  onRender: (() => void) | null = null

  constructor(frame: LocalFrame) {
    this.frame = frame
    this.networks = { before: new NetworkLayer(frame, this.resolution), after: new NetworkLayer(frame, this.resolution) }
    this.markers = { before: new MarkerLayer(frame), after: new MarkerLayer(frame) }
    for (const side of ['before', 'after'] as Side[]) {
      this.scenes[side].add(this.networks[side].group, this.markers[side].group)
      this.scenes[side].matrixWorldAutoUpdate = true
    }
    this.camera.matrixAutoUpdate = false
    this.camera.matrixWorldAutoUpdate = false
    this.sceneMain.add(this.buildingGroup)
    // Daylight: soft sky fill + low warm sun from the south-west.
    this.sceneMain.add(new THREE.HemisphereLight('#ffffff', '#d9d6cf', 1.7))
    this.sceneMain.add(new THREE.AmbientLight('#ffffff', 0.25))
    const az = THREE.MathUtils.degToRad(215)
    const el = THREE.MathUtils.degToRad(38)
    this.sun.position.set(Math.sin(az) * Math.cos(el) * 3000, Math.sin(el) * 3000, -Math.cos(az) * Math.cos(el) * 3000)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(4096, 4096)
    this.sun.shadow.bias = -0.0004
    this.sun.shadow.normalBias = 0.8
    this.sun.shadow.radius = 2.5
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera
    sc.left = -2200
    sc.right = 2200
    sc.top = 2200
    sc.bottom = -2200
    sc.near = 100
    sc.far = 7000
    this.sceneMain.add(this.sun, this.sun.target)
  }

  // ---- MapLibre lifecycle -------------------------------------------------
  onAdd(map: MLMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl as WebGL2RenderingContext, antialias: true })
    this.renderer.autoClear = false
    this.renderer.setPixelRatio(1)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.shadowMap.autoUpdate = false
    this.ready = true
  }

  onRemove() {
    this.dispose()
  }

  render(gl: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput) {
    if (!this.ready) return
    const now = performance.now()
    this.P.fromArray(args.projectionMatrix as unknown as number[])
    this.M.fromArray(args.defaultProjectionData.mainMatrix as unknown as number[])
    const view = new THREE.Matrix4().copy(this.P).invert().multiply(this.M).multiply(this.frame.model)
    this.camera.projectionMatrix.copy(this.P)
    this.camera.projectionMatrixInverse.copy(this.P).invert()
    this.camera.matrixWorldInverse.copy(view)
    this.camera.matrixWorld.copy(view).invert()
    this.VP.multiplyMatrices(this.P, view)
    this.VPinv.copy(this.VP).invert()

    const w = gl.drawingBufferWidth
    const h = gl.drawingBufferHeight
    if (w !== this.resolution.x || h !== this.resolution.y) {
      this.resolution.set(w, h)
      this.networks.before.updateResolution()
      this.networks.after.updateResolution()
    }
    this.markers.before.updateScale(this.P.elements[5], h)
    this.markers.after.updateScale(this.P.elements[5], h)
    const z = this.map.getZoom()
    if (this.buildingLines) (this.buildingLines.material as THREE.LineBasicMaterial).opacity = THREE.MathUtils.clamp((z - 14.8) / 1.5, 0, 1) * 0.32 * this.height

    for (const [k, a] of this.anims) {
      const t = (now - a.t0) / a.dur
      a.step(ease(t))
      if (t >= 1) {
        this.anims.delete(k)
        a.done?.()
      }
    }

    const r = this.renderer
    r.resetState()
    r.setViewport(0, 0, w, h)
    r.clearDepth()
    if (this.shadowDirty && this.buildingMesh) {
      r.shadowMap.needsUpdate = true
      this.shadowDirty = false
    }
    r.render(this.sceneMain, this.camera)
    if (typeof this.view === 'object') {
      const x = Math.round(this.view.split * w)
      r.setScissorTest(true)
      r.setScissor(0, 0, x, h)
      r.render(this.scenes.before, this.camera)
      r.setScissor(x, 0, w - x, h)
      r.render(this.scenes.after, this.camera)
      r.setScissorTest(false)
    } else {
      r.render(this.scenes[this.view], this.camera)
    }
    this.onRender?.()
    if (this.anims.size) this.map.triggerRepaint()
  }

  private repaint() {
    this.map?.triggerRepaint()
  }

  animate(key: string, dur: number, step: (k: number) => void, done?: () => void) {
    if (dur <= 0) {
      step(1)
      done?.()
      this.anims.delete(key)
    } else this.anims.set(key, { t0: performance.now(), dur, step, done })
    this.repaint()
  }

  // ---- buildings -------------------------------------------------------------
  setBuildings(fc: BuildingCollection) {
    this.clearBuildings()
    const { geo, lines, index, baseColors, shades } = buildBuildingGeometry(fc, this.frame)
    this.shades = shades
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.renderOrder = 1
    const lmat = new THREE.LineBasicMaterial({ color: '#7d887f', transparent: true, opacity: 0.3, depthWrite: false })
    const lineObj = new THREE.LineSegments(lines, lmat)
    lineObj.renderOrder = 2
    this.buildingGroup.add(mesh, lineObj)
    this.buildingMesh = mesh
    this.buildingLines = lineObj
    this.index = index
    this.baseColors = baseColors
    // Shadow catcher over the area of interest.
    geo.computeBoundingBox()
    const bb = geo.boundingBox!
    const size = new THREE.Vector3()
    const center = new THREE.Vector3()
    bb.getSize(size)
    bb.getCenter(center)
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(size.x + 400, size.z + 400).rotateX(-Math.PI / 2),
      new THREE.ShadowMaterial({ color: '#1f3029', opacity: 0.2, depthWrite: false }),
    )
    ground.position.set(center.x, 0.05, center.z)
    ground.receiveShadow = true
    ground.renderOrder = 0
    this.ground = ground
    this.sceneMain.add(ground)
    this.sun.target.position.set(center.x, 0, center.z)
    this.sun.position.add(new THREE.Vector3(center.x, 0, center.z))
    this.buildingGroup.scale.y = Math.max(0.001, this.height)
    this.shadowDirty = true
    this.repaint()
  }

  private clearBuildings() {
    for (const o of [this.buildingMesh, this.buildingLines]) {
      if (!o) continue
      this.buildingGroup.remove(o)
      o.geometry.dispose()
      ;(o.material as THREE.Material).dispose()
    }
    if (this.ground) {
      this.sceneMain.remove(this.ground)
      this.ground.geometry.dispose()
      ;(this.ground.material as THREE.Material).dispose()
    }
    this.buildingMesh = null
    this.buildingLines = null
    this.ground = null
  }

  /** 0 = flat footprints (2D), 1 = full height (3D); animated for the mode switch. */
  setHeight(target: number, dur = 1100) {
    const from = this.height
    this.animate('height', dur, (k) => {
      this.height = from + (target - from) * k
      this.buildingGroup.scale.y = Math.max(0.001, this.height)
      if (this.ground) this.ground.visible = this.height > 0.15
      this.shadowDirty = true
    })
  }

  setBuildingsVisible(on: boolean) {
    this.buildingGroup.visible = on
    if (this.ground) this.ground.visible = on && this.height > 0.15
    this.repaint()
  }

  /** Tint selected buildings (index -> colour); others revert to their base colour. */
  tintBuildings(tints: Map<number, string>) {
    if (!this.buildingMesh || !this.baseColors || !this.index || !this.shades) return
    const attr = this.buildingMesh.geometry.getAttribute('color') as THREE.BufferAttribute
    const arr = attr.array as Float32Array
    arr.set(this.baseColors)
    const c = new THREE.Color()
    for (const [i, hex] of tints) {
      c.set(hex)
      const s = this.index.starts[i]
      const n = this.index.counts[i]
      for (let v = s; v < s + n; v++) {
        const shade = this.shades[v] // keep the occlusion gradient
        arr[v * 3] = c.r * shade
        arr[v * 3 + 1] = c.g * shade
        arr[v * 3 + 2] = c.b * shade
      }
    }
    attr.needsUpdate = true
    this.repaint()
  }

  // ---- network, markers, compare -----------------------------------------------
  setNetwork(side: Side, byCat: Partial<Record<NetCategory, EdgeGeom[]>>) {
    this.networks[side].setCategories(byCat)
    this.repaint()
  }

  setMarkers(side: Side, specs: MarkerSpec[]) {
    this.markers[side].set(specs)
    this.repaint()
  }

  setView(v: Side | { split: number }) {
    this.view = v
    this.repaint()
  }

  // ---- projection & picking ------------------------------------------------------
  /** Local point -> CSS pixel position on the map canvas (null if behind camera). */
  projectLocal(p: THREE.Vector3): [number, number] | null {
    const v = new THREE.Vector4(p.x, p.y, p.z, 1).applyMatrix4(this.VP)
    if (v.w <= 0) return null
    const c = this.map.getCanvas()
    return [((v.x / v.w + 1) / 2) * c.clientWidth, ((1 - v.y / v.w) / 2) * c.clientHeight]
  }

  project(lng: number, lat: number, alt = 0) {
    return this.projectLocal(new THREE.Vector3(...this.frame.toLocal(lng, lat, alt)))
  }

  /** Nearest marker to a screen point within its radius. */
  pickMarker(side: Side, px: number, py: number): string | null {
    let best: string | null = null
    let bestD = Infinity
    for (const m of this.markers[side].list()) {
      const s = this.projectLocal(m.local)
      if (!s) continue
      const d = Math.hypot(s[0] - px, s[1] - py)
      if (d <= m.px / 2 + 4 && d < bestD) {
        best = m.key
        bestD = d
      }
    }
    return best
  }

  /** Building under a screen point (ray cast against the real footprint mesh). */
  pickBuilding(px: number, py: number): number | null {
    if (!this.buildingMesh || !this.index || !this.buildingGroup.visible) return null
    const c = this.map.getCanvas()
    const nx = (px / c.clientWidth) * 2 - 1
    const ny = 1 - (py / c.clientHeight) * 2
    const near = new THREE.Vector4(nx, ny, -1, 1).applyMatrix4(this.VPinv)
    const far = new THREE.Vector4(nx, ny, 1, 1).applyMatrix4(this.VPinv)
    const a = new THREE.Vector3(near.x / near.w, near.y / near.w, near.z / near.w)
    const b = new THREE.Vector3(far.x / far.w, far.y / far.w, far.z / far.w)
    const ray = new THREE.Raycaster(a, b.sub(a).normalize())
    this.buildingGroup.updateMatrixWorld(true)
    const hit = ray.intersectObject(this.buildingMesh, false)[0]
    if (!hit || hit.faceIndex == null) return null
    return buildingOfVertex(this.index, hit.faceIndex * 3)
  }

  /** Alignment self-check: Three.js projection vs MapLibre's own projection. */
  alignmentReport(points: [number, number][]) {
    return points.map(([lng, lat]) => {
      const a = this.project(lng, lat, 0)
      const b = this.map.project([lng, lat])
      return a ? Math.hypot(a[0] - b.x, a[1] - b.y) : Infinity
    })
  }

  dispose() {
    this.anims.clear()
    this.clearBuildings()
    for (const s of ['before', 'after'] as Side[]) {
      this.networks[s].dispose()
      this.markers[s].dispose()
    }
    this.sun.shadow.map?.dispose()
    this.renderer?.renderLists.dispose()
    this.ready = false
  }
}
