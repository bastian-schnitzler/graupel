import pytest
import uuid
from graupel.data.models import Location, WeatherModel, MeteogramConfig
from graupel.data.storage import Storage
from graupel.data.service import ForecastService
from graupel.data.api import MeteogramAPI
from tests.test_service import MockOpenMeteoClient
from graupel.data.timeline import parse_timestamp


def timeline_hour_count(result):
    return int(
        (
            parse_timestamp(result["timeline_end"])
            - parse_timestamp(result["timeline_start"])
        ).total_seconds()
        / 3600
    )


@pytest.fixture
def storage():
    db_name = f"file:memdb_{uuid.uuid4().hex}?mode=memory&cache=shared"
    return Storage(db_name)


@pytest.fixture
def api(storage):
    client = MockOpenMeteoClient()
    service = ForecastService(client=client)
    return MeteogramAPI(storage=storage, service=service)


def test_get_models(api):
    models = api.get_models()
    assert isinstance(models, list)
    assert len(models) >= 10
    model_names = [m["name"] for m in models]
    assert "ICON-D2" in model_names
    assert "GFS Seamless" in model_names


def test_get_configurations_default_when_empty(api):
    configs = api.get_configurations()
    assert len(configs) == 5
    assert [c["name"] for c in configs] == [
        "Nordalpen",
        "Ostalpen",
        "Dolomiten",
        "Westalpen",
        "Westalpen",
    ]


def test_get_configurations(api, storage):
    loc = Location(name="Berlin", latitude=52.52, longitude=13.405)
    models = [WeatherModel(name="ICON-D2", max_forecast_horizon_hours=48)]
    cfg = MeteogramConfig(
        name="Berlin Config", location=loc, model_chain=models
    )
    storage.create(cfg)

    configs = api.get_configurations()
    assert len(configs) == 1
    assert configs[0]["name"] == "Berlin Config"


def test_save_and_delete_configuration(api):
    new_cfg = {
        "name": "Custom Config",
        "location": {
            "name": "Frankfurt",
            "latitude": 50.11,
            "longitude": 8.68,
        },
        "model_chain": [
            {"name": "ICON-D2", "max_forecast_horizon_hours": 24},
            {"name": "ICON-EU", "max_forecast_horizon_hours": 72},
        ],
    }
    saved = api.save_configuration(new_cfg)
    assert saved["id"] is not None
    assert saved["name"] == "Custom Config"

    # Update existing
    saved["name"] = "Updated Custom Config"
    updated = api.save_configuration(saved)
    assert updated["id"] == saved["id"]
    assert updated["name"] == "Updated Custom Config"

    # Delete
    del_res = api.delete_configuration(saved["id"])
    assert del_res["success"] is True


def test_save_configuration_preserves_location_elevation(api):
    new_cfg = {
        "name": "Swiss Alps Run",
        "location": {
            "name": "Lausanne",
            "latitude": 46.516,
            "longitude": 6.6328,
            "country": "Switzerland",
            "admin1": "Canton of Vaud",
            "elevation": 453.0,
        },
        "model_chain": [
            {"name": "ICON-D2", "max_forecast_horizon_hours": 24},
        ],
    }
    saved = api.save_configuration(new_cfg)
    assert saved["id"] is not None
    assert saved["location"]["name"] == "Lausanne"
    assert saved["location"]["elevation"] == 453.0
    assert saved["location"]["country"] == "Switzerland"
    assert saved["location"]["admin1"] == "Canton of Vaud"

    # Verify get_configurations also returns elevation
    configs = api.get_configurations()
    matching = next(c for c in configs if c["id"] == saved["id"])
    assert matching["location"]["elevation"] == 453.0


def test_create_and_update_configuration_explicit(api):
    new_cfg = {
        "name": "AutoSave Config",
        "location": {
            "name": "Stuttgart",
            "latitude": 48.77,
            "longitude": 9.18,
        },
        "model_chain": [{"name": "ICON-D2", "max_forecast_horizon_hours": 24}],
    }
    created = api.create_configuration(new_cfg)
    assert created["id"] is not None
    assert created["name"] == "AutoSave Config"

    updated = api.update_configuration(
        created["id"], {"name": "Renamed AutoSave Config"}
    )
    assert updated["id"] == created["id"]
    assert updated["name"] == "Renamed AutoSave Config"


def test_get_forecast_by_location(api):
    loc = {"name": "Hamburg", "latitude": 53.55, "longitude": 9.99}
    result = api.get_forecast(location=loc)

    assert "combined_forecast" in result
    assert "model_forecasts" in result
    assert len(result["combined_forecast"]) == timeline_hour_count(result) * 12
    assert "ICON-D2" in result["model_forecasts"]

    # Verify all 8 variables are represented in combined forecast
    vars_present = {pt["variable"] for pt in result["combined_forecast"]}
    assert "temperature" in vars_present
    assert "apparent_temperature" in vars_present
    assert "wind_speed" in vars_present
    assert "wind_gusts" in vars_present
    assert "wind_direction" in vars_present
    assert "cloud_cover" in vars_present
    assert "cloud_cover_low" not in vars_present
    assert "cloud_cover_mid" not in vars_present
    assert "cloud_cover_high" not in vars_present
    assert "precipitation" in vars_present
    assert "precipitation_probability" in vars_present


def test_get_forecast_by_config_id(api, storage):
    loc = Location(name="Munich", latitude=48.13, longitude=11.58)
    models = [
        WeatherModel(name="ICON-D2", max_forecast_horizon_hours=12),
        WeatherModel(name="ICON-EU", max_forecast_horizon_hours=24),
    ]
    cfg = storage.create(
        MeteogramConfig(name="Munich Config", location=loc, model_chain=models)
    )

    result = api.get_forecast(
        configuration_id=cfg.id, variables=["temperature"]
    )

    assert "combined_forecast" in result
    assert "model_forecasts" in result
    assert len(result["combined_forecast"]) == timeline_hour_count(result)
    assert "ICON-D2" in result["model_forecasts"]
    assert "ICON-EU" in result["model_forecasts"]


