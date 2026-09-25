import pytest
import os
import json
from graupel.data.open_meteo import (
    load_catalog,
    get_model_catalog,
    to_open_meteo_model,
    get_catalog_load_status,
    _process_catalog_raw_data,
    DEFAULT_VARIABLES,
    CONVECTIVE_VARIABLES,
)
from graupel.data.models import WeatherModel, MeteogramConfig, Location
from graupel.data.api import MeteogramAPI


def test_catalog_loading_from_offline_resource():
    catalog = load_catalog(force_refresh=True)
    assert isinstance(catalog, list)
    assert len(catalog) >= 30
    status = get_catalog_load_status()
    assert status in ("local", "refreshed")


def test_catalog_metadata_fields():
    catalog = get_model_catalog()
    icon_d2 = next(m for m in catalog if m.name == "ICON-D2" or m.id == "icon_d2")
    assert icon_d2.id == "icon_d2"
    assert icon_d2.spatial_resolution_km in (2.0, 2.2)
    assert icon_d2.temporal_resolution_hours == 1
    assert icon_d2.max_forecast_horizon_hours == 48
    assert "precipitation_probability" in icon_d2.supported_variables


def test_complete_catalogue_automated_validation():
    """
    Automated validation test covering ALL models in the weather model catalogue.
    """
    catalog = load_catalog(force_refresh=True)
    assert len(catalog) >= 30

    seen_ids = set()
    for m in catalog:
        # 1. Unique model IDs
        assert m.id is not None and m.id != "", f"Model {m.name} has missing/empty ID"
        assert m.id not in seen_ids, f"Duplicate model ID found in catalogue: {m.id}"
        seen_ids.add(m.id)

        # 2. Non-empty provider and name
        assert m.name and m.name.strip(), f"Model ID {m.id} has empty name"
        assert m.provider and m.provider.strip(), f"Model ID {m.id} has empty provider"

        # 3. Positive spatial resolution where applicable
        assert m.spatial_resolution_km is not None and m.spatial_resolution_km > 0, (
            f"Model {m.id} must have positive spatial resolution, got {m.spatial_resolution_km}"
        )

        # 4. Positive temporal resolution
        assert m.temporal_resolution_hours is not None and m.temporal_resolution_hours > 0, (
            f"Model {m.id} must have positive temporal resolution, got {m.temporal_resolution_hours}"
        )

        # 5. Positive forecast horizon >= temporal resolution
        assert m.max_forecast_horizon_hours is not None and m.max_forecast_horizon_hours > 0, (
            f"Model {m.id} must have positive forecast horizon, got {m.max_forecast_horizon_hours}"
        )
        assert m.max_forecast_horizon_hours >= m.temporal_resolution_hours, (
            f"Model {m.id} forecast horizon ({m.max_forecast_horizon_hours}) must be >= timestep ({m.temporal_resolution_hours})"
        )

        # 6. Valid coverage/region info
        assert (m.geographical_coverage or m.region), f"Model {m.id} missing geographical coverage / region"

        # 7. Supported variables non-empty and containing valid variables
        assert len(m.supported_variables) >= 2, f"Model {m.id} must support at least 2 variables"
        for v in m.supported_variables:
            assert v in DEFAULT_VARIABLES + CONVECTIVE_VARIABLES, f"Model {m.id} contains unknown supported variable: {v}"


