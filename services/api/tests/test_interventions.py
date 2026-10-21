"""The intervention model: types, preconditions, dependencies and budgets in the fix search."""

from dataclasses import replace

import pytest

from streetmend.scenario.preflight import load_preflight_scenario, proposal, requirements
from streetmend.verify import synthesize
from streetmend.verify.interventions import TYPES, InterventionError, catalog, spec, validate_catalog


@pytest.fixture(scope="module")
def pre():
    return load_preflight_scenario()


def _with(sc, **attrs_by_id):
    ivs = {}
    for i, iv in sc.interventions.items():
        extra = attrs_by_id.get(i, {})
        ivs[i] = replace(iv, attrs={**iv.attrs, **extra}) if extra else iv
    return replace(sc, interventions=ivs)


def test_every_shipped_catalog_is_valid(pre):
    from streetmend.api.registry import registry

    registry.load()
    for sc in registry.scenarios.values():
        validate_catalog(sc)


def test_spec_fields(pre):
    a = spec(pre, pre.interventions["A"])
    for k in ("id", "type", "targets", "state_changes", "preconditions", "profiles", "cost_units", "dependencies", "provenance", "status"):
        assert k in a
    assert a["type"] == "temporary_curb_ramp" and a["profiles"] == ["step_free"] and a["status"] == "simulated"
    assert all(p["holds"] for p in a["preconditions"])
    assert a["state_changes"][0]["to"] == "traversable"
    types = {t["key"]: t for t in catalog(pre)["types"]}
    assert not types["close_road"]["supported"] and types["build_sidewalk"]["supported"]


def test_record_backed_status():
    from streetmend.municipal.scenario import load_municipal_scenario

    sc = load_municipal_scenario("moderate")
    s = spec(sc, next(iter(sc.interventions.values())))
    assert s["status"] == "record-backed" and s["provenance"]["source_ids"]


def test_validation_rejects_cycles_and_bad_preconditions(pre):
    with pytest.raises(InterventionError, match="cycle"):
        validate_catalog(_with(pre, A={"requires": ["B"]}, B={"requires": ["A"]}))
    with pytest.raises(InterventionError, match="requires"):
        validate_catalog(_with(pre, A={"requires": ["Z"]}))
    bad = replace(pre, interventions={**pre.interventions, "X": replace(pre.interventions["A"], id="X", kind="close_road")})
    with pytest.raises(InterventionError, match="unsupported"):
        validate_catalog(bad)
    assert "close_road" in TYPES


def test_budget_reports_infeasibility_instead_of_faking_a_fix(pre):
    reqs = requirements(pre)
    r = synthesize(pre, proposal(pre, "P1"), reqs, pre.default_journey, budget=1)
    assert r["status"] == "over_budget" and r["interventions"] == []
    assert r["over_budget"][0]["ids"] == ["A", "B"] and r["over_budget"][0]["cost_units"] == 2
    assert synthesize(pre, proposal(pre, "P1"), reqs, pre.default_journey, budget=2)["interventions"] == ["A", "B"]


def test_dependencies_are_respected(pre):
    """If A can only be installed together with D, the minimal admissible fix grows to {A, B, D}."""

    sc = _with(pre, A={"requires": ["D"]})
    validate_catalog(sc)
    r = synthesize(sc, proposal(sc, "P1"), requirements(sc), sc.default_journey)
    assert r["status"] == "found" and sorted(r["interventions"]) == ["A", "B", "D"]
    assert r["skipped_dependencies"] > 0
    assert r["verification"]["summary"]["FAIL"] == 0
