"""StreetMend HTTP API (FastAPI).

Run:  uv run uvicorn streetmend.api.main:app --port 8000
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import PlainTextResponse

from streetmend import __version__
from streetmend.optimize.analysis import AnalysisParams, analyze
from streetmend.optimize.objective import PRIORITY_PRESETS, CategoryWeights
from streetmend.scenario.evaluate import evaluate_state
from streetmend.scenario.model import Scenario
from streetmend.scenario.state import StateError

from . import schemas as S
from .registry import registry
from .serialize import markdown_report, scenario_payload, summary

log = logging.getLogger("streetmend")


@asynccontextmanager
async def lifespan(app: FastAPI):
    registry.load()
    yield


app = FastAPI(
    title="StreetMend API",
    version=__version__,
    description="Combination-aware pedestrian accessibility repair planning. Planning prototype; not an ADA compliance tool.",
    lifespan=lifespan,
)
app.add_middleware(GZipMiddleware, minimum_size=2048)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("STREETMEND_CORS", "http://localhost:5173,http://127.0.0.1:5173").split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def _scenario(sid: str) -> Scenario:
    sc = registry.get(sid)
    if sc is None:
        if sid in registry.unavailable:
            raise HTTPException(503, detail=registry.unavailable[sid].reason)
        raise HTTPException(404, detail=f"unknown scenario '{sid}'")
    return sc


def _weights(w: S.WeightsIn | None, preset: str | None = None) -> CategoryWeights:
    if w is not None:
        return CategoryWeights(w.healthcare, w.transit, w.education)
    if preset:
        return PRIORITY_PRESETS[preset]
    return CategoryWeights()


def _check_ids(sc: Scenario, ids: list[str] | None, what: str) -> None:
    if ids is None:
        return
    bad = sorted(set(ids) - set(sc.interventions))
    if bad:
        raise HTTPException(422, detail=f"unknown {what}: {', '.join(bad[:10])}")


def _summaries() -> list[dict]:
    out = [summary(s) for s in registry.scenarios.values()]
    for u in registry.unavailable.values():
        out.append({"id": u.id, "name": u.name, "mode": u.mode, "description": "", "node_count": 0, "edge_count": 0,
                    "candidate_count": 0, "origin_count": 0, "destination_count": 0, "available": False,
                    "unavailable_reason": u.reason})
    return out


@app.get("/api/health", response_model=S.HealthOut)
def health():
    from streetmend.ai.llm import llm_status

    return {"status": "ok", "version": __version__, "scenarios": _summaries(), "llm": llm_status()}


@app.get("/api/scenarios", response_model=list[S.ScenarioSummary])
def list_scenarios():
    return _summaries()


@app.get("/api/scenarios/{sid}", response_model=S.ScenarioOut)
def get_scenario(sid: str):
    return scenario_payload(_scenario(sid))


@app.post("/api/scenarios/{sid}/evaluate", response_model=S.EvaluateResponse)
def evaluate(sid: str, req: S.EvaluateRequest):
    sc = _scenario(sid)
    _check_ids(sc, req.applied, "interventions")
    for nid in (req.origin, req.destination):
        if nid is not None and nid not in sc.graph.nodes:
            raise HTTPException(422, detail=f"unknown node '{nid}'")
    try:
        return evaluate_state(sc, req.applied, req.origin, req.destination, _weights(req.weights), req.cutoff_m, req.alternatives)
    except StateError as exc:
        raise HTTPException(422, detail=str(exc)) from exc


def _analysis(sc: Scenario, req: S.OptimizeRequest) -> dict:
    _check_ids(sc, req.candidate_ids, "candidates")
    return analyze(sc, AnalysisParams(budget=req.budget, weights=_weights(req.weights, req.priority),
                                      cutoff_m=req.cutoff_m, candidate_ids=req.candidate_ids))


@app.post("/api/scenarios/{sid}/optimize", response_model=S.OptimizeResponse)
def optimize(sid: str, req: S.OptimizeRequest):
    return _analysis(_scenario(sid), req)


@app.post("/api/scenarios/{sid}/report", response_class=PlainTextResponse)
def report(sid: str, req: S.OptimizeRequest, applied: str = ""):
    sc = _scenario(sid)
    a = _analysis(sc, req)
    applied_ids = [x for x in applied.split(",") if x]
    _check_ids(sc, applied_ids, "interventions")
    state = evaluate_state(sc, applied_ids, weights=_weights(req.weights, req.priority), cutoff_m=req.cutoff_m)
    return PlainTextResponse(markdown_report(sc, a, state), media_type="text/markdown")


@app.post("/api/assistant")
def assistant(req: S.AssistantRequest):
    from streetmend.ai.executor import handle

    sc = _scenario(req.scenario_id)
    _check_ids(sc, req.applied, "interventions")
    journey = (req.origin, req.destination) if req.origin and req.destination else None
    for nid in journey or ():
        if nid not in sc.graph.nodes:
            raise HTTPException(422, detail=f"unknown node '{nid}'")
    return handle(sc, req.text, req.applied, req.budget, _weights(req.weights), req.use_llm, req.cutoff_m, journey)


@app.get("/api/municipal/records")
def municipal_records():
    from streetmend.municipal.scenario import load_records

    try:
        return load_records()
    except FileNotFoundError as exc:
        raise HTTPException(503, detail=f"Municipal records not prepared: {exc}") from exc


@app.get("/api/context/buildings")
def buildings():
    """OSM building footprints for the 3D city area of interest (visualization context, not graph input)."""
    from fastapi.responses import Response

    from streetmend.municipal.scenario import DATA_DIR

    path = DATA_DIR / "samples" / "charlotte_city" / "buildings.geojson"
    if not path.exists():
        raise HTTPException(503, detail="Building footprints not prepared. Run scripts/ingest/fetch_buildings.py.")
    return Response(path.read_bytes(), media_type="application/geo+json", headers={"Cache-Control": "public, max-age=3600"})


@app.get("/api/context/trees")
def trees():
    """Tree canopy for the 3D city (visualization context, not graph input): canopy amount per
    area from the City's 2022 assessment, OSM-mapped trees at real positions, other positions illustrative."""
    from fastapi.responses import Response

    from streetmend.municipal.scenario import DATA_DIR

    path = DATA_DIR / "samples" / "charlotte_city" / "trees.json"
    if not path.exists():
        raise HTTPException(503, detail="Tree canopy not prepared. Run scripts/ingest/fetch_trees.py.")
    return Response(path.read_bytes(), media_type="application/json", headers={"Cache-Control": "public, max-age=3600"})
