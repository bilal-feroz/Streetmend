// Geography for the opening: US state boundaries (us-atlas, from the US Census
// Bureau's cartographic boundary files) projected into Web Mercator in the same
// world units MapLibre uses (a 512 px world at zoom 0). Because the outline and
// the live map share one projection and one camera, the hand-off from the
// national outline to the real map is continuous.
import statesUrl from 'us-atlas/states-10m.json?url'
import type { GeometryCollection, Topology } from 'topojson-specification'

export const US_BOUNDS: [[number, number], [number, number]] = [[-124.8, 24.4], [-66.9, 49.4]]
export const NC_LABEL: [number, number] = [-79.25, 35.55]
export const US_LABEL: [number, number] = [-98.6, 39.6]
export const CHARLOTTE: [number, number] = [-80.8431, 35.2271]

export const WORLD = 512
export const mx = (lng: number) => ((lng + 180) / 360) * WORLD
export const my = (lat: number) => {
  const s = Math.sin((lat * Math.PI) / 180)
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * WORLD
}
export const lngOf = (x: number) => (x / WORLD) * 360 - 180
export const latOf = (y: number) => {
  const n = Math.PI - (2 * Math.PI * y) / WORLD
  return (180 / Math.PI) * Math.atan(Math.sinh(n))
}

/** The national frame keeps a calm margin and leaves room for the insets. */
export function introPadding(el: HTMLElement) {
  const w = el.clientWidth
  const h = el.clientHeight
  return { top: Math.round(h * 0.13), bottom: Math.round(h * 0.17), left: Math.round(w * 0.08), right: Math.round(w * 0.08) }
}

export interface UsGeometry {
  /** contiguous states: exterior outline, interior borders, North Carolina */
  outline: Path2D
  borders: Path2D
  nc: Path2D
  land: Path2D
  /** Alaska and Hawaii, for the opening frame's insets (their own projections) */
  insets: { ak: string; hi: string; box: { ak: [number, number]; hi: [number, number] } }
}

const OUTSIDE_LOWER48 = new Set(['02', '15', '60', '66', '69', '72', '78'])

export async function loadUsGeometry(): Promise<UsGeometry> {
  const [d3, topo, topology] = await Promise.all([
    import('d3-geo'),
    import('topojson-client'),
    fetch(statesUrl).then((r) => {
      if (!r.ok) throw new Error(`us-atlas ${r.status}`)
      return r.json() as Promise<Topology>
    }),
  ])
  const states = topology.objects.states as GeometryCollection<{ name: string }>
  const lower48: GeometryCollection = { type: 'GeometryCollection', geometries: states.geometries.filter((g) => !OUTSIDE_LOWER48.has(String(g.id))) }
  const merc = d3.geoTransform({
    point(x, y) {
      this.stream.point(mx(x), my(y))
    },
  })
  const path = d3.geoPath(merc).digits(6)
  const svg = (o: Parameters<typeof path>[0]) => path(o) ?? ''
  const outline = svg(topo.mesh(topology, lower48, (a, b) => a === b))
  const borders = svg(topo.mesh(topology, lower48, (a, b) => a !== b))
  const ncGeom = states.geometries.find((g) => String(g.id) === '37')!
  const nc = svg(topo.feature(topology, ncGeom))
  const land = svg(topo.merge(topology, lower48.geometries as never))

  // Insets: Alaska and Hawaii in conic projections sized for small boxes.
  const ak = topo.feature(topology, states.geometries.find((g) => String(g.id) === '02')!)
  const hi = topo.feature(topology, states.geometries.find((g) => String(g.id) === '15')!)
  const akP = d3.geoConicEqualArea().rotate([154, 0]).center([-2, 58.5]).parallels([55, 65]).fitSize([150, 96], ak)
  const hiP = d3.geoConicEqualArea().rotate([157, 0]).center([-3, 19.9]).parallels([8, 18]).fitSize([64, 40], hi)
  return {
    outline: new Path2D(outline),
    borders: new Path2D(borders),
    nc: new Path2D(nc),
    land: new Path2D(land),
    insets: { ak: d3.geoPath(akP)(ak) ?? '', hi: d3.geoPath(hiP)(hi) ?? '', box: { ak: [150, 96], hi: [64, 40] } },
  }
}
