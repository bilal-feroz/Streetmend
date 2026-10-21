// Access view on the map: H3 cells coloured by their three-valued result, the
// category's facilities, and (for a diagnosed cell) the engine's own routes,
// barriers and the option shown as applied. Geometry comes from the API only.
import type { GeoJSONSource } from 'maplibre-gl'
import { useEffect, useMemo } from 'react'
import { useAccess } from '../state/access'
import { useApp } from '../state/store'
import type { MapHandle } from './MapView'

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
const OK = '#10916f'
const UNK = '#d99a2b'
const BAD = '#d85e51'
const SITE = '#3568c8'

function ensure(handle: MapHandle) {
  const { map, layer } = handle
  if (map.getSource('access-cells')) return
  map.addSource('access-cells', { type: 'geojson', data: EMPTY })
  map.addSource('access-fac', { type: 'geojson', data: EMPTY })
  map.addSource('access-site', { type: 'geojson', data: EMPTY })
  // cells sit under the 3D city, so buildings stay readable on top of them
  map.addLayer({
    id: 'access-fill', type: 'fill', source: 'access-cells', layout: { visibility: 'none' },
    paint: {
      'fill-color': ['match', ['get', 'status'], 'PASS', OK, 'INCONCLUSIVE', UNK, BAD],
      // with a cell selected, the others step back
      'fill-opacity': ['case', ['get', 'sel'], 0.3, ['get', 'dim'], ['interpolate', ['linear'], ['get', 'weight'], 0, 0.04, 1, 0.14], ['interpolate', ['linear'], ['get', 'weight'], 0, 0.12, 1, 0.42]],
    },
  }, layer.id)
  map.addLayer({
    id: 'access-line', type: 'line', source: 'access-cells', layout: { visibility: 'none', 'line-join': 'round' },
    paint: { 'line-color': ['case', ['get', 'sel'], '#192c28', '#ffffff'], 'line-width': ['case', ['get', 'sel'], 3, 1.1], 'line-opacity': ['case', ['get', 'sel'], 0.95, 0.7] },
  }, layer.id)
  map.addLayer({
    id: 'access-fac', type: 'circle', source: 'access-fac', layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, ['case', ['get', 'near'], 6, 3.2], 18, ['case', ['get', 'near'], 11, 6.5]],
      'circle-color': ['case', ['get', 'in'], '#192c28', '#ffffff'],
      'circle-stroke-color': ['case', ['get', 'in'], '#ffffff', '#192c28'],
      'circle-stroke-width': ['case', ['get', 'near'], 2.5, 1.4],
      'circle-pitch-alignment': 'map',
    },
  })
  map.addLayer({
    id: 'access-site', type: 'circle', source: 'access-site', layout: { visibility: 'none' },
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 8, 18, 16], 'circle-color': SITE, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3, 'circle-pitch-alignment': 'map' },
  })
}

