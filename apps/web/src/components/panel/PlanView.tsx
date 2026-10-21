import { ArrowRight, Bus, GraduationCap, Info, LoaderCircle, Stethoscope } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Category, Priority } from '../../api/types'
import { useApp } from '../../state/store'
import { Disclosure, Segmented, Tip } from '../ui'
import { Assistant } from './Assistant'

const CATS: { key: Category; label: string; Icon: typeof Bus }[] = [
  { key: 'healthcare', label: 'Healthcare', Icon: Stethoscope },
  { key: 'transit', label: 'Public transport', Icon: Bus },
  { key: 'education', label: 'Education', Icon: GraduationCap },
]

export function AdvancedSettings() {
  const weights = useApp((s) => s.weights)
  const cutoff = useApp((s) => s.cutoff)
  const budget = useApp((s) => s.budget)
  const { setWeights, setCutoff, setBudget } = useApp.getState()
  const v = cutoff ?? 800
  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 text-[12px] font-medium text-ink-2">Destination weights</div>
        {CATS.map(({ key, label, Icon }) => (
          <div key={key} className="grid grid-cols-[16px_1fr_92px_26px] items-center gap-2 py-0.5">
            <Icon size={13} className="text-ink-3" aria-hidden />
            <label htmlFor={`w-${key}`} className="text-[12.5px] text-ink">
              {label}
            </label>
            <input
              id={`w-${key}`}
              type="range"
              min={0}
              max={5}
              step={0.5}
              value={weights[key]}
              onChange={(e) => setWeights({ ...weights, [key]: Number(e.target.value) })}
              className="sm-range w-full"
              style={{ ['--fill' as string]: `${(weights[key] / 5) * 100}%` }}
              aria-valuetext={`weight ${weights[key]}`}
            />
            <span className="text-right font-mono text-[12px] tnum text-ink">{weights[key].toFixed(1)}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-[1fr_110px_48px] items-center gap-2">
        <label htmlFor="cutoff" className="flex items-center gap-1 text-[12.5px] text-ink">
          Access threshold
          <Tip text="A destination counts as reachable when the shortest modeled step-free route is no longer than this. A planning parameter, not a standard.">
            <Info size={12} className="text-ink-3" />
          </Tip>
        </label>
        <input id="cutoff" type="range" min={200} max={1500} step={50} value={v} onChange={(e) => setCutoff(Number(e.target.value))}
          className="sm-range w-full" style={{ ['--fill' as string]: `${((v - 200) / 1300) * 100}%` }} aria-valuetext={`${v} metres`} data-testid="cutoff" />
        <span className="text-right font-mono text-[12px] tnum text-ink">{v} m</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12.5px] text-ink">Larger budgets</span>
        <Segmented size="sm" label="Repair budget (extended)" value={budget} onChange={setBudget}
          options={[5, 6].map((n) => ({ value: n, label: <span className="font-mono">{n}</span> }))} />
      </div>
    </div>
  )
}

export function AnalyzeButton() {
  const analyzing = useApp((s) => s.analyzing)
  const err = useApp((s) => s.analysisError)
  const analyze = useApp((s) => s.analyze)
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!analyzing) return
    const t0 = performance.now()
    setElapsed(0)
    const id = setInterval(() => setElapsed((performance.now() - t0) / 1000), 250)
    return () => clearInterval(id)
  }, [analyzing])
  return (
    <div>
      <button className="btn-primary group w-full justify-between py-3 pl-5 pr-4 text-[14.5px]" onClick={() => void analyze()} disabled={analyzing} data-testid="analyze">
        <span>{analyzing ? `Evaluating combinations${elapsed >= 1 ? ` · ${elapsed.toFixed(0)} s` : '…'}` : 'Find the best repairs'}</span>
        <span className="grid h-7 w-7 place-items-center rounded-full bg-ok text-white transition-transform duration-300 group-hover:translate-x-0.5" aria-hidden>
          {analyzing ? <LoaderCircle size={15} className="animate-spin" /> : <ArrowRight size={15} strokeWidth={2.4} />}
        </span>
      </button>
      {err && (
        <p className="mt-2 text-[12px] text-bad-ink" role="alert">
          {err}
        </p>
      )}
    </div>
  )
}

export function PlanView() {
  const budget = useApp((s) => s.budget)
  const priority = useApp((s) => s.priority)
  const analysis = useApp((s) => s.analysis)
  const { setBudget, setPriority, setPanelView } = useApp.getState()
  return (
    <section aria-labelledby="plan-h" className="border-t border-line px-6 pt-5 pb-3">
      <h2 id="plan-h" className="display text-[24px] text-ink">
        What would you repair?
      </h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">StreetMend tests every combination of candidate repairs against access to essential destinations.</p>
      <div className="mt-5 space-y-4">
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="kicker">Repair budget</span>
            <span className="text-[12px] text-ink-3">{budget > 4 ? budget : budget} repair{budget === 1 ? '' : 's'}</span>
          </div>
          <Segmented label="Repair budget" value={budget > 4 ? 4 : budget} onChange={setBudget} testId="budget"
            options={[1, 2, 3, 4].map((n) => ({ value: n, label: <span className="tnum">{n}</span>, title: `${n} repair${n === 1 ? '' : 's'}` }))} />
        </div>
        <div>
          <div className="mb-1.5 kicker">What matters most</div>
          <Segmented<Priority | 'custom'> label="Destination priority" value={priority} onChange={(p) => p !== 'custom' && setPriority(p)} testId="priority" size="sm"
            options={[
              { value: 'healthcare', label: 'Healthcare' },
              { value: 'transit', label: 'Transit' },
              { value: 'education', label: 'Education' },
              { value: 'balanced', label: 'Balanced' },
            ]} />
          {priority === 'custom' && <p className="mt-1 text-[11.5px] text-ink-2">Custom weights (see Advanced).</p>}
        </div>
        <AnalyzeButton />
        {analysis && (
          <button className="btn-ghost w-full text-[12.5px]" onClick={() => setPanelView('results')}>
            Back to the last recommendation
          </button>
        )}
      </div>
      <div className="mt-4">
        <Disclosure title="Advanced" testId="toggle-advanced">
          <AdvancedSettings />
        </Disclosure>
        <Disclosure title="Ask a planning question" testId="toggle-assistant">
          <Assistant />
        </Disclosure>
      </div>
    </section>
  )
}