def test_meteoswiss_icon_ch1_vs_ch2_regression():
    """
    Regression test ensuring MeteoSwiss ICON-CH1 and ICON-CH2 have correct distinct forecast horizons and resolutions.
    ICON-CH1 -> 33h, 1.1km
    ICON-CH2 -> 120h, 2.1km
    """
    catalog = load_catalog(force_refresh=True)
    ch1 = next((m for m in catalog if m.id == "meteoswiss_icon_ch1"), None)
    ch2 = next((m for m in catalog if m.id == "meteoswiss_icon_ch2"), None)

    assert ch1 is not None, "MeteoSwiss ICON-CH1 must exist in the catalogue"
    assert ch2 is not None, "MeteoSwiss ICON-CH2 must exist in the catalogue"

    assert ch1.max_forecast_horizon_hours == 33, f"Expected ICON-CH1 horizon 33h, got {ch1.max_forecast_horizon_hours}h"
    assert ch2.max_forecast_horizon_hours == 120, f"Expected ICON-CH2 horizon 120h, got {ch2.max_forecast_horizon_hours}h"

    assert ch1.spatial_resolution_km == 1.1, f"Expected ICON-CH1 spatial resolution 1.1km, got {ch1.spatial_resolution_km}km"
    assert ch2.spatial_resolution_km == 2.1, f"Expected ICON-CH2 spatial resolution 2.1km, got {ch2.spatial_resolution_km}km"


def test_stable_models_horizon_regression():
    """
    Regression assertions for other key models with stable upstream metadata.
    """
    catalog = get_model_catalog()

    d2 = next(m for m in catalog if m.id == "icon_d2")
    assert d2.max_forecast_horizon_hours == 48

    eu = next(m for m in catalog if m.id == "icon_eu")
    assert eu.max_forecast_horizon_hours == 120

    icon_glob = next(m for m in catalog if m.id == "icon_global")
    assert icon_glob.max_forecast_horizon_hours == 180

    gfs = next(m for m in catalog if m.id in ("gfs_seamless", "ncep_gfs_seamless"))
    assert gfs.max_forecast_horizon_hours == 384


def test_partially_compatible_model_retained_with_missing_variables():
    catalog = get_model_catalog()
    arpege = next((m for m in catalog if "ARPEGE" in m.name or (m.id and "arpege" in m.id)), None)
    assert arpege is not None
    assert "precipitation_probability" in arpege.missing_variables


def test_unsuitable_model_filtering():
    raw_unsuitable = [
        {
            "id": "unsuitable_1",
            "name": "Unsuitable Single Var",
            "supported_variables": ["temperature"]
        },
        {
            "id": "suitable_1",
            "name": "Suitable Dual Var",
            "supported_variables": ["temperature", "wind_speed"],
            "max_forecast_hours": 24
        }
    ]
    processed = _process_catalog_raw_data(raw_unsuitable)
    assert len(processed) == 1
    assert processed[0].name == "Suitable Dual Var"


def test_duplicate_identifier_removal():
    raw_duplicates = [
        {"id": "icon_d2", "name": "ICON-D2", "supported_variables": ["temperature", "wind_speed"]},
        {"id": "icon_d2", "name": "ICON-D2 Duplicate", "supported_variables": ["temperature", "wind_speed"]}
    ]
    processed = _process_catalog_raw_data(raw_duplicates)
    assert len(processed) == 1
    assert processed[0].name == "ICON-D2"


def test_icon_ch1_ch2_global_coexist_distinctly():
    catalog = get_model_catalog()
    icon_ch1 = [m for m in catalog if m.id == "meteoswiss_icon_ch1"]
    icon_ch2 = [m for m in catalog if m.id == "meteoswiss_icon_ch2"]
    icon_global = [m for m in catalog if m.id == "icon_global"]

    assert len(icon_ch1) == 1, "ICON-CH1 must appear exactly once in the catalog"
    assert len(icon_ch2) == 1, "ICON-CH2 must appear exactly once in the catalog"
    assert len(icon_global) == 1, "ICON Global must appear exactly once in the catalog"

    assert icon_ch1[0].id != icon_ch2[0].id
    assert icon_ch1[0].id != icon_global[0].id
    assert icon_ch1[0].spatial_resolution_km == 1.1
    assert icon_ch2[0].spatial_resolution_km == 2.1


