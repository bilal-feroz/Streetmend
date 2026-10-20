"""Ingestion pipeline: pagination, reprojection, and failure handling (no network)."""

import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "ingest" / "fetch_charlotte.py"
spec = importlib.util.spec_from_file_location("fetch_charlotte", SCRIPT)
fc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fc)


def test_pagination_collects_every_page(monkeypatch):
    total = 2350
    feats = [{"attributes": {"OBJECTID": i}, "geometry": {"x": 1442000.0 + i, "y": 540000.0}} for i in range(total)]

    def fake_get(client, url, params, refresh, retries=4):
        if "where" not in params:
            return {"maxRecordCount": 1000, "objectIdField": "OBJECTID",
                    "extent": {"spatialReference": {"wkid": 102719, "latestWkid": 2264}}}
        if params.get("returnCountOnly"):
            return {"count": total}
        off, n = params.get("resultOffset", 0), params.get("resultRecordCount", 1000)
        return {"features": feats[off: off + n], "exceededTransferLimit": off + n < total}

    monkeypatch.setattr(fc, "cached_get", fake_get)
    meta, got, extra = fc.fetch_layer(None, "ramps", False)
    assert len(got) == total
    assert [f["attributes"]["OBJECTID"] for f in got] == list(range(total))
    assert extra["native_sr"]["latestWkid"] == 2264


def test_state_plane_feet_transform_to_wgs84():
    tf, epsg = fc.to_wgs84({"wkid": 102719, "latestWkid": 2264})
    assert epsg == 2264
    lon, lat = tf(1452000.0, 543000.0)  # NC State Plane (US ft) near uptown Charlotte
    assert -80.9 < lon < -80.7 and 35.1 < lat < 35.3
    ident, e = fc.to_wgs84({"wkid": 4326})
    assert e == 4326 and ident(-80.8, 35.2) == (-80.8, 35.2)


def test_unavailable_source_raises_clear_error(monkeypatch, tmp_path):
    class Boom:
        def get(self, *a, **k):
            raise ConnectionError("timed out")

    monkeypatch.setattr(fc, "CACHE", tmp_path)
    monkeypatch.setattr(fc.time, "sleep", lambda s: None)
    with pytest.raises(RuntimeError, match="source unavailable"):
        fc.cached_get(Boom(), "https://example.invalid/layer", {"f": "json"}, refresh=True, retries=2)


def test_normalize_ramps_dedupes_and_counts_missing():
    def tf(x, y):
        return (x, y)

    def f(oid, asset, x):
        return {"attributes": {"OBJECTID": oid, "RP_AssetID": asset, "RP_Type": "Perp"}, "geometry": {"x": x, "y": 35.2}}

    out, q = fc.normalize_ramps([f(1, "R1", -80.8), f(1, "R1", -80.8), f(2, "R1", -80.8), f(3, "R3", -80.81)], tf, "OBJECTID")
    assert [o["properties"]["OBJECTID"] for o in out] == [1, 3]
    assert len(q["duplicates_removed"]) == 2
    assert q["missing"]["RP_SurveyDate"] == 2
