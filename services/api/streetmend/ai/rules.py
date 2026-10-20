"""Deterministic rule-based intent parser (works offline, no model needed)."""

from __future__ import annotations

import re

from .intents import Intent

NUMBER_WORDS = {"zero": 0, "no": 0, "one": 1, "single": 1, "a single": 1, "two": 2, "pair": 2, "couple": 2,
                "both": 2, "three": 3, "four": 4, "five": 5, "six": 6}
CATEGORY_WORDS = {
    "healthcare": ["health", "clinic", "hospital", "medical", "doctor", "pharmacy", "care"],
    "transit": ["bus", "transit", "stop", "transport", "train", "rail", "station"],
    "education": ["school", "education", "library", "college", "student", "learning", "university"],
}
DISALLOWED = re.compile(
    r"\b(delete|drop|rm\b|shell|exec|execute|python|script|sql|database|file|password|token|api key|"
    r"system prompt|ignore (all|previous)|format|shutdown|install|download|upload)\b",
    re.I,
)


def _budget(t: str) -> int | None:
    m = re.search(r"\b(\d+)\s*(repairs?|fixes|ramps?|interventions?|projects?)?\b", t)
    if m and int(m.group(1)) <= 50:
        return int(m.group(1))
    for w, n in sorted(NUMBER_WORDS.items(), key=lambda kv: -len(kv[0])):
        if re.search(rf"\b{w}\b", t) and (w not in ("no", "both") or re.search(r"repairs?|fix", t)):
            return n
    return None


def _category(t: str) -> str | None:
    hits = [(t.find(w), c) for c, ws in CATEGORY_WORDS.items() for w in ws if re.search(rf"\b{w}", t)]
    return min(hits)[1] if hits else None


def parse(text: str, known_ids: set[str]) -> Intent | None:
    """Return an intent for recognised phrasings, or None when unsure."""

    raw = text.strip()
    t = raw.lower()
    if DISALLOWED.search(t) and not re.search(r"\b(install|reconstruct) (a |the )?ramp", t):
        return Intent(operation="unsupported")
    if re.search(r"\bundo\b|go back|step back|revert (the )?last", t):
        return Intent(operation="undo")
    if re.search(r"\breset\b|start over|clear (all|every)|remove all|restore (the )?original", t):
        return Intent(operation="reset")
    m = re.search(r"\b(apply|repair|fix|install|reconstruct|build)\s+(?:repair\s+|ramp\s+|candidate\s+)?([A-Za-z0-9_:\-.]+)\b", raw, re.I)
    if m and m.group(2) in known_ids:
        return Intent(operation="apply_repair", intervention_id=m.group(2))
    cat = _category(t)
    n = _budget(t)
    if re.search(r"\bwhy\b|explain|reason|justify", t):
        return Intent(operation="explain_recommendation")
    if re.search(r"disconnected|unreachable|remain|can(no|')t reach|cannot reach|isolated|still blocked|not reachable", t):
        return Intent(operation="show_disconnected")
    if re.search(r"\b(near|around|close to|next to|nearby)\b", t) and cat:
        return Intent(operation="candidates_near", category=cat)
    if re.search(r"prioriti[sz]|instead|focus on|what if .*(school|transit|bus|health|clinic)", t) and cat:
        return Intent(operation="compare_priorities", priority=cat)
    if n is not None and re.search(r"\bonly\b|what (happens|if)|if (i|we) (can|could|had)|instead of|afford", t):
        return Intent(operation="compare_budgets", budget=n)
    if re.search(r"\b(show|trace|draw|display)\b.*\b(route|path|journey)\b", t):
        return Intent(operation="show_route")
    if re.search(r"\bbest\b|which .*(repairs?|fixes|ramps?)|recommend|optimi[sz]e|\bmost\b|improve|unlock|\btop\b|prioritize repairs|find", t):
        return Intent(operation="optimize_repairs", budget=n, priority=cat)
    return None
