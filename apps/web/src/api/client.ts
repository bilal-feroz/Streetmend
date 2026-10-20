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

export interface MunicipalRecords {
  area: { id: string; name: string; bbox: [number, number, number, number] }
  provenance: Record<string, unknown>[]
  ramps: Record<string, unknown>[]
  sidewalks: Record<string, unknown>[]
  bus_stops: Record<string, unknown>[]
  quality: Record<string, unknown>
}
