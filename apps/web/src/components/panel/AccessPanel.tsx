import { Bus, Check, CircleAlert, CircleCheck, CircleHelp, GraduationCap, HeartPulse, Landmark, LoaderCircle, MapPin, Scale, ShoppingBasket, Trees, Wrench, Building2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { CATEGORY_LABEL, CATEGORY_ORDER, FACTOR_LABEL, type AccessCategory, type AccessCell, type CompareResponse, type Factor, type ReqStatus } from '../../api/access'
import { stageOf, useAccess, type AccessStage } from '../../state/access'
import { Disclosure, Segmented } from '../ui'
import { Assistant } from './Assistant'

const ICON: Record<AccessCategory, typeof Bus> = { healthcare: HeartPulse, education: GraduationCap, grocery: ShoppingBasket, transit: Bus, parks: Trees, services: Landmark }
const FACTOR_CLS: Record<Factor, string> = {
  served: 'bg-ok-bg text-ok-ink',
  unknown_links: 'bg-unk-bg text-unk-ink',
  outside_area: 'bg-unk-bg text-unk-ink',
  barrier: 'bg-bad-bg text-bad-ink',
  detour: 'bg-bad-bg text-bad-ink',
  distance: 'bg-[#ece7f6] text-[#4b3a7a]',
}
const STATUS: Record<ReqStatus, { cls: string; Icon: typeof Check; word: string }> = {
  PASS: { cls: 'bg-ok-bg text-ok-ink', Icon: CircleCheck, word: 'Pass' },
  FAIL: { cls: 'bg-bad-bg text-bad-ink', Icon: CircleAlert, word: 'Fail' },
  INCONCLUSIVE: { cls: 'bg-unk-bg text-unk-ink', Icon: CircleHelp, word: 'Inconclusive' },
}
const m = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${Math.round(x).toLocaleString('en-US')} m`)
const lower = (c: AccessCategory) => (c === 'transit' ? 'public transport' : c === 'services' ? 'essential services' : CATEGORY_LABEL[c].toLowerCase())

function Pill({ status }: { status: ReqStatus }) {
  const s = STATUS[status]
  return (
    <span className={`inline-flex items-center justify-center gap-0.5 rounded-md px-1 py-[3px] text-[9.5px] font-extrabold tracking-[0.04em] uppercase ${s.cls}`} data-status={status} title={s.word}>
      <s.Icon size={10} strokeWidth={2.6} aria-hidden /> {status === 'INCONCLUSIVE' ? 'Unsure' : s.word}
    </span>
  )
}

function FactorChip({ f }: { f: Factor }) {
  return <span className={`inline-flex shrink-0 items-center rounded-md px-1.5 py-[2px] text-[10.5px] font-bold ${FACTOR_CLS[f]}`}>{FACTOR_LABEL[f]}</span>
}

function Kicker({ n, children, tone = 'ink' }: { n: number; children: ReactNode; tone?: 'ink' | 'ok' | 'bad' }) {
  const bg = tone === 'ok' ? 'bg-ok' : tone === 'bad' ? 'bg-bad' : 'bg-ink'
  return (
    <h3 className="kicker flex items-center gap-1.5">
      <span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-extrabold text-white ${bg}`}>{n}</span> {children}
    </h3>
  )
}

