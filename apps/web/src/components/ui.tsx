import { CircleCheck, CircleDashed, CircleHelp, CircleSlash, Wrench } from 'lucide-react'
import type { ReactNode } from 'react'
import { useId, useState } from 'react'
import type { EffectiveState } from '../api/types'

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  testId,
  size = 'md',
}: {
  value: T
  options: { value: T; label: ReactNode; title?: string }[]
  onChange: (v: T) => void
  label: string
  testId?: string
  size?: 'sm' | 'md'
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-lg bg-wash p-0.5" data-testid={testId}>
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
            className={`flex-1 whitespace-nowrap rounded-md font-medium transition-colors ${size === 'sm' ? 'px-2 py-1 text-[12px]' : 'px-2.5 py-1.5 text-[13px]'} ${
              on ? 'bg-paper text-ink shadow-[0_1px_2px_rgba(30,50,40,0.14)]' : 'text-ink-2 hover:text-ink'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

const STATE: Record<EffectiveState, { label: string; cls: string; Icon: typeof CircleCheck }> = {
  traversable: { label: 'Traversable', cls: 'bg-wash text-ink-2', Icon: CircleCheck },
  repaired: { label: 'Repaired', cls: 'bg-ok-bg text-ok-ink', Icon: CircleCheck },
  blocked: { label: 'Blocked', cls: 'bg-bad-bg text-bad-ink', Icon: CircleSlash },
  repairable: { label: 'Blocked', cls: 'bg-bad-bg text-bad-ink', Icon: Wrench },
  unknown: { label: 'Unknown', cls: 'bg-unk-bg text-unk-ink', Icon: CircleHelp },
}

export function StateBadge({ state, label }: { state: EffectiveState; label?: string }) {
  const s = STATE[state] ?? { label: state, cls: 'bg-wash text-ink-2', Icon: CircleDashed }
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11.5px] font-medium ${s.cls}`}>
      <s.Icon size={12} strokeWidth={2.3} aria-hidden />
      {label ?? s.label}
    </span>
  )
}

export function Tip({ text, children, side = 'top' }: { text: string; children: ReactNode; side?: 'top' | 'bottom' | 'left' }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const pos = side === 'bottom' ? 'top-full mt-1.5 left-1/2 -translate-x-1/2' : side === 'left' ? 'right-full mr-2 top-1/2 -translate-y-1/2' : 'bottom-full mb-1.5 left-1/2 -translate-x-1/2'
  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>
      <span aria-describedby={id} className="inline-flex">
        {children}
      </span>
      <span
        id={id}
        role="tooltip"
        className={`pointer-events-none absolute z-50 w-max max-w-[240px] rounded-md bg-ink px-2 py-1 text-[11.5px] leading-snug font-normal tracking-normal text-white normal-case shadow-lg transition-opacity ${pos} ${open ? 'opacity-100' : 'opacity-0'}`}
      >
        {text}
      </span>
    </span>
  )
}

export function Disclosure({ title, children, testId, defaultOpen = false, right }: { title: ReactNode; children: ReactNode; testId?: string; defaultOpen?: boolean; right?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-t border-line">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center justify-between gap-2 py-2.5 text-left text-[13px] font-medium text-ink-2 hover:text-ink" data-testid={testId}>
        <span className="flex items-center gap-2">
          <svg width="10" height="10" viewBox="0 0 10 10" className={`transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden>
            <path d="M3 1.5 L7 5 L3 8.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {title}
        </span>
        {right}
      </button>
      {open && <div className="pb-3">{children}</div>}
    </div>
  )
}

export function Stat({ label, before, after, unit, testId }: { label: string; before?: ReactNode; after: ReactNode; unit?: string; testId?: string }) {
  return (
    <div className="min-w-0" data-testid={testId}>
      <div className="truncate text-[11.5px] text-ink-2">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1 font-semibold tnum text-ink">
        {before !== undefined && (
          <>
            <span className="text-[15px] text-ink-3">{before}</span>
            <span className="text-[12px] text-ink-3" aria-hidden>
              →
            </span>
          </>
        )}
        <span className="text-[17px]">{after}</span>
        {unit && <span className="text-[11.5px] font-medium text-ink-2">{unit}</span>}
      </div>
    </div>
  )
}
