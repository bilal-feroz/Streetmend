import { LngLat } from 'maplibre-gl'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { useReducedMotion } from '../lib/useReducedMotion'
import type { Cam, MapHandle } from '../map/MapView'
import { useApp } from '../state/store'
import { Logo } from '../components/Header'
import { CHARLOTTE, latOf, lngOf, loadUsGeometry, mx, my, NC_LABEL, US_BOUNDS, US_LABEL, introPadding, type UsGeometry } from './geo'

// Used only if the scenario never loads: the Elizabeth study area itself.
const FALLBACK: Cam = { center: [-80.8255, 35.2105], zoom: 15.3, pitch: 52, bearing: -30 }
const FLIGHT_MS = 2600
const SHORT_MS = 1500

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const smooth = (x: number) => {
  const t = clamp01(x)
  return t * t * (3 - 2 * t)
}
const inOut = (x: number) => {
  const t = clamp01(x)
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}
const ramp = (v: number, a: number, b: number) => smooth((v - a) / (b - a))
// Zoom is perceived logarithmically: a sine ease keeps the peak zoom rate near
// 1.6x the average (a cubic ease peaks at 3x and rushes the regional scales).
const sineInOut = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(x))
// zero velocity and zero acceleration at both ends: motion starts and settles without a jolt
const smoother = (x: number) => {
  const t = clamp01(x)
  return t * t * t * (t * (t * 6 - 15) + 10)
}

type Stage = 'usa' | 'nc' | 'charlotte' | 'city'

// Start fetching the national geometry as soon as this module loads, so the
// first painted frame is already the outline.
let geoPromise: Promise<UsGeometry> | null = null
const getGeo = () => (geoPromise ??= loadUsGeometry())
if (typeof window !== 'undefined' && useApp.getState().intro.kind === 'full') void getGeo().catch(() => undefined)

interface Virtual {
  x: number // camera centre, Mercator world units (512 px world)
  y: number
  z: number
}

/**
 * The opening: United States → North Carolina → Charlotte → Elizabeth.
 *
 * One MapLibre map and one camera throughout. Until the regional scale the
 * national outline is drawn on a canvas from a virtual camera in MapLibre's own
 * Web Mercator world units; from then on the virtual camera drives the real map
 * (jumpTo every frame) while the outline fades, so geography never jumps. The
 * final frame is the app's journey composition. Time-based, skippable, and it
 * gives up gracefully (fallback camera) if data or tiles never arrive.
 */
