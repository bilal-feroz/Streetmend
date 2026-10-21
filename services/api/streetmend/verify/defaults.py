"""Default access requirements for any scenario and journey."""

from __future__ import annotations

from streetmend.scenario.model import Scenario

from .checks import Requirement
from .profiles import Profile


def _short(label: str) -> str:
    return label.split(" (")[0].replace("Homes along ", "")


def default_requirements(sc: Scenario, origin: str, destination: str) -> list[Requirement]:
    """The checks a planner would start from: keep this journey step-free and walkable,
    keep its detour small, keep a bus stop in reach, and keep most journeys in the area."""

    if sc.context.get("verify", {}).get("requirements") and sc.default_journey == (origin, destination):
        from streetmend.scenario.preflight import requirements

        return requirements(sc)
    places = {p.id: p for p in (*sc.origins, *sc.destinations)}
    o = _short(places[origin].label) if origin in places else origin
    d = _short(places[destination].label) if destination in places else destination
    m = sc.max_distance_m or 800.0
    return [
        Requirement("R1", "route", f"Step-free route from {o} to {d} within {m:.0f} m", Profile.STEP_FREE, origin, destination, max_m=m),
        Requirement("R2", "detour", "That step-free route grows by no more than 15%", Profile.STEP_FREE, origin, destination, max_ratio=1.15),
        Requirement("R3", "route", f"Walking route from {o} to {d} within {m:.0f} m", Profile.PEDESTRIAN, origin, destination, max_m=m),
        Requirement("R4", "category", f"Step-free route from {o} to a bus stop within {m:.0f} m", Profile.STEP_FREE, origin, category="transit", max_m=m),
        Requirement("R5", "share", "Keep at least 90% of today's step-free essential journeys in the area", Profile.STEP_FREE, max_m=m, min_share=0.9),
    ]
