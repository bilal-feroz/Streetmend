import { CircleAlert, ExternalLink, Search } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import type { RampProps } from '../../api/client'
import { useApp } from '../../state/store'
import { Segmented } from '../ui'
import { JourneyCard } from './JourneyCard'
import { PlanView } from './PlanView'
import { ResultsView } from './ResultsView'

function Footnote() {
  return (
    <p className="px-6 pt-1 pb-6 text-[11px] leading-relaxed text-ink-3">
      Planning and research prototype. Not a certified accessible-navigation system, an ADA compliance determination, or an authorization for construction.
    </p>
  )
}

export function GuidedPanel() {
  const view = useApp((s) => s.panelView)
  const analysis = useApp((s) => s.analysis)
  return (
    <div className="scroll-thin h-full overflow-y-auto overscroll-contain">
      <JourneyCard />
      {view === 'results' && analysis ? <ResultsView /> : <PlanView />}
      <Footnote />
    </div>
  )
}

export const RECORD_CATS: Record<string, { label: string; color: string }> = {
  no_ramp: { label: 'No ramp', color: '#d85e51' },
  noncompliant_severe: { label: 'Non-compliant · severe defect', color: '#e08a3c' },
  noncompliant_minor: { label: 'Non-compliant · minor/unmeasured', color: '#8a968f' },
  compliant: { label: 'Compliant', color: '#198568' },
  remediated: { label: 'Remediated', color: '#2a9d8f' },
  unknown: { label: 'Status missing', color: '#dca344' },
}

const POLICY_IDS: Record<string, string> = { strict: 'charlotte-elizabeth-strict', moderate: 'charlotte-elizabeth', lenient: 'charlotte-elizabeth-lenient' }
export const currentPolicy = (id: string) => (id.endsWith('-strict') ? 'strict' : id.endsWith('-lenient') ? 'lenient' : 'moderate')

function PolicySelector() {
  const scenarioId = useApp((s) => s.scenarioId)
  const sc = useApp((s) => s.scenario)
  const loadScenario = useApp((s) => s.loadScenario)
  const policy = currentPolicy(scenarioId)
  const desc = (sc?.context.policies as Record<string, string> | undefined)?.[policy]
  return (
    <section className="border-b border-line px-6 py-4">
      <h2 className="eyebrow">Ramp passability policy</h2>
      <div className="mt-2">
        <Segmented size="sm" label="Ramp passability policy" value={policy} testId="policy" onChange={(p) => p !== policy && void loadScenario(POLICY_IDS[p])}
          options={[{ value: 'strict', label: 'Strict' }, { value: 'moderate', label: 'Severe defects' }, { value: 'lenient', label: 'Missing only' }]} />
      </div>
      <p className="mt-1.5 text-[12px] leading-snug text-ink-2">{desc}</p>
      <p className="mt-1 text-[11.5px] leading-snug text-unk-ink">A planning assumption, not an ADA determination. Compare policies to see how much results depend on it.</p>
    </section>
  )
}

