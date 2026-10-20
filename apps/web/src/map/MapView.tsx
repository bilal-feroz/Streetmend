import {
  GeoJSONSource,
  Map as MLMap,
  Marker,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type ExpressionSpecification,
  type MapLayerMouseEvent,
  type StyleSpecification,
} from 'maplibre-gl'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { EvaluateResponse, ScenarioOut } from '../api/types'
import { useReducedMotion } from '../lib/useReducedMotion'
import { useApp } from '../state/store'
import { bbox, contextLayers, cumulative, curbPoints, edgeFeatures, EMPTY, slice } from './geo'
import { CandidateMarker, PlaceMarker } from './Markers'
import { MapInspector } from './MapInspector'

// MapLibre v6 resolves its worker relative to its own module URL, which breaks
// once Vite bundles it. The self-contained worker is copied verbatim into
// public/ by the predev/prebuild scripts and served from there.
setWorkerUrl(new URL('maplibre-gl-worker.mjs', window.location.origin + import.meta.env.BASE_URL).href)

const C = {
  bg: '#080c16',
  block: '#0f1626',
  blockEdge: '#0c1220',
  building: '#151e33',
  buildingLine: '#1c2741',
  street: '#0a0f1b',
  sidewalk: '#3a4767',
  crossing: '#4d5a7a',
  ok: '#34d399',
  bad: '#ff6b6b',
  unk: '#fbbf24',
  sel: '#5b8cff',
}

const BLANK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': C.bg } }],
}

export const BASEMAP_URL = 'https://tiles.openfreemap.org/styles/dark'

const INTERACTIVE = ['net-sidewalk', 'net-crossing', 'net-unknown', 'net-blocked', 'net-repaired', 'route-core', 'net-hit']

function addLayers(map: MLMap, withContext: boolean) {
  const src = (id: string) => {
    if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY as GeoJSON.FeatureCollection })
  }
  ;['ctx-blocks', 'ctx-buildings', 'ctx-streets', 'ctx-center', 'net', 'curbs', 'route-trace', 'route-potential'].forEach(src)
  const add: Parameters<MLMap['addLayer']>[0][] = []
  if (withContext) {
    add.push(
      { id: 'ctx-blocks', type: 'fill', source: 'ctx-blocks', paint: { 'fill-color': ['case', ['get', 'edge'], C.blockEdge, C.block] } },
      { id: 'ctx-streets', type: 'fill', source: 'ctx-streets', paint: { 'fill-color': C.street } },
      {
        id: 'ctx-buildings', type: 'fill', source: 'ctx-buildings',
        paint: { 'fill-color': C.building, 'fill-outline-color': C.buildingLine, 'fill-opacity': ['case', ['get', 'edge'], 0.45, 0.95] },
      },
      {
        id: 'ctx-median', type: 'line', source: 'ctx-center', filter: ['==', ['get', 'cls'], 'arterial'],
        paint: { 'line-color': '#c9a227', 'line-opacity': 0.28, 'line-width': 1.2, 'line-dasharray': [6, 4] },
      },
    )
  }
  const state = ['get', 'state'] as ExpressionSpecification
  const w = (base: number) => ['interpolate', ['exponential', 1.6], ['zoom'], 14, base * 0.45, 16.5, base, 19, base * 2.6] as ExpressionSpecification
  add.push(
    {
      id: 'net-sidewalk', type: 'line', source: 'net',
      filter: ['all', ['!=', ['get', 'kind'], 'crossing'], ['==', state, 'traversable']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': C.sidewalk, 'line-width': w(2) },
    },
    {
      id: 'net-crossing', type: 'line', source: 'net',
      filter: ['all', ['==', ['get', 'kind'], 'crossing'], ['==', state, 'traversable']],
      paint: { 'line-color': C.crossing, 'line-width': w(5.5), 'line-dasharray': [0.35, 0.3] },
    },
    {
      id: 'net-unknown', type: 'line', source: 'net', filter: ['==', state, 'unknown'],
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': C.unk, 'line-width': w(2), 'line-opacity': 0.85, 'line-dasharray': [0.6, 1.8] },
    },
    {
      id: 'net-blocked', type: 'line', source: 'net', filter: ['in', state, ['literal', ['blocked', 'repairable']]],
      layout: { 'line-cap': 'butt' },
      paint: { 'line-color': C.bad, 'line-width': w(2.4), 'line-opacity': 0.9, 'line-dasharray': [1.2, 1] },
    },
    {
      id: 'route-potential', type: 'line', source: 'route-potential',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#c7d2fe', 'line-width': w(2.2), 'line-opacity': 0.5, 'line-dasharray': [0.2, 2] },
    },
    {
      id: 'net-wave', type: 'line', source: 'net', filter: ['>=', ['get', 'wave'], 0],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': C.ok, 'line-width': w(3), 'line-opacity': 0 },
    },
    {
      id: 'net-repaired', type: 'line', source: 'net', filter: ['==', state, 'repaired'],
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': C.ok, 'line-width': w(3.4) },
    },
    {
      id: 'curbs', type: 'circle', source: 'curbs', minzoom: 16.8,
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 16.8, 1, 19, 3], 'circle-color': '#6b7894', 'circle-opacity': 0.8 },
    },
    {
      id: 'route-glow', type: 'line', source: 'route-trace',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': C.ok, 'line-width': w(12), 'line-opacity': 0.22, 'line-blur': 6 },
    },
    {
      id: 'route-core', type: 'line', source: 'route-trace',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#6ee7b7', 'line-width': w(4) },
    },
    {
      id: 'net-frontier', type: 'line', source: 'net', filter: ['==', ['get', 'frontier'], true],
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': C.bad, 'line-width': w(7), 'line-opacity': 0.25, 'line-blur': 3 },
    },
    {
      id: 'net-selected', type: 'line', source: 'net', filter: ['==', ['get', 'id'], ''],
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': C.sel, 'line-width': w(6), 'line-opacity': 0.9 },
    },
    // Invisible wide hit target so thin edges are easy to click.
    { id: 'net-hit', type: 'line', source: 'net', paint: { 'line-color': '#000', 'line-width': 14, 'line-opacity': 0 } },
  )
  for (const l of add) if (!map.getLayer(l.id)) map.addLayer(l)
}

