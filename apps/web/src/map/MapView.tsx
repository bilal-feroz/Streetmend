import {
  GeoJSONSource,
  Map as MLMap,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type MapMouseEvent,
} from 'maplibre-gl'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { EvaluateResponse, ScenarioOut } from '../api/types'
import { useReducedMotion } from '../lib/useReducedMotion'
import { useApp } from '../state/store'
import type { BuildingCollection } from './three/buildings'
import { CityLayer, type Side } from './three/CityLayer'
import { LocalFrame } from './three/frame'
import { placeIcon, repairIcon, type PlaceKind, type RepairState } from './three/icons'
import type { MarkerSpec } from './three/markers'
import type { EdgeGeom, NetCategory } from './three/network'
import { baseStyle, FIRST_LABEL_LAYER } from './style'
import { MapLabels } from './MapLabels'
import { CompareSlider } from './CompareSlider'

// MapLibre v6 resolves its worker relative to its own module URL, which breaks
// once Vite bundles it. The self-contained worker is copied verbatim into
// public/ by the predev/prebuild scripts and served from there.
setWorkerUrl(new URL('maplibre-gl-worker.mjs', window.location.origin + import.meta.env.BASE_URL).href)

// Local frame origin: centre of the Elizabeth study area.
const ORIGIN: [number, number] = [-80.825, 35.212]

export interface MapHandle {
  map: MLMap
  layer: CityLayer
}

declare global {
  interface Window {
    __sm?: MapHandle & { alignment: (pts?: [number, number][]) => number[] }
  }
}

function categoryOf(state: string, hypothetical: boolean): NetCategory {
  if (state === 'repaired') return 'repaired'
  if (state === 'repairable') return 'blocked'
  if (state === 'blocked') return hypothetical ? 'setting' : 'blocked'
  if (state === 'unknown') return 'unknown'
  return 'traversable'
}

function networkByCategory(sc: ScenarioOut, ev: EvaluateResponse | null, selectedEdge: string | null, nearby: Set<string>) {
  const out: Partial<Record<NetCategory, EdgeGeom[]>> = {}
  const hypo = sc.mode === 'hypothetical'
  for (const e of sc.edges) {
    const st = ev?.edge_states[e.id] ?? e.state
    let cat = categoryOf(st, hypo)
    if (nearby.has(e.id) && cat === 'traversable') cat = 'nearby'
    ;(out[cat] ??= []).push({ id: e.id, coords: e.geometry })
    if (e.id === selectedEdge) (out.selected ??= []).push({ id: e.id, coords: e.geometry })
  }
  return out
}