export function ExplorerPanel() {
  const tab = useApp((s) => s.explorerTab)
  const setTab = useApp((s) => s.setExplorerTab)
  const view = useApp((s) => s.panelView)
  const analysis = useApp((s) => s.analysis)
  const tabs: [typeof tab, string][] = [['plan', 'Plan repairs'], ['records', 'Ramp records'], ['quality', 'Data & quality']]
  return (
    <div className="flex h-full flex-col">
      <div role="tablist" aria-label="Explorer views" className="flex shrink-0 border-b border-line px-4 pt-1">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} data-testid={`tab-${k}`}
            className={`-mb-px border-b-2 px-2.5 py-3 text-[12.5px] font-semibold ${tab === k ? 'border-ink text-ink' : 'border-transparent text-ink-2 hover:text-ink'}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {tab === 'plan' && (
          <>
            <PolicySelector />
            <JourneyCard />
            {view === 'results' && analysis ? <ResultsView /> : <PlanView />}
            <Footnote />
          </>
        )}
        {tab === 'records' && <RecordsTab />}
        {tab === 'quality' && <QualityTab />}
      </div>
    </div>
  )
}

function RecordsTab() {
  const records = useApp((s) => s.records)
  const err = useApp((s) => s.recordsError)
  const scenarioId = useApp((s) => s.scenarioId)
  const selected = useApp((s) => s.selected)
  const layers = useApp((s) => s.layers)
  const { select, cameraTo, toggleLayer } = useApp.getState()
  const policy = currentPolicy(scenarioId)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<string | null>(null)
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    records?.ramps.forEach((r) => (c[r.properties.classification[policy]] = (c[r.properties.classification[policy]] ?? 0) + 1))
    return c
  }, [records, policy])
  if (err) return <p className="p-4 text-[13px] text-bad-ink">{err}</p>
  if (!records) return <p className="p-4 text-[13px] text-ink-2">Loading municipal records…</p>
  const rows = records.ramps.filter((r) => {
    const p = r.properties
    if (cat && p.classification[policy] !== cat) return false
    return !q || `${p.RP_Street1} ${p.RP_Street2} ${p.OBJECTID} ${p.RP_AssetID}`.toLowerCase().includes(q.toLowerCase())
  })
  const sel = selected?.type === 'record' ? records.ramps.find((r) => String(r.properties.OBJECTID) === selected.id) : null
  return (
    <div>
      <div className="space-y-2.5 border-b border-line px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-[12.5px] text-ink">{records.ramps.length} CDOT curb-ramp records in the study area</span>
          <label className="ml-3 flex shrink-0 items-center gap-1.5 text-[12px] text-ink-2">
            <input type="checkbox" checked={layers.records} onChange={() => toggleLayer('records')} className="accent-sel" /> on map
          </label>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(RECORD_CATS).map(([k, v]) =>
            counts[k] ? (
              <button key={k} onClick={() => setCat(cat === k ? null : k)} aria-pressed={cat === k}
                className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11.5px] ${cat === k ? 'border-sel bg-sel-bg text-ink' : 'border-line-2 text-ink-2 hover:border-ink-3'}`}>
                <span className="h-2 w-2 rounded-full" style={{ background: v.color }} aria-hidden />
                {v.label} <span className="font-mono text-ink-3">{counts[k]}</span>
              </button>
            ) : null,
          )}
        </div>
        <div className="flex items-center gap-1.5 rounded-md border border-line-2 px-2">
          <Search size={13} className="text-ink-3" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by street, OBJECTID or asset ID" aria-label="Filter records"
            className="min-w-0 flex-1 bg-transparent py-1.5 text-[12.5px] text-ink placeholder:text-ink-3 focus:outline-none" />
        </div>
      </div>
      {sel && <RecordDetail p={sel.properties} policy={policy} />}
      <ul className="divide-y divide-line" data-testid="record-list">
        {rows.slice(0, 400).map((r) => {
          const p = r.properties
          const c = RECORD_CATS[p.classification[policy]]
          const active = sel?.properties.OBJECTID === p.OBJECTID
          return (
            <li key={p.OBJECTID}>
              <button className={`flex w-full items-center gap-2.5 px-4 py-1.5 text-left hover:bg-wash ${active ? 'bg-sel-bg' : ''}`}
                onClick={() => {
                  select({ type: 'record', id: String(p.OBJECTID) })
                  cameraTo({ preset: 'point', lonlat: r.geometry.coordinates })
                  if (!useApp.getState().layers.records) toggleLayer('records')
                }}>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c?.color }} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-ink">
                    {(p.RP_Street1 ?? '—').replace(/_/g, ' ')} {p.RP_Street2 && p.RP_Street2 !== 'N/A' ? `& ${p.RP_Street2.replace(/_/g, ' ')}` : ''}
                  </span>
                  <span className="block text-[11.5px] text-ink-2">
                    {p.RP_LocInInt ?? '?'} corner · {p.RP_Type ?? 'type missing'} · {c?.label} · survey {p.survey_date ?? 'missing'}
                  </span>
                </span>
                <span className="font-mono text-[10.5px] text-ink-3">{p.OBJECTID}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

const DETAIL_FIELDS: [keyof RampProps, string][] = [
  ['OBJECTID', 'OBJECTID'], ['RP_AssetID', 'Asset ID'], ['RP_IntID', 'Intersection ID'], ['RP_Type', 'Ramp type'], ['RP_LocInInt', 'Corner'],
  ['RP_SurveyDate', 'Survey date'], ['RP_ComplianceStatus', 'Compliance status'], ['RP_InitValidStatus', 'Initial validation'],
  ['RP_Slope', 'Running slope (%)'], ['RP_XSlope', 'Cross slope (%)'], ['RP_GutterLipHt', 'Gutter lip (in)'], ['RP_SurfCond', 'Surface condition'],
  ['RP_Obs', 'Obstruction'], ['RP_XWalk1', 'Crosswalk 1 marked'], ['RP_XWalk1Dir', 'Crosswalk 1 direction'], ['RP_XWalk2', 'Crosswalk 2 marked'],
  ['RP_XWalk2Dir', 'Crosswalk 2 direction'], ['Remediated', 'Remediated'], ['RemediatedType', 'Remediation type'], ['RemediatedDate', 'Remediation date'],
  ['ActualCosts', 'Actual costs'], ['TechnicalInfeasibility', 'Technical infeasibility'],
]

function RecordDetail({ p, policy }: { p: RampProps; policy: string }) {
  const c = RECORD_CATS[p.classification[policy]]
  return (
    <div className="border-b border-line bg-wash/60 px-4 py-3" data-testid="record-detail">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: c?.color }} aria-hidden />
        <span className="text-[13px] font-semibold text-ink">
          {(p.RP_Street1 ?? '').replace(/_/g, ' ')} {p.RP_Street2 && p.RP_Street2 !== 'N/A' ? `& ${p.RP_Street2.replace(/_/g, ' ')}` : ''}
        </span>
      </div>
      <p className="mt-1 text-[11.5px] text-ink-2">
        Classified <span className="font-medium text-ink">{c?.label}</span> → modeled as <span className="font-mono text-ink">{p.state[policy]}</span> under the {policy} policy. Nearby
        modeled network is highlighted on the map.
      </p>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 text-[11.5px]">
        {DETAIL_FIELDS.map(([k, label]) => {
          const v = p[k]
          const missing = v === null || v === undefined || v === ''
          return (
            <div key={k} className="flex justify-between gap-2 border-b border-line py-0.5">
              <dt className="text-ink-2">{label}</dt>
              <dd className={missing ? 'text-unk-ink' : 'text-right text-ink'}>{missing ? 'missing' : String(v)}</dd>
            </div>
          )
        })}
      </dl>
      <p className="mt-2 text-[10.5px] text-ink-3">Source: CDOT ADA Curb Ramps (City of Charlotte). Historical survey observation; current conditions may differ.</p>
    </div>
  )
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <tr>
      <td className="py-0.5 pr-2 text-ink-2">{k}</td>
      <td className="py-0.5 text-right font-mono text-ink">{v}</td>
    </tr>
  )
}

