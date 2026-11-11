# SPDX-FileCopyrightText: 2026 Bastian Schnitzler
# SPDX-License-Identifier: MPL-2.0
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""Output files in `model-data/` and their `meta` header.

Every file starts with a `meta` object (`license`, `license_url`, for data
derived from Open-Meteo `attribution`, then `generated_by`, `generated_at`,
`sources` with versions). `write_document` sets the license fields from the
file name (DEC-006), so every run keeps them. A file whose content apart from
`meta.generated_at` did not change is not rewritten, so a new run leaves
unchanged files byte-identical; entries keep their order and formatting, so
unchanged entries stay identical inside a changed file as well.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from . import __version__

logger = logging.getLogger("graupel_gen")

CATALOGUE_FILE = "model_catalogue.json"
DOMAINS_FILE = "model_domains.json"
REGIONS_FILE = "regions.geojson"
ZONES_FILE = "chain_zones.json"
ZONES_GEOJSON_FILE = "chain_zones.geojson"
QUANTITIES_FILE = "quantities.json"
RESOLVER_CASES_FILE = "resolver_cases.json"

DEFAULT_OUT_DIR = Path(__file__).resolve().parents[3] / "model-data"

# Licenses of the data files (DEC-006): data derived from Open-Meteo
# (CC BY 4.0) stays under CC BY 4.0 with attribution; own data without
# Open-Meteo content is under MPL-2.0 like the generator code.
CC_BY = "CC-BY-4.0"
MPL = "MPL-2.0"
LICENSE_URLS = {
    CC_BY: "https://creativecommons.org/licenses/by/4.0/",
    MPL: "https://mozilla.org/MPL/2.0/",
}
OPEN_METEO_ATTRIBUTION = (
    "Contains data derived from Open-Meteo.com (CC BY 4.0, "
    "https://open-meteo.com/). Modified: selected, combined and processed "
    "by graupel-gen; see meta.sources."
)
FILE_LICENSES = {
    CATALOGUE_FILE: CC_BY,
    DOMAINS_FILE: CC_BY,
    ZONES_FILE: CC_BY,
    ZONES_GEOJSON_FILE: CC_BY,
    REGIONS_FILE: MPL,
    QUANTITIES_FILE: MPL,
    RESOLVER_CASES_FILE: MPL,
}
LICENSE_KEYS = ("license", "license_url", "attribution")


def now_iso() -> str:
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def make_meta(command: str, sources: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "generated_by": f"graupel-gen {__version__} {command}",
        "generated_at": now_iso(),
        "sources": sources,
    }


def license_meta(name: str) -> Dict[str, str]:
    """`license`, `license_url` and, for CC BY data, `attribution`."""
    spdx = FILE_LICENSES[name]
    meta = {"license": spdx, "license_url": LICENSE_URLS[spdx]}
    if spdx == CC_BY:
        meta["attribution"] = OPEN_METEO_ATTRIBUTION
    return meta


def with_license(name: str, doc: Dict[str, Any]) -> Dict[str, Any]:
    """`doc` with the license fields of file `name` at the top of `meta`.

    Files without an entry in FILE_LICENSES are returned unchanged.
    """
    if name not in FILE_LICENSES:
        return doc
    rest = {
        k: v
        for k, v in (doc.get("meta") or {}).items()
        if k not in LICENSE_KEYS
    }
    meta = {**license_meta(name), **rest}
    if "meta" in doc:
        return {k: meta if k == "meta" else v for k, v in doc.items()}
    return {"meta": meta, **doc}


def dump_json(doc: Any, indent: int = 2) -> str:
    return json.dumps(doc, indent=indent, ensure_ascii=False) + "\n"


def dump_geojson(doc: Dict[str, Any]) -> str:
    """FeatureCollection with one compact feature per line (small diffs)."""
    head = {k: v for k, v in doc.items() if k != "features"}
    lines = [
        json.dumps(f, separators=(",", ":"), ensure_ascii=False)
        for f in doc["features"]
    ]
    head_json = json.dumps(head, separators=(",", ":"), ensure_ascii=False)
    return (
        head_json[:-1]
        + ',"features":[\n'
        + ",\n".join(lines)
        + "\n]}\n"
    )


def read_document(path: Path) -> Optional[Dict[str, Any]]:
    if not path.exists():
        return None
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def _without_timestamp(doc: Any) -> Any:
    if not isinstance(doc, dict) or not isinstance(doc.get("meta"), dict):
        return doc
    meta = {k: v for k, v in doc["meta"].items() if k != "generated_at"}
    return {**doc, "meta": meta}


def write_document(
    path: Path,
    doc: Dict[str, Any],
    dump: Callable[[Dict[str, Any]], str] = dump_json,
) -> bool:
    """Write `doc` unless only `meta.generated_at` differs. True if written.

    The license fields of the file (FILE_LICENSES) are set in `meta`.
    """
    doc = with_license(path.name, doc)
    old = None
    try:
        old = read_document(path)
    except (OSError, ValueError):
        old = None
    if old is not None and _without_timestamp(old) == _without_timestamp(
        json.loads(dump(doc))
    ):
        logger.info("%s unchanged", path.name)
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(dump(doc), encoding="utf-8")
    logger.info("wrote %s", path)
    return True
