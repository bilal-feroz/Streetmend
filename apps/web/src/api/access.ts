// Access analysis on the real Elizabeth records: discover, diagnose, fix or build.
import { ApiError } from './client'

export type AccessCategory = 'healthcare' | 'education' | 'grocery' | 'transit' | 'parks' | 'services'
export type AccessProfile = 'step_free' | 'pedestrian'
export type Factor = 'served' | 'unknown_links' | 'outside_area' | 'barrier' | 'detour' | 'distance'
export type ReqStatus = 'PASS' | 'FAIL' | 'INCONCLUSIVE'

export const CATEGORY_ORDER: AccessCategory[] = ['healthcare', 'education', 'grocery', 'transit', 'parks', 'services']
export const CATEGORY_LABEL: Record<AccessCategory, string> = {
  healthcare: 'Healthcare', education: 'Education', grocery: 'Grocery', transit: 'Transit', parks: 'Parks', services: 'Services',
}
export const FACTOR_LABEL: Record<Factor, string> = {
  served: 'Reachable',
  unknown_links: 'Unknown links',
  outside_area: 'Beyond study area',
  barrier: 'Connectivity barrier',
  detour: 'Network detour',
  distance: 'No facility in reach',
}

export interface AccessCell {
  id: string
  lon: number
  lat: number
  boundary: [number, number][]
  homes: number
  served: number
  uncertain: number
  failing: number
  served_share: number
  possible_share: number
  walk_served_share: number | null
  status: ReqStatus
  primary_factor: Factor
  factors: Record<Factor, number>
  median_network_m: number | null
  median_straight_m: number | null
  median_outside_m: number | null
  unmet_homes: number
}

export interface AccessFacility { id: string; name: string; kind: string; lon: number; lat: number; source: string; in_network: boolean }

export interface AccessAnalysis {
  category: AccessCategory
  label: string
  profile: AccessProfile
  threshold_m: number
  h3_resolution: number
  cells: AccessCell[]
  summary: { homes: number; factors: Record<Factor, number>; served: number; uncertain: number; failing: number; walk_served: number | null }
  facilities: AccessFacility[]
  ranking: string[]
}

export interface Diagnosis {
  cell: string
  category: AccessCategory
  label: string
  profile: AccessProfile
  threshold_m: number
  homes: number
  factors: Record<Factor, number>
  walk_factors: Record<Factor, number>
  primary_factor: Factor
  primary_label: string
  sentence: string
  representative: {
    home: string
    lon: number
    lat: number
    straight_m: number | null
    straight_outside_m: number | null
    step_free_verified_m: number | null
    step_free_possible_m: number | null
    walking_verified_m: number | null
    walking_possible_m: number | null
    physical_m: number | null
    nearest_facility: { id: string; name: string; in_network: boolean } | null
    route_edges: string[]
    physical_edges: string[]
    barriers: { id: string; kind: string; reason: string; source_ids: string[] }[]
    unknown: { id: string; kind: string; reason: string }[]
    unknown_count: number
  }
  assumptions: string[]
}

export interface OptionAfter {
  verified: number
  possible: number
  homes: number
  all_verified: number
  all_possible: number
  mean_possible_m: number | null
  status: ReqStatus
  factors: Record<Factor, number>
  route?: { home: string; length_m: number | null; edge_ids: string[] }
}

export interface CompareResponse {
  category: AccessCategory
  label: string
  cells: string[]
  profile: AccessProfile
  policy: 'possible' | 'verified'
  threshold_m: number
  homes: number
  baseline: number
  before: OptionAfter
  requirement: { id: string; label: string; share: number }
  fix: {
    status: 'found' | 'none'
    gain?: number
    repairs: { id: string; label: string; kind: string; edge_ids: string[]; lon: number; lat: number; evidence: string; source_ids: string[]; reason: string; alone_gain: number }[]
    candidates: number
    screened: number
    relevant: number
    evaluated: number
    exact: boolean
    budget: number
    singles: { id: string; label: string; kind: string; gain: number }[]
    after?: OptionAfter
    edge_ids?: string[]
    synergy?: boolean
  }
  build: {
    status: 'found' | 'none'
    gain?: number
    site: { id: string; label: string; lon: number; lat: number; kind: string; hypothetical: boolean } | null
    candidates: number
    relevant: number
    evaluated: number
    top: { id: string; label: string; gain: number; lon: number; lat: number }[]
    after?: OptionAfter
  }
  winner: 'fix' | 'build' | 'tie' | 'neither'
  why: string
  notes: string[]
  runtime_ms: number
}

export interface AccessOverviewRow {
  category: AccessCategory
  label: string
  threshold_m: number
  homes: number
  served: number
  uncertain: number
  failing: number
  factors: Record<Factor, number>
  walk_served: number | null
  facilities: number
  in_network: number
}

async function get<T>(path: string, timeoutMs = 30_000): Promise<T> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const r = await fetch(path, { signal: ctrl.signal, headers: { 'Content-Type': 'application/json' } })
    if (!r.ok) {
      let d = r.statusText
      try {
        const b = await r.json()
        d = typeof b.detail === 'string' ? b.detail : JSON.stringify(b.detail)
      } catch {
        /* non-JSON */
      }
      throw new ApiError(r.status, d)
    }
    return (await r.json()) as T
  } catch (e) {
    if (e instanceof ApiError) throw e
    throw new ApiError(0, (e as Error).name === 'AbortError' ? 'Request timed out' : 'StreetMend API is not reachable.')
  } finally {
    clearTimeout(t)
  }
}

export const accessApi = {
  overview: (profile: AccessProfile) => get<{ profile: AccessProfile; categories: AccessOverviewRow[] }>(`/api/access/overview?profile=${profile}`),
  category: (c: AccessCategory, profile: AccessProfile) => get<AccessAnalysis>(`/api/access/${c}?profile=${profile}`),
  diagnose: (c: AccessCategory, cell: string, profile: AccessProfile) => get<Diagnosis>(`/api/access/${c}/cells/${cell}?profile=${profile}`),
  compare: async (body: { category: AccessCategory; cells: string[]; profile: AccessProfile; budget: number; policy?: 'possible' | 'verified' }) => {
    const r = await fetch('/api/access/compare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!r.ok) throw new ApiError(r.status, (await r.json().catch(() => ({ detail: r.statusText }))).detail)
    return (await r.json()) as CompareResponse
  },
}
