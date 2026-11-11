# SPDX-FileCopyrightText: 2026 Bastian Schnitzler
# SPDX-License-Identifier: MPL-2.0
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""Regions (`regions.geojson`), chain zones (`chain_zones.json`,
`chain_zones.geojson`) and resolver cases (`resolver_cases.json`).

Country regions are unions of Natural Earth 10 m countries (public
domain) with their coastal waters, simplified together; alpine regions are
hand-drawn along ridges and valleys and win by priority. Regions, chains
and outlines come from `sources/regions.yaml`.

Chain zones cut the world (land, coastal waters, sea) into pieces with the
same resolver inputs (winning region, covering candidate models), resolve
each piece at a point inside it and merge pieces with the same main and
cloud chain.
"""

from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
import shapely
from pyproj import Geod
from shapely.affinity import translate
from shapely.geometry import MultiPolygon, Polygon, box, mapping, shape
from shapely.ops import unary_union

from .http import HEADERS
from .output import make_meta
from .resolver import (
    DOMAIN_MARGIN_DEG,
    FALLBACK_EXCLUDED,
    MAIN_TERMINAL,
    Resolver,
)
from .sources import Sources

logger = logging.getLogger("graupel_gen.regions")

NATURAL_EARTH_VERSION = "v5.1.2"
NATURAL_EARTH_URL = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/"
    "{version}/geojson/ne_10m_admin_0_countries.geojson"
)
NATURAL_EARTH_SHA256 = {
    "v5.1.2": (
        "239eec57ac17f100a11e2536cffc56752c318b50ae765b0918ff7aab4ce8f255"
    ),
}

ZONE_LIST_KEYS = (
    "main_chain_ids",
    "cloud_chain_ids",
    "reasons",
    "regions",
    "group",
    "sample",
    "area_km2",
    "coast_area_km2",
    "sea_area_km2",
)
ZONE_PARTS = (
    ("land", "geometry", "area_km2"),
    ("coast", "coast_geometry", "coast_area_km2"),
    ("sea", "sea_geometry", "sea_area_km2"),
)

# Simplification tolerance in degrees for the regions.
REGION_SIMPLIFY_DEG = 0.01
# Water up to this distance from a coast (sea and enclosed lakes) belongs
# to the nearest country, so coastal waters get the country's chain.
WATER_REACH_DEG = 1.0
WATER_STEP_DEG = 0.1
WATER_FINE_STEP_DEG = 0.01

WORLD = Polygon([(-180, -90), (180, -90), (180, 90), (-180, 90)])
# The chain zones are an overview (consumers resolve from the regions):
# coarse outlines, a 0.01° grid and no islets keep them small. Hover may
# be a few km off at borders and coasts.
ZONE_SIMPLIFY = 0.05
ZONE_GRID_DEG = 0.01
ZONE_MIN_PART_KM2 = 10.0
GLOBAL_ZONE_SIMPLIFY = 0.2
GLOBAL_ZONE_MIN_PART_KM2 = 100.0
MIN_PIECE_AREA = 0.01  # deg², slivers from the margin approximation
SLIVER_DEG = 0.02  # pieces narrower than twice this join a neighbour

_geod = Geod(ellps="WGS84")


def area_km2(geometry: Any) -> float:
    return abs(_geod.geometry_area_perimeter(geometry)[0]) / 1e6


# --- Natural Earth -------------------------------------------------------


def natural_earth_source(version: str = NATURAL_EARTH_VERSION) -> Dict:
    return {
        "name": "Natural Earth 10m Admin 0 Countries",
        "url": NATURAL_EARTH_URL.format(version=version),
        "version": version,
        "sha256": NATURAL_EARTH_SHA256.get(version),
    }


def fetch_countries(
    cache_dir: Path, version: str = NATURAL_EARTH_VERSION
) -> Path:
    """Natural Earth admin-0 GeoJSON in the pinned version (cached)."""
    target = cache_dir / f"ne_10m_admin_0_countries-{version}.geojson"
    if not target.exists():
        url = NATURAL_EARTH_URL.format(version=version)
        logger.info("downloading %s", url)
        resp = httpx.get(url, timeout=120.0, headers=HEADERS)
        resp.raise_for_status()
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(resp.content)
    expected = NATURAL_EARTH_SHA256.get(version)
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    if expected and digest != expected:
        raise RuntimeError(
            f"{target}: sha256 {digest} is not the pinned {expected}"
        )
    return target


def load_countries(path: Path) -> List[Dict[str, Any]]:
    """Countries by code, geometry simplified to 0.002°.

    One entry per code: Natural Earth lists e.g. France and Clipperton
    Island both as FR, and keying by code let Clipperton replace France.
    Territories without a code (-99) keep their own ADM0_A3 code.
    """
    features = json.loads(Path(path).read_text(encoding="utf-8"))["features"]
    by_code: Dict[str, Dict[str, Any]] = {}
    for f in features:
        p = f["properties"]
        code = p.get("ISO_A2_EH")
        if code in (None, "-99"):
            code = p.get("ISO_A2")
        if code in (None, "-99"):
            code = p.get("ADM0_A3")
        # 10 m detail is far finer than the regions need.
        geometry = shape(f["geometry"]).buffer(0).simplify(0.002).buffer(0)
        if code in by_code:
            entry = by_code[code]
            entry["geometry"] = unary_union([entry["geometry"], geometry])
        else:
            by_code[code] = {
                "code": code,
                "continent": p.get("CONTINENT"),
                "geometry": geometry,
            }
    return list(by_code.values())


# --- Alpine regions ------------------------------------------------------


def _west_of(lon: float) -> Polygon:
    return Polygon([(-180, -90), (lon, -90), (lon, 90), (-180, 90)])


def alpine_geometry(
    spec: Dict[str, Any],
    config: Dict[str, Any],
    countries: List[Dict[str, Any]],
) -> Any:
    """Geometry of an alpine region (`alpine` entry of regions.yaml)."""

    def union(codes: List[str]) -> Any:
        return unary_union(
            [c["geometry"] for c in countries if c["code"] in codes]
        )

    edge = [tuple(p) for p in config["alps_d2_south_edge"]]
    north_edge = [tuple(p) for p in config["alps_north_edge"]]
    kufstein = float(config["kufstein_lon"])
    inzell = float(config["inzell_lon"])
    south = Polygon(edge + [(13.5, edge[-1][1]), (13.5, 46.5), (9.5, 46.5)])
    codes = list(spec["countries"])
    build = spec.get("build", "polygon")
    if build == "north_of_d2_edge":
        north = Polygon(edge + north_edge)
        west = north.intersection(_west_of(kufstein)).intersection(
            union(codes)
        )
        east = north.difference(_west_of(kufstein)).intersection(
            union(codes[:1])
        )
        return unary_union([west, east])
    if build == "german_alps_south_west":
        return union(codes).intersection(south).intersection(_west_of(inzell))
    if build == "eastern_alps":
        basin = union(codes[:1]).intersection(south).difference(
            _west_of(inzell)
        )
        drawn = Polygon(spec["polygon"])
        return unary_union([drawn.intersection(union(codes[1:])), basin])
    if build == "polygon":
        return Polygon(spec["polygon"]).intersection(union(codes))
    raise ValueError(f"unknown alpine build {build!r}")


# --- Coastal waters ------------------------------------------------------


def _split_contested(
    contested: Any,
    shapes: Dict[str, Any],
    codes: List[str],
    start: float,
) -> Dict[str, Any]:
    """Split water reached by several countries in one coarse step.

    The contenders grow again from `start` in WATER_FINE_STEP_DEG steps,
    only inside `contested`, and clipped to its surroundings so buffering
    a whole continent stays cheap.
    """
    window = box(*contested.buffer(start + WATER_STEP_DEG + 0.1).bounds)
    local = {c: shapes[c].intersection(window) for c in codes}
    left = contested
    out: Dict[str, List[Any]] = {}
    fine_steps = int(round(WATER_STEP_DEG / WATER_FINE_STEP_DEG))
    for k in range(1, fine_steps + 1):
        if left.is_empty:
            break
        reach = start + k * WATER_FINE_STEP_DEG
        got: List[Any] = []
        for code in codes:
            if local[code].is_empty:
                continue
            part = left.intersection(local[code].buffer(reach))
            if not part.is_empty:
                part = part.difference(unary_union(got)) if got else part
                if not part.is_empty:
                    out.setdefault(code, []).append(part)
                    got.append(part)
        if got:
            left = left.difference(unary_union(got))
    if not left.is_empty:  # never leave a hole
        out.setdefault(codes[0], []).append(left)
    return {code: unary_union(p) for code, p in out.items()}


def water_claims(countries: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Coastal waters and lakes per country code, split at the median line.

    Water within WATER_REACH_DEG of land goes to the nearest country: all
    countries grow into it at the same pace, WATER_STEP_DEG per round, so
    facing coasts and shared lakes are divided roughly along the middle.
    Natural Earth leaves large lakes (Lake Constance, Lake Geneva, Great
    Lakes) out of every country, so they are split the same way. Outlines
    are simplified first; growing the full 10 m outlines (or a Voronoi
    diagram of all coast points) needs too much memory.
    """
    shapes = {
        c["code"]: c["geometry"].simplify(WATER_STEP_DEG / 4)
        for c in countries
    }
    land = unary_union(list(shapes.values()))
    # Water is what lies outside the exact land: simplified outlines leave
    # slivers along land borders that a neighbour would claim (Strasbourg
    # fell to Germany across the Rhine).
    exact_land = unary_union([c["geometry"] for c in countries])
    remaining = (
        land.buffer(WATER_REACH_DEG).intersection(WORLD).difference(exact_land)
    )
    claims: Dict[str, List[Any]] = {}
    steps = int(round(WATER_REACH_DEG / WATER_STEP_DEG))
    for step in range(1, steps + 1):
        logger.info("  coastal waters: growth step %d/%d", step, steps)
        if remaining.is_empty:
            break
        reach = step * WATER_STEP_DEG
        parts: Dict[str, Any] = {}
        for code, geometry in shapes.items():
            grown = geometry.buffer(reach)
            if not grown.intersects(remaining):
                continue
            part = remaining.intersection(grown)
            if not part.is_empty:
                parts[code] = part
        if not parts:
            continue
        # Water reached by two countries in the same step is contested;
        # giving it all to one of them drew a saw-tooth median (~10 km).
        # Split it with a fine growth inside the contested area only.
        codes = list(parts)
        contested = Polygon()
        for i, a in enumerate(codes):
            for b in codes[i + 1 :]:
                if parts[a].intersects(parts[b]):
                    contested = contested.union(
                        parts[a].intersection(parts[b])
                    )
        for code, part in parts.items():
            free = part.difference(contested)
            if not free.is_empty:
                claims.setdefault(code, []).append(free)
        if not contested.is_empty:
            for code, part in _split_contested(
                contested,
                shapes,
                [c for c in codes if parts[c].intersects(contested)],
                reach - WATER_STEP_DEG,
            ).items():
                claims.setdefault(code, []).append(part)
        remaining = remaining.difference(unary_union(list(parts.values())))
    return {
        code: unary_union(parts).difference(exact_land)
        for code, parts in claims.items()
    }


