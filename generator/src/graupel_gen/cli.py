# SPDX-FileCopyrightText: 2026 Bastian Schnitzler
# SPDX-License-Identifier: MPL-2.0
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""Command line: `graupel-gen catalog|domains|regions|quantities|all`.

    graupel-gen catalog [--only IDS] [--offline | --horizons-only]
    graupel-gen domains [--only IDS] [--offline]
    graupel-gen regions [--countries FILE]
    graupel-gen quantities
    graupel-gen all

Common options: `--out DIR` (default: model-data/ of the repository),
`--sources DIR` (default: generator/sources/), `--cache-dir DIR` for
downloads (default: ~/.cache/graupel-gen). `--offline` makes no request: it
rewrites the existing file (or `--existing FILE`)
with the curated fields and the current format; `domains` also closes
polygons around a pole again (`domains.close_polar_polygon`).
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx

from . import catalog, domains, regions
from .http import HEADERS, RateLimiter
from .output import (
    CATALOGUE_FILE,
    DEFAULT_OUT_DIR,
    DOMAINS_FILE,
    QUANTITIES_FILE,
    REGIONS_FILE,
    RESOLVER_CASES_FILE,
    ZONES_FILE,
    ZONES_GEOJSON_FILE,
    dump_geojson,
    dump_json,
    make_meta,
    read_document,
    write_document,
)
from .quantities import export_registry
from .resolver import Resolver
from .sources import DEFAULT_SOURCES_DIR, Sources, load_sources

logger = logging.getLogger("graupel_gen")


def default_cache_dir() -> Path:
    base = os.environ.get("XDG_CACHE_HOME") or str(Path.home() / ".cache")
    return Path(base) / "graupel-gen"


def _taken_over(path: Path) -> List[Dict[str, Any]]:
    root = DEFAULT_OUT_DIR.parent
    try:
        name = path.resolve().relative_to(root).as_posix()
    except ValueError:
        name = path.name
    return [
        {
            "name": "Open-Meteo",
            "url": "https://open-meteo.com",
            "version": "unknown",
            "note": f"taken over from {name} without new requests",
        }
    ]


def _existing(args: argparse.Namespace, filename: str):
    path = Path(args.existing) if args.existing else args.out / filename
    return path, read_document(path)


def _only(args: argparse.Namespace) -> Optional[List[str]]:
    return [m for m in args.only.split(",") if m] if args.only else None


# --- commands ------------------------------------------------------------


def cmd_quantities(args: argparse.Namespace, sources: Sources) -> int:
    doc = {
        "meta": make_meta(
            "quantities",
            [{"name": "graupel_gen/quantities.py"}],
        ),
        "quantities": export_registry(),
    }
    write_document(args.out / QUANTITIES_FILE, doc, dump_json)
    return 0


def cmd_catalog(args: argparse.Namespace, sources: Sources) -> int:
    path, existing_doc = _existing(args, CATALOGUE_FILE)
    existing = catalog.catalogue_entries(existing_doc)
    old_meta = (existing_doc or {}).get("meta") if isinstance(
        existing_doc, dict
    ) else None

    if args.offline:
        entries = [
            catalog.refresh_entry(e, sources)
            for e in catalog.without_excluded(existing, sources)
        ]
        meta_sources = (old_meta or {}).get("sources") or _taken_over(path)
    elif args.horizons_only:
        entries = asyncio.run(_horizons(existing, sources))
        meta_sources = (old_meta or {}).get("sources") or _taken_over(path)
        meta_sources = [
            s for s in meta_sources if not s["name"].startswith("Open-Meteo F")
        ] + [catalog.api_source()]
    else:
        if args.forecast_yml:
            yml_path = Path(args.forecast_yml)
            content = yml_path.read_text(encoding="utf-8")
        else:
            yml_path = None
            content = catalog.fetch_openapi_yaml(
                args.openapi_ref, args.cache_dir
            )
        enum = catalog.extract_models_enum(content)
        entries = asyncio.run(
            _build_catalog(enum, existing, sources, _only(args))
        )
        meta_sources = [
            catalog.openapi_source(content, args.openapi_ref, yml_path),
            catalog.api_source(),
        ]
    doc = catalog.catalogue_document(entries, meta_sources)
    write_document(args.out / CATALOGUE_FILE, doc, dump_json)
    cmd_quantities(args, sources)
    return 0


