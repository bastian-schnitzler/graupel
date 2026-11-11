# SPDX-FileCopyrightText: 2026 Bastian Schnitzler
# SPDX-License-Identifier: MPL-2.0
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""Location-based model chains, as the consumers resolve them.

`Resolver.resolve(lat, lon)` picks the region containing the point
(highest priority, then smallest area). A region's chains are preference
lists: models whose domain does not cover the point with
`DOMAIN_MARGIN_DEG` are dropped, then every model that does not extend the
horizon by `MIN_EXTENSION_HOURS`. Without a region, or when only the
terminal model of the region's chain is left, the domain fallback takes
the regional models finer than `ecmwf_ifs` covering the point, finest
first, under the same rule, and ends with `ecmwf_ifs` / `ecmwf_ifs025`.

The generator uses it to cut the chain zones and to write
`resolver_cases.json`; the download library implements the same rules.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, Tuple

MAIN_TERMINAL = "ecmwf_ifs"
CLOUD_TERMINAL = "ecmwf_ifs025"
# Points closer than this to a domain edge count as outside.
DOMAIN_MARGIN_DEG = 0.5
# The fallback only uses regional models finer than the terminal model.
FALLBACK_MAX_RESOLUTION_KM = 9.0
# Blends and statistical products are never chosen automatically.
# HRDPS West: experimental, retired by ECCC in favour of HRDPS (2.5 km).
FALLBACK_EXCLUDED = {"best_match", "ncep_nbm_conus", "cmc_gem_hrdps_west"}
MIN_CLOUD_PRESSURE_LEVELS = 10
# A model joins a chain only when it extends the horizon by this much;
# shorter steps (DMI 59 h, then KNMI 60 h) add a model for nothing.
MIN_EXTENSION_HOURS = 12
# Simplified region outlines lose up to ~1 km along coasts and borders
# with countries without a region; a point there still takes a region
# this near.
REGION_SNAP_DEG = 0.02

Ring = Sequence[Tuple[float, float]]
Bounds = Tuple[float, float, float, float]


def point_in_ring(lon: float, lat: float, ring: Ring) -> bool:
    """Even-odd ray casting on lon/lat."""
    inside = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        if (y1 > lat) != (y2 > lat):
            x = x1 + (lat - y1) * (x2 - x1) / (y2 - y1)
            if x > lon:
                inside = not inside
    return inside


def _in_polygon(lon: float, lat: float, ring: Ring) -> bool:
    return any(
        point_in_ring(lon + shift, lat, ring) for shift in (0.0, 360.0, -360.0)
    )


def parse_domains(raw: Dict[str, Any]) -> Dict[str, Any]:
    """`"global"` or a closed lon/lat ring per model."""
    domains: Dict[str, Any] = {}
    for model_id, entry in raw.items():
        if entry == "global":
            domains[model_id] = "global"
        else:
            domains[model_id] = [(lon, lat) for lon, lat in entry["polygon"]]
    return domains


def domain_contains(
    domains: Dict[str, Any],
    model_id: str,
    lat: float,
    lon: float,
    margin_deg: float = 0.0,
) -> Optional[bool]:
    """True when the model delivers data at the point.

    With `margin_deg`, the point and the eight points `margin_deg` around
    it must all lie inside. None for a model without a known domain.
    """
    domain = domains.get((model_id or "").lower())
    if domain is None:
        return None
    if isinstance(domain, str):  # "global"
        return True
    offsets = [(0.0, 0.0)]
    if margin_deg > 0:
        offsets += [
            (dx * margin_deg, dy * margin_deg)
            for dx in (-1, 0, 1)
            for dy in (-1, 0, 1)
            if dx or dy
        ]
    return all(
        _in_polygon(lon + dx, max(-90.0, min(90.0, lat + dy)), domain)
        for dx, dy in offsets
    )


def _bounds(ring: Ring) -> Bounds:
    xs = [x for x, _ in ring]
    ys = [y for _, y in ring]
    return (min(xs), min(ys), max(xs), max(ys))


