import type { StyleSpecification } from 'maplibre-gl'

// Light planning basemap on OpenFreeMap vector tiles (OpenMapTiles schema,
// OpenStreetMap data). No API key; attribution is shown on the map.
export const TILE_SOURCE = 'https://tiles.openfreemap.org/planet'
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf'

// Atlas palette: warm ground, warm-grey street surfaces with a defined edge,
// natural parks; white 3D roofs then read clearly against the streets.
const C = {
  land: '#f0eee7',
  residential: '#eceae2',
  park: '#c9dfb2',
  wood: '#bcd6a3',
  water: '#bcd2da',
  waterLine: '#a7c2cc',
  building: '#dedad0',
  buildingLine: '#ccc7bb',
  roadCase: '#cbc5b8',
  roadMajorCase: '#bdb6a8',
  road: '#e3dfd5',
  roadMajor: '#dbd6ca',
  motorway: '#e7dcc6',
  motorwayCase: '#c6b89c',
  path: '#aca596',
  rail: '#bab4a8',
  label: '#6d716a',
  labelMajor: '#3d4844',
  halo: '#f0eee7',
}

const minor = ['in', ['get', 'class'], ['literal', ['minor', 'service', 'track']]]
const major = ['in', ['get', 'class'], ['literal', ['primary', 'secondary', 'tertiary', 'trunk']]]
const width = (base: number) =>
  ['interpolate', ['exponential', 1.6], ['zoom'], 12, base * 0.3, 15, base, 18, base * 4.2] as unknown as number

export function baseStyle(): StyleSpecification {
  return {
    version: 8,
    name: 'StreetMend light',
    glyphs: GLYPHS,
    sources: {
      openmaptiles: {
        type: 'vector',
        url: TILE_SOURCE,
        attribution: '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
      },
    },
    sky: { 'sky-color': '#dde8ec', 'horizon-color': '#f2f0ea', 'fog-color': '#f0eee7', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.7, 'fog-ground-blend': 0.85 },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': C.land } },
      { id: 'landuse-res', type: 'fill', source: 'openmaptiles', 'source-layer': 'landuse', filter: ['==', ['get', 'class'], 'residential'], paint: { 'fill-color': C.residential } },
      { id: 'park', type: 'fill', source: 'openmaptiles', 'source-layer': 'park', paint: { 'fill-color': C.park } },
      {
        id: 'landcover', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover',
        filter: ['in', ['get', 'class'], ['literal', ['grass', 'wood', 'scrub', 'farmland']]],
        paint: { 'fill-color': ['match', ['get', 'class'], 'wood', C.wood, C.park], 'fill-opacity': 0.8 },
      },
      { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water', paint: { 'fill-color': C.water } },
      { id: 'waterway', type: 'line', source: 'openmaptiles', 'source-layer': 'waterway', paint: { 'line-color': C.waterLine, 'line-width': 1.2 } },
      {
        id: 'building-flat', type: 'fill', source: 'openmaptiles', 'source-layer': 'building', minzoom: 13,
        paint: { 'fill-color': C.building, 'fill-outline-color': C.buildingLine, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 14.5, 1] },
      },
      // Road casings then fills
      {
        id: 'road-minor-case', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', filter: ['all', minor, ['!=', ['get', 'brunnel'], 'tunnel']] as never,
        layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': C.roadCase, 'line-width': width(2.6), 'line-gap-width': 0 },
      },
      {
        id: 'road-major-case', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', filter: major as never,
        layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': C.roadMajorCase, 'line-width': width(4.6) },
      },
      {
        id: 'road-motorway-case', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', filter: ['==', ['get', 'class'], 'motorway'],
        layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': C.motorwayCase, 'line-width': width(5.4) },
      },
      {
        id: 'road-minor', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', filter: ['all', minor, ['!=', ['get', 'brunnel'], 'tunnel']] as never,
        layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': C.road, 'line-width': width(1.9) },
      },
      {
        id: 'road-major', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', filter: major as never,
        layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': C.roadMajor, 'line-width': width(3.6) },
      },
      {
        id: 'road-motorway', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', filter: ['==', ['get', 'class'], 'motorway'],
        layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': C.motorway, 'line-width': width(4.2) },
      },
      {
        id: 'path', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', minzoom: 15, filter: ['==', ['get', 'class'], 'path'],
        paint: { 'line-color': C.path, 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 0.6, 19, 1.6], 'line-dasharray': [2, 1.5] },
      },
      {
        id: 'rail', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', filter: ['in', ['get', 'class'], ['literal', ['rail', 'transit']]],
        paint: { 'line-color': C.rail, 'line-width': 1.4, 'line-dasharray': [3, 2] },
      },
      // Labels (rendered above the 3D city layer, which is inserted before them)
      {
        id: 'label-road', type: 'symbol', source: 'openmaptiles', 'source-layer': 'transportation_name', minzoom: 14,
        layout: {
          'symbol-placement': 'line', 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 14, 10.5, 16, 12.5, 18, 14.5], 'text-letter-spacing': 0.03, 'text-max-angle': 30, 'symbol-spacing': 340,
        },
        paint: { 'text-color': '#3f4a45', 'text-halo-color': '#ffffff', 'text-halo-width': 2, 'text-halo-blur': 0.4 },
      },
      {
        id: 'label-city', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place', minzoom: 5.5, maxzoom: 12.5,
        filter: ['in', ['get', 'class'], ['literal', ['city', 'town']]],
        layout: { 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 6, 11, 11, 15], 'text-letter-spacing': 0.04 },
        paint: { 'text-color': C.labelMajor, 'text-halo-color': C.halo, 'text-halo-width': 1.8 },
      },
      {
        id: 'label-place', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place', minzoom: 12.5, maxzoom: 15.5,
        filter: ['in', ['get', 'class'], ['literal', ['suburb', 'neighbourhood', 'quarter']]],
        layout: { 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-transform': 'uppercase', 'text-letter-spacing': 0.12 },
        paint: { 'text-color': C.labelMajor, 'text-opacity': 0.7, 'text-halo-color': C.halo, 'text-halo-width': 1.8 },
      },
    ],
  }
}

export const FIRST_LABEL_LAYER = 'label-road'