# --- Regions -------------------------------------------------------------


def region_chains(
    region: Dict[str, Any], by_id: Dict[str, Dict[str, Any]]
) -> Dict[str, List[str]]:
    source = by_id[region.get("chains_from") or region["id"]]
    return {"main": list(source["main"]), "cloud": list(source["cloud"])}


def build_regions(
    countries: List[Dict[str, Any]], sources: Sources
) -> List[Dict[str, Any]]:
    """Region features (GeoJSON), in the order of regions.yaml."""
    config = sources.regions
    specs = config["regions"]
    by_id = {r["id"]: r for r in specs}
    known = {c["code"] for c in countries}
    logger.info("  coastal waters and lakes")
    waters = water_claims(countries)
    exact_by_id: Dict[str, Any] = {}
    features = []
    for number, region in enumerate(specs, 1):
        rid = region["id"]
        logger.info("  region %d/%d: %s", number, len(specs), rid)
        if "alpine" in region:
            geometry = alpine_geometry(region["alpine"], config, countries)
        elif "countries" in region:
            missing = set(region["countries"]) - known
            if missing - {"XK"} and len(missing) == len(region["countries"]):
                raise ValueError(f"{rid}: no Natural Earth country found")
            inside = [c for c in countries if c["code"] in region["countries"]]
            geometry = unary_union(
                [c["geometry"] for c in inside]
                + [waters[c["code"]] for c in inside if c["code"] in waters]
            )
        else:
            raise ValueError(f"{rid}: no geometry")
        exact_by_id[rid] = geometry.buffer(0)
        chains = region_chains(region, by_id)
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "id": rid,
                    "name": region["name"],
                    "priority": int(region["priority"]),
                    "group": region.get("group", "Europe"),
                    "area_km2": 0,
                    "main_chain_ids": chains["main"],
                    "cloud_chain_ids": chains["cloud"],
                },
                "geometry": None,
            }
        )
    _simplify_together(features, exact_by_id)
    return features


