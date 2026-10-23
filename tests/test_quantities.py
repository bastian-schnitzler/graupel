from pathlib import Path

import pytest

from graupel.data.harmonizer import Harmonizer
from graupel.data.layouts import NORMAL_LAYOUT, POWER_DEFAULT_LAYOUT
from graupel.data.open_meteo import VARIABLE_TO_OPENMETEO
from graupel.data.quantities import (
    FRONTEND_REGISTRY_PATH,
    KINDS,
    QUANTITIES,
    SOURCE_DERIVED,
    STYLES,
    all_quantities,
    display_set,
    expand_requires,
    expected_quantities,
    fetch_set,
    open_meteo_names,
    render_frontend_registry,
    requested_from_model,
)

ROOT = Path(__file__).resolve().parent.parent


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
        "wind_speed",
        "wind_gusts",
        "wind_direction",
        "cloud_cover",
        "precipitation",
        "precipitation_probability",
        "snowfall",
        "snow_depth",
        "cape",
        "convective_inhibition",
        "lightning_potential",
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
        "wind_speed",
        "wind_gusts",
        "wind_direction",
        "cloud_cover",
        "precipitation",
        "precipitation_probability",
        "snowfall",
        "snow_depth",
        "cape",
        "convective_inhibition",
        "lightning_potential",
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
                "id": "convective",
                "enabled": False,
                "series": [{"quantity": "cape", "style": "area"}],
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


def test_optional_catalogued_quantities_need_model_support():
    assert requested_from_model("cape", ["temperature", "cape"])
    assert not requested_from_model("lightning_potential", ["temperature", "cape"])
    assert not requested_from_model("cape", None)
    # Optional but not probed by the catalogue: always requested.
    assert requested_from_model("snowfall", [])
    assert requested_from_model("weather_code", None)
    assert requested_from_model("precipitation_probability", [])
    assert requested_from_model("temperature_2m", [])


def test_names_and_units_are_derived_from_registry():
    assert VARIABLE_TO_OPENMETEO["temperature"] == "temperature_2m"
    assert VARIABLE_TO_OPENMETEO["cin"] == "convective_inhibition"
    assert Harmonizer.normalize_variable("wind_gusts_10m") == "wind_gusts"
    assert Harmonizer.normalize_variable("POP") == "precipitation_probability"
    assert Harmonizer.normalize_variable("lpi") == "lightning_potential"
    assert Harmonizer.TARGET_UNITS["snow_depth"] == "m"


def test_frontend_fallback_copy_is_up_to_date():
    generated = (ROOT / FRONTEND_REGISTRY_PATH).read_text(encoding="utf-8")
    assert generated == render_frontend_registry(), (
        "run python dev-tools/export_quantity_registry.py"
    )


def test_only_snow_is_dropped_on_a_rejected_request():
    assert {q.id for q in all_quantities() if q.retry_without} == {"snowfall", "snow_depth"}


def test_ensemble_quantities_never_define_delivered_hours():
    from graupel.data.quantities import (
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


def test_builtin_layouts_draw_precipitation_with_snow_coloring():
    for layout in (POWER_DEFAULT_LAYOUT, NORMAL_LAYOUT):
        precip = next(area for area in layout["areas"] if area["id"] == "precip")
        assert precip["series"][0] == {
            "quantity": "precipitation_rain_snow",
            "style": "bars",
        }
