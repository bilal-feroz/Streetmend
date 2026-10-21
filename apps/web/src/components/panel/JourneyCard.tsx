import { CircleCheck, CircleHelp, CircleSlash, Pencil, RotateCcw, Undo2 } from 'lucide-react'
import { useState } from 'react'
import type { EvaluateResponse, ScenarioOut } from '../../api/types'
import { GUIDED_ID, useApp } from '../../state/store'
import { StoryStrip } from './StoryStrip'

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

const clean = (label: string) => label.replace(/ \(\d+ bldg\)$/, '')

/** The destination in plain words ("the hospital"), from its category and name. */
function destNoun(d: { label: string; category?: string } | undefined) {
  if (!d) return 'the destination'
  if (d.category === 'healthcare') return /hospital|medical center/i.test(d.label) ? 'the hospital' : 'the clinic'
  if (d.category === 'transit') return 'the bus stop'
  if (d.category === 'education') return 'school'
  return 'the destination'
}

/** The case headline: who is affected and what they cannot reach, from engine state only. */
function caseTitle(sc: ScenarioOut, ev: EvaluateResponse | null, wasBroken: boolean, applied: string[], who: string, where: string) {
  const j = ev?.journey
  if (!j) return 'Choose a journey.'
  const plural = /^Homes\b/i.test(who)
  if (j.route.found) return wasBroken ? `${who} can reach ${where} again.` : `${who} can reach ${where}.`
  const left = [...new Set(j.potential_blockers)]
  const crossingOf = (id: string) => sc.interventions.find((i) => i.id === id)?.attrs?.crossing
  if (left.length === 1 && crossingOf(left[0]) && applied.some((a) => crossingOf(a) === crossingOf(left[0]))) return `One end fixed. ${who} ${plural ? 'are' : 'is'} still cut off.`
  if (left.length) return `${who} ${plural ? 'are' : 'is'} cut off from ${where}.`
  return `No modeled route to ${where} yet.`
}


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
  const j = ev?.journey
  const len = j ? (j.route.found ? j.route.length_m : j.potential_route?.length_m) : null
  const who = o ? clean(o.label) : 'This origin'
  return (
    <section aria-labelledby="case-h" className={`px-6 ${compact ? 'pt-5 pb-4' : 'pt-6 pb-5'}`} data-testid="journey-card">
      <div data-testid="journey-status" aria-live="polite">
        <div className="flex items-center justify-between gap-2">
          <div className="eyebrow truncate">{guided ? 'Case 01' : 'Charlotte records'}</div>
          <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-[3px] text-[10.5px] font-bold tracking-[0.08em] uppercase ${tone}`}>
            <Icon size={12} strokeWidth={2.6} aria-hidden />
            {st.label}
          </span>
        </div>
        <h2 id="case-h" className={`display mt-2.5 text-balance text-ink transition-[font-size] duration-300 ${compact ? 'text-[23px]' : 'text-[clamp(25px,2.05vw,30px)]'}`}>
          {caseTitle(sc, ev, !(initial?.journey?.route.found ?? true), applied, who, destNoun(d))}
        </h2>
        <p className={`mt-2 leading-relaxed text-ink-2 ${compact ? 'text-[12.5px]' : 'text-[13.5px]'}`}>{st.text}</p>
      </div>

      {!compact && (
        <ol className="relative mt-4 rounded-xl bg-wash px-3.5 py-3 pr-11" aria-label="Selected journey">
          <li className="absolute top-2 right-2">
            <button className="grid h-7 w-7 place-items-center rounded-lg text-ink-2 hover:bg-paper hover:text-ink" onClick={() => setEditing(!editing)} aria-expanded={editing} aria-label="Change journey" title="Change journey" data-testid="change-journey">
              <Pencil size={13} aria-hidden />
            </button>
          </li>
          <li className="flex items-center gap-3">
            <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] bg-ink" aria-hidden>
              <span className="h-1.5 w-1.5 rounded-full bg-white" />
            </span>
            <div className="min-w-0 truncate text-[13.5px] font-semibold text-ink">
              <span className="sr-only">From </span>
              {who}
            </div>
          </li>
          <li className="flex items-center gap-3" aria-hidden>
            <span className="ml-[8.5px] h-5 w-px border-l border-dashed border-ink/35" />
            {len != null && <span className="ml-[3px] text-[11px] font-semibold text-ink-3 tnum">{Math.round(len)} m on foot · step-free</span>}
          </li>
          <li className="flex items-center gap-3">
            <span className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] ${st.tone === 'ok' ? 'bg-ok' : 'bg-bad'}`} aria-hidden>
              <span className="h-1.5 w-1.5 rounded-full bg-white" />
            </span>
            <div className="min-w-0 text-[13.5px] leading-snug font-semibold text-ink">
              <span className="sr-only">To </span>
              {d?.label ?? '—'}
            </div>
          </li>
        </ol>
      )}

      <StoryStrip />

      {(applied.length > 0 || compact) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1">
          {compact && (
            <button className="btn-ghost -ml-2 px-2 py-1 text-[12.5px]" onClick={() => setEditing(!editing)} aria-expanded={editing} data-testid="change-journey">
              <Pencil size={12.5} aria-hidden /> Change journey
            </button>
          )}
          {applied.length > 0 && (
            <>
              <button className={`btn-ghost px-2 py-1 text-[12.5px] ${compact ? '' : '-ml-2'}`} onClick={() => void undo()} disabled={!canUndo} data-testid="undo">
                <Undo2 size={12.5} aria-hidden /> Undo
              </button>
              <button className="btn-ghost px-2 py-1 text-[12.5px]" onClick={() => void reset()} data-testid="reset">
                <RotateCcw size={12.5} aria-hidden /> Start over
              </button>
            </>
          )}
        </div>
      )}
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