async def _build_catalog(enum, existing, sources, only):
    async with httpx.AsyncClient(timeout=25.0, headers=HEADERS) as client:
        return await catalog.build_catalog(
            enum, existing, client, sources, RateLimiter(), only
        )


async def _horizons(existing, sources):
    async with httpx.AsyncClient(timeout=25.0, headers=HEADERS) as client:
        return await catalog.update_horizons(
            existing, client, sources, RateLimiter()
        )


def _catalogue_ids(args: argparse.Namespace) -> List[str]:
    doc = read_document(args.out / CATALOGUE_FILE)
    if doc is None:
        raise SystemExit(f"{args.out / CATALOGUE_FILE} missing: run catalog")
    return [m["id"] for m in catalog.catalogue_entries(doc)]


def cmd_domains(args: argparse.Namespace, sources: Sources) -> int:
    ids = _catalogue_ids(args)
    path, existing_doc = _existing(args, DOMAINS_FILE)
    existing = domains.domains_entries(existing_doc)
    old_meta = (existing_doc or {}).get("meta")
    if args.offline:
        missing = [m for m in ids if m not in existing]
        if missing:
            raise SystemExit(f"no domain for {', '.join(missing)}")
        result = {m: existing[m] for m in ids}
        error = None
        meta_sources = (old_meta or {}).get("sources") or _taken_over(path)
    else:
        probe = domains.ApiProbe()
        result, error = domains.build_domains(
            ids,
            existing,
            sources,
            probe.has_data,
            probe.fetch_meta,
            _only(args),
        )
        meta_sources = [domains.api_source()]
    # Polygons around a pole are closed again, also when taken over
    # (RDPS lacked the last boundary step, REQ-441).
    result = domains.close_polar_domains(result)
    doc = domains.domains_document(result, meta_sources)
    write_document(
        args.out / DOMAINS_FILE, doc, lambda d: dump_json(d, indent=1)
    )
    if error is not None:
        logger.error("stopped: %s (finished models are written)", error)
        return 1
    return 0


def cmd_regions(args: argparse.Namespace, sources: Sources) -> int:
    if args.offline:
        return _regions_offline(args, sources)
    if args.countries:
        countries_path = Path(args.countries)
    else:
        countries_path = regions.fetch_countries(
            args.cache_dir, args.natural_earth
        )
    catalogue_doc = read_document(args.out / CATALOGUE_FILE)
    domains_doc = read_document(args.out / DOMAINS_FILE)
    if catalogue_doc is None or domains_doc is None:
        raise SystemExit("catalogue and domains missing: run catalog, domains")
    logger.info("loading countries")
    countries = regions.load_countries(countries_path)
    logger.info("building regions")
    features = regions.build_regions(countries, sources)
    region_sources = regions.regions_sources_meta(
        countries_path, args.natural_earth
    )
    write_document(
        args.out / REGIONS_FILE,
        regions.regions_document(features, region_sources),
        dump_geojson,
    )
    resolver = Resolver(
        catalog.catalogue_entries(catalogue_doc),
        domains_doc["models"],
        features,
    )
    zone_sources = region_sources + [
        {
            "name": CATALOGUE_FILE,
            "version": catalogue_doc["meta"]["generated_at"],
        },
        {"name": DOMAINS_FILE, "version": domains_doc["meta"]["generated_at"]},
    ]
    logger.info("building chain zones")
    zones = regions.build_zones(countries, resolver)
    write_document(
        args.out / ZONES_FILE,
        regions.zones_document(zones, zone_sources),
        lambda d: dump_json(d, indent=1),
    )
    write_document(
        args.out / ZONES_GEOJSON_FILE,
        regions.zones_geojson(zones, zone_sources),
        dump_geojson,
    )
    cases = regions.resolver_cases(resolver, sources.resolver_points)
    write_document(
        args.out / RESOLVER_CASES_FILE,
        regions.resolver_cases_document(
            cases,
            zone_sources[:2]
            + [{"name": "generator/sources/resolver_points.yaml"}]
            + zone_sources[2:],
        ),
        dump_json,
    )
    for z in zones:
        logger.info(
            "%-16s %11d km²  %s  [%s]",
            z["group"],
            z["area_km2"],
            " > ".join(z["main_chain_ids"]),
            ", ".join(z["regions"]),
        )
    return 0


