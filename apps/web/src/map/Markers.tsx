import { Bus, Check, GraduationCap, House, Stethoscope } from 'lucide-react'
import type { Category } from '../api/types'
import { useApp } from '../state/store'

const CAT_ICON: Record<Category, typeof Bus> = { healthcare: Stethoscope, transit: Bus, education: GraduationCap }

export function CandidateMarker({ id }: { id: string }) {
  const iv = useApp((s) => s.scenario?.interventions.find((i) => i.id === id))
  const compare = useApp((s) => s.compare)
  const applied = useApp((s) => s.applied.includes(id))
  const highlighted = useApp((s) => s.highlight.includes(id))
  const recommended = useApp((s) => s.analysis?.recommendation.selected.includes(id) ?? false)
  const blocking = useApp((s) => {
    const j = s.evaluation?.journey
    if (!j || j.route.found || !iv) return false
    return j.potential_blockers.includes(id) || iv.edge_ids.some((e) => j.frontier_barriers.includes(e))
  })
  const isSel = useApp((s) => s.selected?.type === 'intervention' && s.selected.id === id)
  const select = useApp((s) => s.select)
  if (!iv) return null
  const repaired = applied && compare === 'current'
  const ring = isSel ? 'ring-2 ring-fg ring-offset-2 ring-offset-ink-900' : ''
  const tone = repaired
    ? 'bg-ok text-ink-900 border-ok'
    : recommended || highlighted
      ? 'bg-sel-dim text-fg border-sel'
      : 'bg-bad-dim text-bad border-bad/80'
  const pulse = !repaired && (recommended || highlighted) ? 'sm-pulse-blue' : !repaired && blocking ? 'sm-pulse' : ''
  return (
    <button
      type="button"
      className={`sm-marker grid h-[26px] min-w-[26px] place-items-center rounded-full border-2 px-1 font-mono text-[11px] font-bold shadow-lg shadow-black/40 transition-colors ${tone} ${ring} ${pulse}`}
      aria-label={`Candidate repair ${id}: ${iv.label}. ${repaired ? 'Repaired in simulation' : 'Blocked'}${recommended ? '. Recommended' : ''}.`}
      aria-pressed={isSel}
      data-testid={`candidate-${id}`}
      onClick={(e) => {
        e.stopPropagation()
        select({ type: 'intervention', id })
      }}
    >
      {repaired ? (
        <span className="flex items-center gap-0.5">
          <Check size={11} strokeWidth={3.5} aria-hidden />
          {id}
        </span>
      ) : (
        id
      )}
    </button>
  )
}

export function PlaceMarker({ id }: { id: string }) {
  const origin = useApp((s) => s.scenario?.origins.find((o) => o.id === id))
  const dest = useApp((s) => s.scenario?.destinations.find((d) => d.id === id))
  const journey = useApp((s) => s.journey)
  const reached = useApp((s) => (s.compare === 'before' ? s.initialEval : s.evaluation)?.journey?.reached_destinations.includes(id) ?? false)
  const routeFound = useApp((s) => (s.compare === 'before' ? s.initialEval : s.evaluation)?.journey?.route.found ?? false)
  const isSel = useApp((s) => s.selected?.type === 'place' && s.selected.id === id)
  const select = useApp((s) => s.select)
  const municipal = useApp((s) => s.scenario?.mode === 'municipal')
  const label = origin?.label ?? dest?.label ?? id
  const isOrigin = !!origin
  const inJourney = journey && (journey.origin === id || journey.destination === id)
  const Icon = isOrigin ? House : CAT_ICON[dest!.category]
  const isTarget = journey?.destination === id
  const base = isOrigin
    ? 'bg-ink-750 text-fg border-ink-400'
    : isTarget
      ? routeFound
        ? 'bg-ok text-ink-900 border-ok'
        : 'bg-ink-750 text-bad border-bad'
      : reached && journey
        ? 'bg-ink-750 text-ok border-ok/60'
        : 'bg-ink-750 text-fg-2 border-ink-400'
  const jRing = inJourney ? (isOrigin ? 'ring-2 ring-sel ring-offset-2 ring-offset-ink-900' : '') : ''
  const showLabel = !municipal || inJourney || isSel
  return (
    <button
      type="button"
      className="sm-marker group flex items-center gap-1.5"
      aria-label={`${isOrigin ? 'Origin' : 'Destination'}: ${label}${isTarget ? (routeFound ? ', reachable on the selected journey' : ', not reachable on the selected journey') : ''}`}
      data-testid={`place-${id}`}
      onClick={(e) => {
        e.stopPropagation()
        select({ type: 'place', id })
      }}
    >
      <span className={`grid h-7 w-7 place-items-center rounded-md border-[1.5px] shadow-lg shadow-black/50 ${base} ${jRing} ${isSel ? 'outline-2 outline-fg' : ''}`}>
        <Icon size={15} strokeWidth={2.2} aria-hidden />
      </span>
      {showLabel && (
        <span
          className={`max-w-[150px] truncate rounded bg-ink-900/80 px-1.5 py-0.5 text-[11px] font-medium leading-tight backdrop-blur-sm ${inJourney ? 'text-fg' : 'text-fg-2'} hidden sm:block`}
        >
          {label}
        </span>
      )}
    </button>
  )
}
