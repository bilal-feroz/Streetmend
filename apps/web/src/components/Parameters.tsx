import { Bus, GraduationCap, Info, Stethoscope } from 'lucide-react'
import type { Category, Priority } from '../api/types'
import { PRESETS, useApp } from '../state/store'
import { Segmented, Tip } from './ui'

const CATS: { key: Category; label: string; Icon: typeof Bus }[] = [
  { key: 'healthcare', label: 'Healthcare', Icon: Stethoscope },
  { key: 'transit', label: 'Public transport', Icon: Bus },
  { key: 'education', label: 'Education', Icon: GraduationCap },
]

export function BudgetControl() {
  const budget = useApp((s) => s.budget)
  const n = useApp((s) => s.scenario?.candidate_count ?? 0)
  const setBudget = useApp((s) => s.setBudget)
  const max = Math.min(6, n)
  return (
    <div>
      <Segmented
        label="Repair budget (number of repairs)"
        value={budget}
        onChange={setBudget}
        testId="budget"
        options={Array.from({ length: max + 1 }, (_, i) => ({ value: i, label: <span className="font-mono">{i}</span>, title: `${i} repair${i === 1 ? '' : 's'}` }))}
      />
      <p className="mt-1.5 text-[11px] text-fg-3">Repair-count budget. No construction costs are modeled.</p>
    </div>
  )
}

export function PriorityControl() {
  const weights = useApp((s) => s.weights)
  const priority = useApp((s) => s.priority)
  const { setPriority, setWeights } = useApp.getState()
  return (
    <div>
      <Segmented<Priority | 'custom'>
        label="Priority preset"
        value={priority}
        onChange={(p) => p !== 'custom' && setPriority(p)}
        testId="priority"
        options={[
          { value: 'healthcare', label: 'Healthcare' },
          { value: 'transit', label: 'Transit' },
          { value: 'education', label: 'Education' },
          { value: 'balanced', label: 'Balanced' },
        ]}
      />
      <div className="mt-2.5 space-y-1.5">
        {CATS.map(({ key, label, Icon }) => {
          const v = weights[key]
          return (
            <div key={key} className="grid grid-cols-[18px_1fr_96px_28px] items-center gap-2">
              <Icon size={14} className="text-fg-3" aria-hidden />
              <label htmlFor={`w-${key}`} className="text-[12.5px] text-fg-2">
                {label}
              </label>
              <input
                id={`w-${key}`}
                type="range"
                min={0}
                max={5}
                step={0.5}
                value={v}
                onChange={(e) => setWeights({ ...weights, [key]: Number(e.target.value) })}
                className="sm-range w-full"
                style={{ ['--fill' as string]: `${(v / 5) * 100}%` }}
                aria-valuetext={`weight ${v}`}
              />
              <span className="text-right font-mono text-[12px] tnum text-fg">{v.toFixed(1)}</span>
            </div>
          )
        })}
      </div>
      {priority === 'custom' && (
        <p className="mt-1 text-[11px] text-fg-3">Custom weights. Presets: {Object.keys(PRESETS).join(', ')}.</p>
      )}
    </div>
  )
}

export function ThresholdControl() {
  const cutoff = useApp((s) => s.cutoff)
  const setCutoff = useApp((s) => s.setCutoff)
  const v = cutoff ?? 600
  return (
    <div className="grid grid-cols-[1fr_120px_52px] items-center gap-2">
      <label htmlFor="cutoff" className="flex items-center gap-1 text-[12.5px] text-fg-2">
        Access threshold
        <Tip text="A destination counts as reachable when the shortest modeled traversable route is no longer than this. A planning parameter, not a medical standard.">
          <Info size={12} className="text-fg-4" />
        </Tip>
      </label>
      <input
        id="cutoff"
        type="range"
        min={200}
        max={1500}
        step={50}
        value={v}
        onChange={(e) => setCutoff(Number(e.target.value))}
        className="sm-range w-full"
        style={{ ['--fill' as string]: `${((v - 200) / 1300) * 100}%` }}
        aria-valuetext={`${v} metres`}
        data-testid="cutoff"
      />
      <span className="text-right font-mono text-[12px] tnum text-fg">{v} m</span>
    </div>
  )
}
