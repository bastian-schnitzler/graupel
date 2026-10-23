#!/usr/bin/env python3
"""
dev-tools/update_regions.py

Builds graupel/models/regions.json (system.md §6.2, #188) from the curated
region definitions below, graupel/models/chain_zones.json, and the map viewer
data docs/domain/chains.js (only if docs/domain/ exists; the public repo has no
viewer).

Country regions are unions of Natural Earth 10 m countries (public domain),
simplified; alpine regions are hand-drawn along ridges and valleys and win
by priority. A region's chains are preference lists: the resolver drops
models whose domain does not cover the point and models that do not extend
the horizon (graupel/data/auto_chain.py).

Needs the dev group (shapely, pyproj):
    uv run python dev-tools/update_regions.py [--countries path.geojson]
"""

import argparse
import json
import sys
import tempfile
import time
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

from pyproj import Geod
import shapely
from shapely.affinity import translate
from shapely.geometry import MultiPolygon, Polygon, box, mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
OUT_JSON = ROOT / "graupel" / "models" / "regions.json"
OUT_JS = ROOT / "docs" / "domain" / "chains.js"
# The zones without geometry, for "Start from auto configuration" (#198).
OUT_ZONES = ROOT / "graupel" / "models" / "chain_zones.json"
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
NATURAL_EARTH = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/"
    "master/geojson/ne_10m_admin_0_countries.geojson"
)

IFS, IFS025 = "ecmwf_ifs", "ecmwf_ifs025"
D2, EU = "icon_d2", "icon_eu"
AROME_AT = "geosphere_arome_austria"
ICON_2I = "italia_meteo_arpae_icon_2i"
CH1, CH2 = "meteoswiss_icon_ch1", "meteoswiss_icon_ch2"
AROME_FR, AROME_HD = "meteofrance_arome_france", "meteofrance_arome_france_hd"
ARPEGE = "meteofrance_arpege_europe"
DMI = "dmi_harmonie_arome_europe"
HRRR, HRDPS, RDPS = "ncep_hrrr_conus", "cmc_gem_hrdps", "cmc_gem_rdps"
UKV, UKG = "ukmo_uk_deterministic_2km", "ukmo_global_deterministic_10km"

# Simplification tolerance in degrees for country regions.
SIMPLIFY = {20: 0.01}

# Hand-drawn alpine regions (lon, lat). Priorities 30 beat the countries.
# Each is clipped to the countries in ALPINE_COUNTRIES, so national borders
# stay exact and the hand-drawn lines only matter inside those countries.
# South edge of the ICON-D2 area in the Alps (lon, lat), west to east: the
# latitude of Oberstdorf, below the Zugspitze (summit north of it), below
# Garmisch-Partenkirchen, Kufstein, below Inzell, then up to the neck of
# German territory between Bad Reichenhall and the Berchtesgaden basin
# (narrowest point of the Natural Earth border, at Grossgmain).
ALPS_D2_SOUTH_EDGE = [
    (9.5, 47.40),
    (10.28, 47.40),
    (10.95, 47.405),
    (11.02, 47.415),
    (11.1, 47.45),
    (12.17, 47.58),
    (12.75, 47.70),
    (12.892, 47.7235),
]
# Northern Alps reach north to this line (beyond it Germany has the same
# chain anyway).
ALPS_NORTH_EDGE = [(12.95, 47.85), (9.5, 47.75)]

