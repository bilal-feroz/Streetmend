import { motion } from 'motion/react'
import { Check, Crosshair, Download, LoaderCircle, Play, RefreshCw, TriangleAlert, Undo2, Wrench } from 'lucide-react'
import { useState } from 'react'
import { api } from '../api/client'
import { CATEGORY_LABEL, fmtM, fmtNum, SOLVER_LABEL } from '../lib/format'
import { isAnalysisStale, useApp } from '../state/store'
import { Metric, StateBadge } from './ui'

export function NetworkSummary() {
  const ev = useApp((s) => s.evaluation)
  const sc = useApp((s) => s.scenario)
  if (!ev || !sc) return <div className="h-14 animate-pulse rounded-md bg-ink-800" />
  const c = ev.state_counts
  const blocked = (c.blocked ?? 0) + (c.repairable ?? 0)
  return (
    <div>
      <div className="grid grid-cols-4 gap-2">
        <Metric label="Traversable" value={fmtNum((c.traversable ?? 0) + (c.repaired ?? 0))} sub="edges" srLabel={`${(c.traversable ?? 0) + (c.repaired ?? 0)} traversable edges`} />
        <Metric label="Blocked" value={fmtNum(blocked)} tone="bad" sub="edges" />
        <Metric label="Unknown" value={fmtNum(c.unknown ?? 0)} tone="unk" sub="excluded" />
        <Metric label="Candidates" value={fmtNum(sc.candidate_count)} tone="sel" sub="repairs" />
      </div>
      <div className="mt-2.5 flex items-center justify-between rounded-md bg-ink-850 px-2.5 py-1.5 text-[12px]">
        <span className="text-fg-3">Connected origin–destination pairs</span>
        <span className="font-mono tnum text-fg" data-testid="connected-pairs">
          {ev.metrics.connected_pairs} / {ev.metrics.total_pairs}
        </span>
      </div>
    </div>
  )
}

export function AnalyzeButton() {
  const analyzing = useApp((s) => s.analyzing)
  const analysis = useApp((s) => s.analysis)
  const stale = useApp(isAnalysisStale)
  const err = useApp((s) => s.analysisError)
  const analyze = useApp((s) => s.analyze)
  return (
    <div>
      <button className="btn-primary w-full py-2.5 text-[14px]" onClick={() => void analyze()} disabled={analyzing} data-testid="analyze">
        {analyzing ? <LoaderCircle size={16} className="animate-spin" /> : analysis && !stale ? <RefreshCw size={15} /> : <Play size={15} />}
        {analyzing ? 'Evaluating repair combinations…' : analysis ? 'Re-run analysis' : 'Analyze network'}
      </button>
      {err && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-bad" role="alert">
          <TriangleAlert size={13} className="mt-px shrink-0" /> {err}
        </p>
      )}
      {analysis && (
        <p className="mt-1.5 text-center font-mono text-[11px] text-fg-3" data-testid="solver-meta">
          {analysis.recommendation.exact ? 'Exact enumeration' : 'Beam search (approximate)'} · {fmtNum(analysis.recommendation.evaluations)} combinations ·{' '}
          {analysis.recommendation.considered_count}/{analysis.recommendation.candidate_count} candidates · {analysis.recommendation.runtime_ms.toFixed(1)} ms
        </p>
      )}
    </div>
  )
}