export function GeographicIntro({ handle, target }: { handle: MapHandle | null; target: (() => Cam | null) | null }) {
  const intro = useApp((s) => s.intro)
  const reduced = useReducedMotion()
  const targetRef = useRef(target)
  targetRef.current = target
  const [geo, setGeo] = useState<UsGeometry | 'failed' | null>(null)
  const [mounted, setMounted] = useState(intro.phase === 'running')
  const [stage, setStage] = useState<Stage>('usa')
  const [waiting, setWaiting] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const lbl = { us: useRef<HTMLDivElement>(null), nc: useRef<HTMLDivElement>(null), clt: useRef<HTMLDivElement>(null), cltText: useRef<HTMLSpanElement>(null), insets: useRef<HTMLDivElement>(null), mark: useRef<HTMLDivElement>(null) }
  const skip = useRef(false)

  const wantsGeo = intro.phase === 'running' && intro.kind === 'full' && !reduced
  useEffect(() => {
    if (!wantsGeo || geo) return
    getGeo().then(setGeo, () => setGeo('failed'))
  }, [wantsGeo, geo])

  // Self-check of the national geometry, read by the E2E suite: the highlighted
  // state must contain Charlotte and Raleigh and not Columbia, SC.
  useEffect(() => {
    if (!geo || geo === 'failed') return
    const ctx = document.createElement('canvas').getContext('2d')
    if (!ctx) return
    const inNC = ([lng, lat]: [number, number]) => ctx.isPointInPath(geo.nc, mx(lng), my(lat))
    ;(window as unknown as { __introCheck?: object }).__introCheck = {
      charlotte: inNC(CHARLOTTE),
      raleigh: inNC([-78.6382, 35.7796]),
      columbiaSC: inNC([-81.0348, 34.0007]),
      richmondVA: inNC([-77.436, 37.5407]),
    }
  }, [geo])

  useEffect(() => {
    if (intro.phase !== 'running') return
    skip.current = false
    setMounted(true)
    setStage('usa')
  }, [intro.phase, intro.nonce])

  useEffect(() => {
    if (intro.phase !== 'running' || !handle || !mounted) return // the canvas must exist first (replay remounts it)
    const kind = reduced ? 'none' : intro.kind === 'full' && geo === 'failed' ? 'short' : intro.kind
    if (kind === 'full' && !geo) return // geometry arrives in a moment; this effect reruns
    const g = kind === 'full' ? (geo as UsGeometry) : null
    const { map, layer } = handle
    const three = useApp.getState().mapMode === '3d'
    const container = map.getContainer()
    let raf = 0
    let cancelled = false
    let lastStage: Stage = 'usa'
    const t0 = performance.now()
    const frames: number[] = []
    let lastT = t0

    layer.setHeightNow(0)
    layer.setOverlayAlpha(0)

    // ---- starting camera --------------------------------------------------------------------
    const us = map.cameraForBounds(US_BOUNDS, { padding: introPadding(container) })
    const c0 = LngLat.convert(us?.center ?? [-96, 38])
    const z0 = us?.zoom ?? 3.5
    const V: Virtual = { x: mx(c0.lng), y: my(c0.lat), z: z0 }
    if (kind === 'full') map.jumpTo({ center: c0, zoom: z0, pitch: 0, bearing: 0 })
    const clt = { x: mx(CHARLOTTE[0]), y: my(CHARLOTTE[1]) }

    let F: Cam | null = null
    let preload: 'idle' | 'loading' | 'done' = 'idle'
    let regional: 'idle' | 'loading' | 'done' = kind === 'full' ? 'idle' : 'done'
    let worst = { ms: 0, t: 0, phase: '' }
    let tilesLate = false // a scale that never finished loading: keep the outline up longer
    let flightStart = -1
    let from: Virtual | null = null
    let landing = false

    const toCam = (v: Virtual, pitch = 0, bearing = 0) => ({ center: [lngOf(v.x), latOf(v.y)] as [number, number], zoom: v.z, pitch, bearing })

    /** Zoom about a geographic point: it keeps its screen position while the scale grows. */
    const zoomAbout = (v: Virtual, base: Virtual, p: { x: number; y: number }, z: number) => {
      const r = Math.pow(2, -(z - base.z))
      v.x = p.x + (base.x - p.x) * r
      v.y = p.y + (base.y - p.y) * r
      v.z = z
    }

    /** While the outline still covers the map, render the destination once so its
     * tiles, buildings and shadows are ready before the camera arrives. */
    const settle = (cam: Cam, ms: number) =>
        new Promise<void>((res) => {
          let done = false
          const end = (timedOut: boolean) => {
            if (done) return
            done = true
            if (timedOut) tilesLate = true
            res()
          }
          map.jumpTo(cam)
          map.once('idle', () => end(false))
          setTimeout(() => end(true), ms)
        })

    /** Regional scales along the way to the study area, while the outline still covers the map. */
    const startRegional = () => {
      regional = 'loading'
      const fx = mx(-80.8255)
      const fy = my(35.2105)
      void (async () => {
        // two scales are enough: MapLibre shows a loaded parent tile while children load
        for (const z of [7.4, 10.8]) {
          if (cancelled) return
          const r = Math.pow(2, -(z - z0))
          // wait for the tiles (the flight never starts on an empty map), within reason
          await settle({ center: [lngOf(fx + (mx(c0.lng) - fx) * r), latOf(fy + (my(c0.lat) - fy) * r)], zoom: z, pitch: 0, bearing: 0 }, 2500)
        }
        regional = 'done'
      })()
    }

    /** The destination itself: tiles, buildings and shadows rendered once before arrival. */
    const startPreload = () => {
      preload = 'loading'
      const f = (F = targetRef.current?.() ?? FALLBACK)
      void (async () => {
        if (kind !== 'full') await settle({ ...f, zoom: f.zoom - 1.8, pitch: 0 }, 900)
        if (cancelled) return
        layer.setHeightNow(three ? 1 : 0) // compile and shadow the full city once
        await settle(f, 2500)
        if (cancelled) return
        preload = 'done'
        layer.setHeightNow(0)
        if (kind === 'full') map.jumpTo(toCam(V))
      })()
    }

    const land = () => {
      if (landing) return
      landing = true
      const f = F ?? targetRef.current?.() ?? FALLBACK
      map.jumpTo(f)
      layer.setHeightNow(three ? 1 : 0)
      draw(1, true)
      const sorted = [...frames].sort((a, b) => a - b)
      ;(window as unknown as { __introStats?: object }).__introStats = {
        kind,
        frames: frames.length,
        avgMs: frames.length ? frames.reduce((a, b) => a + b, 0) / frames.length : 0,
        p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
        maxMs: sorted[sorted.length - 1] ?? 0,
        totalMs: performance.now() - t0,
        skipped: skip.current,
        worst,
      }
      useApp.getState().finishIntro()
      layer.animate('overlay-in', reduced ? 0 : 700, (k) => layer.setOverlayAlpha(k))
      // a camera request made while the intro owned the camera is replayed now
      if (!targetRef.current) useApp.getState().cameraTo({ preset: 'journey' })
      setTimeout(() => setMounted(false), reduced ? 0 : 420)
    }

    // ---- drawing: canvas outline + DOM labels, all from the virtual camera -------------------------
    const ctx = canvas.current?.getContext('2d') ?? null
    const fit = () => {
      const c = canvas.current
      if (!c) return
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      c.width = Math.round(window.innerWidth * dpr)
      c.height = Math.round(window.innerHeight * dpr)
    }
    fit()
    window.addEventListener('resize', fit)

    const place = (el: HTMLDivElement | null, lng: number, lat: number, alpha: number, ox = 0, oy = 0) => {
      if (!el) return
      const box = container.getBoundingClientRect()
      const k = Math.pow(2, V.z)
      const sx = box.left + box.width / 2 + (mx(lng) - V.x) * k
      const sy = box.top + box.height / 2 + (my(lat) - V.y) * k
      el.style.opacity = String(alpha)
      el.style.transform = `translate(${Math.round(sx + ox)}px, ${Math.round(sy + oy)}px)`
    }

    function draw(t: number, end = false) {
      const c = canvas.current
      if (!c || !ctx) return
      const dpr = c.width / window.innerWidth
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, c.width, c.height)
      if (end) return
      const box = container.getBoundingClientRect()
      const cx = box.left + box.width / 2
      const cy = box.top + box.height / 2
      if (kind !== 'full' || !g) {
        // short / none: a plain sheet that lifts as the city arrives
        ctx.fillStyle = `rgba(245,244,239,${kind === 'short' && flightStart > 0 ? 1 - ramp(t, 0, 0.35) : 1})`
        ctx.fillRect(0, 0, c.width, c.height)
        return
      }
      c.style.background = 'transparent'
      // If tiles were late (slow or no network), the outline holds until the 3D city takes over.
      const bgA = tilesLate ? 1 - ramp(V.z, 10.5, 12.8) : 1 - ramp(V.z, 5.3, 7.2)
      const lineA = tilesLate ? 1 - ramp(V.z, 10.5, 12.8) : 1 - ramp(V.z, 6.9, 9.3)
      const ncIn = ramp(t, 650, 1050)
      const ncA = ncIn * (1 - ramp(V.z, 5.8, 7.6))
      ctx.fillStyle = `rgba(245,244,239,${bgA})`
      ctx.fillRect(0, 0, c.width, c.height)
      const k = Math.pow(2, V.z)
      const drawIn = ramp(t, 0, 520)
      ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * (cx - V.x * k), dpr * (cy - V.y * k))
      ctx.globalAlpha = bgA * drawIn
      ctx.fillStyle = '#fdfcf8'
      ctx.fill(g.land)
      ctx.globalAlpha = ncA * 0.9
      ctx.fillStyle = '#087f63'
      ctx.fill(g.nc)
      ctx.globalAlpha = lineA * drawIn
      ctx.lineJoin = 'round'
      ctx.strokeStyle = `rgba(25,44,40,${0.3 - 0.1 * ncIn})`
      ctx.lineWidth = 0.75 / k
      ctx.stroke(g.borders)
      ctx.strokeStyle = `rgba(25,44,40,${0.88 - 0.25 * ncIn})`
      ctx.lineWidth = 1.25 / k
      ctx.stroke(g.outline)
      ctx.globalAlpha = lineA * ncIn
      ctx.strokeStyle = '#06664f'
      ctx.lineWidth = 1.4 / k
      ctx.stroke(g.nc)
      ctx.globalAlpha = 1
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      // labels and insets
      place(lbl.us.current, US_LABEL[0], US_LABEL[1], ramp(t, 150, 450) * (1 - ramp(t, 640, 940)), 0, 0)
      place(lbl.nc.current, NC_LABEL[0], NC_LABEL[1], ramp(t, 720, 1020) * (1 - ramp(V.z, 6.1, 6.9)), 0, 0)
      place(lbl.clt.current, CHARLOTTE[0], CHARLOTTE[1], ramp(t, 950, 1200) * (1 - ramp(V.z, 9.6, 11)), 0, 0)
      // the map's own city label takes over from zoom ~6, so ours steps aside first
      if (lbl.cltText.current) lbl.cltText.current.style.opacity = String(1 - ramp(V.z, 5.6, 6.3))
      place(lbl.insets.current, -123.6, 27.6, ramp(t, 120, 520) * (1 - ramp(t, 520, 860)))
      if (lbl.mark.current) lbl.mark.current.style.opacity = String(ramp(t, 200, 600) * (1 - ramp(V.z, 6.5, 8)))
    }

    const setStageOnce = (s: Stage) => {
      if (s !== lastStage) {
        lastStage = s
        setStage(s)
      }
    }

    // ---- the timeline ------------------------------------------------------------------------
    const tick = (now: number) => {
      if (cancelled) return
      const t = now - t0
      const dt = now - lastT
      frames.push(dt)
      if (dt > worst.ms) worst = { ms: Math.round(dt), t: Math.round(t), phase: `${flightStart < 0 ? 'stage1-2' : 'flight'} regional:${regional} preload:${preload}` }
      lastT = now
      if (skip.current) {
        land()
        return
      }
      if (kind === 'full') {
        if (flightStart < 0) {
          // Stages 1–2: the nation, then North Carolina; a gentle push toward Charlotte
          // that comes fully to rest, so the flight can start from stillness (no jolt).
          const dz = smoother((t - 520) / 1080)
          zoomAbout(V, { x: mx(c0.lng), y: my(c0.lat), z: z0 }, clt, z0 + dz)
          if (regional === 'idle' && t > 540) startRegional() // after the outline has drawn in: any first-render stall lands on a still frame
          if (regional === 'done' && preload === 'idle' && (targetRef.current || t > 9000)) startPreload()
          setWaiting(t > 2800)
          if (t >= 1650 && preload === 'done') {
            flightStart = now
            from = { ...V }
            map.jumpTo(toCam(V))
          }
          setStageOnce(t < 600 ? 'usa' : 'nc')
        } else {
          // Stages 3–4: one continuous flight into the composed city view.
          const f = F!
          const u = clamp01((now - flightStart) / FLIGHT_MS)
          const fx = mx(f.center[0])
          const fy = my(f.center[1])
          const z = from!.z + (f.zoom - from!.z) * sineInOut(u)
          const r = Math.pow(2, -(z - from!.z)) * (1 - smooth(ramp(u, 0.1, 1)))
          V.x = fx + (from!.x - fx) * r
          V.y = fy + (from!.y - fy) * r
          V.z = z
          const k3 = smoother((z - 10.8) / (f.zoom - 10.8)) // tilt and turn ease in as the city comes into view
          map.jumpTo(toCam(V, f.pitch * k3, f.bearing * k3))
          if (three) layer.setHeightNow(ramp(z, Math.max(12.6, f.zoom - 2.4), f.zoom))
          setStageOnce(z < 6.2 ? 'nc' : z < 11.5 ? 'charlotte' : 'city')
          setWaiting(false)
          if (u >= 1) {
            land()
            return
          }
        }
        draw(t)
      } else {
        // short (returning visit) or none (reduced motion): arrive at the city directly
        if (preload === 'idle' && (targetRef.current || t > 6000)) startPreload()
        if (preload === 'done' && flightStart < 0) {
          if (kind === 'none') {
            land()
            return
          }
          flightStart = now
          const f = F!
          map.jumpTo({ center: f.center, zoom: f.zoom - 1.8, pitch: 0, bearing: f.bearing - 24 })
        }
        if (flightStart > 0) {
          const f = F!
          const u = clamp01((now - flightStart) / SHORT_MS)
          const e = inOut(u)
          map.jumpTo({ center: f.center, zoom: f.zoom - 1.8 * (1 - e), pitch: f.pitch * smooth(u), bearing: f.bearing - 24 * (1 - e) })
          if (three) layer.setHeightNow(ramp(u, 0.3, 1))
          setStageOnce('city')
          draw(u)
          if (u >= 1) {
            land()
            return
          }
        } else draw(0)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') skip.current = true
    }
    window.addEventListener('keydown', onKey)
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', fit)
      window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intro.phase, intro.nonce, handle, geo, reduced, mounted])

  if (!mounted) return null
  const full = intro.kind === 'full' && !reduced
  return (
    <div className="fixed inset-0 z-[60]" data-testid="intro" data-stage={stage} role="presentation">
      {/* the sheet colour sits under the canvas until the first frame is drawn */}
      <canvas ref={canvas} className="absolute inset-0 h-full w-full bg-canvas" aria-hidden />
      <p className="sr-only" aria-live="polite">
        {stage === 'usa' ? 'United States' : stage === 'nc' ? 'North Carolina' : stage === 'charlotte' ? 'Charlotte' : 'Elizabeth, Charlotte'}
      </p>
      {full && (!geo || !handle) && (
        <div className="absolute inset-0 grid place-items-center" aria-hidden>
          <div className="flex items-center gap-3 text-[13px] font-extrabold tracking-[0.22em] text-ink">
            <Logo /> STREETMEND
          </div>
        </div>
      )}
      {full && (
        <>
          <div ref={lbl.us} className="pointer-events-none absolute left-0 top-0 -translate-x-1/2 opacity-0" aria-hidden>
            <span className="block -translate-x-1/2 text-[12px] font-semibold tracking-[0.42em] text-ink/70">UNITED STATES</span>
          </div>
          <div ref={lbl.nc} className="pointer-events-none absolute left-0 top-0 opacity-0" aria-hidden>
            <span className="block -translate-x-1/2 -translate-y-[160%] text-[11.5px] font-bold tracking-[0.3em] whitespace-nowrap text-ok-ink">NORTH CAROLINA</span>
          </div>
          <div ref={lbl.clt} className="pointer-events-none absolute left-0 top-0 opacity-0" aria-hidden>
            <span className="absolute -left-[5px] -top-[5px] block h-[10px] w-[10px] rounded-full border-2 border-white bg-ink shadow-[0_0_0_3px_rgba(25,44,40,0.14)]" />
            <span ref={lbl.cltText} className="absolute left-3 -top-[9px] block text-[13px] font-semibold whitespace-nowrap text-ink">
              Charlotte
            </span>
          </div>
          {geo && geo !== 'failed' && <Insets g={geo} boxRef={lbl.insets} />}
          <div ref={lbl.mark} className="pointer-events-none absolute bottom-8 left-8 opacity-0" aria-hidden>
            <div className="display text-[30px] text-ink">Fix the missing links.</div>
            <div className="mt-1 text-[12px] font-semibold tracking-[0.24em] text-ink-2">STREETMEND · CHARLOTTE, NC</div>
          </div>
        </>
      )}
      {waiting && <div className="absolute bottom-9 left-1/2 -translate-x-1/2 text-[12px] font-medium text-ink-2">Preparing the city…</div>}
      <button
        className="absolute right-6 bottom-7 rounded-full border border-ink/15 bg-paper/80 px-3.5 py-1.5 text-[12.5px] font-semibold text-ink backdrop-blur hover:bg-paper"
        onClick={() => (skip.current = true)}
        data-testid="intro-skip"
      >
        Skip intro
      </button>
    </div>
  )
}

/** Alaska and Hawaii as small insets of the opening frame (their own projections),
 * anchored off the Pacific coast of the contiguous map. */
function Insets({ g, boxRef }: { g: UsGeometry; boxRef: RefObject<HTMLDivElement | null> }) {
  return (
    <div ref={boxRef} className="pointer-events-none absolute left-0 top-0 flex items-end gap-5 opacity-0" aria-hidden>
      <svg width={g.insets.box.ak[0]} height={g.insets.box.ak[1]} className="overflow-visible">
        <path d={g.insets.ak} fill="#fdfcf8" stroke="rgba(25,44,40,0.7)" strokeWidth={0.9} />
      </svg>
      <svg width={g.insets.box.hi[0]} height={g.insets.box.hi[1]} className="overflow-visible">
        <path d={g.insets.hi} fill="#fdfcf8" stroke="rgba(25,44,40,0.7)" strokeWidth={0.9} />
      </svg>
    </div>
  )
}
