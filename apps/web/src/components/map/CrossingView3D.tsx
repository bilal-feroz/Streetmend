import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useReducedMotion } from '../../lib/useReducedMotion'

interface Props {
  nearId: string
  farId: string
  nearOk: boolean
  farOk: boolean
  street: string
}

const W = 7 // half road width (m), illustrative
const CURB = 0.15

/**
 * Illustrative street-level crossing (conceptual geometry, not survey data):
 * road, two sidewalks with curbs, a crosswalk and the two curb-ramp positions.
 * A ramp is drawn when its modeled state is repaired; otherwise the curb is a
 * vertical drop. The walking line stops at the first blocked end.
 */
export function CrossingView3D({ nearId, farId, nearOk, farOk, street }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const labels = useRef<HTMLDivElement>(null)
  const api = useRef<{ setState: (a: boolean, b: boolean) => void; setView: (v: 'overhead' | 'street') => void } | null>(null)
  const [view, setView] = useState<'overhead' | 'street'>('overhead')
  const reduced = useReducedMotion()

  useEffect(() => {
    const el = host.current
    if (!el) return
    const w = el.clientWidth
    const h = el.clientHeight
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    renderer.setSize(w, h)
    el.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(38, w / h, 0.1, 200)
    scene.add(new THREE.HemisphereLight('#ffffff', '#c8c2b5', 1.6))
    const sun = new THREE.DirectionalLight('#fff4e4', 1.6)
    sun.position.set(-8, 14, 9)
    scene.add(sun)
    const mat = (c: string) => new THREE.MeshLambertMaterial({ color: c })
    const disposables: (THREE.BufferGeometry | THREE.Material)[] = []
    const box = (sx: number, sy: number, sz: number, c: string, x: number, y: number, z: number) => {
      const g = new THREE.BoxGeometry(sx, sy, sz)
      const m = mat(c)
      disposables.push(g, m)
      const mesh = new THREE.Mesh(g, m)
      mesh.position.set(x, y, z)
      scene.add(mesh)
      return mesh
    }
    // road + sidewalks (west = near, east = far)
    box(2 * W, 0.02, 22, '#6b716c', 0, -0.01, 0)
    box(6, CURB, 22, '#dedbd2', -W - 3, CURB / 2, 0)
    box(6, CURB, 22, '#dedbd2', W + 3, CURB / 2, 0)
    for (let z = -10; z <= 10; z += 2.6) box(0.12, 0.022, 1.3, '#d9cfa0', 0, 0.002, z) // centre line
    for (let x = -W + 0.6; x <= W - 0.4; x += 1.1) box(0.55, 0.024, 3, '#f4f4f0', x, 0.004, 0) // zebra
    // ramps: wedges cut into the sidewalk at each end of the crosswalk
    const makeRamp = (side: -1 | 1) => {
      const g = new THREE.BufferGeometry()
      const x0 = side * W
      const x1 = side * (W + 1.6)
      // prettier-ignore
      const v = new Float32Array([
        x0, 0.005, -1.4,  x1, CURB + 0.004, -1.4,  x1, CURB + 0.004, 1.4,
        x0, 0.005, -1.4,  x1, CURB + 0.004, 1.4,   x0, 0.005, 1.4,
      ])
      g.setAttribute('position', new THREE.BufferAttribute(v, 3))
      g.computeVertexNormals()
      const m = new THREE.MeshLambertMaterial({ color: '#b9dccb', side: THREE.DoubleSide })
      disposables.push(g, m)
      const mesh = new THREE.Mesh(g, m)
      const pad = box(0.5, 0.012, 2.6, '#d8b34a', side * (W + 0.3), 0.03, 0) // detectable warning surface
      const curbMark = box(0.08, CURB + 0.02, 2.9, '#d85e51', side * W, CURB / 2, 0) // blocked: vertical curb drop
      scene.add(mesh)
      return { mesh, pad, curbMark }
    }
    const near = makeRamp(-1)
    const far = makeRamp(1)
    // walking line
    const pathMat = new LineMat()
    const path = new THREE.Line(new THREE.BufferGeometry(), pathMat.ok)
    const pathRest = new THREE.Line(new THREE.BufferGeometry(), pathMat.rest)
    scene.add(path, pathRest)
    disposables.push(pathMat.ok, pathMat.rest)

    const state = { a: nearOk ? 1 : 0, b: farOk ? 1 : 0 }
    const target = { a: state.a, b: state.b }
    const apply = () => {
      for (const [r, k] of [[near, state.a], [far, state.b]] as const) {
        r.mesh.scale.y = Math.max(0.001, k)
        r.mesh.visible = k > 0.02
        r.pad.visible = k > 0.5
        r.curbMark.visible = k < 0.5
      }
      const stopNear = state.a < 0.5
      const stopFar = !stopNear && state.b < 0.5
      const end = stopNear ? -W - 0.2 : stopFar ? W - 0.1 : W + 4
      const pts = [new THREE.Vector3(-W - 4, CURB + 0.05, 0), new THREE.Vector3(end, stopNear ? CURB + 0.05 : 0.06, 0)]
      if (!stopNear && !stopFar) pts.splice(1, 0, new THREE.Vector3(-W, 0.06, 0), new THREE.Vector3(W, 0.06, 0))
      path.geometry.dispose()
      path.geometry = new THREE.BufferGeometry().setFromPoints(pts)
      ;(path.material as THREE.LineBasicMaterial).color.set(stopNear || stopFar ? '#d85e51' : '#198568')
      pathRest.geometry.dispose()
      pathRest.geometry = new THREE.BufferGeometry().setFromPoints(stopNear || stopFar ? [new THREE.Vector3(end, 0.06, 0), new THREE.Vector3(W + 4, CURB + 0.05, 0)] : [])
      pathRest.computeLineDistances()
    }
    const views = {
      overhead: { pos: new THREE.Vector3(-6, 17, 15), look: new THREE.Vector3(0, 0, 0) },
      street: { pos: new THREE.Vector3(-W - 3.2, 1.3, 2.4), look: new THREE.Vector3(W, 0.4, -0.6) },
    }
    let raf = 0
    const render = () => {
      renderer.render(scene, camera)
      // project labels
      const box2 = el.getBoundingClientRect()
      const place = (key: string, p: THREE.Vector3) => {
        const node = labels.current?.querySelector<HTMLElement>(`[data-k="${key}"]`)
        if (!node) return
        const v = p.clone().project(camera)
        node.style.transform = `translate(${((v.x + 1) / 2) * box2.width}px, ${((1 - v.y) / 2) * box2.height}px) translate(-50%, -120%)`
        node.style.opacity = v.z < 1 ? '1' : '0'
      }
      place('a', new THREE.Vector3(-W - 0.8, 0.6, 1.6))
      place('b', new THREE.Vector3(W + 0.8, 0.6, 1.6))
    }
    const tick = () => {
      let moving = false
      for (const k of ['a', 'b'] as const) {
        const d = target[k] - state[k]
        if (Math.abs(d) > 0.01) {
          state[k] += d * 0.18
          moving = true
        } else state[k] = target[k]
      }
      apply()
      render()
      if (moving) raf = requestAnimationFrame(tick)
    }
    const setCam = (v: 'overhead' | 'street') => {
      camera.position.copy(views[v].pos)
      camera.lookAt(views[v].look)
      render()
    }
    api.current = {
      setState: (a, b) => {
        target.a = a ? 1 : 0
        target.b = b ? 1 : 0
        if (reduced) {
          state.a = target.a
          state.b = target.b
        }
        cancelAnimationFrame(raf)
        tick()
      },
      setView: setCam,
    }
    apply()
    setCam('overhead')
    return () => {
      cancelAnimationFrame(raf)
      disposables.forEach((d) => d.dispose())
      path.geometry.dispose()
      pathRest.geometry.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
      api.current = null
    }
  }, [reduced]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => api.current?.setState(nearOk, farOk), [nearOk, farOk])
  useEffect(() => api.current?.setView(view), [view])

  return (
    <figure className="m-0" aria-label={`Illustrative crossing of ${street}: ramp ${nearId} ${nearOk ? 'repaired' : 'blocked'}, ramp ${farId} ${farOk ? 'repaired' : 'blocked'}.`}>
      <div className="relative h-[168px] overflow-hidden rounded-md bg-[#eef1ec]">
        <div ref={host} className="absolute inset-0" />
        <div ref={labels} className="pointer-events-none absolute inset-0">
          {[['a', nearId, nearOk], ['b', farId, farOk]].map(([k, id, ok]) => (
            <div key={k as string} data-k={k as string} className={`absolute left-0 top-0 rounded px-1.5 py-0.5 text-[11px] font-bold text-white shadow ${ok ? 'bg-ok-ink' : 'bg-bad-ink'}`}>
              {id as string} {ok ? '✓' : '✕'}
            </div>
          ))}
        </div>
        <div className="absolute right-1.5 top-1.5 flex overflow-hidden rounded-md border border-line bg-paper/95 text-[11px]">
          {(['overhead', 'street'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} aria-pressed={view === v} className={`px-1.5 py-0.5 ${view === v ? 'bg-sel-bg font-semibold text-sel-ink' : 'text-ink-2'}`}>
              {v === 'overhead' ? 'Overhead' : 'Pedestrian'}
            </button>
          ))}
        </div>
      </div>
      <figcaption className="mt-1 text-[10.5px] leading-snug text-ink-3">Illustrative crossing: conceptual geometry, not surveyed dimensions or ADA slopes. Ramp states come from the model.</figcaption>
    </figure>
  )
}

class LineMat {
  ok = new THREE.LineBasicMaterial({ color: '#198568', linewidth: 3 })
  rest = new THREE.LineDashedMaterial({ color: '#8a968f', dashSize: 0.6, gapSize: 0.4 })
}
