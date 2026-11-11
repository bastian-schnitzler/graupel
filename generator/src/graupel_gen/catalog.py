# SPDX-FileCopyrightText: 2026 Bastian Schnitzler
# SPDX-License-Identifier: MPL-2.0
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""Model catalogue (`model_catalogue.json`).

Fetches the Open-Meteo OpenAPI specification (`forecast.yml`), takes the
`models` enum, probes the forecast API for each model's variables,
pressure levels and time step, measures its horizon with the Single Runs
API and merges the result into the existing catalogue.

- Order and entries of the existing catalogue are kept; models new in the
  enum are appended, models no longer in it are removed.
- A model whose probe fails keeps its entry (a new one is left out).
- Probed fields replace the existing value only when it changes, so
  unchanged entries stay identical (variable order included).
- Curated fields (name, provider, region, spatial resolution, active) come
  from `sources/models.yaml`, else from the existing entry, else they are
  derived for a new model (website label, name, probed grid spacing).
- `documentation_url` comes from `sources/models.yaml`, else from the
  existing entry, else it is null; `provider_url` is the homepage of the
  provider (`provider_urls` in `sources/models.yaml`). Both are checked
  for their form (https, host), never requested.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

import httpx
import yaml

from .http import HEADERS, RateLimiter
from .output import make_meta
from .quantities import SOURCE_HOURLY, all_quantities, catalogued_quantities
from .sources import UNKNOWN_PROVIDER, Sources, check_url

logger = logging.getLogger("graupel_gen.catalog")

OPENAPI_YAML_URL = (
    "https://raw.githubusercontent.com/open-meteo/open-meteo/"
    "{ref}/openapi/forecast.yml"
)
WEBSITE_OPTIONS_URL = (
    "https://raw.githubusercontent.com/open-meteo/open-meteo-website/main/"
    "src/routes/en/docs/{route}/options.ts"
)
API_BASE_URL = "https://api.open-meteo.com/v1/forecast"
SINGLE_RUNS_URL = "https://single-runs-api.open-meteo.com/v1/forecast"
MODEL_META_URL = "https://api.open-meteo.com/data/{path}/static/meta.json"
# Runs compared per model: one day of runs (hourly models: 24 requests).
MAX_RUNS_TO_MEASURE = 24
CONCURRENCY = 5

# Probe every downloadable hourly quantity of the registry; only the
# catalogued ones are stored in `supported_variables`.
PROBE_QUANTITIES = [
    q
    for q in all_quantities()
    if q.source == SOURCE_HOURLY and q.downloadable and q.api_name
]
CATALOGUED_QUANTITIES = catalogued_quantities()
# Rejected by some model endpoints: probe again without them.
RETRY_WITHOUT = {q.api_name for q in PROBE_QUANTITIES if q.retry_without}
# Always listed, even when a probe returns no values for them.
CORE_VARIABLES = ("temperature", "wind_speed", "cloud_cover", "precipitation")

# Every pressure level of the forecast API; a model supports the levels
# with cloud cover data.
PRESSURE_LEVELS = [
    1000, 975, 950, 925, 900, 875, 850, 825, 800, 775, 750, 725, 700, 675,
    650, 625, 600, 575, 550, 525, 500, 475, 450, 425, 400, 375, 350, 325,
    300, 275, 250, 225, 200, 175, 150, 125, 100, 70, 50, 40, 30, 20, 15, 10,
]  # fmt: skip
GRID_STEPS_DEG = [
    0.005, 0.01, 0.015, 0.02, 0.025, 0.03, 0.05, 0.07, 0.1, 0.15, 0.2, 0.25,
    0.4, 0.5,
]  # fmt: skip