export function AccessLayers({ handle }: { handle: MapHandle }) {
  const on = useAccess((s) => s.on)
  const data = useAccess((s) => s.data)
  const cell = useAccess((s) => s.cell)
  const diagnosis = useAccess((s) => s.diagnosis)
  const compare = useAccess((s) => s.compare)
  const show = useAccess((s) => s.show)
  const scenario = useApp((s) => s.scenario)
  const geom = useMemo(() => new Map((scenario?.edges ?? []).map((e) => [e.id, e.geometry as [number, number][]])), [scenario])

  // cells + facilities
  useEffect(() => {
    ensure(handle)
    const { map } = handle
    const vis = on && !!data
    for (const id of ['access-fill', 'access-line', 'access-fac']) map.setLayoutProperty(id, 'visibility', vis ? 'visible' : 'none')
    if (!vis || !data) return
    const maxUnmet = Math.max(1, ...data.cells.map((c) => c.unmet_homes + c.uncertain))
    ;(map.getSource('access-cells') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: data.cells.map((c) => ({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[...c.boundary, c.boundary[0]]] },
        properties: { id: c.id, status: c.status, sel: c.id === cell, dim: !!cell && c.id !== cell, weight: c.status === 'PASS' ? c.served_share : (c.unmet_homes + c.uncertain) / maxUnmet },
      })),
    })
    const near = diagnosis?.representative.nearest_facility?.id
    ;(map.getSource('access-fac') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: data.facilities.map((f) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [f.lon, f.lat] }, properties: { id: f.id, in: f.in_network, near: f.id === near } })),
    })
  }, [handle, on, data, cell, diagnosis])

  // engine routes, barriers and the applied option
  useEffect(() => {
    ensure(handle)
    const net = handle.layer.networks.after
    const lines = (ids: string[]) => ids.map((id) => geom.get(id)).filter((g): g is [number, number][] => !!g && g.length > 1)
    const site = handle.map.getSource('access-site') as GeoJSONSource
    if (!on || !diagnosis || diagnosis.cell !== cell) {
      net.setOverlay('access-route', null)
      net.setOverlay('access-barrier', null)
      net.setOverlay('access-fix', null)
      net.setOverlay('access-after', null)
      handle.map.setLayoutProperty('access-site', 'visibility', 'none')
      handle.map.triggerRepaint()
      return
    }
    const r = diagnosis.representative
    const T = diagnosis.threshold_m
    const stepFree = diagnosis.profile === 'step_free'
    const best = stepFree ? r.step_free_possible_m : r.walking_possible_m
    const within = best !== null && best <= T
    const routeColor = within ? (r.unknown_count ? UNK : OK) : '#6f7d77'
    // the best usable route, solid; when barriers cut the direct one, the direct (physical) route dashed
    const out: { coords: [number, number][]; color: string; width: number; opacity?: number; dashed?: [number, number]; depthTest?: boolean; order?: number }[] = lines(r.route_edges).flatMap((c) => [
      { coords: c, color: '#ffffff', width: 9, order: 30 },
      { coords: c, color: routeColor, width: 5.5, order: 31 },
    ])
    if (r.barriers.length && !within) {
      out.push(...lines(r.physical_edges).map((c) => ({ coords: c, color: '#192c28', width: 3.2, opacity: 0.85, dashed: [3, 2.2] as [number, number], order: 32, depthTest: false })))
    }
    net.setOverlay('access-route', show === 'none' ? out : null)
    net.setOverlay('access-barrier', show === 'none' ? lines(r.barriers.map((b) => b.id)).flatMap((c) => [
      { coords: c, color: '#ffffff', width: 14, order: 40 },
      { coords: c, color: BAD, width: 9, order: 41 },
    ]) : null)
    // the option shown as applied: the typical home's recomputed route, then the changed edges
    const after = show === 'fix' ? compare?.fix.after : show === 'build' ? compare?.build.after : undefined
    const ok = after?.route?.length_m != null && after.route.length_m <= T
    net.setOverlay('access-after', after?.route ? lines(after.route.edge_ids).flatMap((c) => [
      { coords: c, color: '#ffffff', width: 9, order: 44 },
      { coords: c, color: ok ? OK : '#6f7d77', width: 5.5, order: 45 },
    ]) : null)
    const fx = show === 'fix' ? compare?.fix.edge_ids ?? [] : []
    net.setOverlay('access-fix', fx.length ? lines(fx).flatMap((c) => [
      { coords: c, color: '#ffffff', width: 15, order: 50 },
      { coords: c, color: OK, width: 10, order: 51 },
    ]) : null)
    const s = show === 'build' ? compare?.build.site : null
    site.setData(s ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [s.lon, s.lat] }, properties: {} }] } : EMPTY)
    handle.map.setLayoutProperty('access-site', 'visibility', s ? 'visible' : 'none')
    handle.map.triggerRepaint()
  }, [handle, on, cell, diagnosis, compare, show, geom])

  return null
}
