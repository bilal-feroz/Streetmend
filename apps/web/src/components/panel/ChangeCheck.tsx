import { Check, CircleAlert, CircleCheck, CircleHelp, Construction, LoaderCircle, Plus, RotateCcw, Search, ShieldCheck, Wrench, X } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CheckOut, CheckStatus, Counterexample, FixResponse, ProposalSpec, VerifyResponse, VerifyState } from '../../api/types'
import { useApp } from '../../state/store'
import { Disclosure } from '../ui'
import { Assistant } from './Assistant'

const EASE = [0.22, 1, 0.36, 1] as const

const STATUS: Record<CheckStatus, { cls: string; Icon: typeof Check; word: string }> = {
  PASS: { cls: 'bg-ok-bg text-ok-ink', Icon: CircleCheck, word: 'Pass' },
  FAIL: { cls: 'bg-bad-bg text-bad-ink', Icon: CircleAlert, word: 'Fail' },
  INCONCLUSIVE: { cls: 'bg-unk-bg text-unk-ink', Icon: CircleHelp, word: 'Inconclusive' },
}

function Pill({ status }: { status: CheckStatus }) {
  const s = STATUS[status]
  return (
    <span className={`inline-flex w-[104px] shrink-0 items-center justify-center gap-1 rounded-md py-[3px] text-[10.5px] font-extrabold tracking-[0.08em] uppercase ${s.cls}`} data-status={status}>
      <s.Icon size={12} strokeWidth={2.6} aria-hidden /> {s.word}
    </span>
  )
}

const short = (label: string) => label.split(' (')[0].replace('Homes along ', '')
const plain = (d: string) => (/hospital|medical center/i.test(d) ? 'the hospital' : d)

/** Short name of a check, for tables. */
function checkName(c: Pick<CheckOut, 'kind' | 'profile'>) {
  if (c.kind === 'detour') return 'Detour limit'
  if (c.kind === 'share') return 'Journeys kept'
  if (c.kind === 'category') return 'Bus stop access'
  return c.profile === 'step_free' ? 'Step-free route' : 'Walking route'
}

// ---- the five-stage pipeline ------------------------------------------------------------
function Pipeline() {
  const draft = useApp((s) => s.draft.length)
  const v = useApp((s) => s.verify)
  const fix = useApp((s) => s.fix)
  const stage = useApp((s) => s.checkStage)
  const regress = (v?.fixed ?? v?.proposed)?.regressions.length ?? 0
  const broke = !!v && (v.proposed.regressions.length > 0)
  const steps: { k: string; label: string; state: 'todo' | 'done' | 'bad' | 'now' }[] = [
    { k: 'propose', label: 'Propose', state: draft ? 'done' : 'now' },
    { k: 'test', label: 'Test', state: v ? 'done' : draft ? 'now' : 'todo' },
    { k: 'break', label: 'Break', state: !v ? 'todo' : broke ? 'bad' : 'done' },
    { k: 'fix', label: 'Fix', state: fix?.status === 'found' ? 'done' : broke ? 'now' : 'todo' },
    { k: 'verify', label: 'Verify', state: stage === 'fixed' && !regress ? 'done' : fix?.status === 'found' ? (regress ? 'bad' : 'now') : 'todo' },
  ]
  return (
    <ol className="mt-4 flex items-center gap-1" aria-label="Verification pipeline" data-testid="pipeline">
      {steps.map((s, i) => (
        <li key={s.k} className="flex min-w-0 flex-1 items-center gap-1">
          <span
            className={`flex h-7 min-w-0 flex-1 items-center justify-center gap-0.5 rounded-md px-0.5 text-[9.5px] font-extrabold tracking-normal uppercase transition-colors ${
              s.state === 'done' ? 'bg-ok-bg text-ok-ink' : s.state === 'bad' ? 'bg-bad-bg text-bad-ink' : s.state === 'now' ? 'bg-ink text-white' : 'bg-wash text-ink-3'
            }`}
            aria-current={s.state === 'now' ? 'step' : undefined}
          >
            {s.state === 'done' && <Check size={10} strokeWidth={3.4} className="shrink-0" aria-hidden />}
            {s.state === 'bad' && <X size={10} strokeWidth={3.4} className="shrink-0" aria-hidden />}
            <span className="truncate">{s.label}</span>
          </span>
          {i < steps.length - 1 && <span className="h-px w-1 shrink-0 bg-line-2" aria-hidden />}
        </li>
      ))}
    </ol>
  )
}

