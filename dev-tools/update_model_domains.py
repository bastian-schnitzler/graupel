#!/usr/bin/env python3
"""
dev-tools/update_model_domains.py

Derives every catalogue model's domain (system.md §6.2) and writes
graupel/models/model_domains.json plus the map viewer data
docs/domain/model_domains.js (only if docs/domain/ exists; the public repo has
no viewer).

1. Grid: `meta.json` `crs_wkt` names the grid CRS and its corner points
   (`BBOX`). Every grid is a rectangle in its own coordinates, so the domain
   is that rectangle projected back to lon/lat.
2. Verify: the forecast API answers `No data is available for this location`
   outside a domain (all-null values inside one are not "outside"). Probes
   0.3° (geographic and rotated grids) or 30 km (projected grids) inside and
   outside each edge must agree with the grid rectangle.
3. Measure: when they disagree, the boundary is measured by bisection,
   along 48 rays from the grid centre in grid coordinates (ICON native
   grids and AROME deliver less than their regular-grid envelope, ICON-EU
   and RDPS partly more).

Seamless blends without own metadata are global when far points on every
continent deliver data. The tool sends up to a few thousand single-point
requests (throttled to ~8/s); `--only id,id` limits it to some models and
keeps the others from the existing file. Needs the dev group (pyproj,
shapely): `uv run python dev-tools/update_model_domains.py`.
"""

import argparse
import concurrent.futures as cf
import json
import math
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

from pyproj import CRS, Transformer
from shapely.geometry import Polygon

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from graupel.data.open_meteo import model_meta_path  # noqa: E402

CATALOGUE = ROOT / "graupel" / "models" / "model_catalogue.json"
OUT_JSON = ROOT / "graupel" / "models" / "model_domains.json"
OUT_JS = ROOT / "docs" / "domain" / "model_domains.js"
META_URL = "https://api.open-meteo.com/data/{path}/static/meta.json"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
SPHERE = 6371229.0
# Far points (lat, lon) on every continent and ocean; a model delivering all
# of them is global.
GLOBAL_PROBES = [
    (40, -35),
    (-30, 140),
    (10, 20),
    (-15, -60),
    (60, 100),
    (-45, 170),
]
SIMPLIFY_DEG = 0.01
# Regional blends without own metadata take the domain of their widest
# component.
REGIONAL_BLENDS = {
    "meteoswiss_icon_seamless": "meteoswiss_icon_ch2",
    "geosphere_seamless": "geosphere_arome_austria",
}

_lock = threading.Lock()
_last = [0.0]


def has_data(model: str, lat: float, lon: float) -> bool:
    """True unless the API says the point is outside the model domain."""
    if not -89.9 < lat < 89.9:
        return False
    lon = ((lon + 180) % 360) - 180
    url = (
        f"{FORECAST_URL}?latitude={lat:.4f}&longitude={lon:.4f}"
        f"&hourly=temperature_2m&models={model}&forecast_days=1"
    )
    for attempt in range(60):
        with _lock:
            wait = _last[0] + 0.12 - time.time()
            if wait > 0:
                time.sleep(wait)
            _last[0] = time.time()
        try:
            with urllib.request.urlopen(url, timeout=30) as response:
                return "hourly" in json.load(response)
        except urllib.error.HTTPError as e:
            if e.code == 400:
                return False
            # 429: the minutely/hourly quota only resets with time.
            time.sleep(60 if e.code == 429 else 10)
        except (urllib.error.URLError, TimeoutError):
            time.sleep(10)
    raise RuntimeError(f"no answer for {url}")


