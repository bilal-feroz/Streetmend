import { Check, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { EvaluateResponse } from '../../api/types'
import { useApp } from '../../state/store'

interface Step {
  key: string
  label: string
  title: string
  ids: string[]
  status: string
  ok: boolean | null
  result?: boolean
}

// Engine evaluations of each step, cached per scenario, journey and parameters.
const cache = new Map<string, Promise<EvaluateResponse | null>>()

/**
 * The story of a broken journey in four steps: Before, the first repair, both
 * repairs, and the measured result. Every status is computed by the engine
 * (one evaluate call per step, for the repairs that break this journey), and
 * each step can be clicked to put the map in that state.
 */
export function StoryStrip() {
  const sc = useApp((s) => s.scenario)
  const scenarioId = useApp((s) => s.scenarioId)
  const journey = useApp((s) => s.journey)
  const initial = useApp((s) => s.initialEval)
  const weights = useApp((s) => s.weights)
  const cutoff = useApp((s) => s.cutoff)
  const applied = useApp((s) => s.applied)
  const compare = useApp((s) => s.compare)
  const [evals, setEvals] = useState<(EvaluateResponse | null)[] | null>(null)

  const j = initial?.journey
  const blockers = j && !j.route.found ? [...new Set(j.potential_blockers)] : []
  const usable = blockers.length >= 1 && blockers.length <= 3
  const prefixes = usable ? blockers.map((_, i) => blockers.slice(0, i + 1)) : []
  const key = JSON.stringify([scenarioId, journey, weights, cutoff, blockers])

  useEffect(() => {
    if (!usable || !journey) {
      setEvals(null)
      return
    }
    let live = true
    setEvals(null)
    Promise.all(
      prefixes.map((ids) => {
        const k = `${key}|${ids.join(',')}`
        if (!cache.has(k)) {
          cache.set(k, api.evaluate(scenarioId, { applied: ids, origin: journey.origin, destination: journey.destination, weights, cutoff_m: cutoff }).catch(() => null))
        }
        return cache.get(k)!
      }),
    ).then((r) => live && setEvals(r))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (!sc || !usable || !initial) return null
  const short = blockers.every((b) => b.length <= 2)
  const name = (ids: string[]) => (short ? (ids.length === 1 ? `Repair ${ids[0]}` : ids.join(' + ')) : ids.length === 1 ? 'Repair 1' : `Repairs 1–${ids.length}`)
  const last = evals?.[evals.length - 1] ?? null
  const gain = last ? last.metrics.connected_pairs - initial.metrics.connected_pairs : null
  const steps: Step[] = [
    { key: 'before', label: 'Before', title: 'The journey before any repair', ids: [], status: 'Disconnected', ok: false },
    ...prefixes.map((ids, i) => {
      const ev = evals?.[i]
      const found = ev ? ev.journey?.route.found ?? false : null
      return {
        key: ids.join('+'),
        label: name(ids),
        title: `With ${ids.join(' and ')} repaired`,
        ids,
        status: found === null ? '…' : found ? 'Connected' : 'Still disconnected',
        ok: found,
      }
    }),
    {
      key: 'result',
      label: 'Result',
      title: 'Before and after, side by side',
      ids: blockers,
      status: gain === null ? '…' : `${gain >= 0 ? '+' : ''}${gain} journeys`,
      ok: gain === null ? null : gain > 0,
      result: true,
    },
  ]
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x))
  const active = steps.findIndex((s) => (s.result ? same(applied, s.ids) && compare === 'split' : same(applied, s.ids) && !(compare === 'split' && s.ids.length === blockers.length)))
  const go = async (s: Step) => {
    const st = useApp.getState()
    if (!s.result && st.compare !== 'off') st.setCompare('off')
    await st.setRepairs(s.ids)
    if (s.result) useApp.getState().setCompare('split')
  }

  return (
    <nav aria-label="The repair story" className="mt-5" data-testid="story">
      <ol className="relative grid" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((s, i) => {
          const on = i === active
          const nextOk = steps[i + 1]?.ok
          return (
            <li key={s.key} className="relative">
              {i < steps.length - 1 && (
                <span
                  aria-hidden
                  className={`absolute top-[13px] left-[calc(50%+15px)] right-[calc(-50%+15px)] h-[2px] rounded-full ${nextOk === null ? 'bg-line-2' : nextOk ? 'bg-ok' : 'bg-[repeating-linear-gradient(90deg,var(--color-bad)_0_5px,transparent_5px_9px)]'}`}
                />
              )}
              <button
                className="group flex w-full flex-col items-center gap-1.5 rounded-lg px-0.5 pb-1 text-center"
                onClick={() => void go(s)}
                aria-current={on ? 'step' : undefined}
                title={s.title}
                data-testid={`story-${s.result ? 'result' : s.ids.length}`}
              >
                <span
                  className={`grid h-7 w-7 place-items-center rounded-full transition-[box-shadow,transform] duration-300 group-hover:scale-105 ${
                    s.ok === null ? 'border-2 border-line-2 bg-paper' : s.ok ? 'bg-ok text-white' : 'border-2 border-bad bg-paper text-bad'
                  } ${on ? (s.ok ? 'shadow-[0_0_0_4px_rgba(8,127,99,0.18)]' : 'shadow-[0_0_0_4px_rgba(218,90,80,0.18)]') : ''}`}
                  aria-hidden
                >
                  {s.result ? <Plus size={14} strokeWidth={3} /> : s.ok ? <Check size={14} strokeWidth={3} /> : <span className="h-[2.5px] w-2.5 rounded bg-bad" />}
                </span>
                <span className={`text-[12px] leading-tight ${on ? 'font-extrabold text-ink' : 'font-semibold text-ink-2'}`}>{s.label}</span>
                <span className={`text-[11px] leading-tight font-semibold tnum ${s.ok === null ? 'text-ink-3' : s.ok ? 'text-ok-ink' : 'text-bad-ink'}`}>{s.status}</span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
