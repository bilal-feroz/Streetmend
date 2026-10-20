import { ExternalLink, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useApp } from '../state/store'

function H({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-1.5 mt-5 text-[13px] font-semibold text-fg first:mt-0">{children}</h3>
}

export function MethodologyDialog() {
  const open = useApp((s) => s.methodologyOpen)
  const sc = useApp((s) => s.scenario)
  const setOpen = useApp((s) => s.setMethodology)
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      onClose={() => setOpen(false)}
      onClick={(e) => e.target === ref.current && setOpen(false)}
      className="m-auto max-h-[86vh] w-[min(760px,94vw)] overflow-hidden rounded-xl border border-ink-500 bg-ink-850 p-0 text-fg shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      aria-labelledby="meth-title"
      data-testid="methodology"
    >
      <div className="flex items-center justify-between border-b border-ink-600 px-5 py-3">
        <h2 id="meth-title" className="text-[15px] font-semibold">
          Data &amp; Methodology
        </h2>
        <button className="rounded p-1 text-fg-3 hover:bg-ink-700 hover:text-fg" onClick={() => setOpen(false)} aria-label="Close">
          <X size={16} />
        </button>
      </div>
      <div className="scroll-thin max-h-[calc(86vh-52px)] overflow-y-auto px-5 py-4 text-[13px] leading-relaxed text-fg-2">
        <H>What StreetMend computes</H>
        <p>
          StreetMend models a pedestrian network as a graph of sidewalk corners, curb-ramp landings and crossings. A crossing is usable only if the crossing itself and the curb
          ramps at <em>both</em> ends are traversable. Given candidate repairs and a repair budget, it finds the set of repairs that maximizes weighted origin–destination access.
        </p>
        <pre className="mt-2 overflow-x-auto rounded-md border border-ink-600 bg-ink-900 px-3 py-2 font-mono text-[12px] text-fg">
          Score(S) = Σₒ Σ_d  wₒ · w_cat(d) · w_d · 1[ dist_S(o, d) ≤ L ]
        </pre>
        <p className="mt-2">
          dist_S is the shortest network distance (Dijkstra, metres) using only edges that are traversable in the base model or made traversable by repairs in S. L is the access
          threshold. Weights are planning priorities, not population counts. The score counts weighted origin–destination pairs.
        </p>

        <H>Solvers and baselines</H>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b className="text-fg">Exact enumeration</b> evaluates every combination of at most B candidates (after sound pruning of candidates that cannot lie on any within-threshold
            path). The result is optimal for the stated candidate set and objective. Ties prefer fewer repairs.
          </li>
          <li>
            <b className="text-fg">Beam search</b> is used only when combinations exceed 150,000 (seeded with the exact optimum for a smaller budget); it is labeled approximate and never called optimal.
          </li>
          <li>
            <b className="text-fg">Greedy</b> adds the repair with the largest immediate gain each step and stops when none adds value. <b className="text-fg">Individual ranking</b>{' '}
            scores each repair alone. <b className="text-fg">Nearest-to-destination</b> repairs the barriers closest to the priority destinations. None of these baselines is
            weakened; they fail exactly when repairs only add value in combination.
          </li>
        </ul>

        <H>Passability states</H>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <span className="text-fg">Traversable</span> — traversable under the current model assumptions; not a field-verified guarantee.
          </li>
          <li>
            <span className="text-bad">Blocked</span> — a known barrier (missing ramp, failed ramp, missing sidewalk).
          </li>
          <li>
            <span className="text-unk">Unknown</span> — no reliable evidence; always excluded from modeled traversability. A sensitivity analysis reports how results change if
            unknown edges were passable.
          </li>
          <li>
            <span className="text-ok">Repaired</span> — made traversable by a simulated intervention.
          </li>
        </ul>

        <H>AI interface</H>
        <p>
          Planning questions are parsed by a deterministic rule parser; unrecognised phrasing can be routed to a local model (Ollama) that may only choose one allowlisted
          operation with typed, validated arguments. The model never computes routes or scores, and any model-written sentence containing a number or magnitude word not present in the engine's
          computed facts is rejected.
        </p>

        <H>This scenario: {sc?.name}</H>
        <ul className="list-disc space-y-1 pl-5">{sc?.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>

        <H>Sources and provenance</H>
        <ul className="space-y-2">
          {sc?.provenance.map((p) => (
            <li key={p.id} className="rounded-md border border-ink-600 bg-ink-800 px-3 py-2">
              <div className="font-medium text-fg">{p.name}</div>
              {p.description && <div className="text-[12px]">{p.description}</div>}
              <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11.5px] text-fg-3">
                {p.retrieved_at && <span>Retrieved {p.retrieved_at}</span>}
                {p.record_count !== undefined && <span>{p.record_count} records</span>}
                {p.license && <span>{p.license}</span>}
                {p.url && (
                  <a className="inline-flex items-center gap-1 text-sel-2 hover:underline" href={p.url} target="_blank" rel="noreferrer">
                    source <ExternalLink size={11} />
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>

        <H>Credits</H>
        <p>
          Charlotte Department of Transportation (ADA curb ramp and sidewalk inventories, CATS bus stops via City of Charlotte open data) · OpenStreetMap contributors (ODbL) ·
          OpenFreeMap / OpenMapTiles basemap · NetworkX, SciPy, FastAPI, MapLibre GL JS, React. Architecturally inspired by{' '}
          <a className="text-sel-2 hover:underline" href="https://github.com/msradam/askstreets" target="_blank" rel="noreferrer">
            AskStreets
          </a>{' '}
          by Adam Munawar Rahman; StreetMend is an independent implementation with a different objective.
        </p>

        <H>Limitations</H>
        <p>
          StreetMend is a planning and research prototype. Its outputs are planning estimates from a modeled network. It is not a certified accessible-navigation system, not an ADA
          compliance determination, and not an authorization to conduct construction. The city has not reviewed or endorsed this prototype.
        </p>
      </div>
    </dialog>
  )
}
