"""Discover, diagnose and fix-or-build on the real Elizabeth records."""

import numpy as np
import pytest

from streetmend.access.analysis import CATEGORIES, THRESHOLD_M, analyze, classify, diagnose, home_status, municipal_model, overview
from streetmend.access.intervene import compare, repair_candidates
from streetmend.verify.profiles import Profile

SE_CELL = "8944d84d32fffff"  # homes in south-east Elizabeth cut off from schools by recorded sidewalk gaps


@pytest.fixture(scope="module")
def model():
    return municipal_model("moderate")


def test_classify_separates_unknown_from_unreachable():
    inf = np.inf
    T = 800.0
    f = classify(
        np.array([500, inf, inf, inf, inf, inf]),  # verified (unknown links excluded)
        np.array([500, 700, inf, inf, inf, inf]),  # possible (unknown links included)
        np.array([500, 700, 600, 900, 2000, inf]),  # physical (every modeled link open)
        np.array([400, 600, 500, 700, 900, 1200]),  # straight line, routable facilities
        np.array([inf, inf, inf, inf, 750, inf]),  # straight line, facilities outside the network
        T,
    )
    assert f == ["served", "unknown_links", "barrier", "detour", "outside_area", "distance"]


def test_distance_states_are_ordered(model):
    for cat in CATEGORIES:
        for prof in (Profile.STEP_FREE, Profile.PEDESTRIAN):
            st = home_status(model, cat, prof)
            v, p, ph = st["verified"], st["possible"], st["physical"]
            assert np.all(v >= p - 1e-6) and np.all(p >= ph - 1e-6)
            # straight line is a lower bound on the network distance to routable facilities
            fin = np.isfinite(ph)
            assert np.all(st["straight"][fin] <= ph[fin] + 1e-6)
            T = st["T"]
            for k, fac in enumerate(st["factor"]):
                if fac == "served":
                    assert v[k] <= T
                elif fac == "unknown_links":
                    assert v[k] > T >= p[k]
                elif fac == "barrier":
                    assert p[k] > T >= ph[k]
                elif fac == "distance":
                    assert st["straight"][k] > T and st["straight_outside"][k] > T


def test_walking_never_worse_than_step_free(model):
    for cat in CATEGORIES:
        sf = home_status(model, cat, Profile.STEP_FREE)
        wk = home_status(model, cat, Profile.PEDESTRIAN)
        assert np.all(wk["verified"] <= sf["verified"] + 1e-6)
        assert np.all(wk["possible"] <= sf["possible"] + 1e-6)


def test_overview_and_cells(model):
    o = overview(model)
    assert [r["category"] for r in o["categories"]] == list(CATEGORIES)
    for r in o["categories"]:
        assert r["served"] + r["uncertain"] + r["failing"] == r["homes"] == len(model.homes)
    a = analyze(model, "education")
    assert sum(c["homes"] for c in a["cells"]) == len(model.homes)
    assert a["ranking"][0] == SE_CELL
    assert all(len(c["boundary"]) >= 6 for c in a["cells"])


def test_grocery_gap_is_availability_not_connectivity(model):
    """No supermarket inside the modeled network: nothing can PASS, repairs cannot help, a new store can."""

    a = analyze(model, "grocery")
    assert a["summary"]["served"] == 0
    assert a["summary"]["factors"]["barrier"] == 0
    cell = next(c["id"] for c in a["cells"] if c["primary_factor"] == "distance")
    d = diagnose(model, cell, "grocery")
    assert d["primary_factor"] == "distance" and "Repairs cannot close this gap" in d["sentence"]
    r = compare(model, "grocery", [cell], budget=2)
    assert r["fix"]["status"] == "none" and r["build"]["status"] == "found" and r["winner"] == "build"


def test_diagnosis_names_recorded_barriers(model):
    d = diagnose(model, SE_CELL, "education")
    assert d["primary_factor"] == "barrier"
    rep = d["representative"]
    assert rep["physical_m"] <= THRESHOLD_M["education"] < rep["step_free_possible_m"]
    assert rep["barriers"] and all(b["reason"] for b in rep["barriers"])
    assert any("No Sidewalk" in b["reason"] for b in rep["barriers"])


def test_fix_or_build_depends_on_budget(model):
    one = compare(model, "education", [SE_CELL], budget=1)
    two = compare(model, "education", [SE_CELL], budget=2)
    assert one["winner"] == "build" and two["winner"] == "fix"
    f = two["fix"]
    assert f["exact"] and len(f["repairs"]) == 2 and f["synergy"]
    assert min(r["alone_gain"] for r in f["repairs"]) == 0  # one repair is worthless alone
    # the independent recomputation agrees with the search
    assert f["after"]["possible"] == two["baseline"] + f["gain"]
    assert two["build"]["after"]["possible"] == two["baseline"] + two["build"]["gain"]
    assert two["build"]["site"]["hypothetical"]


def test_repair_pruning_never_drops_a_useful_repair(model):
    """Brute force over every repair candidate: nothing outside the searched set helps on its own."""

    r = compare(model, "education", [SE_CELL], budget=1)
    searched = {s["id"] for s in r["fix"]["singles"]}
    from streetmend.access.intervene import _Eval

    homes = [h for h in model.homes if h.cell == SE_CELL and h.snap is not None]
    ev = _Eval(model, "education", homes, "step_free:possible", THRESHOLD_M["education"])
    base = ev.count()
    best_alone = max(s["gain"] for s in r["fix"]["singles"])
    for rep in repair_candidates(model):
        g = ev.count(frozenset(rep.edge_ids)) - base
        assert g <= best_alone
        if rep.id not in searched:
            assert g == 0, rep.id