def test_refresh_forecast(api):
    loc = {"name": "Cologne", "latitude": 50.93, "longitude": 6.95}
    result = api.refresh_forecast(location=loc)

    assert "combined_forecast" in result
    assert "model_forecasts" in result


def test_unavailable_model_marked_in_configurations(api, storage):
    loc = Location(name="Berlin", latitude=52.52, longitude=13.405)
    models = [
        WeatherModel(name="NON-EXISTENT-MODEL", max_forecast_horizon_hours=48)
    ]
    cfg = MeteogramConfig(
        name="Berlin Config", location=loc, model_chain=models
    )
    storage.create(cfg)

    configs = api.get_configurations()

    assert len(configs) >= 1
    berlin_cfg = next(c for c in configs if c["name"] == "Berlin Config")
    assert berlin_cfg["model_chain"][0]["name"] == "NON-EXISTENT-MODEL"
    assert berlin_cfg["model_chain"][0].get("unavailable") is True


def test_legacy_gfs_model_not_marked_unavailable(api, storage):
    loc = Location(name="Legacy Config Loc", latitude=50.0, longitude=8.0)
    models = [WeatherModel(name="GFS", max_forecast_horizon_hours=384)]
    cfg = MeteogramConfig(
        name="Legacy GFS Config", location=loc, model_chain=models
    )
    storage.create(cfg)

    configs = api.get_configurations()
    gfs_cfg = next(c for c in configs if c["name"] == "Legacy GFS Config")
    model = gfs_cfg["model_chain"][0]
    assert model["name"] == "GFS"
    assert model.get("unavailable") is not True
    assert model.get("id") in ("gfs_seamless", "ncep_gfs_seamless")


def test_get_forecast_with_config_id_and_location_override(api, storage):
    loc_munich = Location(name="Munich", latitude=48.13, longitude=11.58)
    models = [
        WeatherModel(name="ICON-D2", max_forecast_horizon_hours=12),
        WeatherModel(name="ICON-EU", max_forecast_horizon_hours=24),
    ]
    cfg = storage.create(
        MeteogramConfig(
            name="Munich Config", location=loc_munich, model_chain=models
        )
    )

    # Query with configuration_id AND an overridden location (e.g. Bolzano)
    loc_bolzano = {"name": "Bolzano", "latitude": 46.49, "longitude": 11.34}
    result = api.get_forecast(
        location=loc_bolzano,
        configuration_id=cfg.id,
        variables=["temperature"],
    )

    assert "combined_forecast" in result
    assert "model_forecasts" in result
    assert len(result["combined_forecast"]) == timeline_hour_count(result)
    # The internal client was called with Bolzano's coordinates
    last_req = api.service.client.last_params
    assert last_req["latitude"] == 46.49
    assert last_req["longitude"] == 11.34


def test_reorder_configurations(api):
    cfg1 = api.create_configuration(
        {
            "name": "Config 1",
            "location": {"name": "L1", "latitude": 10.0, "longitude": 10.0},
            "model_chain": [],
        }
    )
    cfg2 = api.create_configuration(
        {
            "name": "Config 2",
            "location": {"name": "L2", "latitude": 20.0, "longitude": 20.0},
            "model_chain": [],
        }
    )
    cfg3 = api.create_configuration(
        {
            "name": "Config 3",
            "location": {"name": "L3", "latitude": 30.0, "longitude": 30.0},
            "model_chain": [],
        }
    )

    # Initially in creation order
    configs = api.get_configurations()
    assert [c["name"] for c in configs] == ["Config 1", "Config 2", "Config 3"]

    # Reorder
    updated = api.reorder_configurations([cfg3["id"], cfg1["id"], cfg2["id"]])
    assert [c["name"] for c in updated] == ["Config 3", "Config 1", "Config 2"]


def test_create_configuration_with_position(api):
    cfg1 = api.create_configuration(
        {
            "name": "Alpha",
            "location": {"name": "L1", "latitude": 10.0, "longitude": 10.0},
            "model_chain": [],
        }
    )
    cfg2 = api.create_configuration(
        {
            "name": "Beta",
            "location": {"name": "L2", "latitude": 20.0, "longitude": 20.0},
            "model_chain": [],
        }
    )

    # Insert between Alpha and Beta at position 1
    api.create_configuration(
        {
            "name": "Mid",
            "location": {"name": "L3", "latitude": 30.0, "longitude": 30.0},
            "model_chain": [],
        },
        position=1,
    )

    configs = api.get_configurations()
    assert [c["name"] for c in configs] == ["Alpha", "Mid", "Beta"]


def test_save_configuration_with_zero_horizon_model(api):
    payload = {
        "name": "Zero Horizon Config",
        "location": {"name": "Test Loc", "latitude": 45.0, "longitude": 9.0},
        "model_chain": [
            {"name": "ICON-D2", "max_forecast_horizon_hours": 0},
            {"name": "ICON-EU", "max_forecast_horizon_hours": 48},
        ],
    }
    saved = api.save_configuration(payload)
    assert saved["id"] is not None
    assert saved["model_chain"][0]["max_forecast_horizon_hours"] == 0
    assert saved["model_chain"][1]["max_forecast_horizon_hours"] == 48


def test_get_user_timezone(api, monkeypatch):
    monkeypatch.setenv("TZ", "Europe/Vienna")
    assert api.get_user_timezone() == "Europe/Vienna"
