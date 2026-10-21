"""The benchmark fixtures: every claim must hold on every fixture."""

import gc

import pytest

from streetmend.evaluation.fixtures import fixtures
from streetmend.evaluation.run import run_case
from streetmend.verify import NetworkState, apply_changes, evaluate


@pytest.mark.parametrize("fx", fixtures(), ids=lambda f: f.id)
def test_fixture(fx):
    r = run_case(fx.id, fx.sc, fx.proposal, fx.reqs, fx.expect, fx.budget)
    assert r["correct"], r["checks"]


def test_unknown_stays_inconclusive_after_many_graphs():
    """Regression: graph facts were cached by id(), which Python reuses after garbage collection."""

    by_id = {f.id: f for f in fixtures()}
    for _ in range(30):  # create and drop many graphs without unknown links
        f = by_id["single_bottleneck"]
        NetworkState(apply_changes(f.sc, f.proposal), [], "x")
        del f
        by_id = {f.id: f for f in fixtures()}
        gc.collect()
    u = by_id["unknown_state"]
    base = NetworkState(u.sc, [], "b")
    st = NetworkState(apply_changes(u.sc, u.proposal), [], "p")
    assert evaluate(u.reqs[0], st, base).status == "INCONCLUSIVE"
