import type {
  AssistantResponse,
  EvaluateResponse,
  HealthOut,
  OptimizeResponse,
  ScenarioOut,
  Weights,
} from './types'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number; text?: boolean }): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), init?.timeoutMs ?? 30_000)
  try {
    const res = await fetch(path, {
      ...init,
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    })
    if (!res.ok) {
      let detail = res.statusText
      try {
        const body = await res.json()
        detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
      } catch {
        /* non-JSON error body */
      }
      throw new ApiError(res.status, detail)
    }
    return (init?.text ? await res.text() : await res.json()) as T
  } catch (err) {
    if (err instanceof ApiError) throw err
    if ((err as Error).name === 'AbortError') throw new ApiError(0, 'Request timed out')
    throw new ApiError(0, 'StreetMend API is not reachable. Start it with `uv run uvicorn streetmend.api.main:app`.')
  } finally {
    clearTimeout(timer)
  }
}

const post = <T>(path: string, body: unknown, extra?: { timeoutMs?: number; text?: boolean }) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body), ...extra })

export const api = {
  health: () => request<HealthOut>('/api/health', { timeoutMs: 5000 }),
  scenario: (id: string) => request<ScenarioOut>(`/api/scenarios/${id}`),
  evaluate: (id: string, body: { applied: string[]; origin?: string; destination?: string; weights?: Weights; cutoff_m?: number | null; alternatives?: number }) =>
    post<EvaluateResponse>(`/api/scenarios/${id}/evaluate`, body),
  optimize: (id: string, body: { budget: number; weights: Weights; cutoff_m?: number | null }) =>
    post<OptimizeResponse>(`/api/scenarios/${id}/optimize`, body, { timeoutMs: 60_000 }),
  report: (id: string, applied: string[], body: { budget: number; weights: Weights; cutoff_m?: number | null }) =>
    post<string>(`/api/scenarios/${id}/report?applied=${encodeURIComponent(applied.join(','))}`, body, { text: true }),
  assistant: (body: { text: string; scenario_id: string; applied: string[]; budget: number; weights: Weights; use_llm: boolean }) =>
    post<AssistantResponse>('/api/assistant', body, { timeoutMs: 60_000 }),
  records: () => request<MunicipalRecords>('/api/municipal/records', { timeoutMs: 30_000 }),
}

export interface RecordFeature<P = Record<string, unknown>, G = { type: string; coordinates: unknown }> {
  type: 'Feature'
  geometry: G
  properties: P
}

export interface RampProps {
  OBJECTID: number
  RP_AssetID: string | null
  ADA_ID: string | null
  RP_IntID: string | null
  RP_Type: string | null
  RP_Street1: string | null
  RP_Street2: string | null
  RP_LocInInt: string | null
  RP_SurveyDate: string | null
  survey_date: string | null
  RP_ComplianceStatus: string | null
  RP_InitValidStatus: string | null
  RP_XWalk1: string | null
  RP_XWalk1Dir: string | null
  RP_XWalk2: string | null
  RP_XWalk2Dir: string | null
  RP_Slope: number | null
  RP_XSlope: number | null
  RP_GutterLipHt: number | null
  RP_SurfCond: string | null
  RP_Obs: string | null
  RP_ObsType: string | null
  Remediated: string | null
  RemediatedType: string | null
  RemediatedDate: string | null
  ActualCosts: number | null
  TechnicalInfeasibility: string | null
  classification: Record<string, string>
  state: Record<string, string>
  [k: string]: unknown
}

export interface MunicipalRecords {
  area: { id: string; name: string; bbox: [number, number, number, number] }
  provenance: Record<string, unknown>[]
  ramps: RecordFeature<RampProps, { type: 'Point'; coordinates: [number, number] }>[]
  sidewalks: RecordFeature<Record<string, string | number | null>, { type: 'LineString'; coordinates: [number, number][] }>[]
  bus_stops: RecordFeature[]
  quality: {
    retrieved_at: string
    layers: Record<string, { count?: number; missing?: Record<string, number>; duplicates_removed?: unknown[]; server_count?: number; transform?: { from_epsg: number; to_epsg: number; samples: number; max_error_m: number | null; note: string } }>
  }
  policies: Record<string, string>
}
