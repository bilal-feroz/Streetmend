import { AnimatePresence, motion } from 'motion/react'
import { LoaderCircle, TriangleAlert, X } from 'lucide-react'
import { useEffect } from 'react'
import { Dialogs } from './components/dialogs/Dialogs'
import { DataModeSwitch, Header } from './components/Header'
import { Inspector } from './components/map/Inspector'
import { Banner, Legend, MapToolbar, PresentationBar, ScenarioBadge } from './components/map/MapChrome'
import { AccessPanel } from './components/panel/AccessPanel'
import { ChangeCheckPanel } from './components/panel/ChangeCheck'
import { ExplorerPanel, GuidedPanel } from './components/panel/Panels'
import { MapView } from './map/MapView'
import { useMediaQuery } from './lib/useMediaQuery'
import { useAccess } from './state/access'
import { EXPLORER_ID, GUIDED_ID, PREFLIGHT_ID, useApp } from './state/store'

const EASE = [0.22, 1, 0.36, 1] as const

function SelectedBuilding() {
  const selected = useApp((s) => s.selected)
  if (selected?.type !== 'building') return <Inspector />
  const idx = window.__sm?.layer.index
  const i = Number(selected.id)
  const p = idx?.props[i]
  return <Inspector buildings={p ? { name: p.name, b: p.b, h: p.h, hs: p.hs, id: idx!.ids[i] } : null} />
}

export default function App() {
  const init = useApp((s) => s.init)
  const loading = useApp((s) => s.loading)
  const error = useApp((s) => s.error)
  const scenarioId = useApp((s) => s.scenarioId)
  const panelOpen = useApp((s) => s.panelOpen)
  const setPanelOpen = useApp((s) => s.setPanelOpen)
  const ready = useApp((s) => s.intro.phase === 'done')
  const presenting = useApp((s) => s.presenting)
  // the panel mounts once: floating over the map from lg up, as a bottom sheet below
  const wide = useMediaQuery('(min-width: 1024px)')
  const phone = useMediaQuery('(max-width: 639px)') // the inspector mounts once: left column, or bottom card on phones
  const guided = scenarioId === GUIDED_ID
  const access = useAccess((s) => s.on) && scenarioId === EXPLORER_ID

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useApp.getState().select(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const panel = scenarioId === PREFLIGHT_ID ? <ChangeCheckPanel /> : guided ? <GuidedPanel /> : access ? <AccessPanel /> : <ExplorerPanel />
  return (
    <div className="flex h-full flex-col bg-canvas">
      <a href="#planning" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-ink focus:px-3 focus:py-1 focus:text-white">
        Skip to planning panel
      </a>
      {/* --inset: the width the floating panel takes from the map; chrome is placed against the visible map.
          The header floats over the city too: the map runs edge to edge. */}
      <main className="relative min-h-0 flex-1 [--inset:0px] lg:[--inset:calc(clamp(340px,25vw,430px)+28px)]">
        <MapView />
        <motion.div className="absolute inset-x-3 top-3 z-30" initial={false} animate={{ opacity: ready ? 1 : 0, y: ready ? 0 : -10 }} transition={{ duration: 0.5, ease: EASE }}>
          <Header />
        </motion.div>
        <motion.div className="pointer-events-none absolute inset-0 z-10" initial={false} animate={{ opacity: ready ? 1 : 0 }} transition={{ duration: 0.5, delay: ready ? 0.25 : 0 }}>
          <div className="absolute top-[84px] bottom-24 left-4 flex w-[min(440px,calc(100%-var(--inset)-96px))] flex-col items-start gap-2.5 max-sm:w-[calc(100%-32px)]">
            <ScenarioBadge />
            <Banner />
            {!phone && (
              <div className="flex min-h-0 flex-1 flex-col">
                <SelectedBuilding />
              </div>
            )}
          </div>
          <div className="absolute top-[84px] right-[calc(var(--inset)+16px)] max-sm:top-auto max-sm:right-auto max-sm:bottom-16 max-sm:left-4">
            <MapToolbar />
          </div>
          {!presenting && (
            <div className="absolute bottom-[68px] left-4 max-md:hidden">
              <Legend />
            </div>
          )}
          <div className="absolute bottom-10 left-[calc((100%-var(--inset))/2)] -translate-x-1/2 max-lg:bottom-20">
            <PresentationBar />
          </div>
          {phone && (
            <div className="absolute inset-x-4 bottom-16">
              <SelectedBuilding />
            </div>
          )}
        </motion.div>
        {loading && ready && (
          <div className="absolute inset-0 z-20 grid place-items-center bg-canvas/60">
            <div className="flex items-center gap-2 text-sm text-ink-2">
              <LoaderCircle size={16} className="animate-spin" /> Loading network…
            </div>
          </div>
        )}
        {error && (
          <div className="absolute left-1/2 top-16 z-30 flex max-w-md -translate-x-1/2 items-start gap-2 rounded-xl border border-bad/40 bg-paper px-3 py-2 text-[13px] text-bad-ink shadow-xl" role="alert">
            <TriangleAlert size={15} className="mt-0.5 shrink-0" /> {error}
          </div>
        )}
        {wide && (
          <motion.aside
            id="planning"
            data-floating-panel
            aria-label="Planning workspace"
            className="absolute top-[84px] right-3 bottom-3 z-20 w-[clamp(340px,25vw,430px)] overflow-hidden rounded-2xl border border-black/[0.06] bg-paper shadow-[0_1px_2px_rgba(25,44,40,0.06),0_24px_48px_-24px_rgba(25,44,40,0.35)]"
            initial={false}
            animate={{ opacity: ready ? 1 : 0, x: ready ? 0 : 32 }}
            transition={{ duration: 0.65, delay: ready ? 0.1 : 0, ease: EASE }}
          >
            {panel}
          </motion.aside>
        )}
        <AnimatePresence>
          {!wide && panelOpen && (
            <motion.aside
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'tween', duration: 0.3, ease: EASE }}
              id="planning"
              className="absolute inset-x-0 bottom-0 z-40 h-[82%] rounded-t-2xl border-t border-line bg-paper shadow-2xl"
              aria-label="Planning workspace"
            >
              <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
                <DataModeSwitch testId="data-mode-sheet" />
                <button className="rounded p-1.5 text-ink-3" onClick={() => setPanelOpen(false)} aria-label="Close planning panel">
                  <X size={16} />
                </button>
              </div>
              <div className="h-[calc(100%-49px)]">{panel}</div>
            </motion.aside>
          )}
        </AnimatePresence>
        {!wide && !panelOpen && ready && (
          <button className="btn-primary absolute bottom-4 left-1/2 z-30 -translate-x-1/2 shadow-lg" onClick={() => setPanelOpen(true)} data-testid="open-panel">
            Open the case
          </button>
        )}
      </main>
      <Dialogs />
    </div>
  )
}
