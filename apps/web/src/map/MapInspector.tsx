import type { Map as MLMap } from 'maplibre-gl'
import { Crosshair, MapPin, Undo2, Wrench, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { EffectiveState } from '../api/types'
import { CATEGORY_LABEL, EVIDENCE_LABEL, fmtM, fmtNum, KIND_LABEL, STATE_LABEL } from '../lib/format'
import { useApp } from '../state/store'
import { StateBadge } from '../components/ui'

/** A small card anchored to the selected map feature. */
export function MapInspector({ map }: { map: MLMap }) {
  const selected = useApp((s) => s.selected)
  const scenario = useApp((s) => s.scenario)
  const [pt, setPt] = useState<{ x: number; y: number } | null>(null)

  const anchor = (() => {
    if (!selected || !scenario) return null
    if (selected.type === 'intervention') {
      const iv = scenario.interventions.find((i) => i.id === selected.id)
      return iv ? ([iv.lon, iv.lat] as [number, number]) : null
    }
    if (selected.type === 'place') {
      const p = [...scenario.origins, ...scenario.destinations].find((x) => x.id === selected.id)
      return p ? ([p.lon, p.lat] as [number, number]) : null
    }
    const e = scenario.edges.find((x) => x.id === selected.id)
    return e ? e.geometry[Math.floor(e.geometry.length / 2)] : null
  })()

  useEffect(() => {
    if (!anchor) {
      setPt(null)
      return
    }
    const upd = () => {
      const p = map.project(anchor)
      setPt({ x: p.x, y: p.y })
    }
    upd()
    map.on('move', upd)
    return () => {
      map.off('move', upd)
    }
  }, [map, anchor?.[0], anchor?.[1]]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!selected || !pt || !scenario) return null
  const W = 300
  const cont = map.getContainer()
  const left = Math.min(Math.max(8, pt.x + 18), cont.clientWidth - W - 8)
  const top = Math.min(Math.max(8, pt.y - 40), cont.clientHeight - 240)
  return (
    <div
      className="absolute z-20 rounded-lg border border-ink-500 bg-ink-850/95 shadow-2xl shadow-black/60 backdrop-blur"
      style={{ left, top, width: W }}
      role="dialog"
      aria-label="Feature details"
      onClick={(e) => e.stopPropagation()}
    >
      <InspectorBody />
    </div>
  )
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-0.5 text-xs">
      <span className="text-fg-3">{k}</span>
      <span className="text-right text-fg-2">{v}</span>
    </div>
  )
}