export function MapView() {
  const ref = useRef<HTMLDivElement>(null)
  const [handle, setHandle] = useState<MapHandle | null>(null)
  const [buildingsReady, setBuildingsReady] = useState(false)
  const [basemapOk, setBasemapOk] = useState(true)
  const [zoom, setZoom] = useState(16)
  const reduced = useReducedMotion()

  const scenario = useApp((s) => s.scenario)
  const evaluation = useApp((s) => s.evaluation)
  const initialEval = useApp((s) => s.initialEval)
  const applied = useApp((s) => s.applied)
  const analysis = useApp((s) => s.analysis)
  const highlight = useApp((s) => s.highlight)
  const selected = useApp((s) => s.selected)
  const journey = useApp((s) => s.journey)
  const layers = useApp((s) => s.layers)
  const mapMode = useApp((s) => s.mapMode)
  const compare = useApp((s) => s.compare)
  const split = useApp((s) => s.split)
  const camera = useApp((s) => s.camera)
  const traceNonce = useApp((s) => s.traceNonce)
  const records = useApp((s) => s.records)
  const scenarioId = useApp((s) => s.scenarioId)

  // ---- map + city layer --------------------------------------------------------
  useEffect(() => {
    if (!ref.current) return
    const map = new MLMap({
      container: ref.current,
      style: baseStyle(),
      center: ORIGIN,
      zoom: 15.6,
      pitch: 50,
      bearing: -32,
      maxPitch: 72,
      attributionControl: { compact: true },
      canvasContextAttributes: { antialias: true },
      fadeDuration: 120,
    })
    map.addControl(new NavigationControl({ visualizePitch: true }), 'bottom-right')
    map.addControl(new ScaleControl({ unit: 'metric', maxWidth: 100 }), 'bottom-left')
    map.getCanvas().setAttribute('aria-label', 'Map of Elizabeth, Charlotte. All map information is also listed in the planning panel.')
    const frame = new LocalFrame(ORIGIN[0], ORIGIN[1])
    const layer = new CityLayer(frame)
    map.on('load', () => {
      map.addSource('records', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addSource('inventory', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'inv-lines', type: 'line', source: 'inventory', layout: { visibility: 'none', 'line-cap': 'round' },
        paint: { 'line-color': ['match', ['get', 'presence'], 'Sidewalk', '#3e8fb8', 'No Sidewalk', '#d85e51', '#dca344'], 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1, 18, 3.5], 'line-opacity': 0.75 },
      }, FIRST_LABEL_LAYER)
      map.addLayer(layer, FIRST_LABEL_LAYER)
      map.addLayer({
        id: 'rec-circles', type: 'circle', source: 'records', layout: { visibility: 'none' },
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 2.5, 18, 6.5],
          'circle-color': ['match', ['get', 'cat'], 'no_ramp', '#d85e51', 'noncompliant_severe', '#e08a3c', 'noncompliant_minor', '#8a968f', 'compliant', '#198568', 'remediated', '#2a9d8f', '#dca344'],
          'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.2, 'circle-pitch-alignment': 'map',
        },
      }, FIRST_LABEL_LAYER)
      map.addLayer({
        id: 'rec-selected', type: 'circle', source: 'records', filter: ['==', ['get', 'oid'], -1],
        paint: { 'circle-radius': 11, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#3568c8', 'circle-stroke-width': 2.5, 'circle-pitch-alignment': 'map' },
      }, FIRST_LABEL_LAYER)
      map.addLayer(layer.overlay)
      const h: MapHandle = { map, layer }
      window.__sm = {
        ...h,
        alignment: (pts) => layer.alignmentReport(pts ?? [[-80.8269, 35.2128], [-80.82, 35.208], [-80.8426, 35.2273], [-80.812, 35.216]]),
      }
      setHandle(h)
      fetch('/api/context/buildings')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((fc: BuildingCollection) => {
          layer.setBuildings(fc)
          setBuildingsReady(true)
        })
        .catch(() => setBuildingsReady(false))
    })
    map.on('error', (e) => {
      const msg = String((e as unknown as { error?: { message?: string } }).error?.message ?? '')
      if (/tiles\.openfreemap|Failed to fetch|NetworkError|openmaptiles/i.test(msg)) setBasemapOk(false)
    })
    map.on('zoomend', () => setZoom(map.getZoom()))
    return () => {
      map.remove()
      window.__sm = undefined
    }
  }, [])

  // ---- 2D / 3D --------------------------------------------------------------------
  useEffect(() => {
    if (!handle) return
    const { map, layer } = handle
    const dur = reduced ? 0 : 1200
    if (mapMode === '3d') {
      map.dragRotate.enable()
      map.touchPitch.enable()
      map.touchZoomRotate.enableRotation()
      map.keyboard.enableRotation()
      layer.setHeight(1, dur)
      if (map.getPitch() < 20) map.easeTo({ pitch: 55, bearing: map.getBearing() || -32, duration: dur })
    } else {
      map.dragRotate.disable()
      map.touchPitch.disable()
      map.touchZoomRotate.disableRotation()
      map.keyboard.disableRotation()
      layer.setHeight(0, dur)
      map.easeTo({ pitch: 0, bearing: 0, duration: dur })
    }
  }, [handle, mapMode, reduced])

  // ---- network state (before + after) -----------------------------------------------
  const nearby = useMemo(() => {
    const out = new Set<string>()
    if (selected?.type !== 'record' || !records || !scenario) return out
    const rec = records.ramps.find((r) => String(r.properties.OBJECTID) === selected.id)
    if (!rec) return out
    const [lng, lat] = rec.geometry.coordinates
    const kx = 111320 * Math.cos((lat * Math.PI) / 180)
    for (const e of scenario.edges) {
      const m = e.geometry[Math.floor(e.geometry.length / 2)]
      if (Math.hypot((m[0] - lng) * kx, (m[1] - lat) * 110574) < 45) out.add(e.id)
    }
    return out
  }, [selected, records, scenario])

  useEffect(() => {
    if (!handle || !scenario) return
    const selEdge = selected?.type === 'edge' ? selected.id : null
    handle.layer.setNetwork('after', layers.network ? networkByCategory(scenario, evaluation, selEdge, nearby) : {})
    handle.layer.setNetwork('before', layers.network ? networkByCategory(scenario, initialEval, selEdge, nearby) : {})
    for (const [side, ev] of [['after', evaluation], ['before', initialEval]] as [Side, EvaluateResponse | null][]) {
      const j = ev?.journey
      const net = handle.layer.networks[side]
      net.setPotential(layers.network && j && !j.route.found && j.potential_route ? (j.potential_route.geometry as [number, number][]) : null)
    }
  }, [handle, scenario, evaluation, initialEval, selected, layers.network, nearby])

  // ---- route + reach-wave animation (engine geometry only) ----------------------------
  useEffect(() => {
    if (!handle || !scenario) return
    const { layer } = handle
    const edgesById = new Map(scenario.edges.map((e) => [e.id, e]))
    for (const [side, ev] of [['after', evaluation], ['before', initialEval]] as [Side, EvaluateResponse | null][]) {
      const net = layer.networks[side]
      const j = ev?.journey
      if (!layers.network) {
        net.setRoute(null)
        net.clearWave()
        continue
      }
      net.setWave(Object.entries(j?.reach_wave ?? {}).flatMap(([id, d]) => (edgesById.has(id) ? [{ id, coords: edgesById.get(id)!.geometry, d }] : [])))
      net.setRoute(j?.route.found ? (j.route.geometry as [number, number][]) : null)
      const maxD = net.maxWave()
      const found = !!j?.route.found
      const waveOpacity = found ? 0.1 : 0.2
      if (reduced || side === 'before') {
        net.showWave(maxD + 1, waveOpacity)
        net.revealRoute(1)
        continue
      }
      net.revealRoute(0)
      layer.animate(`wave-${side}`, 900, (k) => net.showWave(maxD * k + 0.5, waveOpacity))
      if (found) {
        const len = j!.route.length_m ?? 300
        // once traced, let the route carry the view: the reach wave settles back
        layer.animate(`route-${side}`, Math.min(2600, 700 + len * 2.4), (k) => net.revealRoute(k), () =>
          layer.animate(`wavefade-${side}`, 1200, (k) => net.setWaveOpacity(waveOpacity * (1 - 0.55 * k))),
        )
      }
    }
  }, [handle, scenario, evaluation, initialEval, traceNonce, reduced, layers.network])

  // ---- markers ----------------------------------------------------------------------
  useEffect(() => {
    if (!handle || !scenario) return
    const municipal = scenario.mode === 'municipal'
    const hypo = scenario.mode === 'hypothetical'
    const recommended = new Set(analysis?.recommendation.selected ?? [])
    const hl = new Set(highlight)
    for (const [side, ev, app] of [['after', evaluation, applied], ['before', initialEval, [] as string[]]] as [Side, EvaluateResponse | null, string[]][]) {
      const specs: MarkerSpec[] = []
      if (layers.candidates) {
        for (const iv of scenario.interventions) {
          const isRec = recommended.has(iv.id) || hl.has(iv.id)
          const isSel = selected?.type === 'intervention' && selected.id === iv.id
          if (municipal && !isRec && !isSel && zoom < 15.2) continue // simplify when zoomed out
          const state: RepairState = app.includes(iv.id) ? 'repaired' : isRec ? 'recommended' : 'blocked'
          const label = iv.id.length <= 2 ? iv.id : null
          const px = isSel ? 34 : isRec || state === 'repaired' ? 26 : municipal ? 15 : 21
          specs.push({
            key: `iv:${iv.id}`, lng: iv.lon, lat: iv.lat, alt: municipal && !isRec ? 2.5 : 6, px, stem: !(municipal && !isRec),
            iconKey: `r:${state}:${label}:${isSel}:${hypo}`, icon: () => repairIcon(state, label, isSel, hypo), order: isSel ? 30 : isRec ? 20 : 10,
          })
        }
      }
      if (layers.places) {
        const reached = new Set(ev?.journey?.reached_destinations ?? [])
        const found = !!ev?.journey?.route.found
        for (const o of scenario.origins) {
          const isJ = journey?.origin === o.id
          if (municipal && !isJ && zoom < 15.6) continue
          specs.push(placeSpec(`pl:${o.id}`, o.lon, o.lat, 'origin', isJ ? '#3568c8' : null, isJ ? 26 : municipal ? 14 : 18, !isJ && municipal))
        }
        for (const d of scenario.destinations) {
          const isJ = journey?.destination === d.id
          const ring = isJ ? (found ? '#198568' : '#d85e51') : null
          specs.push(placeSpec(`pl:${d.id}`, d.lon, d.lat, d.category as PlaceKind, ring, isJ ? 28 : municipal ? 16 : 20, !isJ && !reached.has(d.id) && municipal))
        }
      }
      handle.layer.setMarkers(side, specs)
    }
  }, [handle, scenario, evaluation, initialEval, applied, analysis, highlight, selected, journey, layers.candidates, layers.places, zoom])

  // ---- buildings: visibility + destination / selection tint ---------------------------
  const destBuilding = useMemo(() => {
    if (!handle || !buildingsReady || !scenario || !journey) return null
    const d = scenario.destinations.find((x) => x.id === journey.destination)
    return d ? buildingAt(handle.layer, d.lon, d.lat) : null
  }, [handle, buildingsReady, scenario, journey])

  useEffect(() => {
    if (!handle || !buildingsReady) return
    const tints = new Map<number, string>()
    if (destBuilding !== null) tints.set(destBuilding, evaluation?.journey?.route.found ? '#bfe0d2' : '#f0d3cd')
    if (selected?.type === 'building') tints.set(Number(selected.id), '#c3d4f2')
    handle.layer.tintBuildings(tints)
    handle.layer.setBuildingsVisible(layers.buildings)
  }, [handle, buildingsReady, destBuilding, selected, evaluation, layers.buildings])

  // ---- compare ---------------------------------------------------------------------------
  useEffect(() => {
    if (!handle) return
    handle.layer.setView(compare === 'split' ? { split } : compare === 'before' ? 'before' : 'after')
  }, [handle, compare, split])

  // ---- municipal records ----------------------------------------------------------------------
  useEffect(() => {
    if (!handle || !records) return
    const { map } = handle
    const policy = scenarioId.endsWith('-strict') ? 'strict' : scenarioId.endsWith('-lenient') ? 'lenient' : 'moderate'
    ;(map.getSource('records') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: records.ramps.map((r) => ({ type: 'Feature', geometry: r.geometry, properties: { oid: r.properties.OBJECTID, cat: r.properties.classification[policy] } })),
    } as GeoJSON.FeatureCollection)
    ;(map.getSource('inventory') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: records.sidewalks.map((f) => ({ type: 'Feature', geometry: f.geometry, properties: { presence: f.properties.SidewalkPresence } })),
    } as GeoJSON.FeatureCollection)
  }, [handle, records, scenarioId])

  useEffect(() => {
    if (!handle) return
    const { map } = handle
    const municipal = scenario?.mode === 'municipal'
    const vis = (id: string, on: boolean) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
    vis('rec-circles', layers.records && municipal)
    vis('rec-selected', layers.records && municipal)
    vis('inv-lines', layers.inventory && municipal)
    if (map.getLayer('rec-selected')) map.setFilter('rec-selected', ['==', ['get', 'oid'], selected?.type === 'record' ? Number(selected.id) : -1])
  }, [handle, layers.records, layers.inventory, scenario, selected])

  // ---- interaction ---------------------------------------------------------------------------
  useEffect(() => {
    if (!handle || !scenario) return
    const { map, layer } = handle
    const side = (): Side => (useApp.getState().compare === 'before' ? 'before' : 'after')
    const onMove = (e: MapMouseEvent) => {
      const k = layer.pickMarker(side(), e.point.x, e.point.y)
      useApp.getState().setHovered(k)
      map.getCanvas().style.cursor = k ? 'pointer' : ''
    }
    const onClick = (e: MapMouseEvent) => {
      const st = useApp.getState()
      const k = layer.pickMarker(side(), e.point.x, e.point.y)
      if (k) {
        const [kind, id] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)]
        st.select({ type: kind === 'iv' ? 'intervention' : 'place', id })
        return
      }
      if (map.getLayer('rec-circles') && map.getLayoutProperty('rec-circles', 'visibility') !== 'none') {
        const rec = map.queryRenderedFeatures([[e.point.x - 5, e.point.y - 5], [e.point.x + 5, e.point.y + 5]], { layers: ['rec-circles'] })[0]
        if (rec) {
          st.select({ type: 'record', id: String(rec.properties?.oid) })
          st.setExplorerTab('records')
          return
        }
      }
      const edge = nearestEdge(layer, scenario, e.point.x, e.point.y)
      if (edge) {
        st.select({ type: 'edge', id: edge })
        return
      }
      if (st.mapMode === '3d') {
        const b = layer.pickBuilding(e.point.x, e.point.y)
        if (b !== null) {
          st.select({ type: 'building', id: String(b) })
          return
        }
      }
      st.select(null)
    }
    map.on('mousemove', onMove)
    map.on('click', onClick)
    return () => {
      map.off('mousemove', onMove)
      map.off('click', onClick)
    }
  }, [handle, scenario])

  // ---- camera presets -------------------------------------------------------------------------
  useEffect(() => {
    if (!handle || !camera || !scenario) return
    const { map } = handle
    const st = useApp.getState()
    const three = st.mapMode === '3d'
    const dur = reduced ? 0 : 1500
    const pad = { top: 80, bottom: 70, left: 60, right: 60 }
    const fit = (coords: [number, number][], pitch: number, bearing: number, extraZoom = 0, d = dur) => {
      if (!coords.length) return
      const lons = coords.map((c) => c[0])
      const lats = coords.map((c) => c[1])
      const cam = map.cameraForBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: pad, bearing })
      if (!cam) return
      map.easeTo({ center: cam.center, zoom: Math.min(18.6, (cam.zoom ?? 16) - (pitch > 30 ? 0.35 : 0) + extraZoom), pitch: three ? pitch : 0, bearing: three ? bearing : 0, duration: d, essential: true })
    }
    const ev = st.evaluation
    const route = (ev?.journey?.route.found ? ev.journey.route.geometry : ev?.journey?.potential_route?.geometry) as [number, number][] | undefined
    const ends = journeyEnds(scenario, st.journey)
    const pair = ['A', 'B'].map((id) => scenario.interventions.find((i) => i.id === id)).filter(Boolean)
    switch (camera.preset) {
      case 'overview': {
        const pts = [...(route ?? []), ...ends]
        if (scenario.mode === 'municipal' && scenario.bounds) {
          const [w, s, e, n] = scenario.bounds
          fit([[w, s], [e, n]], 48, -28, 0.2)
        } else fit(pts.length ? pts : [[ORIGIN[0] - 0.006, ORIGIN[1] - 0.004], [ORIGIN[0] + 0.006, ORIGIN[1] + 0.004]], 54, -32, 0.15)
        break
      }
      case 'network': {
        const pts = [...(route ?? []), ...ends, ...scenario.interventions.map((i) => [i.lon, i.lat] as [number, number])]
        fit(pts, 42, -18, -0.1)
        break
      }
      case 'route':
        fit([...(route ?? []), ...ends], 56, map.getBearing() || -30, 0, reduced ? 0 : 2200)
        break
      case 'street': {
        const sel = st.selected?.type === 'intervention' ? scenario.interventions.find((i) => i.id === st.selected!.id) : null
        const pts = pair.length === 2 ? pair.map((p) => [p!.lon, p!.lat]) : sel ? [[sel.lon, sel.lat]] : []
        if (!pts.length) break
        const c: [number, number] = [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length]
        let bearing = map.getBearing()
        if (pts.length === 2) bearing = (Math.atan2(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) * 180) / Math.PI - 90
        map.easeTo({ center: c, zoom: three ? 18.7 : 19.2, pitch: three ? 60 : 0, bearing: three ? bearing : 0, duration: dur, essential: true })
        break
      }
      case 'top':
        map.easeTo({ pitch: 0, bearing: 0, duration: dur })
        break
      case 'intervention': {
        const iv = scenario.interventions.find((i) => i.id === camera.id)
        if (iv) map.easeTo({ center: [iv.lon, iv.lat], zoom: three ? 18.5 : 18.9, pitch: three ? 58 : 0, duration: dur, essential: true })
        break
      }
      case 'point':
        if (camera.lonlat) map.easeTo({ center: camera.lonlat, zoom: three ? 18.6 : 18.8, pitch: three ? 60 : 0, duration: reduced ? 0 : 1100, essential: true })
        break
    }
  }, [handle, camera, scenario, reduced])

  return (
    <div className="absolute inset-0">
      <div ref={ref} className="h-full w-full" data-testid="map" role="region" aria-label="Map" />
      {handle && <MapLabels handle={handle} />}
      {handle && compare === 'split' && <CompareSlider />}
      {!basemapOk && (
        <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-md border border-unk/40 bg-white/95 px-3 py-1.5 text-xs text-ink shadow">
          Basemap tiles unavailable (offline?). Network, buildings and analysis still work.
        </div>
      )}
      {handle && !buildingsReady && mapMode === '3d' && (
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 rounded-md bg-white/90 px-3 py-1 text-xs text-ink-2 shadow">Loading building footprints…</div>
      )}
    </div>
  )
}

