import { ChevronDown } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useApp } from '../state/store'
import { AskBox } from './AskBox'
import { BudgetControl, PriorityControl, ThresholdControl } from './Parameters'
import { AnalyzeButton, CandidateList, CombinedEffect, Impact, NetworkSummary, Recommendations } from './Results'
import { Section } from './ui'

function Collapsible({ title, children, defaultOpen = false, testId }: { title: string; children: ReactNode; defaultOpen?: boolean; testId?: string }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="border-b border-ink-600/80">
      <button
        className="flex w-full items-center justify-between px-4 py-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-fg-2 hover:text-fg"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        data-testid={testId}
      >
        {title}
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-4 pb-3.5">{children}</div>}
    </section>
  )
}

export function PlanningPanel() {
  const analysis = useApp((s) => s.analysis)
  const scenario = useApp((s) => s.scenario)
  const setMethodology = useApp((s) => s.setMethodology)
  return (
    <div className="flex h-full flex-col">
      <div className="scroll-thin flex-1 overflow-y-auto overscroll-contain">
        <Section title="Planning question" step={1} id="sec-ask">
          <AskBox />
        </Section>
        <Section title="Repair budget" step={2} id="sec-budget">
          <BudgetControl />
        </Section>
        <Section title="Destination priorities" step={3} id="sec-priority">
          <PriorityControl />
          <div className="mt-3">
            <ThresholdControl />
          </div>
        </Section>
        <Section title="Network condition" step={4} id="sec-network">
          <NetworkSummary />
        </Section>
        <div className="border-b border-ink-600/80 px-4 py-3.5">
          <AnalyzeButton />
        </div>
        <Section title="Recommended repairs" step={5} id="sec-rec">
          <Recommendations />
        </Section>
        {analysis && analysis.recommendation.selected.length > 0 && (
          <Section title="Combined effect" step={6} id="sec-combined">
            <CombinedEffect />
          </Section>
        )}
        {analysis && (
          <Section title="Impact & evidence" step={7} id="sec-impact">
            <Impact />
          </Section>
        )}
        <Collapsible title={`All repair candidates (${scenario?.candidate_count ?? 0})`} testId="toggle-candidates">
          <CandidateList />
        </Collapsible>
        <Collapsible title="Assumptions">
          <ul className="list-disc space-y-1 pl-4 text-[12px] leading-snug text-fg-2">
            {scenario?.assumptions.map((a) => <li key={a}>{a}</li>)}
          </ul>
          <button className="btn-ghost mt-2 px-0 text-sel-2" onClick={() => setMethodology(true)}>
            Full data &amp; methodology →
          </button>
        </Collapsible>
        <p className="px-4 py-4 text-[11px] leading-relaxed text-fg-4">
          Planning and research prototype. Not a certified accessible-navigation system, an ADA compliance determination, or an authorization for construction.
        </p>
      </div>
    </div>
  )
}
