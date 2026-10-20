import { AnimatePresence, motion } from 'motion/react'
import { LoaderCircle, TriangleAlert, X } from 'lucide-react'
import { useEffect } from 'react'
import { Header } from './components/Header'
import { Banner, BottomStrip, JourneyCard, Legend, LayersControl } from './components/MapOverlays'
import { MethodologyDialog } from './components/MethodologyDialog'
import { MunicipalPanel } from './components/MunicipalPanel'
import { PlanningPanel } from './components/PlanningPanel'
import { MapView } from './map/MapView'
import { useApp } from './state/store'

export default function App() {
  const init = useApp((s) => s.init)
  const loading = useApp((s) => s.loading)
  const error = useApp((s) => s.error)
  const scenario = useApp((s) => s.scenario)
  const panelOpen = useApp((s) => s.panelOpen)
  const setPanelOpen = useApp((s) => s.setPanelOpen)
  const municipal = scenario?.mode === 'municipal'

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

  return (
    <div className="flex h-full flex-col bg-ink-900">
      <a href="#planning" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-sel focus:px-3 focus:py-1">
        Skip to planning panel
      </a>
      <Header />
      <main className="relative flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <MapView />
          <div className="pointer-events-none absolute inset-0 z-10 flex flex-col p-3">
            <div className="flex items-start justify-between gap-3">
              <JourneyCard />
              <div className="flex-1" />
              <div className="mr-[42px] mt-0">
                <LayersControl />
              </div>
            </div>
            <div className="mt-3 flex justify-center">
              <Banner />
            </div>
            <div className="flex-1" />
            <div className="flex items-end justify-between gap-3">
              <div className="hidden md:block"><Legend /></div>
            </div>
            <div className="mt-2 mr-[120px] max-md:mr-0"><BottomStrip /></div>
          </div>
          {loading && (
            <div className="absolute inset-0 z-20 grid place-items-center bg-ink-900/60">
              <div className="flex items-center gap-2 text-sm text-fg-2">
                <LoaderCircle size={16} className="animate-spin" /> Loading network…
              </div>
            </div>
          )}
          {error && (
            <div className="absolute left-1/2 top-16 z-30 flex max-w-md -translate-x-1/2 items-start gap-2 rounded-lg border border-bad/40 bg-ink-850 px-3 py-2 text-[13px] text-bad shadow-xl" role="alert">
              <TriangleAlert size={15} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}
        </div>
        <aside
          id="planning"
          aria-label="Planning workspace"
          className="relative z-20 hidden w-[clamp(380px,32vw,470px)] shrink-0 border-l border-ink-600 bg-ink-850 lg:block"
        >
          {municipal ? <MunicipalPanel /> : <PlanningPanel />}
        </aside>
        <AnimatePresence>
          {panelOpen && (
            <motion.aside
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="absolute inset-x-0 bottom-0 z-40 h-[78%] rounded-t-xl border-t border-ink-500 bg-ink-850 shadow-2xl lg:hidden"
              aria-label="Planning workspace"
            >
              <div className="flex items-center justify-between border-b border-ink-600 px-4 py-2">
                <span className="mx-auto h-1 w-10 rounded-full bg-ink-500" aria-hidden />
                <button className="absolute right-2 top-1.5 rounded p-1.5 text-fg-3" onClick={() => setPanelOpen(false)} aria-label="Close planning panel">
                  <X size={16} />
                </button>
              </div>
              <div className="h-[calc(100%-37px)]">{municipal ? <MunicipalPanel /> : <PlanningPanel />}</div>
            </motion.aside>
          )}
        </AnimatePresence>
        {!panelOpen && (
          <button
            className="btn-primary absolute bottom-[78px] left-1/2 z-30 -translate-x-1/2 shadow-xl lg:hidden"
            onClick={() => setPanelOpen(true)}
            data-testid="open-panel"
          >
            Open planning panel
          </button>
        )}
      </main>
      <MethodologyDialog />
    </div>
  )
}
