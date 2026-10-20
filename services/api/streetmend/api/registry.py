"""In-process scenario registry. Scenarios are immutable after construction."""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass

from streetmend.scenario.demo import build_demo_scenario
from streetmend.scenario.model import Scenario

log = logging.getLogger("streetmend")


@dataclass
class Unavailable:
    id: str
    name: str
    mode: str
    reason: str


class Registry:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.scenarios: dict[str, Scenario] = {}
        self.unavailable: dict[str, Unavailable] = {}

    def load(self) -> None:
        with self._lock:
            self.scenarios["demo"] = build_demo_scenario()
            try:
                from streetmend.municipal.scenario import load_municipal_scenario

                sc = load_municipal_scenario()
                self.scenarios[sc.id] = sc
            except FileNotFoundError as exc:
                self.unavailable["charlotte-elizabeth"] = Unavailable(
                    "charlotte-elizabeth", "Charlotte Data Explorer - Elizabeth", "municipal",
                    f"Prepared municipal data not found ({exc}). Run scripts/ingest/fetch_charlotte.py.")
            except Exception as exc:  # never let municipal data break the demo
                log.exception("municipal scenario failed to load")
                self.unavailable["charlotte-elizabeth"] = Unavailable(
                    "charlotte-elizabeth", "Charlotte Data Explorer - Elizabeth", "municipal",
                    f"Municipal scenario failed to build: {type(exc).__name__}: {exc}")

    def get(self, sid: str) -> Scenario | None:
        return self.scenarios.get(sid)


registry = Registry()
