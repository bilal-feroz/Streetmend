"""Allowlisted assistant operations.

The assistant can only ever produce one of these validated intents. Each maps
to a deterministic engine function in ``executor.py``; there is no path from
model output to code execution, file access or free-form queries.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Operation = Literal[
    "optimize_repairs",
    "explain_recommendation",
    "compare_budgets",
    "compare_priorities",
    "show_disconnected",
    "apply_repair",
    "undo",
    "reset",
    "show_route",
    "candidates_near",
    # street intelligence: access analysis and change verification (deterministic tools)
    "identify_access_gaps",
    "diagnose_access",
    "compare_interventions",
    "network_vs_straight",
    "critical_links",
    "closure_impact",
    "explain_verification",
    "show_evidence",
    "unsupported",
]
OPERATIONS: tuple[str, ...] = Operation.__args__  # type: ignore[attr-defined]

Priority = Literal["balanced", "healthcare", "transit", "education"]
Category = Literal["healthcare", "transit", "education", "grocery", "parks", "services"]
Profile = Literal["step_free", "pedestrian"]


class Intent(BaseModel):
    operation: Operation
    budget: int | None = Field(None, ge=0, le=6)
    priority: Priority | None = None
    intervention_id: str | None = Field(None, max_length=40, pattern=r"^[A-Za-z0-9_:\-.]+$")
    category: Category | None = None
    cell: str | None = Field(None, pattern=r"^[0-9a-f]{15}$")
    profile: Profile | None = None


def json_schema() -> dict:
    """Flat JSON schema handed to the local model's structured-output decoder."""

    return {
        "type": "object",
        "properties": {
            "operation": {"type": "string", "enum": list(OPERATIONS)},
            "budget": {"type": ["integer", "null"]},
            "priority": {"type": ["string", "null"], "enum": ["balanced", "healthcare", "transit", "education", None]},
            "intervention_id": {"type": ["string", "null"]},
            "category": {"type": ["string", "null"], "enum": ["healthcare", "transit", "education", "grocery", "parks", "services", None]},
            "profile": {"type": ["string", "null"], "enum": ["step_free", "pedestrian", None]},
        },
        "required": ["operation", "budget", "priority", "intervention_id", "category", "profile"],
    }
