"""Repair state with undo and reset.

The applied-repair list is the only mutable state; the underlying scenario
graph is never modified, so reset always restores the original network.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .model import Scenario


class StateError(ValueError):
    pass


@dataclass
class RepairState:
    scenario: Scenario
    applied: list[str] = field(default_factory=list)
    _history: list[list[str]] = field(default_factory=list, repr=False)

    @classmethod
    def from_applied(cls, scenario: Scenario, applied: list[str]) -> "RepairState":
        """Validate an externally supplied applied list (e.g. from an API client)."""

        state = cls(scenario)
        for iid in applied:
            state.apply(iid)
        state._history.clear()
        return state

    def apply(self, intervention_id: str) -> bool:
        """Apply a repair. Returns False (no change) if it is already applied."""

        if intervention_id not in self.scenario.interventions:
            raise StateError(f"unknown intervention '{intervention_id}'")
        if intervention_id in self.applied:
            return False
        self._history.append(list(self.applied))
        self.applied.append(intervention_id)
        return True

    def remove(self, intervention_id: str) -> bool:
        if intervention_id not in self.applied:
            return False
        self._history.append(list(self.applied))
        self.applied.remove(intervention_id)
        return True

    def undo(self) -> bool:
        if not self._history:
            return False
        self.applied = self._history.pop()
        return True

    def reset(self) -> None:
        if self.applied:
            self._history.append(list(self.applied))
        self.applied = []

    @property
    def enabled_edges(self) -> set[str]:
        return self.scenario.enabled_edges(self.applied)