// ---- stages ------------------------------------------------------------------------------
function Stages() {
  const st = useAccess((s) => stageOf(s))
  const goTo = useAccess((s) => s.goTo)
  const order: { k: AccessStage; label: string }[] = [
    { k: 'discover', label: 'Discover' },
    { k: 'diagnose', label: 'Diagnose' },
    { k: 'intervene', label: 'Fix or build' },
    { k: 'verify', label: 'Verify' },
  ]
  const at = order.findIndex((o) => o.k === st)
  return (
    <ol className="mt-4 flex items-center gap-1" aria-label="Access workflow" data-testid="access-stages">
      {order.map((o, i) => (
        <li key={o.k} className="flex min-w-0 flex-1 items-center gap-1">
          <button
            className={`flex h-7 min-w-0 flex-1 items-center justify-center gap-0.5 rounded-md px-0.5 text-[9.5px] font-extrabold uppercase transition-colors ${
              i < at ? 'bg-ok-bg text-ok-ink hover:bg-ok/20' : i === at ? 'bg-ink text-white' : 'bg-wash text-ink-3'
            }`}
            aria-current={i === at ? 'step' : undefined}
            disabled={i >= at}
            onClick={() => goTo(o.k)}
            data-testid={`stage-${o.k}`}
          >
            {i < at && <Check size={10} strokeWidth={3.4} className="shrink-0" aria-hidden />}
            <span className="truncate">{o.label}</span>
          </button>
          {i < order.length - 1 && <span className="h-px w-1 shrink-0 bg-line-2" aria-hidden />}
        </li>
      ))}
    </ol>
  )
}

function Header() {
  const data = useAccess((s) => s.data)
  const d = useAccess((s) => s.diagnosis)
  const c = useAccess((s) => s.compare)
  const show = useAccess((s) => s.show)
  const cat = useAccess((s) => s.category)
  const profile = useAccess((s) => s.profile)
  const pl = profile === 'step_free' ? 'step-free' : 'on foot'
  let title = 'Where is access failing?'
  let sub = 'Homes in Elizabeth measured along the real pedestrian network to six kinds of essential service.'
  if (data && !d) {
    const s = data.summary
    title = s.failing
      ? `${s.failing} homes cannot reach ${lower(cat)} within ${m(data.threshold_m)} ${pl}.`
      : `No home is confirmed cut off from ${lower(cat)}.`
    sub = `${s.served} reach it on links of known condition. ${s.uncertain} reach it only if links of unknown condition are passable: StreetMend will not call those served.`
  }
  if (d && !c) {
    title = `${FACTOR_LABEL[d.primary_factor]}.`
    sub = d.sentence
  }
  if (c && show === 'none') {
    title = c.winner === 'fix' ? 'Fixing the network wins here.' : c.winner === 'build' ? 'A new facility wins here.' : c.winner === 'tie' ? 'The two options tie.' : 'Neither option helps.'
    sub = c.why
  }
  if (c && show !== 'none') {
    const opt = show === 'fix' ? c.fix : c.build
    const after = opt.after
    title = after ? `Re-verified: ${after.possible} of ${c.homes} homes now reach ${lower(cat)}.` : 'Nothing to verify.'
    sub = after ? `Recomputed on the full network, not taken from the search: requirement ${after.status === 'PASS' ? 'passes' : after.status === 'FAIL' ? 'still fails' : 'is inconclusive (it depends on links of unknown condition)'}.` : ''
  }
  return (
    <section className="px-6 pt-5 pb-4" data-testid="access-header">
      <div className="flex items-center justify-between gap-2">
        <div className="eyebrow">Access gaps · real records</div>
        <span className="inline-flex items-center gap-1.5 rounded-md bg-wash px-2 py-[3px] text-[10.5px] font-bold tracking-[0.08em] text-ink-2 uppercase">
          <MapPin size={11} aria-hidden /> {data ? `${data.summary.homes} homes` : 'Elizabeth'}
        </span>
      </div>
      <h2 className="display mt-2.5 text-balance text-[clamp(23px,1.9vw,28px)] text-ink" data-testid="access-title">
        {title}
      </h2>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{sub}</p>
      <Stages />
    </section>
  )
}

