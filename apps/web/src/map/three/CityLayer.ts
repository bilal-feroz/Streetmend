import type { CustomLayerInterface, CustomRenderMethodInput, Map as MLMap } from 'maplibre-gl'
import * as THREE from 'three'
import { buildBuildingGeometry, buildingOfVertex, type BuildingCollection, type BuildingIndex } from './buildings'
import type { LocalFrame } from './frame'
import { HealEffect } from './heal'
import { applyClearing, buildTrees, type TreeData, type TreeMeshes } from './trees'
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
  private markerScenes: Record<Side, THREE.Scene> = { before: new THREE.Scene(), after: new THREE.Scene() }
  readonly networks: Record<Side, NetworkLayer>
  readonly markers: Record<Side, MarkerLayer>
  private resolution = new THREE.Vector2(1, 1)
  private P = new THREE.Matrix4()
  private M = new THREE.Matrix4()
  private VP = new THREE.Matrix4()
  private VPinv = new THREE.Matrix4()
  private buildingGroup = new THREE.Group()
  private heal = new HealEffect()
  private treeGroup = new THREE.Group()
  treeCount = 0
  private buildingMesh: THREE.Mesh | null = null
  private buildingLines: THREE.LineSegments | null = null
  private contactMesh: THREE.Mesh | null = null
  private baseColors: Float32Array | null = null
  private shades: Float32Array | null = null
  index: BuildingIndex | null = null
  private ground: THREE.Mesh | null = null
  private sun = new THREE.DirectionalLight('#fff6e6', 2.75)
  private anims = new Map<string, Anim>()
  private shadowDirty = true
  private height = 1 // building height scale (0 = flat, 2D)
  private overlayAlpha = 1
  private alphaDirty = false
  private view: Side | { split: number } = 'after'
  private ready = false
  onRender: (() => void) | null = null

  constructor(frame: LocalFrame) {
    this.frame = frame
    this.networks = { before: new NetworkLayer(frame, this.resolution), after: new NetworkLayer(frame, this.resolution) }
    this.markers = { before: new MarkerLayer(frame), after: new MarkerLayer(frame) }
    for (const side of ['before', 'after'] as Side[]) {
      this.scenes[side].add(this.networks[side].group)
      this.markerScenes[side].add(this.markers[side].group)
    }
    this.camera.matrixAutoUpdate = false
    this.camera.matrixWorldAutoUpdate = false
    this.sceneMain.add(this.buildingGroup)
    this.buildingGroup.add(this.treeGroup)
    this.markerScenes.after.add(this.heal.group)
    // Daylight: a modest sky fill and a stronger warm sun from the south-west,
    // so lit and shaded facades read as separate planes.
    this.sceneMain.add(new THREE.HemisphereLight('#ffffff', '#a59f92', 1.2))
    this.sceneMain.add(new THREE.AmbientLight('#ffffff', 0.16))
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

  /**
   * Second custom layer, added above the basemap labels: markers stay legible
   * over street names. It reuses this frame's camera and depth buffer, so a
   * marker behind a building is still hidden by it.
   */
  readonly overlay: CustomLayerInterface = {
    id: 'streetmend-markers',
    type: 'custom',
    renderingMode: '3d',
    render: () => {
      if (!this.ready) return
      this.renderer.resetState()
      this.renderer.setViewport(0, 0, this.resolution.x, this.resolution.y)
      this.renderSides(this.markerScenes)
    },
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
    // Software rasterisers (no usable GPU) cannot carry the tree canopy at interactive rates.
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER))
    this.softwareRenderer = /swiftshader|llvmpipe|software|basic render/i.test(name)
    this.ready = true
  }

  /** True when WebGL runs on a CPU rasteriser: heavy optional layers stay off. */
  softwareRenderer = false

  setTreesVisible(on: boolean) {
    this.treeGroup.userData.on = on
    this.shadowDirty = true
    this.repaint()
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
    this.treeGroup.visible = z > 12.4 && this.treeGroup.userData.on !== false // a canopy at regional zoom would only cost frames
    if (this.buildingLines) (this.buildingLines.material as THREE.LineBasicMaterial).opacity = THREE.MathUtils.clamp((z - 14.2) / 1.6, 0, 1) * 0.5 * this.height
    if (this.overlayAlpha < 1 || this.alphaDirty) this.applyOverlayAlpha()

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
    this.renderSides(this.scenes)
    this.onRender?.()
    const healing = this.heal.tick(now)
    if (this.anims.size || healing) this.map.triggerRepaint()
  }

  /** One scene per side; in split view the before side is scissored to the left. */
  private renderSides(scenes: Record<Side, THREE.Scene>) {
    const r = this.renderer
    if (typeof this.view === 'object') {
      const { x: w, y: h } = this.resolution
      const x = Math.round(this.view.split * w)
      r.setScissorTest(true)
      r.setScissor(0, 0, x, h)
      r.render(scenes.before, this.camera)
      r.setScissor(x, 0, w - x, h)
      r.render(scenes.after, this.camera)
      r.setScissorTest(false)
    } else {
      r.render(scenes[this.view], this.camera)
    }
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
  async setBuildings(fc: BuildingCollection) {
    const { geo, lines, contact, index, baseColors, shades } = await buildBuildingGeometry(fc, this.frame)
    if (!this.ready) return
    this.clearBuildings()
    this.shades = shades
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true })
    // Facade texture from geometry: floor lines and windows, cooler glass on towers. It is
    // a visual cue only (no real window data) and fades out where it would shimmer.
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = 'attribute vec4 aWall;\nvarying vec4 vWall;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vWall = aWall;')
      sh.fragmentShader =
        'varying vec4 vWall;\n' +
        sh.fragmentShader.replace(
          '#include <color_fragment>',
          `#include <color_fragment>
  if (vWall.z > 0.5) {
    vec2 cell = vec2(vWall.x / 3.1, vWall.y / 3.4);
    vec2 f = fract(cell);
    float win = step(0.3, f.y) * step(f.y, 0.8) * step(0.16, f.x) * step(f.x, 0.84);
    float band = step(f.y, 0.06);
    vec2 w = fwidth(cell);
    float fade = clamp(1.6 - max(w.x, w.y) * 3.2, 0.0, 1.0) * step(1.2, vWall.y);
    vec3 glass = mix(vec3(0.62, 0.6, 0.56), vec3(0.5, 0.6, 0.66), vWall.w);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * glass * 1.08, win * fade * mix(0.42, 0.62, vWall.w));
    diffuseColor.rgb *= 1.0 - band * fade * 0.06;
  }`,
        )
    }
    const mesh = new THREE.Mesh(geo, mat)
    mesh.castShadow = true
    mesh.receiveShadow = false // facades are shaded by the sun direction; self-shadowing only added acne
    mesh.renderOrder = 1
    const lmat = new THREE.LineBasicMaterial({ color: '#57534b', transparent: true, opacity: 0.5, depthWrite: false })
    const lineObj = new THREE.LineSegments(lines, lmat)
    lineObj.renderOrder = 2
    // compile the building shaders off the critical path (KHR_parallel_shader_compile when available)
    try {
      const probe = new THREE.Scene()
      probe.add(mesh, lineObj)
      await this.renderer.compileAsync(probe, this.camera)
    } catch {
      /* falls back to compiling on first draw */
    }
    // soft ground-contact shadow around every footprint (ambient occlusion on the street)
    const contactMesh = new THREE.Mesh(contact, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }))
    contactMesh.renderOrder = 0
    this.buildingGroup.add(mesh, lineObj, contactMesh)
    this.contactMesh = contactMesh
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
      new THREE.ShadowMaterial({ color: '#1d2a26', opacity: 0.3, depthWrite: false }),
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
    for (const o of [this.buildingMesh, this.buildingLines, this.contactMesh]) {
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
    this.contactMesh = null
    this.ground = null
  }

  /** 0 = flat footprints (2D), 1 = full height (3D); animated for the mode switch. */
  setHeight(target: number, dur = 1100) {
    const from = this.height
    this.animate('height', dur, (k) => {
      this.height = from + (target - from) * k
      this.buildingGroup.scale.y = Math.max(0.001, this.height)
      if (this.ground) this.ground.visible = this.height > 0.15
      if (this.contactMesh) this.contactMesh.visible = this.height > 0.15
      this.shadowDirty = true
    })
  }

  /** The tree canopy (instanced crowns + trunks), scaled with the buildings for 2D/3D. */
  async setTrees(data: TreeData) {
    const meshes = buildTrees(data, this.frame)
    const { crowns, trunks } = meshes
    try {
      const probe = new THREE.Scene()
      probe.add(crowns, trunks)
      await this.renderer.compileAsync(probe, this.camera)
    } catch {
      /* compiled on first draw instead */
    }
    if (!this.ready) return
    for (const o of [...this.treeGroup.children]) {
      this.treeGroup.remove(o)
      ;(o as THREE.InstancedMesh).geometry.dispose()
      ;((o as THREE.InstancedMesh).material as THREE.Material).dispose()
    }
    this.treeGroup.add(crowns, trunks)
    this.trees = meshes
    this.treeCount = data.trees.length
    this.treesDrawn = meshes.drawn
    if (this.clearing) applyClearing(meshes, this.clearing.paths, this.clearing.radius)
    this.shadowDirty = true
    this.repaint()
  }

  private trees: TreeMeshes | null = null
  private clearing: { paths: [number, number][][]; radius: number } | null = null
  treesDrawn = 0

  /** Keeps the canopy off the selected journey (lng/lat polylines): it always stays readable. */
  setTreeClearing(paths: [number, number][][], radius: number) {
    const local = paths.map((p) => p.map(([lng, lat]) => {
      const [x, , z] = this.frame.toLocal(lng, lat)
      return [x, z] as [number, number]
    }))
    this.clearing = { paths: local, radius }
    if (this.trees) {
      applyClearing(this.trees, local, radius)
      this.shadowDirty = true
      this.repaint()
    }
  }

  /** Direct height control (the opening animation drives it per frame). */
  setHeightNow(h: number) {
    this.anims.delete('height')
    this.height = h
    this.buildingGroup.scale.y = Math.max(0.001, h)
    if (this.ground) this.ground.visible = h > 0.15
      if (this.contactMesh) this.contactMesh.visible = h > 0.15
    this.shadowDirty = true
    this.repaint()
  }

  /** Fade the analytical overlay (network, route, markers) as a whole. */
  setOverlayAlpha(a: number) {
    this.overlayAlpha = Math.max(0, Math.min(1, a))
    this.alphaDirty = true
    this.repaint()
  }

  private applyOverlayAlpha() {
    const a = this.overlayAlpha
    for (const s of ['before', 'after'] as Side[]) {
      for (const g of [this.networks[s].group, this.markers[s].group]) {
        g.visible = a > 0.001
        g.traverse((o) => {
          const m = (o as THREE.Mesh).material as THREE.Material | undefined
          if (!m || Array.isArray(m)) return
          if (m.userData.baseOpacity === undefined) m.userData.baseOpacity = m.opacity
          m.opacity = m.userData.baseOpacity * a
          m.transparent = true
        })
      }
    }
    this.alphaDirty = a < 1
  }

  setBuildingsVisible(on: boolean) {
    this.buildingGroup.visible = on
    if (this.ground) this.ground.visible = on && this.height > 0.15
      if (this.contactMesh) this.contactMesh.visible = on && this.height > 0.15
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

  /** Plays the heal effect where a repair was applied. */
  healAt(lng: number, lat: number) {
    const [x, , z] = this.frame.toLocal(lng, lat)
    this.heal.play(x, z)
    this.repaint()
  }

  dispose() {
    this.heal.dispose()
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