def _simplify_together(
    features: List[Dict[str, Any]], exact_by_id: Dict[str, Any]
) -> None:
    """Simplify all regions as one coverage.

    Simplifying neighbours one by one opens gaps and overlaps along shared
    borders; with equal priority the smaller region then wins inside its
    neighbour (Mittenwald fell to Austria). The exact geometries are made
    disjoint first in regions.yaml order: alpine regions keep their area
    and a country region keeps only the rest (the alpine region wins there
    by priority anyway); overlapping coastal waters go to the earlier
    region. Simplified together, all shared borders stay shared.
    """
    ids = list(exact_by_id)
    logger.info("  making %d regions disjoint", len(ids))
    disjoint = []
    taken = Polygon()
    for rid in ids:
        part = exact_by_id[rid].difference(taken).buffer(0)
        taken = taken.union(exact_by_id[rid])
        disjoint.append(part)
    logger.info("  simplifying all regions together")
    simplified = shapely.coverage_simplify(disjoint, REGION_SIMPLIFY_DEG)
    by_id = dict(zip(ids, simplified))
    for f in features:
        geometry = _polygons_only(shapely.make_valid(by_id[f["properties"]["id"]]))
        if isinstance(geometry, Polygon):
            geometry = MultiPolygon([geometry])
        f["properties"]["area_km2"] = round(area_km2(geometry))
        f["geometry"] = _rounded(geometry)


