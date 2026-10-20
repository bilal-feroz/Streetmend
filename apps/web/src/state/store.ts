import { create } from 'zustand'
import { api, ApiError, type MunicipalRecords } from '../api/client'
import type {
  AssistantResponse,
  EvaluateResponse,
  HealthOut,
  OptimizeResponse,
  Priority,
  ScenarioOut,
  Weights,
} from '../api/types'

export const PRESETS: Record<Priority, Weights> = {
  balanced: { healthcare: 1, transit: 1, education: 1 },
  healthcare: { healthcare: 3, transit: 1, education: 1 },
  transit: { healthcare: 1, transit: 3, education: 1 },
  education: { healthcare: 1, transit: 1, education: 3 },
}

export type Selection = { type: 'intervention' | 'edge' | 'place' | 'record'; id: string } | null

export interface Banner {
  kind: 'reconnected' | 'partial' | 'info' | 'error'
  title: string
  body?: string
  nonce: number
}

export interface Layers {
  records: boolean
  inventory: boolean
  network: boolean
  wave: boolean
  candidates: boolean
  places: boolean
  context: boolean
  labels: boolean
}

export interface Focus {
  kind: 'intervention' | 'route' | 'bounds' | 'point'
  id?: string
  lonlat?: [number, number]
  nonce: number
}

interface AppState {
  health: HealthOut | null
  scenarioId: string
  scenario: ScenarioOut | null
  loading: boolean
  error: string | null

  applied: string[]
  journey: { origin: string; destination: string } | null
  budget: number
  weights: Weights
  priority: Priority | 'custom'
  cutoff: number | null

  evaluation: EvaluateResponse | null
  initialEval: EvaluateResponse | null
  evaluating: boolean
  traceNonce: number // bump to (re)play the route/reach animation

  analysis: OptimizeResponse | null
  analysisKey: string | null
  analyzing: boolean
  analysisError: string | null
  lastAnalysisMs: number | null

  compare: 'current' | 'before'
  selected: Selection
  highlight: string[] // intervention ids highlighted by the assistant
  layers: Layers
  banner: Banner | null
  focus: Focus | null

  assistantPending: boolean
  assistantLast: AssistantResponse | null
  assistantError: string | null
  useLLM: boolean

  methodologyOpen: boolean
  panelOpen: boolean
  panelTab: 'plan' | 'records' | 'quality'
  records: MunicipalRecords | null
  recordsError: string | null

  init: () => Promise<void>
  loadScenario: (id: string) => Promise<void>
  setBudget: (b: number) => void
  setWeights: (w: Weights) => void
  setPriority: (p: Priority) => void
  setCutoff: (c: number | null) => void
  setJourney: (origin: string, destination: string) => void
  apply: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
  undo: () => Promise<void>
  reset: () => Promise<void>
  analyze: () => Promise<void>
  ask: (text: string) => Promise<void>
  select: (s: Selection) => void
  toggleLayer: (k: keyof Layers) => void
  setCompare: (c: 'current' | 'before') => void
  focusOn: (f: Omit<Focus, 'nonce'>) => void
  replay: () => void
  dismissBanner: () => void
  setMethodology: (open: boolean) => void
  setPanelOpen: (open: boolean) => void
  setUseLLM: (v: boolean) => void
  setPanelTab: (t: 'plan' | 'records' | 'quality') => void
}

let evalSeq = 0
let analysisSeq = 0
let bannerSeq = 0
let focusSeq = 0
let reanalyzeTimer: ReturnType<typeof setTimeout> | undefined

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : (e as Error).message)

const NUMBER_WORDS = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT']