ALPINE: Dict[str, List[List[float]]] = {
    # North of ALPS_D2_SOUTH_EDGE; built in _alpine_geometry.
    "northern_alps": [],
    # German Alps south of ALPS_D2_SOUTH_EDGE west of Inzell (Allgäu south
    # of Oberstdorf, Wetterstein, Karwendel, Chiemgau): Austrian chain.
    "bavarian_alps_south": [],
    # East of the Saalach: Berchtesgaden, Watzmann, Salzburg, Tauern,
    # Salzkammergut; Vienna stays with Austria.
    "eastern_alps": [
        [12.85, 46.65],
        [15.9, 46.65],
        [15.9, 47.9],
        [12.85, 47.9],
    ],
    # South of the main ridge, Ortler to the Carnic Alps.
    "dolomites": [
        [10.2, 45.8],
        [12.9, 45.8],
        [12.9, 46.65],
        [12.2, 46.9],
        [11.3, 47.0],
        [10.45, 46.85],
        [10.2, 46.6],
    ],
    # Valais north of the main ridge: Zermatt, Matterhorn (Breuil-Cervinia
    # south of the ridge belongs to the French side).
    "western_alps_ch": [
        [6.8, 46.1],
        [7.0, 45.95],
        [7.66, 45.955],
        [8.2, 45.98],
        [8.45, 46.3],
        [8.1, 46.5],
        [7.2, 46.45],
        [6.8, 46.4],
    ],
    # Savoy, Haute-Savoie, Dauphiné and the Aosta valley: Mont Blanc,
    # Chamonix, Courmayeur, Breuil-Cervinia.
    "western_alps_fr": [
        [5.6, 44.7],
        [6.9, 44.7],
        [7.3, 45.2],
        [7.95, 45.5],
        [7.95, 45.94],
        [7.0, 45.94],
        [6.95, 46.05],
        [6.8, 46.3],
        [6.3, 46.4],
        [5.6, 46.2],
    ],
}

# Between Bad Reichenhall and the Berchtesgaden basin German territory
# narrows to a neck. Germany south-east of this line (Berchtesgaden,
# Ramsau, Watzmann) belongs to the Eastern Alps, north-west of it
# (Bad Reichenhall, Bayerisch Gmain) to the Northern Alps.
# East of Kufstein the Northern Alps keep to German territory.
KUFSTEIN_LON = 12.17
# German territory south of the edge and east of this longitude
# (Berchtesgaden basin) belongs to the Eastern Alps.
INZELL_LON = 12.75


def _south_of_edge() -> Polygon:
    edge = list(ALPS_D2_SOUTH_EDGE)
    return Polygon(edge + [(13.5, edge[-1][1]), (13.5, 46.5), (9.5, 46.5)])


def _alpine_geometry(rid: str, countries: List[Dict[str, Any]]) -> Any:
    def union(codes: List[str]) -> Any:
        return unary_union(
            [c["geometry"] for c in countries if c["code"] in codes]
        )

    def west_of(lon: float) -> Polygon:
        return Polygon([(-180, -90), (lon, -90), (lon, 90), (-180, 90)])

    south = _south_of_edge()
    if rid == "northern_alps":
        north = Polygon(list(ALPS_D2_SOUTH_EDGE) + ALPS_NORTH_EDGE)
        west = north.intersection(west_of(KUFSTEIN_LON)).intersection(
            union(["DE", "AT"])
        )
        east = north.difference(west_of(KUFSTEIN_LON)).intersection(
            union(["DE"])
        )
        return unary_union([west, east])
    if rid == "bavarian_alps_south":
        return (
            union(["DE"]).intersection(south).intersection(west_of(INZELL_LON))
        )
    if rid == "eastern_alps":
        berchtesgaden = (
            union(["DE"]).intersection(south).difference(west_of(INZELL_LON))
        )
        drawn = Polygon(ALPINE[rid])
        return unary_union([drawn.intersection(union(["AT"])), berchtesgaden])
    return Polygon(ALPINE[rid]).intersection(union(ALPINE_COUNTRIES[rid]))


ALPINE_COUNTRIES: Dict[str, List[str]] = {
    "northern_alps": ["DE", "AT"],
    "bavarian_alps_south": ["DE"],
    "eastern_alps": ["DE", "AT"],
    "dolomites": ["IT"],
    "western_alps_ch": ["CH"],
    "western_alps_fr": ["FR", "IT"],  # Aosta valley
}

