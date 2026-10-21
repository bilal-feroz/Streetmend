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

export const GUIDED_ID = 'guided'
export const EXPLORER_ID = 'charlotte-elizabeth'

export type Selection = { type: 'intervention' | 'edge' | 'place' | 'record' | 'building'; id: string } | null
export type CameraPreset = 'overview' | 'journey' | 'street' | 'network' | 'top' | 'route' | 'point' | 'intervention'

export type IntroKind = 'full' | 'short' | 'none'
const INTRO_SEEN = 'streetmend.introSeen'

/** First visit: the full USA → Charlotte flight. Returning visits: a short
 * arrival. ?intro=0|1|short overrides; reduced motion skips the movement. */
function initialIntro(): IntroKind {
  if (typeof window === 'undefined') return 'none'
  const q = new URLSearchParams(window.location.search).get('intro')
  if (q === '0' || q === 'skip' || q === 'off') return 'none'
  if (q === '1' || q === 'full') return 'full'
  if (q === 'short') return 'short'
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 'none'
  try {
    if (window.localStorage.getItem(INTRO_SEEN)) return 'short'
  } catch {
    /* storage unavailable: treat as a first visit */
  }
  return 'full'
}

export interface Banner {
  kind: 'reconnected' | 'partial' | 'info'
  title: string
  body?: string
  nonce: number
}

export interface Layers {
  buildings: boolean
  network: boolean
  candidates: boolean
  places: boolean
  trees: boolean
  records: boolean
  inventory: boolean
}

export interface CameraRequest {
  preset: CameraPreset
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
  history: string[][]
  journey: { origin: string; destination: string } | null
  budget: number
  weights: Weights
  priority: Priority | 'custom'
  cutoff: number | null

  evaluation: EvaluateResponse | null
  initialEval: EvaluateResponse | null
  evaluating: boolean
  traceNonce: number
  /** the last repair the engine confirmed: drives the map's heal effect */
  heal: { id: string; nonce: number } | null

  analysis: OptimizeResponse | null
  analysisKey: string | null
  analyzing: boolean
  analysisError: string | null
  panelView: 'plan' | 'results'

  mapMode: '2d' | '3d'
  compare: 'off' | 'split' | 'before'
  split: number
  camera: CameraRequest | null
  selected: Selection
  hovered: string | null
  highlight: string[]
  layers: Layers
  banner: Banner | null

  presenting: boolean
  scene: number
  sceneBusy: boolean

  intro: { kind: IntroKind; phase: 'running' | 'done'; nonce: number }

  assistantPending: boolean
  assistantLast: AssistantResponse | null
  assistantError: string | null
  useLLM: boolean

  dialog: 'methods' | 'help' | 'settings' | null
  panelOpen: boolean
  explorerTab: 'plan' | 'records' | 'quality'
  records: MunicipalRecords | null
  recordsError: string | null

  init: () => Promise<void>
  loadScenario: (id: string) => Promise<void>
  setBudget: (b: number) => void
  setWeights: (w: Weights) => void
  setPriority: (p: Priority) => void
  setCutoff: (c: number | null) => void
  setJourney: (origin: string, destination: string) => void
  apply: (id: string, opts?: { narrate?: boolean; camera?: boolean }) => Promise<void>
  remove: (id: string) => Promise<void>
  /** Move to exactly this repair set: extends by applying (with narration and the heal), otherwise jumps. */
  setRepairs: (ids: string[]) => Promise<void>
  undo: () => Promise<void>
  reset: () => Promise<void>
  analyze: () => Promise<void>
  ask: (text: string) => Promise<void>
  select: (s: Selection) => void
  setHovered: (k: string | null) => void
  toggleLayer: (k: keyof Layers) => void
  setMapMode: (m: '2d' | '3d') => void
  setCompare: (c: 'off' | 'split' | 'before') => void
  setSplit: (x: number) => void
  cameraTo: (c: Omit<CameraRequest, 'nonce'>) => void
  replay: () => void
  dismissBanner: () => void
  setPanelView: (v: 'plan' | 'results') => void
  setDialog: (d: AppState['dialog']) => void
  setPanelOpen: (open: boolean) => void
  setUseLLM: (v: boolean) => void
  setExplorerTab: (t: AppState['explorerTab']) => void
  startPresentation: () => void
  stopPresentation: () => void
  replayIntro: () => void
  finishIntro: () => void
  goToScene: (n: number) => Promise<void>
}

