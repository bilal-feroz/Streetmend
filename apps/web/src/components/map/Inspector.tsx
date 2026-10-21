import { Crosshair, MapPin, Undo2, Wrench, X } from 'lucide-react'
import type { EffectiveState } from '../../api/types'
import { useApp } from '../../state/store'
import { crossingName } from '../panel/JourneyCard'
import { StateBadge } from '../ui'
import { CrossingView3D } from './CrossingView3D'

const EVIDENCE: Record<string, string> = {
  synthetic: 'Hypothetical scenario setting',
  municipal_record: 'Municipal record (CDOT)',
  municipal_historical: 'Historical CDOT survey',
  osm: 'OpenStreetMap',
  inferred: 'Inferred by StreetMend geometry',
  assumed: 'Modeling assumption',
}
const KIND: Record<string, string> = { sidewalk: 'Sidewalk segment', crossing: 'Pedestrian crossing', ramp: 'Curb-ramp connection', entrance: 'Access connector' }
const HEIGHT_SOURCE: Record<string, string> = { height: 'OSM height tag', levels: 'OSM building levels × 3.2 m', estimate: 'Estimated from building type (visual only)' }

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-0.5 text-[12px]">
      <span className="text-ink-2">{k}</span>
      <span className="text-right text-ink">{v}</span>
    </div>
  )
}