REGIONS: List[Dict[str, Any]] = [
    # Alpine regions (priority 30); chains_from reuses a country's chains.
    {"id": "northern_alps", "name": "Northern Alps", "chains_from": "germany"},
    {"id": "eastern_alps", "name": "Eastern Alps", "chains_from": "austria"},
    {
        "id": "bavarian_alps_south",
        "name": "Bavarian Alps (south)",
        "chains_from": "austria",
    },
    {
        "id": "dolomites",
        "name": "Dolomites",
        "main": [ICON_2I, EU, IFS],
        "cloud": [D2, EU, IFS025],
    },
    {
        "id": "western_alps_ch",
        "name": "Western Alps (CH)",
        "chains_from": "switzerland",
    },
    {
        "id": "western_alps_fr",
        "name": "Western Alps (FR)",
        "main": [AROME_HD, CH2, IFS],
        "cloud": [AROME_FR, EU, IFS025],
    },
    # Countries and country groups (priority 20).
    {
        "id": "germany",
        "name": "Germany",
        "countries": ["DE"],
        "main": [D2, EU, IFS],
        "cloud": [D2, EU, IFS025],
    },
    {
        "id": "austria",
        "name": "Austria",
        "countries": ["AT"],
        "main": [AROME_AT, EU, IFS],
        "cloud": [D2, EU, IFS025],
    },
    {
        "id": "switzerland",
        "name": "Switzerland",
        "countries": ["CH", "LI"],
        "main": [CH1, CH2, IFS],
        "cloud": [D2, EU, IFS025],
    },
    {
        "id": "france",
        "name": "France",
        "countries": ["FR", "MC"],
        "main": [AROME_HD, ARPEGE, IFS],
        "cloud": [AROME_FR, ARPEGE, IFS025],
    },
    {
        "id": "italy",
        "name": "Italy",
        "countries": ["IT", "SM", "VA", "MT"],
        "main": [ICON_2I, EU, IFS],
        "cloud": [D2, EU, IFS025],
    },
    {
        "id": "uk",
        "name": "United Kingdom & Ireland",
        "countries": ["GB", "IE", "IM", "GG", "JE"],
        "main": [UKV, UKG, IFS],
        "cloud": [UKV, UKG, IFS025],
    },
    {
        "id": "benelux",
        "name": "Benelux",
        "countries": ["NL", "BE", "LU"],
        "main": ["knmi_harmonie_arome_netherlands", EU, IFS],
        "cloud": [D2, EU, IFS025],
    },
    {
        "id": "denmark",
        "name": "Denmark",
        "countries": ["DK"],
        "main": [DMI, EU, IFS],
        "cloud": [D2, EU, IFS025],
    },
    {
        "id": "nordic",
        "name": "Nordic & Baltic",
        "countries": ["NO", "SE", "FI", "AX", "EE", "LV", "LT", "FO"],
        "main": ["metno_nordic", EU, RDPS, IFS],
        "cloud": [EU, RDPS, IFS025],
    },
    {
        "id": "iberia",
        "name": "Iberia",
        "countries": ["ES", "PT", "AD", "GI"],
        "main": [AROME_HD, EU, IFS],
        "cloud": [AROME_FR, EU, IFS025],
    },
    {
        "id": "central_eastern_europe",
        "name": "Central Eastern Europe",
        "countries": ["CZ", "SK", "HU", "SI", "HR"],
        "main": [AROME_AT, EU, IFS],
        "cloud": [D2, EU, IFS025],
    },
    {
        "id": "western_balkans",
        "name": "Western Balkans",
        "countries": ["BA", "ME", "AL", "XK", "RS", "MK"],
        "main": [ICON_2I, EU, IFS],
        "cloud": [EU, IFS025],
    },
    {
        "id": "poland",
        "name": "Poland",
        "countries": ["PL"],
        "main": [DMI, EU, IFS],
        "cloud": [D2, EU, IFS025],
    },
    {
        "id": "iceland",
        "name": "Iceland",
        "countries": ["IS"],
        "main": [DMI, EU, IFS],
        "cloud": [EU, IFS025],
    },
    {
        "id": "usa",
        "name": "USA",
        "countries": ["US", "PR", "VI"],
        # RDPS bridges 48-84 h, then NBM (statistical blend, no pressure
        # levels) to 264 h over CONUS; Alaska gets HRDPS / RDPS only.
        "main": [HRRR, HRDPS, RDPS, "ncep_nbm_conus", IFS],
        "cloud": [HRRR, HRDPS, RDPS, IFS025],
    },
    {
        "id": "canada",
        "name": "Canada",
        "countries": ["CA", "PM"],
        "main": [HRDPS, HRRR, RDPS, IFS],
        "cloud": [HRDPS, HRRR, RDPS, IFS025],
    },
    {
        "id": "japan",
        "name": "Japan",
        "countries": ["JP"],
        "main": ["jma_msm", IFS],
        "cloud": ["jma_msm", IFS025],
    },
    {
        "id": "korea",
        "name": "Korea",
        "countries": ["KR", "KP"],
        "main": ["kma_ldps", "jma_msm", IFS],
        "cloud": ["jma_msm", IFS025],
    },
]

