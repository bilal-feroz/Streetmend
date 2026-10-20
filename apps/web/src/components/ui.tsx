import { CircleCheck, CircleDashed, CircleHelp, CircleX, Wrench } from 'lucide-react'
import type { ReactNode } from 'react'
import { useId, useState } from 'react'
import type { EffectiveState } from '../api/types'
import { STATE_LABEL } from '../lib/format'

const STATE_STYLE: Record<EffectiveState, { cls: string; Icon: typeof CircleCheck }> = {
  traversable: { cls: 'text-fg-2 border-ink-500 bg-ink-750', Icon: CircleCheck },
  repaired: { cls: 'text-ok border-ok/40 bg-ok-dim', Icon: CircleCheck },
  blocked: { cls: 'text-bad border-bad/40 bg-bad-dim', Icon: CircleX },
  repairable: { cls: 'text-bad border-bad/40 bg-bad-dim', Icon: Wrench },
  unknown: { cls: 'text-unk border-unk/40 bg-unk-dim', Icon: CircleHelp },
}

export function StateBadge({ state, short }: { state: EffectiveState; short?: boolean }) {
  const s = STATE_STYLE[state] ?? { cls: 'text-fg-2 border-ink-500', Icon: CircleDashed }
  const label = short ? { traversable: 'Traversable', repaired: 'Repaired', blocked: 'Blocked', repairable: 'Blocked', unknown: 'Unknown' }[state] : STATE_LABEL[state]
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-px text-[11px] font-medium ${s.cls}`}>
      <s.Icon size={11} strokeWidth={2.4} aria-hidden />
      {label}
    </span>
  )
}

export function Section({ title, step, right, children, id }: { title: string; step?: number; right?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="border-b border-ink-600/80 px-4 py-3.5" aria-labelledby={id}>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h2 id={id} className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-fg-2">
          {step !== undefined && (
            <span className="grid h-[18px] w-[18px] place-items-center rounded bg-ink-700 font-mono text-[10px] text-fg-3" aria-hidden>
              {step}
            </span>
          )}
          {title}
        </h2>
        {right}
      </div>
      {children}
    </section>
  )
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  testId,
}: {
  value: T
  options: { value: T; label: ReactNode; title?: string }[]
  onChange: (v: T) => void
  label: string
  testId?: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-md border border-ink-600 bg-ink-850 p-0.5" data-testid={testId}>
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={`flex-1 rounded-[5px] px-2 py-1 text-[12.5px] font-medium transition-colors ${on ? 'bg-ink-600 text-fg shadow-sm' : 'text-fg-3 hover:text-fg'}`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function Tip({ text, children }: { text: string; children: ReactNode }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>
      <span aria-describedby={id} tabIndex={0} className="inline-flex cursor-help">
        {children}
      </span>
      <span
        id={id}
        role="tooltip"
        className={`pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 w-56 -translate-x-1/2 rounded-md border border-ink-500 bg-ink-750 px-2.5 py-1.5 text-[11.5px] font-normal normal-case leading-snug tracking-normal text-fg-2 shadow-xl transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`}
      >
        {text}
      </span>
    </span>
  )
}

export function Metric({ label, value, sub, tone = 'fg', srLabel }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'fg' | 'ok' | 'bad' | 'unk' | 'sel'; srLabel?: string }) {
  const color = { fg: 'text-fg', ok: 'text-ok', bad: 'text-bad', unk: 'text-unk', sel: 'text-sel-2' }[tone]
  return (
    <div className="min-w-0" aria-label={srLabel}>
      <div className="label-xs truncate">{label}</div>
      <div className={`mt-0.5 font-mono text-[17px] font-semibold tnum leading-tight ${color}`}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-fg-3">{sub}</div>}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-ink-500 bg-ink-750 px-1 font-mono text-[10px] text-fg-3">{children}</kbd>
}
