import { CircleAlert, Database, ExternalLink, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { RampProps } from '../api/client'
import { fmtNum } from '../lib/format'
import { useApp } from '../state/store'
import { PlanningPanel } from './PlanningPanel'
import { Section, Segmented } from './ui'

export const RECORD_CATS: Record<string, { label: string; color: string }> = {
  no_ramp: { label: 'No ramp', color: '#ff6b6b' },
  noncompliant_severe: { label: 'Non-compliant · severe defect', color: '#fb923c' },
  noncompliant_minor: { label: 'Non-compliant · minor/unmeasured', color: '#94a3b8' },
  compliant: { label: 'Compliant', color: '#34d399' },
  remediated: { label: 'Remediated', color: '#2dd4bf' },
  unknown: { label: 'Status missing', color: '#fbbf24' },
}

const POLICY_IDS: Record<string, string> = {
  strict: 'charlotte-elizabeth-strict',
  moderate: 'charlotte-elizabeth',
  lenient: 'charlotte-elizabeth-lenient',
}

export function currentPolicy(id: string) {
  return id.endsWith('-strict') ? 'strict' : id.endsWith('-lenient') ? 'lenient' : 'moderate'
}

function PolicySelector() {
  const scenarioId = useApp((s) => s.scenarioId)
  const sc = useApp((s) => s.scenario)
  const loadScenario = useApp((s) => s.loadScenario)
  const policy = currentPolicy(scenarioId)
  const desc = (sc?.context.policies as Record<string, string> | undefined)?.[policy]
  return (
    <div className="border-b border-ink-600/80 px-4 py-3.5">
      <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-fg-2">
        <Database size={13} className="text-sel-2" /> Ramp passability policy
      </div>
      <Segmented
        label="Ramp passability policy"
        value={policy}
        onChange={(p) => p !== policy && void loadScenario(POLICY_IDS[p])}
        testId="policy"
        options={[
          { value: 'strict', label: 'Strict' },
          { value: 'moderate', label: 'Severe defects' },
          { value: 'lenient', label: 'Missing only' },
        ]}
      />
      <p className="mt-1.5 text-[11.5px] leading-snug text-fg-3">{desc}</p>
      <p className="mt-1 text-[11px] leading-snug text-unk/90">
        Planning assumption, not an ADA determination. Compare policies to see how much the recommendation depends on it.
      </p>
    </div>
  )
}

export function MunicipalPanel() {
  const tab = useApp((s) => s.panelTab)
  const setTab = useApp((s) => s.setPanelTab)
  return (
    <div className="flex h-full flex-col">
      <div role="tablist" aria-label="Explorer views" className="flex shrink-0 border-b border-ink-600 px-2">
        {(
          [
            ['plan', 'Plan repairs'],
            ['records', 'Ramp records'],
            ['quality', 'Data & quality'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-3 py-2.5 text-[12.5px] font-medium ${tab === k ? 'border-sel text-fg' : 'border-transparent text-fg-3 hover:text-fg'}`}
            data-testid={`tab-${k}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'plan' && (
          <div className="flex h-full flex-col">
            <PlanningPanel header={<PolicySelector />} />
          </div>
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
  const { select, focusOn, toggleLayer } = useApp.getState()
  const layers = useApp((s) => s.layers)
  const policy = currentPolicy(scenarioId)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<string | null>(null)
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    records?.ramps.forEach((r) => (c[r.properties.classification[policy]] = (c[r.properties.classification[policy]] ?? 0) + 1))
    return c
  }, [records, policy])
  if (err) return <p className="p-4 text-[13px] text-bad">{err}</p>
  if (!records) return <p className="p-4 text-[13px] text-fg-3">Loading municipal records…</p>
  const rows = records.ramps.filter((r) => {
    const p = r.properties
    if (cat && p.classification[policy] !== cat) return false
    if (!q) return true
    const hay = `${p.RP_Street1} ${p.RP_Street2} ${p.OBJECTID} ${p.RP_AssetID}`.toLowerCase()
    return hay.includes(q.toLowerCase())
  })
  const sel = selected?.type === 'record' ? records.ramps.find((r) => String(r.properties.OBJECTID) === selected.id) : null
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="space-y-2.5 border-b border-ink-600/80 px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-fg-2">
            {records.ramps.length} CDOT curb-ramp records in the study area
          </span>
          <label className="flex items-center gap-1.5 text-[11.5px] text-fg-3">
            <input type="checkbox" checked={layers.records} onChange={() => toggleLayer('records')} className="accent-sel" /> show on map
          </label>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(RECORD_CATS).map(([k, v]) =>
            counts[k] ? (
              <button
                key={k}
                onClick={() => setCat(cat === k ? null : k)}
                aria-pressed={cat === k}
                className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11.5px] ${cat === k ? 'border-sel bg-sel-dim text-fg' : 'border-ink-600 text-fg-2 hover:border-ink-400'}`}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: v.color }} />
                {v.label} <span className="font-mono text-fg-3">{counts[k]}</span>
              </button>
            ) : null,
          )}
        </div>
        <div className="flex items-center gap-1.5 rounded-md border border-ink-500 bg-ink-850 px-2">
          <Search size={13} className="text-fg-4" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by street, OBJECTID or asset ID" aria-label="Filter records"
            className="min-w-0 flex-1 bg-transparent py-1.5 text-[12.5px] text-fg placeholder:text-fg-4 focus:outline-none" />
        </div>
      </div>
      {sel && <RecordDetail p={sel.properties} policy={policy} />}
      <ul className="divide-y divide-ink-700" data-testid="record-list">
        {rows.slice(0, 400).map((r) => {
          const p = r.properties
          const c = RECORD_CATS[p.classification[policy]]
          const active = sel?.properties.OBJECTID === p.OBJECTID
          return (
            <li key={p.OBJECTID}>
              <button
                className={`flex w-full items-center gap-2.5 px-4 py-1.5 text-left hover:bg-ink-800 ${active ? 'bg-sel-dim' : ''}`}
                onClick={() => {
                  select({ type: 'record', id: String(p.OBJECTID) })
                  focusOn({ kind: 'point', lonlat: r.geometry.coordinates })
                  if (!useApp.getState().layers.records) toggleLayer('records')
                }}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c?.color }} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-fg">
                    {(p.RP_Street1 ?? '—').replace(/_/g, ' ')} {p.RP_Street2 && p.RP_Street2 !== 'N/A' ? `& ${p.RP_Street2.replace(/_/g, ' ')}` : ''}
                  </span>
                  <span className="block text-[11px] text-fg-3">
                    {p.RP_LocInInt ?? '?'} corner · {p.RP_Type ?? 'type missing'} · {c?.label} · survey {p.survey_date ?? 'missing'}
                  </span>
                </span>
                <span className="font-mono text-[10.5px] text-fg-4">{p.OBJECTID}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

const DETAIL_FIELDS: [keyof RampProps, string][] = [
  ['OBJECTID', 'OBJECTID'],
  ['RP_AssetID', 'Asset ID'],
  ['RP_IntID', 'Intersection ID'],
  ['RP_Type', 'Ramp type'],
  ['RP_LocInInt', 'Corner'],
  ['RP_SurveyDate', 'Survey date'],
  ['RP_ComplianceStatus', 'Compliance status'],
  ['RP_InitValidStatus', 'Initial validation'],
  ['RP_Slope', 'Running slope (%)'],
  ['RP_XSlope', 'Cross slope (%)'],
  ['RP_GutterLipHt', 'Gutter lip (in)'],
  ['RP_SurfCond', 'Surface condition'],
  ['RP_Obs', 'Obstruction'],
  ['RP_XWalk1', 'Crosswalk 1 marked'],
  ['RP_XWalk1Dir', 'Crosswalk 1 direction'],
  ['RP_XWalk2', 'Crosswalk 2 marked'],
  ['RP_XWalk2Dir', 'Crosswalk 2 direction'],
  ['Remediated', 'Remediated'],
  ['RemediatedType', 'Remediation type'],
  ['RemediatedDate', 'Remediation date'],
  ['ActualCosts', 'Actual costs'],
  ['TechnicalInfeasibility', 'Technical infeasibility'],
]

function RecordDetail({ p, policy }: { p: RampProps; policy: string }) {
  const c = RECORD_CATS[p.classification[policy]]
  return (
    <div className="border-b border-ink-600 bg-ink-800/60 px-4 py-3" data-testid="record-detail">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: c?.color }} />
        <span className="text-[13px] font-semibold text-fg">
          {(p.RP_Street1 ?? '').replace(/_/g, ' ')} {p.RP_Street2 && p.RP_Street2 !== 'N/A' ? `& ${p.RP_Street2.replace(/_/g, ' ')}` : ''}
        </span>
      </div>
      <p className="mt-1 text-[11.5px] text-fg-3">
        StreetMend class: <span className="text-fg-2">{c?.label}</span> → modeled as <span className="font-mono text-fg-2">{p.state[policy]}</span> under the {policy} policy.
      </p>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11.5px]">
        {DETAIL_FIELDS.map(([k, label]) => {
          const v = p[k]
          const missing = v === null || v === undefined || v === ''
          return (
            <div key={k} className="flex justify-between gap-2 border-b border-ink-700/60 py-0.5">
              <dt className="text-fg-3">{label}</dt>
              <dd className={missing ? 'text-unk/80' : 'text-right text-fg-2'}>{missing ? 'missing' : String(v)}</dd>
            </div>
          )
        })}
      </dl>
      <p className="mt-2 text-[10.5px] text-fg-4">Source: CDOT ADA Curb Ramps (City of Charlotte). Historical survey record; current conditions may differ.</p>
    </div>
  )
}

function QualityTab() {
  const records = useApp((s) => s.records)
  const sc = useApp((s) => s.scenario)
  const rep = sc?.context.build_report as
    | { counts: Record<string, number>; unmatched_ramps: unknown[]; ambiguous_intersections: unknown[]; unsnapped_places: { name: string; reason: string }[]; candidates: number; origins: number; destinations: Record<string, number> }
    | undefined
  if (!records || !rep) return <p className="p-4 text-[13px] text-fg-3">Loading…</p>
  const c = rep.counts
  const rampEdges = (c.ramp_edges_traversable ?? 0) + (c.ramp_edges_blocked ?? 0) + (c.ramp_edges_unknown ?? 0)
  const sw = (c.sidewalk_traversable ?? 0) + (c.sidewalk_blocked ?? 0) + (c.sidewalk_unknown ?? 0)
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—')
  const ramps = records.quality.layers.ramps
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <Section title="Coverage of the modeled graph">
        <div className="mb-2 flex items-start gap-2 rounded-md border border-unk/30 bg-unk-dim/40 px-2.5 py-2 text-[12px] leading-snug text-fg-2">
          <CircleAlert size={14} className="mt-0.5 shrink-0 text-unk" />
          <span>
            Only {pct(rampEdges - (c.ramp_edges_unknown ?? 0), rampEdges)} of modeled crossing landings matched a CDOT ramp record and{' '}
            {pct(sw - (c.sidewalk_unknown ?? 0), sw)} of sidewalk sides matched an inventory record. Unmatched links are UNKNOWN and excluded, so municipal
            reachability figures are conservative lower bounds of the modeled network.
          </span>
        </div>
        <table className="w-full text-[12px]">
          <tbody className="[&_td]:py-0.5">
            <tr><td className="text-fg-3">Ramp records matched to intersections</td><td className="text-right font-mono text-fg-2">{c.ramps_matched} / {c.ramp_records}</td></tr>
            <tr><td className="text-fg-3">Unmatched ramp records (no OSM intersection ≤ 35 m)</td><td className="text-right font-mono text-fg-2">{rep.unmatched_ramps.length}</td></tr>
            <tr><td className="text-fg-3">Ambiguous intersection matches (flagged)</td><td className="text-right font-mono text-fg-2">{rep.ambiguous_intersections.length}</td></tr>
            <tr><td className="text-fg-3">Crossing landings: traversable / blocked / unknown</td><td className="text-right font-mono text-fg-2">{c.ramp_edges_traversable ?? 0} / {c.ramp_edges_blocked ?? 0} / {c.ramp_edges_unknown ?? 0}</td></tr>
            <tr><td className="text-fg-3">Sidewalk sides: traversable / blocked / unknown</td><td className="text-right font-mono text-fg-2">{c.sidewalk_traversable ?? 0} / {c.sidewalk_blocked ?? 0} / {c.sidewalk_unknown ?? 0}</td></tr>
            <tr><td className="text-fg-3">Inventory lines matched to a street side</td><td className="text-right font-mono text-fg-2">{c.inventory_matched} / {(c.inventory_matched ?? 0) + (c.inventory_unmatched ?? 0)}</td></tr>
            <tr><td className="text-fg-3">Modeled crossings</td><td className="text-right font-mono text-fg-2">{c.crossings}</td></tr>
            <tr><td className="text-fg-3">Repair candidates (recorded barrier ramps)</td><td className="text-right font-mono text-fg-2">{rep.candidates}</td></tr>
            <tr><td className="text-fg-3">Origins (OSM residential bldgs, aggregated)</td><td className="text-right font-mono text-fg-2">{rep.origins} ({c.residential_buildings_used} bldgs)</td></tr>
            <tr><td className="text-fg-3">Destinations</td><td className="text-right font-mono text-fg-2">{Object.entries(rep.destinations).map(([k, v]) => `${v} ${k}`).join(' · ')}</td></tr>
          </tbody>
        </table>
        {rep.unsnapped_places.length > 0 && (
          <p className="mt-2 text-[11.5px] text-fg-3">Excluded (no modeled sidewalk within tolerance): {rep.unsnapped_places.map((u) => u.name).join(', ')}.</p>
        )}
      </Section>
      <Section title="Ramp record completeness">
        <p className="mb-1.5 text-[11.5px] text-fg-3">Missing values among {ramps?.count} ramp records (after {ramps?.duplicates_removed?.length ?? 0} duplicates removed):</p>
        <ul className="space-y-1">
          {Object.entries(ramps?.missing ?? {}).map(([k, v]) => (
            <li key={k} className="grid grid-cols-[150px_1fr_46px] items-center gap-2 text-[11.5px]">
              <span className="font-mono text-fg-2">{k}</span>
              <span className="h-1.5 overflow-hidden rounded bg-ink-700">
                <span className="block h-full bg-unk/70" style={{ width: pct(v, ramps?.count ?? 1) }} />
              </span>
              <span className="text-right font-mono text-fg-3">{pct(v, ramps?.count ?? 1)}</span>
            </li>
          ))}
        </ul>
        {ramps?.transform && (
          <p className="mt-2 text-[11.5px] leading-snug text-fg-3">
            Coordinates: EPSG:{ramps.transform.from_epsg} (NC State Plane, US ft) → EPSG:4326 with pyproj. Cross-checked against ArcGIS server reprojection on{' '}
            {ramps.transform.samples} records: max difference {fmtNum(ramps.transform.max_error_m, 2)} m.
          </p>
        )}
      </Section>
      <Section title="Sources">
        <ul className="space-y-2">
          {records.provenance.map((p) => {
            const pv = p as Record<string, string | number | null>
            return (
              <li key={String(pv.id)} className="rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-[12px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-fg">{pv.name}</span>
                  <span className={`rounded px-1.5 text-[10.5px] ${pv.status === 'ok' ? 'bg-ok-dim text-ok' : 'bg-bad-dim text-bad'}`}>{pv.status}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-fg-3">
                  {pv.publisher && <span>{pv.publisher}</span>}
                  {pv.record_count !== undefined && <span>{pv.record_count} records</span>}
                  {pv.data_last_edit && <span>layer edited {pv.data_last_edit}</span>}
                  {pv.retrieved_at && <span>retrieved {String(pv.retrieved_at).slice(0, 10)}</span>}
                  {pv.native_crs && <span>{pv.native_crs}</span>}
                </div>
                {pv.license && <div className="text-[11px] text-fg-4">{pv.license}</div>}
                {pv.url && (
                  <a className="mt-0.5 inline-flex items-center gap-1 break-all text-[11px] text-sel-2 hover:underline" href={String(pv.url)} target="_blank" rel="noreferrer">
                    {String(pv.url).replace('https://', '')} <ExternalLink size={10} />
                  </a>
                )}
              </li>
            )
          })}
        </ul>
      </Section>
    </div>
  )
}