def _polygons_only(geometry: Any) -> Any:
    parts = [
        g
        for g in getattr(geometry, "geoms", [geometry])
        if g.geom_type in ("Polygon", "MultiPolygon") and not g.is_empty
    ]
    return unary_union(parts) if parts else MultiPolygon()


def _rounded(geometry: Any, grid: float = 0.001) -> Dict[str, Any]:
    """GeoJSON MultiPolygon on a grid, still valid.

    Plain rounding of coordinates creates self-touching rings; repairing
    those later with buffer(0) silently drops whole lobes (Sardinia,
    Luxembourg vanished from the chain zones). set_precision snaps to the
    grid and keeps the geometry valid.
    """
    geometry = _polygons_only(shapely.make_valid(geometry))
    geometry = _polygons_only(shapely.set_precision(geometry, grid))
    if isinstance(geometry, Polygon):
        geometry = MultiPolygon([geometry])
    data = mapping(geometry)
    return {"type": "MultiPolygon", "coordinates": _lists(data["coordinates"])}


def _lists(value: Any) -> Any:
    if isinstance(value, (list, tuple)):
        return [_lists(v) for v in value]
    return value


def regions_document(
    features: List[Dict[str, Any]], sources_meta: List[Dict[str, Any]]
) -> Dict[str, Any]:
    return {
        "type": "FeatureCollection",
        "meta": make_meta("regions", sources_meta),
        "features": features,
    }


# --- Chain zones ---------------------------------------------------------


