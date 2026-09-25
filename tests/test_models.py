import pytest
from pydantic import ValidationError
from graupel.data.models import Location, WeatherModel, MeteogramConfig


def test_location_creation():
    loc = Location(name="Berlin", latitude=52.52, longitude=13.405)
    assert loc.name == "Berlin"
    assert loc.latitude == 52.52
    assert loc.longitude == 13.405
    assert loc.elevation is None
    assert loc.country is None
    assert loc.admin1 is None


def test_location_with_elevation_and_region():
    loc = Location(
        name="Lausanne",
        latitude=46.516,
        longitude=6.6328,
        country="Switzerland",
        admin1="Canton of Vaud",
        elevation=453.0,
    )
    assert loc.name == "Lausanne"
    assert loc.latitude == 46.516
    assert loc.longitude == 6.6328
    assert loc.country == "Switzerland"
    assert loc.admin1 == "Canton of Vaud"
    assert loc.elevation == 453.0


def test_weather_model_creation():
    model = WeatherModel(name="ICON-D2", max_forecast_horizon_hours=48)
    assert model.name == "ICON-D2"
    assert model.max_forecast_horizon_hours == 48


def test_weather_model_invalid_horizon():
    with pytest.raises(ValidationError):
        WeatherModel(name="ICON-D2", max_forecast_horizon_hours=-5)
    # 0h horizon is allowed for 0-hour span models
    zero_model = WeatherModel(name="ICON-D2", max_forecast_horizon_hours=0)
    assert zero_model.max_forecast_horizon_hours == 0


def test_meteogram_config_creation():
    loc = Location(name="Berlin", latitude=52.52, longitude=13.405)
    models = [
        WeatherModel(name="ICON-D2", max_forecast_horizon_hours=48),
        WeatherModel(name="ICON-EU", max_forecast_horizon_hours=120),
        WeatherModel(name="GFS", max_forecast_horizon_hours=384),
    ]
    config = MeteogramConfig(
        name="Berlin Default", location=loc, model_chain=models
    )

    assert config.name == "Berlin Default"
    assert len(config.model_chain) == 3
    assert config.model_chain[0].name == "ICON-D2"


def test_meteogram_config_allow_zero_hour_span_and_reject_decreasing():
    loc = Location(name="Berlin", latitude=52.52, longitude=13.405)
    # Equal horizons (0h span for second model) is allowed
    models_zero_span = [
        WeatherModel(name="ICON-D2", max_forecast_horizon_hours=48),
        WeatherModel(name="ICON-EU", max_forecast_horizon_hours=48),
    ]
    cfg = MeteogramConfig(
        name="Berlin Valid", location=loc, model_chain=models_zero_span
    )
    assert cfg.model_chain[1].max_forecast_horizon_hours == 48

    # Decreasing horizons is rejected
    models_decreasing = [
        WeatherModel(name="GFS", max_forecast_horizon_hours=384),
        WeatherModel(name="ICON-D2", max_forecast_horizon_hours=48),
    ]
    with pytest.raises(ValidationError, match="non-decreasing"):
        MeteogramConfig(
            name="Berlin Error", location=loc, model_chain=models_decreasing
        )


def test_meteogram_config_serialization():
    loc = Location(name="Berlin", latitude=52.52, longitude=13.405)
    models = [WeatherModel(name="ICON-D2", max_forecast_horizon_hours=48)]
    config = MeteogramConfig(
        name="Berlin Test", location=loc, model_chain=models
    )

    json_data = config.model_dump_json()
    config_parsed = MeteogramConfig.model_validate_json(json_data)

    assert config_parsed.name == config.name
    assert config_parsed.location.name == config.location.name
    assert config_parsed.model_chain[0].name == config.model_chain[0].name


def test_meteogram_config_serialization_preserves_elevation():
    loc = Location(
        name="Lausanne",
        latitude=46.516,
        longitude=6.6328,
        country="Switzerland",
        admin1="Canton of Vaud",
        elevation=453.0,
    )
    models = [WeatherModel(name="ICON-D2", max_forecast_horizon_hours=48)]
    config = MeteogramConfig(
        name="Lausanne Run", location=loc, model_chain=models
    )

    dumped = config.model_dump()
    assert dumped["location"]["elevation"] == 453.0
    assert dumped["location"]["country"] == "Switzerland"
    assert dumped["location"]["admin1"] == "Canton of Vaud"

    json_data = config.model_dump_json()
    config_parsed = MeteogramConfig.model_validate_json(json_data)
    assert config_parsed.location.elevation == 453.0
    assert config_parsed.location.country == "Switzerland"
    assert config_parsed.location.admin1 == "Canton of Vaud"


def test_meteogram_config_dual_chains_and_cloud_migration():
    loc = Location(name="Berlin", latitude=52.52, longitude=13.405)
    main_models = [WeatherModel(name="ICON-D2", max_forecast_horizon_hours=48)]

    # 1. Legacy config without cloud_model_chain gets default ECMWF IFS 0.25° (13 levels, 345h)
    legacy_cfg = MeteogramConfig(
        name="Legacy", location=loc, model_chain=main_models
    )
    assert legacy_cfg.cloud_model_chain is not None
    assert len(legacy_cfg.cloud_model_chain) == 1
    assert "IFS 0.25" in legacy_cfg.cloud_model_chain[0].name
    assert legacy_cfg.cloud_model_chain[0].max_forecast_horizon_hours == 345

    # 2. Explicit empty cloud chain remains empty (user disabled cloud view)
    empty_cloud_cfg = MeteogramConfig(
        name="No Clouds",
        location=loc,
        model_chain=main_models,
        cloud_model_chain=[],
    )
    assert empty_cloud_cfg.cloud_model_chain == []
    dumped = empty_cloud_cfg.model_dump()
    assert dumped["cloud_model_chain"] == []
    reloaded = MeteogramConfig.model_validate_json(
        empty_cloud_cfg.model_dump_json()
    )
    assert reloaded.cloud_model_chain == []

    # 3. Custom cloud chain validates non-decreasing horizons
    cloud_models = [
        WeatherModel(name="ICON-D2", max_forecast_horizon_hours=48),
        WeatherModel(name="ECMWF IFS 0.25°", max_forecast_horizon_hours=345),
    ]
    dual_cfg = MeteogramConfig(
        name="Dual",
        location=loc,
        model_chain=main_models,
        cloud_model_chain=cloud_models,
    )
    assert len(dual_cfg.main_model_chain) == 1
    assert len(dual_cfg.cloud_model_chain) == 2

    # Decreasing horizon in cloud chain fails validation
    invalid_cloud = [
        WeatherModel(name="ECMWF IFS 0.25°", max_forecast_horizon_hours=345),
        WeatherModel(name="ICON-D2", max_forecast_horizon_hours=48),
    ]
    with pytest.raises(
        ValueError, match="Model horizons must be non-decreasing"
    ):
        MeteogramConfig(
            name="Invalid Cloud",
            location=loc,
            model_chain=main_models,
            cloud_model_chain=invalid_cloud,
        )
