import { create } from 'zustand'
import { api, ApiError, type MunicipalRecords } from '../api/client'
import type {
  AssistantResponse,
  ChangeIn,
  FixResponse,
  ProposalSpec,
  VerifyResponse,
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
export const PREFLIGHT_ID = 'preflight'

/** ?scenario=guided|preflight|charlotte-elizabeth picks the starting mode (default: the change check). */
function initialScenario(): string {
  if (typeof window === 'undefined') return PREFLIGHT_ID
  const q = new URLSearchParams(window.location.search).get('scenario')
  return q && /^[a-z0-9-]{2,40}$/.test(q) ? q : PREFLIGHT_ID
}

export type CheckStage = 'baseline' | 'drafted' | 'checked' | 'fixed'
export const EXPLORER_ID = 'charlotte-elizabeth'

export type Selection = { type: 'intervention' | 'edge' | 'place' | 'record' | 'building'; id: string } | null
export type CameraPreset = 'overview' | 'journey' | 'street' | 'network' | 'top' | 'route' | 'point' | 'intervention' | 'closure' | 'cell' | 'fit'

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
  kind: 'reconnected' | 'partial' | 'info' | 'regression'
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
  points?: [number, number][]
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
  /** network links the assistant pointed at (critical closures), drawn as an overlay */
  edgeHighlight: string[]
  /** change check: which travel profile's route the map shows for the counterexample */
  ceView: 'none' | 'walking' | 'step_free'
  setCeView: (v: 'none' | 'walking' | 'step_free') => void
  layers: Layers
  banner: Banner | null

  presenting: boolean
  scene: number
  sceneBusy: boolean

  /** change check: draft proposal (drawn on the map), the proposal applied to the evaluated state, results */
  draft: ChangeIn[]
  changes: ChangeIn[]
  verify: VerifyResponse | null
  fix: FixResponse | null
  checkStage: CheckStage
  checkBusy: 'checks' | 'fix' | 'apply' | null
  checkError: string | null

  intro: { kind: IntroKind; phase: 'running' | 'done'; nonce: number }

  assistantPending: boolean
  assistantLast: AssistantResponse | null
  assistantError: string | null
  useLLM: boolean

  dialog: 'methods' | 'help' | 'settings' | 'evidence' | null
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
  proposeChange: (c: ChangeIn | ProposalSpec) => void
  withdrawChange: (id: string) => void
  runChecks: () => Promise<void>
  findFix: () => Promise<void>
  applyFix: () => Promise<void>
  toggleMitigation: (id: string) => Promise<void>
  resetCheck: () => Promise<void>
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

/** The change check, in six acts: every state is computed by the engine as you go. */
export const PREFLIGHT_SCENES = [
  { title: 'A city that works', caption: 'Before construction, homes on Hawthorne Lane have a step-free route to Novant Health Presbyterian in the model.' },
  { title: 'A planner proposes a change', caption: 'A hypothetical construction closure of the East 7th Street crossing. It changes the proposed network, not today’s.' },
  { title: 'StreetMend finds a regression', caption: 'Every access check runs on the proposed network. One journey loses its only step-free route; walkers still get through.' },
  { title: 'StreetMend finds a fix', caption: 'Exact search over the mitigation catalog for the smallest set that makes every failed check pass.' },
  { title: 'Apply and verify', caption: 'The fix is applied to a new network state and the original checks run again.' },
  { title: 'The engine is real', caption: 'Remove one intervention and the check fails again. Put it back and it passes. Nothing is pre-recorded.' },
] as const

export const scenesFor = (id: string): readonly { title: string; caption: string }[] => (id === PREFLIGHT_ID ? PREFLIGHT_SCENES : SCENES)

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
        changes: s.changes,
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
    scenarioId: initialScenario(),
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
    edgeHighlight: [],
    ceView: 'none',
    setCeView: (v) => set({ ceView: v }),
    layers: { buildings: true, network: true, candidates: true, places: true, trees: true, records: false, inventory: false },
    banner: null,
    presenting: false,
    scene: 0,
    sceneBusy: false,
    draft: [],
    changes: [],
    verify: null,
    fix: null,
    checkStage: 'baseline',
    checkBusy: null,
    checkError: null,
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
        banner: null, selected: null, highlight: [], edgeHighlight: [], ceView: 'none', evaluation: null, initialEval: null, assistantLast: null, assistantError: null,
        panelView: 'plan', compare: 'off', presenting: false, scene: 0,
        draft: [], changes: [], verify: null, fix: null, checkStage: 'baseline', checkBusy: null, checkError: null,
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
      set({ assistantPending: true, assistantError: null, edgeHighlight: [] })
      const { useAccess } = await import('./access')
      const acc = useAccess.getState()
      const check = s.scenarioId === PREFLIGHT_ID
      try {
        const res = await api.assistant({
          text, scenario_id: s.scenarioId, applied: check ? [] : s.applied, budget: s.budget, weights: s.weights, use_llm: s.useLLM,
          cutoff_m: s.cutoff, origin: s.journey?.origin, destination: s.journey?.destination,
          // the change under test and its mitigations, so questions about the check are answered on that state
          changes: check ? (s.changes.length ? s.changes : s.draft) : [], mitigations: check ? s.applied : [],
          cell: acc.on ? acc.cell : null,
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
          case 'show_access':
          case 'show_compare': {
            const st = useAccess.getState()
            if (!st.on) await st.open()
            await useAccess.getState().setProfile(a.profile === 'pedestrian' ? 'pedestrian' : 'step_free')
            await useAccess.getState().setCategory(a.category as never)
            if (a.cell) await useAccess.getState().selectCell(a.cell)
            if (a.type === 'show_compare' && a.cell) {
              await useAccess.getState().setBudget(a.budget)
              await useAccess.getState().runCompare()
            }
            break
          }
          case 'highlight_edges': {
            set({ edgeHighlight: a.ids })
            const pts = a.ids.flatMap((id) => (get().scenario?.edges.find((e) => e.id === id)?.geometry ?? []) as [number, number][])
            if (pts.length) get().cameraTo({ preset: 'fit', points: pts })
            break
          }
          case 'find_fix':
            if (check && get().verify) await get().findFix()
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

    proposeChange: (c) => {
      const list = 'changes' in c ? c.changes : [c]
      set((s) => ({
        draft: [...s.draft.filter((d) => !list.some((x) => x.edge_id === d.edge_id)), ...list],
        checkStage: s.checkStage === 'baseline' ? 'drafted' : s.checkStage,
        banner: null,
      }))
      const e = get().scenario?.edges.find((x) => x.id === list[0]?.edge_id)
      if (e) get().cameraTo({ preset: 'closure', lonlat: e.geometry[Math.floor(e.geometry.length / 2)] as [number, number] })
    },

    withdrawChange: (id) => set((s) => ({ draft: s.draft.filter((d) => d.id !== id), checkStage: s.draft.length <= 1 && !s.changes.length ? 'baseline' : s.checkStage })),

    /** TEST: build the proposed state (proposal + current mitigations) and run every check on it. */
    runChecks: async () => {
      const s = get()
      if (!s.scenario || !s.journey) return
      set({ checkBusy: 'checks', checkError: null, changes: s.draft })
      try {
        const [res] = await Promise.all([
          api.verify(s.scenarioId, { proposal: s.draft, mitigations: s.applied, origin: s.journey.origin, destination: s.journey.destination }),
          evaluate({ animate: true }),
        ])
        const fixed = res.fixed
        const final = fixed ?? res.proposed
        const failing = final.checks.filter((c) => c.regression)
        set({ verify: res, checkBusy: null, checkStage: fixed && !failing.length ? 'fixed' : 'checked' })
        if (!s.draft.length) return
        if (failing.length) {
          const first = failing.find((c) => c.profile === 'step_free') ?? failing[0]
          const d = first.counterexample?.destination_label ?? 'an essential destination'
          banner({
            kind: 'regression',
            title: 'ACCESS REGRESSION DETECTED',
            body: first.profile === 'step_free' ? `Step-free access to ${d} has been lost in this modeled scenario.` : `${first.label}: ${first.value}.`,
          })
        } else if (fixed) {
          banner({ kind: 'reconnected', title: 'ACCESS RESTORED — CHECK PASSED', body: `All ${final.checks.length} access checks pass on the recomputed network.` })
        } else {
          banner({ kind: 'info', title: 'No regression found', body: `All ${final.checks.length} access checks still pass with this change.` })
        }
      } catch (e) {
        set({ checkBusy: null, checkError: errMsg(e) })
      }
    },

    /** GENERATE FIX: exact search for the smallest mitigation set; the engine verifies it. */
    findFix: async () => {
      const s = get()
      if (!s.journey || !s.changes.length) return
      set({ checkBusy: 'fix', checkError: null })
      try {
        const res = await api.verifyFix(s.scenarioId, { proposal: s.changes, origin: s.journey.origin, destination: s.journey.destination })
        set({ fix: res, checkBusy: null, highlight: res.interventions })
        if (res.status === 'found') {
          const n = res.interventions.length
          banner({
            kind: 'info',
            title: n === 2 ? 'Two coordinated interventions restore the required journey.' : `${n} intervention${n === 1 ? '' : 's'} restore${n === 1 ? 's' : ''} the required journey.`,
            body: `Exact search over ${res.evaluated} candidate sets; no smaller set passes every check.`,
          })
          get().cameraTo({ preset: 'street' })
        } else if (res.status === 'none') {
          banner({ kind: 'regression', title: 'No fix found in the catalog', body: `No set of up to ${res.max_size} catalog interventions makes every check pass.` })
        }
      } catch (e) {
        set({ checkBusy: null, checkError: errMsg(e) })
      }
    },

    /** VERIFY: apply the fix one intervention at a time, then rerun the original checks. */
    applyFix: async () => {
      const s = get()
      const ids = s.fix?.interventions ?? []
      if (!ids.length) return
      set({ checkBusy: 'apply' })
      try {
        for (const id of ids) {
          if (get().applied.includes(id)) continue
          await get().apply(id, { narrate: false, camera: false })
          await sleep(650)
        }
      } finally {
        set({ checkBusy: null })
      }
      await get().runChecks()
      get().cameraTo({ preset: 'route' })
    },

    /** The engine is real: take one intervention out or put it back, and every check reruns. */
    toggleMitigation: async (id) => {
      const s = get()
      if (s.applied.includes(id)) await s.remove(id)
      else await s.apply(id, { narrate: false, camera: false })
      await get().runChecks()
    },

    resetCheck: async () => {
      set({ draft: [], changes: [], verify: null, fix: null, checkStage: 'baseline', checkBusy: null, checkError: null, applied: [], history: [], highlight: [], banner: null, compare: 'off', selected: null })
      await evaluate({ animate: true })
      get().cameraTo({ preset: 'journey' })
    },

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
      if (s.scenarioId === PREFLIGHT_ID) {
        set({ scene: n, sceneBusy: true })
        try {
          const st = get()
          const p = (st.scenario?.context.verify as { proposals?: ProposalSpec[] } | undefined)?.proposals?.[0]
          if (n === 0) await st.resetCheck()
          else if (n === 1) {
            await st.resetCheck()
            if (p) get().proposeChange(p)
          } else if (n === 2) {
            if (!get().draft.length && p) get().proposeChange(p)
            if (get().applied.length) set({ applied: [], history: [] })
            set({ fix: null, highlight: [] })
            await get().runChecks()
            get().cameraTo({ preset: 'journey' })
          } else if (n === 3) {
            if (!get().changes.length) {
              if (p && !get().draft.length) get().proposeChange(p)
              await get().runChecks()
            }
            await get().findFix()
          } else if (n === 4) {
            if (!get().changes.length) {
              if (p && !get().draft.length) get().proposeChange(p)
              await get().runChecks()
            }
            if (!get().fix) await get().findFix()
            await get().applyFix()
          } else if (n === 5) {
            if (get().checkStage !== 'fixed') {
              if (!get().changes.length) {
                if (p && !get().draft.length) get().proposeChange(p)
                await get().runChecks()
              }
              if (!get().fix) await get().findFix()
              await get().applyFix()
            }
            const last = get().fix?.interventions.at(-1)
            if (last && get().applied.includes(last)) await get().toggleMitigation(last)
          }
        } finally {
          set({ sceneBusy: false, scene: n })
        }
        return
      }
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