def _merge_bounds(boxes: List[Bounds]) -> Bounds:
    if not boxes:
        return (0.0, 0.0, -1.0, -1.0)  # contains nothing
    return (
        min(b[0] for b in boxes),
        min(b[1] for b in boxes),
        max(b[2] for b in boxes),
        max(b[3] for b in boxes),
    )


def _in_box(lon: float, lat: float, box: Bounds) -> bool:
    return box[0] <= lon <= box[2] and box[1] <= lat <= box[3]


def parse_regions(features: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Regions with polygons and boxes, by priority (desc), then area."""
    regions = []
    for feature in features:
        props = dict(feature["properties"])
        props["polygons"] = [
            [[(x, y) for x, y in ring] for ring in poly]
            for poly in feature["geometry"]["coordinates"]
        ]
        # Bounding boxes skip the ray casting for far-away polygons.
        props["boxes"] = [_bounds(rings[0]) for rings in props["polygons"]]
        props["box"] = _merge_bounds(props["boxes"])
        regions.append(props)
    regions.sort(key=lambda r: (-r["priority"], r["area_km2"]))
    return regions


def _in_multipolygon(
    lon: float,
    lat: float,
    polygons: List[List[Ring]],
    boxes: Optional[List[Bounds]] = None,
) -> bool:
    for i, rings in enumerate(polygons):
        if boxes is not None and not _in_box(lon, lat, boxes[i]):
            continue
        if point_in_ring(lon, lat, rings[0]) and not any(
            point_in_ring(lon, lat, hole) for hole in rings[1:]
        ):
            return True
    return False


class Resolver:
    """Chains from a catalogue, the model domains and the regions."""

    def __init__(
        self,
        catalogue: List[Dict[str, Any]],
        domains: Dict[str, Any],
        region_features: List[Dict[str, Any]],
    ):
        self.catalogue = {m["id"]: m for m in catalogue}
        self.domains = parse_domains(domains)
        self.regions = parse_regions(region_features)

    # --- regions ---------------------------------------------------------

    def _region_containing(self, lat: float, lon: float):
        for region in self.regions:
            if _in_box(lon, lat, region["box"]) and _in_multipolygon(
                lon, lat, region["polygons"], region["boxes"]
            ):
                return region
        return None

    def region_at(self, lat: float, lon: float) -> Optional[Dict[str, Any]]:
        """The winning region at the point, or None.

        Without a region at the point itself, the eight points
        REGION_SNAP_DEG around it decide (highest priority, then smallest
        area).
        """
        region = self._region_containing(lat, lon)
        if region is not None:
            return region
        nearby = [
            self._region_containing(
                lat + dy * REGION_SNAP_DEG, lon + dx * REGION_SNAP_DEG
            )
            for dx in (-1, 0, 1)
            for dy in (-1, 0, 1)
            if dx or dy
        ]
        found = [r for r in nearby if r is not None]
        if not found:
            return None
        return min(found, key=lambda r: (-r["priority"], r["area_km2"]))

    # --- models ----------------------------------------------------------

    def hours(self, model_id: str) -> int:
        return int(self.catalogue[model_id]["max_forecast_hours"])

    def cloud_capable(self, model_id: str) -> bool:
        levels = self.catalogue[model_id].get("pressure_levels_hpa") or []
        return len(levels) >= MIN_CLOUD_PRESSURE_LEVELS

    def covers(self, model_id: str, lat: float, lon: float) -> bool:
        return bool(
            domain_contains(
                self.domains, model_id, lat, lon, DOMAIN_MARGIN_DEG
            )
        )

    def _filter(self, ids: Sequence[str], lat: float, lon: float):
        """Covering models that extend the horizon, in preference order."""
        return self.extending([m for m in ids if self.covers(m, lat, lon)])

    def fallback_candidates(
        self, lat: float, lon: float, cloud: bool
    ) -> List[str]:
        candidates = []
        for model_id, domain in self.domains.items():
            model = self.catalogue.get(model_id)
            resolution = (model or {}).get("spatial_resolution_km")
            # Inactive models (e.g. AROME Austria, discontinued, REQ-767)
            # deliver no new runs.
            if (
                model is None
                or model.get("active") is False
                or domain == "global"
                or "seamless" in model_id
                or "ensemble" in model_id
                or model_id in FALLBACK_EXCLUDED
                or (resolution or FALLBACK_MAX_RESOLUTION_KM)
                >= FALLBACK_MAX_RESOLUTION_KM
                or (cloud and not self.cloud_capable(model_id))
                or not self.covers(model_id, lat, lon)
            ):
                continue
            candidates.append(model)
        # Finest first; within one resolution the longest horizon first,
        # so each resolution tier contributes at most its longest model.
        candidates.sort(
            key=lambda m: (m["spatial_resolution_km"], -m["max_forecast_hours"])
        )
        return [m["id"] for m in candidates]

    def extending(self, ids: Sequence[str]) -> List[str]:
        """Catalogue models that extend the horizon, in preference order."""
        chain: List[str] = []
        horizon = 0
        for model_id in ids:
            if model_id not in self.catalogue:
                continue
            if self.hours(model_id) >= horizon + MIN_EXTENSION_HOURS:
                chain.append(model_id)
                horizon = self.hours(model_id)
        return chain

    def with_terminal(self, chain: List[str], terminal: str) -> List[str]:
        chain = [m for m in chain if m != terminal]
        horizon = self.hours(terminal)
        while chain and self.hours(chain[-1]) > horizon - MIN_EXTENSION_HOURS:
            chain.pop()
        return chain + [terminal]

    # --- chains ----------------------------------------------------------

    def resolve(self, lat: Any, lon: Any) -> Dict[str, Any]:
        """Main and cloud chain (model ids) for a location.

        Returns `main_chain_ids`, `cloud_chain_ids`, `region_id`,
        `region_name` and `resolution_reason` (`region`,
        `domain_fallback`, `global_fallback`).
        """
        try:
            lat, lon = float(lat), float(lon)
            if not (-90 <= lat <= 90) or lon != lon:
                raise ValueError
        except (TypeError, ValueError):
            return _result(
                [MAIN_TERMINAL], [CLOUD_TERMINAL], None, "global_fallback"
            )
        lon = ((lon + 180) % 360) - 180

        region = self.region_at(lat, lon)
        fallback_main = self._filter(
            self.fallback_candidates(lat, lon, False), lat, lon
        )
        fallback_cloud = self._filter(
            self.fallback_candidates(lat, lon, True), lat, lon
        )
        if region is not None:
            main = self._filter(region["main_chain_ids"], lat, lon)
            cloud = self._filter(region["cloud_chain_ids"], lat, lon)
            # A region whose regional models all miss the point (only the
            # terminal model left) yields to a domain fallback with
            # regional models, e.g. overseas parts of a country.
            regional_left = any(m != MAIN_TERMINAL for m in main)
            if regional_left or not fallback_main:
                return _result(
                    self.with_terminal(main, MAIN_TERMINAL),
                    self.with_terminal(cloud, CLOUD_TERMINAL),
                    region,
                    "region",
                )
        reason = "domain_fallback" if fallback_main else "global_fallback"
        return _result(
            self.with_terminal(fallback_main, MAIN_TERMINAL),
            self.with_terminal(fallback_cloud, CLOUD_TERMINAL),
            None,
            reason,
        )

    def region_chains(self, region_id: str) -> Optional[Dict[str, Any]]:
        """A region's chains without a point (only the horizon rule)."""
        region = next((r for r in self.regions if r["id"] == region_id), None)
        if region is None:
            return None
        return _result(
            self.with_terminal(
                self.extending(region["main_chain_ids"]), MAIN_TERMINAL
            ),
            self.with_terminal(
                self.extending(region["cloud_chain_ids"]), CLOUD_TERMINAL
            ),
            region,
            "region",
        )


def _result(
    main: List[str],
    cloud: List[str],
    region: Optional[Dict[str, Any]],
    reason: str,
) -> Dict[str, Any]:
    return {
        "main_chain_ids": main,
        "cloud_chain_ids": cloud,
        "region_id": region["id"] if region else None,
        "region_name": region["name"] if region else None,
        "resolution_reason": reason,
    }