# Sidebar group of each non-continent region in the viewer.
GROUP = {
    "usa": "North America",
    "canada": "North America",
    "japan": "Asia",
    "korea": "Asia",
}

_geod = Geod(ellps="WGS84")


def area_km2(geometry: Any) -> float:
    return abs(_geod.geometry_area_perimeter(geometry)[0]) / 1e6


def load_countries(path: Optional[str]) -> List[Dict[str, Any]]:
    if path is None:
        target = Path(tempfile.gettempdir()) / "ne_10m_admin_0_countries.json"
        if not target.exists():
            urllib.request.urlretrieve(NATURAL_EARTH, target)
        path = str(target)
    features = json.loads(Path(path).read_text(encoding="utf-8"))["features"]
    # One entry per code: Natural Earth lists e.g. France and Clipperton
    # Island both as FR, and keying by code let Clipperton replace France
    # (France got no coastal waters, Jersey's reached the Breton coast).
    # Territories without a code (-99) keep their own ADM0_A3 code.
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
    countries = list(by_code.values())
    return countries


def progress(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# Water up to this distance from a coast (sea and enclosed lakes) belongs
# to the nearest country, so coastal waters get the country's chain.
WATER_REACH_DEG = 1.0
WATER_STEP_DEG = 0.1


WATER_FINE_STEP_DEG = 0.01


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
        got = []
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
    diagram of all coast points) needs more memory than a laptop has.
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
        progress(f"  coastal waters: growth step {step}/{steps}")
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


def build(countries: List[Dict[str, Any]]) -> Dict[str, Any]:
    by_id = {r["id"]: r for r in REGIONS}
    known = {c["code"] for c in countries}
    progress("  coastal waters and lakes")
    waters = water_claims(countries)
    exact_by_id: Dict[str, Any] = {}
    features = []
    for number, region in enumerate(REGIONS, 1):
        rid = region["id"]
        progress(f"  region {number}/{len(REGIONS)}: {rid}")
        if rid in ALPINE:
            geometry = _alpine_geometry(rid, countries).buffer(0)
            exact_by_id[rid] = geometry  # simplified with all others
            priority = 30
        elif "countries" in region:
            missing = set(region["countries"]) - known
            if missing - {"XK"} and len(missing) == len(region["countries"]):
                raise SystemExit(f"{rid}: no Natural Earth country found")
            inside = [c for c in countries if c["code"] in region["countries"]]
            exact = unary_union(
                [c["geometry"] for c in inside]
                + [waters[c["code"]] for c in inside if c["code"] in waters]
            ).buffer(0)
            exact_by_id[rid] = exact
            geometry = exact  # simplified together with its neighbours
            priority = 20
        else:
            raise SystemExit(f"{rid}: no geometry")
        if isinstance(geometry, Polygon):
            geometry = MultiPolygon([geometry])
        source = by_id[region.get("chains_from", rid)]
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "id": rid,
                    "name": region["name"],
                    "priority": priority,
                    "group": GROUP.get(rid, "Europe"),
                    "area_km2": round(area_km2(geometry)),
                    "chains_from": region.get("chains_from"),
                    "main_chain_ids": source["main"],
                    "cloud_chain_ids": source["cloud"],
                    "min_elevation_m": None,
                    "max_elevation_m": None,
                },
                "geometry": _rounded(geometry),
            }
        )
    _simplify_together(features, exact_by_id)
    return {
        "type": "FeatureCollection",
        "_comment": "Generated by dev-tools/update_regions.py; do not edit.",
        "features": features,
    }


