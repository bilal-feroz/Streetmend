import { useEffect, useMemo, useRef } from 'react'
import { useAccess } from '../state/access'
import { useApp } from '../state/store'
import { panelInset } from './inset'
import type { MapHandle } from './MapView'

interface Anchor {
  key: string
  lng: number
  lat: number
  alt: number
  text: string
  sub?: string
  tone: 'origin' | 'dest-ok' | 'dest-bad' | 'tip' | 'gap' | 'closure' | 'fix' | 'site'
  dy: number
  side?: boolean // place beside the marker instead of above it
  burst?: boolean // a ground-level ring, not a text label
  dx?: number // horizontal offset of a callout; a leader line joins it to its point
}

const TONE: Record<Anchor['tone'], string> = {
  origin: 'border-ok/60 text-ink',
  'dest-ok': 'border-ok text-ink',
  'dest-bad': 'border-bad text-ink',
  tip: 'border-line text-ink',
  gap: 'border-bad border-[1.5px] text-bad-ink',
  closure: 'border-[#e0742a] border-[1.5px] text-[#9a4a12]',
  fix: 'border-ok border-[1.5px] text-ok-ink',
  site: 'border-sel border-[1.5px] text-sel-ink',
}

/** DOM labels pinned to geographic points; positions are written every frame
 * from the Three.js camera (no React re-render per frame). */
