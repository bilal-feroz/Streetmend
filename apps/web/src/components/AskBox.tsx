import { Bot, CornerDownLeft, Cpu, LoaderCircle, Sparkles, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { useApp } from '../state/store'

const SUGGESTIONS = [
  'Find the best two repairs for healthcare access',
  'Why did you choose these repairs?',
  'What happens if I can only repair one?',
  'Which recommendation changes if I prioritize schools instead?',
  'Compare repairs near bus stops',
  'Show the journeys that remain disconnected',
]

const OP_LABEL: Record<string, string> = {
  optimize_repairs: 'Optimize repairs',
  explain_recommendation: 'Explain recommendation',
  compare_budgets: 'Compare budgets',
  compare_priorities: 'Compare priorities',
  show_disconnected: 'List disconnected journeys',
  apply_repair: 'Apply repair',
  undo: 'Undo',
  reset: 'Reset',
  show_route: 'Show route',
  candidates_near: 'Candidates near destinations',
  unsupported: 'Unsupported request',
}

export function AskBox() {
  const [text, setText] = useState('')
  const pending = useApp((s) => s.assistantPending)
  const last = useApp((s) => s.assistantLast)
  const error = useApp((s) => s.assistantError)
  const useLLM = useApp((s) => s.useLLM)
  const llm = useApp((s) => s.health?.llm)
  const { ask, setUseLLM } = useApp.getState()

  const submit = (t: string) => {
    const v = t.trim()
    if (!v || pending) return
    setText(v)
    void ask(v)
  }
  const intent = last?.interpretation.intent
  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit(text)
        }}
        className="flex items-center gap-1.5 rounded-md border border-ink-500 bg-ink-850 pl-2.5 pr-1 focus-within:border-sel"
      >
        <Sparkles size={14} className="shrink-0 text-sel-2" aria-hidden />
        <label htmlFor="ask" className="sr-only">
          Ask a planning question
        </label>
        <input
          id="ask"
          data-testid="ask-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask: which two repairs unlock the most healthcare access?"
          className="min-w-0 flex-1 bg-transparent py-2 text-[13px] text-fg placeholder:text-fg-4 focus:outline-none"
          maxLength={500}
        />
        <button type="submit" className="btn-primary px-2 py-1" disabled={!text.trim() || pending} aria-label="Ask">
          {pending ? <LoaderCircle size={14} className="animate-spin" /> : <CornerDownLeft size={14} />}
        </button>
      </form>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {SUGGESTIONS.slice(0, 4).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => submit(s)}
            className="rounded-full border border-ink-600 bg-ink-800 px-2 py-0.5 text-[11.5px] text-fg-2 transition-colors hover:border-sel/60 hover:text-fg"
          >
            {s}
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-fg-3">
        <label className="flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" checked={useLLM} onChange={(e) => setUseLLM(e.target.checked)} className="accent-sel" />
          Local model for unrecognised phrasing
        </label>
        <span className="flex items-center gap-1" title={llm?.detail ?? llm?.endpoint}>
          <Cpu size={11} aria-hidden />
          {llm?.available ? <span className="text-ok">{llm.model} ready</span> : <span>rules only</span>}
        </span>
      </div>

      {(last || error) && (
        <div className="mt-2.5 rounded-md border border-ink-600 bg-ink-850 p-2.5" aria-live="polite" data-testid="assistant-response">
          {error ? (
            <div className="flex items-start gap-2 text-xs text-bad">
              <TriangleAlert size={14} className="mt-px shrink-0" /> {error}
            </div>
          ) : (
            last && (
              <>
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <Bot size={12} className="text-sel-2" aria-hidden />
                  <span className="text-fg-3">Interpreted by</span>
                  <span className="rounded bg-ink-700 px-1.5 py-px font-mono text-fg-2">
                    {last.interpretation.source === 'llm' ? `local model · ${last.interpretation.model}` : 'rule parser'}
                    {last.interpretation.latency_ms !== undefined && ` · ${Math.round(last.interpretation.latency_ms)} ms`}
                  </span>
                  {intent && (
                    <span className={`rounded px-1.5 py-px font-mono ${last.ok ? 'bg-sel-dim text-sel-2' : 'bg-bad-dim text-bad'}`} data-testid="assistant-op">
                      {OP_LABEL[intent.operation] ?? intent.operation}
                      {intent.budget !== null && ` · budget ${intent.budget}`}
                      {intent.priority && ` · ${intent.priority}`}
                      {intent.category && ` · ${intent.category}`}
                      {intent.intervention_id && ` · ${intent.intervention_id}`}
                    </span>
                  )}
                </div>
                <ul className="mt-1.5 space-y-1 text-[12.5px] leading-snug text-fg-2">
                  {last.facts.map((f, i) => (
                    <li key={i} className="flex gap-1.5">
                      <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-fg-4" aria-hidden />
                      {f}
                    </li>
                  ))}
                </ul>
                {last.narrative && (
                  <p className="mt-2 border-t border-ink-600 pt-2 text-[12.5px] italic leading-snug text-fg-2">
                    “{last.narrative}”
                    <span className="mt-0.5 block text-[10.5px] not-italic text-fg-4">Local-model wording; every number checked against computed facts.</span>
                  </p>
                )}
                {!last.ok && last.interpretation.error && <p className="mt-1 text-[11px] text-fg-4">{last.interpretation.error}</p>}
              </>
            )
          )}
        </div>
      )}
    </div>
  )
}
