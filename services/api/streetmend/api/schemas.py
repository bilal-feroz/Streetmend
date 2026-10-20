"""Typed API contracts (Pydantic). The frontend types are generated from these."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

PriorityPreset = Literal["balanced", "healthcare", "transit", "education"]


class WeightsIn(BaseModel):
    healthcare: float = Field(1.0, ge=0, le=10)
    transit: float = Field(1.0, ge=0, le=10)
    education: float = Field(1.0, ge=0, le=10)


class EvaluateRequest(BaseModel):
    applied: list[str] = Field(default_factory=list, max_length=64)
    origin: str | None = None
    destination: str | None = None
    weights: WeightsIn | None = None
    cutoff_m: float | None = Field(None, gt=0, le=10_000)
    alternatives: int = Field(0, ge=0, le=5)


class OptimizeRequest(BaseModel):
    budget: int = Field(2, ge=0, le=6)
    weights: WeightsIn | None = None
    priority: PriorityPreset | None = None
    cutoff_m: float | None = Field(None, gt=0, le=10_000)
    candidate_ids: list[str] | None = Field(None, max_length=2000)


# ---- scenario payload -------------------------------------------------------
class NodeOut(BaseModel):
    id: str
    kind: str
    lon: float
    lat: float
    label: str


class EdgeOut(BaseModel):
    id: str
    u: str
    v: str
    kind: str
    length_m: float
    geometry: list[list[float]]
    state: str
    evidence: str
    source: str
    source_ids: list[str]
    label: str
    reason: str
    attrs: dict[str, Any]


class OriginOut(BaseModel):
    id: str
    label: str
    weight: float
    weight_basis: str
    lon: float
    lat: float


class DestinationOut(BaseModel):
    id: str
    label: str
    category: str
    weight: float
    evidence: str
    source_ids: list[str]
    lon: float
    lat: float


class InterventionOut(BaseModel):
    id: str
    label: str
    kind: str
    edge_ids: list[str]
    lon: float
    lat: float
    description: str
    evidence: str
    source_ids: list[str]
    cost_units: int
    attrs: dict[str, Any]


class ScenarioSummary(BaseModel):
    id: str
    name: str
    mode: str
    description: str
    node_count: int
    edge_count: int
    candidate_count: int
    origin_count: int
    destination_count: int
    available: bool = True
    unavailable_reason: str | None = None


class ScenarioOut(ScenarioSummary):
    nodes: list[NodeOut]
    edges: list[EdgeOut]
    origins: list[OriginOut]
    destinations: list[DestinationOut]
    interventions: list[InterventionOut]
    max_distance_m: float | None
    default_journey: list[str] | None
    bounds: list[float] | None
    context: dict[str, Any]
    assumptions: list[str]
    provenance: list[dict[str, Any]]


# ---- evaluate ------------------------------------------------------------------
class RouteOut(BaseModel):
    found: bool
    origin: str
    destination: str
    node_ids: list[str]
    edge_ids: list[str]
    length_m: float | None
    geometry: list[list[float]]
    reason: str


class JourneyOut(BaseModel):
    route: RouteOut
    reach_wave: dict[str, float]
    reached_destinations: list[str]
    frontier_barriers: list[str]
    alternatives: list[RouteOut]


class MetricsOut(BaseModel):
    score: float
    max_possible: float
    connected_pairs: int
    total_pairs: int
    reachable_destinations: int
    total_destinations: int
    components: int
    cutoff_m: float | None


class PerOriginOut(BaseModel):
    origin: str
    reachable: list[str]
    distances_m: dict[str, float | None]


class EvaluateResponse(BaseModel):
    scenario_id: str
    applied: list[str]
    edge_states: dict[str, str]
    state_counts: dict[str, int]
    journey: JourneyOut | None
    metrics: MetricsOut
    per_origin: list[PerOriginOut]


# ---- optimize ------------------------------------------------------------------
class SolverOut(BaseModel):
    solver: str
    exact: bool
    selected: list[str]
    selected_labels: list[str]
    score: float
    gain: float
    connected_pairs: int
    evaluations: int
    runtime_ms: float
    candidate_count: int
    considered_count: int
    notes: list[str]


class ObjectiveOut(BaseModel):
    name: str
    formula: str
    before: float
    after: float
    gain: float
    relative_gain: float | None
    max_possible: float
    connected_pairs_before: int
    connected_pairs_after: int
    total_pairs: int


class PairOut(BaseModel):
    origin: str
    origin_label: str
    destination: str
    destination_label: str
    category: str
    before_m: float | None
    after_m: float
    weight: float


class ContributionOut(BaseModel):
    id: str
    label: str
    alone_gain: float
    marginal_in_set: float


class AlternativeOut(BaseModel):
    selected: list[str]
    selected_labels: list[str]
    score: float
    gain: float


class SensitivityOut(BaseModel):
    assumption: str
    baseline_score: float
    score_with_selected: float
    optimal_selected: list[str]
    optimal_score: float
    recommendation_changes: bool
    unknown_edge_count: int


class DestRef(BaseModel):
    id: str
    label: str
    category: str


class OptimizeResponse(BaseModel):
    scenario_id: str
    params: dict[str, Any]
    objective: ObjectiveOut
    recommendation: SolverOut
    baselines: list[SolverOut]
    advantage_over_best_baseline: float
    best_baseline: str
    newly_connected_pairs: list[PairOut]
    shortened_pairs: list[PairOut]
    newly_reachable_destinations: list[DestRef]
    contributions: list[ContributionOut]
    synergy: float
    alternatives: list[AlternativeOut]
    sensitivity: SensitivityOut
    explanation: list[str]
    assumptions: list[str]


# ---- assistant -------------------------------------------------------------------
class AssistantRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=500)
    scenario_id: str = "demo"
    applied: list[str] = Field(default_factory=list, max_length=64)
    budget: int = Field(2, ge=0, le=6)
    weights: WeightsIn | None = None
    use_llm: bool = True

    @field_validator("text")
    @classmethod
    def strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("empty request")
        return v


class HealthOut(BaseModel):
    status: str
    version: str
    scenarios: list[ScenarioSummary]
    llm: dict[str, Any]
