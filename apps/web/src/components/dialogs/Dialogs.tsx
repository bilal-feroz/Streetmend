import { ExternalLink, X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { useApp } from '../../state/store'
import { EvidenceBody } from './EvidenceDialog'

function Modal({ open, title, onClose, children, testId, width = 720 }: { open: boolean; title: string; onClose: () => void; children: ReactNode; testId: string; width?: number }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog ref={ref} onClose={onClose} onClick={(e) => e.target === ref.current && onClose()} aria-labelledby={`${testId}-t`} data-testid={testId}
      className="m-auto max-h-[86vh] overflow-hidden rounded-xl border border-line bg-paper p-0 text-ink shadow-2xl backdrop:bg-[#22342d]/35" style={{ width: `min(${width}px, 94vw)` }}>
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 id={`${testId}-t`} className="text-[15px] font-semibold">
          {title}
        </h2>
        <button className="rounded p-1 text-ink-3 hover:bg-wash hover:text-ink" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
      </div>
      <div className="scroll-thin max-h-[calc(86vh-52px)] overflow-y-auto px-5 py-4 text-[13px] leading-relaxed text-ink-2">{children}</div>
    </dialog>
  )
}

function H({ children }: { children: ReactNode }) {
  return <h3 className="mt-5 mb-1.5 text-[13px] font-semibold text-ink first:mt-0">{children}</h3>
}

export function Dialogs() {
  const dialog = useApp((s) => s.dialog)
  const setDialog = useApp((s) => s.setDialog)
  const close = () => setDialog(null)
  return (
    <>
      <MethodsDialog open={dialog === 'methods'} onClose={close} />
      <HelpDialog open={dialog === 'help'} onClose={close} />
      <SettingsDialog open={dialog === 'settings'} onClose={close} />
      <Modal open={dialog === 'evidence'} onClose={close} title="Evidence: the reproducible evaluation" testId="evidence-dialog" width={760}>
        {dialog === 'evidence' && <EvidenceBody />}
      </Modal>
    </>
  )
}

function MethodsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const sc = useApp((s) => s.scenario)
  const a = useApp((s) => s.analysis)
  return (
    <Modal open={open} onClose={onClose} title="Sources & methods" testId="methodology">
      <H>What StreetMend computes</H>
      <p>
        StreetMend models the pedestrian network as a graph of sidewalk corners, curb-ramp landings and crossings. A crossing is usable only if the crossing and the curb ramps at{' '}
        <em>both</em> ends are traversable. Given candidate repairs and a repair budget, it finds the set that maximizes weighted origin–destination access:
      </p>
      <pre className="mt-2 overflow-x-auto rounded-md bg-wash px-3 py-2 font-mono text-[12px] text-ink">Score(S) = Σₒ Σ_d  wₒ · w_cat(d) · w_d · 1[ dist_S(o, d) ≤ L ]</pre>
      <p className="mt-2">
        dist_S is the shortest network distance (Dijkstra, metres) over links that are traversable in the model or made traversable by repairs in S; L is the access threshold. Weights
        are planning priorities, not population counts.
      </p>
      <H>Search and baselines</H>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <b className="text-ink">Exact enumeration</b> of every repair set within the budget (after sound pruning of candidates that cannot lie on any within-threshold path). Optimal
          for the stated candidates, objective and threshold. Used up to 150,000 combinations.
        </li>
        <li>
          <b className="text-ink">Beam search</b> beyond that, seeded with the exact optimum for a smaller budget and never reported below greedy. Always labeled approximate.
        </li>
        <li>
          <b className="text-ink">Baselines</b>, implemented as shown and not weakened: greedy (best next repair), individual ranking, and nearest-to-destination.
        </li>
      </ul>
      {a && (
        <p className="mt-2 rounded-md bg-wash px-3 py-2 text-[12px]">
          Last analysis: {a.recommendation.solver.replace('_', ' ')}, {a.recommendation.evaluations.toLocaleString()} combinations evaluated, {a.recommendation.considered_count} of{' '}
          {a.recommendation.candidate_count} candidates after pruning, {a.recommendation.runtime_ms.toFixed(1)} ms.
        </p>
      )}
      <H>Guided scenario (hypothetical barriers on real streets)</H>
      <p>
        The guided scenario uses the real Elizabeth street graph, real places and real building footprints. Every modeled link is assumed traversable except a small set of{' '}
        <b className="text-ink">hypothetical barriers</b>: both curb ramps of one East 7th Street crossing (A, B), two "no crossing" settings, and two decoy ramps (D, E). The design was
        produced by <code>scripts/scenarios/design_guided.py</code> and verified by the engine and tests: neither A nor B alone reconnects the journey; together they do. These are scenario
        settings, not survey findings or claims about actual conditions.
      </p>
      <H>Charlotte Data Explorer</H>
      <p>
        Real CDOT ADA curb-ramp records (320 in the study area, surveyed mostly 2017–2019) and Sidewalk Inventory segments, matched to an OpenStreetMap-derived corner graph. Ramp
        passability follows a selectable policy (strict / severe defects / missing only). Links without a matching record are unknown and excluded from modeled traversability.
      </p>
      <H>3D city</H>
      <p>
        5,113 OpenStreetMap building footprints (Elizabeth plus the eastern edge of Uptown) extruded with Three.js inside MapLibre's WebGL context. Heights come from OSM height tags
        (333 buildings) or levels (59). The rest use type-based estimates, which are a visualization assumption. The Three.js camera is derived from MapLibre's own projection, so
        buildings, network and markers stay aligned with the basemap. Buildings are visual context and do not enter the graph.
      </p>
      <H>This scenario</H>
      <ul className="list-disc space-y-1 pl-5">{sc?.assumptions.map((x) => <li key={x}>{x}</li>)}</ul>
      <H>Sources</H>
      <ul className="space-y-1.5">
        {sc?.provenance.map((p) => (
          <li key={p.id} className="rounded-md border border-line px-3 py-2">
            <div className="font-medium text-ink">{p.name}</div>
            {p.description && <div className="text-[12px]">{p.description}</div>}
            <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11.5px] text-ink-3">
              {p.retrieved_at && <span>Retrieved {String(p.retrieved_at).slice(0, 10)}</span>}
              {p.record_count !== undefined && <span>{p.record_count} records</span>}
              {p.license && <span>{p.license}</span>}
              {p.url && (
                <a className="inline-flex items-center gap-1 text-sel-ink hover:underline" href={p.url} target="_blank" rel="noreferrer">
                  source <ExternalLink size={11} />
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
      <H>Credits</H>
      <p>
        Charlotte Department of Transportation and CATS (City of Charlotte open data) · OpenStreetMap contributors (ODbL) · OpenFreeMap / OpenMapTiles · NetworkX, SciPy, FastAPI,
        MapLibre GL JS, Three.js, React. Inspired by{' '}
        <a className="text-sel-ink hover:underline" href="https://github.com/msradam/askstreets" target="_blank" rel="noreferrer">
          AskStreets
        </a>{' '}
        by Adam Munawar Rahman. StreetMend is an independent implementation with a different objective.
      </p>
      <H>Limitations</H>
      <p>
        A planning and research prototype. Outputs are planning estimates from a modeled network. It is not a certified accessible-navigation system, an ADA compliance determination,
        or an authorization for construction. The City has not reviewed or endorsed it.
      </p>
    </Modal>
  )
}

function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="How to use StreetMend" testId="help" width={560}>
      <ol className="list-decimal space-y-1.5 pl-5">
        <li>Check the <b className="text-ink">selected journey</b> at the top of the panel. It says whether the modeled journey is connected and why not.</li>
        <li>Choose a <b className="text-ink">repair budget</b> and a <b className="text-ink">destination priority</b>, then select <b className="text-ink">Find best repairs</b>.</li>
        <li>Apply the recommended repairs one at a time. The engine recomputes the network after every change.</li>
        <li>Use <b className="text-ink">Before / after</b> to compare the network with and without the repairs.</li>
        <li><b className="text-ink">Present</b> runs the guided demonstration scene by scene.</li>
      </ol>
      <H>Map controls</H>
      <ul className="list-disc space-y-1 pl-5">
        <li>Drag to pan, scroll or pinch to zoom. In 3D, right-drag or Ctrl+drag rotates and tilts.</li>
        <li>Keyboard (map focused): arrow keys pan, + / − zoom, Shift + arrows rotate in 3D.</li>
        <li>Camera presets (top right of the map): overview, street focus, network view, top-down.</li>
        <li>Click a repair marker, place, network link or building to inspect it. Every repair is also listed in the panel under <b className="text-ink">All repair candidates</b>.</li>
      </ul>
    </Modal>
  )
}

function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const health = useApp((s) => s.health)
  const sc = useApp((s) => s.scenario)
  const useLLM = useApp((s) => s.useLLM)
  const setUseLLM = useApp((s) => s.setUseLLM)
  const a = useApp((s) => s.analysis)
  const llm = health?.llm
  return (
    <Modal open={open} onClose={onClose} title="Settings & diagnostics" testId="settings" width={560}>
      <H>Planning assistant</H>
      <label className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2">
        <span>
          <span className="block font-medium text-ink">Use the local language model for unrecognised questions</span>
          <span className="block text-[12px]">A rule parser handles common phrasing offline. The model can only choose a supported operation; it never computes results.</span>
        </span>
        <input type="checkbox" checked={useLLM} onChange={(e) => setUseLLM(e.target.checked)} className="h-4 w-4 accent-sel" data-testid="toggle-llm" />
      </label>
      <p className="mt-1.5 text-[12px]" data-testid="llm-status">
        Runtime: {llm ? `${llm.model} at ${llm.endpoint} · ${llm.available ? 'available' : `unavailable (${llm.detail ?? 'not reachable'})`}` : 'unknown (API offline)'}
      </p>
      <H>Diagnostics</H>
      <table className="w-full text-[12.5px]">
        <tbody className="[&_td]:py-0.5">
          <tr><td>Engine</td><td className="text-right font-mono text-ink">{health ? `v${health.version} · ${health.status}` : 'offline'}</td></tr>
          <tr><td>Scenario</td><td className="text-right font-mono text-ink">{sc?.id}</td></tr>
          <tr><td>Graph</td><td className="text-right font-mono text-ink">{sc ? `${sc.node_count.toLocaleString()} nodes · ${sc.edge_count.toLocaleString()} edges` : '—'}</td></tr>
          <tr><td>Candidates / origins / destinations</td><td className="text-right font-mono text-ink">{sc ? `${sc.candidate_count} / ${sc.origin_count} / ${sc.destination_count}` : '—'}</td></tr>
          <tr><td>Last analysis</td><td className="text-right font-mono text-ink">{a ? `${a.recommendation.solver} · ${a.recommendation.evaluations} sets · ${a.recommendation.runtime_ms.toFixed(1)} ms` : 'not run'}</td></tr>
        </tbody>
      </table>
      <H>Display</H>
      <p>Animations follow your system's reduced-motion setting.</p>
    </Modal>
  )
}
