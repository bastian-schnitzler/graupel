# SPDX-FileCopyrightText: 2026 Bastian Schnitzler
# SPDX-License-Identifier: MPL-2.0
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

import json

import pytest

from graupel_gen.quantities import (
    KINDS,
    QUANTITIES,
    SOURCE_DERIVED,
    STYLES,
    Quantity,
    all_quantities,
    display_set,
    expand_requires,
    expected_quantities,
    fetch_set,
    export_registry,
    open_meteo_names,
    requested_from_model,
    variable_aliases,
)

from conftest import DATA


def test_registry_entries_are_consistent():
    for quantity in all_quantities():
        assert quantity.kind in KINDS
        assert set(quantity.allowed_styles) <= set(STYLES)
        assert all(r in QUANTITIES for r in quantity.requires), quantity.id
        if quantity.source == "hourly":
            assert quantity.api_name and "{" not in quantity.api_name


def test_expected_quantities_match_previous_default_variables():
    # The former DEFAULT_VARIABLES (missing-variable warnings, fetch_data default).
    assert expected_quantities() == [
        "temperature",
        "apparent_temperature",
        "wind_speed",
        "wind_gusts",
        "wind_direction",
        "cloud_cover",
        "precipitation",
        "precipitation_probability",
    ]


def test_fetch_set_is_every_downloadable_quantity():
    assert fetch_set() == [
        "temperature",
        "apparent_temperature",
        "dew_point",
        "relative_humidity",
        "wind_speed",
        "wind_gusts",
        "wind_direction",
        "cloud_cover",
        "precipitation",
        "precipitation_probability",
        "snowfall",
        "snow_depth",
        "weather_code",
        "cloud_cover_pressure_level",
        "geopotential_height_pressure_level",
        "vertical_cloud_profile",
    ]


def test_hourly_fetch_set_matches_previous_target_variables():
    hourly = [v for v in fetch_set() if QUANTITIES[v].source == "hourly"]
    assert hourly == [
        "temperature",
        "apparent_temperature",
        "dew_point",
        "relative_humidity",
        "wind_speed",
        "wind_gusts",
        "wind_direction",
        "cloud_cover",
        "precipitation",
        "precipitation_probability",
        "snowfall",
        "snow_depth",
        "weather_code",
    ]


def test_display_set_expands_cloud_profile_requirements():
    layout = {
        "areas": [
            {
                "id": "precip",
                "background": {"kind": "vertical_cloud_profile", "enabled": True},
                "series": [],
            }
        ]
    }
    assert display_set(layout) == [
        "cloud_cover_pressure_level",
        "geopotential_height_pressure_level",
        "vertical_cloud_profile",
    ]


def test_display_set_adds_snow_source_of_bars():
    layout = {
        "areas": [
            {
                "id": "precip",
                "series": [
                    {"quantity": "precipitation", "style": "bars", "snowFrom": "snowfall"}
                ],
            }
        ]
    }
    assert display_set(layout) == ["precipitation", "snowfall"]


def test_display_set_adds_fill_target_of_lines():
    layout = {
        "areas": [
            {
                "id": "temp",
                "series": [
                    {"quantity": "dew_point", "style": "line", "fillTo": "temperature"}
                ],
            }
        ]
    }
    assert display_set(layout) == ["temperature", "dew_point"]


def test_display_set_skips_disabled_entries():
    layout = {
        "areas": [
            {
                "id": "temp",
                "series": [
                    {"quantity": "temperature", "style": "line"},
                    {"quantity": "apparent_temperature", "style": "line", "enabled": False},
                ],
            },
            {
                "id": "precip",
                "background": {"kind": "vertical_cloud_profile", "enabled": False},
                "series": [{"quantity": "precipitation", "style": "bars"}],
            },
            {
                "id": "wind",
                "enabled": False,
                "series": [{"quantity": "wind_speed", "style": "line"}],
            },
        ]
    }
    assert display_set(layout) == ["temperature", "precipitation"]


def test_display_set_rejects_unknown_quantity():
    with pytest.raises(ValueError, match="unknown quantity"):
        display_set({"areas": [{"id": "a", "series": [{"quantity": "nope"}]}]})


def test_requires_expansion_is_transitive_and_deduplicated():
    assert expand_requires(["vertical_cloud_profile", "cloud_cover_pressure_level"]) == [
        "cloud_cover_pressure_level",
        "geopotential_height_pressure_level",
        "vertical_cloud_profile",
    ]


