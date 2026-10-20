import { AnimatePresence, motion } from 'motion/react'
import { LoaderCircle, TriangleAlert, X } from 'lucide-react'
import { useEffect } from 'react'
import { Dialogs } from './components/dialogs/Dialogs'
import { DataModeSwitch, Header } from './components/Header'
import { Inspector } from './components/map/Inspector'
import { Banner, CameraToolbar, Legend, PresentationBar, ScenarioBadge } from './components/map/MapChrome'
import { ExplorerPanel, GuidedPanel } from './components/panel/Panels'
import { MapView } from './map/MapView'
import { useMediaQuery } from './lib/useMediaQuery'
import { GUIDED_ID, useApp } from './state/store'

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
  const presenting = useApp((s) => s.presenting)
  // the panel mounts once: docked beside the map from lg up, as a bottom sheet below
  const wide = useMediaQuery('(min-width: 1024px)')
  const guided = scenarioId === GUIDED_ID

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

  const panel = guided ? <GuidedPanel /> : <ExplorerPanel />
  return (
    <div className="flex h-full flex-col bg-canvas">
      <a href="#planning" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-sel focus:px-3 focus:py-1 focus:text-white">
        Skip to planning panel
      </a>
      <Header />
      <main className="relative flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <MapView />
          <div className="pointer-events-none absolute inset-0 z-10">
            {/* data status first, narration directly beneath it: they never collide */}
            <div className="absolute left-3 top-3 flex w-[min(520px,calc(100%-224px))] flex-col items-start gap-2 max-sm:w-[calc(100%-24px)]">
              <ScenarioBadge />
              <Banner />
            </div>
            {/* phones: camera tools move to the lower left, clear of the narration */}
            <div className="absolute right-3 top-3 max-sm:top-auto max-sm:right-auto max-sm:left-3 max-sm:bottom-14">
              <CameraToolbar />
            </div>
            <div className="absolute bottom-9 left-3 max-md:hidden">
              <Legend />
            </div>
            {/* sits above the attribution line, which stays readable */}
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 max-lg:bottom-16">
              <PresentationBar />
            </div>
            {/* details dock under the camera toolbar, leaving the bottom to the presentation bar */}
            <div className={`absolute right-3 top-[150px] flex flex-col max-sm:inset-x-3 max-sm:top-auto max-sm:bottom-16 ${presenting ? 'bottom-[164px]' : 'bottom-[120px]'}`}>
              <SelectedBuilding />
            </div>
          </div>
          {loading && (
            <div className="absolute inset-0 z-20 grid place-items-center bg-canvas/60">
              <div className="flex items-center gap-2 text-sm text-ink-2">
                <LoaderCircle size={16} className="animate-spin" /> Loading network…
              </div>
            </div>
          )}
          {error && (
            <div className="absolute left-1/2 top-16 z-30 flex max-w-md -translate-x-1/2 items-start gap-2 rounded-lg border border-bad/40 bg-paper px-3 py-2 text-[13px] text-bad-ink shadow-xl" role="alert">
              <TriangleAlert size={15} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}
        </div>
        {wide && (
          <aside id="planning" aria-label="Planning workspace" className="relative z-20 w-[clamp(360px,26vw,480px)] shrink-0 border-l border-line bg-paper">
            {panel}
          </aside>
        )}
        <AnimatePresence>
          {!wide && panelOpen && (
            <motion.aside initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'tween', duration: 0.25 }}
              id="planning" className="absolute inset-x-0 bottom-0 z-40 h-[80%] rounded-t-xl border-t border-line bg-paper shadow-2xl" aria-label="Planning workspace">
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
        {!wide && !panelOpen && (
          <button className="btn-primary absolute bottom-3 left-1/2 z-30 -translate-x-1/2 shadow-lg" onClick={() => setPanelOpen(true)} data-testid="open-panel">
            Open planning panel
          </button>
        )}
      </main>
      <Dialogs />
    </div>
  )
}