def proj_string(wkt: str) -> Optional[str]:
    """PROJ string of the grid CRS, or None for a plain lon/lat grid."""
    method = re.findall(r'METHOD\["([^"]*)"', wkt)
    if not method:
        return None
    p = {
        k: float(v)
        for k, v in re.findall(r'PARAMETER\["([^"]*)",\s*([-\d.]+)', wkt)
    }
    m = method[0]
    if m.startswith("Lambert Conic"):
        return (
            f"+proj=lcc +lat_1={p['Latitude of 1st standard parallel']} "
            f"+lat_2={p['Latitude of 2nd standard parallel']} "
            f"+lat_0={p['Latitude of false origin']} "
            f"+lon_0={p['Longitude of false origin']} +R={SPHERE} +units=m"
        )
    if m.startswith("Lambert Azimuthal"):
        return (
            f"+proj=laea +lat_0={p['Latitude of natural origin']} "
            f"+lon_0={p['Longitude of natural origin']} +R={SPHERE} +units=m"
        )
    if m == "Stereographic":
        return (
            f"+proj=stere +lat_0={p['Latitude of natural origin']} "
            f"+lon_0={p['Longitude of natural origin']} +k=1 "
            f"+R={SPHERE} +units=m"
        )
    if "ob_tran" in m:
        return (
            f"+proj=ob_tran +o_proj=longlat +o_lon_p={p['o_lon_p']} "
            f"+o_lat_p={p['o_lat_p']} +lon_0={p['lon_0']} +R={SPHERE} "
            "+to_meter=0.0174532925199433"
        )
    raise ValueError(f"unsupported grid projection {m}")


class Grid:
    """Grid rectangle in its own coordinates plus the transform to lon/lat."""

    def __init__(self, wkt: str):
        lat0, lon0, lat1, lon1 = map(
            float, re.findall(r"BBOX\[([^\]]*)\]", wkt)[0].split(",")
        )
        ps = proj_string(wkt)
        self.geographic = ps is None
        self.metric = ps is not None and "ob_tran" not in ps
        if ps is None:
            self.forward: Callable = lambda lon, lat: (lon, lat)
            self.inverse: Callable = lambda x, y: (x, y)
        else:
            t = Transformer.from_crs(
                CRS.from_proj4(f"+proj=longlat +R={SPHERE}"),
                CRS.from_proj4(ps),
                always_xy=True,
            )
            self.forward = t.transform
            self.inverse = lambda x, y: t.transform(x, y, direction="INVERSE")
        x0, y0 = self.forward(lon0, lat0)
        x1, y1 = self.forward(lon1, lat1)
        self.rect = (min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))
        self.offset = 30000.0 if self.metric else 0.3

    def is_global(self) -> bool:
        x0, y0, x1, y1 = self.rect
        return self.geographic and x1 - x0 >= 359 and y1 - y0 >= 170

    def ring(
        self, rect: Tuple[float, float, float, float], n: int = 200
    ) -> List:
        x0, y0, x1, y1 = rect
        xs, ys = [], []
        for i in range(n):
            f = i / n
            xs += [x0 + (x1 - x0) * f, x1, x1 - (x1 - x0) * f, x0]
            ys += [y0, y0 + (y1 - y0) * f, y1, y1 - (y1 - y0) * f]
        # Walk the edges in order: bottom, right, top, left.
        order = [k * 4 + e for e in range(4) for k in range(n)]
        lonlat = [self.inverse(xs[i], ys[i]) for i in order]
        return close_ring([p[0] for p in lonlat], [p[1] for p in lonlat])

    def edge_probes(self, rect) -> List[Tuple[bool, float, float]]:
        """(expected, lat, lon) points just inside and outside each edge."""
        x0, y0, x1, y1 = rect
        probes = []
        for f in (0.25, 0.5, 0.75):
            xm, ym = x0 + (x1 - x0) * f, y0 + (y1 - y0) * f
            for sign, expected in ((1, True), (-1, False)):
                o = self.offset * sign
                for x, y in (
                    (x0 + o, ym),
                    (x1 - o, ym),
                    (xm, y0 + o),
                    (xm, y1 - o),
                ):
                    lon, lat = self.inverse(x, y)
                    probes.append((expected, lat, lon))
        return probes


