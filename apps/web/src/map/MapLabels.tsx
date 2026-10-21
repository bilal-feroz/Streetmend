import { useEffect, useMemo, useRef } from 'react'
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
  tone: 'origin' | 'dest-ok' | 'dest-bad' | 'tip'
  dy: number
  side?: boolean // place beside the marker instead of above it
}

const TONE: Record<Anchor['tone'], string> = {
  origin: 'border-sel/40 text-ink',
  'dest-ok': 'border-ok/50 text-ink',
  'dest-bad': 'border-bad/50 text-ink',
  tip: 'border-line text-ink',
}

/** DOM labels pinned to geographic points; positions are written every frame
 * from the Three.js camera (no React re-render per frame). */
export function MapLabels({ handle }: { handle: MapHandle }) {
  const scenario = useApp((s) => s.scenario)
  const journey = useApp((s) => s.journey)
  const hovered = useApp((s) => s.hovered)
  const applied = useApp((s) => s.applied)
  const found = useApp((s) => (s.compare === 'before' ? s.initialEval : s.evaluation)?.journey?.route.found ?? false)
  const refs = useRef(new Map<string, HTMLDivElement>())

  const anchors = useMemo<Anchor[]>(() => {
    if (!scenario) return []
    const out: Anchor[] = []
    const places = [...scenario.origins, ...scenario.destinations]
    const o = places.find((p) => p.id === journey?.origin)
    const d = places.find((p) => p.id === journey?.destination)
    if (o) out.push({ key: 'origin', lng: o.lon, lat: o.lat, alt: 4, text: o.label.replace(/ \(\d+ bldg\)$/, ''), sub: 'Origin', tone: 'origin', dy: 0, side: true })
    if (d) out.push({ key: 'dest', lng: d.lon, lat: d.lat, alt: 4, text: d.label, sub: found ? 'Reachable' : 'Not reachable', tone: found ? 'dest-ok' : 'dest-bad', dy: 0, side: true })
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
  }, [scenario, journey, hovered, found, applied])

  useEffect(() => {
    const { layer } = handle
    const place = () => {
      const w = handle.map.getCanvas().clientWidth - panelInset()
      const at = new Map(anchors.map((a) => [a.key, layer.project(a.lng, a.lat, a.alt)]))
      for (const a of anchors) {
        const el = refs.current.get(a.key)
        if (!el) continue
        const p = at.get(a.key)
        if (!p) {
          el.style.opacity = '0'
          continue
        }
        el.style.opacity = '1'
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
        } else {
          el.style.transform = `translate(${Math.round(p[0])}px, ${Math.round(p[1] + a.dy)}px) translate(-50%, -100%)`
        }
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
      {anchors.map((a) => (
        <div
          key={a.key}
          ref={(el) => {
            if (el) refs.current.set(a.key, el)
            else refs.current.delete(a.key)
          }}
          className={`absolute left-0 top-0 max-w-[300px] rounded-md border bg-white/95 px-2 py-1 shadow-[0_2px_8px_rgba(30,50,40,0.14)] ${TONE[a.tone]}`}
          style={{ opacity: 0 }}
        >
          <div className="truncate text-[12px] font-semibold leading-tight">{a.text}</div>
          {a.sub && (
            <div className={`text-[10.5px] font-medium leading-tight ${a.tone === 'dest-bad' ? 'text-bad-ink' : a.tone === 'dest-ok' ? 'text-ok-ink' : 'text-ink-2'}`}>{a.sub}</div>
          )}
        </div>
      ))}
    </div>
  )
}
