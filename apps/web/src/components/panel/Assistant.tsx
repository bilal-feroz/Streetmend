import { CornerDownLeft, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { useApp } from '../../state/store'

const SUGGESTIONS = [
  'Find the best two repairs for healthcare access',
  'Why did you choose these repairs?',
  'What happens if I can only repair one?',
  'Which recommendation changes if I prioritize schools instead?',
  'Show the journeys that remain disconnected',
]

const OP_LABEL: Record<string, string> = {
  optimize_repairs: 'Find repairs',
  explain_recommendation: 'Explain recommendation',
  compare_budgets: 'Compare budgets',
  compare_priorities: 'Compare priorities',
  show_disconnected: 'List disconnected journeys',
  apply_repair: 'Apply repair',
  undo: 'Undo',
  reset: 'Reset',
  show_route: 'Show route',
  candidates_near: 'Repairs near destinations',
  unsupported: 'Not supported',
}

/** Optional question box. Requests map to one of the supported planning
 * operations; the engine computes every result. */
export function Assistant() {
  const [text, setText] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const pending = useApp((s) => s.assistantPending)
  const last = useApp((s) => s.assistantLast)
  const error = useApp((s) => s.assistantError)
  const ask = useApp((s) => s.ask)
  const submit = (t: string) => {
    const v = t.trim()
    if (!v || pending) return
    setText(v)
    void ask(v)
  }
  const intent = last?.interpretation.intent
  return (
    <div>
      <form onSubmit={(e) => { e.preventDefault(); submit(text) }} className="flex items-center gap-1 rounded-md border border-line-2 bg-paper pl-2.5 pr-1 focus-within:border-sel">
        <label htmlFor="ask" className="sr-only">
          Ask a planning question
        </label>
        <input id="ask" data-testid="ask-input" value={text} onChange={(e) => setText(e.target.value)} maxLength={500}
          placeholder="e.g. what if we can only repair one?" className="min-w-0 flex-1 bg-transparent py-2 text-[13px] text-ink placeholder:text-ink-3 focus:outline-none" />
        <button type="submit" className="btn-ghost px-1.5" disabled={!text.trim() || pending} aria-label="Ask">
          {pending ? <LoaderCircle size={15} className="animate-spin" /> : <CornerDownLeft size={15} />}
        </button>
      </form>
      <button className="mt-1.5 text-[12px] text-sel-ink hover:underline" onClick={() => setShowSuggestions(!showSuggestions)} aria-expanded={showSuggestions}>
        {showSuggestions ? 'Hide examples' : 'Show examples'}
      </button>
      {showSuggestions && (
        <ul className="mt-1 space-y-0.5">
          {SUGGESTIONS.map((s) => (
            <li key={s}>
              <button className="w-full rounded px-1.5 py-1 text-left text-[12.5px] text-ink-2 hover:bg-wash hover:text-ink" onClick={() => submit(s)}>
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
      {(last || error) && (
        <div className="mt-2 rounded-md bg-wash p-2.5" aria-live="polite" data-testid="assistant-response">
          {error ? (
            <p className="text-[12px] text-bad-ink">{error}</p>
          ) : (
            last && (
              <>
                {intent && (
                  <div className="mb-1 text-[11.5px] text-ink-2">
                    Interpreted as{' '}
                    <span className={`font-semibold ${last.ok ? 'text-ink' : 'text-bad-ink'}`} data-testid="assistant-op">
                      {OP_LABEL[intent.operation] ?? intent.operation}
                      {intent.budget !== null && ` · budget ${intent.budget}`}
                      {intent.priority && ` · ${intent.priority}`}
                      {intent.category && ` · ${intent.category}`}
                      {intent.intervention_id && ` · ${intent.intervention_id}`}
                    </span>
                  </div>
                )}
                <ul className="space-y-1 text-[12.5px] leading-snug text-ink">
                  {last.facts.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
                {last.narrative && <p className="mt-1.5 border-t border-line pt-1.5 text-[12.5px] italic text-ink-2">{last.narrative}</p>}
              </>
            )
          )}
        </div>
      )}
    </div>
  )
}
