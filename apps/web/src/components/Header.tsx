import { BookOpen, ChevronDown, CircleHelp, MapPin, PanelRight, Presentation, Settings } from 'lucide-react'
import { useState } from 'react'
import { EXPLORER_ID, GUIDED_ID, useApp } from '../state/store'
import { Segmented } from './ui'

export function Logo() {
  return (
    <svg width="24" height="24" viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="#22342d" />
      <path d="M7 22 L13.5 15.5" stroke="#5fc49f" strokeWidth="3" strokeLinecap="round" />
      <path d="M18.5 15.5 L25 9" stroke="#5fc49f" strokeWidth="3" strokeLinecap="round" />
      <path d="M13.5 15.5 L18.5 15.5" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" strokeDasharray="0.1 4.6" />
      <circle cx="13.5" cy="15.5" r="2.4" fill="#ffffff" />
      <circle cx="18.5" cy="15.5" r="2.4" fill="#ffffff" />
    </svg>
  )
}

function StudyArea() {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-ink hover:bg-wash" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="study-area">
        <MapPin size={14} className="text-ink-2" aria-hidden />
        <span className="font-semibold">Charlotte, NC</span>
        <span className="hidden text-ink-2 md:inline">· Elizabeth</span>
        <ChevronDown size={13} className="text-ink-3" aria-hidden />
      </button>
      {open && (
        <div className="absolute left-0 top-9 z-50 w-[300px] rounded-lg border border-line bg-paper p-3 text-[12.5px] shadow-xl" onMouseLeave={() => setOpen(false)}>
          <div className="eyebrow mb-1.5">Study area</div>
          <div className="rounded-md bg-sel-bg px-2.5 py-2">
            <div className="font-semibold text-ink">Elizabeth, Charlotte</div>
            <div className="text-ink-2">Around Novant Health Presbyterian Medical Center · about 1.3 × 1.1 km of modeled network; 3D context includes the eastern edge of Uptown.</div>
          </div>
          <p className="mt-2 text-[11.5px] leading-snug text-ink-2">
            Other areas can be prepared with the ingestion scripts (any bounding box); only Elizabeth is prepared in this build.
          </p>
        </div>
      )}
    </div>
  )
}

/** Guided scenario vs. Charlotte Data Explorer (header on desktop, planning sheet below lg). */
export function DataModeSwitch({ testId = 'data-mode' }: { testId?: string }) {
  const scenarioId = useApp((s) => s.scenarioId)
  const health = useApp((s) => s.health)
  const loadScenario = useApp((s) => s.loadScenario)
  const explorer = scenarioId !== GUIDED_ID
  const municipalAvailable = health?.scenarios.some((s) => s.id === EXPLORER_ID && s.available) ?? true
  return (
    <Segmented
      size="sm"
      label="Data mode"
      value={explorer ? 'explorer' : 'guided'}
      testId={testId}
      onChange={(v) => {
        if (v === 'guided' && explorer) void loadScenario(GUIDED_ID)
        if (v === 'explorer' && !explorer && municipalAvailable) void loadScenario(EXPLORER_ID)
      }}
      options={[
        { value: 'guided', label: 'Guided scenario', title: 'Hypothetical barriers on real Charlotte streets' },
        { value: 'explorer', label: 'Data explorer', title: 'Real CDOT municipal records' },
      ]}
    />
  )
}

export function Header() {
  const explorer = useApp((s) => s.scenarioId !== GUIDED_ID)
  const mapMode = useApp((s) => s.mapMode)
  const panelOpen = useApp((s) => s.panelOpen)
  const presenting = useApp((s) => s.presenting)
  const { setMapMode, setDialog, setPanelOpen, startPresentation, stopPresentation } = useApp.getState()
  return (
    <header className="relative z-30 flex h-[52px] shrink-0 items-center gap-2 whitespace-nowrap border-b border-line bg-paper px-3 sm:gap-3 sm:px-4">
      <div className="flex items-center gap-2.5">
        <Logo />
        <div className="leading-none max-sm:sr-only">
          <h1 className="text-[14px] font-bold tracking-[0.16em] text-ink">STREETMEND</h1>
          <div className="mt-0.5 text-[10.5px] font-medium tracking-[0.02em] text-ink-2">Infrastructure Intelligence</div>
        </div>
      </div>
      <div className="mx-1 hidden h-6 w-px bg-line md:block" />
      <StudyArea />
      <div className="flex-1" />
      <div className="hidden lg:block">
        <DataModeSwitch />
      </div>
      <Segmented
        size="sm"
        label="Map view"
        value={mapMode}
        testId="map-mode"
        onChange={setMapMode}
        options={[
          { value: '2d', label: '2D', title: 'Precision map view' },
          { value: '3d', label: '3D', title: '3D city view' },
        ]}
      />
      {!explorer && (
        <button className={`btn-ghost hidden md:inline-flex ${presenting ? 'text-sel-ink' : ''}`} onClick={() => (presenting ? stopPresentation() : startPresentation())} data-testid="present">
          <Presentation size={15} aria-hidden /> <span className="hidden xl:inline">{presenting ? 'Exit presentation' : 'Present'}</span>
        </button>
      )}
      <button className="btn-ghost" onClick={() => setDialog('methods')} data-testid="open-methodology" title="Sources and methodology">
        <BookOpen size={15} aria-hidden /> <span className="hidden xl:inline">Sources &amp; methods</span>
      </button>
      <button className="btn-ghost px-1.5" onClick={() => setDialog('help')} aria-label="Help" title="Help" data-testid="open-help">
        <CircleHelp size={16} aria-hidden />
      </button>
      <button className="btn-ghost px-1.5" onClick={() => setDialog('settings')} aria-label="Settings" title="Settings" data-testid="open-settings">
        <Settings size={16} aria-hidden />
      </button>
      <button className="btn-ghost px-1.5 lg:hidden" onClick={() => setPanelOpen(!panelOpen)} aria-label="Toggle planning panel" aria-expanded={panelOpen}>
        <PanelRight size={17} aria-hidden />
      </button>
    </header>
  )
}