CURATED_FIELDS = (
    "name",
    "provider",
    "region",
    "spatial_resolution_km",
    "active",
)
# Field order of a catalogue entry.
ENTRY_FIELDS = (
    "id",
    "name",
    "short_name",
    "documentation_url",
    "provider",
    "provider_url",
    "region",
    "spatial_resolution_km",
    "temporal_resolution_hours",
    "max_forecast_hours",
    "supported_variables",
    "pressure_levels_hpa",
    "meta_path",
    "ensemble_meta_path",
    "active",
)
WEBSITE_ROUTES = [
    "dwd-api", "gfs-api", "meteofrance-api", "ecmwf-api", "ukmo-api",
    "kma-api", "jma-api", "meteoswiss-api", "metno-api", "gem-api",
    "bom-api", "cma-api", "knmi-api", "dmi-api", "italia-meteo-arpae-api",
    "geosphere-austria-api", "chmi-api",
]  # fmt: skip


# --- OpenAPI specification -----------------------------------------------


def openapi_source(content: str, ref: str, path: Optional[Path]) -> Dict:
    return {
        "name": "Open-Meteo OpenAPI forecast.yml",
        "url": (
            str(path) if path else OPENAPI_YAML_URL.format(ref=ref)
        ).replace(str(Path.home()), "~"),
        "version": ref,
        "sha256": hashlib.sha256(content.encode("utf-8")).hexdigest(),
    }


def fetch_openapi_yaml(
    ref: str = "main",
    cache_dir: Optional[Path] = None,
    timeout: float = 20.0,
) -> str:
    """forecast.yml at `ref`; cached outside the source tree."""
    url = OPENAPI_YAML_URL.format(ref=ref)
    cached = cache_dir / f"forecast-{ref}.yml" if cache_dir else None
    try:
        resp = httpx.get(url, timeout=timeout, headers=HEADERS)
        resp.raise_for_status()
        if cached:
            cached.parent.mkdir(parents=True, exist_ok=True)
            cached.write_text(resp.text, encoding="utf-8")
        return resp.text
    except httpx.HTTPError as e:
        if cached and cached.exists():
            logger.warning("forecast.yml not loaded (%s), using %s", e, cached)
            return cached.read_text(encoding="utf-8")
        raise


def extract_models_enum(yaml_content: str) -> List[str]:
    """The `models` enum of the forecast endpoint."""
    spec = yaml.safe_load(yaml_content)
    parameters = spec["paths"]["/v1/forecast"]["get"]["parameters"]
    for param in parameters:
        if param.get("name") == "models":
            return list(param["schema"]["items"]["enum"])
    raise RuntimeError("Parameter 'models' not found in OpenAPI specification")


# --- Derived names -------------------------------------------------------


async def fetch_website_model_labels(
    client: httpx.AsyncClient, limiter: RateLimiter
) -> Dict[str, str]:
    """Model display names from the open-meteo-website options."""
    labels: Dict[str, str] = {}
    for route in WEBSITE_ROUTES:
        await limiter.async_wait()
        try:
            resp = await client.get(
                WEBSITE_OPTIONS_URL.format(route=route), timeout=5.0
            )
        except httpx.HTTPError:
            continue
        if resp.status_code != 200:
            continue
        for value, label in re.findall(
            r"\{\s*value:\s*['\"]([^'\"]+)['\"],\s*label:\s*['\"]([^'\"]+)"
            r"['\"]\s*\}",
            resp.text,
        ):
            labels[value] = label
    return labels


def parse_nominal_resolution(name: str) -> Optional[float]:
    """Resolution named in a display name (e.g. '9km', '0.25°', '1.1km')."""
    m_deg = re.search(r"0\.(\d+)°", name)
    if m_deg:
        deg_str = m_deg.group(1)
        if deg_str == "25":
            return 25.0
        if deg_str in ("4", "40"):
            return 40.0
        if deg_str == "11":
            return 11.0
        return round(float("0." + deg_str) * 111.19, 1)
    m_km = re.search(r"(\d+(?:\.\d+)?)\s*km\b", name, re.IGNORECASE)
    if m_km:
        return float(m_km.group(1))
    return None


def clean_display_name(model_id: str) -> str:
    """Readable name for a model without curated or website name."""
    words = model_id.replace("_", " ").split()
    return " ".join(
        w.upper() if len(w) <= 4 or w.isdigit() else w.capitalize()
        for w in words
    )


