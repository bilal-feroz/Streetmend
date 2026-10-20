import type { EvaluateResponse, ScenarioOut } from '../api/types'

type Pos = [number, number]
type Feature<G> = { type: 'Feature'; id?: number; geometry: G; properties: Record<string, unknown> }
export type FC<G = unknown> = { type: 'FeatureCollection'; features: Feature<G>[] }

const fc = <G>(features: Feature<G>[]): FC<G> => ({ type: 'FeatureCollection', features })

export const EMPTY: FC = fc([])

export function contextLayers(sc: ScenarioOut) {
  const c = sc.context
  return {
    blocks: fc((c.blocks ?? []).map((b) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: b.polygon }, properties: { edge: b.edge } }))),
    buildings: fc((c.buildings ?? []).map((b) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: b.polygon }, properties: { edge: b.edge } }))),
    streets: fc((c.streets ?? []).map((s) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: s.polygon }, properties: { name: s.name, cls: s.class } }))),
    centerlines: fc((c.streets ?? []).map((s) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: s.centerline }, properties: { name: s.name, cls: s.class } }))),
  }
}

/** Network edges with their effective state for the given evaluation. */
export function edgeFeatures(sc: ScenarioOut, ev: EvaluateResponse | null) {
  const routeEdges = new Set(ev?.journey?.route.found ? ev.journey.route.edge_ids : [])
  const wave = ev?.journey?.reach_wave ?? {}
  const frontier = new Set(ev?.journey?.frontier_barriers ?? [])
  return fc(
    sc.edges.map((e, i) => ({
      type: 'Feature' as const,
      id: i,
      geometry: { type: 'LineString' as const, coordinates: e.geometry },
      properties: {
        id: e.id,
        kind: e.kind,
        state: ev?.edge_states[e.id] ?? e.state,
        route: routeEdges.has(e.id),
        wave: wave[e.id] ?? -1,
        frontier: frontier.has(e.id),
      },
    })),
  )
}

export function curbPoints(sc: ScenarioOut) {
  const curbs = sc.nodes.filter((n) => n.kind === 'curb')
  return fc(curbs.map((n) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [n.lon, n.lat] }, properties: { id: n.id } })))
}

// ---- geometry helpers --------------------------------------------------------
const R = 6371008.8
export function dist(a: Pos, b: Pos) {
  const toR = Math.PI / 180
  const dLat = (b[1] - a[1]) * toR
  const dLon = (b[0] - a[0]) * toR
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toR) * Math.cos(b[1] * toR) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function cumulative(coords: Pos[]) {
  const out = [0]
  for (let i = 1; i < coords.length; i++) out.push(out[i - 1] + dist(coords[i - 1], coords[i]))
  return out
}

/** Prefix of a polyline covering `frac` of its length. */
export function slice(coords: Pos[], cum: number[], frac: number): Pos[] {
  if (coords.length < 2) return coords
  const total = cum[cum.length - 1]
  const target = Math.max(0, Math.min(1, frac)) * total
  const out: Pos[] = [coords[0]]
  for (let i = 1; i < coords.length; i++) {
    if (cum[i] <= target) {
      out.push(coords[i])
      continue
    }
    const seg = cum[i] - cum[i - 1]
    const t = seg > 0 ? (target - cum[i - 1]) / seg : 0
    out.push([coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t, coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t])
    break
  }
  return out.length < 2 ? [coords[0], coords[0]] : out
}

export function bbox(coords: Pos[]): [number, number, number, number] {
  let w = Infinity
  let s = Infinity
  let e = -Infinity
  let n = -Infinity
  for (const [x, y] of coords) {
    w = Math.min(w, x)
    s = Math.min(s, y)
    e = Math.max(e, x)
    n = Math.max(n, y)
  }
  return [w, s, e, n]
}