// ---- header -----------------------------------------------------------------------------
function CaseHeader() {
  const sc = useApp((s) => s.scenario)
  const journey = useApp((s) => s.journey)
  const ev = useApp((s) => s.evaluation)
  const v = useApp((s) => s.verify)
  const stage = useApp((s) => s.checkStage)
  const draft = useApp((s) => s.draft.length)
  if (!sc || !journey) return null
  const places = [...sc.origins, ...sc.destinations]
  const who = short(places.find((p) => p.id === journey.origin)?.label ?? 'These homes')
  const dest = places.find((p) => p.id === journey.destination)?.label ?? 'the destination'
  const where = plain(dest)
  const route = ev?.journey?.route
  const proposed = v?.proposed
  const ce = proposed?.checks.find((c) => c.regression && c.profile === 'step_free')?.counterexample
  let title: string
  let sub: string
  if (stage === 'fixed' && v?.fixed && !v.fixed.regressions.length) {
    const n = v.fixed.applied.length
    title = `${n === 2 ? 'Two temporary changes' : `${n} change${n === 1 ? '' : 's'}`} keep ${where} in reach.`
    sub = `Verified on the recomputed network: all ${v.fixed.checks.length} access checks pass with the closure in place.`
  } else if (stage === 'fixed' && v?.fixed) {
    title = 'Not fixed: a check fails again.'
    sub = `${v.fixed.regressions.length} check${v.fixed.regressions.length === 1 ? '' : 's'} fail on the recomputed network.`
  } else if (proposed && proposed.regressions.length) {
    title = ce?.walking_route?.found ? `Walkers still get through. Step-free travellers lose ${where}.` : `The change cuts the route to ${where}.`
    sub = ce?.summary.split('. ')[0] + '.'
  } else if (proposed) {
    title = 'This change keeps every checked journey intact.'
    sub = `All ${proposed.checks.length} access checks pass on the proposed network.`
  } else if (draft) {
    title = 'A change is proposed. What will it break?'
    sub = 'The proposal applies to a separate proposed network. Today’s network is unchanged until you test it.'
  } else {
    title = route?.found ? `Today, homes on ${who} have a ${Math.round(route.length_m ?? 0)} m step-free route to ${where}.` : `Today, homes on ${who} have no step-free route to ${where}.`
    sub = 'Propose a street change and StreetMend tests it before it is built: what breaks, for whom, and the smallest fix.'
  }
  const chip = stage === 'fixed' && v?.fixed && !v.fixed.regressions.length
    ? { t: 'Check passed', c: 'bg-ok-bg text-ok-ink', I: ShieldCheck }
    : proposed?.regressions.length || (stage === 'fixed' && v?.fixed?.regressions.length)
      ? { t: 'Regression', c: 'bg-bad-bg text-bad-ink', I: CircleAlert }
      : route?.found
        ? { t: 'Route available in model', c: 'bg-ok-bg text-ok-ink', I: CircleCheck }
        : { t: 'No route in model', c: 'bg-bad-bg text-bad-ink', I: CircleAlert }
  return (
    <section className="px-6 pt-5 pb-4" data-testid="check-header">
      <div className="flex items-center justify-between gap-2">
        <div className="eyebrow">Change check</div>
        <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-[3px] text-[10.5px] font-bold tracking-[0.08em] uppercase ${chip.c}`} data-testid="check-chip">
          <chip.I size={12} strokeWidth={2.6} aria-hidden /> {chip.t}
        </span>
      </div>
      <h2 className="display mt-2.5 text-balance text-[clamp(24px,2vw,29px)] text-ink" data-testid="check-title">
        {title}
      </h2>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{sub}</p>
      <Pipeline />
    </section>
  )
}

// ---- 1. propose -------------------------------------------------------------------------
function ProposalSection() {
  const sc = useApp((s) => s.scenario)
  const draft = useApp((s) => s.draft)
  const changes = useApp((s) => s.changes)
  const busy = useApp((s) => s.checkBusy)
  const v = useApp((s) => s.verify)
  const { proposeChange, withdrawChange, runChecks } = useApp.getState()
  const proposals = ((sc?.context.verify as { proposals?: ProposalSpec[] } | undefined)?.proposals ?? []).filter((p) => !p.changes.every((c) => draft.some((d) => d.edge_id === c.edge_id)))
  const dirty = JSON.stringify(draft) !== JSON.stringify(changes) || !v
  return (
    <section className="border-t border-line px-6 py-4" aria-labelledby="prop-h">
      <h3 id="prop-h" className="kicker flex items-center gap-1.5">
        <span className="grid h-5 w-5 place-items-center rounded-full bg-ink text-[10px] font-extrabold text-white">1</span> Proposed change
      </h3>
      {draft.length > 0 && (
        <ul className="mt-2.5 space-y-2" data-testid="draft">
          {draft.map((c) => (
            <li key={c.id} className="flex items-start gap-3 rounded-xl border border-[#e3a24a]/60 bg-[#fdf6ea] p-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[repeating-linear-gradient(135deg,#e07b2e_0_5px,#fff_5px_10px)]" aria-hidden>
                <Construction size={15} className="rounded bg-white/90 p-px text-[#9a4a12]" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] leading-snug font-bold text-ink">{c.label}</div>
                <div className="mt-0.5 text-[11.5px] font-semibold text-[#8a4b16]">Hypothetical proposal · {c.op === 'close' ? 'closes this link for everyone' : 'opens this link'}</div>
              </div>
              <button className="btn-ghost -mr-1 px-1.5" onClick={() => withdrawChange(c.id)} aria-label={`Withdraw ${c.label}`}>
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {proposals.length > 0 && (
        <div className="mt-2.5 space-y-1.5">
          {proposals.map((p) => (
            <button key={p.id} className="flex w-full items-center gap-3 rounded-xl border border-dashed border-line-2 bg-paper px-3 py-2.5 text-left hover:border-ink/40 hover:bg-wash" onClick={() => proposeChange(p)} data-testid={`propose-${p.id}`}>
              <Plus size={15} className="shrink-0 text-ink-2" aria-hidden />
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-ink">{p.label}</span>
                <span className="block text-[11.5px] text-ink-3">{p.reason}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      <p className="mt-2 text-[11.5px] text-ink-3">Or select any sidewalk or crossing on the map and choose “Propose closure”.</p>
      {draft.length > 0 && dirty && (
        <button className="btn-primary group mt-3 w-full justify-between py-3 pl-5 pr-4" onClick={() => void runChecks()} disabled={busy !== null} data-testid="run-checks">
          <span>{busy === 'checks' ? 'Running access checks…' : 'Run access checks'}</span>
          <span className="grid h-7 w-7 place-items-center rounded-full bg-ok text-white" aria-hidden>
            {busy === 'checks' ? <LoaderCircle size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
          </span>
        </button>
      )}
    </section>
  )
}

// ---- 2. checks + counterexample ---------------------------------------------------------
function CounterexampleCard({ ce, limit }: { ce: Counterexample; limit: number | null }) {
  const walk = ce.walking_route
  const alt = ce.best_alternative
  const closure = ce.broken_edges.find((b) => b.change) ?? ce.broken_edges[0]
  const rows: [string, string, 'ok' | 'bad' | 'warn'][] = [
    ['Today', `${Math.round(ce.baseline_route.length_m ?? 0)} m step-free route`, 'ok'],
    ['Breaks at', closure ? closure.label : 'a link the proposal removes', 'bad'],
  ]
  if (walk) rows.push(['Walking', walk.found ? `${Math.round(walk.length_m ?? 0)} m, but ${walk.steps?.length ?? 0} curb step${walk.steps?.length === 1 ? '' : 's'} (no ramp)` : 'no walking route either', 'warn'])
  rows.push(['Step-free', alt.found ? `${Math.round(alt.length_m ?? 0)} m detour${limit && (alt.length_m ?? 0) > limit ? `, over ${Math.round(limit)} m` : ''}` : 'no route at any distance', 'bad'])
  return (
    <div className="mt-2.5 rounded-xl border border-bad/30 bg-bad-bg/40 p-3" data-testid="counterexample">
      <div className="text-[11px] font-extrabold tracking-[0.08em] text-bad-ink uppercase">Counterexample</div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-ink">
        {short(ce.origin_label)} <span className="text-ink-3">→</span> {ce.destination_label}
      </p>
      <dl className="mt-2 space-y-1">
        {rows.map(([k, v, t]) => (
          <div key={k} className="grid grid-cols-[72px_1fr] gap-2 text-[12px]">
            <dt className="font-semibold text-ink-3">{k}</dt>
            <dd className={`leading-snug font-semibold ${t === 'ok' ? 'text-ok-ink' : t === 'bad' ? 'text-bad-ink' : 'text-unk-ink'}`}>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[11.5px] leading-relaxed text-ink-2">{ce.summary}</p>
      {walk && <ProfileCompare ce={ce} limit={limit} />}
      <details className="mt-1.5 text-[11px] text-ink-3">
        <summary className="cursor-pointer font-semibold">Assumptions behind this result</summary>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {ce.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </details>
    </div>
  )
}

/** The same proposal, two travel profiles: the route each one keeps, on the map. */
function ProfileCompare({ ce, limit }: { ce: Counterexample; limit: number | null }) {
  const view = useApp((s) => s.ceView)
  const setCeView = useApp((s) => s.setCeView)
  const walk = ce.walking_route
  const alt = ce.best_alternative
  const walkOk = !!walk?.found && (!limit || (walk.length_m ?? 0) <= limit)
  const sfOk = alt.found && (!limit || (alt.length_m ?? 0) <= limit)
  const rows: { k: 'walking' | 'step_free'; who: string; ok: boolean; v: string }[] = [
    { k: 'walking', who: 'Standard walking', ok: walkOk, v: walk?.found ? `${Math.round(walk.length_m ?? 0)} m` : 'none' },
    { k: 'step_free', who: 'Step-free route', ok: sfOk, v: alt.found ? `${Math.round(alt.length_m ?? 0)} m` : 'none' },
  ]
  return (
    <div className="mt-2.5 rounded-lg border border-line bg-paper p-2.5" data-testid="profile-compare">
      <div className="text-[10.5px] font-extrabold tracking-[0.07em] text-ink-3 uppercase">Same change, two travel profiles</div>
      <div className="mt-1.5 space-y-1">
        {rows.map((r) => (
          <button
            key={r.k}
            className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors ${view === r.k ? 'bg-ink text-white' : 'hover:bg-wash'}`}
            onClick={() => {
              const next = view === r.k ? 'none' : r.k
              setCeView(next)
              const g = (next === 'walking' ? walk?.geometry : next === 'step_free' ? alt.geometry : ce.baseline_route.geometry) as [number, number][] | undefined
              if (g?.length) useApp.getState().cameraTo({ preset: 'fit', points: g })
            }}
            aria-pressed={view === r.k}
            data-testid={`profile-${r.k}`}
          >
            <span className="font-semibold">{r.who}</span>
            <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap tnum">
              <span className={view === r.k ? 'text-white/80' : 'text-ink-2'}>{r.v}</span>
              <span className={`rounded px-1.5 py-px text-[9.5px] font-extrabold tracking-wider uppercase ${r.ok ? 'bg-ok-bg text-ok-ink' : 'bg-bad-bg text-bad-ink'}`}>{r.ok ? 'Available' : 'Unavailable'}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[10.5px] leading-snug text-ink-3">Click a profile to see its route. Capability constraints from the modeled network, not a claim about any person's journey.</p>
    </div>
  )
}

