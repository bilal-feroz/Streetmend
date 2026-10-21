// Access workspace: Discover -> Diagnose -> Fix or build -> Verify, on the real Elizabeth records.
import { create } from 'zustand'
import { accessApi, type AccessAnalysis, type AccessCategory, type AccessOverviewRow, type AccessProfile, type CompareResponse, type Diagnosis } from '../api/access'
import { EXPLORER_ID, useApp } from './store'

export type AccessStage = 'discover' | 'diagnose' | 'intervene' | 'verify'
export type AccessShow = 'none' | 'fix' | 'build'

interface AccessState {
  on: boolean
  category: AccessCategory
  profile: AccessProfile
  data: AccessAnalysis | null
  overview: AccessOverviewRow[] | null
  loading: boolean
  error: string | null
  cell: string | null
  diagnosis: Diagnosis | null
  diagnosing: boolean
  budget: number
  compare: CompareResponse | null
  comparing: boolean
  /** which option the map shows applied (both are already re-verified by the engine) */
  show: AccessShow
  open: () => Promise<void>
  close: () => void
  setCategory: (c: AccessCategory) => Promise<void>
  setProfile: (p: AccessProfile) => Promise<void>
  selectCell: (id: string | null, opts?: { camera?: boolean }) => Promise<void>
  setBudget: (b: number) => Promise<void>
  runCompare: () => Promise<void>
  setShow: (s: AccessShow) => void
  goTo: (s: AccessStage) => void
}

export const stageOf = (s: Pick<AccessState, 'cell' | 'compare' | 'show'>): AccessStage =>
  s.show !== 'none' ? 'verify' : s.compare ? 'intervene' : s.cell ? 'diagnose' : 'discover'

const msg = (e: unknown) => (e as Error).message
const mid = (g: number[][]) => g[Math.floor(g.length / 2)] as [number, number]
const near = (p: [number, number], q: [number, number], km: number) => Math.hypot((p[0] - q[0]) * 91, (p[1] - q[1]) * 111) <= km
let seq = 0

export const useAccess = create<AccessState>((set, get) => {
  const load = async () => {
    const { category, profile } = get()
    const n = ++seq
    set({ loading: true, error: null })
    try {
      const [data, ov] = await Promise.all([accessApi.category(category, profile), get().overview ? null : accessApi.overview(profile)])
      if (n !== seq) return
      set({ data, loading: false, ...(ov ? { overview: ov.categories } : {}) })
    } catch (e) {
      if (n === seq) set({ loading: false, error: msg(e) })
    }
  }
  /** Camera on the evidence for the current stage, computed from engine output only. */
  const frame = () => {
    const { data, cell, diagnosis, compare, show } = get()
    const c = data?.cells.find((x) => x.id === cell)
    if (!c) return
    const pts: [number, number][] = [...c.boundary]
    const edges = new Map((useApp.getState().scenario?.edges ?? []).map((e) => [e.id, e.geometry as number[][]]))
    if (show === 'fix' && compare?.fix.status === 'found') pts.push(...compare.fix.repairs.map((r) => [r.lon, r.lat] as [number, number]))
    else if (show === 'build' && compare?.build.site) pts.push([compare.build.site.lon, compare.build.site.lat])
    else if (diagnosis) {
      const r = diagnosis.representative
      for (const b of r.barriers.slice(0, 3)) {
        const g = edges.get(b.id)
        if (g && near(mid(g), [c.lon, c.lat], 1.2)) pts.push(mid(g))
      }
      const f = data?.facilities.find((x) => x.id === r.nearest_facility?.id)
      if (f && near([f.lon, f.lat], [c.lon, c.lat], 1.0)) pts.push([f.lon, f.lat])
    }
    useApp.getState().cameraTo({ preset: 'fit', points: pts })
  }
  return {
    on: false,
    category: 'education',
    profile: 'step_free',
    data: null,
    overview: null,
    loading: false,
    error: null,
    cell: null,
    diagnosis: null,
    diagnosing: false,
    budget: 2,
    compare: null,
    comparing: false,
    show: 'none',

    open: async () => {
      set({ on: true })
      const app = useApp.getState()
      if (app.scenarioId !== EXPLORER_ID) await app.loadScenario(EXPLORER_ID)
      if (!get().data) await load()
      useApp.getState().cameraTo({ preset: 'overview' })
    },
    close: () => set({ on: false, show: 'none' }),
    setCategory: async (c) => {
      if (c === get().category) return
      set({ category: c, cell: null, diagnosis: null, compare: null, show: 'none' })
      useApp.getState().cameraTo({ preset: 'overview' })
      await load()
    },
    setProfile: async (p) => {
      if (p === get().profile) return
      const cell = get().cell
      set({ profile: p, overview: null, compare: null, show: 'none' })
      await load()
      if (cell) await get().selectCell(cell, { camera: false })
    },
    selectCell: async (id, opts) => {
      set({ cell: id, diagnosis: null, compare: null, show: 'none' })
      if (!id) {
        useApp.getState().cameraTo({ preset: 'overview' })
        return
      }
      const { category, profile } = get()
      const n = ++seq
      set({ diagnosing: true, error: null })
      try {
        const d = await accessApi.diagnose(category, id, profile)
        if (n !== seq) return
        set({ diagnosis: d, diagnosing: false })
        if (opts?.camera !== false) frame()
      } catch (e) {
        if (n === seq) set({ diagnosing: false, error: msg(e) })
      }
    },
    setBudget: async (b) => {
      set({ budget: b })
      if (get().compare) await get().runCompare()
    },
    runCompare: async () => {
      const { cell, category, profile, budget } = get()
      if (!cell) return
      const n = ++seq
      set({ comparing: true, error: null, show: 'none' })
      try {
        const r = await accessApi.compare({ category, cells: [cell], profile, budget })
        if (n === seq) set({ compare: r, comparing: false })
      } catch (e) {
        if (n === seq) set({ comparing: false, error: msg(e) })
      }
    },
    setShow: (s) => {
      set({ show: s })
      frame()
    },
    goTo: (s) => {
      if (s === 'discover') void get().selectCell(null)
      else if (s === 'diagnose') set({ compare: null, show: 'none' })
      else if (s === 'intervene') set({ show: 'none' })
    },
  }
})
