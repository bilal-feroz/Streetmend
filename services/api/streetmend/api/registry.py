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
        self._loaded = False

    def ensure(self) -> None:
        """Load on first use: serverless hosts may not run the app's startup hook."""
        if not self._loaded:
            self.load()

    def load(self) -> None:
        with self._lock:
            if self._loaded:
                return
            self._loaded = True
            self.scenarios["demo"] = build_demo_scenario()
            try:
                from streetmend.municipal.scenario import load_municipal_scenario

                for policy in ("moderate", "strict", "lenient"):
                    sc = load_municipal_scenario(policy)
                    self.scenarios[sc.id] = sc
                from streetmend.scenario.guided import load_guided_scenario

                guided = load_guided_scenario()
                self.scenarios[guided.id] = guided
                from streetmend.scenario.preflight import load_preflight_scenario

                pre = load_preflight_scenario()
                self.scenarios[pre.id] = pre
                try:  # warm the access model (homes and facilities snapped to the real graph)
                    from streetmend.access.analysis import municipal_model

                    municipal_model("moderate")
                except FileNotFoundError as exc:
                    log.warning("access analysis unavailable: %s", exc)
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
        self.ensure()
        return self.scenarios.get(sid)


registry = Registry()