export function Recommendations() {
  const analysis = useApp((s) => s.analysis)
  const applied = useApp((s) => s.applied)
  const sc = useApp((s) => s.scenario)
  const { apply, remove, select, focusOn } = useApp.getState()
  if (!analysis || !sc) return <p className="text-[12.5px] text-fg-3">Run the analysis to see which combination of repairs reconnects the most weighted journeys.</p>
  const rec = analysis.recommendation
  if (!rec.selected.length)
    return <p className="text-[12.5px] text-fg-2">{analysis.explanation[0]}</p>
  return (
    <ol className="space-y-2" data-testid="recommendations">
      {rec.selected.map((id, idx) => {
        const iv = sc.interventions.find((i) => i.id === id)!
        const c = analysis.contributions.find((x) => x.id === id)
        const on = applied.includes(id)
        return (
          <motion.li
            key={id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.12 }}
            className={`card p-2.5 ${on ? 'border-ok/40' : ''}`}
            data-testid={`rec-${id}`}
          >
            <div className="flex items-start gap-2.5">
              <button
                className={`grid h-7 min-w-7 shrink-0 place-items-center rounded-full border-2 font-mono text-[12px] font-bold ${on ? 'border-ok bg-ok text-ink-900' : 'border-sel bg-sel-dim text-fg'}`}
                onClick={() => {
                  select({ type: 'intervention', id })
                  focusOn({ kind: 'intervention', id })
                }}
                aria-label={`Show repair ${id} on the map`}
              >
                {on ? <Check size={13} strokeWidth={3} /> : id}
              </button>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium leading-snug text-fg">{iv.label}</div>
                <div className="mt-0.5 text-[11.5px] leading-snug text-fg-3">{iv.description}</div>
                {c && (
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] tnum">
                    <span className={c.alone_gain > 0 ? 'text-fg-2' : 'text-bad'}>alone +{fmtNum(c.alone_gain, 1)}</span>
                    <span className="text-ok">in set +{fmtNum(c.marginal_in_set, 1)}</span>
                  </div>
                )}
              </div>
              <div className="flex shrink-0 flex-col gap-1">
                {on ? (
                  <button className="btn-secondary px-2 py-1 text-[12px]" onClick={() => void remove(id)} data-testid={`remove-${id}`}>
                    <Undo2 size={12} /> Undo
                  </button>
                ) : (
                  <button className="btn-primary px-2 py-1 text-[12px]" onClick={() => void apply(id)} data-testid={`apply-${id}`}>
                    <Wrench size={12} /> Apply
                  </button>
                )}
              </div>
            </div>
          </motion.li>
        )
      })}
    </ol>
  )
}

