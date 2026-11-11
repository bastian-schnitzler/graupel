# SPDX-FileCopyrightText: 2026 Bastian Schnitzler
# SPDX-License-Identifier: MPL-2.0
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""Curated inputs in `generator/sources/` (YAML).

- `models.yaml`: curated catalogue fields, metadata paths, probe points,
  documentation links, providers of new models by id prefix, the homepage
  of each provider, models left out of the catalogue and models the
  forecast API serves although forecast.yml does not list them.
- `short_names.yaml`: nicknames for the model header.
- `regions.yaml`: regions with their preference chains and the hand-drawn
  alpine outlines.
- `resolver_points.yaml`: points with expected regions for the resolver.

The directory defaults to `sources/` next to the package source tree and is
set with `--sources`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlsplit

import yaml

DEFAULT_SOURCES_DIR = Path(__file__).resolve().parents[2] / "sources"
DEFAULT_PROBE_POINT = (50.0, 8.0)
# Provider of a new model whose id matches no prefix: it has no homepage.
UNKNOWN_PROVIDER = "Unknown"


def check_url(url: Any, where: str) -> str:
    """`url` if it is an https URL with a host, else ValueError.

    Only the form is checked; the URL is never requested (offline, DEC-030).
    """
    if not isinstance(url, str) or not url or url != url.strip():
        raise ValueError(f"{where}: {url!r} is not a URL")
    if any(c.isspace() for c in url):
        raise ValueError(f"{where}: {url!r} contains white space")
    try:
        parts = urlsplit(url)
        host = parts.hostname
    except ValueError as e:
        raise ValueError(f"{where}: {url!r} is not a URL ({e})") from None
    if parts.scheme != "https":
        raise ValueError(f"{where}: {url!r} is not an https URL")
    if not host or "." not in host:
        raise ValueError(f"{where}: {url!r} has no host")
    return url


def _load(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f)


@dataclass
class Sources:
    models: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    provider_prefixes: Dict[str, str] = field(default_factory=dict)
    provider_urls: Dict[str, str] = field(default_factory=dict)
    excluded_models: List[str] = field(default_factory=list)
    extra_models: List[str] = field(default_factory=list)
    short_names: Dict[str, str] = field(default_factory=dict)
    regions: Dict[str, Any] = field(default_factory=dict)
    resolver_points: List[Dict[str, Any]] = field(default_factory=list)

    # --- models -----------------------------------------------------------

    def short_name_for(self, model_id: Optional[str]) -> Optional[str]:
        """Nickname of a model id, None when the full name is used."""
        return self.short_names.get(model_id or "")

    def meta_path(self, model_id: Optional[str]) -> Optional[str]:
        """Open-Meteo metadata path of a model, None for blends."""
        model_id = (model_id or "").lower()
        if not model_id or model_id == "best_match" or "seamless" in model_id:
            return None
        return self.models.get(model_id, {}).get("meta_path", model_id)

    def ensemble_meta_path(self, model_id: Optional[str]) -> Optional[str]:
        """Metadata path of the ensemble behind precipitation probability."""
        entry = self.models.get((model_id or "").lower(), {})
        return entry.get("ensemble_meta_path")

    def probe_point(self, model_id: str) -> tuple:
        point = self.models.get(model_id, {}).get("probe_point")
        if point:
            return (float(point[0]), float(point[1]))
        return DEFAULT_PROBE_POINT

    def documentation_url(self, model_id: str) -> Optional[str]:
        """Curated documentation link of a model, None without one."""
        url = self.models.get(model_id, {}).get("documentation_url")
        if url is None:
            return None
        return check_url(url, f"models.yaml, {model_id}: documentation_url")

    def provider_url(self, provider: Optional[str]) -> Optional[str]:
        """Homepage of a provider; None only for the unknown provider.

        A provider without homepage is an error of the sources.
        """
        if provider == UNKNOWN_PROVIDER:
            return None
        url = self.provider_urls.get(provider or "")
        if url is None:
            raise ValueError(
                f"models.yaml: provider {provider!r} has no homepage in "
                "provider_urls"
            )
        return check_url(url, f"models.yaml, provider_urls: {provider}")

    def provider_for(self, model_id: str) -> Optional[str]:
        """Provider of a new model from its id prefix, longest prefix first."""
        for prefix in sorted(self.provider_prefixes, key=len, reverse=True):
            if model_id.startswith(prefix):
                return self.provider_prefixes[prefix]
        return None


def _check_regions(regions: Dict[str, Any]) -> None:
    """Codes and model ids are strings (YAML reads a bare NO as false)."""
    for region in regions.get("regions") or []:
        alpine = region.get("alpine") or {}
        lists = [
            region.get("countries"),
            alpine.get("countries"),
            region.get("main"),
            region.get("cloud"),
        ]
        for values in lists:
            for value in values or []:
                if not isinstance(value, str):
                    raise ValueError(
                        f"regions.yaml, {region.get('id')}: {value!r} is not "
                        "a string (quote country codes)"
                    )


def _check_models(sources: Sources) -> None:
    """Every link is an https URL; every named provider has a homepage."""
    for provider, url in sources.provider_urls.items():
        check_url(url, f"models.yaml, provider_urls: {provider}")
    providers = set(sources.provider_prefixes.values())
    for model_id, entry in sources.models.items():
        sources.documentation_url(model_id)
        if entry.get("provider") is not None:
            providers.add(entry["provider"])
    for provider in sorted(providers):
        sources.provider_url(provider)


def load_sources(directory: Optional[Path] = None) -> Sources:
    directory = Path(directory or DEFAULT_SOURCES_DIR)
    models = _load(directory / "models.yaml") or {}
    regions = _load(directory / "regions.yaml") or {}
    _check_regions(regions)
    sources = Sources(
        models=models.get("models") or {},
        provider_prefixes=models.get("provider_prefixes") or {},
        provider_urls=models.get("provider_urls") or {},
        excluded_models=models.get("excluded_models") or [],
        extra_models=models.get("extra_models") or [],
        short_names=_load(directory / "short_names.yaml") or {},
        regions=regions,
        resolver_points=(_load(directory / "resolver_points.yaml") or {}).get(
            "points"
        )
        or [],
    )
    _check_models(sources)
    return sources
