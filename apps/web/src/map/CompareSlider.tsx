import { useRef } from 'react'
import { useApp } from '../state/store'

/** Before/after split: the left side renders the unrepaired network, the right
 * side the current repairs; same camera, same buildings, same basemap. */
export function CompareSlider() {
  const split = useApp((s) => s.split)
  const setSplit = useApp((s) => s.setSplit)
  const before = useApp((s) => s.initialEval?.metrics)
  const after = useApp((s) => s.evaluation?.metrics)
  const applied = useApp((s) => s.applied)
  const presenting = useApp((s) => s.presenting)
  const box = useRef<HTMLDivElement>(null)
  const drag = (clientX: number) => {
    const r = box.current?.getBoundingClientRect()
    if (r) setSplit((clientX - r.left) / r.width)
  }
  return (
    <div ref={box} className="pointer-events-none absolute inset-0" data-testid="compare">
      <div className="absolute inset-y-0 w-0" style={{ left: `${split * 100}%` }}>
        <div className="absolute inset-y-0 -left-px w-0.5 bg-white shadow-[0_0_0_1px_rgba(34,52,45,0.25)]" />
        <button
          type="button"
          role="slider"
          aria-label="Before and after comparison position"
          aria-valuemin={5}
          aria-valuemax={95}
          aria-valuenow={Math.round(split * 100)}
          className="pointer-events-auto absolute top-1/2 -left-4 grid h-8 w-8 -translate-y-1/2 cursor-ew-resize place-items-center rounded-full border border-line bg-white text-ink-2 shadow-md"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            drag(e.clientX)
          }}
          onPointerMove={(e) => e.buttons && drag(e.clientX)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') setSplit(split - 0.05)
            if (e.key === 'ArrowRight') setSplit(split + 0.05)
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
            <path d="M5 3 L1.5 7 L5 11 M9 3 L12.5 7 L9 11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {/* side captions travel with the divider near its foot (above the presentation bar when it is up),
            leaving the map centre and the chrome in the corners clear */}
        <div className={`absolute right-3 whitespace-nowrap ${presenting ? 'bottom-[184px]' : 'bottom-12'} rounded-md border border-line bg-white/95 px-2.5 py-1.5 text-right text-[11.5px] shadow-sm`} data-testid="compare-before">
          <div className="font-semibold text-ink">Before repairs</div>
          <div className="text-ink-2">{before ? `${before.connected_pairs} of ${before.total_pairs} journeys connected` : '—'}</div>
        </div>
        <div className={`absolute left-3 whitespace-nowrap ${presenting ? 'bottom-[184px]' : 'bottom-12'} rounded-md border border-ok/40 bg-white/95 px-2.5 py-1.5 text-[11.5px] shadow-sm`} data-testid="compare-after">
          <div className="font-semibold text-ink">After {applied.length ? applied.join(' + ') : 'no repairs'}</div>
          <div className="text-ok-ink">{after ? `${after.connected_pairs} of ${after.total_pairs} journeys connected` : '—'}</div>
        </div>
      </div>
    </div>
  )
}
