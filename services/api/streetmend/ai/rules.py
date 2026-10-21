"""Deterministic rule-based intent parser (works offline, no model needed)."""

from __future__ import annotations

import re

from .intents import Intent

MAX_BUDGET = 6  # interactive limit, matches Intent.budget and the API

NUMBER_WORDS = {"zero": 0, "no": 0, "one": 1, "single": 1, "a single": 1, "two": 2, "pair": 2, "couple": 2,
                "both": 2, "three": 3, "four": 4, "five": 5, "six": 6}
CATEGORY_WORDS = {
    "healthcare": ["health", "clinic", "hospital", "medical", "doctor", "pharmacy", "care"],
    "transit": ["bus", "transit", "stop", "transport", "train", "rail", "station"],
    "education": ["school", "education", "library", "college", "student", "learning", "university"],
}
ACCESS_WORDS = {
    "grocery": ["grocery", "groceries", "supermarket", "food store", "food shop"],
    "parks": ["park", "parks", "playground", "green space"],
    "services": ["essential service", "bank", "post office", "community cent", "services"],
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


def _access_category(t: str) -> str | None:
    hits = [(t.find(w), c) for c, ws in ACCESS_WORDS.items() for w in ws if re.search(rf"\b{w}", t)]
    hits += [(t.find(w), c) for c, ws in CATEGORY_WORDS.items() for w in ws if re.search(rf"\b{w}", t)]
    return min(hits)[1] if hits else None


def _profile(t: str) -> str | None:
    if re.search(r"step[- ]free|wheelchair|ramp|stroller|walker", t):
        return "step_free"
    if re.search(r"\bwalk(ing)?\b|on foot|pedestrian", t):
        return "pedestrian"
    return None


def _street_intelligence(t: str) -> Intent | None:
    """Access-analysis and verification questions (checked before the repair-planner phrasings)."""

    cat = _access_category(t)
    prof = _profile(t)
    if re.search(r"straight[- ]line|crow flies|as the crow|direct distance", t):
        return Intent(operation="network_vs_straight", category=cat, profile=prof)
    if re.search(r"disconnects? the most|if (it is |they are |it were |they were )?closed|most critical|critical (streets?|links?|crossings?)", t):
        return Intent(operation="critical_links", profile=prof)
    if re.search(r"(become|becomes|are|is|go|goes) (unreachable|cut off|disconnected) (after|if|when|once)|after (this|the) (crossing|sidewalk|closure|change)", t):
        return Intent(operation="closure_impact", category=cat, profile=prof)
    if re.search(r"fix or build|(repair|fix)\w*\b.*\b(or|versus|vs\.?|better than|instead of|compared? (to|with))\b.*\b(build|new|add)|"
                 r"(build|new|add)\w*\b.*\b(or|versus|vs\.?|better than|instead of)\b.*\b(repair|fix)|compare (the )?interventions|"
                 r"which intervention", t):
        return Intent(operation="compare_interventions", category=cat, profile=prof)
    if re.search(r"why did (the )?(verification|checks?|tests?) fail|counterexample|what (breaks|broke|fails|failed)|why .*\bfail", t):
        return Intent(operation="explain_verification", profile=prof)
    if re.search(r"(show|see|what is) (me )?the evidence|evidence (behind|for)|how do (you|we) know", t):
        return Intent(operation="show_evidence")
    if re.search(r"\bwhy\b.*\b(access|served|underserved|poor|weak|low)\b|diagnos", t) and cat:
        return Intent(operation="diagnose_access", category=cat, profile=prof)
    if re.search(r"(neighbou?rhoods?|areas?|cells?|where|which part|blocks?).*(poor|weak|worst|lowest|least|underserved|lack|gaps?|no access|struggle|hardest|difficult|far from|farthest)|access gaps?|underserved", t):
        return Intent(operation="identify_access_gaps", category=cat or "healthcare", profile=prof)
    return None


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
    si = _street_intelligence(t)
    if si is not None:
        return si
    cat = _category(t)
    n = _budget(t)
    if n is not None:
        n = min(n, MAX_BUDGET)
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