def _coverage(entry: Any) -> Any:
    if entry == "global":
        return WORLD
    shrunk = Polygon(entry).buffer(0).buffer(-DOMAIN_MARGIN_DEG)
    copies = [translate(shrunk, xoff=dx) for dx in (-360, 0, 360)]
    return unary_union(copies).intersection(WORLD)


def _split(pieces: List[Any], area: Any) -> List[Any]:
    out = []
    for piece in pieces:
        if not piece.intersects(area):
            out.append(piece)
            continue
        for part in (piece.intersection(area), piece.difference(area)):
            out.extend(_parts(_polygons_only(part)))
    return out


def _absorb_slivers(pieces: List[Any]) -> List[Any]:
    """Merge slivers into the neighbour sharing the longest edge.

    Nearly coincident domain edges cut thin strips (a straight band across
    Sardinia between the AROME France and AROME France HD edges). Resolved
    on their own they draw stray lines; dropped they leave holes. Merged
    into a neighbour they vanish without a gap.
    """
    big = [
        p
        for p in pieces
        if p.area > MIN_PIECE_AREA and not p.buffer(-SLIVER_DEG).is_empty
    ]
    slivers = [p for p in pieces if not any(p is b for b in big)]
    if not big:
        return pieces
    tree = shapely.STRtree(big)
    extra: Dict[int, List[Any]] = {}
    orphans = []
    for sliver in slivers:
        best, best_len = None, 0.0
        for i in tree.query(sliver.buffer(1e-6)):
            shared = big[i].boundary.intersection(sliver.boundary).length
            if shared > best_len:
                best, best_len = i, shared
        if best is None:
            orphans.append(sliver)
        else:
            extra.setdefault(int(best), []).append(sliver)
    merged = [
        unary_union([b, *extra[i]]) if i in extra else b
        for i, b in enumerate(big)
    ]
    return merged + orphans


def _parts(geometry: Any) -> List[Any]:
    if geometry.is_empty:
        return []
    return list(getattr(geometry, "geoms", [geometry]))


def _group(zone_regions: List[Dict[str, Any]], geometry: Any) -> str:
    groups = {r["group"] for r in zone_regions}
    minx, _, maxx, _ = geometry.bounds
    if maxx - minx > 180 and len(groups) != 1:
        return "Intercontinental"
    if len(groups) == 1:
        return groups.pop()
    if len(groups) > 1:
        return "Intercontinental"
    lon = geometry.representative_point().x
    if lon < -30:
        return "North America"
    return "Europe" if lon < 60 else "Asia"


def _without_islets(geometry: Any, min_km2: float = ZONE_MIN_PART_KM2) -> Any:
    parts = [
        p
        for p in getattr(geometry, "geoms", [geometry])
        if not p.is_empty and area_km2(p) >= min_km2
    ]
    return MultiPolygon(parts) if parts else MultiPolygon()


def _as_multi(geometry: Any) -> Any:
    geometry = _polygons_only(shapely.make_valid(geometry))
    if geometry.is_empty:
        return MultiPolygon()
    if isinstance(geometry, Polygon):
        return MultiPolygon([geometry])
    return MultiPolygon(
        [g for g in getattr(geometry, "geoms", [geometry]) if g.area > 0]
    )