let evalSeq = 0
let analysisSeq = 0
let bannerSeq = 0
let camSeq = 0
let reanalyzeTimer: ReturnType<typeof setTimeout> | undefined

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : (e as Error).message)
const NUMBER_WORDS = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT']
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export const SCENES = [
  { title: 'The city', caption: 'Elizabeth, Charlotte: real streets and real building footprints. The barriers in this scenario are hypothetical.' },
  { title: 'The disconnected journey', caption: 'A short trip from Hawthorne Lane to the hospital stops at one crossing of East 7th Street, where both curb ramps are blocked.' },
  { title: 'The repair recommendation', caption: 'With a budget of two, the engine evaluates every combination of candidate repairs and picks the pair that works together.' },
  { title: 'The first intervention', caption: 'Repair A alone. The engine recomputes: one end of the crossing is fixed, but the journey is still broken.' },
  { title: 'The second intervention', caption: 'Repair B completes the crossing. The new route is traced through the real street graph.' },
  { title: 'The measured result', caption: 'Before and after on the same view: journeys connected, access gained, and how simple ranking compares.' },
] as const

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

  async function refreshInitial() {
    const s = get()
    try {
      const r = await api.evaluate(s.scenarioId, { applied: [], origin: s.journey?.origin, destination: s.journey?.destination, weights: s.weights, cutoff_m: s.cutoff })
      if (get().scenarioId === s.scenarioId) set({ initialEval: r })
    } catch {
      /* the current evaluation carries the error */
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

  function crossingOf(iid: string): string | null {
    return (get().scenario?.interventions.find((i) => i.id === iid)?.attrs?.crossing as string | undefined) ?? null
  }

  /** Narrate the latest repair using only engine-computed state. */
  async function narrateRepair(id: string, before: EvaluateResponse | null, after: EvaluateResponse | null, camera: boolean) {
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
        // Verify "neither alone" with the engine before stating it.
        const checks = await Promise.all(
          onRoute.map((aid) =>
            api
              .evaluate(s.scenarioId, { applied: s.applied.filter((x) => x !== aid), origin: s.journey?.origin, destination: s.journey?.destination, weights: s.weights, cutoff_m: s.cutoff })
              .then((r) => r.journey?.route.found ?? true)
              .catch(() => true),
          ),
        )
        if (checks.every((found) => !found)) {
          const sameCrossing = onRoute.length === 2 && crossingOf(onRoute[0]) !== null && crossingOf(onRoute[0]) === crossingOf(onRoute[1])
          body =
            onRoute.length === 2
              ? `Neither repair completes this ${sameCrossing ? 'crossing' : 'journey'} alone. Together, they unlock a continuous modeled route.`
              : `Every one of these ${onRoute.length} repairs is required: removing any one breaks the modeled route.`
        }
      }
      const n = Math.max(onRoute.length, 1)
      banner({ kind: 'reconnected', title: `${NUMBER_WORDS[n] ?? n} REPAIR${n === 1 ? '' : 'S'}. ONE RECONNECTED JOURNEY.`, body })
      if (camera) {
        if (iv) get().cameraTo({ preset: 'point', lonlat: [iv.lon, iv.lat] })
        setTimeout(() => get().cameraTo({ preset: 'route' }), 1700)
      }
    } else if (!nowFound) {
      const next = [...new Set(after.journey.potential_blockers)].filter((r) => !s.applied.includes(r))
      const sameCrossing = next.length === 1 && crossingOf(next[0]) !== null && crossingOf(next[0]) === crossingOf(id)
      banner({
        kind: 'partial',
        title: sameCrossing ? 'One connection repaired. The crossing remains incomplete.' : `Repair ${id} applied. The journey is still unavailable.`,
        body: next.length
          ? sameCrossing
            ? `Repair ${next[0]} at the other end of the same crossing is still blocked, so the engine finds no continuous route.`
            : `${next.length === 1 ? 'Barrier' : 'Barriers'} ${next.join(', ')} still ${next.length === 1 ? 'blocks' : 'block'} the best repairable route.`
          : 'No continuous route exists in the modeled network yet.',
      })
      if (camera && iv) get().cameraTo({ preset: 'intervention', id })
    }
  }

  return {
    health: null,
    scenarioId: GUIDED_ID,
    scenario: null,
    loading: true,
    error: null,
    applied: [],
    history: [],
    journey: null,
    budget: 2,
    weights: PRESETS.healthcare,
    priority: 'healthcare',
    cutoff: null,
    evaluation: null,
    initialEval: null,
    evaluating: false,
    traceNonce: 0,
    heal: null,
    analysis: null,
    analysisKey: null,
    analyzing: false,
    analysisError: null,
    panelView: 'plan',
    mapMode: '3d',
    compare: 'off',
    split: 0.5,
    camera: null,
    selected: null,
    hovered: null,
    highlight: [],
    layers: { buildings: true, network: true, candidates: true, places: true, trees: true, records: false, inventory: false },
    banner: null,
    presenting: false,
    scene: 0,
    sceneBusy: false,
    intro: { kind: initialIntro(), phase: 'running', nonce: 0 },
    assistantPending: false,
    assistantLast: null,
    assistantError: null,
    useLLM: true,
    dialog: null,
    panelOpen: false,
    explorerTab: 'plan',
    records: null,
    recordsError: null,

    init: async () => {
      api.health().then((h) => set({ health: h })).catch(() => set({ health: null }))
      await get().loadScenario(get().scenarioId)
    },

    loadScenario: async (id) => {
      analysisSeq++
      evalSeq++
      clearTimeout(reanalyzeTimer)
      set({
        loading: true, analyzing: false, error: null, scenarioId: id, analysis: null, analysisKey: null, applied: [], history: [],
        banner: null, selected: null, highlight: [], evaluation: null, initialEval: null, assistantLast: null, assistantError: null,
        panelView: 'plan', compare: 'off', presenting: false, scene: 0,
      })
      try {
        const sc = await api.scenario(id)
        if (sc.mode === 'municipal' && !get().records) {
          api.records().then((r) => set({ records: r })).catch((e) => set({ recordsError: errMsg(e) }))
        }
        const dj = sc.default_journey
        set({ scenario: sc, journey: dj ? { origin: dj[0], destination: dj[1] } : null, cutoff: sc.max_distance_m, loading: false })
        const ev = await evaluate()
        set({ initialEval: ev, camera: { preset: sc.mode === 'municipal' ? 'overview' : 'journey', nonce: ++camSeq } })
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
      void evaluate().then(() => refreshInitial())
      scheduleReanalysis()
    },
    setPriority: (p) => {
      set({ weights: PRESETS[p], priority: p })
      void evaluate().then(() => refreshInitial())
      scheduleReanalysis()
    },
    setCutoff: (c) => {
      set({ cutoff: c })
      void evaluate({ animate: true }).then(() => refreshInitial())
      scheduleReanalysis()
    },
    setJourney: (origin, destination) => {
      set({ journey: { origin, destination }, banner: null })
      void evaluate({ animate: true }).then(() => refreshInitial())
    },

    apply: async (id, opts = {}) => {
      if (get().applied.includes(id)) return
      const before = get().evaluation
      set((s) => ({ history: [...s.history, s.applied], applied: [...s.applied, id], compare: s.compare === 'before' ? 'off' : s.compare }))
      const after = await evaluate({ animate: true })
      if (after && get().applied.includes(id)) set((s) => ({ heal: { id, nonce: (s.heal?.nonce ?? 0) + 1 } }))
      if (opts.narrate !== false) await narrateRepair(id, before, after, opts.camera !== false)
    },
    remove: async (id) => {
      if (!get().applied.includes(id)) return
      set((s) => ({ history: [...s.history, s.applied], applied: s.applied.filter((x) => x !== id), banner: null }))
      await evaluate({ animate: true })
    },
    setRepairs: async (ids) => {
      const cur = get().applied
      if (cur.length === ids.length && cur.every((x) => ids.includes(x))) return
      if (cur.every((x) => ids.includes(x))) {
        for (const id of ids.filter((x) => !cur.includes(x))) {
          await get().apply(id)
          if (ids[ids.length - 1] !== id) await sleep(900) // let each repair land before the next
        }
        return
      }
      set((s) => ({ history: [...s.history, s.applied], applied: [...ids], banner: null }))
      await evaluate({ animate: true })
    },
    undo: async () => {
      const h = get().history
      if (!h.length) return
      set({ applied: h[h.length - 1], history: h.slice(0, -1), banner: null })
      await evaluate({ animate: true })
    },
    reset: async () => {
      set((s) => ({ history: s.applied.length ? [...s.history, s.applied] : s.history, applied: [], banner: null, selected: null, highlight: s.analysis?.recommendation.selected ?? [], compare: 'off' }))
      await evaluate({ animate: true })
    },

    analyze: async () => {
      const s = get()
      if (!s.scenario) return
      const seq = ++analysisSeq
      const k = key()
      set({ analyzing: true, analysisError: null })
      try {
        const res = await api.optimize(s.scenarioId, { budget: s.budget, weights: s.weights, cutoff_m: s.cutoff })
        if (seq !== analysisSeq) return
        set({ analysis: res, analysisKey: k, analyzing: false, highlight: res.recommendation.selected, panelView: 'results' })
      } catch (e) {
        if (seq === analysisSeq) set({ analyzing: false, analysisError: errMsg(e) })
      }
    },

    ask: async (text) => {
      const s = get()
      set({ assistantPending: true, assistantError: null })
      try {
        const res = await api.assistant({
          text, scenario_id: s.scenarioId, applied: s.applied, budget: s.budget, weights: s.weights, use_llm: s.useLLM,
          cutoff_m: s.cutoff, origin: s.journey?.origin, destination: s.journey?.destination,
        })
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
            get().cameraTo({ preset: 'route' })
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
    setHovered: (k) => set({ hovered: k }),
    toggleLayer: (k) => set((s) => ({ layers: { ...s.layers, [k]: !s.layers[k] } })),
    setMapMode: (m) => set({ mapMode: m }),
    setCompare: (c) => set((s) => ({ compare: c, traceNonce: s.traceNonce + 1 })),
    setSplit: (x) => set({ split: Math.min(0.95, Math.max(0.05, x)) }),
    cameraTo: (c) => set({ camera: { ...c, nonce: ++camSeq } }),
    replay: () => set((s) => ({ traceNonce: s.traceNonce + 1 })),
    dismissBanner: () => set({ banner: null }),
    setPanelView: (v) => set({ panelView: v }),
    setDialog: (d) => set({ dialog: d }),
    setPanelOpen: (open) => set({ panelOpen: open }),
    setUseLLM: (v) => set({ useLLM: v }),
    setExplorerTab: (t) => set({ explorerTab: t }),

    startPresentation: () => {
      set({ presenting: true })
      void get().goToScene(0)
    },
    stopPresentation: () => set({ presenting: false }),
    replayIntro: () => set((s) => ({ intro: { kind: 'full', phase: 'running', nonce: s.intro.nonce + 1 }, presenting: false, compare: 'off', selected: null, banner: null })),
    finishIntro: () => {
      try {
        window.localStorage.setItem(INTRO_SEEN, '1')
      } catch {
        /* not persisted; the next visit plays the intro again */
      }
      set((s) => ({ intro: { ...s.intro, phase: 'done' } }))
    },

    /** Each scene sets up its state from scratch through the real engine. */
    goToScene: async (n) => {
      const s = get()
      if (s.sceneBusy || !s.scenario) return
      set({ scene: n, sceneBusy: true, banner: null })
      const sc = s.scenario
      const dj = sc.default_journey
      try {
        if (dj && (s.journey?.origin !== dj[0] || s.journey?.destination !== dj[1])) {
          set({ journey: { origin: dj[0], destination: dj[1] } })
        }
        const needApplied = n <= 2 ? [] : n === 3 ? ['A'] : ['A', 'B']
        set({ banner: null })
        const hasAB = sc.interventions.some((i) => i.id === 'A') && sc.interventions.some((i) => i.id === 'B')
        if (n >= 2 && (s.budget !== 2 || s.priority !== 'healthcare')) set({ budget: 2, weights: PRESETS.healthcare, priority: 'healthcare' })
        if (n === 0) {
          set({ applied: [], history: [], selected: null, compare: 'off', mapMode: '3d' })
          await evaluate({ animate: true })
          get().cameraTo({ preset: 'overview' })
        } else if (n === 1) {
          set({ applied: [], compare: 'off', mapMode: '3d', selected: hasAB ? { type: 'intervention', id: 'A' } : null })
          await evaluate({ animate: true })
          get().cameraTo(hasAB ? { preset: 'street' } : { preset: 'route' })
        } else if (n === 2) {
          set({ applied: [], selected: null, compare: 'off' })
          await evaluate()
          await get().analyze()
          get().cameraTo({ preset: 'journey' })
        } else if (n === 3 || n === 4) {
          if (!get().analysis) await get().analyze()
          const target = needApplied[needApplied.length - 1]
          const prior = needApplied.slice(0, -1)
          set({ applied: prior, compare: 'off', selected: null })
          await evaluate()
          get().cameraTo({ preset: 'intervention', id: target })
          await sleep(900)
          await get().apply(target, { narrate: true, camera: n === 4 })
        } else if (n === 5) {
          if (get().applied.join() !== 'A,B') {
            set({ applied: ['A', 'B'] })
            await evaluate()
          }
          if (!get().analysis) await get().analyze()
          set({ panelView: 'results', compare: 'split', split: 0.5 })
          get().cameraTo({ preset: 'journey' })
        }
      } finally {
        set({ sceneBusy: false })
      }
    },
  }
})

export const isAnalysisStale = (s: Pick<AppState, 'analysisKey' | 'scenarioId' | 'budget' | 'weights' | 'cutoff'>) =>
  s.analysisKey !== null && s.analysisKey !== JSON.stringify([s.scenarioId, s.budget, s.weights, s.cutoff])
