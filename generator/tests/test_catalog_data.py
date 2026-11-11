# SPDX-FileCopyrightText: 2026 Bastian Schnitzler
# SPDX-License-Identifier: MPL-2.0
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""The committed catalogue and the curated short names."""

from graupel_gen import catalog
from graupel_gen.quantities import (
    catalogued_quantities,
    expected_quantities,
    optional_quantities,
)
from graupel_gen.resolver import MIN_CLOUD_PRESSURE_LEVELS

from conftest import FIXTURES


def _by_id(catalogue):
    return {m["id"]: m for m in catalogue}


def test_entries_have_the_catalogue_fields_in_order(catalogue):
    for model in catalogue:
        assert tuple(model) == catalog.ENTRY_FIELDS, model["id"]


def test_complete_catalogue_validation(catalogue):
    assert len(catalogue) >= 30
    seen = set()
    for m in catalogue:
        assert m["id"] and m["id"] not in seen
        seen.add(m["id"])
        assert m["name"].strip(), m["id"]
        assert m["provider"].strip(), m["id"]
        assert m["region"].strip(), m["id"]
        assert m["spatial_resolution_km"] > 0, m["id"]
        assert m["temporal_resolution_hours"] > 0, m["id"]
        assert m["max_forecast_hours"] >= m["temporal_resolution_hours"]
        assert len(m["supported_variables"]) >= 2, m["id"]
        for v in m["supported_variables"]:
            assert v in catalogued_quantities(), (m["id"], v)
        assert m["pressure_levels_hpa"] == sorted(
            m["pressure_levels_hpa"], reverse=True
        ), m["id"]


def test_meteoswiss_icon_ch1_vs_ch2(catalogue):
    models = _by_id(catalogue)
    ch1, ch2 = models["meteoswiss_icon_ch1"], models["meteoswiss_icon_ch2"]
    assert ch1["max_forecast_hours"] == 33
    assert ch2["max_forecast_hours"] == 120
    assert ch1["spatial_resolution_km"] == 1.1
    assert ch2["spatial_resolution_km"] == 2.1


def test_stable_model_horizons(catalogue):
    models = _by_id(catalogue)
    assert models["icon_d2"]["max_forecast_hours"] == 48
    assert models["icon_eu"]["max_forecast_hours"] == 120
    assert models["icon_global"]["max_forecast_hours"] == 180
    assert models["ncep_gfs_seamless"]["max_forecast_hours"] == 384


def test_icon_d2_metadata(catalogue):
    icon_d2 = _by_id(catalogue)["icon_d2"]
    assert icon_d2["spatial_resolution_km"] == 2.2
    assert icon_d2["temporal_resolution_hours"] == 1
    assert "precipitation_probability" in icon_d2["supported_variables"]
    assert icon_d2["meta_path"] == "dwd_icon_d2"
    assert icon_d2["ensemble_meta_path"] == "dwd_icon_d2_eps_native"


def test_arpege_lacks_precipitation_probability(catalogue):
    arpege = _by_id(catalogue)["meteofrance_arpege_europe"]
    missing = [
        v for v in expected_quantities() if v not in arpege["supported_variables"]
    ]
    assert "precipitation_probability" in missing


def test_optional_quantities_never_count_as_missing(catalogue):
    for m in catalogue:
        missing = set(expected_quantities()) - set(m["supported_variables"])
        assert not missing & set(optional_quantities()), m["id"]


def test_catalogue_matches_the_openapi_models_enum(catalogue, sources):
    text = (FIXTURES / "forecast_models.yml").read_text(encoding="utf-8")
    enum = catalog.extract_models_enum(text)
    extra = [m for m in sources.extra_models if m not in enum]
    assert [m["id"] for m in catalogue] == [
        m for m in [*enum, *extra] if m not in sources.excluded_models
    ]


def test_blends_have_no_meta_path(catalogue):
    for m in catalogue:
        if m["id"] == "best_match" or "seamless" in m["id"]:
            assert m["meta_path"] is None, m["id"]
        else:
            assert m["meta_path"], m["id"]


def test_catalogue_carries_the_curated_short_names(catalogue, sources):
    assert {m["id"]: m["short_name"] for m in catalogue} == {
        m["id"]: sources.short_name_for(m["id"]) for m in catalogue
    }


def test_short_names_belong_to_catalogue_models_and_are_unique(
    catalogue, sources
):
    ids = {m["id"] for m in catalogue}
    assert set(sources.short_names) <= ids
    names = list(sources.short_names.values())
    assert len(names) == len(set(names))


def test_only_long_names_get_a_short_name(catalogue):
    models = _by_id(catalogue)
    assert models["geosphere_arome_austria"]["short_name"] == "AROME AT"
    assert models["geosphere_claef_austria"]["short_name"] == "C-LAEF"
    assert models["ncep_rrfs_conus"]["short_name"] == "RRFS"
    assert models["ncep_gfs_seamless"]["short_name"] == "GFS SL"
    assert all(
        m["short_name"] is None for m in catalogue if len(m["name"]) <= 10
    )
    # "Best match" has exactly 10 characters.
    assert models["best_match"]["short_name"] is None


def test_curated_models_match_the_catalogue(catalogue, sources):
    for m in catalogue:
        curated = sources.models[m["id"]]
        for key in catalog.CURATED_FIELDS:
            assert curated[key] == m[key], (m["id"], key)


def test_claef_follows_arome_austria(catalogue):
    # GeoSphere discontinued AROME Austria on 2026-11-04 (REQ-767): it stays
    # in the catalogue, inactive; C-LAEF (1 km, 60 h) is active.
    models = _by_id(catalogue)
    assert models["geosphere_arome_austria"]["active"] is False
    claef = models["geosphere_claef_austria"]
    assert claef["active"] is True
    assert claef["spatial_resolution_km"] == 1.0
    assert claef["max_forecast_hours"] == 60
    assert claef["meta_path"] == "geosphere_claef_austria"


def test_rrfs_follows_hrrr(catalogue, sources):
    # Open-Meteo ends HRRR on 2026-11-30 (REQ-768): it stays in the
    # catalogue, inactive; RRFS (3 km, 84 h) is active although the OpenAPI
    # enum does not list it, and has pressure levels for the cloud chain.
    models = _by_id(catalogue)
    assert models["ncep_hrrr_conus"]["active"] is False
    assert "ncep_rrfs_conus" in sources.extra_models
    rrfs = models["ncep_rrfs_conus"]
    assert rrfs["active"] is True
    assert rrfs["provider"] == "NOAA"
    assert rrfs["spatial_resolution_km"] == 3.0
    assert rrfs["max_forecast_hours"] == 84
    assert rrfs["meta_path"] == "ncep_rrfs_conus"
    assert len(rrfs["pressure_levels_hpa"]) >= MIN_CLOUD_PRESSURE_LEVELS