function ChecksSection() {
  const v = useApp((s) => s.verify)
  const compare = useApp((s) => s.compare)
  const setCompare = useApp((s) => s.setCompare)
  const [open, setOpen] = useState<string | null>(null)
  if (!v) return null
  const cur: VerifyState = v.fixed ?? v.proposed
  const base = new Map(v.baseline.checks.map((c) => [c.id, c]))
  const auto = cur.checks.find((c) => c.regression && c.counterexample)?.id ?? null
  const shown = open ?? auto
  return (
    <section className="border-t border-line px-6 py-4" aria-labelledby="checks-h" data-testid="checks">
      <div className="flex items-baseline justify-between">
        <h3 id="checks-h" className="kicker flex items-center gap-1.5">
          <span className="grid h-5 w-5 place-items-center rounded-full bg-ink text-[10px] font-extrabold text-white">2</span> Access checks · {v.fixed ? 'with the fix' : 'proposed network'}
        </h3>
        <span className="text-[11.5px] font-semibold text-ink-3 tnum">
          {cur.summary.PASS}/{cur.checks.length} pass
        </span>
      </div>
      <ul className="mt-2.5 divide-y divide-line overflow-hidden rounded-xl border border-line">
        {cur.checks.map((c) => {
          const b = base.get(c.id)
          const isOpen = shown === c.id
          return (
            <li key={c.id} data-testid={`check-${c.id}`} data-status={c.status}>
              <button className={`flex w-full items-start gap-3 px-3 py-2.5 text-left ${c.regression ? 'bg-bad-bg/30' : ''} hover:bg-wash`} onClick={() => setOpen(isOpen ? '' : c.id)} aria-expanded={isOpen}>
                <Pill status={c.status} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] leading-snug font-semibold text-ink">{c.label}</span>
                  <span className="mt-0.5 block text-[11.5px] text-ink-2 tnum">
                    {b && b.value !== c.value ? (
                      <>
                        Today {b.value} <span className="text-ink-3">→</span> <b className={c.status === 'PASS' ? 'text-ok-ink' : 'text-bad-ink'}>{c.value}</b>
                      </>
                    ) : (
                      c.value
                    )}
                    {c.regression && <span className="ml-1.5 font-bold text-bad-ink">· regression</span>}
                  </span>
                </span>
              </button>
              {isOpen && (
                <div className="px-3 pb-3">
                  <p className="text-[12px] leading-relaxed text-ink-2">{c.detail}</p>
                  {c.counterexample && <CounterexampleCard ce={c.counterexample} limit={cur.metrics.cutoff_m} />}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <button
        className={`mt-3 flex w-full items-center justify-center gap-2 rounded-xl border py-2 text-[12.5px] font-semibold transition-colors ${compare === 'split' ? 'border-ink bg-ink text-white' : 'border-ink/20 bg-paper text-ink hover:border-ink/40'}`}
        onClick={() => setCompare(compare === 'split' ? 'off' : 'split')}
        data-testid="toggle-compare"
        aria-pressed={compare === 'split'}
      >
        {compare === 'split' ? 'Exit today / proposed' : 'Compare today and the proposal on the map'}
      </button>
    </section>
  )
}

// ---- 3. minimal fix -----------------------------------------------------------------------
/** One plain sentence: why this intervention on its own does not fix the proposal. */
function whyNot(s: FixResponse['singles'][number], fix: FixResponse, v: VerifyResponse) {
  const checks = new Map(v.proposed.checks.map((c) => [c.id, c]))
  const failing = fix.targets.filter((t) => s.checks[t] !== 'PASS')
  if (!failing.length) return 'passes on its own'
  const route = fix.targets.find((t) => checks.get(t)?.kind === 'route' && checks.get(t)?.profile === 'step_free')
  const detour = fix.targets.find((t) => checks.get(t)?.kind === 'detour')
  if (route && failing.includes(route)) return `still no step-free route within ${Math.round(v.proposed.metrics.cutoff_m ?? 0)} m`
  if (detour && failing.includes(detour)) return `restores a ${s.values[route ?? detour]} route, but the detour is ${s.values[detour]} (over the limit)`
  return failing.map((t) => `${checkName(checks.get(t)!)} ${s.values[t]}`).join(' · ')
}

function FixSection() {
  const sc = useApp((s) => s.scenario)
  const v = useApp((s) => s.verify)
  const fix = useApp((s) => s.fix)
  const busy = useApp((s) => s.checkBusy)
  const stage = useApp((s) => s.checkStage)
  const applied = useApp((s) => s.applied)
  const { findFix, applyFix } = useApp.getState()
  if (!v || !sc) return null
  const regressed = v.proposed.regressions.length > 0
  if (!regressed) return null
  const allIn = fix?.interventions.every((i) => applied.includes(i))
  return (
    <section className="border-t border-line px-6 py-4" aria-labelledby="fix-h" data-testid="fix">
      <h3 id="fix-h" className="kicker flex items-center gap-1.5">
        <span className="grid h-5 w-5 place-items-center rounded-full bg-ink text-[10px] font-extrabold text-white">3</span> Minimal fix
      </h3>
      {!fix && (
        <>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">Search the mitigation catalog for the smallest set of changes that makes every failed check pass, with the closure kept in place.</p>
          <button className="btn-primary group mt-3 w-full justify-between py-3 pl-5 pr-4" onClick={() => void findFix()} disabled={busy !== null} data-testid="find-fix">
            <span>{busy === 'fix' ? 'Searching combinations…' : 'Find minimal fix'}</span>
            <span className="grid h-7 w-7 place-items-center rounded-full bg-ok text-white" aria-hidden>
              {busy === 'fix' ? <LoaderCircle size={15} className="animate-spin" /> : <Search size={15} />}
            </span>
          </button>
        </>
      )}
      {fix && fix.status === 'found' && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ ease: EASE }}>
          <p className="display mt-2 text-[22px] text-ink" data-testid="fix-title">
            {fix.size === 2 ? 'Two coordinated interventions restore the required journey.' : `${fix.size} intervention${fix.size === 1 ? '' : 's'} restore${fix.size === 1 ? 's' : ''} the required journey.`}
          </p>
          <ol className="mt-3 space-y-2" data-testid="fix-list">
            {fix.interventions.map((id) => {
              const iv = sc.interventions.find((x) => x.id === id)
              const on = applied.includes(id)
              return (
                <li key={id} className={`flex items-start gap-3 rounded-xl border p-3 ${on ? 'border-ok/35 bg-ok-bg/60' : 'border-line bg-paper'}`} data-testid={`fix-${id}`}>
                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[13px] font-extrabold text-white ring-4 ${on ? 'bg-ok ring-ok/15' : 'bg-sel ring-sel/15'}`}>{on ? <Check size={15} strokeWidth={3} /> : id}</span>
                  <span className="min-w-0">
                    <span className="block text-[13px] leading-snug font-bold text-ink">{iv?.label ?? id}</span>
                    <span className="mt-0.5 block text-[11.5px] text-ink-2">{(iv?.kind ?? '').replace(/_/g, ' ')} · hypothetical</span>
                  </span>
                </li>
              )
            })}
          </ol>
          <div className="mt-3 rounded-xl bg-wash p-3" data-testid="why-not">
            <div className="text-[11px] font-extrabold tracking-[0.08em] text-ink-2 uppercase">Why not fewer?</div>
            <ul className="mt-1.5 space-y-1">
              {fix.singles.map((s) => (
                <li key={s.id} className="grid grid-cols-[26px_1fr] gap-2 text-[11.5px] leading-snug">
                  <span className="font-mono font-bold text-ink">{s.id}</span>
                  <span className="text-ink-2">
                    <b className="text-ink">{s.id} alone:</b> {whyNot(s, fix, v)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-ink-3">
              Exact search: {fix.evaluated} sets checked{fix.exhaustive ? `, every set up to ${fix.size} intervention${fix.size === 1 ? '' : 's'}` : ''} · {Math.round(fix.runtime_ms)} ms · verified by the graph engine, not a model.
            </p>
          </div>
          {!allIn && stage !== 'fixed' && (
            <button className="btn-primary group mt-3 w-full justify-between py-3 pl-5 pr-4" onClick={() => void applyFix()} disabled={busy !== null} data-testid="apply-fix">
              <span>{busy === 'apply' ? 'Applying and re-testing…' : 'Apply proposed fix'}</span>
              <span className="grid h-7 w-7 place-items-center rounded-full bg-ok text-white" aria-hidden>
                {busy ? <LoaderCircle size={15} className="animate-spin" /> : <Wrench size={15} />}
              </span>
            </button>
          )}
        </motion.div>
      )}
      {fix && fix.status === 'none' && <p className="mt-2 text-[12.5px] text-bad-ink">No set of up to {fix.max_size} catalog interventions makes every failed check pass.</p>}
    </section>
  )
}

// ---- 4. verified --------------------------------------------------------------------------
function VerifySection() {
  const sc = useApp((s) => s.scenario)
  const v = useApp((s) => s.verify)
  const fix = useApp((s) => s.fix)
  const applied = useApp((s) => s.applied)
  const busy = useApp((s) => s.checkBusy)
  const { toggleMitigation } = useApp.getState()
  const rows = useMemo(() => {
    if (!v?.fixed) return null
    const st = [v.baseline, v.proposed, v.fixed]
    const r = (s: VerifyState) => (s.step_free_route?.found && (s.step_free_route.length_m ?? 0) <= (s.metrics.cutoff_m ?? Infinity) ? `${Math.round(s.step_free_route.length_m ?? 0)} m` : 'none')
    return [
      { k: 'Access checks passing', vals: st.map((s) => `${s.summary.PASS}/${s.checks.length}`) },
      { k: 'Step-free route, this journey', vals: st.map(r) },
      { k: 'Step-free journeys in the area', vals: st.map((s) => String(s.metrics.step_free_journeys)) },
      { k: 'Walking journeys in the area', vals: st.map((s) => String(s.metrics.walking_journeys)) },
    ]
  }, [v])
  if (!v?.fixed || !rows || !sc) return null
  const ok = !v.fixed.regressions.length
  return (
    <section className="border-t border-line px-6 py-4" aria-labelledby="ver-h" data-testid="verified">
      <h3 id="ver-h" className="kicker flex items-center gap-1.5">
        <span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-extrabold text-white ${ok ? 'bg-ok' : 'bg-bad'}`}>4</span> {ok ? 'Verified' : 'Verification failed'}
      </h3>
      <table className="mt-2.5 w-full overflow-hidden rounded-xl border border-line text-[12px] [&_td+td]:whitespace-nowrap" data-testid="metrics">
        <thead>
          <tr className="bg-wash text-[10.5px] font-extrabold tracking-[0.07em] text-ink-2 uppercase">
            <th className="px-2.5 py-1.5 text-left font-extrabold" />
            <th className="px-1.5 py-1.5 text-right font-extrabold">Today</th>
            <th className="px-1.5 py-1.5 text-right font-extrabold">Proposed</th>
            <th className="px-2.5 py-1.5 text-right font-extrabold">Fixed</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line tnum">
          {rows.map((r) => (
            <tr key={r.k}>
              <td className="px-2.5 py-1.5 text-ink-2">{r.k}</td>
              <td className="px-1.5 py-1.5 text-right font-semibold text-ink">{r.vals[0]}</td>
              <td className={`px-1.5 py-1.5 text-right font-semibold ${r.vals[1] !== r.vals[0] ? 'text-bad-ink' : 'text-ink'}`}>{r.vals[1]}</td>
              <td className={`px-2.5 py-1.5 text-right font-bold ${r.vals[2] === r.vals[0] ? 'text-ok-ink' : 'text-bad-ink'}`}>{r.vals[2]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3">
        <div className="text-[11.5px] font-semibold text-ink-2">Test it: switch an intervention off and the checks rerun.</div>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {(fix?.interventions ?? []).map((id) => {
            const on = applied.includes(id)
            return (
              <button
                key={id}
                role="switch"
                aria-checked={on}
                onClick={() => void toggleMitigation(id)}
                disabled={busy !== null}
                className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-bold transition-colors ${on ? 'border-ok/40 bg-ok-bg text-ok-ink' : 'border-bad/40 bg-bad-bg text-bad-ink'}`}
                data-testid={`toggle-${id}`}
              >
                <span className={`relative h-4 w-7 rounded-full transition-colors ${on ? 'bg-ok' : 'bg-line-2'}`} aria-hidden>
                  <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-[left] ${on ? 'left-3.5' : 'left-0.5'}`} />
                </span>
                {id} {on ? 'on' : 'off'}
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}

export function ChangeCheckPanel() {
  const error = useApp((s) => s.checkError)
  const stage = useApp((s) => s.checkStage)
  const resetCheck = useApp((s) => s.resetCheck)
  const v = useApp((s) => s.verify)
  const fix = useApp((s) => s.fix)
  const box = useRef<HTMLDivElement>(null)
  // bring the newest step of the flow into view
  useEffect(() => {
    const sel = stage === 'fixed' ? '[data-testid=verified]' : fix ? '[data-testid=fix]' : v ? '[data-testid=checks]' : null
    const el = sel ? box.current?.querySelector<HTMLElement>(sel) : null
    if (el && box.current) box.current.scrollTo({ top: el.offsetTop - 12, behavior: 'smooth' })
  }, [stage, fix, v])
  return (
    <div ref={box} className="scroll-thin relative h-full overflow-y-auto overscroll-contain" data-testid="change-check">
      <CaseHeader />
      <ProposalSection />
      <ChecksSection />
      <FixSection />
      <VerifySection />
      <div className="px-6 pb-1">
        <Disclosure title="Ask in plain English" testId="ask-toggle">
          <Assistant />
          <p className="mt-2 text-[10.5px] leading-snug text-ink-3">Questions map to typed, allowlisted operations; the graph engine computes every answer. No generated code runs.</p>
        </Disclosure>
      </div>
      {error && (
        <p className="mx-6 mb-3 rounded-lg bg-bad-bg px-3 py-2 text-[12px] text-bad-ink" role="alert">
          {error}
        </p>
      )}
      {stage !== 'baseline' && (
        <div className="px-6 pb-2">
          <button className="btn-ghost -ml-2 px-2 text-[12.5px]" onClick={() => void resetCheck()} data-testid="reset-check">
            <RotateCcw size={13} aria-hidden /> Start over
          </button>
        </div>
      )}
      <p className="px-6 pt-1 pb-6 text-[11px] leading-relaxed text-ink-3">
        Planning checks on a modeled network, not an ADA compliance determination. The closure, barriers and mitigations in this case are hypothetical scenario settings on real Charlotte streets.
      </p>
    </div>
  )
}