def test_optional_catalogued_quantities_need_model_support(monkeypatch):
    gated = Quantity(
        id="gated",
        label="Gated",
        unit="1",
        kind="point",
        source="hourly",
        api_name="gated",
        optional=True,
        catalogued=True,
    )
    monkeypatch.setitem(QUANTITIES, "gated", gated)
    assert requested_from_model("gated", ["temperature", "gated"])
    assert not requested_from_model("gated", ["temperature"])
    assert not requested_from_model("gated", None)
    # Optional but not probed by the catalogue: always requested.
    assert requested_from_model("snowfall", [])
    assert requested_from_model("weather_code", None)
    assert requested_from_model("precipitation_probability", [])
    assert requested_from_model("temperature_2m", [])


def test_names_are_derived_from_registry():
    names = open_meteo_names()
    assert names["temperature"] == "temperature_2m"
    assert names["temp"] == "temperature_2m"
    aliases = variable_aliases()
    assert aliases["wind_gusts_10m"] == "wind_gusts"
    assert aliases["pop"] == "precipitation_probability"
    assert aliases["feels_like"] == "apparent_temperature"
    assert QUANTITIES["snow_depth"].unit == "m"


def test_quantities_json_is_the_registry():
    doc = json.loads((DATA / "quantities.json").read_text(encoding="utf-8"))
    assert doc["quantities"] == export_registry()


def test_only_snow_dew_point_and_humidity_are_dropped_on_a_rejected_request():
    assert {q.id for q in all_quantities() if q.retry_without} == {
        "snowfall",
        "snow_depth",
        "dew_point",
        "relative_humidity",
    }


def test_dew_point_is_fetched_optional_and_not_catalogued():
    # REQ-596: downloaded with every forecast, never probed into the catalogue.
    dew_point = QUANTITIES["dew_point"]
    assert dew_point.api_name == "dew_point_2m"
    assert dew_point.unit == "°C"
    assert dew_point.kind == "point"
    assert dew_point.optional and not dew_point.catalogued
    assert "dew_point" in fetch_set()
    assert "dew_point" not in expected_quantities()
    assert requested_from_model("dew_point", [])
    assert requested_from_model("dew_point", None)
    assert variable_aliases()["dew_point_2m"] == "dew_point"
    assert open_meteo_names()["dew_point"] == "dew_point_2m"


def test_relative_humidity_is_fetched_optional_and_not_catalogued():
    # REQ-648: downloaded with every forecast, never probed into the catalogue.
    humidity = QUANTITIES["relative_humidity"]
    assert humidity.api_name == "relative_humidity_2m"
    assert humidity.unit == "%"
    assert humidity.kind == "point"
    assert humidity.optional and not humidity.catalogued
    assert humidity.retry_without
    assert "relative_humidity" in fetch_set()
    assert "relative_humidity" not in expected_quantities()
    assert requested_from_model("relative_humidity", [])
    assert requested_from_model("relative_humidity", None)
    assert variable_aliases()["relative_humidity_2m"] == "relative_humidity"
    assert variable_aliases()["relativehumidity_2m"] == "relative_humidity"
    assert open_meteo_names()["relative_humidity"] == "relative_humidity_2m"


def test_ensemble_quantities_never_define_delivered_hours():
    from graupel_gen.quantities import (
        ensemble_quantities,
        main_run_excluded_quantities,
        optional_quantities,
    )

    assert ensemble_quantities() == ["precipitation_probability"]
    excluded = set(main_run_excluded_quantities())
    assert excluded == set(optional_quantities()) | {"precipitation_probability"}
    # Still warned about when missing: ensemble is not optional.
    assert "precipitation_probability" not in optional_quantities()


DERIVED = ("precipitation_rain_snow", "snowfall_with_rain")


def test_derived_snow_quantities_need_both_sources_and_no_download():
    for quantity_id in DERIVED:
        quantity = QUANTITIES[quantity_id]
        assert quantity.source == SOURCE_DERIVED
        assert not quantity.downloadable
        assert quantity.requires == ("precipitation", "snowfall")
        assert quantity.allowed_styles == ("bars",)
    assert not set(DERIVED) & set(expected_quantities())
    assert not set(DERIVED) & set(open_meteo_names())


def test_derived_quantities_are_drawn_but_never_fetched_or_archived():
    layout = {
        "areas": [
            {
                "id": "snow",
                "series": [
                    {"quantity": "snowfall_with_rain", "style": "bars"},
                    {"quantity": "precipitation_rain_snow", "style": "bars"},
                ],
            }
        ]
    }
    assert set(display_set(layout)) == {"precipitation", "snowfall", *DERIVED}
    fetched = fetch_set()
    assert {"precipitation", "snowfall"} <= set(fetched)
    assert not set(DERIVED) & set(fetched)