interface MarkerSlot {
  key: string
  el: HTMLElement
  marker: Marker
  kind: 'candidate' | 'place' | 'label'
  id: string
}

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MLMap | null>(null)
  const [ready, setReady] = useState(false)
  const [styleNonce, setStyleNonce] = useState(0)
  const [basemapError, setBasemapError] = useState<string | null>(null)
  const [slots, setSlots] = useState<MarkerSlot[]>([])
  const rafRef = useRef<number | null>(null)
  const reduced = useReducedMotion()

  const scenario = useApp((s) => s.scenario)
  const evaluation = useApp((s) => s.evaluation)
  const initialEval = useApp((s) => s.initialEval)
  const compare = useApp((s) => s.compare)
  const traceNonce = useApp((s) => s.traceNonce)
  const focus = useApp((s) => s.focus)
  const layers = useApp((s) => s.layers)
  const selected = useApp((s) => s.selected)
  const select = useApp((s) => s.select)

  const shown: EvaluateResponse | null = compare === 'before' ? initialEval : evaluation
  const municipal = scenario?.mode === 'municipal'

  // ---- create map once ------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return
    const map = new MLMap({
      container: containerRef.current,
      style: BLANK_STYLE,
      center: [0.0035, 0.0017],
      zoom: 16,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      maxPitch: 0,
      fadeDuration: 0,
    })
    map.touchZoomRotate.disableRotation()
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    map.addControl(new ScaleControl({ unit: 'metric', maxWidth: 110 }), 'bottom-right')
    map.getCanvas().setAttribute('aria-label', 'Pedestrian network map. All map information is also listed in the planning panel.')
    ;(map as unknown as { __sm?: string }).__sm = 'blank'
    map.on('load', () => {
      addLayers(map, true)
      setReady(true)
    })
    mapRef.current = map
    if (import.meta.env.DEV) (window as unknown as { __map?: MLMap }).__map = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // ---- switch base style by mode -------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !scenario) return
    const want = municipal ? 'basemap' : 'blank'
    if ((map as unknown as { __sm?: string }).__sm === want) return
    ;(map as unknown as { __sm?: string }).__sm = want
    setBasemapError(null)
    const onLoad = () => {
      addLayers(map, !municipal)
      setStyleNonce((n) => n + 1)
    }
    map.once('style.load', onLoad)
    if (municipal) {
      const onErr = (e: unknown) => setBasemapError((e as { error?: Error }).error?.message ?? 'Basemap tiles unavailable')
      map.once('error', onErr)
      map.setStyle(BASEMAP_URL, { diff: false })
    } else {
      map.setStyle(BLANK_STYLE, { diff: false })
    }
  }, [ready, scenario, municipal])

  // ---- static scenario data --------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !scenario || !map.getSource('net')) return
    const ctx = contextLayers(scenario)
    const set = (id: string, data: unknown) => (map.getSource(id) as GeoJSONSource | undefined)?.setData(data as GeoJSON.FeatureCollection)
    set('ctx-blocks', ctx.blocks)
    set('ctx-buildings', ctx.buildings)
    set('ctx-streets', ctx.streets)
    set('ctx-center', ctx.centerlines)
    set('curbs', curbPoints(scenario))
  }, [ready, scenario, styleNonce])

  // ---- markers ---------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !scenario) return
    const made: MarkerSlot[] = []
    const mk = (kind: MarkerSlot['kind'], id: string, lonlat: [number, number], opts: { rotation?: number; anchor?: 'center' | 'left' } = {}) => {
      const el = document.createElement('div')
      const marker = new Marker({ element: el, anchor: opts.anchor ?? 'center', rotation: opts.rotation ?? 0, rotationAlignment: 'map' })
        .setLngLat(lonlat)
        .addTo(map)
      made.push({ key: `${kind}:${id}`, el, marker, kind, id })
    }
    if (!municipal) {
      for (const l of scenario.context.street_labels ?? []) mk('label', l.text, [l.lon, l.lat], { rotation: l.rotate, anchor: 'left' })
    }
    for (const o of scenario.origins) mk('place', o.id, [o.lon, o.lat])
    for (const d of scenario.destinations) mk('place', d.id, [d.lon, d.lat])
    for (const iv of scenario.interventions) mk('candidate', iv.id, [iv.lon, iv.lat])
    setSlots(made)
    return () => made.forEach((m) => m.marker.remove())
  }, [ready, scenario, municipal])

  // ---- network state + animation ------------------------------------------
  const netData = useMemo(() => (scenario ? edgeFeatures(scenario, shown) : null), [scenario, shown])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !netData || !map.getSource('net')) return
    ;(map.getSource('net') as GeoJSONSource).setData(netData as GeoJSON.FeatureCollection)
    const pot = shown?.journey?.potential_route
    ;(map.getSource('route-potential') as GeoJSONSource).setData(
      (pot && pot.geometry.length > 1 && !shown?.journey?.route.found
        ? { type: 'Feature', geometry: { type: 'LineString', coordinates: pot.geometry }, properties: {} }
        : EMPTY) as GeoJSON.FeatureCollection,
    )
  }, [ready, netData, shown, styleNonce])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !map.getLayer('net-wave')) return
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    const journey = shown?.journey
    const trace = map.getSource('route-trace') as GeoJSONSource
    const route = journey?.route.found ? journey.route : null
    const coords = (route?.geometry ?? []) as [number, number][]
    const cum = cumulative(coords)
    const waveVals = Object.values(journey?.reach_wave ?? {})
    const maxD = waveVals.length ? Math.max(...waveVals) : 0
    const waveOpacity = (d: number): ExpressionSpecification => ['case', ['<=', ['get', 'wave'], d], route ? 0.28 : 0.55, 0]
    const setRoute = (frac: number) =>
      trace.setData(
        (coords.length > 1
          ? { type: 'Feature', geometry: { type: 'LineString', coordinates: slice(coords, cum, frac) }, properties: {} }
          : EMPTY) as GeoJSON.FeatureCollection,
      )
    if (!layers.wave) map.setPaintProperty('net-wave', 'line-opacity', 0)
    if (reduced || !journey) {
      if (layers.wave) map.setPaintProperty('net-wave', 'line-opacity', waveOpacity(Number.MAX_SAFE_INTEGER))
      setRoute(1)
      return
    }
    const WAVE_MS = 900
    const ROUTE_MS = route ? Math.min(1600, 500 + (route.length_m ?? 0) * 1.6) : 0
    setRoute(0)
    const t0 = performance.now()
    const step = (now: number) => {
      const t = now - t0
      if (layers.wave) map.setPaintProperty('net-wave', 'line-opacity', waveOpacity(maxD * Math.min(1, t / WAVE_MS) + 0.01))
      if (route && t > WAVE_MS * 0.55) {
        const f = Math.min(1, (t - WAVE_MS * 0.55) / ROUTE_MS)
        setRoute(1 - Math.pow(1 - f, 2.2))
      }
      if (t < WAVE_MS * 0.55 + ROUTE_MS || t < WAVE_MS) rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [ready, shown, traceNonce, reduced, layers.wave, styleNonce])

  // ---- layer toggles & selection highlight ---------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const vis = (ids: string[], on: boolean) => ids.forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'))
    vis(['ctx-blocks', 'ctx-buildings', 'ctx-streets', 'ctx-median'], layers.context)
    vis(['net-sidewalk', 'net-crossing', 'net-unknown', 'net-blocked', 'net-repaired', 'curbs', 'net-frontier'], layers.network)
    vis(['net-wave', 'route-potential'], layers.wave)
    slots.forEach((s) => {
      const on = s.kind === 'candidate' ? layers.candidates : s.kind === 'place' ? layers.places : layers.labels && layers.context
      s.el.style.display = on ? '' : 'none'
    })
  }, [ready, layers, slots, styleNonce])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !map.getLayer('net-selected')) return
    map.setFilter('net-selected', ['==', ['get', 'id'], selected?.type === 'edge' ? selected.id : ''])
  }, [ready, selected, styleNonce])

  // ---- clicks on edges ----------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const onClick = (e: MapLayerMouseEvent) => {
      const f = map.queryRenderedFeatures([[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]], { layers: INTERACTIVE.filter((l) => map.getLayer(l)) })
      const hit = f.find((x) => x.properties?.id && x.layer.id !== 'route-core') ?? f[0]
      if (hit?.properties?.id) select({ type: 'edge', id: String(hit.properties.id) })
      else select(null)
    }
    const enter = () => (map.getCanvas().style.cursor = 'pointer')
    const leave = () => (map.getCanvas().style.cursor = '')
    map.on('click', onClick)
    map.on('mouseenter', 'net-hit', enter)
    map.on('mouseleave', 'net-hit', leave)
    return () => {
      map.off('click', onClick)
      map.off('mouseenter', 'net-hit', enter)
      map.off('mouseleave', 'net-hit', leave)
    }
  }, [ready, select])

  // ---- camera ------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !focus || !scenario) return
    const pad = padding(map)
    const dur = reduced ? 0 : 900
    if (focus.kind === 'bounds' && scenario.bounds) {
      const [w, s, e, n] = scenario.bounds
      map.fitBounds([[w, s], [e, n]], { padding: pad, duration: dur })
    } else if (focus.kind === 'route') {
      const ev = useApp.getState().evaluation
      const g = ev?.journey?.route.found ? ev.journey.route.geometry : ev?.journey?.potential_route?.geometry
      if (g && g.length > 1) {
        const [w, s, e, n] = bbox(g as [number, number][])
        map.fitBounds([[w, s], [e, n]], { padding: { ...pad, top: pad.top + 30, bottom: pad.bottom + 30 }, duration: reduced ? 0 : 1400, maxZoom: 17.6 })
      }
    } else if (focus.kind === 'intervention') {
      const iv = scenario.interventions.find((i) => i.id === focus.id)
      if (iv) map.easeTo({ center: [iv.lon, iv.lat], zoom: Math.max(map.getZoom(), 17.6), duration: dur, padding: pad })
    } else if (focus.kind === 'point' && focus.lonlat) {
      map.easeTo({ center: focus.lonlat, zoom: 18.2, duration: reduced ? 0 : 1000, padding: pad })
    }
  }, [ready, focus, scenario, reduced])

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" data-testid="map" role="region" aria-label="Network map" />
      {basemapError && (
        <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-md border border-unk/40 bg-ink-850/90 px-3 py-1.5 text-xs text-unk">
          Basemap tiles unavailable offline; network layers still shown.
        </div>
      )}
      {slots.map((s) =>
        createPortal(
          s.kind === 'candidate' ? (
            <CandidateMarker id={s.id} />
          ) : s.kind === 'place' ? (
            <PlaceMarker id={s.id} />
          ) : (
            <div className="sm-street-label">{s.id}</div>
          ),
          s.el,
          s.key,
        ),
      )}
      {mapRef.current && <MapInspector map={mapRef.current} />}
    </div>
  )
}

function padding(map: MLMap) {
  const w = map.getContainer().clientWidth
  const small = w < 640
  return { top: small ? 120 : 96, bottom: small ? 120 : 110, left: small ? 24 : 56, right: small ? 24 : 72 }
}

export type { ScenarioOut }