def test_conflicting_metadata_merging_and_logging(caplog):
    import logging
    raw_conflicts = [
        {"id": "test_model", "name": "Test Model", "spatial_resolution_km": 13.0, "supported_variables": ["temperature", "wind_speed"]},
        {"id": "test_model", "name": "Test Model", "spatial_resolution_km": 27.0, "supported_variables": ["temperature", "wind_speed"]}
    ]
    with caplog.at_level(logging.WARNING):
        processed = _process_catalog_raw_data(raw_conflicts)

    assert len(processed) == 1
    assert processed[0].id == "test_model"
    assert processed[0].spatial_resolution_km == 13.0
    assert any("Conflicting metadata for canonical model 'test_model'" in record.message for record in caplog.records)


def test_catalog_loading_is_idempotent():
    c1 = load_catalog(force_refresh=True)
    len1 = len(c1)
    ids1 = [m.id for m in c1]

    c2 = load_catalog()
    len2 = len(c2)
    ids2 = [m.id for m in c2]

    c3 = load_catalog(force_refresh=True)
    len3 = len(c3)
    ids3 = [m.id for m in c3]

    assert len1 == len2 == len3
    assert ids1 == ids2 == ids3


def test_model_name_translation():
    assert to_open_meteo_model("ICON-D2") == "icon_d2"
    assert to_open_meteo_model("GFS Seamless") in ("gfs_seamless", "ncep_gfs_seamless")
    assert to_open_meteo_model("GFS") in ("gfs_seamless", "ncep_gfs_seamless")
    assert to_open_meteo_model("ARPEGE World") == "meteofrance_arpege_world"
    assert to_open_meteo_model("icon_ch1") == "meteoswiss_icon_ch1"
    assert to_open_meteo_model("icon_ch2") == "meteoswiss_icon_ch2"
    assert to_open_meteo_model("gfs_global") in ("gfs_global", "ncep_gfs_global")


def test_catalogue_api_exposes_more_than_three_models():
    api = MeteogramAPI()
    models = api.get_models()
    assert len(models) > 3
    assert len(models) >= 30


def test_location_independent_catalogue_display(api=None):
    api = api or MeteogramAPI()
    models = api.get_models()
    model_ids = {m.get("id") for m in models}
    assert "icon_d2" in model_ids
    assert "metno_nordic" in model_ids
    assert "jma_msm" in model_ids


def test_catalogue_matches_openapi_yaml_model_count():
    """
    Verifies that the application's weather model catalogue contains
    exactly as many entries as defined in the Open-Meteo OpenAPI models enum,
    and that all enum model IDs are represented in the catalogue.
    """
    import yaml
    from pathlib import Path

    yaml_path = Path(__file__).parent.parent / "dev-tools" / "forecast.yml"
    assert yaml_path.exists(), f"forecast.yml not found at {yaml_path}"

    with open(yaml_path, "r", encoding="utf-8") as f:
        spec = yaml.safe_load(f)

    params = spec.get("paths", {}).get("/v1/forecast", {}).get("get", {}).get("parameters", [])
    models_param = next((p for p in params if p.get("name") == "models"), None)
    assert models_param is not None, "Could not find 'models' parameter in OpenAPI spec"

    yaml_models = models_param.get("schema", {}).get("items", {}).get("enum", [])
    assert len(yaml_models) > 0, "No models found in YAML enum"

    catalog = load_catalog(force_refresh=True)
    assert len(catalog) == len(yaml_models), (
        f"Catalogue count ({len(catalog)}) does not match YAML models count ({len(yaml_models)})"
    )

    catalog_ids = {m.id for m in catalog if m.id}
    for model_id in yaml_models:
        assert model_id in catalog_ids, f"Model ID '{model_id}' from OpenAPI YAML missing in catalogue"


def test_convective_capabilities_are_optional_without_model_warnings():
    catalog = load_catalog(force_refresh=True)
    for model in catalog:
        assert not set(CONVECTIVE_VARIABLES).intersection(model.missing_variables)
    icon_d2 = next(m for m in catalog if m.id == "icon_d2")
    icon_eu = next(m for m in catalog if m.id == "icon_eu")
    assert "lightning_potential" in icon_d2.supported_variables
    assert "lightning_potential" not in icon_eu.supported_variables
    assert {"cape", "convective_inhibition"} <= set(icon_eu.supported_variables)
