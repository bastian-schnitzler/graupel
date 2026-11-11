# SPDX-FileCopyrightText: 2026 Bastian Schnitzler
# SPDX-License-Identifier: MPL-2.0
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""Resolver on the committed data and the consistency of the data files."""

import json

import pytest

from shapely.geometry import Point, shape

from graupel_gen.resolver import (
    CLOUD_TERMINAL,
    MAIN_TERMINAL,
    MIN_CLOUD_PRESSURE_LEVELS,
    domain_contains,
)

from conftest import DATA


def _load(name):
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def _hours(resolver, ids):
    return [resolver.hours(m) for m in ids]


def test_resolver_points_resolve_to_their_region(resolver, sources):
    for point in sources.resolver_points:
        result = resolver.resolve(point["lat"], point["lon"])
        if "region" in point:
            assert result["region_id"] == point["region"], point["name"]
        if "reason" in point:
            assert result["resolution_reason"] == point["reason"], point["name"]


@pytest.mark.parametrize(
    "lat, lon, region",
    [
        (47.421, 10.985, "northern_alps"),  # Zugspitze
        (47.554, 12.923, "eastern_alps"),  # Watzmann
        (48.857, 2.352, "france"),  # Paris
    ],
)
def test_acceptance_points(resolver, lat, lon, region):
    result = resolver.resolve(lat, lon)
    assert result["region_id"] == region
    assert result["resolution_reason"] == "region"


@pytest.mark.parametrize(
    "lat, lon",
    [
        (46.9655, 11.0076),  # Sölden
        (47.2692, 11.4041),  # Innsbruck
        (47.0742, 12.6947),  # Großglockner
        (48.208, 16.373),  # Wien
        (47.554, 12.923),  # Watzmann (Eastern Alps, chain of Austria)
    ],
)
def test_austria_starts_with_claef(resolver, lat, lon):
    # GeoSphere discontinued AROME Austria on 2026-11-04; C-LAEF follows it
    # (REQ-767).
    result = resolver.resolve(lat, lon)
    assert result["resolution_reason"] == "region"
    assert result["main_chain_ids"] == [
        "geosphere_claef_austria",
        "icon_eu",
        MAIN_TERMINAL,
    ]


@pytest.mark.parametrize(
    "lat, lon",
    [
        (50.08, 14.43),  # Praha
        (48.15, 17.11),  # Bratislava
        (47.50, 19.04),  # Budapest
        (46.05, 14.51),  # Ljubljana
        (45.81, 15.98),  # Zagreb
    ],
)
def test_central_eastern_europe_starts_with_claef(resolver, lat, lon):
    # The C-LAEF domain (43.0-51.5° N, 5.0-22.6° E, measured by the probes of
    # `graupel-gen domains`) covers these capitals (REQ-767).
    result = resolver.resolve(lat, lon)
    assert result["region_id"] == "central_eastern_europe"
    assert result["main_chain_ids"][0] == "geosphere_claef_austria"


def test_claef_misses_the_far_south_of_croatia(resolver):
    # Dubrovnik lies south of the C-LAEF domain: ICON-EU leads (REQ-767).
    result = resolver.resolve(42.65, 18.09)
    assert result["region_id"] == "central_eastern_europe"
    assert result["main_chain_ids"] == ["icon_eu", MAIN_TERMINAL]


def test_inactive_models_are_no_fallback(resolver):
    # AROME Austria delivers no new runs (REQ-767): never a fallback model.
    for lat, lon in [(47.5, 14.5), (46.0, 9.0), (49.0, 18.0)]:
        assert "geosphere_arome_austria" not in resolver.fallback_candidates(
            lat, lon, False
        )


def test_mid_atlantic_is_global_fallback(resolver):
    # RDPS delivers data here but is coarser than IFS, so it is not used.
    result = resolver.resolve(40.0, -35.0)
    assert result["resolution_reason"] == "global_fallback"
    assert result["main_chain_ids"] == [MAIN_TERMINAL]
    assert result["cloud_chain_ids"] == [CLOUD_TERMINAL]


def test_region_chains_drop_models_that_miss_the_point(resolver):
    # Anchorage: RRFS and HRDPS miss Alaska's south coast, RDPS covers it.
    result = resolver.resolve(61.22, -149.9)
    assert result["region_id"] == "usa"
    assert result["main_chain_ids"] == ["cmc_gem_rdps", "ecmwf_ifs"]


def test_region_chains_drop_models_that_do_not_extend_the_horizon(resolver):
    # New York: HRDPS (48 h) and RDPS (84 h) would not extend RRFS (84 h).
    assert resolver.resolve(40.713, -74.006)["main_chain_ids"] == [
        "ncep_rrfs_conus",
        "ncep_nbm_conus",
        "ecmwf_ifs",
    ]


@pytest.mark.parametrize(
    "lat, lon",
    [
        (41.878, -87.630),  # Chicago
        (39.739, -104.990),  # Denver
        (25.762, -80.192),  # Miami
    ],
)
def test_usa_starts_with_rrfs(resolver, lat, lon):
    # Open-Meteo ends HRRR on 2026-11-30; RRFS is its successor (REQ-768).
    result = resolver.resolve(lat, lon)
    assert result["region_id"] == "usa"
    assert result["main_chain_ids"][0] == "ncep_rrfs_conus"
    assert result["cloud_chain_ids"][0] == "ncep_rrfs_conus"


def test_hrrr_is_in_no_chain(resolver, sources):
    # REQ-768: HRRR stays in the catalogue but in no region chain, no
    # resolver case, no chain zone and no fallback.
    for region in resolver.regions:
        result = resolver.region_chains(region["id"])
        for key in ("main_chain_ids", "cloud_chain_ids"):
            assert "ncep_hrrr_conus" not in result[key], (region["id"], key)
    for point in sources.resolver_points:
        result = resolver.resolve(point["lat"], point["lon"])
        for key in ("main_chain_ids", "cloud_chain_ids"):
            assert "ncep_hrrr_conus" not in result[key], (point["name"], key)
    for zone in _load("chain_zones.json")["zones"]:
        for key in ("main_chain_ids", "cloud_chain_ids"):
            assert "ncep_hrrr_conus" not in zone[key], (zone["id"], key)
    for lat, lon in [(40.713, -74.006), (19.433, -99.133), (23.1, -82.4)]:
        for cloud in (False, True):
            assert "ncep_hrrr_conus" not in resolver.fallback_candidates(
                lat, lon, cloud
            )


def test_domain_fallback_uses_regional_models_finer_than_ifs(resolver):
    result = resolver.resolve(25.03, 121.56)  # Taipei
    assert result["resolution_reason"] == "domain_fallback"
    assert result["region_id"] is None
    assert result["main_chain_ids"] == ["jma_msm", "ecmwf_ifs"]


def test_invalid_input_is_global_fallback(resolver):
    result = resolver.resolve("x", None)
    assert result["resolution_reason"] == "global_fallback"
    assert result["main_chain_ids"] == ["ecmwf_ifs"]


@pytest.mark.parametrize(
    "lat, lon",
    [
        (47.421, 10.985),
        (45.8326, 6.8652),
        (40.713, -74.006),
        (61.22, -149.9),
        (78.22, 15.65),
        (39.03, 125.75),
        (36.8, 10.18),
        (0.0, 0.0),
    ],
)
def test_chains_are_strictly_increasing_and_cloud_capable(resolver, lat, lon):
    result = resolver.resolve(lat, lon)
    for key, terminal in (
        ("main_chain_ids", MAIN_TERMINAL),
        ("cloud_chain_ids", CLOUD_TERMINAL),
    ):
        hours = _hours(resolver, result[key])
        assert hours == sorted(set(hours)), key
        assert result[key][-1] == terminal
    for model_id in result["cloud_chain_ids"]:
        assert resolver.cloud_capable(model_id), model_id


def test_region_chains_use_catalogue_models(resolver, catalogue):
    models = {m["id"]: m for m in catalogue}
    for region in resolver.regions:
        for model_id in region["main_chain_ids"] + region["cloud_chain_ids"]:
            assert model_id in models, (region["id"], model_id)
        for model_id in region["cloud_chain_ids"]:
            levels = models[model_id]["pressure_levels_hpa"]
            assert len(levels) >= MIN_CLOUD_PRESSURE_LEVELS, model_id


def test_regions_match_the_sources(region_features, sources):
    assert [f["properties"]["id"] for f in region_features] == [
        r["id"] for r in sources.regions["regions"]
    ]
    for f in region_features:
        props = f["properties"]
        assert set(props) == {
            "id",
            "name",
            "priority",
            "group",
            "area_km2",
            "main_chain_ids",
            "cloud_chain_ids",
        }
        assert f["geometry"]["type"] == "MultiPolygon"
        assert props["area_km2"] > 0


def test_no_continent_regions(resolver):
    assert {r["priority"] for r in resolver.regions} == {20, 30}


def test_region_chains_keep_the_whole_preference_list(resolver):
    result = resolver.region_chains("usa")
    assert result["region_id"] == "usa"
    assert result["region_name"] == "USA"
    assert result["resolution_reason"] == "region"
    # Without a point no model is dropped for its domain; HRDPS and RDPS
    # still leave because they do not extend RRFS's horizon.
    assert result["main_chain_ids"] == [
        "ncep_rrfs_conus",
        "ncep_nbm_conus",
        "ecmwf_ifs",
    ]
    assert result["cloud_chain_ids"][-1] == "ecmwf_ifs025"
    assert resolver.region_chains("germany")["main_chain_ids"] == [
        "icon_d2",
        "icon_eu",
        "ecmwf_ifs",
    ]


def test_region_chains_are_strictly_increasing_for_every_region(resolver):
    for region in resolver.regions:
        result = resolver.region_chains(region["id"])
        for key in ("main_chain_ids", "cloud_chain_ids"):
            hours = _hours(resolver, result[key])
            assert hours == sorted(set(hours)), (region["id"], key)


def test_unknown_region_has_no_chains(resolver):
    assert resolver.region_chains("atlantis") is None


# --- chain zones ---------------------------------------------------------------


def test_chain_zones_match_the_resolver(resolver):
    for zone in _load("chain_zones.json")["zones"]:
        lon, lat = zone["sample"]
        result = resolver.resolve(lat, lon)
        assert result["main_chain_ids"] == zone["main_chain_ids"], zone["id"]
        assert result["cloud_chain_ids"] == zone["cloud_chain_ids"], zone["id"]


@pytest.mark.parametrize(
    "lat, lon",
    [(72.0, -46.0), (60.0, -46.0), (85.0, -45.0)],
)
def test_chain_zone_of_the_former_rdps_gap_matches_the_resolver(
    resolver, lat, lon
):
    # Central Greenland and the Labrador Sea lay outside RDPS (REQ-441).
    assert domain_contains(resolver.domains, "cmc_gem_rdps", lat, lon)
    result = resolver.resolve(lat, lon)
    point = Point(lon, lat)
    hits = [
        f["properties"]
        for f in _load("chain_zones.geojson")["features"]
        if shape(f["geometry"]).buffer(1e-9).contains(point)
    ]
    assert hits
    for props in hits:
        assert props["main_chain_ids"] == result["main_chain_ids"]


def test_chain_zone_geojson_matches_the_zone_list():
    zones = {z["id"]: z for z in _load("chain_zones.json")["zones"]}
    features = _load("chain_zones.geojson")["features"]
    seen = set()
    for f in features:
        props = f["properties"]
        zone = zones[props["id"]]
        assert props["part"] in ("land", "coast", "sea")
        assert props["main_chain_ids"] == zone["main_chain_ids"]
        assert props["group"] == zone["group"]
        assert f["geometry"]["type"] == "MultiPolygon"
        assert f["geometry"]["coordinates"]
        seen.add(props["id"])
    assert seen == set(zones)


def test_chain_zone_groups(resolver):
    zones = _load("chain_zones.json")["zones"]
    by_main = {}
    for zone in zones:
        by_main.setdefault(tuple(zone["main_chain_ids"]), []).append(zone)
    # Intercontinental: RDPS where the USA / Canada / Nordic chains only
    # keep RDPS (southern Alaska, Arctic Canada, Svalbard).
    rdps = by_main[("cmc_gem_rdps", "ecmwf_ifs")]
    assert any(
        z["group"] == "Intercontinental" and "USA" in z["regions"]
        for z in rdps
    )
    # Domain fallback, e.g. North Africa and northern Mexico.
    arpege = by_main[("meteofrance_arpege_europe", "ecmwf_ifs")]
    assert any(
        z["group"] == "Europe" and "domain_fallback" in z["reasons"]
        for z in arpege
    )
    rrfs = by_main[("ncep_rrfs_conus", "ncep_nbm_conus", "ecmwf_ifs")]
    assert {z["group"] for z in rrfs} == {"North America"}
    ifs = by_main[("ecmwf_ifs",)]
    assert [z["group"] for z in ifs] == ["Global"]
    assert ifs[0]["cloud_chain_ids"] == ["ecmwf_ifs025"]
    assert "global_fallback" in ifs[0]["reasons"]


def test_resolver_cases_match_the_resolver(resolver, sources):
    cases = _load("resolver_cases.json")["cases"]
    assert [c["name"] for c in cases] == [
        p["name"] for p in sources.resolver_points
    ]
    for case in cases:
        result = resolver.resolve(case["lat"], case["lon"])
        for key in (
            "region_id",
            "resolution_reason",
            "main_chain_ids",
            "cloud_chain_ids",
        ):
            assert case[key] == result[key], (case["name"], key)
