import { ArrowLeft, Check, Columns2, Crosshair, Download, LoaderCircle, Undo2, Wrench } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { api } from '../../api/client'
import type { OptimizeResponse, ScenarioOut } from '../../api/types'
import { isAnalysisStale, useApp } from '../../state/store'
import { Disclosure, Stat } from '../ui'
import { Assistant } from './Assistant'
import { crossingName } from './JourneyCard'

const SOLVER: Record<string, string> = {
  exact_enumeration: 'StreetMend (exact)',
  beam_search: 'StreetMend (beam, approx.)',
  greedy: 'Greedy, best next repair',
  independent_ranking: 'Rank repairs individually',
  nearest_to_priority_destination: 'Nearest to destination',
}
const n = (x: number) => x.toLocaleString('en-US', { maximumFractionDigits: 1 })

/** One-sentence summary built only from computed analysis fields. */
export function headline(a: OptimizeResponse, sc: ScenarioOut): string {
  const sel = a.recommendation.selected
  if (!sel.length) {
    return a.params.budget === 0 ? 'Budget is zero, so no repairs were selected.' : 'No repair within this budget improves access. The repairs that matter here only work in combination.'
  }
  const pairs = a.newly_connected_pairs.length
  const ivs = sel.map((id) => sc.interventions.find((i) => i.id === id))
  const crossing = ivs.length === 2 && ivs[0]?.attrs?.crossing && ivs[0]?.attrs?.crossing === ivs[1]?.attrs?.crossing ? (ivs[0]!.attrs.crossing as string) : null
  const xl = crossing ? sc.edges.find((e) => e.id === crossing)?.label : null
  const allZero = a.contributions.every((c) => c.alone_gain === 0)
  if (xl && a.synergy > 0) return `These two repairs complete a previously disconnected crossing: ${crossingName(xl)}. Together they reconnect ${pairs} journey${pairs === 1 ? '' : 's'}.`
  if (allZero && sel.length > 1 && a.synergy > 0) return `None of these repairs helps on its own; together they reconnect ${pairs} journey${pairs === 1 ? '' : 's'}.`
  return `These ${sel.length} repair${sel.length === 1 ? '' : 's'} reconnect ${pairs} journey${pairs === 1 ? '' : 's'} to essential destinations.`
}