export function CombinedEffect() {
  const analysis = useApp((s) => s.analysis)
  if (!analysis || !analysis.recommendation.selected.length) return null
  const contrib = analysis.contributions
  const together = analysis.objective.gain
  const max = Math.max(together, ...contrib.map((c) => c.alone_gain), 1)
  const rows = [
    ...contrib.map((c) => ({ key: c.id, label: `${c.id} alone`, v: c.alone_gain, tone: c.alone_gain > 0 ? 'bg-fg-3' : 'bg-bad' })),
    { key: 'all', label: contrib.length > 1 ? `${contrib.map((c) => c.id).join(' + ')} together` : 'Selected', v: together, tone: 'bg-ok' },
  ]
  return (
    <div data-testid="combined-effect">
      <div className="space-y-1.5" role="img" aria-label={rows.map((r) => `${r.label}: ${fmtNum(r.v, 1)}`).join('; ')}>
        {rows.map((r, i) => (
          <div key={r.key} className="grid grid-cols-[112px_1fr_44px] items-center gap-2">
            <span className="truncate font-mono text-[11.5px] text-fg-2">{r.label}</span>
            <div className="h-2.5 overflow-hidden rounded-sm bg-ink-700">
              <motion.div
                className={`h-full rounded-sm ${r.tone}`}
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(r.v > 0 ? 2 : 0, (r.v / max) * 100)}%` }}
                transition={{ duration: 0.7, delay: 0.15 * i, ease: 'easeOut' }}
              />
            </div>
            <span className="text-right font-mono text-[12px] tnum text-fg">+{fmtNum(r.v, 1)}</span>
          </div>
        ))}
      </div>
      {analysis.synergy > 0 && (
        <p className="mt-2 rounded-md border border-ok/25 bg-ok-dim/50 px-2.5 py-1.5 text-[12px] leading-snug text-fg-2">
          <span className="font-semibold text-ok">Synergy +{fmtNum(analysis.synergy, 1)}</span> — value that exists only when these repairs are made together.
        </p>
      )}
      <ul className="mt-2 space-y-1 text-[12.5px] leading-snug text-fg-2" data-testid="explanation">
        {analysis.explanation.slice(1).map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  )
}

export function Impact() {
  const analysis = useApp((s) => s.analysis)
  const ev = useApp((s) => s.evaluation)
  const init = useApp((s) => s.initialEval)
  const applied = useApp((s) => s.applied)
  const scenarioId = useApp((s) => s.scenarioId)
  const budget = useApp((s) => s.budget)
  const weights = useApp((s) => s.weights)
  const cutoff = useApp((s) => s.cutoff)
  const [exporting, setExporting] = useState(false)
  if (!analysis) return null
  const o = analysis.objective
  const route = ev?.journey?.route
  const exportReport = async () => {
    setExporting(true)
    try {
      const md = await api.report(scenarioId, applied, { budget, weights, cutoff_m: cutoff })
      const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `streetmend-${scenarioId}-report.md`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }
  const best = Math.max(...analysis.baselines.map((b) => b.gain), analysis.recommendation.gain, 1)
  const solvers = [analysis.recommendation, ...analysis.baselines]
  return (
    <div className="space-y-3" data-testid="impact">
      <div className="grid grid-cols-3 gap-2">
        <Metric label="Objective" value={<span>{fmtNum(o.before, 1)}→<span className="text-ok">{fmtNum(o.after, 1)}</span></span>} sub={o.relative_gain === null ? 'baseline 0: no % shown' : `+${fmtNum(o.relative_gain * 100)}%`} />
        <Metric label="O-D pairs" value={<span>{o.connected_pairs_before}→<span className="text-ok">{o.connected_pairs_after}</span></span>} sub={`of ${o.total_pairs}`} />
        <Metric label="New pairs" value={`+${analysis.newly_connected_pairs.length}`} tone="ok" sub={`${analysis.newly_reachable_destinations.length} new destinations`} />
      </div>

      <div>
        <div className="label-xs mb-1.5">Comparison with baselines (objective gain)</div>
        <div className="space-y-1.5" data-testid="baselines">
          {solvers.map((b, i) => (
            <div key={b.solver} className="grid grid-cols-[132px_1fr_40px] items-center gap-2">
              <span className={`truncate text-[11.5px] ${i === 0 ? 'font-semibold text-fg' : 'text-fg-2'}`} title={b.notes.join(' ')}>
                {SOLVER_LABEL[b.solver] ?? b.solver}
              </span>
              <div className="relative h-4 overflow-hidden rounded-sm bg-ink-700">
                <motion.div
                  className={`absolute inset-y-0 left-0 ${i === 0 ? 'bg-sel' : 'bg-ink-400'}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${(b.gain / best) * 100}%` }}
                  transition={{ duration: 0.6, delay: i * 0.08 }}
                />
                <span className="absolute inset-y-0 left-1.5 flex items-center font-mono text-[10px] text-fg">{b.selected.join(' ') || '—'}</span>
              </div>
              <span className="text-right font-mono text-[12px] tnum text-fg">+{fmtNum(b.gain, 1)}</span>
            </div>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-fg-3">
          {analysis.advantage_over_best_baseline > 0
            ? `Combination-aware selection scores ${fmtNum(analysis.advantage_over_best_baseline, 1)} higher than the best baseline here.`
            : 'Here a simple baseline already matches the optimum: the repairs act independently.'}
        </p>
      </div>

      {analysis.newly_connected_pairs.length > 0 && (
        <div>
          <div className="label-xs mb-1.5">Newly connected journeys</div>
          <ul className="divide-y divide-ink-600 rounded-md border border-ink-600" data-testid="new-pairs">
            {analysis.newly_connected_pairs.slice(0, 8).map((p) => (
              <li key={p.origin + p.destination} className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-[12px]">
                <span className="min-w-0 truncate text-fg-2">
                  {p.origin_label} <span className="text-fg-4">→</span> {p.destination_label}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-ok">{fmtM(p.after_m)}</span>
              </li>
            ))}
            {analysis.newly_connected_pairs.length > 8 && (
              <li className="px-2.5 py-1.5 text-[11px] text-fg-3">+{analysis.newly_connected_pairs.length - 8} more</li>
            )}
          </ul>
        </div>
      )}

      <div className="flex items-center justify-between rounded-md bg-ink-850 px-2.5 py-2 text-[12px]">
        <span className="text-fg-3">
          Map state: {applied.length} repair{applied.length === 1 ? '' : 's'} applied · objective {fmtNum(ev?.metrics.score, 1)}
          {init && ` (was ${fmtNum(init.metrics.score, 1)})`}
        </span>
        <span className={`font-mono ${route?.found ? 'text-ok' : 'text-bad'}`}>{route?.found ? fmtM(route.length_m) : 'no route'}</span>
      </div>

      <div className="flex gap-2">
        <button className="btn-secondary flex-1" onClick={() => void exportReport()} disabled={exporting} data-testid="export">
          {exporting ? <LoaderCircle size={14} className="animate-spin" /> : <Download size={14} />} Export report (.md)
        </button>
      </div>

      {analysis.sensitivity.unknown_edge_count > 0 && (
        <p className="text-[11.5px] leading-snug text-fg-3">
          <span className="text-unk">Sensitivity:</span> if all {analysis.sensitivity.unknown_edge_count} unknown-condition edges were traversable, the optimum would be{' '}
          <span className="font-mono text-fg-2">{analysis.sensitivity.optimal_selected.join(', ') || 'none'}</span>
          {analysis.sensitivity.recommendation_changes ? ' — the recommendation depends on unverified conditions.' : ' — the recommendation is unchanged.'}
        </p>
      )}
    </div>
  )
}

export function CandidateList() {
  const sc = useApp((s) => s.scenario)
  const applied = useApp((s) => s.applied)
  const analysis = useApp((s) => s.analysis)
  const { apply, remove, select, focusOn } = useApp.getState()
  if (!sc) return null
  return (
    <div>
      <p className="mb-2 text-[11.5px] text-fg-3">Text alternative to the map: every repair candidate, its status and modeled role.</p>
      <ul className="divide-y divide-ink-600 rounded-md border border-ink-600" data-testid="candidate-list">
        {sc.interventions.map((iv) => {
          const on = applied.includes(iv.id)
          const rec = analysis?.recommendation.selected.includes(iv.id)
          return (
            <li key={iv.id} className="flex items-center gap-2 px-2.5 py-1.5">
              <span className={`w-7 shrink-0 font-mono text-[12px] font-bold ${rec ? 'text-sel-2' : 'text-fg-2'}`}>{iv.id}</span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-fg-2" title={iv.label}>
                {iv.label}
              </span>
              <StateBadge state={on ? 'repaired' : 'repairable'} short />
              <button className="btn-ghost px-1.5 py-0.5" onClick={() => { select({ type: 'intervention', id: iv.id }); focusOn({ kind: 'intervention', id: iv.id }) }} aria-label={`Locate ${iv.id} on the map`}>
                <Crosshair size={13} />
              </button>
              {on ? (
                <button className="btn-ghost px-1.5 py-0.5 text-[11.5px]" onClick={() => void remove(iv.id)} aria-label={`Remove repair ${iv.id}`}>
                  <Undo2 size={13} />
                </button>
              ) : (
                <button className="btn-ghost px-1.5 py-0.5 text-[11.5px]" onClick={() => void apply(iv.id)} aria-label={`Apply repair ${iv.id}`} data-testid={`list-apply-${iv.id}`}>
                  <Wrench size={13} />
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {analysis && analysis.newly_reachable_destinations.length > 0 && (
        <p className="mt-2 text-[11.5px] text-fg-3">
          Recommendation makes reachable for the first time:{' '}
          {analysis.newly_reachable_destinations.map((d) => `${d.label} (${CATEGORY_LABEL[d.category]})`).join(', ')}.
        </p>
      )}
    </div>
  )
}
