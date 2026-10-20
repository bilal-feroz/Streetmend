import { MercatorCoordinate } from 'maplibre-gl'
import * as THREE from 'three'

/**
 * Local metric frame for the 3D city.
 *
 * Three.js world units are metres around a fixed origin: x = east, y = up,
 * z = south (so -z is north). Positions are computed from exact Web Mercator
 * coordinates, so they stay aligned with the basemap at any zoom, bearing or
 * pitch; the frame only removes large numbers (float precision on the GPU).
 *
 * The model matrix maps local metres to MapLibre's mercator world:
 *   mercator = (ox + s*x, oy + s*z, s*y)
 * where s is mercator units per metre at the origin latitude.
 */
export class LocalFrame {
  readonly lng: number
  readonly lat: number
  readonly ox: number
  readonly oy: number
  readonly s: number
  readonly model: THREE.Matrix4

  constructor(lng: number, lat: number) {
    this.lng = lng
    this.lat = lat
    const mc = MercatorCoordinate.fromLngLat([lng, lat], 0)
    this.ox = mc.x
    this.oy = mc.y
    this.s = mc.meterInMercatorCoordinateUnits()
    const s = this.s
    // prettier-ignore
    this.model = new THREE.Matrix4().set(
      s, 0, 0, this.ox,
      0, 0, s, this.oy,
      0, s, 0, 0,
      0, 0, 0, 1,
    )
  }

  /** lon/lat (+ altitude in metres) -> local [x, y, z]. */
  toLocal(lng: number, lat: number, alt = 0): [number, number, number] {
    const mc = MercatorCoordinate.fromLngLat([lng, lat], 0)
    return [(mc.x - this.ox) / this.s, alt, (mc.y - this.oy) / this.s]
  }

  /** local [x, z] -> lon/lat. */
  toLngLat(x: number, z: number): [number, number] {
    const ll = new MercatorCoordinate(this.ox + x * this.s, this.oy + z * this.s, 0).toLngLat()
    return [ll.lng, ll.lat]
  }
}
