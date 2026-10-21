import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, ArrowRight, Crosshair, Layers, LocateFixed, Map as MapIcon, Minus, Plus, Route, Scan, X } from 'lucide-react'
import { useState } from 'react'
import { scenesFor, useApp, type CameraPreset, type Layers as LayerState } from '../../state/store'
import { Tip } from '../ui'

/** Always-visible honesty indicator: what is real, what is modeled. */
export function ScenarioBadge() {
  const sc = useApp((s) => s.scenario)
  const [open, setOpen] = useState(false)
  if (!sc) return null
  const hypo = sc.mode === 'hypothetical'
  return (
    <div className="pointer-events-auto relative">
      <button onClick={() => setOpen(!open)} aria-expanded={open} data-testid="data-status" className="surface flex items-center gap-2 rounded-full px-3 py-1.5 text-[12px] font-semibold text-ink">
        <span className={`h-2 w-2 rounded-full ${hypo ? 'bg-unk' : 'bg-sel'}`} aria-hidden />
        {hypo ? (
          <>
            Modeled scenario <span className="font-medium text-ink-3">·</span> <span className="font-medium text-ink-2">Real Charlotte geography</span>
          </>
        ) : (
          <>
            Municipal records <span className="font-medium text-ink-3">·</span> <span className="font-medium text-ink-2">CDOT surveys 2017–2019</span>
          </>
        )}
      </button>
      {open && (
        <div className="surface absolute left-0 top-10 z-40 w-[320px] p-3.5 text-[12.5px] leading-relaxed text-ink">
          {hypo ? (
            <>
              <p className="font-bold">What is real here</p>
              <p className="mt-1 text-ink-2">
                Streets, crossings, buildings and destinations are real (OpenStreetMap, City of Charlotte). The blocked curb ramps are <b className="text-ink">hypothetical scenario settings</b>{' '}
                chosen to demonstrate dependent repairs. They are not survey findings and say nothing about actual conditions at these locations.
              </p>
            </>
          ) : (
            <>
              <p className="font-bold">Charlotte Data Explorer</p>
              <p className="mt-1 text-ink-2">Real CDOT curb-ramp and sidewalk records under the selected passability policy. Surveys are historical (mostly 2017–2019). Links without records are unknown and excluded.</p>
            </>
          )}
          <button className="btn-ghost mt-1 -ml-2 text-sel-ink" onClick={() => { setOpen(false); useApp.getState().setDialog('methods') }}>
            Sources & methods →
          </button>
        </div>
      )}
    </div>
  )
}

const PRESETS: { k: CameraPreset; label: string; Icon: typeof Route }[] = [
  { k: 'overview', label: 'Overview: the study area', Icon: Scan },
  { k: 'journey', label: 'Selected journey', Icon: Route },
  { k: 'street', label: 'Crossing inspection', Icon: Crosshair },
]

const LAYER_LABELS: Record<keyof LayerState, string> = {
  buildings: '3D buildings',
  network: 'Pedestrian network',
  candidates: 'Repair candidates',
  places: 'Origins & destinations',
  trees: 'Tree canopy',
  records: 'CDOT ramp records',
  inventory: 'CDOT sidewalk inventory',
}

