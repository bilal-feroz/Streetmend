// Mirrors services/api/streetmend/api/schemas.py. Keep in sync.

export type Category = 'healthcare' | 'transit' | 'education'
export type Priority = 'balanced' | Category
export type EdgeState = 'traversable' | 'blocked' | 'unknown'
export type EffectiveState = EdgeState | 'repaired' | 'repairable'

export interface Weights {
  healthcare: number
  transit: number
  education: number
}

export interface ScenarioSummary {
  id: string
  name: string
  mode: 'synthetic' | 'municipal' | 'hypothetical'
  description: string
  node_count: number
  edge_count: number
  candidate_count: number
  origin_count: number
  destination_count: number
  available: boolean
  unavailable_reason: string | null
}

export interface NodeOut {
  id: string
  kind: string
  lon: number
  lat: number
  label: string
}

export interface EdgeOut {
  id: string
  u: string
  v: string
  kind: 'sidewalk' | 'crossing' | 'ramp' | 'entrance'
  length_m: number
  geometry: [number, number][]
  state: EdgeState
  evidence: string
  source: string
  source_ids: string[]
  label: string
  reason: string
  attrs: Record<string, string | number | boolean | null>
}

export interface OriginOut {
  id: string
  label: string
  weight: number
  weight_basis: string
  lon: number
  lat: number
}

export interface DestinationOut {
  id: string
  label: string
  category: Category
  weight: number
  evidence: string
  source_ids: string[]
  lon: number
  lat: number
}

export interface InterventionOut {
  id: string
  label: string
  kind: string
  edge_ids: string[]
  lon: number
  lat: number
  description: string
  evidence: string
  source_ids: string[]
  cost_units: number
  attrs: Record<string, unknown>
}

export interface StreetCtx {
  name: string
  class: string
  half_width_m: number
  centerline: [number, number][]
  polygon: [number, number][][]
}

export interface ScenarioContext {
  streets?: StreetCtx[]
  blocks?: { polygon: [number, number][][]; edge: boolean }[]
  buildings?: { polygon: [number, number][][]; edge: boolean }[]
  street_labels?: { text: string; lon: number; lat: number; rotate: number }[]
  places?: { id: string; role: string; label: string; category: Category | null; lon: number; lat: number }[]
  frame?: string
  [k: string]: unknown
}

export interface Provenance {
  id: string
  name: string
  kind: string
  description?: string
  url?: string
  retrieved_at?: string
  record_count?: number
  license?: string
  [k: string]: unknown
}

export interface ScenarioOut extends ScenarioSummary {
  nodes: NodeOut[]
  edges: EdgeOut[]
  origins: OriginOut[]
  destinations: DestinationOut[]
  interventions: InterventionOut[]
  max_distance_m: number | null
  default_journey: [string, string] | null
  bounds: [number, number, number, number] | null
  context: ScenarioContext
  assumptions: string[]
  provenance: Provenance[]
}

export interface RouteOut {
  found: boolean
  origin: string
  destination: string
  node_ids: string[]
  edge_ids: string[]
  length_m: number | null
  geometry: [number, number][]
  reason: string
}

export interface JourneyOut {
  route: RouteOut
  potential_route: RouteOut | null
  potential_blockers: string[]
  reach_wave: Record<string, number>
  reached_destinations: string[]
  frontier_barriers: string[]
  alternatives: RouteOut[]
}

export interface MetricsOut {
  score: number
  max_possible: number
  connected_pairs: number
  total_pairs: number
  reachable_destinations: number
  total_destinations: number
  components: number
  cutoff_m: number | null
}

export interface EvaluateResponse {
  scenario_id: string
  applied: string[]
  edge_states: Record<string, EffectiveState>
  state_counts: Record<string, number>
  journey: JourneyOut | null
  metrics: MetricsOut
  per_origin: { origin: string; reachable: string[]; distances_m: Record<string, number | null> }[]
}

export interface SolverOut {
  solver: string
  exact: boolean
  selected: string[]
  selected_labels: string[]
  score: number
  gain: number
  connected_pairs: number
  evaluations: number
  runtime_ms: number
  candidate_count: number
  considered_count: number
  notes: string[]
}

export interface PairOut {
  origin: string
  origin_label: string
  destination: string
  destination_label: string
  category: Category
  before_m: number | null
  after_m: number
  weight: number
}

export interface OptimizeResponse {
  scenario_id: string
  params: { budget: number; weights: Weights; cutoff_m: number | null; candidate_count: number }
  objective: {
    name: string
    formula: string
    before: number
    after: number
    gain: number
    relative_gain: number | null
    max_possible: number
    connected_pairs_before: number
    connected_pairs_after: number
    total_pairs: number
  }
  recommendation: SolverOut
  baselines: SolverOut[]
  advantage_over_best_baseline: number
  best_baseline: string
  newly_connected_pairs: PairOut[]
  shortened_pairs: PairOut[]
  newly_reachable_destinations: { id: string; label: string; category: Category }[]
  contributions: { id: string; label: string; alone_gain: number; marginal_in_set: number }[]
  synergy: number
  alternatives: { selected: string[]; selected_labels: string[]; score: number; gain: number }[]
  sensitivity: {
    assumption: string
    baseline_score: number
    score_with_selected: number
    optimal_selected: string[]
    optimal_score: number
    optimal_method: string
    optimal_is_exact: boolean
    recommendation_changes: boolean | null
    unknown_edge_count: number
  }
  explanation: string[]
  assumptions: string[]
}

export type ClientAction =
  | { type: 'show_analysis'; budget: number; weights: Weights }
  | { type: 'set_budget_preview'; budget: number }
  | { type: 'set_priority_preview'; priority: Priority }
  | { type: 'highlight_disconnected' }
  | { type: 'highlight_candidates'; ids: string[] }
  | { type: 'apply'; id: string }
  | { type: 'undo' }
  | { type: 'reset' }
  | { type: 'show_route' }

export interface AssistantResponse {
  ok: boolean
  interpretation: {
    source: 'rules' | 'llm'
    intent: { operation: string; budget: number | null; priority: Priority | null; intervention_id: string | null; category: Category | null } | null
    latency_ms?: number
    model?: string
    error?: string
  }
  operation: string | null
  facts: string[]
  result: Record<string, unknown> | null
  client_action: ClientAction | null
  narrative: string | null
}

export interface HealthOut {
  status: string
  version: string
  scenarios: ScenarioSummary[]
  llm: { enabled: boolean; available: boolean; model: string; endpoint: string; detail?: string }
}
