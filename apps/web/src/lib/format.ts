import type { Category, EffectiveState } from '../api/types'

export const fmtNum = (x: number | null | undefined, digits = 0) =>
  x === null || x === undefined || !Number.isFinite(x) ? '—' : x.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 })

export const fmtM = (m: number | null | undefined) => (m === null || m === undefined ? '—' : `${Math.round(m).toLocaleString('en-US')} m`)

export const fmtSigned = (x: number) => (x > 0 ? `+${fmtNum(x, 1)}` : fmtNum(x, 1))

export const CATEGORY_LABEL: Record<Category, string> = {
  healthcare: 'Healthcare',
  transit: 'Public transport',
  education: 'Education',
}

export const STATE_LABEL: Record<EffectiveState, string> = {
  traversable: 'Traversable (modeled)',
  blocked: 'Blocked',
  unknown: 'Unknown condition',
  repaired: 'Repaired (simulated)',
  repairable: 'Blocked · repair candidate',
}

export const EVIDENCE_LABEL: Record<string, string> = {
  synthetic: 'Synthetic scenario setting',
  municipal_record: 'Municipal record (CDOT)',
  municipal_historical: 'Historical municipal survey',
  osm: 'OpenStreetMap contributors',
  inferred: 'Inferred by StreetMend geometry',
  assumed: 'Modeling assumption',
}

export const SOLVER_LABEL: Record<string, string> = {
  exact_enumeration: 'StreetMend exact',
  beam_search: 'StreetMend beam search',
  greedy: 'Greedy (best next repair)',
  independent_ranking: 'Rank repairs individually',
  nearest_to_priority_destination: 'Nearest to destination',
}

export const KIND_LABEL: Record<string, string> = {
  sidewalk: 'Sidewalk segment',
  crossing: 'Pedestrian crossing',
  ramp: 'Curb ramp connection',
  entrance: 'Entrance connector',
}