def close_ring(
    lons: List[float], lats: List[float]
) -> List[Tuple[float, float]]:
    """Unwrap longitudes at the antimeridian; close a ring around a pole."""
    out: List[float] = []
    for lon in lons:
        lon = ((lon + 180) % 360) - 180
        if out:
            while lon - out[-1] > 180:
                lon -= 360
            while lon - out[-1] < -180:
                lon += 360
        out.append(lon)
    pts = list(zip(out, lats))
    if abs(abs(out[-1] - out[0]) - 360) < 10:
        pole = 90.0 if sum(lats) > 0 else -90.0
        pts += [(out[-1], pole), (out[0], pole)]
    return pts


def bisect(inside: Callable[[float], bool], start: float, tol: float) -> float:
    """Largest distance still inside; `inside(0)` must be True."""
    lo, hi = 0.0, start
    while inside(hi):
        lo, hi = hi, hi * 1.6 + tol
    while hi - lo > tol:
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if inside(mid) else (lo, mid)
    return lo


def measure_rays(model: str, grid: Grid, n: int = 48) -> List:
    """Boundary along n rays from the grid centre, in grid coordinates.

    Assumes only a star-shaped domain, not the rectangle: RDPS delivers
    data beyond its BBOX in some directions and less in others.
    """
    x0, y0, x1, y1 = grid.rect
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    lon, lat = grid.inverse(cx, cy)
    if not has_data(model, lat, lon):
        raise RuntimeError(f"{model}: centre {lat:.2f}, {lon:.2f} has no data")
    tol = 3000.0 if grid.metric else 0.03
    start = min(x1 - x0, y1 - y0) / 4

    def at(x: float, y: float) -> bool:
        lon, lat = grid.inverse(x, y)
        return has_data(model, lat, lon)

    def ray(k: int) -> Tuple[float, float]:
        a = 2 * math.pi * k / n
        dx, dy = math.cos(a), math.sin(a)
        r = bisect(lambda t: at(cx + dx * t, cy + dy * t), start, tol)
        return cx + dx * r, cy + dy * r

    with cf.ThreadPoolExecutor(4) as ex:
        points = list(ex.map(ray, range(n)))
    lonlat = [grid.inverse(x, y) for x, y in points]
    return close_ring([p[0] for p in lonlat], [p[1] for p in lonlat])


def mismatches(model: str, probes: List[Tuple[bool, float, float]]) -> List:
    with cf.ThreadPoolExecutor(4) as ex:
        got = list(ex.map(lambda p: has_data(model, p[1], p[2]), probes))
    return [p for p, g in zip(probes, got) if g is not p[0]]


def simplify(ring: List) -> List[List[float]]:
    poly = Polygon(ring).simplify(SIMPLIFY_DEG, preserve_topology=True)
    if not poly.is_valid:
        raise RuntimeError("invalid domain polygon")
    return [[round(x, 3), round(y, 3)] for x, y in poly.exterior.coords]


def fetch_meta(path: str) -> Optional[dict]:
    try:
        with urllib.request.urlopen(
            META_URL.format(path=path), timeout=30
        ) as r:
            return json.load(r)
    except urllib.error.HTTPError:
        return None


def resolve(model: str, done: Dict[str, object]) -> object:
    path = model_meta_path(model)
    meta = fetch_meta(path) if path else None
    if meta is None or "crs_wkt" not in meta:
        if model in REGIONAL_BLENDS:
            return done[REGIONAL_BLENDS[model]]
        missing = [p for p in GLOBAL_PROBES if not has_data(model, *p)]
        if missing:
            raise RuntimeError(
                f"{model}: no grid metadata and no data at {missing}"
            )
        return "global"
    grid = Grid(meta["crs_wkt"])
    if grid.is_global():
        return "global"
    ring = grid.ring(grid.rect)
    bad = mismatches(model, grid.edge_probes(grid.rect))
    if not bad:
        return {"source": "grid", "polygon": simplify(ring)}
    print(f"  {model}: {len(bad)} probes disagree with the grid, measuring")
    ring = measure_rays(model, grid)
    return {"source": "measured", "polygon": simplify(ring)}


