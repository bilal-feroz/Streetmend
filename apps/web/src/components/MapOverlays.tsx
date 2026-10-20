import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, CircleCheck, CircleX, Layers, Maximize, Route, Sparkles, X } from 'lucide-react'
import { useState } from 'react'
import { fmtM, fmtNum } from '../lib/format'
import { useApp, type Layers as LayerState } from '../state/store'
import { RECORD_CATS } from './MunicipalPanel'

export function JourneyCard() {
  const sc = useApp((s) => s.scenario)
  const journey = useApp((s) => s.journey)
  const compare = useApp((s) => s.compare)
  const ev = useApp((s) => (s.compare === 'before' ? s.initialEval : s.evaluation))
  const { setJourney, focusOn, replay } = useApp.getState()
  if (!sc || !journey) return null
  const r = ev?.journey?.route
  const found = !!r?.found
  const blockers = ev?.journey?.potential_blockers ?? []
  return (
    <div className="pointer-events-auto w-[min(420px,calc(100vw-24px))] rounded-lg border border-ink-500 bg-ink-850/95 p-3 shadow-2xl shadow-black/50 backdrop-blur" data-testid="journey-card">
      <div className="flex items-center justify-between">
        <span className="label-xs">Selected journey {compare === 'before' && <span className="ml-1 text-unk">· before repairs</span>}</span>
        <div className="flex gap-0.5">
          <button className="btn-ghost px-1.5 py-1" onClick={() => replay()} title="Replay route animation" aria-label="Replay route animation">
            <Route size={13} />
          </button>
          <button className="btn-ghost px-1.5 py-1" onClick={() => focusOn({ kind: 'route' })} title="Zoom to journey" aria-label="Zoom to journey">
            <Maximize size={13} />
          </button>
        </div>
      </div>
      <div className="mt-1.5 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <select
          aria-label="Journey origin"
          value={journey.origin}
          onChange={(e) => setJourney(e.target.value, journey.destination)}
          className="min-w-0 truncate rounded-md border border-ink-500 bg-ink-800 px-2 py-1 text-[12.5px] text-fg"
          data-testid="origin-select"
        >
          {sc.origins.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <ArrowRight size={14} className="text-fg-3" aria-hidden />
        <select
          aria-label="Journey destination"
          value={journey.destination}
          onChange={(e) => setJourney(journey.origin, e.target.value)}
          className="min-w-0 truncate rounded-md border border-ink-500 bg-ink-800 px-2 py-1 text-[12.5px] text-fg"
          data-testid="destination-select"
        >
          {sc.destinations.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
      </div>
      <div className={`mt-2 flex items-start gap-2 rounded-md px-2.5 py-2 ${found ? 'bg-ok-dim/70' : 'bg-bad-dim/70'}`} data-testid="journey-status" aria-live="polite">
        {found ? <CircleCheck size={16} className="mt-px shrink-0 text-ok" /> : <CircleX size={16} className="mt-px shrink-0 text-bad" />}
        <div className="min-w-0 text-[12.5px] leading-snug">
          {found ? (
            <>
              <span className="font-semibold text-ok">Connected</span>
              <span className="text-fg-2"> · {fmtM(r?.length_m)} modeled traversable route · {r?.edge_ids.length} edges</span>
            </>
          ) : (
            <>
              <span className="font-semibold text-bad">Unavailable</span>
              <span className="text-fg-2">
                {' '}
                ·{' '}
                {blockers.length === 2
                  ? `Two inaccessible connections (${blockers.join(', ')}) prevent this modeled journey.`
                  : blockers.length === 1
                    ? `One inaccessible connection (${blockers[0]}) still prevents this modeled journey.`
                    : blockers.length > 2
                      ? `${blockers.length} inaccessible connections (${blockers.join(', ')}) prevent this modeled journey.`
                      : r?.reason || 'No traversable route in the modeled network.'}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export function Banner() {
  const banner = useApp((s) => s.banner)
  const dismiss = useApp((s) => s.dismissBanner)
  return (
    <AnimatePresence>
      {banner && (
        <motion.div
          key={banner.nonce}
          initial={{ opacity: 0, y: -12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          className={`pointer-events-auto relative max-w-[560px] rounded-lg border px-4 py-3 shadow-2xl shadow-black/60 backdrop-blur ${
            banner.kind === 'reconnected' ? 'border-ok/50 bg-ink-850/95' : 'border-ink-500 bg-ink-850/95'
          }`}
          role="status"
          data-testid="banner"
        >
          <button className="absolute right-1.5 top-1.5 rounded p-1 text-fg-3 hover:text-fg" onClick={dismiss} aria-label="Dismiss">
            <X size={13} />
          </button>
          <div className={`flex items-center gap-2 pr-5 ${banner.kind === 'reconnected' ? 'text-[15px] font-bold tracking-[0.06em] text-ok' : 'text-[13.5px] font-semibold text-fg'}`}>
            {banner.kind === 'reconnected' && <Sparkles size={16} aria-hidden />}
            <span data-testid="banner-title">{banner.title}</span>
          </div>
          {banner.body && <p className="mt-1 text-[12.5px] leading-snug text-fg-2">{banner.body}</p>}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

const LEGEND = [
  { key: 'trav', label: 'Traversable (modeled)', sw: <span className="h-[3px] w-5 rounded bg-[#3a4767]" /> },
  { key: 'reach', label: 'Reachable from origin', sw: <span className="h-[3px] w-5 rounded bg-ok/60" /> },
  { key: 'route', label: 'Shortest traversable route', sw: <span className="h-1 w-5 rounded bg-[#6ee7b7] shadow-[0_0_6px_#34d399]" /> },
  { key: 'pot', label: 'Route if barriers repaired', sw: <span className="w-5 border-t-2 border-dotted border-[#c7d2fe]/70" /> },
  { key: 'blocked', label: 'Blocked', sw: <span className="w-5 border-t-[3px] border-dashed border-bad" /> },
  { key: 'unk', label: 'Unknown (excluded)', sw: <span className="w-5 border-t-[3px] border-dotted border-unk" /> },
  { key: 'cand', label: 'Repair candidate', sw: <span className="grid h-3.5 w-3.5 place-items-center rounded-full border-2 border-bad bg-bad-dim text-[7px] font-bold text-bad">A</span> },
  { key: 'rep', label: 'Repaired (simulated)', sw: <span className="h-3.5 w-3.5 rounded-full bg-ok" /> },
]

export function Legend() {
  const [open, setOpen] = useState(true)
  const municipal = useApp((s) => s.scenario?.mode === 'municipal')
  const showRecords = useApp((s) => s.layers.records)
  return (
    <div className="pointer-events-auto rounded-lg border border-ink-600 bg-ink-850/90 shadow-xl backdrop-blur">
      <button className="flex w-full items-center justify-between gap-6 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-3" aria-expanded={open} onClick={() => setOpen(!open)}>
        Legend <span className="text-fg-4">{open ? '–' : '+'}</span>
      </button>
      {open && (
        <ul className="space-y-1 px-2.5 pb-2">
          {LEGEND.map((l) => (
            <li key={l.key} className="flex items-center gap-2 text-[11.5px] text-fg-2">
              <span className="flex w-5 justify-center">{l.sw}</span>
              {l.label}
            </li>
          ))}
          {municipal && showRecords &&
            Object.values(RECORD_CATS).map((c) => (
              <li key={c.label} className="flex items-center gap-2 text-[11.5px] text-fg-2">
                <span className="flex w-5 justify-center">
                  <span className="h-2.5 w-2.5 rounded-full border border-ink-900" style={{ background: c.color }} />
                </span>
                Record: {c.label}
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}

const LAYER_LABELS: Record<keyof LayerState, string> = {
  records: 'CDOT ramp records',
  inventory: 'CDOT sidewalk inventory',
  network: 'Pedestrian network',
  wave: 'Reach & route',
  candidates: 'Repair candidates',
  places: 'Origins & destinations',
  context: 'Blocks & buildings',
  labels: 'Street names',
}

export function LayersControl() {
  const municipal = useApp((s) => s.scenario?.mode === 'municipal')
  const layers = useApp((s) => s.layers)
  const toggle = useApp((s) => s.toggleLayer)
  const focusOn = useApp((s) => s.focusOn)
  const [open, setOpen] = useState(false)
  return (
    <div className="pointer-events-auto relative">
      <div className="flex gap-1">
        <button className="grid h-[29px] w-[29px] place-items-center rounded-md border border-ink-500 bg-ink-850/95 text-fg-2 hover:text-fg" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Map layers" data-testid="layers">
          <Layers size={15} />
        </button>
        <button className="grid h-[29px] w-[29px] place-items-center rounded-md border border-ink-500 bg-ink-850/95 text-fg-2 hover:text-fg" onClick={() => focusOn({ kind: 'bounds' })} aria-label="Reset camera" title="Reset camera">
          <Maximize size={14} />
        </button>
      </div>
      {open && (
        <div className="absolute right-0 top-9 w-52 rounded-lg border border-ink-500 bg-ink-850/95 p-2 shadow-2xl backdrop-blur">
          {(Object.keys(LAYER_LABELS) as (keyof LayerState)[]).filter((k) => municipal ? k !== 'context' && k !== 'labels' : k !== 'records' && k !== 'inventory').map((k) => (
            <label key={k} className="flex cursor-pointer items-center justify-between rounded px-1.5 py-1 text-[12.5px] text-fg-2 hover:bg-ink-700">
              {LAYER_LABELS[k]}
              <input type="checkbox" checked={layers[k]} onChange={() => toggle(k)} className="accent-sel" />
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

export function BottomStrip() {
  const sc = useApp((s) => s.scenario)
  const analysis = useApp((s) => s.analysis)
  const analyzing = useApp((s) => s.analyzing)
  const evaluating = useApp((s) => s.evaluating)
  const applied = useApp((s) => s.applied)
  const compare = useApp((s) => s.compare)
  const ev = useApp((s) => s.evaluation)
  const init = useApp((s) => s.initialEval)
  const { setCompare, undo, replay } = useApp.getState()
  if (!sc) return null
  const search = analyzing
    ? 'searching…'
    : analysis
      ? `${fmtNum(analysis.recommendation.evaluations)} combos ${analysis.recommendation.exact ? 'exact' : 'approx.'} · ${analysis.recommendation.runtime_ms.toFixed(1)} ms`
      : 'search not run'
  const improved = ev && init && ev.metrics.score > init.metrics.score
  return (
    <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-ink-600 bg-ink-850/95 px-3 py-2 shadow-2xl backdrop-blur" data-testid="bottom-strip">
      <div className="hidden min-w-0 flex-col 2xl:flex" aria-label="Processing state">
        <span className="label-xs !text-[9.5px]">Graph · search</span>
        <span className="truncate font-mono text-[11.5px] tnum text-fg-2">
          {fmtNum(sc.node_count)}n · {fmtNum(sc.edge_count)}e · {sc.candidate_count} candidates · <span className={analysis ? 'text-fg-2' : 'text-fg-4'}>{search}</span>
        </span>
      </div>
      <div className="flex min-w-0 flex-col max-sm:hidden 2xl:hidden" aria-label="Search state">
        <span className="label-xs !text-[9.5px]">Search</span>
        <span className={`truncate font-mono text-[11.5px] tnum ${analysis ? 'text-fg-2' : 'text-fg-4'}`}>{search}</span>
      </div>
      <div className="h-7 w-px bg-ink-600 max-sm:hidden" />
      <div className="flex min-w-0 flex-col">
        <span className="label-xs !text-[9.5px]">Applied</span>
        <span className="flex items-center gap-1">
          {applied.length ? (
            applied.map((id) => (
              <span key={id} className="rounded-full bg-ok px-1.5 font-mono text-[11px] font-bold leading-[16px] text-ink-900">
                {id}
              </span>
            ))
          ) : (
            <span className="text-[11.5px] leading-[16px] text-fg-4">none</span>
          )}
          {evaluating && <span className="ml-1 h-1.5 w-1.5 animate-pulse rounded-full bg-sel" aria-label="Recomputing" />}
        </span>
      </div>
      <div className="flex flex-col">
        <span className="label-xs !text-[9.5px]">Objective</span>
        <span className="font-mono text-[12.5px] font-semibold leading-[16px] tnum text-fg" data-testid="objective-now">
          {fmtNum(init?.metrics.score, 1)} → <span className={improved ? 'text-ok' : ''}>{fmtNum(ev?.metrics.score, 1)}</span>
        </span>
      </div>
      <div className="flex-1" />
      <div role="radiogroup" aria-label="Before or after repairs" className="flex shrink-0 rounded-md border border-ink-600 bg-ink-900 p-0.5">
        {(['before', 'current'] as const).map((c) => (
          <button
            key={c}
            role="radio"
            aria-checked={compare === c}
            onClick={() => setCompare(c)}
            className={`rounded px-2 py-0.5 text-[11.5px] font-medium ${compare === c ? 'bg-ink-600 text-fg' : 'text-fg-3 hover:text-fg'}`}
            data-testid={`compare-${c}`}
          >
            {c === 'before' ? 'Before' : 'After'}
          </button>
        ))}
      </div>
      <button className="btn-ghost shrink-0 px-2 py-1 text-[12px]" onClick={() => void undo()} disabled={!applied.length} data-testid="undo">
        Undo
      </button>
      <button className="btn-ghost shrink-0 px-2 py-1 text-[12px] max-sm:hidden" onClick={() => replay()}>
        Replay
      </button>
    </div>
  )
}
