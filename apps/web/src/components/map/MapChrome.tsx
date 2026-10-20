import { AnimatePresence, motion } from 'motion/react'
import { ChevronLeft, ChevronRight, Eye, Layers, LayoutGrid, Map as MapIcon, Navigation, Network, RotateCcw, Undo2, X } from 'lucide-react'
import { useState } from 'react'
import { SCENES, useApp, type CameraPreset, type Layers as LayerState } from '../../state/store'
import { Tip } from '../ui'

export function ScenarioBadge() {
  const sc = useApp((s) => s.scenario)
  const [open, setOpen] = useState(false)
  if (!sc) return null
  const hypo = sc.mode === 'hypothetical'
  return (
    <div className="pointer-events-auto relative">
      <button onClick={() => setOpen(!open)} aria-expanded={open} data-testid="data-status"
        className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[12px] font-medium shadow-sm ${hypo ? 'border-unk/50 bg-paper text-unk-ink' : 'border-sel/30 bg-paper text-sel-ink'}`}>
        <span className={`h-2 w-2 rounded-full ${hypo ? 'bg-unk' : 'bg-sel'}`} aria-hidden />
        {hypo ? 'Hypothetical barriers · real Charlotte streets' : 'Municipal records · CDOT surveys 2017–2019'}
      </button>
      {open && (
        <div className="absolute left-0 top-10 z-40 w-[320px] rounded-lg border border-line bg-paper p-3 text-[12px] leading-snug text-ink shadow-xl">
          {hypo ? (
            <>
              <p className="font-semibold">Guided scenario</p>
              <p className="mt-1 text-ink-2">
                Streets, crossings, buildings and destinations are real (OpenStreetMap, City of Charlotte). The blocked curb ramps are <b className="text-ink">hypothetical scenario settings</b>{' '}
                chosen to demonstrate dependent repairs. They are not survey findings and say nothing about actual conditions at these locations.
              </p>
            </>
          ) : (
            <>
              <p className="font-semibold">Charlotte Data Explorer</p>
              <p className="mt-1 text-ink-2">
                Real CDOT curb-ramp and sidewalk records, under the selected passability policy. Surveys are historical (mostly 2017–2019). Links without records are unknown and excluded.
              </p>
            </>
          )}
          <button className="btn-ghost mt-1 px-0 text-sel-ink" onClick={() => { setOpen(false); useApp.getState().setDialog('methods') }}>
            Sources & methods →
          </button>
        </div>
      )}
    </div>
  )
}

const PRESETS: { k: CameraPreset; label: string; Icon: typeof Eye }[] = [
  { k: 'overview', label: 'Overview', Icon: Eye },
  { k: 'street', label: 'Street focus', Icon: Navigation },
  { k: 'network', label: 'Network view', Icon: Network },
  { k: 'top', label: 'Top-down', Icon: LayoutGrid },
]

const LAYER_LABELS: Record<keyof LayerState, string> = {
  buildings: '3D buildings',
  network: 'Pedestrian network',
  candidates: 'Repair candidates',
  places: 'Origins & destinations',
  records: 'CDOT ramp records',
  inventory: 'CDOT sidewalk inventory',
}

export function CameraToolbar() {
  const layers = useApp((s) => s.layers)
  const municipal = useApp((s) => s.scenario?.mode === 'municipal')
  const applied = useApp((s) => s.applied)
  const canUndo = useApp((s) => s.history.length > 0)
  const { cameraTo, toggleLayer, undo, reset } = useApp.getState()
  const [open, setOpen] = useState(false)
  const btn = 'grid h-8 w-8 place-items-center text-ink-2 hover:bg-wash hover:text-ink'
  return (
    <div className="pointer-events-auto flex flex-col items-end gap-2 max-sm:items-start">
      <div className="flex overflow-hidden rounded-lg border border-line bg-paper shadow-sm" role="toolbar" aria-label="Camera presets">
        {PRESETS.map(({ k, label, Icon }) => (
          <Tip key={k} text={label} side="bottom">
            <button className={btn} onClick={() => cameraTo({ preset: k })} aria-label={label} data-testid={`cam-${k}`}>
              <Icon size={15} aria-hidden />
            </button>
          </Tip>
        ))}
        <div className="w-px bg-line" />
        <Tip text="Map layers" side="bottom">
          <button className={btn} onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Map layers" data-testid="layers">
            <Layers size={15} aria-hidden />
          </button>
        </Tip>
      </div>
      {open && (
        <div className="w-56 rounded-lg border border-line bg-paper p-1.5 shadow-xl">
          {(Object.keys(LAYER_LABELS) as (keyof LayerState)[])
            .filter((k) => municipal || (k !== 'records' && k !== 'inventory'))
            .map((k) => (
              <label key={k} className="flex cursor-pointer items-center justify-between rounded px-2 py-1.5 text-[12.5px] text-ink hover:bg-wash">
                {LAYER_LABELS[k]}
                <input type="checkbox" checked={layers[k]} onChange={() => toggleLayer(k)} className="accent-sel" />
              </label>
            ))}
        </div>
      )}
      <div className="flex overflow-hidden rounded-lg border border-line bg-paper shadow-sm">
        <Tip text="Undo last repair change" side="left">
          <button className={btn} onClick={() => void undo()} disabled={!canUndo} aria-label="Undo" data-testid="undo">
            <Undo2 size={15} aria-hidden />
          </button>
        </Tip>
        <Tip text="Reset all repairs" side="left">
          <button className={btn} onClick={() => void reset()} disabled={!applied.length} aria-label="Reset all repairs" data-testid="reset">
            <RotateCcw size={15} aria-hidden />
          </button>
        </Tip>
      </div>
    </div>
  )
}

function Swatch({ kind }: { kind: string }) {
  switch (kind) {
    case 'trav':
      return <span className="h-[3px] w-6 rounded bg-[#7f8f87]" />
    case 'route':
      return <span className="h-[5px] w-6 rounded bg-ok ring-2 ring-white" />
    case 'reach':
      return <span className="h-[5px] w-6 rounded bg-ok/30" />
    case 'pot':
      return <span className="w-6 border-t-[3px] border-dashed border-sel" />
    case 'blocked':
      return <span className="w-6 border-t-[3px] border-dashed border-bad" />
    case 'setting':
      return <span className="w-6 border-t-[3px] border-dashed border-ink-3" />
    case 'unk':
      return <span className="w-6 border-t-[3px] border-dotted border-unk" />
    default:
      return null
  }
}

export function Legend() {
  const [open, setOpen] = useState(false)
  const hypo = useApp((s) => s.scenario?.mode === 'hypothetical')
  const items: [string, string][] = [
    ['route', 'Modeled step-free route'],
    ['reach', 'Reachable from the origin'],
    ['pot', 'Route if barriers were repaired'],
    ['trav', 'Traversable link (modeled)'],
    ['blocked', 'Blocked curb ramp'],
    ...(hypo ? ([['setting', 'No crossing (scenario setting)']] as [string, string][]) : ([['unk', 'Unknown condition (excluded)']] as [string, string][])),
  ]
  return (
    <div className="pointer-events-auto rounded-lg border border-line bg-paper/95 shadow-sm">
      <button className="flex w-full items-center gap-2 px-2.5 py-1.5 text-[12px] font-medium text-ink-2 hover:text-ink" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="legend">
        <MapIcon size={13} aria-hidden /> Legend
      </button>
      {open && (
        <div className="space-y-1 px-2.5 pb-2.5">
          {items.map(([k, label]) => (
            <div key={k} className="flex items-center gap-2 text-[11.5px] text-ink">
              <span className="flex w-6 justify-center">
                <Swatch kind={k} />
              </span>
              {label}
            </div>
          ))}
          <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-1 border-t border-line pt-1.5 text-[11px] text-ink-2">
            <span className="flex items-center gap-1.5"><Dot cls="border-bad bg-white" glyph="—" glyphCls="text-bad" /> Blocked</span>
            <span className="flex items-center gap-1.5"><Dot cls="border-white bg-sel" glyph="A" glyphCls="text-white" /> Recommended</span>
            <span className="flex items-center gap-1.5"><Dot cls="border-white bg-ok" glyph="✓" glyphCls="text-white" /> Repaired</span>
            <span className="flex items-center gap-1.5"><Dot cls="border-white bg-unk" glyph="?" glyphCls="text-white" /> Uncertain</span>
          </div>
          <p className="pt-1 text-[10.5px] leading-snug text-ink-3">Building heights: OSM tags where present, otherwise estimated by building type (visual only).</p>
        </div>
      )}
    </div>
  )
}

function Dot({ cls, glyph, glyphCls }: { cls: string; glyph: string; glyphCls: string }) {
  return <span className={`grid h-4 w-4 place-items-center rounded-full border-2 text-[8px] font-bold ${cls} ${glyphCls}`}>{glyph}</span>
}

export function Banner() {
  const banner = useApp((s) => s.banner)
  const dismiss = useApp((s) => s.dismissBanner)
  return (
    <AnimatePresence mode="wait">
      {banner && (
        <motion.div key={banner.nonce} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.3 }}
          className={`pointer-events-auto relative max-w-[520px] rounded-lg border bg-paper px-4 py-3 shadow-[0_6px_24px_rgba(30,50,40,0.16)] ${banner.kind === 'reconnected' ? 'border-ok/50' : 'border-line'}`}
          role="status" data-testid="banner">
          <button className="absolute right-1.5 top-1.5 rounded p-1 text-ink-3 hover:text-ink" onClick={dismiss} aria-label="Dismiss">
            <X size={13} />
          </button>
          <div className={`pr-5 ${banner.kind === 'reconnected' ? 'text-[15px] font-bold tracking-[0.04em] text-ok-ink' : 'text-[13.5px] font-semibold text-ink'}`} data-testid="banner-title">
            {banner.title}
          </div>
          {banner.body && <p className="mt-1 text-[12.5px] leading-snug text-ink-2">{banner.body}</p>}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function PresentationBar() {
  const presenting = useApp((s) => s.presenting)
  const scene = useApp((s) => s.scene)
  const busy = useApp((s) => s.sceneBusy)
  const { goToScene, stopPresentation } = useApp.getState()
  if (!presenting) return null
  const s = SCENES[scene]
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="pointer-events-auto w-[min(640px,calc(100vw-24px))] rounded-xl border border-line bg-paper p-3 shadow-[0_8px_30px_rgba(30,50,40,0.18)]" data-testid="presentation" role="region" aria-label="Guided presentation">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="eyebrow">Scene {scene + 1} of {SCENES.length}</div>
          <div className="mt-0.5 text-[14px] font-semibold text-ink" data-testid="scene-title">{s.title}</div>
          <p className="mt-0.5 text-[12.5px] leading-snug text-ink-2">{s.caption}</p>
        </div>
        <button className="btn-ghost px-1.5" onClick={stopPresentation} aria-label="Exit presentation">
          <X size={15} />
        </button>
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <div className="flex flex-1 gap-1" aria-hidden>
          {SCENES.map((_, i) => (
            <button key={i} tabIndex={-1} onClick={() => void goToScene(i)} className={`h-1.5 flex-1 rounded-full ${i <= scene ? 'bg-sel' : 'bg-line-2'}`} />
          ))}
        </div>
        <button className="btn-secondary px-2 py-1 text-[12px]" disabled={scene === 0 || busy} onClick={() => void goToScene(scene - 1)} data-testid="scene-prev">
          <ChevronLeft size={13} /> Back
        </button>
        <button className="btn-primary px-3 py-1 text-[12px]" disabled={scene === SCENES.length - 1 || busy} onClick={() => void goToScene(scene + 1)} data-testid="scene-next">
          Next <ChevronRight size={13} />
        </button>
      </div>
    </motion.div>
  )
}
