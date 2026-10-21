import { BookOpen, ChevronDown, CircleHelp, Ellipsis, MapPin, PanelRight, Play, Presentation, RotateCcw, Settings } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useAccess } from '../state/access'
import { EXPLORER_ID, GUIDED_ID, PREFLIGHT_ID, useApp } from '../state/store'
import { Segmented } from './ui'

/** The mark: two sidewalks joined across a street by a repaired crossing
 * (white curbs, emerald crossing with its two ramp nodes). */
export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="9" fill="#192c28" />
      <path d="M10.5 6.5 V25.5 M21.5 6.5 V25.5" stroke="#ffffff" strokeOpacity="0.38" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M4.5 16 H10.5 M21.5 16 H27.5" stroke="#ffffff" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M10.5 16 H21.5" stroke="#2fc497" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="10.5" cy="16" r="2.7" fill="#2fc497" stroke="#192c28" strokeWidth="1.4" />
      <circle cx="21.5" cy="16" r="2.7" fill="#2fc497" stroke="#192c28" strokeWidth="1.4" />
    </svg>
  )
}

export function Wordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <Logo />
      <h1 className="text-[13.5px] font-extrabold tracking-[0.2em] text-ink max-sm:sr-only">STREETMEND</h1>
    </div>
  )
}

function StudyArea() {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] text-ink hover:bg-wash" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="study-area">
        <MapPin size={14} className="text-ok" aria-hidden />
        <span className="font-semibold">Charlotte, NC</span>
        <span className="hidden text-ink-2 md:inline">Elizabeth</span>
        <ChevronDown size={13} className="text-ink-3" aria-hidden />
      </button>
      {open && (
        <div className="surface absolute left-0 top-9 z-50 w-[300px] p-3 text-[12.5px]" onMouseLeave={() => setOpen(false)}>
          <div className="eyebrow mb-1.5">Study area</div>
          <div className="font-semibold text-ink">Elizabeth, Charlotte</div>
          <p className="mt-0.5 leading-snug text-ink-2">Around Novant Health Presbyterian Medical Center: about 1.3 × 1.1 km of modeled network. The 3D context extends to the eastern edge of Uptown.</p>
          <p className="mt-2 text-[11.5px] leading-snug text-ink-2">Other areas can be prepared with the ingestion scripts; only Elizabeth is prepared in this build.</p>
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
  const accessOn = useAccess((s) => s.on)
  const mode = scenarioId === PREFLIGHT_ID ? 'check' : scenarioId === GUIDED_ID ? 'guided' : accessOn ? 'access' : 'explorer'
  const municipalAvailable = health?.scenarios.some((s) => s.id === EXPLORER_ID && s.available) ?? true
  return (
    <Segmented
      size="sm"
      label="Data mode"
      value={mode}
      testId={testId}
      onChange={(v) => {
        if (v === mode) return
        if (v === 'access') {
          if (municipalAvailable) void useAccess.getState().open()
          return
        }
        useAccess.getState().close()
        if (v === 'check') void loadScenario(PREFLIGHT_ID)
        if (v === 'guided') void loadScenario(GUIDED_ID)
        if (v === 'explorer' && municipalAvailable) {
          if (scenarioId !== EXPLORER_ID) void loadScenario(EXPLORER_ID)
          else useApp.getState().cameraTo({ preset: 'overview' })
        }
      }}
      options={[
        { value: 'check', label: 'Change check', title: 'Test a proposed street change before it is made' },
        { value: 'access', label: 'Access gaps', title: 'Where access to essential services fails, why, and whether to fix the network or build (real records)' },
        { value: 'guided', label: 'Repair planner', title: 'Find the repairs that reconnect the most journeys (hypothetical barriers on real streets)' },
        { value: 'explorer', label: 'Data explorer', title: 'Real CDOT municipal records' },
      ]}
    />
  )
}

/** Secondary actions live here so the header stays quiet. */
function MoreMenu() {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const { setDialog, replayIntro } = useApp.getState()
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', off)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', off)
      window.removeEventListener('keydown', esc)
    }
  }, [open])
  const item = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink hover:bg-wash'
  const go = (f: () => void) => () => {
    setOpen(false)
    f()
  }
  return (
    <div className="relative" ref={box}>
      <button className="btn-ghost px-1.5" onClick={() => setOpen(!open)} aria-label="More" aria-haspopup="menu" aria-expanded={open} data-testid="more-menu">
        <Ellipsis size={18} aria-hidden />
      </button>
      {open && (
        <div role="menu" className="surface absolute right-0 top-10 z-50 w-56 p-1.5">
          <button role="menuitem" className={item} onClick={go(() => setDialog('help'))} data-testid="open-help">
            <CircleHelp size={15} className="text-ink-2" aria-hidden /> How it works
          </button>
          <button role="menuitem" className={item} onClick={go(replayIntro)} data-testid="replay-intro">
            <RotateCcw size={15} className="text-ink-2" aria-hidden /> Replay intro
          </button>
          <button role="menuitem" className={item} onClick={go(() => setDialog('settings'))} data-testid="open-settings">
            <Settings size={15} className="text-ink-2" aria-hidden /> Settings & diagnostics
          </button>
        </div>
      )}
    </div>
  )
}

export function Header() {
  const explorer = useApp((s) => s.scenarioId !== GUIDED_ID && s.scenarioId !== PREFLIGHT_ID)
  const panelOpen = useApp((s) => s.panelOpen)
  const presenting = useApp((s) => s.presenting)
  const { setDialog, setPanelOpen, startPresentation, stopPresentation } = useApp.getState()
  return (
    <header className="surface relative z-30 flex h-[60px] shrink-0 items-center gap-2 rounded-2xl px-3 whitespace-nowrap sm:gap-3 sm:px-4">
      <Wordmark />
      <div className="mx-1 hidden h-5 w-px bg-line-2 md:block" />
      <StudyArea />
      <div className="flex-1" />
      {!presenting && (
        <div className="hidden lg:block">
          <DataModeSwitch />
        </div>
      )}
      {!explorer && (
        <button
          className={`hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-semibold transition-colors md:inline-flex ${presenting ? 'bg-ink text-white hover:bg-[#0f211d]' : 'text-ink hover:bg-wash'}`}
          onClick={() => (presenting ? stopPresentation() : startPresentation())}
          data-testid="present"
        >
          {presenting ? <Presentation size={15} aria-hidden /> : <Play size={14} aria-hidden />}
          <span className="hidden xl:inline">{presenting ? 'Exit presentation' : 'Present'}</span>
        </button>
      )}
      <button className="btn-ghost" onClick={() => setDialog('methods')} data-testid="open-methodology" title="Sources and methodology">
        <BookOpen size={15} aria-hidden /> <span className="hidden xl:inline">Sources</span>
      </button>
      <MoreMenu />
      <button className="btn-ghost px-1.5 max-sm:hidden lg:hidden" onClick={() => setPanelOpen(!panelOpen)} aria-label="Toggle planning panel" aria-expanded={panelOpen}>
        <PanelRight size={17} aria-hidden />
      </button>
    </header>
  )
}