export function MapLabels({ handle }: { handle: MapHandle }) {
  const scenario = useApp((s) => s.scenario)
  const journey = useApp((s) => s.journey)
  const hovered = useApp((s) => s.hovered)
  const applied = useApp((s) => s.applied)
  const ev = useApp((s) => (s.compare === 'before' ? s.initialEval : s.evaluation))
  const draft = useApp((s) => s.draft)
  const accessOn = useAccess((s) => s.on)
  const diagnosis = useAccess((s) => s.diagnosis)
  const accessData = useAccess((s) => s.data)
  const compare = useAccess((s) => s.compare)
  const show = useAccess((s) => s.show)
  const ceView = useApp((s) => s.ceView)
  const verifyRes = useApp((s) => s.verify)
  const lines = useRef(new Map<string, SVGLineElement>())
  const found = ev?.journey?.route.found ?? false
  const refs = useRef(new Map<string, HTMLDivElement>())

  const anchors = useMemo<Anchor[]>(() => {
    if (!scenario) return []
    const out: Anchor[] = []
    if (accessOn) {
      // the access view labels only what the engine reported for the diagnosed cell
      if (!diagnosis) return out
      const r = diagnosis.representative
      const sf = diagnosis.profile === 'step_free'
      const best = sf ? r.step_free_possible_m : r.walking_possible_m
      const T = diagnosis.threshold_m
      if (show === 'none') {
        out.push({ key: 'origin', lng: r.lon, lat: r.lat, alt: 4, text: 'A typical home here', sub: best === null ? `No ${sf ? 'step-free ' : ''}route in the model` : `${Math.round(best)} m ${sf ? 'step-free' : 'walk'} · limit ${Math.round(T)} m`, tone: best !== null && best <= T ? 'origin' : 'dest-bad', dy: 0, side: true })
        const f = accessData?.facilities.find((x) => x.id === r.nearest_facility?.id)
        if (f) out.push({ key: 'dest', lng: f.lon, lat: f.lat, alt: 4, text: f.name, sub: f.in_network ? 'Nearest by straight line' : 'Outside the modeled network', tone: 'tip', dy: 0, side: true })
        const b = r.barriers[0] && scenario.edges.find((e) => e.id === r.barriers[0].id)
        if (b && (best === null || best > T)) {
          const [lng, lat] = b.geometry[Math.floor(b.geometry.length / 2)]
          out.push({ key: 'gap', lng, lat, alt: 6, text: 'Recorded barrier', sub: r.barriers[0].reason.replace('CDOT Sidewalk Inventory: ', 'CDOT inventory: ').replace(/ \(CDOT survey.*$/, '').slice(0, 60), tone: 'gap', dy: -54 })
          out.push({ key: 'burst', lng, lat, alt: 0.5, text: '', tone: 'gap', dy: 0, burst: true })
        }
      }
      const after = show === 'fix' ? compare?.fix.after : show === 'build' ? compare?.build.after : undefined
      if (after?.route) {
        const l = after.route.length_m
        out.push({ key: 'origin', lng: r.lon, lat: r.lat, alt: 4, text: 'The same home', sub: l === null ? 'Still no route' : `Now ${Math.round(l)} m ${sf ? 'step-free' : 'walk'} · limit ${Math.round(T)} m`, tone: l !== null && l <= T ? 'dest-ok' : 'dest-bad', dy: 0, side: true })
      }
      if (show === 'fix' && compare?.fix.status === 'found') {
        compare.fix.repairs.forEach((x, i) => out.push({ key: `fix${i}`, lng: x.lon, lat: x.lat, alt: 5, text: x.kind === 'build_sidewalk' ? 'Build missing sidewalk' : 'Repair curb ramp', sub: `${x.id} · alone +${x.alone_gain} homes`, tone: 'fix', dy: -44 - i * 6, dx: i % 2 ? 70 : -70 }))
      } else if (show === 'build' && compare?.build.site) {
        const st = compare.build.site
        out.push({ key: 'site', lng: st.lon, lat: st.lat, alt: 5, text: `Hypothetical new ${diagnosis.label.toLowerCase()} site`, sub: 'Land, zoning and cost not assessed', tone: 'site', dy: -44 })
      }
      return out
    }
    const places = [...scenario.origins, ...scenario.destinations]
    const o = places.find((p) => p.id === journey?.origin)
    const d = places.find((p) => p.id === journey?.destination)
    if (o) out.push({ key: 'origin', lng: o.lon, lat: o.lat, alt: 4, text: o.label.replace(/ \(\d+ bldg\)$/, ''), sub: 'Origin', tone: 'origin', dy: 0, side: true })
    if (d) out.push({ key: 'dest', lng: d.lon, lat: d.lat, alt: 4, text: d.label, sub: found ? 'Reachable' : 'Not reachable', tone: found ? 'dest-ok' : 'dest-bad', dy: 0, side: true })
    // The focal point of a broken journey: a callout at its blocked crossing, from engine state only.
    const blockers = [...new Set(ev?.journey && !found ? ev.journey.potential_blockers : [])]
      .map((id) => scenario.interventions.find((i) => i.id === id))
      .filter((i): i is NonNullable<typeof i> => !!i)
    if (blockers.length && blockers.length <= 2) {
      const xOf = (id: string) => scenario.interventions.find((i) => i.id === id)?.attrs?.crossing
      const half = blockers.length === 1 && applied.some((a) => xOf(a) && xOf(a) === blockers[0].attrs?.crossing)
      const lng = blockers.reduce((a, b) => a + b.lon, 0) / blockers.length
      const lat = blockers.reduce((a, b) => a + b.lat, 0) / blockers.length
      const hypo = scenario.mode === 'hypothetical'
      const check = scenario.id === 'preflight'
      const both = blockers.length === 2 && blockers[0].attrs?.crossing === blockers[1].attrs?.crossing
      out.push({
        key: 'gap', lng, lat, alt: 6,
        text: half ? 'One end still blocked' : check && both ? 'No curb ramps' : both ? 'Blocked crossing' : 'Where the journey breaks',
        sub: check && both && !half ? 'Walkers step the curb · not step-free' : `${blockers.map((b) => b.id).join(' + ')} · ${hypo ? 'hypothetical barrier' : 'recorded barrier'}${blockers.length > 1 ? 's' : ''}`,
        tone: 'gap', dy: -54, dx: draft.length ? 96 : 0,
      })
      out.push({ key: 'burst', lng, lat, alt: 0.5, text: '', tone: 'gap', dy: 0, burst: true })
    }
    // the planner's proposal, pinned where it happens
    for (const c of draft.filter((x) => x.op === 'close').slice(0, 1)) {
      const e = scenario.edges.find((x) => x.id === c.edge_id)
      if (!e) continue
      const [lng, lat] = e.geometry[Math.floor(e.geometry.length / 2)]
      out.push({ key: 'closure', lng, lat, alt: 3, text: 'Proposed closure', sub: 'Hypothetical · construction', tone: 'closure', dy: -54, dx: blockers.length ? -96 : 0 })
    }
    // change check: the route a travel profile keeps, labelled where it diverges
    const ce = verifyRes?.proposed.checks.find((c) => c.regression && c.profile === 'step_free' && c.counterexample)?.counterexample
    if (ce && ceView !== 'none') {
      const r = ceView === 'walking' ? ce.walking_route : ce.best_alternative
      const g = r?.geometry
      if (r?.found && g && g.length > 2) {
        const [lng, lat] = g[Math.floor(g.length * 0.55)]
        const lim = verifyRes?.proposed.metrics.cutoff_m
        out.push({
          key: 'tip', lng, lat, alt: 6,
          text: ceView === 'walking' ? `Walking route · ${Math.round(r.length_m ?? 0)} m` : `Step-free detour · ${Math.round(r.length_m ?? 0)} m`,
          sub: ceView === 'walking' ? `${ce.walking_route?.steps?.length ?? 0} curb steps without ramps` : lim && (r.length_m ?? 0) > lim ? `Over the ${Math.round(lim)} m threshold` : 'Within the threshold',
          tone: 'tip', dy: -30,
        })
      }
    }
    if (hovered && !['origin', 'dest'].includes(hovered)) {
      const [kind, id] = [hovered.slice(0, hovered.indexOf(':')), hovered.slice(hovered.indexOf(':') + 1)]
      if (kind === 'iv') {
        const iv = scenario.interventions.find((i) => i.id === id)
        if (iv) {
          const hypo = !!iv.attrs?.hypothetical
          out.push({
            key: 'tip', lng: iv.lon, lat: iv.lat, alt: 6, text: `${iv.id.length <= 2 ? `${iv.id} · ` : ''}${iv.label}`,
            sub: applied.includes(iv.id) ? 'Repaired in simulation' : hypo ? 'Blocked · hypothetical barrier' : 'Blocked · recorded barrier', tone: 'tip', dy: -36,
          })
        }
      } else {
        const p = places.find((x) => x.id === id)
        if (p && p.id !== journey?.origin && p.id !== journey?.destination) {
          out.push({ key: 'tip', lng: p.lon, lat: p.lat, alt: 4, text: p.label, sub: 'category' in p ? String(p.category) : 'Origin (residential)', tone: 'tip', dy: -28 })
        }
      }
    }
    return out
  }, [scenario, journey, hovered, found, applied, ev, draft, accessOn, diagnosis, accessData, compare, show, ceView, verifyRes])

  useEffect(() => {
    const { layer } = handle
    const place = () => {
      const w = handle.map.getCanvas().clientWidth - panelInset()
      const at = new Map(anchors.map((a) => [a.key, layer.project(a.lng, a.lat, a.alt)]))
      const boxes = new Map<string, [number, number, number, number]>() // x, y, w, h of each text label
      for (const ln of lines.current.values()) ln.style.opacity = '0'
      for (const a of anchors) {
        const el = refs.current.get(a.key)
        if (!el) continue
        const p = at.get(a.key)
        if (!p) {
          el.style.opacity = '0'
          continue
        }
        // anchors under the floating panel (or off the canvas) are not labelled
        if (p[0] < -8 || p[0] > w + 8) {
          el.style.opacity = '0'
          continue
        }
        el.style.opacity = '1'
        if (a.burst) {
          el.style.transform = `translate(${Math.round(p[0])}px, ${Math.round(p[1])}px) translate(-50%, -50%)`
          continue
        }
        if (a.side) {
          // Endpoint labels face away from the other endpoint, so they never cover the
          // route or the repairs between them; flip or clamp to stay on screen.
          const other = at.get(a.key === 'origin' ? 'dest' : 'origin')
          const lw = el.offsetWidth
          let right = other ? p[0] >= other[0] : p[0] < w / 2
          if (right && p[0] + 18 + lw > w - 8 && p[0] - 18 - lw >= 8) right = false
          else if (!right && p[0] - 18 - lw < 8 && p[0] + 18 + lw <= w - 8) right = true
          const x = right ? Math.min(p[0] + 18, w - 8 - lw) : Math.max(p[0] - 18 - lw, 8)
          el.style.transform = `translate(${Math.round(x)}px, ${Math.round(p[1])}px) translate(0, -50%)`
          boxes.set(a.key, [x, p[1] - el.offsetHeight / 2, lw, el.offsetHeight])
        } else {
          const dx = a.dx ?? 0
          el.style.transform = `translate(${Math.round(p[0] + dx)}px, ${Math.round(p[1] + a.dy)}px) translate(-50%, -100%)`
          boxes.set(a.key, [p[0] + dx - el.offsetWidth / 2, p[1] + a.dy - el.offsetHeight, el.offsetWidth, el.offsetHeight])
          const ln = lines.current.get(a.key)
          if (ln) {
            ln.setAttribute('x1', String(p[0]))
            ln.setAttribute('y1', String(p[1]))
            ln.setAttribute('x2', String(p[0] + dx))
            ln.setAttribute('y2', String(p[1] + a.dy))
          }
        }
      }
      // Labels never overlap: when the view is small, lower-priority labels step aside.
      const kept: [number, number, number, number][] = []
      for (const k of ['tip', 'gap', 'closure', 'site', 'fix0', 'fix1', 'fix2', 'dest', 'origin']) {
        const b = boxes.get(k)
        const el = refs.current.get(k)
        if (!b || !el) continue
        const hit = kept.some(([x, y, bw, bh]) => b[0] < x + bw + 4 && x < b[0] + b[2] + 4 && b[1] < y + bh + 4 && y < b[1] + b[3] + 4)
        if (hit) el.style.opacity = '0'
        else kept.push(b)
        const ln = lines.current.get(k)
        if (ln) ln.style.opacity = el.style.opacity
      }
    }
    layer.onRender = place
    place()
    handle.map.triggerRepaint()
    return () => {
      if (layer.onRender === place) layer.onRender = null
    }
  }, [handle, anchors])

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <svg className="absolute inset-0 h-full w-full overflow-visible">
        {anchors
          .filter((a) => a.tone === 'gap' || a.tone === 'closure' || a.tone === 'fix')
          .filter((a) => !a.burst)
          .map((a) => (
            <line
              key={a.key}
              ref={(el) => {
                if (el) lines.current.set(a.key, el)
                else lines.current.delete(a.key)
              }}
              stroke={a.tone === 'gap' ? '#da5a50' : a.tone === 'fix' ? '#10916f' : '#e0742a'}
              strokeWidth={1.5}
            />
          ))}
      </svg>
      {anchors.map((a) =>
        a.burst ? (
          <div
            key={a.key}
            ref={(el) => {
              if (el) refs.current.set(a.key, el)
              else refs.current.delete(a.key)
            }}
            className="absolute left-0 top-0"
            style={{ opacity: 0 }}
          >
            <svg width="96" height="96" viewBox="-48 -48 96 96" className="sm-burst block">
              <circle r="30" fill="rgba(218,90,80,0.10)" stroke="#da5a50" strokeWidth="1.6" strokeDasharray="4 4" />
              {Array.from({ length: 16 }, (_, i) => {
                const a = (i / 16) * Math.PI * 2
                return <line key={i} x1={Math.cos(a) * 36} y1={Math.sin(a) * 36} x2={Math.cos(a) * (i % 2 ? 41 : 45)} y2={Math.sin(a) * (i % 2 ? 41 : 45)} stroke="#da5a50" strokeWidth="1.6" strokeLinecap="round" opacity="0.8" />
              })}
            </svg>
          </div>
        ) : (
        <div
          key={a.key}
          ref={(el) => {
            if (el) refs.current.set(a.key, el)
            else refs.current.delete(a.key)
          }}
          className={`absolute left-0 top-0 max-w-[300px] rounded-xl border-[1.5px] bg-white/95 px-3 py-2 shadow-[0_4px_16px_rgba(25,44,40,0.18)] ${TONE[a.tone]}`}
          style={{ opacity: 0 }}
        >
          <div className={`flex items-center gap-1.5 truncate leading-tight ${a.tone === 'gap' || a.tone === 'closure' ? 'text-[12.5px] font-extrabold tracking-[0.06em] uppercase' : 'text-[13px] font-bold'}`}>
            {(a.tone === 'gap' || a.tone === 'closure') && (
              <svg width="14" height="13" viewBox="0 0 14 13" aria-hidden className="shrink-0">
                <path d="M7 0.8 L13.4 12.2 H0.6 Z" fill={a.tone === 'gap' ? '#da5a50' : '#e0742a'} stroke={a.tone === 'gap' ? '#da5a50' : '#e0742a'} strokeWidth="1.2" strokeLinejoin="round" />
                <path d="M7 4.6 V8.2" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
                <circle cx="7" cy="10.2" r="0.95" fill="#fff" />
              </svg>
            )}
            {a.text}
          </div>
          {a.sub && (
            <div className={`mt-0.5 text-[11px] font-semibold leading-tight ${a.tone === 'dest-bad' ? 'text-bad-ink' : a.tone === 'dest-ok' ? 'text-ok-ink' : 'text-ink-2'}`}>{a.sub}</div>
          )}
        </div>
        ),
      )}
    </div>
  )
}