/** One compact instrument: view mode, camera, layers, reset. */
export function MapToolbar() {
  const layers = useApp((s) => s.layers)
  const mapMode = useApp((s) => s.mapMode)
  const municipal = useApp((s) => s.scenario?.mode === 'municipal')
  const { cameraTo, toggleLayer, setMapMode } = useApp.getState()
  const [open, setOpen] = useState(false)
  const btn = 'grid h-9 w-9 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-wash hover:text-ink'
  return (
    <div className="pointer-events-auto relative flex flex-col items-end gap-2 max-sm:flex-row max-sm:items-end">
      <div className="surface flex flex-col gap-0.5 p-1 max-sm:flex-row" role="toolbar" aria-label="Map controls">
        <div role="radiogroup" aria-label="Map view" className="flex flex-col gap-0.5 rounded-lg bg-wash p-0.5 max-sm:flex-row" data-testid="map-mode">
          {(['3d', '2d'] as const).map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={mapMode === m}
              onClick={() => setMapMode(m)}
              title={m === '3d' ? '3D city' : '2D precision map'}
              className={`h-8 w-8 rounded-md text-[11.5px] font-bold transition-colors ${mapMode === m ? 'bg-ink text-white' : 'text-ink-2 hover:text-ink'}`}
            >
              {m.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="mx-1.5 my-1 h-px bg-line max-sm:mx-1 max-sm:my-1.5 max-sm:h-auto max-sm:w-px" />
        {PRESETS.map(({ k, label, Icon }) => (
          <Tip key={k} text={label} side="left">
            <button className={btn} onClick={() => cameraTo({ preset: k })} aria-label={label} data-testid={`cam-${k}`}>
              <Icon size={16} aria-hidden />
            </button>
          </Tip>
        ))}
        <Tip text="Layers" side="left">
          <button className={`${btn} ${open ? 'bg-wash text-ink' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Map layers" data-testid="layers">
            <Layers size={16} aria-hidden />
          </button>
        </Tip>
        <div className="mx-1.5 my-1 h-px bg-line max-sm:mx-1 max-sm:my-1.5 max-sm:h-auto max-sm:w-px" />
        <Tip text="Reset view" side="left">
          <button className={btn} onClick={() => cameraTo({ preset: 'journey' })} aria-label="Reset view" data-testid="cam-reset">
            <LocateFixed size={16} aria-hidden />
          </button>
        </Tip>
        <div className="mx-1.5 my-1 h-px bg-line max-sm:hidden" />
        <button className={`${btn} max-sm:hidden`} onClick={() => window.__sm?.map.zoomIn()} aria-label="Zoom in" data-testid="zoom-in">
          <Plus size={16} aria-hidden />
        </button>
        <button className={`${btn} max-sm:hidden`} onClick={() => window.__sm?.map.zoomOut()} aria-label="Zoom out" data-testid="zoom-out">
          <Minus size={16} aria-hidden />
        </button>
      </div>
      {open && (
        <div className="surface absolute right-[52px] top-[96px] w-56 p-1.5 max-sm:right-auto max-sm:bottom-12 max-sm:left-0 max-sm:top-auto">
          {(Object.keys(LAYER_LABELS) as (keyof LayerState)[])
            .filter((k) => municipal || (k !== 'records' && k !== 'inventory'))
            .map((k) => (
              <label key={k} className="flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-1.5 text-[12.5px] text-ink hover:bg-wash">
                {LAYER_LABELS[k]}
                <input type="checkbox" checked={layers[k]} onChange={() => toggleLayer(k)} className="accent-ok" />
              </label>
            ))}
        </div>
      )}
    </div>
  )
}

/** Kept for existing imports. */
export const CameraToolbar = MapToolbar

function Swatch({ kind }: { kind: string }) {
  switch (kind) {
    case 'trav':
      return <span className="h-[2px] w-6 rounded bg-[#7b7f77]/60" />
    case 'route':
      return <span className="h-[5px] w-6 rounded bg-ok ring-2 ring-white" />
    case 'journey':
      return <span className="h-[3px] w-6 rounded bg-ink" />
    case 'gap':
      return <span className="w-6 border-t-[3px] border-dashed border-bad" />
    case 'blocked':
      return <span className="w-6 border-t-2 border-dashed border-bad/60" />
    case 'setting':
      return <span className="w-6 border-t-2 border-dashed border-[#c7867e]" />
    case 'unk':
      return <span className="w-6 border-t-2 border-dotted border-unk" />
    default:
      return null
  }
}

export function Legend() {
  const [open, setOpen] = useState(false)
  const hypo = useApp((s) => s.scenario?.mode === 'hypothetical')
  const items: [string, string][] = [
    ['route', 'Connected route (computed)'],
    ['journey', 'Selected journey, still broken'],
    ['gap', 'Where it breaks'],
    ['trav', 'Modeled pedestrian network'],
    ['blocked', 'Other blocked curb ramps'],
    ...(hypo ? ([['setting', 'No crossing (scenario setting)']] as [string, string][]) : ([['unk', 'Unknown condition (excluded)']] as [string, string][])),
  ]
  return (
    <div className="surface pointer-events-auto">
      <button className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] font-semibold text-ink-2 hover:text-ink" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="legend">
        <MapIcon size={13} aria-hidden /> Map legend
      </button>
      {open && (
        <div className="space-y-1 px-3 pb-3">
          {items.map(([k, label]) => (
            <div key={k} className="flex items-center gap-2.5 text-[11.5px] text-ink">
              <span className="flex w-6 justify-center">
                <Swatch kind={k} />
              </span>
              {label}
            </div>
          ))}
          <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-1 border-t border-line pt-2 text-[11px] text-ink-2">
            <span className="flex items-center gap-1.5"><Dot cls="border-bad bg-white" glyph="A" glyphCls="text-bad" /> Blocked</span>
            <span className="flex items-center gap-1.5"><Dot cls="border-white bg-sel" glyph="A" glyphCls="text-white" /> Recommended</span>
            <span className="flex items-center gap-1.5"><Dot cls="border-white bg-ok" glyph="✓" glyphCls="text-white" /> Repaired</span>
            <span className="flex items-center gap-1.5"><Dot cls="border-white bg-unk" glyph="?" glyphCls="text-white" /> Uncertain</span>
          </div>
          <p className="pt-1 text-[10.5px] leading-snug text-ink-3">Building heights: OSM tags where present, otherwise estimated by type. Trees: canopy amount per area from the City's 2022 assessment; positions illustrative except OSM-mapped trees. Visual only.</p>
        </div>
      )}
    </div>
  )
}

function Dot({ cls, glyph, glyphCls }: { cls: string; glyph: string; glyphCls: string }) {
  return <span className={`grid h-4 w-4 place-items-center rounded-full border-2 text-[8px] font-bold ${cls} ${glyphCls}`}>{glyph}</span>
}

/** Narration of a repair, written only from engine-verified facts. */
export function Banner() {
  const banner = useApp((s) => s.banner)
  const dismiss = useApp((s) => s.dismissBanner)
  return (
    <AnimatePresence mode="wait">
      {banner && (
        <motion.div
          key={banner.nonce}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className={`surface pointer-events-auto relative max-w-[460px] px-4 py-3.5 ${banner.kind === 'reconnected' ? 'border-ok/40' : ''}`}
          role="status"
          data-testid="banner"
        >
          <button className="absolute right-2 top-2 rounded p-1 text-ink-3 hover:text-ink" onClick={dismiss} aria-label="Dismiss">
            <X size={13} />
          </button>
          {banner.kind === 'reconnected' && <div className="mb-1 h-[3px] w-10 rounded-full bg-ok" aria-hidden />}
          <div className={`pr-6 ${banner.kind === 'reconnected' ? 'text-[13px] font-extrabold tracking-[0.1em] text-ok-ink' : 'text-[14px] font-bold text-ink'}`} data-testid="banner-title">
            {banner.title}
          </div>
          {banner.body && <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{banner.body}</p>}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Presentation mode: an editorial step card over the live map. */
export function PresentationBar() {
  const presenting = useApp((s) => s.presenting)
  const scene = useApp((s) => s.scene)
  const busy = useApp((s) => s.sceneBusy)
  const SCENES = scenesFor(useApp((s) => s.scenarioId))
  const { goToScene, stopPresentation } = useApp.getState()
  if (!presenting) return null
  const s = SCENES[scene] ?? SCENES[0]
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ease: [0.22, 1, 0.36, 1], duration: 0.45 }}
      className="surface pointer-events-auto w-[min(560px,calc(100vw-24px))] p-5"
      data-testid="presentation"
      role="region"
      aria-label="Guided presentation"
    >
      <div className="flex items-start gap-4">
        <div className="display text-[44px] leading-none text-ok tnum" aria-hidden>
          {String(scene + 1).padStart(2, '0')}
        </div>
        <div className="min-w-0 flex-1">
          <div className="eyebrow">
            Step {scene + 1} of {SCENES.length}
          </div>
          <AnimatePresence mode="wait">
            <motion.div key={scene} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
              <div className="display mt-1 text-[26px] text-ink" data-testid="scene-title">
                {s.title}
              </div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{s.caption}</p>
            </motion.div>
          </AnimatePresence>
        </div>
        <button className="btn-ghost -mr-2 -mt-1 px-1.5" onClick={stopPresentation} aria-label="Exit presentation">
          <X size={16} />
        </button>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <div className="flex flex-1 gap-1.5" aria-hidden>
          {SCENES.map((_, i) => (
            <button key={i} tabIndex={-1} onClick={() => void goToScene(i)} className={`h-1 flex-1 rounded-full transition-colors ${i < scene ? 'bg-ok' : i === scene ? 'bg-ink' : 'bg-line-2'}`} />
          ))}
        </div>
        <button className="btn-secondary px-2.5 py-1.5 text-[12.5px]" disabled={scene === 0 || busy} onClick={() => void goToScene(scene - 1)} data-testid="scene-prev">
          <ArrowLeft size={13} /> Back
        </button>
        <button className="btn-primary rounded-lg px-3.5 py-1.5 text-[12.5px]" disabled={scene === SCENES.length - 1 || busy} onClick={() => void goToScene(scene + 1)} data-testid="scene-next">
          Next <ArrowRight size={13} />
        </button>
      </div>
    </motion.div>
  )
}