def write(domains: Dict[str, object]) -> None:
    doc = {
        "_comment": (
            "Generated by dev-tools/update_model_domains.py; do not edit."
        ),
        "models": dict(sorted(domains.items())),
    }
    OUT_JSON.write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8")
    write_viewer_data()


def continent(entry: object) -> str:
    """Sidebar group of a domain, from the centre of its polygon."""
    if not isinstance(entry, dict):
        return "Global"
    # Spanning more than half the globe (RDPS reaches over the pole from
    # America to Europe) is no single continent.
    lons = [lon for lon, _ in entry["polygon"]]
    if max(lons) - min(lons) > 180:
        return "Intercontinental"
    # Majority of boundary points every 1° below 75° N: a mean longitude
    # fails for rings around a pole, plain vertices for sparse boxes.
    votes = {"North America": 0, "Europe": 0, "Asia": 0}
    edge = Polygon(entry["polygon"]).exterior.segmentize(1.0)
    for lon, lat in edge.coords[:-1]:
        if lat > 75:
            continue
        lon = ((lon + 180) % 360) - 180
        if lon < -30:
            votes["North America"] += 1
        else:
            votes["Europe" if lon < 60 else "Asia"] += 1
    return max(votes, key=lambda k: votes[k])


def write_viewer_data() -> None:
    # The map viewer lives only in the private repo (copy_release.sh).
    if not OUT_JS.parent.is_dir():
        print(f"no {OUT_JS.parent.relative_to(ROOT)}/, viewer data skipped")
        return
    doc = json.loads(OUT_JSON.read_text(encoding="utf-8"))
    catalogue = {
        m["id"]: m for m in json.loads(CATALOGUE.read_text(encoding="utf-8"))
    }
    data = {}
    for model_id, entry in doc["models"].items():
        model = catalogue.get(model_id, {})
        data[model_id] = {
            "name": model.get("name", model_id),
            "hours": model.get("max_forecast_hours"),
            "resolution_km": model.get("spatial_resolution_km"),
            "continent": continent(entry),
            "short_name": model.get("short_name"),
            # Usable in a cloud chain (vertical profile, >= 10 levels).
            "cloud": bool(model.get("supports_vertical_cloud_profile"))
            and len(model.get("pressure_levels_hpa") or []) >= 10,
            "domain": entry,
        }
    OUT_JS.write_text(
        "// Generated by dev-tools/update_model_domains.py; do not edit.\n"
        f"window.MODEL_DOMAINS = {json.dumps(data, separators=(',', ':'))};\n",
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--only", help="comma-separated model ids to (re)derive"
    )
    parser.add_argument(
        "--viewer-only",
        action="store_true",
        help="only rewrite the map viewer data",
    )
    args = parser.parse_args()
    if args.viewer_only:
        write_viewer_data()
        return 0
    ids = [m["id"] for m in json.loads(CATALOGUE.read_text(encoding="utf-8"))]
    existing = (
        json.loads(OUT_JSON.read_text(encoding="utf-8"))["models"]
        if OUT_JSON.exists()
        else {}
    )
    only = set(args.only.split(",")) if args.only else set(ids)
    domains = {}
    # Blends copy a component domain, so they come last.
    for model in sorted(ids, key=lambda m: m in REGIONAL_BLENDS):
        if model not in only and model in existing:
            domains[model] = existing[model]
            continue
        domains[model] = resolve(model, {**existing, **domains})
        entry = domains[model]
        kind = entry if isinstance(entry, str) else entry["source"]
        print(f"{model:35s} {kind}")
        write({**existing, **domains})
    write({k: v for k, v in {**existing, **domains}.items() if k in ids})
    return 0


if __name__ == "__main__":
    sys.exit(main())