def build_zones(
    countries: List[Dict[str, Any]], resolver: Resolver
) -> List[Dict[str, Any]]:
    """Areas with one resolved chain, largest land area first."""
    domains = resolver.domains
    # Land as drawn by default: countries and enclosed lakes only.
    countries_union = unary_union([c["geometry"] for c in countries])
    lakes = unary_union(
        [
            Polygon(p.exterior)
            for p in getattr(countries_union, "geoms", [countries_union])
        ]
    ).difference(countries_union)
    land = unary_union([countries_union, lakes])
    land = land.simplify(REGION_SIMPLIFY_DEG).buffer(0).intersection(WORLD)

    candidates = sorted(
        m
        for m, d in domains.items()
        if d != "global"
        and "seamless" not in m
        and "ensemble" not in m
        and m not in FALLBACK_EXCLUDED
    )
    logger.info("  zones: coverage of %d candidate models", len(candidates))
    coverage = {m: _coverage(domains[m]) for m in candidates}

    # Region pieces in resolver order: land, coastal waters, all other sea.
    pieces: List[Any] = []
    coast_pieces: List[Any] = []
    sea_pieces: List[Any] = []
    taken = Polygon()
    for region in resolver.regions:
        geometry = _polygons_only(
            shapely.make_valid(
                MultiPolygon(
                    [Polygon(p[0], p[1:]) for p in region["polygons"]]
                )
            )
        )
        exclusive = geometry.difference(taken)
        taken = taken.union(geometry)
        pieces.extend(_parts(exclusive.intersection(land)))
        coast_pieces.extend(_parts(exclusive.difference(land)))
    pieces.extend(_parts(land.difference(taken)))
    # Outside the regions only the sea covered by some regional model needs
    # cutting; the rest is one global-fallback piece (cutting the whole
    # ocean costs too much memory).
    free_sea = WORLD.difference(land).difference(taken)
    covered_sea = (
        unary_union(list(coverage.values()))
        .intersection(free_sea)
        .simplify(0.02)
    )
    sea_pieces.extend(_parts(covered_sea))
    for number, model_id in enumerate(candidates, 1):
        logger.info(
            "  zones: split by %s (%d/%d), %d pieces",
            model_id,
            number,
            len(candidates),
            len(pieces) + len(coast_pieces) + len(sea_pieces),
        )
        pieces = _split(pieces, coverage[model_id])
        coast_pieces = _split(coast_pieces, coverage[model_id])
        sea_pieces = _split(sea_pieces, coverage[model_id])
    logger.info("  zones: merging slivers into neighbours")
    pieces = _absorb_slivers(pieces)
    coast_pieces = _absorb_slivers(coast_pieces)
    sea_pieces = _absorb_slivers(sea_pieces)
    sea_pieces.extend(_parts(free_sea.difference(covered_sea).simplify(0.05)))

    zones: Dict[Any, Dict[str, Any]] = {}
    tagged = (
        [(p, "parts") for p in pieces]
        + [(p, "coast_parts") for p in coast_pieces]
        + [(p, "sea_parts") for p in sea_pieces]
    )
    logger.info("  zones: resolving %d pieces", len(tagged))
    for piece, kind in tagged:
        point = piece.representative_point()
        result = resolver.resolve(point.y, point.x)
        main = result["main_chain_ids"]
        cloud = result["cloud_chain_ids"]
        key = (tuple(main), tuple(cloud))
        zone = zones.setdefault(
            key,
            {
                "main_chain_ids": main,
                "cloud_chain_ids": cloud,
                "reasons": set(),
                "regions": {},
                "parts": [],
                "coast_parts": [],
                "sea_parts": [],
                "sample": [round(point.x, 4), round(point.y, 4)],
            },
        )
        zone[kind].append(piece)
        zone["reasons"].add(result["resolution_reason"])
        if result["region_id"]:
            zone["regions"][result["region_id"]] = result["region_name"]

    by_id = {r["id"]: r for r in resolver.regions}
    # Merge each zone's pieces, then simplify all zones (land and sea) as
    # one coverage so neighbouring zones keep sharing their borders.
    merged = []
    for zone in zones.values():
        for kind in ("parts", "coast_parts", "sea_parts"):
            parts = zone.pop(kind)
            merged.append(unary_union(parts) if parts else Polygon())
    logger.info("  zones: simplifying %d zones together", len(zones))
    simplified = shapely.coverage_simplify(merged, ZONE_SIMPLIFY)
    out = []
    for i, zone in enumerate(zones.values()):
        geometry = _as_multi(simplified[3 * i])
        coast = _as_multi(simplified[3 * i + 1])
        sea = _as_multi(simplified[3 * i + 2])
        is_global = zone["main_chain_ids"] == [MAIN_TERMINAL]
        if is_global:
            # "Only IFS" covers the rest of the world and is hidden by
            # default; at full detail it held half of the zone data.
            geometry, coast, sea = (
                _without_islets(
                    _as_multi(g.simplify(GLOBAL_ZONE_SIMPLIFY)),
                    GLOBAL_ZONE_MIN_PART_KM2,
                )
                for g in (geometry, coast, sea)
            )
        zone_regions = [by_id[r] for r in zone["regions"]]
        reasons = zone.pop("reasons")
        out.append(
            {
                **zone,
                "reasons": sorted(reasons),
                "regions": sorted(zone["regions"].values()),
                "group": (
                    "Global"
                    if is_global
                    else _group(
                        zone_regions,
                        (
                            geometry
                            if not geometry.is_empty
                            else coast if not coast.is_empty else sea
                        ),
                    )
                ),
                "area_km2": round(area_km2(geometry)),
                "coast_area_km2": round(area_km2(coast)),
                "sea_area_km2": round(area_km2(sea)),
                "geometry": _rounded(_without_islets(geometry), ZONE_GRID_DEG),
                "coast_geometry": _rounded(
                    _without_islets(coast), ZONE_GRID_DEG
                ),
                "sea_geometry": _rounded(_without_islets(sea), ZONE_GRID_DEG),
            }
        )
    out = [
        z
        for z in out
        if z["area_km2"] + z["coast_area_km2"] + z["sea_area_km2"] >= 1
    ]
    out.sort(key=lambda z: -z["area_km2"])
    return out