function Controls() {
  const cat = useAccess((s) => s.category)
  const profile = useAccess((s) => s.profile)
  const ov = useAccess((s) => s.overview)
  const { setCategory, setProfile } = useAccess.getState()
  return (
    <section className="border-t border-line px-6 py-3.5">
      <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Service category" data-testid="access-category">
        {CATEGORY_ORDER.map((c) => {
          const I = ICON[c]
          const row = ov?.find((r) => r.category === c)
          const on = c === cat
          return (
            <button
              key={c}
              role="radio"
              aria-checked={on}
              onClick={() => void setCategory(c)}
              className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left transition-colors ${on ? 'border-ink bg-ink text-white' : 'border-line bg-paper text-ink hover:border-ink/40'}`}
              data-testid={`cat-${c}`}
            >
              <I size={14} className={on ? 'text-white' : 'text-ink-2'} aria-hidden />
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-bold">{CATEGORY_LABEL[c]}</span>
                {row && <span className={`block text-[10.5px] tnum ${on ? 'text-white/70' : row.failing ? 'text-bad-ink' : 'text-ink-3'}`}>{row.failing ? `${row.failing} fail` : 'none fail'}</span>}
              </span>
            </button>
          )
        })}
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-3">
        <span className="text-[11.5px] font-semibold text-ink-2">Travel profile</span>
        <Segmented
          size="sm"
          label="Travel profile"
          value={profile}
          testId="access-profile"
          onChange={(v) => void setProfile(v)}
          options={[
            { value: 'step_free', label: 'Step-free', title: 'Needs a continuous step-free path: a missing or failed curb ramp is a barrier' },
            { value: 'pedestrian', label: 'Walking', title: 'Can step a curb: missing ramps do not stop this profile' },
          ]}
        />
      </div>
    </section>
  )
}

// ---- 1. discover ---------------------------------------------------------------------------
function Bar({ served, uncertain, failing }: { served: number; uncertain: number; failing: number }) {
  const t = Math.max(1, served + uncertain + failing)
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-wash" aria-hidden>
        <span className="bg-ok" style={{ width: `${(served / t) * 100}%` }} />
        <span className="bg-unk" style={{ width: `${(uncertain / t) * 100}%` }} />
        <span className="bg-bad" style={{ width: `${(failing / t) * 100}%` }} />
      </div>
      <div className="mt-1.5 grid grid-cols-3 gap-2 text-[11px] text-ink-2 tnum">
        <span><b className="text-[14px] text-ok-ink">{served}</b> pass</span>
        <span><b className="text-[14px] text-unk-ink">{uncertain}</b> inconclusive</span>
        <span><b className="text-[14px] text-bad-ink">{failing}</b> fail</span>
      </div>
    </div>
  )
}

function CellRow({ c, onPick }: { c: AccessCell; onPick: () => void }) {
  const f = c.unmet_homes ? c.primary_factor : c.primary_factor
  return (
    <button className="flex w-full items-center gap-3 rounded-xl border border-line bg-paper px-3 py-2.5 text-left hover:border-ink/40 hover:bg-wash" onClick={onPick} data-testid={`cell-${c.id}`}>
      <span className={`h-8 w-1.5 shrink-0 rounded-full ${c.status === 'PASS' ? 'bg-ok' : c.status === 'FAIL' ? 'bg-bad' : 'bg-unk'}`} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-ink tnum">
          {c.unmet_homes ? `${c.unmet_homes} of ${c.homes} homes fail` : `${c.uncertain} of ${c.homes} homes unverified`}
        </span>
        <span className="block text-[11.5px] text-ink-3 tnum">
          {c.median_straight_m === null
            ? `None in the network · nearest outside ${m(c.median_outside_m)} away`
            : `Network ${m(c.median_network_m)} · straight line ${m(c.median_straight_m)}`}
        </span>
      </span>
      <FactorChip f={f} />
    </button>
  )
}

function Discover() {
  const data = useAccess((s) => s.data)
  const loading = useAccess((s) => s.loading)
  const cell = useAccess((s) => s.cell)
  const selectCell = useAccess((s) => s.selectCell)
  if (!data) return loading ? <p className="flex items-center gap-2 px-6 py-4 text-[13px] text-ink-2"><LoaderCircle size={14} className="animate-spin" /> Measuring access along the network…</p> : null
  const s = data.summary
  const failing = data.cells.filter((c) => c.unmet_homes > 0)
  const list = (failing.length ? failing : [...data.cells].filter((c) => c.uncertain > 0).sort((a, b) => b.uncertain - a.uncertain)).slice(0, cell ? 3 : 5)
  return (
    <section className="border-t border-line px-6 py-4" aria-labelledby="disc-h" data-testid="discover">
      <Kicker n={1}><span id="disc-h">Discover</span></Kicker>
      <div className="mt-2.5">
        <Bar served={s.served} uncertain={s.uncertain} failing={s.failing} />
      </div>
      <p className="mt-2 text-[11.5px] leading-snug text-ink-3">
        Within {m(data.threshold_m)} along the network ({data.profile === 'step_free' ? 'step-free' : 'walking'}). Each hexagon groups about {Math.round(s.homes / Math.max(1, data.cells.length))} homes (H3 resolution {data.h3_resolution}).
      </p>
      <div className="mt-3 text-[11.5px] font-semibold text-ink-2">{failing.length ? 'Where it fails, worst first' : 'Nothing fails outright. Most uncertain:'}</div>
      <div className="mt-1.5 space-y-1.5">
        {list.map((c) => (
          <CellRow key={c.id} c={c} onPick={() => void selectCell(c.id)} />
        ))}
      </div>
    </section>
  )
}

// ---- 2. diagnose ---------------------------------------------------------------------------
function DistRow({ label, v, T, tone }: { label: string; v: number | null; T: number; tone: 'ok' | 'bad' | 'ink' }) {
  const w = v === null ? 100 : Math.min(100, (v / (2 * T)) * 100)
  return (
    <div className="grid grid-cols-[112px_1fr_62px] items-center gap-2 text-[12px]">
      <span className="text-ink-2">{label}</span>
      <span className="relative h-2 rounded-full bg-wash">
        <span className={`absolute inset-y-0 left-0 rounded-full ${v === null ? 'bg-line-2' : tone === 'ok' ? 'bg-ok' : tone === 'bad' ? 'bg-bad' : 'bg-ink/60'}`} style={{ width: `${w}%` }} />
        <span className="absolute -top-1 -bottom-1 left-1/2 w-px bg-ink/50" aria-hidden />
      </span>
      <span className="text-right font-semibold text-ink tnum">{v === null ? 'none' : m(v)}</span>
    </div>
  )
}

function Diagnose() {
  const d = useAccess((s) => s.diagnosis)
  const busy = useAccess((s) => s.diagnosing)
  const cell = useAccess((s) => s.cell)
  const comparing = useAccess((s) => s.comparing)
  const compare = useAccess((s) => s.compare)
  const runCompare = useAccess((s) => s.runCompare)
  if (!cell) return null
  if (!d) return busy ? <p className="flex items-center gap-2 border-t border-line px-6 py-4 text-[13px] text-ink-2"><LoaderCircle size={14} className="animate-spin" /> Diagnosing…</p> : null
  const r = d.representative
  const T = d.threshold_m
  const sf = d.profile === 'step_free'
  const tone = (v: number | null) => (v !== null && v <= T ? 'ok' : 'bad') as 'ok' | 'bad'
  return (
    <section className="border-t border-line px-6 py-4" aria-labelledby="diag-h" data-testid="diagnose">
      <div className="flex items-center justify-between gap-2">
        <Kicker n={2} tone={d.primary_factor === 'served' ? 'ok' : d.primary_factor === 'unknown_links' || d.primary_factor === 'outside_area' ? 'ink' : 'bad'}>
          <span id="diag-h">Diagnose</span>
        </Kicker>
        <FactorChip f={d.primary_factor} />
      </div>
      <p className="mt-2 text-[12.5px] leading-relaxed text-ink">{d.sentence}</p>
      <div className="mt-3 rounded-xl border border-line p-3" data-testid="distances">
        <div className="mb-2 flex items-center justify-between text-[10.5px] font-extrabold tracking-[0.07em] text-ink-3 uppercase">
          <span>A typical home in this cell</span>
          <span>limit {m(T)}</span>
        </div>
        <div className="space-y-1.5">
          <DistRow label="Straight line" v={r.straight_m} T={T} tone="ink" />
          <DistRow label="Walking route" v={r.walking_possible_m} T={T} tone={tone(r.walking_possible_m)} />
          <DistRow label="Step-free route" v={r.step_free_possible_m} T={T} tone={tone(r.step_free_possible_m)} />
          <DistRow label="Every link open" v={r.physical_m} T={T} tone="ink" />
        </div>
        <p className="mt-2 text-[10.5px] leading-snug text-ink-3">
          Routes allow links of unknown condition (an upper bound on access). {r.nearest_facility ? `Nearest by straight line: ${r.nearest_facility.name}${r.nearest_facility.in_network ? '' : ' (outside the modeled network)'}.` : ''}
        </p>
      </div>
      <div className="mt-2.5 flex items-start justify-between gap-3 rounded-lg bg-wash px-3 py-2 text-[11.5px]" data-testid="supply" title={d.supply.method}>
        <span className="text-ink-2">
          Service supply <span className="text-ink-3">(E2SFCA-style, one unit per facility)</span>
        </span>
        <span className="shrink-0 text-right font-semibold text-ink tnum">
          {d.supply.index === null ? 'no facility in the network' : d.supply.index >= 1 ? 'at or above the area’s top quarter' : `${Math.round(d.supply.index * 100)}% of the area’s top quarter`}
          <span className="block text-[10.5px] font-normal text-ink-3">{d.supply.facilities_in_catchment} of {d.supply.facilities_in_network} facilities within {m(T)}</span>
        </span>
      </div>
      {r.barriers.length > 0 && (
        <div className="mt-3">
          <div className="text-[11.5px] font-semibold text-ink-2">Recorded barriers on the shortest physical route</div>
          <ul className="mt-1.5 space-y-1" data-testid="barriers">
            {r.barriers.slice(0, 4).map((b) => (
              <li key={b.id} className="flex items-start gap-2 text-[12px] leading-snug">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-bad" aria-hidden />
                <span className="min-w-0 text-ink">
                  {b.reason}
                  <span className="block text-[10.5px] text-ink-3">{b.kind} · {b.id}{b.source_ids.length ? ` · ${b.source_ids.slice(0, 2).join(', ')}` : ''}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {r.unknown_count > 0 && (
        <p className="mt-2 text-[11.5px] text-unk-ink">{r.unknown_count} link{r.unknown_count === 1 ? '' : 's'} of unknown condition on the best {sf ? 'step-free' : 'walking'} route (no CDOT record).</p>
      )}
      {!compare && d.primary_factor !== 'served' && (
        <button className="btn-primary group mt-3.5 w-full justify-between py-3 pl-5 pr-4" onClick={() => void runCompare()} disabled={comparing} data-testid="run-compare">
          <span>{comparing ? 'Comparing fix and build…' : 'Compare: fix the network or build?'}</span>
          <span className="grid h-7 w-7 place-items-center rounded-full bg-ok text-white" aria-hidden>
            {comparing ? <LoaderCircle size={15} className="animate-spin" /> : <Scale size={15} />}
          </span>
        </button>
      )}
    </section>
  )
}

// ---- 3. fix or build ------------------------------------------------------------------------
function OptionCard({ kind, c }: { kind: 'fix' | 'build'; c: CompareResponse }) {
  const show = useAccess((s) => s.show)
  const setShow = useAccess((s) => s.setShow)
  const o = kind === 'fix' ? c.fix : c.build
  const win = c.winner === kind
  const gain = o.status === 'found' ? (o.gain ?? 0) : 0
  const on = show === kind
  return (
    <div className={`flex min-w-0 flex-col rounded-xl border p-3 ${win ? 'border-ok bg-ok-bg/40' : 'border-line'}`} data-testid={`option-${kind}`}>
      <div className="flex items-center justify-between gap-1">
        <span className="flex items-center gap-1.5 text-[11px] font-extrabold tracking-[0.07em] text-ink-2 uppercase">
          {kind === 'fix' ? <Wrench size={12} aria-hidden /> : <Building2 size={12} aria-hidden />} {kind === 'fix' ? 'Fix' : 'Build'}
        </span>
        {win && <span className="rounded bg-ok px-1.5 py-px text-[9.5px] font-extrabold tracking-wider text-white uppercase">Wins</span>}
        {c.winner === 'tie' && <span className="rounded bg-ink/80 px-1.5 py-px text-[9.5px] font-extrabold tracking-wider text-white uppercase">Tie</span>}
      </div>
      <div className="mt-1.5 text-[24px] leading-none font-extrabold text-ink tnum" data-testid={`gain-${kind}`}>+{gain}</div>
      <div className="mt-0.5 text-[11px] text-ink-2">homes newly within {m(c.threshold_m)}</div>
      <div className="mt-2 min-h-0 flex-1 text-[11.5px] leading-snug text-ink">
        {kind === 'fix' &&
          (c.fix.status === 'found' ? (
            <ul className="space-y-1">
              {c.fix.repairs.map((r) => (
                <li key={r.id}>
                  {r.label}
                  <span className="block text-[10.5px] text-ink-3">alone +{r.alone_gain} · {r.evidence === 'municipal_record' || r.evidence === 'municipal_historical' ? 'CDOT record' : r.evidence}</span>
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-ink-2">No repair within reach helps these homes.</span>
          ))}
        {kind === 'build' &&
          (c.build.site ? (
            <span>
              {c.build.site.label.replace(/^Hypothetical [a-z ]+ site: /, '')}
              <span className="block text-[10.5px] text-ink-3">hypothetical site · {c.build.relevant} sites tested</span>
            </span>
          ) : (
            <span className="text-ink-2">No candidate site helps.</span>
          ))}
      </div>
      {o.status === 'found' && (
        <button
          className={`mt-2.5 rounded-lg border px-2 py-1.5 text-[11.5px] font-bold transition-colors ${on ? 'border-ink bg-ink text-white' : 'border-line text-ink hover:border-ink/40'}`}
          onClick={() => setShow(on ? 'none' : kind)}
          data-testid={`show-${kind}`}
        >
          {on ? 'Shown on map' : 'Show on map'}
        </button>
      )}
    </div>
  )
}

function Intervene() {
  const c = useAccess((s) => s.compare)
  const budget = useAccess((s) => s.budget)
  const comparing = useAccess((s) => s.comparing)
  const setBudget = useAccess((s) => s.setBudget)
  if (!c) return null
  const synergy = c.fix.status === 'found' && c.fix.synergy
  return (
    <section className="border-t border-line px-6 py-4" aria-labelledby="int-h" data-testid="intervene">
      <div className="flex items-center justify-between gap-2">
        <Kicker n={3}><span id="int-h">Fix or build</span></Kicker>
        <div className="flex items-center gap-2">
          {comparing && <LoaderCircle size={13} className="animate-spin text-ink-3" aria-hidden />}
          <Segmented size="sm" label="Repair budget" value={budget} testId="access-budget" onChange={(v) => void setBudget(v)}
            options={[1, 2, 3].map((b) => ({ value: b, label: `${b} repair${b > 1 ? 's' : ''}` }))} />
        </div>
      </div>
      <p className="mt-2 text-[12.5px] leading-relaxed text-ink" data-testid="compare-why">{c.why}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <OptionCard kind="fix" c={c} />
        <OptionCard kind="build" c={c} />
      </div>
      {synergy && <p className="mt-2 text-[11.5px] text-ink-2">The repairs only work together: one is worth nothing on its own. Ranking repairs one at a time would miss this.</p>}
      <p className="mt-2 text-[10.5px] leading-snug text-ink-3">
        Same {c.homes} homes, same network, same objective. {c.fix.exact ? 'Exact' : 'Beam'} search: {c.fix.evaluated.toLocaleString('en-US')} repair sets from {c.fix.relevant} repairs that can lie on a route within {m(c.threshold_m)} ({c.fix.candidates} candidates in all). Costs are not compared.
      </p>
    </section>
  )
}

// ---- 4. verify --------------------------------------------------------------------------------
function Verify() {
  const c = useAccess((s) => s.compare)
  if (!c) return null
  const cols = [
    { k: 'Today', a: c.before },
    { k: 'Fix', a: c.fix.after },
    { k: 'Build', a: c.build.after },
  ]
  return (
    <section className="border-t border-line px-6 py-4" aria-labelledby="ver-h" data-testid="access-verify">
      <Kicker n={4} tone="ok"><span id="ver-h">Verify</span></Kicker>
      <p className="mt-2 text-[12px] leading-snug text-ink-2">{c.requirement.label}. Each option re-run on the full network.</p>
      <table className="mt-2.5 w-full table-fixed overflow-hidden rounded-xl border border-line text-[12px]">
        <colgroup>
          <col className="w-[34%]" />
          <col />
          <col />
          <col />
        </colgroup>
        <thead>
          <tr className="bg-wash text-[10.5px] font-extrabold tracking-[0.07em] text-ink-2 uppercase">
            <th className="px-2 py-1.5 text-left" />
            {cols.map((x) => (
              <th key={x.k} className="px-1 py-1.5 text-center">{x.k}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line tnum">
          <tr>
            <td className="px-2 py-1.5 leading-tight text-ink-2">Homes in reach</td>
            {cols.map((x) => (
              <td key={x.k} className="px-1 py-1.5 text-center font-semibold text-ink">{x.a ? `${x.a.possible}/${x.a.homes}` : '—'}</td>
            ))}
          </tr>
          <tr>
            <td className="px-2 py-1.5 leading-tight text-ink-2">On known links only</td>
            {cols.map((x) => (
              <td key={x.k} className="px-1 py-1.5 text-center text-ink">{x.a ? x.a.verified : '—'}</td>
            ))}
          </tr>
          <tr>
            <td className="px-2 py-1.5 leading-tight text-ink-2">Requirement</td>
            {cols.map((x) => (
              <td key={x.k} className="px-1 py-1.5 text-center">{x.a ? <Pill status={x.a.status} /> : '—'}</td>
            ))}
          </tr>
        </tbody>
      </table>
      <ul className="mt-2.5 space-y-1 text-[10.5px] leading-snug text-ink-3">
        {c.notes.slice(1).map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </section>
  )
}

export function AccessPanel() {
  const error = useAccess((s) => s.error)
  const stage = useAccess((s) => stageOf(s))
  const box = useRef<HTMLDivElement>(null)
  const ready = useAccess((s) => `${!!s.diagnosis}${!!s.compare}`)
  useEffect(() => {
    const sel = stage === 'verify' ? '[data-testid=access-verify]' : stage === 'intervene' ? '[data-testid=intervene]' : stage === 'diagnose' ? '[data-testid=diagnose]' : null
    const el = sel ? box.current?.querySelector<HTMLElement>(sel) : null
    if (el && box.current) box.current.scrollTo({ top: el.offsetTop - 12, behavior: 'smooth' })
    if (stage === 'discover') box.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [stage, ready])
  return (
    <div ref={box} className="scroll-thin relative h-full overflow-y-auto overscroll-contain" data-testid="access-panel">
      <Header />
      <Controls />
      <Discover />
      <Diagnose />
      <Intervene />
      <Verify />
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
      <p className="px-6 pt-1 pb-6 text-[11px] leading-relaxed text-ink-3">
        Real CDOT records and OpenStreetMap places; homes are OSM residential buildings (a proxy, not population). New-facility sites are hypothetical. A planning model, not an accessibility certification.
      </p>
    </div>
  )
}