function placeSpec(key: string, lng: number, lat: number, kind: PlaceKind, ring: string | null, px: number, dim: boolean): MarkerSpec {
  return { key, lng, lat, alt: 4, px, stem: false, iconKey: `p:${kind}:${ring}:${dim}`, icon: () => placeIcon(kind, ring, dim), order: ring ? 25 : 5 }
}

function journeyEnds(sc: ScenarioOut, j: { origin: string; destination: string } | null): [number, number][] {
  if (!j) return []
  const pl = [...sc.origins, ...sc.destinations]
  return [j.origin, j.destination].map((id) => pl.find((p) => p.id === id)).filter(Boolean).map((p) => [p!.lon, p!.lat])
}

/** Building nearest to a point (destination POIs are OSM building centroids). */
function buildingAt(layer: CityLayer, lng: number, lat: number): number | null {
  const idx = layer.index
  if (!idx) return null
  let best: number | null = null
  let bestD = Infinity
  for (let i = 0; i < idx.centroids.length; i++) {
    const [x, y] = idx.centroids[i]
    const d = Math.hypot((x - lng) * 91000, (y - lat) * 111000)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return bestD < 120 ? best : null
}

/** Nearest network edge to a screen point (within 7 px). */
function nearestEdge(layer: CityLayer, sc: ScenarioOut, px: number, py: number): string | null {
  let best: string | null = null
  let bestD = 7
  for (const e of sc.edges) {
    const pts = e.geometry.map(([lng, lat]) => layer.project(lng, lat, 0.3))
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      if (!a || !b) continue
      const dx = b[0] - a[0]
      const dy = b[1] - a[1]
      const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy || 1)))
      const d = Math.hypot(a[0] + t * dx - px, a[1] + t * dy - py)
      if (d < bestD) {
        bestD = d
        best = e.id
      }
    }
  }
  return best
}
