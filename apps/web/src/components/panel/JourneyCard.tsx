import { ArrowDown, CircleCheck, CircleHelp, CircleSlash, Route } from 'lucide-react'
import type { EvaluateResponse, ScenarioOut } from '../../api/types'
import { useApp } from '../../state/store'

const fmtM = (m: number | null | undefined) => (m == null ? '—' : `${Math.round(m).toLocaleString('en-US')} m`)

/** "Crossing of E 7th St at E 7th St & Hawthorne Ln" -> "the East 7th Street crossing at Hawthorne Lane". */
export function crossingName(label: string) {
  const m = /^Crossing of (.+?) at (.+)$/.exec(label)
  if (!m) return label
  const others = m[2].split(' & ').filter((x) => x !== m[1])
  return `the ${m[1]} crossing${others.length ? ` at ${others.join(' & ')}` : ''}`
}

/** Plain-language status of the selected journey, built from engine output only. */
export function journeyStatus(sc: ScenarioOut, ev: EvaluateResponse | null) {
  const j = ev?.journey
  if (!j) return { tone: 'unknown' as const, label: 'Not computed', text: 'Select an origin and a destination.' }
  if (j.route.found) {
    return {
      tone: 'ok' as const,
      label: 'Connected',
      text: `A continuous ${fmtM(j.route.length_m)} route exists in the modeled network, within the ${fmtM(ev?.metrics.cutoff_m)} access threshold.`,
    }
  }
  const blockers = [...new Set(j.potential_blockers)]
  const ivs = blockers.map((b) => sc.interventions.find((i) => i.id === b)).filter(Boolean)
  const crossing = ivs.length === 2 && ivs[0]!.attrs?.crossing && ivs[0]!.attrs?.crossing === ivs[1]!.attrs?.crossing ? (ivs[0]!.attrs.crossing as string) : null
  const xLabel = crossing ? sc.edges.find((e) => e.id === crossing)?.label : null
  const hypo = sc.mode === 'hypothetical'
  if (crossing && xLabel) {
    return {
      tone: 'bad' as const,
      label: 'Disconnected',
      text: `Both curb ramps of ${crossingName(xLabel)} are blocked${hypo ? ' (hypothetical barriers)' : ''}. The modeled route stops at the curb: repairing only one end does not help.`,
    }
  }
  if (blockers.length) {
    return {
      tone: 'bad' as const,
      label: 'Disconnected',
      text: `${blockers.length === 1 ? 'One blocked curb-ramp connection' : `${blockers.length} blocked curb-ramp connections`} (${blockers.join(', ')}) ${blockers.length === 1 ? 'prevents' : 'prevent'} this modeled journey.`,
    }
  }
  if (sc.mode === 'municipal') {
    return {
      tone: 'unknown' as const,
      label: 'Not determined',
      text: 'No route uses only links with recorded evidence, and no candidate repair opens one. Links with unknown condition are excluded rather than assumed passable.',
    }
  }
  return { tone: 'bad' as const, label: 'Disconnected', text: j.route.reason || `No traversable route within ${fmtM(ev?.metrics.cutoff_m)}.` }
}

export function JourneyCard() {
  const sc = useApp((s) => s.scenario)
  const journey = useApp((s) => s.journey)
  const ev = useApp((s) => (s.compare === 'before' ? s.initialEval : s.evaluation))
  const { setJourney, cameraTo, replay } = useApp.getState()
  if (!sc || !journey) return null
  const st = journeyStatus(sc, ev)
  const Icon = st.tone === 'ok' ? CircleCheck : st.tone === 'bad' ? CircleSlash : CircleHelp
  const toneCls = st.tone === 'ok' ? 'bg-ok-bg text-ok-ink' : st.tone === 'bad' ? 'bg-bad-bg text-bad-ink' : 'bg-unk-bg text-unk-ink'
  const sel = 'w-full min-w-0 truncate rounded-md border border-line-2 bg-paper px-2 py-1.5 text-[13px] font-medium text-ink'
  return (
    <section aria-labelledby="journey-h" className="px-4 pt-4 pb-3" data-testid="journey-card">
      <div className="flex items-center justify-between">
        <h2 id="journey-h" className="eyebrow">
          Selected journey
        </h2>
        <button className="btn-ghost px-1.5 py-0.5 text-[12px]" onClick={() => { replay(); cameraTo({ preset: 'route' }) }} title="Show the journey on the map">
          <Route size={13} aria-hidden /> Show
        </button>
      </div>
      <div className="mt-2 grid grid-cols-[14px_1fr] items-center gap-x-2 gap-y-1">
        <span className="h-2.5 w-2.5 justify-self-center rounded-full border-2 border-sel bg-paper" aria-hidden />
        <select aria-label="Journey origin" value={journey.origin} onChange={(e) => setJourney(e.target.value, journey.destination)} className={sel} data-testid="origin-select">
          {sc.origins.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <ArrowDown size={12} className="justify-self-center text-ink-3" aria-hidden />
        <span />
        <span className="h-2.5 w-2.5 justify-self-center rounded-sm bg-ink" aria-hidden />
        <select aria-label="Journey destination" value={journey.destination} onChange={(e) => setJourney(journey.origin, e.target.value)} className={sel} data-testid="destination-select">
          {sc.destinations.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-2.5 rounded-lg border border-line p-2.5" data-testid="journey-status" aria-live="polite">
        <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] font-semibold ${toneCls}`}>
          <Icon size={13} strokeWidth={2.4} aria-hidden />
          {st.label}
        </span>
        <p className="mt-1.5 text-[12.5px] leading-snug text-ink-2">{st.text}</p>
      </div>
    </section>
  )
}
