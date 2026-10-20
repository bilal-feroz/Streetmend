import { BookOpen, Database, FlaskConical, PanelRight, RotateCcw } from 'lucide-react'
import { useApp } from '../state/store'

export function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="7" fill="#121a2d" />
      <path d="M6 22 L13 15" stroke="#34d399" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M19 15 L26 8" stroke="#34d399" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M13 15 L19 15" stroke="#5b8cff" strokeWidth="3.2" strokeLinecap="round" strokeDasharray="0.1 5.2" />
      <circle cx="13" cy="15" r="2.6" fill="#e8ecf4" />
      <circle cx="19" cy="15" r="2.6" fill="#e8ecf4" />
    </svg>
  )
}

export function Header() {
  const health = useApp((s) => s.health)
  const scenarioId = useApp((s) => s.scenarioId)
  const scenario = useApp((s) => s.scenario)
  const applied = useApp((s) => s.applied)
  const panelOpen = useApp((s) => s.panelOpen)
  const { loadScenario, reset, setMethodology, setPanelOpen } = useApp.getState()
  const scenarios = health?.scenarios ?? [{ id: 'demo', name: 'Guided Simulation', mode: 'synthetic', available: true } as never]
  const municipal = scenarios.find((s) => s.mode === 'municipal')
  const synthetic = scenario?.mode !== 'municipal'

  return (
    <header className="relative z-30 flex h-12 shrink-0 items-center gap-3 border-b border-ink-600 bg-ink-850 px-3 sm:px-4">
      <div className="flex items-center gap-2">
        <Logo />
        <span className="text-[14px] font-bold tracking-[0.18em] text-fg">STREETMEND</span>
        <span className="hidden text-[12px] text-fg-3 xl:inline">Fix the missing links. Reconnect the city.</span>
      </div>
      <div className="mx-1 hidden h-5 w-px bg-ink-600 md:block" />
      <div role="tablist" aria-label="Operating mode" className="flex rounded-md border border-ink-600 bg-ink-900 p-0.5">
        <button
          role="tab"
          aria-selected={scenarioId === 'demo'}
          onClick={() => scenarioId !== 'demo' && void loadScenario('demo')}
          className={`flex items-center gap-1.5 rounded-[5px] px-2.5 py-1 text-[12.5px] font-medium ${scenarioId === 'demo' ? 'bg-ink-600 text-fg' : 'text-fg-3 hover:text-fg'}`}
          data-testid="mode-demo"
        >
          <FlaskConical size={13} aria-hidden />
          <span className="hidden sm:inline">Guided Simulation</span>
          <span className="sm:hidden">Demo</span>
        </button>
        <button
          role="tab"
          aria-selected={scenarioId !== 'demo'}
          disabled={!municipal}
          title={municipal && !municipal.available ? municipal.unavailable_reason ?? '' : 'Real Charlotte, NC municipal records'}
          onClick={() => municipal && scenarioId !== municipal.id && void loadScenario(municipal.id)}
          className={`flex items-center gap-1.5 rounded-[5px] px-2.5 py-1 text-[12.5px] font-medium disabled:opacity-40 ${scenarioId !== 'demo' ? 'bg-ink-600 text-fg' : 'text-fg-3 hover:text-fg'}`}
          data-testid="mode-municipal"
        >
          <Database size={13} aria-hidden />
          <span className="hidden sm:inline">Charlotte Data Explorer</span>
          <span className="sm:hidden">Charlotte</span>
        </button>
      </div>
      <span
        className={`hidden items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium lg:flex ${synthetic ? 'border-unk/30 bg-unk-dim/60 text-unk' : 'border-sel/30 bg-sel-dim text-sel-2'}`}
        data-testid="data-status"
      >
        <span className={`h-1.5 w-1.5 rounded-full ${synthetic ? 'bg-unk' : 'bg-sel-2'}`} />
        {synthetic ? 'Synthetic scenario · not a real place' : 'Municipal records · CDOT + OSM'}
      </span>
      <div className="flex-1" />
      <span className="hidden items-center gap-1.5 text-[11px] text-fg-3 md:flex" aria-live="polite">
        <span className={`h-1.5 w-1.5 rounded-full ${health ? 'bg-ok' : 'bg-bad'}`} />
        {health ? `Engine v${health.version}` : 'API offline'}
      </span>
      <button className="btn-ghost" onClick={() => void reset()} disabled={!applied.length} data-testid="reset" title="Reset all simulated repairs">
        <RotateCcw size={14} /> <span className="hidden sm:inline">Reset</span>
      </button>
      <button className="btn-ghost" onClick={() => setMethodology(true)} data-testid="open-methodology" title="Data & methodology">
        <BookOpen size={14} /> <span className="hidden sm:inline">Methodology</span>
      </button>
      <button className="btn-ghost lg:hidden" onClick={() => setPanelOpen(!panelOpen)} aria-label="Toggle planning panel" aria-expanded={panelOpen}>
        <PanelRight size={16} />
      </button>
    </header>
  )
}
