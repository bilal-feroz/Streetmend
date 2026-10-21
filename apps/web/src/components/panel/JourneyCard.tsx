import { CircleCheck, CircleHelp, CircleSlash, Pencil, RotateCcw, Undo2 } from 'lucide-react'
import { useState } from 'react'
import type { EvaluateResponse, ScenarioOut } from '../../api/types'
import { GUIDED_ID, useApp } from '../../state/store'

const fmtM = (m: number | null | undefined) => (m == null ? '—' : `${Math.round(m).toLocaleString('en-US')} m`)

/** "Crossing of E 7th St at E 7th St & Hawthorne Ln" -> "the East 7th Street crossing at Hawthorne Lane". */
export function crossingName(label: string) {
  const m = /^Crossing of (.+?) at (.+)$/.exec(label)
  if (!m) return label
  const others = m[2].split(' & ').filter((x) => x !== m[1])
  return `the ${m[1]} crossing${others.length ? ` at ${others.join(' & ')}` : ''}`
}

function blockedCrossing(sc: ScenarioOut, blockers: string[]) {
  const ivs = blockers.map((b) => sc.interventions.find((i) => i.id === b)).filter(Boolean)
  const x = ivs.length === 2 && ivs[0]!.attrs?.crossing && ivs[0]!.attrs?.crossing === ivs[1]!.attrs?.crossing ? (ivs[0]!.attrs.crossing as string) : null
  return x ? (sc.edges.find((e) => e.id === x)?.label ?? null) : null
}

/** Plain-language status of the selected journey, built from engine output only. */
export function journeyStatus(sc: ScenarioOut, ev: EvaluateResponse | null) {
  const j = ev?.journey
  if (!j) return { tone: 'unknown' as const, label: 'Not computed', text: 'Select an origin and a destination.' }
  if (j.route.found) {
    return { tone: 'ok' as const, label: 'Connected in model', text: `A continuous ${fmtM(j.route.length_m)} route, within the ${fmtM(ev?.metrics.cutoff_m)} access threshold.` }
  }
  const blockers = [...new Set(j.potential_blockers)]
  const xLabel = blockedCrossing(sc, blockers)
  const hypo = sc.mode === 'hypothetical'
  if (xLabel) {
    return {
      tone: 'bad' as const,
      label: 'Disconnected in model',
      text: `Both curb ramps of ${crossingName(xLabel)} are ${hypo ? 'blocked in this scenario' : 'recorded barriers'}. Fixing only one end is not enough.`,
    }
  }
  if (blockers.length) {
    return {
      tone: 'bad' as const,
      label: 'Disconnected in model',
      text: `${blockers.length === 1 ? 'One blocked connection' : `${blockers.length} blocked connections`} (${blockers.join(', ')}) still ${blockers.length === 1 ? 'breaks' : 'break'} this journey.`,
    }
  }
  if (sc.mode === 'municipal') {
    return {
      tone: 'unknown' as const,
      label: 'Not determined',
      text: 'No route uses only links with recorded evidence, and no candidate repair opens one. Unknown links are excluded, not assumed passable.',
    }
  }
  return { tone: 'bad' as const, label: 'Disconnected in model', text: j.route.reason || `No traversable route within ${fmtM(ev?.metrics.cutoff_m)}.` }
}

/** The case headline: what is at stake, in one line, from engine state. */
function caseTitle(sc: ScenarioOut, ev: EvaluateResponse | null, wasBroken: boolean, applied: string[]) {
  const j = ev?.journey
  if (!j) return 'Choose a journey.'
  const len = j.route.found ? j.route.length_m : j.potential_route?.length_m
  const short = len != null && len <= (ev?.metrics.cutoff_m ?? 800) ? 'A short journey' : 'A journey'
  if (j.route.found) return wasBroken ? `${short}, reconnected.` : `${short}, connected.`
  if (blockedCrossing(sc, [...new Set(j.potential_blockers)])) return `${short}. An incomplete crossing.`
  const left = [...new Set(j.potential_blockers)]
  const crossingOf = (id: string) => sc.interventions.find((i) => i.id === id)?.attrs?.crossing
  if (left.length === 1 && crossingOf(left[0]) && applied.some((a) => crossingOf(a) === crossingOf(left[0]))) return `${short}. One end still blocked.`
  if (left.length) return `${short}. A broken link.`
  return 'No modeled route yet.'
}

const clean = (label: string) => label.replace(/ \(\d+ bldg\)$/, '')