export function ResultsView() {
  const a = useApp((s) => s.analysis)
  const sc = useApp((s) => s.scenario)
  const applied = useApp((s) => s.applied)
  const ev = useApp((s) => s.evaluation)
  const compare = useApp((s) => s.compare)
  const analyzing = useApp((s) => s.analyzing)
  const stale = useApp(isAnalysisStale)
  const st = useApp.getState()
  const [exporting, setExporting] = useState(false)
  const [applyingAll, setApplyingAll] = useState(false)
  if (!a || !sc) return null
  const rec = a.recommendation
  const o = a.objective
  const route = ev?.journey?.route
  const best = Math.max(rec.gain, ...a.baselines.map((b) => b.gain), 1)
  const priorityLabel = st.priority === 'custom' ? 'custom weights' : `${st.priority} priority`
  const applyAll = async () => {
    setApplyingAll(true)
    try {
      for (const id of rec.selected) {
        if (useApp.getState().applied.includes(id)) continue
        await useApp.getState().apply(id)
        await new Promise((r) => setTimeout(r, 1500))
      }
    } finally {
      setApplyingAll(false)
    }
  }
  const exportReport = async () => {
    setExporting(true)
    try {
      const md = await api.report(st.scenarioId, applied, { budget: st.budget, weights: st.weights, cutoff_m: st.cutoff })
      const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `streetmend-${st.scenarioId}-report.md`
      link.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }
  return (
    <section aria-labelledby="res-h" className="border-t border-line px-4 pt-3.5 pb-4" data-testid="results">
      <div className="flex items-center justify-between">
        <h2 id="res-h" className="eyebrow">
          Recommended repairs
        </h2>
        <button className="btn-ghost px-1.5 py-0.5 text-[12px]" onClick={() => st.setPanelView('plan')} data-testid="edit-plan">
          <ArrowLeft size={13} aria-hidden /> Edit plan
        </button>
      </div>
      <p className="mt-0.5 text-[11.5px] text-ink-3" data-testid="solver-meta">
        Budget {a.params.budget} · {priorityLabel} · {rec.exact ? 'exact search' : 'beam search (approximate)'} over {n(rec.evaluations)} combinations · {rec.runtime_ms.toFixed(0)} ms
        {analyzing && <LoaderCircle size={11} className="ml-1 inline animate-spin" aria-label="Recomputing" />}
        {stale && !analyzing && ' · parameters changed, recomputing'}
      </p>
      <p className="mt-2 text-[14px] leading-snug font-semibold text-ink" data-testid="headline">
        {headline(a, sc)}
      </p>

      {rec.selected.length > 0 && (
        <ol className="mt-2.5 space-y-1.5" data-testid="recommendations">
          {rec.selected.map((id, i) => {
            const iv = sc.interventions.find((x) => x.id === id)!
            const c = a.contributions.find((x) => x.id === id)
            const on = applied.includes(id)
            return (
              <motion.li key={id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}
                className={`flex items-start gap-2.5 rounded-lg border p-2.5 ${on ? 'border-ok/40 bg-ok-bg/40' : 'border-line'}`} data-testid={`rec-${id}`}>
                <button className={`grid h-6 min-w-6 shrink-0 place-items-center rounded-full px-1 text-[11.5px] font-bold ${on ? 'bg-ok text-white' : 'bg-sel text-white'}`}
                  onClick={() => { st.select({ type: 'intervention', id }); st.cameraTo({ preset: 'intervention', id }) }} aria-label={`Show repair ${id} on the map`}>
                  {on ? <Check size={12} strokeWidth={3} /> : id.length <= 2 ? id : i + 1}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] leading-snug font-medium text-ink">{iv.label}</div>
                  {c && (
                    <div className="mt-0.5 text-[11.5px] text-ink-2">
                      Alone <span className="font-semibold tnum text-ink">+{n(c.alone_gain)}</span> · within the pair <span className="font-semibold tnum text-ok-ink">+{n(c.marginal_in_set)}</span>
                    </div>
                  )}
                </div>
                {on ? (
                  <button className="btn-secondary shrink-0 px-2 py-1 text-[12px]" onClick={() => void st.remove(id)} data-testid={`remove-${id}`}>
                    <Undo2 size={12} aria-hidden /> Remove
                  </button>
                ) : (
                  <button className="btn-primary shrink-0 px-2.5 py-1 text-[12px]" onClick={() => void st.apply(id)} data-testid={`apply-${id}`}>
                    <Wrench size={12} aria-hidden /> Apply
                  </button>
                )}
              </motion.li>
            )
          })}
        </ol>
      )}
      {rec.selected.length > 1 && rec.selected.some((id) => !applied.includes(id)) && (
        <button className="btn-secondary mt-1.5 w-full text-[12.5px]" onClick={() => void applyAll()} disabled={applyingAll} data-testid="apply-all">
          {applyingAll ? <LoaderCircle size={13} className="animate-spin" /> : <Wrench size={13} />} Apply {rec.selected.length === 2 ? 'both' : 'all'} in order
        </button>
      )}

      {rec.selected.length > 0 && (
        <div className="mt-3" data-testid="combined-effect">
          <div className="text-[12.5px] font-medium text-ink">Why this combination?</div>
          <div className="mt-1.5 space-y-1" role="img"
            aria-label={[...a.contributions.map((c) => `${c.id} alone: +${n(c.alone_gain)}`), `together: +${n(o.gain)}`].join('; ')}>
            {[...a.contributions.map((c) => ({ k: c.id, label: `${c.id.length <= 2 ? c.id : c.id} alone`, v: c.alone_gain, tone: 'bg-ink-3' })),
              { k: 'all', label: rec.selected.length > 1 ? 'Together' : 'Selected', v: o.gain, tone: 'bg-ok' }].map((r, i) => (
              <div key={r.k} className="grid grid-cols-[84px_1fr_44px] items-center gap-2">
                <span className="truncate text-[11.5px] text-ink-2">{r.label}</span>
                <div className="h-2 overflow-hidden rounded-full bg-wash">
                  <motion.div className={`h-full rounded-full ${r.tone}`} initial={{ width: 0 }} animate={{ width: `${Math.max(r.v > 0 ? 3 : 0, (r.v / Math.max(o.gain, 1)) * 100)}%` }} transition={{ duration: 0.6, delay: 0.1 * i }} />
                </div>
                <span className="text-right text-[12px] font-semibold tnum text-ink">+{n(r.v)}</span>
              </div>
            ))}
          </div>
          <ul className="mt-2 space-y-1 text-[12px] leading-snug text-ink-2" data-testid="explanation">
            {a.explanation.slice(1).map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-wash p-2.5" data-testid="impact">
        <Stat label="Journeys" before={o.connected_pairs_before} after={o.connected_pairs_after} testId="stat-pairs" />
        <Stat label="Weighted access" before={n(o.before)} after={n(o.after)} testId="stat-objective" />
        <Stat label="Selected journey" after={route?.found ? `${Math.round(route.length_m ?? 0)}` : '—'} unit={route?.found ? 'm' : undefined} testId="stat-route" />
      </div>
      <p className="mt-1 text-[11px] text-ink-3">
        Out of {o.total_pairs} origin–destination journeys. Weighted access = Σ weights of reachable journeys
        {o.relative_gain === null ? ' (no percentage: baseline is 0).' : `; +${Math.round(o.relative_gain * 100)}%.`}
      </p>

      <div className="mt-3">
        <div className="text-[12.5px] font-medium text-ink">Compared with simple methods</div>
        <div className="mt-1.5 space-y-1" data-testid="baselines">
          {[rec, ...a.baselines].map((b, i) => (
            <div key={b.solver} className="grid grid-cols-[150px_1fr_40px] items-center gap-2">
              <span className={`truncate text-[11.5px] ${i === 0 ? 'font-semibold text-ink' : 'text-ink-2'}`} title={b.notes.join(' ')}>
                {SOLVER[b.solver] ?? b.solver}
              </span>
              <div className="relative h-4 overflow-hidden rounded bg-wash">
                <motion.div className={`absolute inset-y-0 left-0 rounded ${i === 0 ? 'bg-sel' : 'bg-line-2'}`} initial={{ width: 0 }} animate={{ width: `${(b.gain / best) * 100}%` }} transition={{ duration: 0.5, delay: i * 0.06 }} />
                <span className={`absolute inset-y-0 left-1.5 flex items-center text-[10.5px] font-medium ${i === 0 && b.gain > 0 ? 'text-white' : 'text-ink'}`}>{b.selected.join(' + ') || 'no repair'}</span>
              </div>
              <span className="text-right text-[12px] font-semibold tnum text-ink">+{n(b.gain)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-unk/40 bg-unk-bg/50 px-2.5 py-2 text-[11.5px] leading-snug text-ink" data-testid="uncertainty">
        {sc.mode === 'hypothetical' ? (
          <>Barrier locations are <b>hypothetical scenario settings</b> on real streets, not survey findings. Street geometry and places are real.</>
        ) : a.sensitivity.unknown_edge_count > 0 ? (
          <>
            {a.sensitivity.unknown_edge_count} links have unknown condition and are excluded.{' '}
            {a.sensitivity.optimal_is_exact
              ? a.sensitivity.recommendation_changes
                ? 'If they were passable, the optimum would change, so verify them before acting.'
                : 'If they were passable, the recommendation would stay the same.'
              : 'Whether the recommendation depends on them was not determined (too many combinations).'}
          </>
        ) : (
          <>All modeled links have evidence for this analysis.</>
        )}
      </div>

      <div className="mt-3 flex gap-2">
        <button className={`btn-secondary flex-1 text-[12.5px] ${compare === 'split' ? 'border-sel text-sel-ink' : ''}`} onClick={() => st.setCompare(compare === 'split' ? 'off' : 'split')} data-testid="toggle-compare" aria-pressed={compare === 'split'}>
          <Columns2 size={13} aria-hidden /> {compare === 'split' ? 'Exit comparison' : 'Before / after'}
        </button>
        <button className="btn-secondary flex-1 text-[12.5px]" onClick={() => void exportReport()} disabled={exporting} data-testid="export">
          {exporting ? <LoaderCircle size={13} className="animate-spin" /> : <Download size={13} aria-hidden />} Export report
        </button>
      </div>

      {a.newly_connected_pairs.length > 0 && (
        <div className="mt-2">
          <Disclosure title={`Journeys reconnected (${a.newly_connected_pairs.length})`} testId="toggle-pairs">
            <ul className="divide-y divide-line rounded-md border border-line" data-testid="new-pairs">
              {a.newly_connected_pairs.map((p) => (
                <li key={p.origin + p.destination} className="flex items-center justify-between gap-2 px-2 py-1.5 text-[12px]">
                  <span className="min-w-0 truncate text-ink">
                    {p.origin_label.replace(/ \(\d+ bldg\)$/, '')} <span className="text-ink-3">→</span> {p.destination_label}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-ok-ink">{Math.round(p.after_m)} m</span>
                </li>
              ))}
            </ul>
          </Disclosure>
        </div>
      )}
      <CandidateList />
      {/* follow-up questions stay possible here; an answer that led to these results stays visible */}
      <Disclosure title="Ask a planning question" testId="toggle-assistant" defaultOpen={!!useApp.getState().assistantLast}>
        <Assistant />
      </Disclosure>
    </section>
  )
}

export function CandidateList() {
  const sc = useApp((s) => s.scenario)
  const applied = useApp((s) => s.applied)
  const a = useApp((s) => s.analysis)
  const st = useApp.getState()
  if (!sc) return null
  return (
    <Disclosure title={`All repair candidates (${sc.interventions.length})`} testId="toggle-candidates">
      <p className="mb-1.5 text-[11.5px] text-ink-2">Text alternative to the map: every candidate, its status and whether it is recommended.</p>
      <ul className="scroll-thin max-h-[260px] divide-y divide-line overflow-y-auto rounded-md border border-line" data-testid="candidate-list">
        {sc.interventions.map((iv) => {
          const on = applied.includes(iv.id)
          const rec = a?.recommendation.selected.includes(iv.id)
          return (
            <li key={iv.id} className="flex items-center gap-2 px-2 py-1.5">
              <span className={`min-w-7 shrink-0 font-mono text-[11.5px] font-bold ${rec ? 'text-sel-ink' : 'text-ink-2'}`}>{iv.id}</span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-ink" title={iv.label}>
                {iv.label}
              </span>
              <span className={`shrink-0 rounded px-1 text-[10.5px] font-medium ${on ? 'bg-ok-bg text-ok-ink' : 'bg-bad-bg text-bad-ink'}`}>{on ? 'Repaired' : 'Blocked'}</span>
              <button className="btn-ghost px-1 py-0.5" onClick={() => { st.select({ type: 'intervention', id: iv.id }); st.cameraTo({ preset: 'intervention', id: iv.id }) }} aria-label={`Locate ${iv.id} on the map`}>
                <Crosshair size={13} />
              </button>
              {on ? (
                <button className="btn-ghost px-1 py-0.5" onClick={() => void st.remove(iv.id)} aria-label={`Remove repair ${iv.id}`} data-testid={`list-remove-${iv.id}`}>
                  <Undo2 size={13} />
                </button>
              ) : (
                <button className="btn-ghost px-1 py-0.5" onClick={() => void st.apply(iv.id)} aria-label={`Apply repair ${iv.id}`} data-testid={`list-apply-${iv.id}`}>
                  <Wrench size={13} />
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </Disclosure>
  )
}
