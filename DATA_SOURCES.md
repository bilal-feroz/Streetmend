# Data sources

Study area: **Elizabeth, Charlotte NC**, around Novant Health Presbyterian Medical Center. Bounding box (WGS84): `-80.832, 35.207, -80.818, 35.217` (about 1.3 × 1.1 km).

Prepared files are in `data/samples/charlotte_elizabeth/` and were produced by `scripts/ingest/fetch_charlotte.py`. Retrieval times, record counts and layer edit dates are in `provenance.json`; completeness and transform checks are in `quality.json`. Both are also shown in the app (*Charlotte Data Explorer → Data & quality*).

## City of Charlotte (official)

| Layer | Endpoint used | Records in area | Native CRS | Notes |
|---|---|---|---|---|
| CDOT ADA Curb Ramps | `services.arcgis.com/9Nl857LBlQVyzq54/ArcGIS/rest/services/ADA_Curb_Ramps_/FeatureServer/0` | 320 | EPSG:2264 (NC State Plane, US ft) | ArcGIS Online mirror with the same schema as the official MapServer `gis.charlottenc.gov/arcgis/rest/services/CDOT_ADA/ADA_Curb_Ramps/MapServer/0`, which was unreachable from the development network (connection timeouts). Layer last edited 2026-01-22. |
| CDOT Sidewalk Inventory | `services.arcgis.com/9Nl857LBlQVyzq54/ArcGIS/rest/services/Sidewalk_Inventory/FeatureServer/0` | 557 | EPSG:2264 | Per-side polylines, 4–11 m from OSM centerlines (measured), split evenly by side. `SidewalkPresence`: Sidewalk / No Sidewalk / Not possible to construct. |
| CATS Bus Stops | `services.arcgis.com/9Nl857LBlQVyzq54/ArcGIS/rest/services/Bus_Stops/FeatureServer/0` | 19 | EPSG:4326 | Stop ID, description, routes, amenities, average boardings. |

Charlotte-wide, the ramp layer holds 40,601 records (counted via `returnCountOnly`). The study area is a deliberately small subset.

### Ingestion steps
1. Read layer metadata (max record count, object-ID field, native spatial reference, edit info).
2. Query the bbox with `resultOffset` / `resultRecordCount` pagination, retries with exponential backoff, and a response cache.
3. Request geometry in the **native projected CRS** and transform it locally with pyproj (EPSG:2264 → EPSG:4326, `always_xy`). Cross-check against ArcGIS server-side reprojection on 25 records: **max difference 0.82 m**. Projected feet are never treated as latitude/longitude.
4. Deduplicate by OBJECTID and by (asset ID, location). Count missing values for key fields.
5. Write normalized GeoJSON that keeps the original identifiers (OBJECTID, RP_AssetID, ADA_ID, RP_IntID, AssetID, StopID).

If a source is unavailable, its provenance entry is written with `status: unavailable` and the error. The app never substitutes fabricated records.

### Field observations (study area, after ingestion)
* `RP_ComplianceStatus`: 313 No, 1 Yes, 6 missing. Nearly every ramp is recorded as non-compliant, which is why passability needs an explicit policy.
* `RP_Type`: PerpDiag 119, Perp 92, **NoRamp 53**, BlendTrans 27, Directional 16, others.
* `Remediated`: No 297, Yes 13, Committed 9, New 1. `RemediatedDate` is present for 2 records.
* `ActualCosts`: missing for all 320, so no monetary budget is modeled.
* `RP_SurveyDate`: 2017–2019 (historical survey); 6 missing.
* `RP_Slope` (running slope %): 89 missing; median 8.8%, max 17.3%.

Compliance classification, remediation status, physical condition and route connectivity are different concepts. StreetMend never maps `Remediated` or compliance directly to a verified passability guarantee (see METHODOLOGY.md §6).

## OpenStreetMap

Retrieved with OSMnx (Overpass API, with backoff across mirrors and a fallback to the OSM API 0.6 map call for this small bbox):
* 317 drive-network street edges and 211 intersections (bbox padded by about 150 m so edge intersections keep all legs);
* 65 amenity/healthcare POIs, including Novant Health Presbyterian Medical Center, Atrium Health Mercy, Charlotte Orthopedic Hospital, several clinics, Walgreens, Elizabeth Traditional Elementary and Central Piedmont Community College;
* 577 buildings and 15 residential land-use areas.

### Building footprints (3D city)

`scripts/ingest/fetch_buildings.py` fetched **5,113** OSM building footprints for a wider box around the study area and Uptown, `-80.848, 35.200, -80.810, 35.230` (WGS84). It uses Overpass with mirror fallback and falls back to tiled OSM API 0.6 map calls when Overpass is busy. The file is `data/samples/charlotte_city/buildings.geojson`, retrieved 2026-10-20, 1.9 MB. The API serves it gzipped at `/api/context/buildings`.

Each feature keeps its OSM id, name, building type and amenity tag, plus a height and its source:

| Height source | Buildings | Height used |
|---|---|---|
| `height` tag | 333 | the tagged height |
| `building:levels` | 59 | levels × 3.2 m (+ `roof:levels`) |
| neither (estimate) | 4,721 | a type-based visualization assumption, for example house 7 m, garage 3 m, default 7 m |

Building heights are used only for display; no analysis reads them.

License: **ODbL 1.0, © OpenStreetMap contributors.**

### Basemap

Vector tiles and label fonts come from **OpenFreeMap** (`tiles.openfreemap.org`; OpenMapTiles schema, OSM data). It needs no API key and no account, and attribution is shown on the map at all times. The light style itself is defined in the app (`apps/web/src/map/style.ts`). No Google Maps, Google Earth or other proprietary imagery is used.

## Scenario data

* **Guided scenario**: real geometry and places from the Elizabeth candidate graph. The passability states are **hypothetical** scenario settings from `data/scenarios/charlotte_guided.json` (see METHODOLOGY.md §5). The UI labels them *Hypothetical barriers · real Charlotte streets*. None of these states are observations or claims about the actual corners.
* **Synthetic Harbor District**: generated by `streetmend/scenario/demo.py` in a local metric frame around (0°, 0°). Kept as a test fixture and benchmark section; it is not shown in the app.