export const useApp = create<AppState>((set, get) => {
  const key = () => {
    const s = get()
    return JSON.stringify([s.scenarioId, s.budget, s.weights, s.cutoff])
  }

  async function evaluate(opts: { animate?: boolean } = {}) {
    const s = get()
    if (!s.scenario) return null
    const seq = ++evalSeq
    set({ evaluating: true })
    try {
      const res = await api.evaluate(s.scenarioId, {
        applied: s.applied,
        origin: s.journey?.origin,
        destination: s.journey?.destination,
        weights: s.weights,
        cutoff_m: s.cutoff,
        alternatives: 2,
      })
      if (seq !== evalSeq) return null
      set((st) => ({ evaluation: res, evaluating: false, error: null, traceNonce: opts.animate ? st.traceNonce + 1 : st.traceNonce }))
      return res
    } catch (e) {
      if (seq === evalSeq) set({ evaluating: false, error: errMsg(e) })
      return null
    }
  }

  function scheduleReanalysis() {
    if (!get().analysis) return
    clearTimeout(reanalyzeTimer)
    reanalyzeTimer = setTimeout(() => void get().analyze(), 220)
  }

  function banner(b: Omit<Banner, 'nonce'>) {
    set({ banner: { ...b, nonce: ++bannerSeq } })
  }

  /** Narrate the effect of the latest repair using only computed state. */
  async function narrateRepair(id: string, before: EvaluateResponse | null, after: EvaluateResponse | null) {
    const s = get()
    if (!after?.journey || !before?.journey || !s.scenario) return
    const wasFound = before.journey.route.found
    const nowFound = after.journey.route.found
    const iv = s.scenario.interventions.find((i) => i.id === id)
    if (!wasFound && nowFound) {
      const onRoute = s.applied.filter((aid) => {
        const edges = s.scenario!.interventions.find((i) => i.id === aid)?.edge_ids ?? []
        return edges.some((e) => after.journey!.route.edge_ids.includes(e))
      })
      let body = 'The modeled journey is now continuous.'
      if (onRoute.length >= 2) {
        // Verify the "neither alone" claim against the engine before stating it.
        const checks = await Promise.all(
          onRoute.map((aid) =>
            api
              .evaluate(s.scenarioId, {
                applied: s.applied.filter((x) => x !== aid),
                origin: s.journey?.origin,
                destination: s.journey?.destination,
                weights: s.weights,
                cutoff_m: s.cutoff,
              })
              .then((r) => r.journey?.route.found ?? true)
              .catch(() => true),
          ),
        )
        if (checks.every((found) => !found)) {
          body =
            onRoute.length === 2
              ? 'Neither intervention completes this crossing alone. Together, they unlock a continuous modeled route.'
              : `Every one of these ${onRoute.length} repairs is required: removing any one breaks the modeled route.`
        }
      }
      const n = Math.max(onRoute.length, 1)
      banner({
        kind: 'reconnected',
        title: `${NUMBER_WORDS[n] ?? n} REPAIR${n === 1 ? '' : 'S'}. ONE RECONNECTED JOURNEY.`,
        body,
      })
      const r = after.journey.route
      if (r.geometry.length) {
        const mid = r.geometry[Math.floor(r.geometry.length / 2)]
        set({ focus: { kind: 'point', lonlat: iv ? [iv.lon, iv.lat] : mid, nonce: ++focusSeq } })
        setTimeout(() => get().focusOn({ kind: 'route' }), 1500)
      }
    } else if (!nowFound) {
      const owners = new Map<string, string>()
      s.scenario.interventions.forEach((i) => i.edge_ids.forEach((e) => owners.set(e, i.id)))
      const remaining = after.journey.frontier_barriers.map((e) => owners.get(e)).filter((x): x is string => !!x)
      const recommended = s.analysis?.recommendation.selected ?? []
      const next = remaining.filter((r) => recommended.includes(r) && !s.applied.includes(r))
      const appliedRec = s.applied.filter((a) => recommended.includes(a)).length
      banner({
        kind: 'partial',
        title: `Repair ${id} completed${appliedRec ? ` (${appliedRec} of ${recommended.length} recommended)` : ''}.`,
        body: next.length
          ? `The journey is still unavailable. The route now reaches barrier ${next.join(', ')}, which still blocks the crossing.`
          : 'The journey is still unavailable in the modeled network.',
      })
      if (iv) set({ focus: { kind: 'intervention', id, nonce: ++focusSeq } })
    }
  }

  return {
    health: null,
    scenarioId: 'demo',
    scenario: null,
    loading: true,
    error: null,
    applied: [],
    journey: null,
    budget: 2,
    weights: PRESETS.healthcare,
    priority: 'healthcare',
    cutoff: null,
    evaluation: null,
    initialEval: null,
    evaluating: false,
    traceNonce: 0,
    analysis: null,
    analysisKey: null,
    analyzing: false,
    analysisError: null,
    lastAnalysisMs: null,
    compare: 'current',
    selected: null,
    highlight: [],
    layers: { records: false, inventory: false, network: true, wave: true, candidates: true, places: true, context: true, labels: true },
    banner: null,
    focus: null,
    assistantPending: false,
    assistantLast: null,
    assistantError: null,
    useLLM: true,
    methodologyOpen: false,
    panelOpen: false,
    panelTab: 'plan',
    records: null,
    recordsError: null,

    init: async () => {
      api.health().then((h) => set({ health: h })).catch(() => set({ health: null }))
      await get().loadScenario(get().scenarioId)
    },

    loadScenario: async (id) => {
      set({ loading: true, error: null, scenarioId: id, analysis: null, analysisKey: null, applied: [], banner: null, selected: null, highlight: [], evaluation: null, initialEval: null })
      try {
        const sc = await api.scenario(id)
        if (sc.mode === 'municipal' && !get().records) {
          api.records().then((r) => set({ records: r })).catch((e) => set({ recordsError: errMsg(e) }))
        }
        const dj = sc.default_journey
        set({ scenario: sc, journey: dj ? { origin: dj[0], destination: dj[1] } : null, cutoff: sc.max_distance_m, loading: false })
        const ev = await evaluate()
        set({ initialEval: ev, focus: { kind: 'bounds', nonce: ++focusSeq } })
      } catch (e) {
        set({ loading: false, error: errMsg(e) })
      }
    },

    setBudget: (b) => {
      set({ budget: b })
      scheduleReanalysis()
    },
    setWeights: (w) => {
      set({ weights: w, priority: 'custom' })
      void evaluate()
      scheduleReanalysis()
    },
    setPriority: (p) => {
      set({ weights: PRESETS[p], priority: p })
      void evaluate()
      scheduleReanalysis()
    },
    setCutoff: (c) => {
      set({ cutoff: c })
      void evaluate({ animate: true }).then((ev) => {
        // The initial (no-repair) reference must use the same threshold.
        if (ev && get().applied.length === 0) set({ initialEval: ev })
      })
      if (get().applied.length) {
        const s = get()
        api.evaluate(s.scenarioId, { applied: [], origin: s.journey?.origin, destination: s.journey?.destination, weights: s.weights, cutoff_m: c })
          .then((r) => set({ initialEval: r }))
          .catch(() => {})
      }
      scheduleReanalysis()
    },
    setJourney: (origin, destination) => {
      set({ journey: { origin, destination }, banner: null })
      void evaluate({ animate: true })
    },

    apply: async (id) => {
      if (get().applied.includes(id)) return
      const before = get().evaluation
      set((s) => ({ applied: [...s.applied, id], compare: 'current' }))
      const after = await evaluate({ animate: true })
      await narrateRepair(id, before, after)
    },
    remove: async (id) => {
      set((s) => ({ applied: s.applied.filter((x) => x !== id), banner: null }))
      await evaluate({ animate: true })
    },
    undo: async () => {
      const a = get().applied
      if (!a.length) return
      set({ applied: a.slice(0, -1), banner: null })
      await evaluate({ animate: true })
    },
    reset: async () => {
      set({ applied: [], banner: null, compare: 'current', selected: null, highlight: [] })
      await evaluate({ animate: true })
      set({ focus: { kind: 'bounds', nonce: ++focusSeq } })
    },

    analyze: async () => {
      const s = get()
      if (!s.scenario) return
      const seq = ++analysisSeq
      const k = key()
      set({ analyzing: true, analysisError: null })
      const t0 = performance.now()
      try {
        const res = await api.optimize(s.scenarioId, { budget: s.budget, weights: s.weights, cutoff_m: s.cutoff })
        if (seq !== analysisSeq) return
        set({ analysis: res, analysisKey: k, analyzing: false, lastAnalysisMs: performance.now() - t0, highlight: res.recommendation.selected })
      } catch (e) {
        if (seq === analysisSeq) set({ analyzing: false, analysisError: errMsg(e) })
      }
    },

    ask: async (text) => {
      const s = get()
      set({ assistantPending: true, assistantError: null })
      try {
        const res = await api.assistant({ text, scenario_id: s.scenarioId, applied: s.applied, budget: s.budget, weights: s.weights, use_llm: s.useLLM })
        set({ assistantLast: res, assistantPending: false })
        const a = res.client_action
        if (!a) return
        switch (a.type) {
          case 'show_analysis': {
            const p = (Object.keys(PRESETS) as Priority[]).find((k) => JSON.stringify(PRESETS[k]) === JSON.stringify(a.weights))
            set({ budget: a.budget, weights: a.weights, priority: p ?? 'custom' })
            await evaluate()
            await get().analyze()
            break
          }
          case 'apply':
            await get().apply(a.id)
            break
          case 'undo':
            await get().undo()
            break
          case 'reset':
            await get().reset()
            break
          case 'show_route':
            get().replay()
            get().focusOn({ kind: 'route' })
            break
          case 'highlight_candidates':
            set({ highlight: a.ids })
            break
          default:
            break
        }
      } catch (e) {
        set({ assistantPending: false, assistantError: errMsg(e) })
      }
    },

    select: (sel) => set({ selected: sel }),
    toggleLayer: (k) => set((s) => ({ layers: { ...s.layers, [k]: !s.layers[k] } })),
    setCompare: (c) => set((s) => ({ compare: c, traceNonce: s.traceNonce + 1 })),
    focusOn: (f) => set({ focus: { ...f, nonce: ++focusSeq } }),
    replay: () => set((s) => ({ traceNonce: s.traceNonce + 1 })),
    dismissBanner: () => set({ banner: null }),
    setMethodology: (open) => set({ methodologyOpen: open }),
    setPanelOpen: (open) => set({ panelOpen: open }),
    setUseLLM: (v) => set({ useLLM: v }),
    setPanelTab: (t) => set({ panelTab: t }),
  }
})

export const isAnalysisStale = (s: Pick<AppState, 'analysisKey' | 'scenarioId' | 'budget' | 'weights' | 'cutoff'>) =>
  s.analysisKey !== null && s.analysisKey !== JSON.stringify([s.scenarioId, s.budget, s.weights, s.cutoff])