def _regions_offline(args: argparse.Namespace, sources: Sources) -> int:
    """Zone list from an existing file and resolver cases, no geometry work.

    Reads regions.geojson from --out and the zones of --existing (or the
    chain_zones.json in --out); chain_zones.geojson stays as it is.
    """
    catalogue_doc = read_document(args.out / CATALOGUE_FILE)
    domains_doc = read_document(args.out / DOMAINS_FILE)
    regions_doc = read_document(args.out / REGIONS_FILE)
    if catalogue_doc is None or domains_doc is None or regions_doc is None:
        raise SystemExit("catalogue, domains or regions missing")
    path, zones_doc = _existing(args, ZONES_FILE)
    if zones_doc is None:
        raise SystemExit(f"{path} missing")
    resolver = Resolver(
        catalog.catalogue_entries(catalogue_doc),
        domains_doc["models"],
        regions_doc["features"],
    )
    zone_sources = (zones_doc.get("meta") or {}).get("sources") or [
        *regions_doc["meta"]["sources"],
        *_taken_over(path),
    ]
    zones = [
        {"id": z["id"], **{k: z[k] for k in regions.ZONE_LIST_KEYS}}
        for z in zones_doc["zones"]
    ]
    write_document(
        args.out / ZONES_FILE,
        {"meta": make_meta("regions", zone_sources), "zones": zones},
        lambda d: dump_json(d, indent=1),
    )
    cases = regions.resolver_cases(resolver, sources.resolver_points)
    write_document(
        args.out / RESOLVER_CASES_FILE,
        regions.resolver_cases_document(
            cases,
            regions_doc["meta"]["sources"]
            + [{"name": "generator/sources/resolver_points.yaml"}],
        ),
        dump_json,
    )
    return 0


def cmd_all(args: argparse.Namespace, sources: Sources) -> int:
    for command in (cmd_catalog, cmd_domains, cmd_regions):
        status = command(args, sources)
        if status:
            return status
    return 0


COMMANDS = {
    "catalog": cmd_catalog,
    "domains": cmd_domains,
    "regions": cmd_regions,
    "quantities": cmd_quantities,
    "all": cmd_all,
}


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="graupel-gen",
        description="Generates the Graupel model data (model-data/).",
    )
    p.add_argument("command", choices=list(COMMANDS))
    p.add_argument(
        "--out",
        type=Path,
        default=DEFAULT_OUT_DIR,
        help="output directory (default: model-data/ of the repository)",
    )
    p.add_argument(
        "--sources",
        type=Path,
        default=DEFAULT_SOURCES_DIR,
        help="curated inputs (default: generator/sources/)",
    )
    p.add_argument(
        "--cache-dir",
        type=Path,
        default=default_cache_dir(),
        help="downloads (forecast.yml, Natural Earth)",
    )
    p.add_argument("--only", help="comma-separated model ids (catalog, domains)")
    p.add_argument(
        "--offline",
        action="store_true",
        help="no requests: rewrite the existing catalogue / domains; "
        "regions: zone list from --existing and resolver cases only",
    )
    p.add_argument(
        "--existing",
        help="existing catalogue or domains file (default: the one in --out)",
    )
    p.add_argument(
        "--horizons-only",
        action="store_true",
        help="catalog: only re-measure the horizons",
    )
    p.add_argument("--forecast-yml", help="local OpenAPI forecast.yml")
    p.add_argument(
        "--openapi-ref",
        default="main",
        help="git ref of open-meteo/open-meteo for forecast.yml",
    )
    p.add_argument("--countries", help="local Natural Earth admin-0 GeoJSON")
    p.add_argument(
        "--natural-earth",
        default=regions.NATURAL_EARTH_VERSION,
        help="Natural Earth version tag",
    )
    p.add_argument("-v", "--verbose", action="store_true")
    return p


def main(argv: Optional[List[str]] = None) -> None:
    args = parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )
    if args.existing and args.command == "all":
        raise SystemExit("--existing needs a single command")
    sources = load_sources(args.sources)
    sys.exit(COMMANDS[args.command](args, sources))


if __name__ == "__main__":
    main()