/** Docked inspector for the selected map feature (does not cover the map centre). */
export function Inspector({ buildings }: { buildings?: { name: string | null; b: string; h: number; hs: string; id: string } | null }) {
  const selected = useApp((s) => s.selected)
  const sc = useApp((s) => s.scenario)
  const applied = useApp((s) => s.applied)
  const evaluation = useApp((s) => s.evaluation)
  const analysis = useApp((s) => s.analysis)
  const journey = useApp((s) => s.journey)
  const st = useApp.getState()
  if (!selected || !sc || selected.type === 'record') return null
  const close = (
    <button className="rounded p-1 text-ink-3 hover:bg-wash hover:text-ink" onClick={() => st.select(null)} aria-label="Close details">
      <X size={14} />
    </button>
  )
  let body: React.ReactNode = null

  if (selected.type === 'intervention') {
    const iv = sc.interventions.find((i) => i.id === selected.id)
    if (!iv) return null
    const on = applied.includes(iv.id)
    const hypo = !!iv.attrs?.hypothetical
    const pairId = (iv.attrs?.pair as string | undefined) ?? null
    const pair = pairId ? sc.interventions.find((i) => i.id === pairId) : null
    const crossingId = iv.attrs?.crossing as string | undefined
    const xLabel = crossingId ? sc.edges.find((e) => e.id === crossingId)?.label : null
    const contrib = analysis?.contributions.find((c) => c.id === iv.id)
    const near = pair && iv.label.includes('far side') ? pair : iv
    const far = pair && near === iv ? pair : iv
    const rec = (iv.attrs?.record ?? null) as Record<string, unknown> | null
    body = (
      <>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="eyebrow">Repair {iv.id.length <= 2 ? iv.id : ''} · {hypo ? 'hypothetical barrier' : 'recorded barrier'}</div>
            <div className="mt-0.5 text-[13.5px] leading-snug font-semibold text-ink">{iv.label}</div>
          </div>
          {close}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <StateBadge state={on ? 'repaired' : 'repairable'} label={on ? 'Repaired in simulation' : 'Blocked'} />
          {analysis?.recommendation.selected.includes(iv.id) && <span className="rounded bg-sel-bg px-1.5 py-0.5 text-[11.5px] font-medium text-sel-ink">Recommended</span>}
        </div>
        <p className="mt-1.5 text-[12px] leading-snug text-ink-2">{iv.description}</p>
        {(pair || xLabel) && (
          <div className="mt-2">
            <CrossingView3D nearId={near.id} farId={far.id} nearOk={applied.includes(near.id)} farOk={applied.includes(far.id)} street={xLabel ? crossingName(xLabel).replace(/^the /, '') : 'the street'} />
          </div>
        )}
        <div className="mt-2 border-t border-line pt-1.5">
          {pair && <Row k="Paired with" v={`${pair.id} (other end of the crossing)`} />}
          {contrib && <Row k="Gain alone / within set" v={<span className="tnum">+{contrib.alone_gain} / +{contrib.marginal_in_set}</span>} />}
          {rec && <Row k="CDOT record" v={<span className="font-mono">{String(rec.OBJECTID)}</span>} />}
          {rec && <Row k="Survey date" v={String((iv.attrs?.survey_date as string) ?? 'missing')} />}
          <Row k="Evidence" v={EVIDENCE[iv.evidence] ?? iv.evidence} />
        </div>
        <div className="sticky bottom-0 mt-2.5 flex gap-2 bg-paper pt-1 shadow-[0_12px_0_0_var(--color-paper)]">
          {on ? (
            <button className="btn-secondary flex-1" onClick={() => void st.remove(iv.id)} data-testid="inspector-remove">
              <Undo2 size={14} /> Remove repair
            </button>
          ) : (
            <button className="btn-primary flex-1" onClick={() => void st.apply(iv.id)} data-testid="inspector-apply">
              <Wrench size={14} /> Apply repair
            </button>
          )}
          <button className="btn-secondary px-2.5" onClick={() => st.cameraTo({ preset: 'intervention', id: iv.id })} aria-label="Focus camera on this repair">
            <Crosshair size={14} />
          </button>
        </div>
      </>
    )
  } else if (selected.type === 'place') {
    const o = sc.origins.find((x) => x.id === selected.id)
    const d = sc.destinations.find((x) => x.id === selected.id)
    const label = o?.label ?? d?.label ?? selected.id
    body = (
      <>
        <div className="flex items-start justify-between">
          <div>
            <div className="eyebrow">{o ? 'Origin · residential' : `Destination · ${d?.category}`}</div>
            <div className="mt-0.5 text-[13.5px] font-semibold text-ink">{label}</div>
          </div>
          {close}
        </div>
        <div className="mt-1.5 border-t border-line pt-1.5">
          {o && <Row k="Weight" v={`${o.weight} (${o.weight_basis.split(' (')[0]})`} />}
          {d && <Row k="Source" v={EVIDENCE[d.evidence] ?? d.evidence} />}
          {d && d.source_ids.length > 0 && <Row k="Identifier" v={<span className="font-mono text-[11px]">{d.source_ids[0]}</span>} />}
          {o && evaluation && <Row k="Reachable now" v={`${evaluation.per_origin.find((p) => p.origin === o.id)?.reachable.length ?? 0} of ${sc.destinations.length} destinations`} />}
        </div>
        <div className="sticky bottom-0 mt-2.5 flex gap-2 bg-paper pt-1 shadow-[0_12px_0_0_var(--color-paper)]">
          {o && (
            <button className="btn-secondary flex-1" disabled={journey?.origin === o.id} onClick={() => journey && st.setJourney(o.id, journey.destination)}>
              <MapPin size={14} /> {journey?.origin === o.id ? 'Journey origin' : 'Set as origin'}
            </button>
          )}
          {d && (
            <button className="btn-secondary flex-1" disabled={journey?.destination === d.id} onClick={() => journey && st.setJourney(journey.origin, d.id)}>
              <MapPin size={14} /> {journey?.destination === d.id ? 'Journey destination' : 'Set as destination'}
            </button>
          )}
        </div>
      </>
    )
  } else if (selected.type === 'edge') {
    const e = sc.edges.find((x) => x.id === selected.id)
    if (!e) return null
    const state = (evaluation?.edge_states[e.id] ?? e.state) as EffectiveState
    const owner = sc.interventions.find((i) => i.edge_ids.includes(e.id))
    body = (
      <>
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <div className="eyebrow">{KIND[e.kind] ?? e.kind}</div>
            <div className="mt-0.5 text-[13.5px] leading-snug font-semibold text-ink">{e.label || e.id}</div>
          </div>
          {close}
        </div>
        <p className="mt-1 text-[12px] leading-snug text-ink-2">{e.reason}</p>
        <div className="mt-1.5 border-t border-line pt-1.5">
          <Row k="State" v={<StateBadge state={state} />} />
          <Row k="Length" v={<span className="tnum">{Math.round(e.length_m)} m</span>} />
          <Row k="Evidence" v={EVIDENCE[e.evidence] ?? e.evidence} />
          {e.source_ids.filter(Boolean).length > 0 && <Row k="Source IDs" v={<span className="font-mono text-[11px]">{e.source_ids.filter(Boolean).slice(0, 2).join(', ')}</span>} />}
        </div>
        {owner && (
          <button className="btn-secondary mt-2.5 w-full" onClick={() => st.select({ type: 'intervention', id: owner.id })}>
            Inspect repair {owner.id}
          </button>
        )}
        {st.scenarioId === 'preflight' && e.kind !== 'entrance' && state !== 'blocked' && !st.draft.some((c) => c.edge_id === e.id) && (
          // Change Studio: any sidewalk or crossing can be proposed for closure, then tested
          <button
            className="btn-primary mt-2.5 w-full rounded-lg py-2 text-[13px]"
            onClick={() => {
              const what = e.kind === 'crossing' ? 'crossing' : e.kind === 'ramp' ? 'curb ramp' : 'sidewalk'
              st.proposeChange({ id: `U-${e.id}`, op: 'close', edge_id: e.id, label: `Temporary closure of this ${what}${e.label ? `: ${e.label}` : ''}`, reason: 'Proposed (hypothetical): closed for construction.' })
              st.select(null)
            }}
            data-testid="propose-closure"
          >
            Propose closure
          </button>
        )}
      </>
    )
  } else if (selected.type === 'building' && buildings) {
    body = (
      <>
        <div className="flex items-start justify-between">
          <div>
            <div className="eyebrow">Building · OpenStreetMap</div>
            <div className="mt-0.5 text-[13.5px] font-semibold text-ink">{buildings.name ?? `Unnamed (${buildings.b})`}</div>
          </div>
          {close}
        </div>
        <div className="mt-1.5 border-t border-line pt-1.5">
          <Row k="Type" v={buildings.b} />
          <Row k="Height" v={<span className="tnum">{Math.round(buildings.h)} m</span>} />
          <Row k="Height source" v={HEIGHT_SOURCE[buildings.hs] ?? buildings.hs} />
          <Row k="OSM id" v={<span className="font-mono text-[11px]">{buildings.id}</span>} />
        </div>
        <p className="mt-1.5 text-[10.5px] leading-snug text-ink-3">Real footprint; simplified massing. Buildings are visual context and do not enter the graph.</p>
      </>
    )
  } else return null

  return (
    <div className="pointer-events-auto max-h-full w-[340px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border border-line bg-paper p-3 shadow-[0_8px_30px_rgba(30,50,40,0.18)]" role="dialog" aria-label="Details" data-testid="inspector">
      {body}
    </div>
  )
}