# --- Probes --------------------------------------------------------------


class Prober:
    """Probes the Open-Meteo APIs for one catalogue run."""

    def __init__(
        self,
        client: httpx.AsyncClient,
        sources: Sources,
        limiter: Optional[RateLimiter] = None,
        retry_delay: float = 0.5,
    ):
        self.client = client
        self.sources = sources
        self.limiter = limiter or RateLimiter()
        self.semaphore = asyncio.Semaphore(CONCURRENCY)
        self.retry_delay = retry_delay

    async def get(self, url: str, **kwargs: Any) -> httpx.Response:
        await self.limiter.async_wait()
        return await self.client.get(url, **kwargs)

    async def properties(
        self, model_id: str, probe_grid: bool = False
    ) -> Optional[Dict[str, Any]]:
        """Variables, pressure levels and time step of a model.

        None when the model gives no usable answer, so the caller keeps
        its existing entry. `probe_grid` also measures the grid spacing
        (only needed for new models).
        """
        async with self.semaphore:
            lat, lon = self.sources.probe_point(model_id)
            level_vars = [f"cloud_cover_{lv}hPa" for lv in PRESSURE_LEVELS]
            api_vars = [q.api_name for q in PROBE_QUANTITIES]
            data: Optional[Dict[str, Any]] = None
            for attempt in range(3):
                params = {
                    "latitude": lat,
                    "longitude": lon,
                    "models": model_id,
                    "forecast_hours": 384,
                    "hourly": ",".join(api_vars + level_vars),
                }
                try:
                    resp = await self.get(API_BASE_URL, params=params)
                except httpx.HTTPError as e:
                    logger.debug("probe of %s failed: %s", model_id, e)
                    if attempt < 2:
                        await asyncio.sleep(self.retry_delay)
                    continue
                if resp.status_code == 429:
                    await asyncio.sleep(self.retry_delay * (attempt + 1))
                    continue
                if resp.status_code == 400 and RETRY_WITHOUT & set(api_vars):
                    api_vars = [v for v in api_vars if v not in RETRY_WITHOUT]
                    continue
                if resp.status_code == 200:
                    data = resp.json()
                else:
                    logger.debug(
                        "%s returned HTTP %s", model_id, resp.status_code
                    )
                break

            if data is None:
                logger.warning("Model %s: probe failed", model_id)
                return None
            hourly = data.get("hourly", {})

            def non_null(name: str) -> int:
                return sum(1 for v in hourly.get(name) or [] if v is not None)

            counts = {q.id: non_null(q.api_name) for q in PROBE_QUANTITIES}
            detected: Dict[str, Any] = {
                "variables": {qid for qid, n in counts.items() if n > 0},
                # Remaining hours: horizon of a new model without runs.
                "max_forecast_hours": max(counts.values(), default=0) or None,
                "temporal_resolution_hours": 1,
                "spatial_resolution_km": None,
                "pressure_levels_hpa": [
                    level
                    for level in PRESSURE_LEVELS
                    if non_null(f"cloud_cover_{level}hPa") > 0
                ],
            }
            times = hourly.get("time", [])
            if len(times) >= 2:
                try:
                    t0 = datetime.fromisoformat(times[0])
                    t1 = datetime.fromisoformat(times[1])
                    diff = (t1 - t0).total_seconds() / 3600.0
                    if diff > 0:
                        detected["temporal_resolution_hours"] = (
                            1 if diff >= 1 else round(diff, 2)
                        )
                except ValueError:
                    pass

            base_lat = data.get("latitude")
            if probe_grid and base_lat is not None:
                detected["spatial_resolution_km"] = await self._grid_km(
                    model_id, lat, lon, base_lat
                )

            missing = [q.id for q in PROBE_QUANTITIES if not counts[q.id]]
            logger.info(
                "Model %-30s -> horizon %sh | levels %d | without: %s",
                model_id,
                detected["max_forecast_hours"],
                len(detected["pressure_levels_hpa"]),
                ", ".join(missing) or "-",
            )
            return detected

    async def _grid_km(
        self, model_id: str, lat: float, lon: float, base_lat: float
    ) -> Optional[float]:
        """Grid spacing from the latitude the API snaps a point to."""
        for step in GRID_STEPS_DEG:
            try:
                resp = await self.get(
                    API_BASE_URL,
                    params={
                        "latitude": lat + step,
                        "longitude": lon,
                        "models": model_id,
                        "hourly": "temperature_2m",
                    },
                )
            except httpx.HTTPError:
                continue
            if resp.status_code != 200:
                continue
            new_lat = resp.json().get("latitude")
            if new_lat is not None and abs(new_lat - base_lat) > 0.0005:
                return round(abs(new_lat - base_lat) * 111.19, 1)
        return None

    async def max_run_hours(self, model_id: str) -> Optional[int]:
        """Longest run of the last day, measured with the Single Runs API.

        The forecast API mixes runs and counts hours from "now", so its
        valid hours depend on the run age at probe time. A model's
        capability is the length of its longest run (e.g. ECMWF IFS 00Z
        360 h vs 06Z 144 h). None for blends or unknown models.
        """
        path = self.sources.meta_path(model_id)
        if path is None:
            return None
        lat, lon = self.sources.probe_point(model_id)
        async with self.semaphore:
            try:
                resp = await self.get(MODEL_META_URL.format(path=path))
                if resp.status_code != 200:
                    return None
                meta = resp.json()
            except (httpx.HTTPError, ValueError):
                return None
            init = meta.get("last_run_initialisation_time")
            if not isinstance(init, (int, float)):
                return None
            interval = int(meta.get("update_interval_seconds") or 21600)
            # Coarser models are interpolated to hourly and padded at the
            # end by up to one native step; round down to that step.
            native = max(
                1, int(meta.get("temporal_resolution_seconds") or 3600) // 3600
            )
            latest = datetime.fromtimestamp(init, timezone.utc)
            count = min(MAX_RUNS_TO_MEASURE, max(1, 86400 // interval))
            longest: Optional[int] = None
            for k in range(count):
                run = latest - timedelta(seconds=k * interval)
                try:
                    r = await self.get(
                        SINGLE_RUNS_URL,
                        params={
                            "latitude": lat,
                            "longitude": lon,
                            "models": model_id,
                            "run": run.strftime("%Y-%m-%dT%H:%M"),
                            "hourly": "temperature_2m",
                            "forecast_hours": 400,
                            "timezone": "GMT",
                        },
                    )
                    if r.status_code != 200:
                        continue
                    hourly = r.json().get("hourly", {})
                except (httpx.HTTPError, ValueError):
                    continue
                valid = [
                    t
                    for t, v in zip(
                        hourly.get("time", []),
                        hourly.get("temperature_2m", []),
                    )
                    if v is not None
                ]
                if not valid:
                    continue
                last = datetime.fromisoformat(valid[-1]).replace(
                    tzinfo=timezone.utc
                )
                hours = int((last - run).total_seconds() // 3600)
                hours -= hours % native
                longest = hours if longest is None else max(longest, hours)
            return longest


# --- Merge ---------------------------------------------------------------


def curated_fields(
    model_id: str,
    existing: Optional[Dict[str, Any]],
    sources: Sources,
    probed: Optional[Dict[str, Any]] = None,
    website_labels: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """Curated fields: models.yaml, else the existing entry, else derived.

    Each field is looked up on its own, so an entry missing one field does
    not fail.
    """
    curated = sources.models.get(model_id, {})
    old = existing or {}
    out: Dict[str, Any] = {}
    derived: Optional[Dict[str, Any]] = None
    for key in CURATED_FIELDS:
        if curated.get(key) is not None:
            out[key] = curated[key]
        elif old.get(key) is not None:
            out[key] = old[key]
        else:
            if derived is None:
                derived = derive_new_fields(
                    model_id, probed or {}, website_labels or {}, sources
                )
            out[key] = derived[key]
    out["spatial_resolution_km"] = float(out["spatial_resolution_km"])
    out["active"] = bool(out["active"])
    out["documentation_url"] = documentation_url(model_id, old, sources)
    out["provider_url"] = sources.provider_url(out["provider"])
    return out


def documentation_url(
    model_id: str, existing: Dict[str, Any], sources: Sources
) -> Optional[str]:
    """Curated link, else the one of the existing entry, else None."""
    url = sources.documentation_url(model_id)
    if url is not None:
        return url
    url = existing.get("documentation_url")
    if url is None:
        return None
    return check_url(
        url, f"model_catalogue.json, {model_id}: documentation_url"
    )


def derive_new_fields(
    model_id: str,
    probed: Dict[str, Any],
    website_labels: Dict[str, str],
    sources: Sources,
) -> Dict[str, Any]:
    """Fields for a model that is neither curated nor in the catalogue."""
    name = website_labels.get(model_id) or clean_display_name(model_id)
    spatial = (
        parse_nominal_resolution(name)
        or probed.get("spatial_resolution_km")
        or 10.0
    )
    provider = sources.provider_for(model_id)
    if provider is None:
        provider = UNKNOWN_PROVIDER
    logger.warning(
        "Model %s is not curated: add it to sources/models.yaml "
        "(derived provider %r, region 'Global')",
        model_id,
        provider,
    )
    return {
        "name": name,
        "provider": provider,
        "region": "Global",
        "spatial_resolution_km": float(spatial),
        "active": True,
    }


def make_entry(
    model_id: str, fields: Dict[str, Any], sources: Sources
) -> Dict[str, Any]:
    """Entry in catalogue field order, with short name and metadata paths."""
    values = {
        **fields,
        "id": model_id,
        "short_name": sources.short_name_for(model_id),
        "meta_path": sources.meta_path(model_id),
        "ensemble_meta_path": sources.ensemble_meta_path(model_id),
    }
    return {key: values[key] for key in ENTRY_FIELDS}


def merge_entry(
    model_id: str,
    existing: Optional[Dict[str, Any]],
    probed: Dict[str, Any],
    run_hours: Optional[int],
    sources: Sources,
    website_labels: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """Catalogue entry from the probe, keeping unchanged values as they are."""
    old = existing or {}
    curated = curated_fields(
        model_id, existing, sources, probed, website_labels
    )

    found = set(probed["variables"]) | set(CORE_VARIABLES)
    variables = [qid for qid in CATALOGUED_QUANTITIES if qid in found]
    if existing and set(old.get("supported_variables") or []) == set(
        variables
    ):
        variables = old["supported_variables"]

    levels = probed["pressure_levels_hpa"]
    if existing and sorted(old.get("pressure_levels_hpa") or []) == sorted(
        levels
    ):
        levels = old["pressure_levels_hpa"]

    # Horizon: longest measured run. Without one (blends) keep the
    # catalogue value; a new model falls back to the remaining hours.
    if run_hours:
        hours = run_hours
    elif old.get("max_forecast_hours"):
        hours = old["max_forecast_hours"]
    else:
        hours = probed.get("max_forecast_hours") or 48

    return make_entry(
        model_id,
        {
            **curated,
            "temporal_resolution_hours": probed.get(
                "temporal_resolution_hours"
            )
            or old.get("temporal_resolution_hours")
            or 1,
            "max_forecast_hours": int(hours),
            "supported_variables": variables,
            "pressure_levels_hpa": levels,
        },
        sources,
    )


def without_excluded(
    entries: List[Dict[str, Any]], sources: Sources
) -> List[Dict[str, Any]]:
    """Entries without the models excluded in the sources."""
    return [e for e in entries if e["id"] not in sources.excluded_models]


def refresh_entry(entry: Dict[str, Any], sources: Sources) -> Dict[str, Any]:
    """Existing entry with the current curated fields (offline).

    Variables that are no longer catalogued quantities are dropped.
    """
    curated = curated_fields(entry["id"], entry, sources)
    variables = [
        v
        for v in entry.get("supported_variables") or []
        if v in CATALOGUED_QUANTITIES
    ]
    return make_entry(
        entry["id"],
        {**entry, **curated, "supported_variables": variables},
        sources,
    )


async def build_catalog(
    yaml_models: Sequence[str],
    existing: List[Dict[str, Any]],
    client: httpx.AsyncClient,
    sources: Sources,
    limiter: Optional[RateLimiter] = None,
    only: Optional[Sequence[str]] = None,
) -> List[Dict[str, Any]]:
    """Probes the models and merges the results into the catalogue.

    Models of the existing catalogue no longer in the enum or excluded in
    the sources are removed; `extra_models` of the sources count as part of
    the enum (served by the API, missing in forecast.yml). With `only`, the
    other models keep their entries unprobed.
    """
    enum = [
        m
        for m in [
            *yaml_models,
            *(m for m in sources.extra_models if m not in yaml_models),
        ]
        if m not in sources.excluded_models
    ]
    by_id = {item["id"]: item for item in existing}
    for model_id in by_id:
        if model_id in sources.excluded_models:
            logger.info("Model %s is excluded in models.yaml: removed", model_id)
        elif model_id not in enum:
            logger.warning(
                "Model %s is no longer in forecast.yml: removed", model_id
            )
    model_ids = [m for m in by_id if m in enum] + [
        m for m in enum if m not in by_id
    ]
    probe_ids = [m for m in model_ids if not only or m in set(only)]
    logger.info("Probing %d models via Open-Meteo API", len(probe_ids))
    prober = Prober(client, sources, limiter)
    probed = await asyncio.gather(
        *[prober.properties(m, probe_grid=m not in by_id) for m in probe_ids]
    )
    measured = await asyncio.gather(
        *[prober.max_run_hours(m) for m in probe_ids]
    )
    results = dict(zip(probe_ids, zip(probed, measured)))
    new_models = [m for m in probe_ids if m not in by_id]
    labels = (
        await fetch_website_model_labels(client, prober.limiter)
        if any(m not in sources.models for m in new_models)
        else {}
    )

    catalogue: List[Dict[str, Any]] = []
    for model_id in model_ids:
        existing_entry = by_id.get(model_id)
        probe, hours = results.get(model_id, (None, None))
        if probe is None:
            if existing_entry is None:
                logger.warning("Skipping new model %s", model_id)
                continue
            # Unprobed or failed: keep the probed fields, refresh the
            # curated ones.
            catalogue.append(refresh_entry(existing_entry, sources))
            continue
        catalogue.append(
            merge_entry(
                model_id, existing_entry, probe, hours, sources, labels
            )
        )
    logger.info("Catalogue with %d models", len(catalogue))
    return catalogue


async def update_horizons(
    catalogue: List[Dict[str, Any]],
    client: httpx.AsyncClient,
    sources: Sources,
    limiter: Optional[RateLimiter] = None,
) -> List[Dict[str, Any]]:
    """Re-measures the longest runs and updates only the horizons."""
    prober = Prober(client, sources, limiter)
    measured = await asyncio.gather(
        *[prober.max_run_hours(item["id"]) for item in catalogue]
    )
    out = []
    for item, hours in zip(catalogue, measured):
        if hours and hours != item["max_forecast_hours"]:
            logger.info(
                "%-35s %4dh -> %4dh",
                item["id"],
                item["max_forecast_hours"],
                hours,
            )
            item = {**item, "max_forecast_hours": hours}
        out.append(item)
    return out


# --- Document ------------------------------------------------------------


def catalogue_entries(doc: Any) -> List[Dict[str, Any]]:
    """Entries of a catalogue document (or of an old plain list)."""
    if doc is None:
        return []
    if isinstance(doc, list):
        return doc
    return list(doc["models"])


def api_source() -> Dict[str, Any]:
    return {
        "name": "Open-Meteo Forecast, Single Runs and metadata API",
        "url": "https://open-meteo.com",
        "version": date.today().isoformat(),
    }


def catalogue_document(
    entries: List[Dict[str, Any]], sources_meta: List[Dict[str, Any]]
) -> Dict[str, Any]:
    return {"meta": make_meta("catalog", sources_meta), "models": entries}
