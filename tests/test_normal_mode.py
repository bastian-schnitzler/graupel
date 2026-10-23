"""Normal mode (system.md §3.3, #138): auto chain forecasts."""

import pytest

from graupel.data import auto_chain
from graupel.data.api import MeteogramAPI
from graupel.data.models import (
    AutoChainInfo,
    Location,
    MeteogramConfig,
    WeatherModel,
)
from graupel.data.open_meteo import VARIABLE_TO_OPENMETEO
from graupel.data.quantities import QUANTITIES, fetch_set
from graupel.data.service import ForecastService
from graupel.data.storage import Storage
from tests.test_service import MockOpenMeteoClient

ZUGSPITZE = {"name": "Zugspitze", "latitude": 47.421, "longitude": 10.985}
NEW_YORK = {"name": "New York", "latitude": 40.7128, "longitude": -74.006}


class OutOfDomainClient(MockOpenMeteoClient):
    """Fails like Open-Meteo outside a domain for the listed model ids."""

    def __init__(self, outside):
        super().__init__()
        self.outside = set(outside)

    async def _get(self, params: dict):
        if params.get("models") in self.outside:
            self.model_calls.append(params)
            raise RuntimeError("No data is available for this location")
        return await super()._get(params)


@pytest.fixture
def api_for():
    created = []

    def make(client):
        storage = Storage(":memory:")
        created.append(storage)
        return MeteogramAPI(
            storage=storage,
            service=ForecastService(client=client, storage=storage),
        )

    yield make
    for storage in created:
        storage.close()


def _cloud_model(name, model_id, horizon):
    return WeatherModel(
        name=name,
        id=model_id,
        max_forecast_horizon_hours=horizon,
        supports_vertical_cloud_profile=True,
        pressure_levels_hpa=[1000, 925, 850, 700, 600, 500, 400, 300, 250, 200],
    )


def _auto_info(main, cloud):
    return AutoChainInfo(
        resolution_reason="region",
        main_model_chain=main,
        cloud_model_chain=cloud,
    )


def test_get_auto_forecast_requests_every_quantity_and_the_cloud_profile(
    api_for,
):
    client = MockOpenMeteoClient()
    result = api_for(client).get_auto_forecast(ZUGSPITZE)

    resolved = auto_chain.resolve_auto_chain(47.421, 10.985)
    info = result["auto_chain"]
    assert info["region_id"] == "northern_alps"
    assert info["region_name"] == resolved["region_name"]
    assert [m["id"] for m in info["main_model_chain"]] == [
        m.id for m in resolved["main_model_chain"]
    ]
    assert [m["id"] for m in info["cloud_model_chain"]] == [
        m.id for m in resolved["cloud_model_chain"]
    ]

    registered = {
        VARIABLE_TO_OPENMETEO[q]
        for q in fetch_set()
        if QUANTITIES[q].source == "hourly"
    }
    main_ids = {m.id for m in resolved["main_model_chain"]}
    main_calls = [
        c for c in client.model_calls
        if c.get("models") in main_ids and "temperature_2m" in c["hourly"]
    ]
    assert main_calls
    for call in main_calls:
        requested = set(call["hourly"].split(","))
        # Only catalogued optional quantities may be left out per model.
        assert {"temperature_2m", "precipitation", "wind_speed_10m"} <= requested
        assert requested <= registered
    cloud_calls = [
        c for c in client.model_calls
        if "cloud_cover_1000hPa" in c.get("hourly", "")
    ]
    assert {c["models"] for c in cloud_calls} == {
        m.id for m in resolved["cloud_model_chain"]
    }
    assert all("geopotential_height_1000hPa" in c["hourly"] for c in cloud_calls)
    assert result["vertical_cloud_forecast"]["profiles"]


def test_auto_chain_is_resolved_per_location(api_for):
    api = api_for(MockOpenMeteoClient())
    alps = api.get_auto_forecast(ZUGSPITZE)["auto_chain"]
    usa = api.get_auto_forecast(NEW_YORK)["auto_chain"]
    assert alps["region_id"] == "northern_alps"
    assert usa["region_id"] == "usa"
    assert [m["id"] for m in usa["main_model_chain"]] == [
        m.id
        for m in auto_chain.resolve_auto_chain(
            NEW_YORK["latitude"], NEW_YORK["longitude"]
        )["main_model_chain"]
    ]