def _simplify_together(
    features: List[Dict[str, Any]], exact_by_id: Dict[str, Any]
) -> None:
    """Simplify all regions as one coverage.

    Simplifying neighbours one by one opens gaps and overlaps along shared
    borders; with equal priority the smaller region then wins inside its
    neighbour (Mittenwald fell to Austria). The exact geometries are made
    disjoint first in REGIONS order: alpine regions keep their area and a
    country region keeps only the rest (the alpine region wins there by
    priority anyway); overlapping coastal sea buffers go to the earlier
    region. Simplified together, all shared borders stay shared.
    """
    ids = list(exact_by_id)
    progress(f"  making {len(ids)} regions disjoint")
    disjoint = []
    taken = Polygon()
    for rid in ids:
        part = exact_by_id[rid].difference(taken).buffer(0)
        taken = taken.union(exact_by_id[rid])
        disjoint.append(part)
    progress("  simplifying all regions together")
    simplified = shapely.coverage_simplify(disjoint, SIMPLIFY[20])
    progress("  writing region geometries")
    by_id = dict(zip(ids, simplified))
    for f in features:
        rid = f["properties"]["id"]
        if rid not in by_id:
            continue
        geometry = _polygons_only(shapely.make_valid(by_id[rid]))
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
    """GeoJSON MultiPolygon on a 0.001° grid, still valid.

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
    return {"type": "MultiPolygon", "coordinates": data["coordinates"]}


# ---- Chain zones for the viewer's Chains tab -------------------------------
#
# The world (land plus the coastal buffer) is cut into pieces with the same
# inputs to the resolver: the winning region and which candidate models
# cover the point. Each piece is resolved at a point inside it with
# graupel.data.auto_chain, and pieces with the same main and cloud chain
# are merged into one zone.

WORLD = Polygon([(-180, -90), (180, -90), (180, 90), (-180, 90)])
# The chain zones are an overview for the viewer (the app resolves from
# regions.json): coarse outlines, a 0.01° grid and no islets keep chains.js
# small. Hover may be a few km off at borders and coasts.
ZONE_SIMPLIFY = 0.05
ZONE_GRID_DEG = 0.01
ZONE_MIN_PART_KM2 = 10.0
GLOBAL_ZONE_SIMPLIFY = 0.2
GLOBAL_ZONE_MIN_PART_KM2 = 100.0
MIN_PIECE_AREA = 0.01  # deg², slivers from the margin approximation
SLIVER_DEG = 0.02  # pieces narrower than twice this join a neighbour


def _coverage(model_id: str, domains: Dict[str, Any]) -> Any:
    from graupel.data.auto_chain import DOMAIN_MARGIN_DEG

    entry = domains[model_id]
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


def build_zones(countries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    from graupel.data import auto_chain
    from graupel.data.model_domains import load_model_domains

    auto_chain.load_regions.cache_clear()
    domains = load_model_domains()
    # Land as drawn by default: countries and enclosed lakes only. Coastal
    # waters of regions appear with "Show coast regions" (a coastal strip
    # here drew UK waters around Jersey right at the Normandy coast).
    countries_union = unary_union([c["geometry"] for c in countries])
    lakes = unary_union(
        [
            Polygon(p.exterior)
            for p in getattr(countries_union, "geoms", [countries_union])
        ]
    ).difference(countries_union)
    land = unary_union([countries_union, lakes])
    land = land.simplify(SIMPLIFY[20]).buffer(0).intersection(WORLD)

    candidates = sorted(
        m
        for m, d in domains.items()
        if d != "global"
        and "seamless" not in m
        and "ensemble" not in m
        and m not in auto_chain.FALLBACK_EXCLUDED
    )
    progress(f"  zones: coverage of {len(candidates)} candidate models")
    coverage = {m: _coverage(m, domains) for m in candidates}

    # Region pieces in resolver order. Their land part is drawn by default,
    # their coastal waters with "Show coast regions", all other sea with
    # "Show sea regions"; the hover shows the chain everywhere.
    pieces: List[Any] = []
    coast_pieces: List[Any] = []
    sea_pieces: List[Any] = []
    taken = Polygon()
    for region in auto_chain.load_regions():
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
        progress(
            f"  zones: split by {model_id} ({number}/{len(candidates)}), "
            f"{len(pieces) + len(coast_pieces) + len(sea_pieces)} pieces"
        )
        pieces = _split(pieces, coverage[model_id])
        coast_pieces = _split(coast_pieces, coverage[model_id])
        sea_pieces = _split(sea_pieces, coverage[model_id])
    progress("  zones: merging slivers into neighbours")
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
    progress(f"  zones: resolving {len(tagged)} pieces")
    for piece, kind in tagged:
        point = piece.representative_point()
        result = auto_chain.resolve_auto_chain(point.y, point.x)
        main = [m.id for m in result["main_model_chain"]]
        cloud = [m.id for m in result["cloud_model_chain"]]
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

    by_id = {r["id"]: r for r in auto_chain.load_regions()}
    out = []
    # Merge each zone's pieces, then simplify all zones (land and sea) as
    # one coverage so neighbouring zones keep sharing their borders.
    merged = []
    for zone in zones.values():
        for kind in ("parts", "coast_parts", "sea_parts"):
            parts = zone.pop(kind)
            merged.append(unary_union(parts) if parts else Polygon())
    progress(f"  zones: simplifying {len(zones)} zones together")
    simplified = shapely.coverage_simplify(merged, ZONE_SIMPLIFY)
    for i, zone in enumerate(zones.values()):
        geometry = _as_multi(simplified[3 * i])
        coast = _as_multi(simplified[3 * i + 1])
        sea = _as_multi(simplified[3 * i + 2])
        if zone["main_chain_ids"] == [auto_chain.MAIN_TERMINAL]:
            # "Only IFS" covers the rest of the world (Africa, Asia, South
            # America, every other coast) and is hidden by default; it held
            # half of chains.js at full detail.
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
                    if zone["main_chain_ids"] == [auto_chain.MAIN_TERMINAL]
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
    """Stable id from the chain itself, e.g. "cmc_gem_rdps.ecmwf_ifs"."""
    main = ".".join(zone["main_chain_ids"])
    cloud = ".".join(zone["cloud_chain_ids"])
    return f"{main}~{cloud}"


def write_zone_list(zones: List[Dict[str, Any]]) -> None:
    """graupel/models/chain_zones.json: the viewer zones without geometry."""
    doc = {
        "generated_by": "dev-tools/update_regions.py",
        "zones": [
            {"id": zone_id(z), **{k: z[k] for k in ZONE_LIST_KEYS}}
            for z in zones
        ],
    }
    OUT_ZONES.write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8")


def read_viewer_zones() -> List[Dict[str, Any]]:
    js = OUT_JS.read_text("utf-8")
    payload = js.split("window.CHAIN_ZONES = ", 1)[1]
    return json.loads(payload.rstrip().rstrip(";"))


def write_viewer_data(countries: List[Dict[str, Any]]) -> None:
    zones = build_zones(countries)
    write_zone_list(zones)
    # The map viewer lives only in the private repo (copy_release.sh).
    if OUT_JS.parent.is_dir():
        OUT_JS.write_text(
            "// Generated by dev-tools/update_regions.py; do not edit.\n"
            "// Areas with the same resolved auto chain (main + cloud).\n"
            "window.CHAIN_ZONES = "
            f"{json.dumps(zones, separators=(',', ':'))};\n",
            encoding="utf-8",
        )
    else:
        print(f"no {OUT_JS.parent.relative_to(ROOT)}/, chains.js skipped")
    for z in zones:
        print(
            f"{z['group']:16s} {z['area_km2']:>11} km²  "
            f"{' > '.join(z['main_chain_ids'])}  [{', '.join(z['regions'])}]"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--countries", help="Natural Earth admin-0 GeoJSON (default: download)"
    )
    parser.add_argument(
        "--zones-only",
        action="store_true",
        help="only rebuild docs/domain/chains.js from the existing regions",
    )
    parser.add_argument(
        "--chain-list-only",
        action="store_true",
        help="only rewrite graupel/models/chain_zones.json from chains.js",
    )
    args = parser.parse_args()

    if args.chain_list_only:
        if not OUT_JS.exists():
            parser.error(f"{OUT_JS.relative_to(ROOT)} not found")
        write_zone_list(read_viewer_zones())
        return 0
    progress("loading countries")
    countries = load_countries(args.countries)
    if args.zones_only:
        progress("building chain zones")
        write_viewer_data(countries)
        return 0
    progress("building regions")
    doc = build(countries)
    progress("writing regions.json, building chain zones")
    OUT_JSON.write_text(
        json.dumps(doc, separators=(",", ":")) + "\n", encoding="utf-8"
    )
    write_viewer_data(countries)
    return 0


if __name__ == "__main__":
    sys.exit(main())