function InspectorBody() {
  const selected = useApp((s) => s.selected)!
  const scenario = useApp((s) => s.scenario)!
  const evaluation = useApp((s) => s.evaluation)
  const applied = useApp((s) => s.applied)
  const analysis = useApp((s) => s.analysis)
  const journey = useApp((s) => s.journey)
  const { apply, remove, select, setJourney, focusOn } = useApp.getState()

  const close = (
    <button className="rounded p-1 text-fg-3 hover:bg-ink-700 hover:text-fg" onClick={() => select(null)} aria-label="Close details">
      <X size={14} />
    </button>
  )

  if (selected.type === 'intervention') {
    const iv = scenario.interventions.find((i) => i.id === selected.id)!
    const isApplied = applied.includes(iv.id)
    const contrib = analysis?.contributions.find((c) => c.id === iv.id)
    const state: EffectiveState = isApplied ? 'repaired' : 'repairable'
    const srcRec = iv.attrs?.record as Record<string, unknown> | undefined
    return (
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="grid h-6 min-w-6 place-items-center rounded-full border border-bad/70 bg-bad-dim px-1 font-mono text-[11px] font-bold text-bad">{iv.id}</span>
            <span className="text-[11px] uppercase tracking-wider text-fg-3">Candidate repair</span>
          </div>
          {close}
        </div>
        <div className="mt-2 text-sm font-semibold leading-snug text-fg">{iv.label}</div>
        <p className="mt-1 text-xs leading-relaxed text-fg-2">{iv.description}</p>
        <div className="mt-2 border-t border-ink-600 pt-2">
          <Row k="Status" v={<StateBadge state={state} />} />
          <Row k="Evidence" v={EVIDENCE_LABEL[iv.evidence] ?? iv.evidence} />
          {iv.source_ids.length > 0 && <Row k="Source record" v={<span className="font-mono">{iv.source_ids.join(', ')}</span>} />}
          {srcRec && 'survey_date' in srcRec && <Row k="Survey date" v={String(srcRec.survey_date ?? '—')} />}
          {contrib && (
            <>
              <Row k="Gain on its own" v={<span className="font-mono tnum">{fmtNum(contrib.alone_gain, 1)}</span>} />
              <Row k="Marginal within set" v={<span className="font-mono tnum">{fmtNum(contrib.marginal_in_set, 1)}</span>} />
            </>
          )}
        </div>
        <div className="mt-3 flex gap-2">
          {isApplied ? (
            <button className="btn-secondary flex-1" onClick={() => void remove(iv.id)} data-testid="inspector-remove">
              <Undo2 size={14} /> Remove repair
            </button>
          ) : (
            <button className="btn-primary flex-1" onClick={() => void apply(iv.id)} data-testid="inspector-apply">
              <Wrench size={14} /> Apply repair
            </button>
          )}
          <button className="btn-ghost" onClick={() => focusOn({ kind: 'intervention', id: iv.id })} aria-label="Zoom to repair">
            <Crosshair size={14} />
          </button>
        </div>
      </div>
    )
  }

  if (selected.type === 'place') {
    const o = scenario.origins.find((x) => x.id === selected.id)
    const d = scenario.destinations.find((x) => x.id === selected.id)
    const label = o?.label ?? d?.label ?? selected.id
    const row = o ? evaluation?.per_origin.find((p) => p.origin === o.id) : null
    return (
      <div className="p-3">
        <div className="flex items-start justify-between">
          <span className="text-[11px] uppercase tracking-wider text-fg-3">{o ? 'Origin' : `Destination · ${CATEGORY_LABEL[d!.category]}`}</span>
          {close}
        </div>
        <div className="mt-1 text-sm font-semibold text-fg">{label}</div>
        <div className="mt-2 border-t border-ink-600 pt-2">
          {o && <Row k="Weight" v={`${o.weight} · ${o.weight_basis}`} />}
          {d && <Row k="Evidence" v={EVIDENCE_LABEL[d.evidence] ?? d.evidence} />}
          {d?.source_ids.length ? <Row k="Source" v={<span className="font-mono">{d.source_ids.join(', ')}</span>} /> : null}
          {row && (
            <Row k="Reachable now" v={`${row.reachable.length} of ${scenario.destinations.length} destinations`} />
          )}
        </div>
        <div className="mt-3 flex gap-2">
          {o && (
            <button className="btn-secondary flex-1" disabled={journey?.origin === o.id} onClick={() => journey && setJourney(o.id, journey.destination)}>
              <MapPin size={14} /> {journey?.origin === o.id ? 'Journey origin' : 'Set as origin'}
            </button>
          )}
          {d && (
            <button className="btn-secondary flex-1" disabled={journey?.destination === d.id} onClick={() => journey && setJourney(journey.origin, d.id)}>
              <MapPin size={14} /> {journey?.destination === d.id ? 'Journey destination' : 'Set as destination'}
            </button>
          )}
        </div>
      </div>
    )
  }

  const e = scenario.edges.find((x) => x.id === selected.id)
  if (!e) return null
  const st = (evaluation?.edge_states[e.id] ?? e.state) as EffectiveState
  const owner = scenario.interventions.find((i) => i.edge_ids.includes(e.id))
  return (
    <div className="p-3">
      <div className="flex items-start justify-between">
        <span className="text-[11px] uppercase tracking-wider text-fg-3">{KIND_LABEL[e.kind] ?? e.kind}</span>
        {close}
      </div>
      <div className="mt-1 text-sm font-semibold leading-snug text-fg">{e.label || e.id}</div>
      <p className="mt-1 text-xs text-fg-2">{e.reason}</p>
      <div className="mt-2 border-t border-ink-600 pt-2">
        <Row k="State" v={<StateBadge state={st} />} />
        <Row k="Length" v={<span className="font-mono tnum">{fmtM(e.length_m)}</span>} />
        <Row k="Evidence" v={EVIDENCE_LABEL[e.evidence] ?? e.evidence} />
        {e.source_ids.length > 0 && <Row k="Source IDs" v={<span className="font-mono">{e.source_ids.slice(0, 3).join(', ')}</span>} />}
        <Row k="Edge ID" v={<span className="font-mono text-[11px]">{e.id}</span>} />
        {owner && <Row k="Repair candidate" v={<span className="font-mono">{owner.id}</span>} />}
      </div>
      {owner && (
        <button className="btn-secondary mt-3 w-full" onClick={() => select({ type: 'intervention', id: owner.id })}>
          Inspect repair {owner.id}
        </button>
      )}
      <span className="sr-only">{STATE_LABEL[st]}</span>
    </div>
  )
}