@pytest.mark.asyncio
async def test_model_without_data_is_dropped_and_next_model_takes_over():
    main = [
        WeatherModel(name="ICON-D2", id="icon_d2", max_forecast_horizon_hours=10),
        WeatherModel(name="ICON-EU", id="icon_eu", max_forecast_horizon_hours=24),
    ]
    cfg = MeteogramConfig(
        name="Auto",
        location=Location(name="Test", latitude=0.0, longitude=0.0),
        model_chain=main,
        cloud_model_chain=[],
    )
    service = ForecastService(client=OutOfDomainClient({"icon_d2"}))

    result = await service.get_merged_forecast(
        cfg, auto_chain=_auto_info(main, [])
    )

    assert "ICON-D2" not in result.model_forecasts
    assert "ICON-D2" not in result.model_availability
    assert {p.model for p in result.combined_forecast} == {"ICON-EU"}
    temps = [p for p in result.combined_forecast if p.variable == "temperature"]
    assert temps and all(p.value is not None for p in temps)
    assert result.auto_chain is not None
    assert result.auto_chain.dropped_models == ["ICON-D2"]
    assert [m.name for m in result.auto_chain.main_model_chain] == ["ICON-EU"]


@pytest.mark.asyncio
async def test_power_mode_keeps_the_empty_slice():
    main = [
        WeatherModel(name="ICON-D2", id="icon_d2", max_forecast_horizon_hours=10),
        WeatherModel(name="ICON-EU", id="icon_eu", max_forecast_horizon_hours=24),
    ]
    cfg = MeteogramConfig(
        name="Power",
        location=Location(name="Test", latitude=0.0, longitude=0.0),
        model_chain=main,
        cloud_model_chain=[],
    )
    service = ForecastService(client=OutOfDomainClient({"icon_d2"}))

    result = await service.get_merged_forecast(cfg)

    assert result.auto_chain is None
    d2 = [p for p in result.combined_forecast if p.model == "ICON-D2"]
    assert d2 and all(p.value is None for p in d2)


@pytest.mark.asyncio
async def test_cloud_model_without_profiles_is_dropped():
    main = [
        WeatherModel(name="ICON-EU", id="icon_eu", max_forecast_horizon_hours=24)
    ]
    cloud = [
        _cloud_model("ICON-D2", "icon_d2", 10),
        _cloud_model("ECMWF IFS 0.25°", "ecmwf_ifs025", 24),
    ]
    cfg = MeteogramConfig(
        name="Auto",
        location=Location(name="Test", latitude=0.0, longitude=0.0),
        model_chain=main,
        cloud_model_chain=cloud,
    )
    service = ForecastService(client=OutOfDomainClient({"icon_d2"}))

    result = await service.get_merged_forecast(
        cfg, auto_chain=_auto_info(main, cloud)
    )

    assert result.auto_chain.dropped_cloud_models == ["ICON-D2"]
    assert [m.name for m in result.auto_chain.cloud_model_chain] == [
        "ECMWF IFS 0.25°"
    ]
    assert "ICON-D2" not in result.cloud_model_availability
    profiles = result.vertical_cloud_forecast.profiles
    assert profiles
    assert {p.source_model_id for p in profiles} == {"ecmwf_ifs025"}


@pytest.mark.asyncio
async def test_nothing_is_dropped_when_no_model_delivers_data():
    main = [
        WeatherModel(name="ICON-D2", id="icon_d2", max_forecast_horizon_hours=10),
        WeatherModel(name="ICON-EU", id="icon_eu", max_forecast_horizon_hours=24),
    ]

    class NullClient(MockOpenMeteoClient):
        async def _get(self, params):
            response = await super()._get(params)
            for key, values in response["hourly"].items():
                if key != "time":
                    response["hourly"][key] = [None] * len(values)
            return response

    cfg = MeteogramConfig(
        name="Auto",
        location=Location(name="Test", latitude=0.0, longitude=0.0),
        model_chain=main,
        cloud_model_chain=[],
    )
    result = await ForecastService(client=NullClient()).get_merged_forecast(
        cfg, auto_chain=_auto_info(main, [])
    )
    assert result.auto_chain.dropped_models == []
    assert [m.name for m in result.auto_chain.main_model_chain] == [
        "ICON-D2",
        "ICON-EU",
    ]
