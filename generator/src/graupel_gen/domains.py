# SPDX-FileCopyrightText: 2026 Bastian Schnitzler
# SPDX-License-Identifier: MPL-2.0
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""Model domains (`model_domains.json`): where a model delivers data.

Each catalogue model maps to `"global"` or to
`{"source": "grid" | "measured", "polygon": [[lon, lat], ...]}`. Polygons
are not split at the antimeridian (longitudes may leave [-180, 180]) and a
domain containing a pole is closed over it: its boundary spans exactly 360°
of longitude and returns along the pole (`close_ring`).

1. Grid: `meta.json` `crs_wkt` names the grid CRS and its corner points
   (`BBOX`). Every grid is a rectangle in its own coordinates, so the
   domain is that rectangle projected back to lon/lat.
2. Verify: the forecast API answers `No data is available for this
   location` outside a domain (all-null values inside one are not
   "outside"). Probes 0.3° (geographic and rotated grids) or 30 km
   (projected grids) inside and outside each edge must agree with the
   grid rectangle.
3. Measure: when they disagree, the boundary is measured by bisection
   along 48 rays from the grid centre in grid coordinates (ICON native
   grids and AROME deliver less than their regular-grid envelope, ICON-EU
   and RDPS partly more).

Seamless blends without own metadata are global when far points on every
continent deliver data. A full run sends a few thousand single-point
requests; `--only id,id` derives some models and keeps the others.
"""

from __future__ import annotations

import concurrent.futures as cf
import logging
import math
import re
import time
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

import httpx
from pyproj import CRS, Transformer
from shapely.geometry import Polygon

from .http import HEADERS, RateLimiter
from .output import make_meta
from .sources import Sources

logger = logging.getLogger("graupel_gen.domains")

META_URL = "https://api.open-meteo.com/data/{path}/static/meta.json"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
OUTSIDE_REASON = "No data is available for this location"
SPHERE = 6371229.0
# Far points (lat, lon) on every continent and ocean; a model delivering
# all of them is global.
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
    "geosphere_seamless": "geosphere_claef_austria",
}
WORKERS = 4

HasData = Callable[[str, float, float], bool]
Ring = List[Tuple[float, float]]


class DomainError(RuntimeError):
    pass


class ApiProbe:
    """`has_data` and `meta.json` against the Open-Meteo API.

    Only the answer "No data is available for this location" counts as
    outside; any other HTTP 400 is an error. 429, 5xx and network errors
    are retried `max_attempts` times with a growing pause (at most
    `max_wait` seconds each), then the run stops.
    """

    def __init__(
        self,
        client: Optional[httpx.Client] = None,
        limiter: Optional[RateLimiter] = None,
        max_attempts: int = 6,
        max_wait: float = 60.0,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.client = client or httpx.Client(timeout=30.0, headers=HEADERS)
        self.limiter = limiter or RateLimiter()
        self.max_attempts = max_attempts
        self.max_wait = max_wait
        self.sleep = sleep

    def has_data(self, model: str, lat: float, lon: float) -> bool:
        """True unless the API says the point is outside the domain."""
        if not -89.9 < lat < 89.9:
            return False
        lon = ((lon + 180) % 360) - 180
        params = {
            "latitude": f"{lat:.4f}",
            "longitude": f"{lon:.4f}",
            "hourly": "temperature_2m",
            "models": model,
            "forecast_days": 1,
        }
        last: Any = None
        for attempt in range(self.max_attempts):
            self.limiter.wait()
            try:
                resp = self.client.get(FORECAST_URL, params=params)
            except httpx.HTTPError as e:
                last = e
            else:
                if resp.status_code == 200:
                    return "hourly" in resp.json()
                if resp.status_code == 400:
                    reason = _reason(resp)
                    if OUTSIDE_REASON.lower() in reason.lower():
                        return False
                    raise DomainError(
                        f"{model} at {lat:.4f}, {lon:.4f}: HTTP 400 {reason}"
                    )
                last = f"HTTP {resp.status_code}"
            self.sleep(min(self.max_wait, 5.0 * 2**attempt))
        raise DomainError(
            f"{model} at {lat:.4f}, {lon:.4f}: no answer ({last})"
        )

    def fetch_meta(self, path: str) -> Optional[Dict[str, Any]]:
        self.limiter.wait()
        resp = self.client.get(META_URL.format(path=path))
        if resp.status_code != 200:
            return None
        return resp.json()


def _reason(resp: httpx.Response) -> str:
    try:
        return str(resp.json().get("reason", ""))
    except ValueError:
        return resp.text[:200]


# --- Grid ----------------------------------------------------------------


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
    raise DomainError(f"unsupported grid projection {m}")


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

    def ring(self, rect: Tuple[float, float, float, float], n: int = 200):
        x0, y0, x1, y1 = rect
        xs: List[float] = []
        ys: List[float] = []
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


def _wrap(dlon: float) -> float:
    return ((dlon + 180) % 360) - 180


def close_ring(lons: Sequence[float], lats: Sequence[float]) -> Ring:
    """Unwrap longitudes at the antimeridian; close a ring around a pole.

    The boundary circles a pole when the step from the last point back to
    the first completes a full turn of 360°. That step is part of the
    boundary: the ring ends at the first point moved by the turn and then
    returns over the pole, so the boundary spans exactly 360° of
    longitude.
    """
    out: List[float] = []
    for lon in lons:
        lon = _wrap(lon)
        if out:
            lon = out[-1] + _wrap(lon - out[-1])
        out.append(lon)
    pts = list(zip(out, lats))
    if len(out) < 3:
        return pts
    turn = out[-1] + _wrap(out[0] - out[-1]) - out[0]
    if abs(turn) > 180:
        end = out[0] + turn
        pole = 90.0 if sum(lats) > 0 else -90.0
        if end != out[-1] or lats[0] != lats[-1]:
            pts.append((end, lats[0]))
        pts += [(end, pole), (out[0], pole)]
    return pts


def close_polar_polygon(
    polygon: Sequence[Sequence[float]],
) -> List[List[float]]:
    """A stored polygon closed over a pole again with `close_ring`.

    The boundary is the polygon without its pole vertices, starting right
    after them. Polygons without pole vertices come back unchanged.
    """
    pts = [(float(x), float(y)) for x, y in polygon]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts.pop()
    poles = [abs(y) == 90 for _, y in pts]
    if not any(poles) or all(poles):
        return [list(p) for p in polygon]
    n = len(pts)
    start = next(i for i in range(n) if poles[i] and not poles[(i + 1) % n])
    boundary = [
        pts[(start + 1 + k) % n]
        for k in range(n)
        if not poles[(start + 1 + k) % n]
    ]
    ring = close_ring([p[0] for p in boundary], [p[1] for p in boundary])
    ring.append(ring[0])
    return [[round(x, 3), round(y, 3)] for x, y in ring]


def close_polar_domains(domains: Dict[str, Any]) -> Dict[str, Any]:
    """Domains with every polygon around a pole closed with `close_ring`."""
    return {
        m: {**d, "polygon": close_polar_polygon(d["polygon"])}
        if isinstance(d, dict)
        else d
        for m, d in domains.items()
    }


def bisect(inside: Callable[[float], bool], start: float, tol: float) -> float:
    """Largest distance still inside; `inside(0)` must be True."""
    lo, hi = 0.0, start
    while inside(hi):
        lo, hi = hi, hi * 1.6 + tol
    while hi - lo > tol:
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if inside(mid) else (lo, mid)
    return lo


def measure_rays(has_data: HasData, model: str, grid: Grid, n: int = 48):
    """Boundary along n rays from the grid centre, in grid coordinates.

    Assumes only a star-shaped domain, not the rectangle: RDPS delivers
    data beyond its BBOX in some directions and less in others.
    """
    x0, y0, x1, y1 = grid.rect
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    lon, lat = grid.inverse(cx, cy)
    if not has_data(model, lat, lon):
        raise DomainError(f"{model}: centre {lat:.2f}, {lon:.2f} has no data")
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

    with cf.ThreadPoolExecutor(WORKERS) as ex:
        points = list(ex.map(ray, range(n)))
    lonlat = [grid.inverse(x, y) for x, y in points]
    return close_ring([p[0] for p in lonlat], [p[1] for p in lonlat])


def mismatches(
    has_data: HasData, model: str, probes: List[Tuple[bool, float, float]]
) -> List[Tuple[bool, float, float]]:
    with cf.ThreadPoolExecutor(WORKERS) as ex:
        got = list(ex.map(lambda p: has_data(model, p[1], p[2]), probes))
    return [p for p, g in zip(probes, got) if g is not p[0]]


def simplify(ring: Ring) -> List[List[float]]:
    poly = Polygon(ring).simplify(SIMPLIFY_DEG, preserve_topology=True)
    if not poly.is_valid:
        raise DomainError("invalid domain polygon")
    return [[round(x, 3), round(y, 3)] for x, y in poly.exterior.coords]


def resolve(
    model: str,
    done: Dict[str, Any],
    sources: Sources,
    has_data: HasData,
    fetch_meta: Callable[[str], Optional[Dict[str, Any]]],
) -> Any:
    """Domain of one model."""
    path = sources.meta_path(model)
    meta = fetch_meta(path) if path else None
    if meta is None or "crs_wkt" not in meta:
        if model in REGIONAL_BLENDS:
            return done[REGIONAL_BLENDS[model]]
        missing = [p for p in GLOBAL_PROBES if not has_data(model, *p)]
        if missing:
            raise DomainError(
                f"{model}: no grid metadata and no data at {missing}"
            )
        return "global"
    grid = Grid(meta["crs_wkt"])
    if grid.is_global():
        return "global"
    ring = grid.ring(grid.rect)
    bad = mismatches(has_data, model, grid.edge_probes(grid.rect))
    if not bad:
        return {"source": "grid", "polygon": simplify(ring)}
    logger.info("%s: %d probes disagree with the grid, measuring", model, len(bad))
    ring = measure_rays(has_data, model, grid)
    return {"source": "measured", "polygon": simplify(ring)}


def build_domains(
    ids: Sequence[str],
    existing: Dict[str, Any],
    sources: Sources,
    has_data: HasData,
    fetch_meta: Callable[[str], Optional[Dict[str, Any]]],
    only: Optional[Sequence[str]] = None,
) -> Tuple[Dict[str, Any], Optional[BaseException]]:
    """Domains of the catalogue models `ids`.

    Models outside `only` keep their existing domain. Stops at the first
    error and returns what is done so far with the error, so the caller
    writes the file once and no finished model is lost.
    """
    wanted = set(only) if only else set(ids)
    domains: Dict[str, Any] = {}
    error: Optional[BaseException] = None
    # Blends copy a component domain, so they come last.
    for model in sorted(ids, key=lambda m: m in REGIONAL_BLENDS):
        if model not in wanted and model in existing:
            domains[model] = existing[model]
            continue
        try:
            entry = resolve(
                model,
                {**existing, **domains},
                sources,
                has_data,
                fetch_meta,
            )
        except (DomainError, httpx.HTTPError) as e:
            error = e
            logger.error("%s: %s", model, e)
            break
        domains[model] = entry
        kind = entry if isinstance(entry, str) else entry["source"]
        logger.info("%-35s %s", model, kind)
    if error is not None:
        # Keep the existing domains of the models not reached.
        for model in ids:
            if model not in domains and model in existing:
                domains[model] = existing[model]
    return {m: domains[m] for m in sorted(domains) if m in set(ids)}, error


def domains_entries(doc: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    return dict(doc["models"]) if doc else {}


def api_source() -> Dict[str, Any]:
    from datetime import date

    return {
        "name": "Open-Meteo Forecast and metadata API",
        "url": "https://open-meteo.com",
        "version": date.today().isoformat(),
    }


def domains_document(
    domains: Dict[str, Any], sources_meta: List[Dict[str, Any]]
) -> Dict[str, Any]:
    return {
        "meta": make_meta("domains", sources_meta),
        "models": dict(sorted(domains.items())),
    }
