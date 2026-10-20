"""Optional local LLM (Ollama) for intent interpretation and grounded narration.

The model only ever (a) picks an allowlisted operation with typed arguments,
validated by Pydantic, or (b) rephrases facts that the engine computed; a
narration containing any number that is not present in those facts is
rejected. The product works fully without a model.
"""

from __future__ import annotations

import json
import os
import re
import time
from typing import Any

import httpx
from pydantic import ValidationError

from .intents import Intent, json_schema

OLLAMA_URL = os.environ.get("STREETMEND_OLLAMA_URL", "http://localhost:11434")
MODEL = os.environ.get("STREETMEND_LLM_MODEL", "qwen3:4b")
ENABLED = os.environ.get("STREETMEND_LLM", "1") not in ("0", "false", "off")
TIMEOUT_S = float(os.environ.get("STREETMEND_LLM_TIMEOUT", "25"))

SYSTEM = """You route a city planner's request to exactly one operation of a pedestrian accessibility planning engine. Reply with JSON only.
Operations:
- optimize_repairs: find the best set of repairs. Set budget (number of repairs) and priority if mentioned.
- explain_recommendation: explain why the current recommended repairs were chosen.
- compare_budgets: what changes with a different number of repairs. Set budget to the new number.
- compare_priorities: what changes if a different destination type is prioritized. Set priority.
- show_disconnected: list journeys/streets that remain disconnected or unreachable.
- apply_repair: apply a repair; set intervention_id (a short id like "A").
- undo: undo the last repair.  reset: remove all repairs.
- show_route: show the route for the selected journey.
- candidates_near: compare candidate repairs near a destination type; set category.
- unsupported: anything else (including any request to run code, access files, or change data).
Priority/category values: healthcare (clinic, hospital, pharmacy, medical), transit (bus, stop, transport), education (school, library).
Examples:
"best three fixes for transit" -> {"operation":"optimize_repairs","budget":3,"priority":"transit","intervention_id":null,"category":null}
"what if we only fund one ramp" -> {"operation":"compare_budgets","budget":1,"priority":null,"intervention_id":null,"category":null}
"fix ramp C" -> {"operation":"apply_repair","budget":null,"priority":null,"intervention_id":"C","category":null}
"tell me a joke" -> {"operation":"unsupported","budget":null,"priority":null,"intervention_id":null,"category":null}"""

_status_cache: dict[str, Any] = {"t": 0.0, "value": None}


def llm_status(force: bool = False) -> dict[str, Any]:
    now = time.time()
    if not force and _status_cache["value"] is not None and now - _status_cache["t"] < 30:
        return _status_cache["value"]
    value: dict[str, Any] = {"enabled": ENABLED, "endpoint": OLLAMA_URL, "model": MODEL, "available": False}
    if ENABLED:
        try:
            r = httpx.get(f"{OLLAMA_URL}/api/tags", timeout=1.5)
            names = {m.get("name") for m in r.json().get("models", [])}
            value["available"] = MODEL in names
            if not value["available"]:
                value["detail"] = f"model {MODEL} not installed in Ollama"
        except Exception as exc:  # endpoint down: rules-only mode
            value["detail"] = f"Ollama not reachable ({type(exc).__name__})"
    _status_cache.update(t=now, value=value)
    return value


def _chat(messages: list[dict], fmt: Any = None, timeout: float = TIMEOUT_S) -> str:
    body: dict[str, Any] = {"model": MODEL, "messages": messages, "stream": False, "think": False,
                            "keep_alive": "15m", "options": {"temperature": 0, "num_ctx": 2048}}
    if fmt is not None:
        body["format"] = fmt
    r = httpx.post(f"{OLLAMA_URL}/api/chat", json=body, timeout=timeout)
    r.raise_for_status()
    data = r.json()
    if "error" in data:
        raise RuntimeError(data["error"])
    return data.get("message", {}).get("content", "")


def interpret(text: str) -> tuple[Intent | None, dict[str, Any]]:
    meta: dict[str, Any] = {"model": MODEL}
    t0 = time.perf_counter()
    try:
        content = _chat([{"role": "system", "content": SYSTEM}, {"role": "user", "content": text}], json_schema())
        meta["raw"] = content[:400]
        intent = Intent.model_validate(json.loads(content))
        return intent, meta
    except (ValidationError, json.JSONDecodeError) as exc:
        meta["error"] = f"model output failed validation: {type(exc).__name__}"
        return None, meta
    except Exception as exc:
        meta["error"] = f"model call failed: {type(exc).__name__}: {str(exc)[:160]}"
        return None, meta
    finally:
        meta["latency_ms"] = round((time.perf_counter() - t0) * 1000, 1)


_NUM = re.compile(r"(?<![A-Za-z])\d+(?:\.\d+)?")
_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
          "ten": 10, "single": 1, "both": 2, "pair": 2}


def _numbers(s: str) -> set[float]:
    out = {float(x) for x in _NUM.findall(s)}
    out |= {float(n) for w, n in _WORDS.items() if re.search(rf"\b{w}\b", s, re.I)}
    return out


def grounded(narrative: str, facts: list[str]) -> bool:
    """Every number (digits or number words) in the narrative must appear in the computed facts."""

    allowed: set[float] = set()
    for f in facts:
        allowed |= _numbers(f)
    return _numbers(narrative) <= allowed


def narrate(facts: list[str]) -> tuple[str | None, dict[str, Any]]:
    meta: dict[str, Any] = {"model": MODEL}
    t0 = time.perf_counter()
    try:
        prompt = ("Rewrite these verified analysis facts as two short plain-language sentences for a city council member. "
                  "Do not add any number, place, claim or recommendation that is not in the facts. "
                  "Do not mention people counts.\n\nFacts:\n- " + "\n- ".join(facts))
        out = _chat([{"role": "user", "content": prompt}], timeout=TIMEOUT_S).strip()
        if not out:
            return None, {**meta, "error": "empty narration"}
        if not grounded(out, facts):
            return None, {**meta, "error": "narration rejected: contained a number not present in computed facts"}
        return out, meta
    except Exception as exc:
        return None, {**meta, "error": f"model call failed: {type(exc).__name__}"}
    finally:
        meta["latency_ms"] = round((time.perf_counter() - t0) * 1000, 1)