function QualityTab() {
  const records = useApp((s) => s.records)
  const sc = useApp((s) => s.scenario)
  const rep = sc?.context.build_report as
    | { counts: Record<string, number>; unmatched_ramps: unknown[]; ambiguous_intersections: unknown[]; unsnapped_places: { name: string }[]; candidates: number; origins: number; destinations: Record<string, number> }
    | undefined
  if (!records || !rep) return <p className="p-4 text-[13px] text-ink-2">Loading…</p>
  const c = rep.counts
  const rampEdges = (c.ramp_edges_traversable ?? 0) + (c.ramp_edges_blocked ?? 0) + (c.ramp_edges_unknown ?? 0)
  const sw = (c.sidewalk_traversable ?? 0) + (c.sidewalk_blocked ?? 0) + (c.sidewalk_unknown ?? 0)
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—')
  const ramps = records.quality.layers.ramps
  return (
    <div className="px-4 py-3.5 text-[12.5px]">
      <h2 className="eyebrow">Coverage of the modeled graph</h2>
      <div className="mt-2 flex items-start gap-2 rounded-lg border border-unk/40 bg-unk-bg/50 px-2.5 py-2 leading-snug text-ink">
        <CircleAlert size={14} className="mt-0.5 shrink-0 text-unk-ink" aria-hidden />
        <span>
          Only {pct(rampEdges - (c.ramp_edges_unknown ?? 0), rampEdges)} of modeled crossing landings matched a CDOT ramp record and {pct(sw - (c.sidewalk_unknown ?? 0), sw)} of
          sidewalk sides matched an inventory record. Unmatched links are unknown and excluded, so reachability here is a conservative lower bound.
        </span>
      </div>
      <table className="mt-2 w-full text-[12px]">
        <tbody>
          <Row k="Ramp records matched to intersections" v={`${c.ramps_matched} / ${c.ramp_records}`} />
          <Row k="Unmatched ramp records (no intersection ≤ 35 m)" v={rep.unmatched_ramps.length} />
          <Row k="Ambiguous intersection matches (flagged)" v={rep.ambiguous_intersections.length} />
          <Row k="Crossing landings: traversable / blocked / unknown" v={`${c.ramp_edges_traversable ?? 0} / ${c.ramp_edges_blocked ?? 0} / ${c.ramp_edges_unknown ?? 0}`} />
          <Row k="Sidewalk sides: traversable / blocked / unknown" v={`${c.sidewalk_traversable ?? 0} / ${c.sidewalk_blocked ?? 0} / ${c.sidewalk_unknown ?? 0}`} />
          <Row k="Modeled crossings" v={c.crossings} />
          <Row k="Repair candidates (recorded barrier ramps)" v={rep.candidates} />
          <Row k="Origins (OSM residential buildings, aggregated)" v={`${rep.origins} (${c.residential_buildings_used} bldgs)`} />
        </tbody>
      </table>
      <h2 className="eyebrow mt-4">Missing values in ramp records</h2>
      <p className="mt-1 text-[11.5px] text-ink-2">Share of the {ramps?.count ?? 0} records where the field is empty.</p>
      <ul className="mt-1.5 space-y-1">
        {Object.entries(ramps?.missing ?? {}).map(([k, v]) => (
          <li key={k} className="grid grid-cols-[140px_1fr_40px] items-center gap-2 text-[11.5px]">
            <span className="font-mono text-ink">{k}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-wash">
              <span className="block h-full bg-unk" style={{ width: pct(v, ramps?.count ?? 1) }} />
            </span>
            <span className="text-right font-mono text-ink-2">{pct(v, ramps?.count ?? 1)}</span>
          </li>
        ))}
      </ul>
      {ramps?.transform && (
        <p className="mt-2 text-[11.5px] leading-snug text-ink-2">
          Coordinates: EPSG:{ramps.transform.from_epsg} (NC State Plane, US ft) → WGS84 with pyproj, cross-checked against ArcGIS server reprojection on {ramps.transform.samples} records
          (max difference {ramps.transform.max_error_m?.toFixed(2)} m).
        </p>
      )}
      <h2 className="eyebrow mt-4">Sources</h2>
      <ul className="mt-1.5 space-y-2">
        {records.provenance.map((p) => {
          const pv = p as Record<string, string | number | null>
          return (
            <li key={String(pv.id)} className="rounded-md border border-line px-2.5 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-ink">{pv.name}</span>
                <span className={`rounded px-1.5 text-[10.5px] font-medium ${pv.status === 'ok' ? 'bg-ok-bg text-ok-ink' : 'bg-bad-bg text-bad-ink'}`}>{pv.status}</span>
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-ink-2">
                {pv.publisher && <span>{pv.publisher}</span>}
                {pv.record_count !== undefined && <span>{pv.record_count} records</span>}
                {pv.data_last_edit && <span>layer edited {pv.data_last_edit}</span>}
                {pv.retrieved_at && <span>retrieved {String(pv.retrieved_at).slice(0, 10)}</span>}
              </div>
              {pv.url && (
                <a className="mt-0.5 inline-flex items-center gap-1 break-all text-[11px] text-sel-ink hover:underline" href={String(pv.url)} target="_blank" rel="noreferrer">
                  {String(pv.url).replace('https://', '')} <ExternalLink size={10} aria-hidden />
                </a>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