def zone_id(zone: Dict[str, Any]) -> str:
    """Stable id from the chain itself, e.g. "cmc_gem_rdps.ecmwf_ifs~…"."""
    main = ".".join(zone["main_chain_ids"])
    cloud = ".".join(zone["cloud_chain_ids"])
    return f"{main}~{cloud}"


def zone_list(zones: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [
        {"id": zone_id(z), **{k: z[k] for k in ZONE_LIST_KEYS}} for z in zones
    ]


def zones_document(
    zones: List[Dict[str, Any]], sources_meta: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """`chain_zones.json`: the zones without geometry."""
    return {
        "meta": make_meta("regions", sources_meta),
        "zones": zone_list(zones),
    }


def zones_geojson(
    zones: List[Dict[str, Any]], sources_meta: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """`chain_zones.geojson`: one feature per zone and part.

    `part` is `land` (countries and enclosed lakes), `coast` (coastal
    waters of a region) or `sea` (all other sea).
    """
    features = []
    for z in zones:
        for part, geometry_key, area_key in ZONE_PARTS:
            geometry = z[geometry_key]
            if not geometry["coordinates"]:
                continue
            features.append(
                {
                    "type": "Feature",
                    "properties": {
                        "id": zone_id(z),
                        "part": part,
                        "group": z["group"],
                        "main_chain_ids": z["main_chain_ids"],
                        "cloud_chain_ids": z["cloud_chain_ids"],
                        "regions": z["regions"],
                        "reasons": z["reasons"],
                        "area_km2": z[area_key],
                    },
                    "geometry": geometry,
                }
            )
    return {
        "type": "FeatureCollection",
        "meta": make_meta("regions", sources_meta),
        "features": features,
    }


# --- Resolver cases ------------------------------------------------------


def resolver_cases(
    resolver: Resolver, points: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    cases = []
    for point in points:
        result = resolver.resolve(point["lat"], point["lon"])
        cases.append(
            {
                "name": point["name"],
                "lat": point["lat"],
                "lon": point["lon"],
                "region_id": result["region_id"],
                "resolution_reason": result["resolution_reason"],
                "main_chain_ids": result["main_chain_ids"],
                "cloud_chain_ids": result["cloud_chain_ids"],
            }
        )
    return cases


def resolver_cases_document(
    cases: List[Dict[str, Any]], sources_meta: List[Dict[str, Any]]
) -> Dict[str, Any]:
    return {"meta": make_meta("regions", sources_meta), "cases": cases}


def regions_sources_meta(
    countries_path: Optional[Path], version: str
) -> List[Dict[str, Any]]:
    """Sources of the regions: Natural Earth and the curated regions."""
    source = natural_earth_source(version)
    if countries_path is not None:
        source["sha256"] = hashlib.sha256(
            Path(countries_path).read_bytes()
        ).hexdigest()
    return [
        source,
        {"name": "generator/sources/regions.yaml"},
    ]