export function JourneyCard() {
  const sc = useApp((s) => s.scenario)
  const journey = useApp((s) => s.journey)
  const ev = useApp((s) => (s.compare === 'before' ? s.initialEval : s.evaluation))
  const initial = useApp((s) => s.initialEval)
  const applied = useApp((s) => s.applied)
  const canUndo = useApp((s) => s.history.length > 0)
  const guided = useApp((s) => s.scenarioId === GUIDED_ID)
  // once a recommendation is on screen the case condenses and the answer leads
  const compact = useApp((s) => s.panelView === 'results' && !!s.analysis)
  const { setJourney, undo, reset } = useApp.getState()
  const [editing, setEditing] = useState(false)
  if (!sc || !journey) return null
  const st = journeyStatus(sc, ev)
  const places = [...sc.origins, ...sc.destinations]
  const o = places.find((p) => p.id === journey.origin)
  const d = places.find((p) => p.id === journey.destination)
  const Icon = st.tone === 'ok' ? CircleCheck : st.tone === 'bad' ? CircleSlash : CircleHelp
  const tone = st.tone === 'ok' ? 'text-ok-ink bg-ok-bg' : st.tone === 'bad' ? 'text-bad-ink bg-bad-bg' : 'text-unk-ink bg-unk-bg'
  const sel = 'w-full min-w-0 truncate rounded-lg border border-line-2 bg-paper px-2.5 py-2 text-[13px] font-medium text-ink'
  return (
    <section aria-labelledby="case-h" className={`px-6 ${compact ? 'pt-5 pb-4' : 'pt-6 pb-5'}`} data-testid="journey-card">
      <div className="eyebrow">{guided ? 'Case 01 · Modeled scenario' : 'Charlotte records · Elizabeth'}</div>
      <h2 id="case-h" className={`display mt-2 text-ink transition-[font-size] duration-300 ${compact ? 'text-[22px]' : 'text-[32px]'}`}>
        {caseTitle(sc, ev, !(initial?.journey?.route.found ?? true), applied)}
      </h2>

      {compact ? (
        <p className="mt-2 text-[13px] leading-snug font-semibold text-ink">
          {o ? clean(o.label) : '—'} <span className="font-normal text-ink-3">→</span> {d?.label ?? '—'}
        </p>
      ) : (
      <ol className="mt-4 space-y-0" aria-label="Selected journey">
        <li className="flex items-start gap-3">
          <span className="mt-1 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] bg-ink" aria-hidden>
            <span className="h-1.5 w-1.5 rounded-full bg-white" />
          </span>
          <div className="min-w-0">
            <div className="text-[11px] font-semibold text-ink-3">From</div>
            <div className="text-[14.5px] leading-snug font-semibold text-ink">{o ? clean(o.label) : '—'}</div>
          </div>
        </li>
        <li className="ml-[8.5px] h-4 w-px border-l border-dashed border-ink/35" aria-hidden />
        <li className="flex items-start gap-3">
          <span className={`mt-1 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] ${st.tone === 'ok' ? 'bg-ok' : 'bg-bad'}`} aria-hidden>
            <span className="h-1.5 w-1.5 rounded-full bg-white" />
          </span>
          <div className="min-w-0">
            <div className="text-[11px] font-semibold text-ink-3">To</div>
            <div className="text-[14.5px] leading-snug font-semibold text-ink">{d?.label ?? '—'}</div>
          </div>
        </li>
      </ol>
      )}

      <div className={compact ? 'mt-2.5' : 'mt-4'} data-testid="journey-status" aria-live="polite">
        <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] font-bold tracking-[0.08em] uppercase ${tone}`}>
          <Icon size={13} strokeWidth={2.6} aria-hidden />
          {st.label}
        </span>
        <p className={`mt-2 leading-relaxed text-ink-2 ${compact ? 'text-[12.5px]' : 'text-[13.5px]'}`}>{st.text}</p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-1">
        <button className="btn-ghost -ml-2 px-2 py-1 text-[12.5px]" onClick={() => setEditing(!editing)} aria-expanded={editing} data-testid="change-journey">
          <Pencil size={12.5} aria-hidden /> Change journey
        </button>
        {applied.length > 0 && (
          <>
            <span className="text-[12px] text-ink-3" aria-hidden>·</span>
            <button className="btn-ghost px-2 py-1 text-[12.5px]" onClick={() => void undo()} disabled={!canUndo} data-testid="undo">
              <Undo2 size={12.5} aria-hidden /> Undo
            </button>
            <button className="btn-ghost px-2 py-1 text-[12.5px]" onClick={() => void reset()} data-testid="reset">
              <RotateCcw size={12.5} aria-hidden /> Start over
            </button>
          </>
        )}
      </div>
      {editing && (
        <div className="mt-2 space-y-2 rounded-xl bg-wash p-3">
          <label className="block text-[11.5px] font-semibold text-ink-2">
            From
            <select aria-label="Journey origin" value={journey.origin} onChange={(e) => setJourney(e.target.value, journey.destination)} className={`${sel} mt-1`} data-testid="origin-select">
              {sc.origins.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-[11.5px] font-semibold text-ink-2">
            To
            <select aria-label="Journey destination" value={journey.destination} onChange={(e) => setJourney(journey.origin, e.target.value)} className={`${sel} mt-1`} data-testid="destination-select">
              {sc.destinations.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </section>
  )
}
